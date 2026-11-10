"""Validate recorded evidence without inventing provenance for legacy or mock logs."""
import hashlib
import math
import re
import struct
from .calibration_maps import extract_vanos


def _hex(value, name):
    if not isinstance(value, str) or len(value) % 2 or re.fullmatch('[0-9a-fA-F]*', value) is None:
        raise ValueError(f'Invalid {name} hex')
    return bytes.fromhex(value)


def validate_capture(meta, samples):
    if meta.get('capture_schema_version') is None:
        return {'status': 'legacy_unverified', 'fitting_ready': False}
    if meta['capture_schema_version'] != 1:
        raise ValueError('Unsupported capture schema version')
    if meta.get('source') == 'mock':
        return {'status': 'synthetic', 'fitting_ready': False}
    if meta.get('source') != 'webserial' or meta.get('decoder_version') != 3:
        raise ValueError('Unsupported capture source or decoder')
    c = meta.get('calibration') or {}
    image = _hex(c.get('imageHex'), 'calibration')
    digest = hashlib.sha256(image).hexdigest()
    if c.get('source') != 'ecu_read' or c.get('layout') != 'mss54hp-0401-slave-master-64k':
        raise ValueError('Missing ECU-read calibration provenance')
    if len(image) != 65536 or c.get('byteLength') != len(image) or c.get('sha256') != digest:
        raise ValueError('Calibration SHA/length mismatch')
    if not c.get('connectionId') or not c.get('readAt'):
        raise ValueError('Missing calibration read session/time')
    extract_vanos(image)
    previous = -math.inf
    failures = 0
    previous_sample = -math.inf
    for sample in samples:
        t = sample.get('t')
        if not isinstance(t,(int,float)) or not math.isfinite(t) or t < 0 or t <= previous_sample:
            raise ValueError('Nonmonotonic sample time')
        previous_sample = t
        a = sample.get('acquisition') or {}
        if a.get('schemaVersion') != 1 or a.get('calibrationSha256') != digest or a.get('connectionId') != c['connectionId']:
            raise ValueError('Sample calibration/connection differs from recording')
        origin = a.get('timeOriginMs')
        if not isinstance(origin, (int, float)) or not math.isfinite(origin) or origin != meta.get('time_origin_ms'):
            raise ValueError('Capture clock origin mismatch')
        blocks = a.get('blocks')
        if not isinstance(blocks, list) or not blocks:
            raise ValueError('Missing raw block evidence')
        decoded = {}
        seen = set()
        for b in blocks:
            start, end = b.get('requestStartMs'), b.get('responseEndMs')
            if any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in (start,end)) or start < previous or end < start:
                raise ValueError('Nonmonotonic block receipt times')
            previous = end
            block = b.get('block')
            if block not in (3,19,35): raise ValueError('Unknown recorded block')
            if block in seen: raise ValueError('Duplicate block in merged sample')
            seen.add(block)
            request = _hex(b.get('requestHex'), 'request')
            expected = bytes([0x12,5,0x0b,block,0x12 ^ 5 ^ 0x0b ^ block])
            if request != expected: raise ValueError('Block request mismatch')
            echo = _hex(b.get('echoHex'), 'echo')
            response = _hex(b.get('responseHex'), 'response')
            outcome = b.get('outcome')
            if outcome not in ('ok','rejected','error'): raise ValueError('Invalid block outcome')
            if outcome != 'error':
                if echo != request or len(response) < 4 or response[1] != len(response):
                    raise ValueError('Invalid completed response framing')
                checksum = 0
                for byte in response: checksum ^= byte
                if checksum or response[0] != 0x12: raise ValueError('Invalid completed response checksum/address')
                if _hex(b.get('payloadHex'), 'payload') != response[3:-1]: raise ValueError('Payload differs from response')
                if (response[2] == 0xa0) != (outcome == 'ok'): raise ValueError('Outcome/status mismatch')
                if outcome == 'ok':
                    raw = response[3:-1]
                    if len(raw) < {3:35,19:90,35:39}[block]: raise ValueError('Short decoded payload')
                    u=lambda offset: struct.unpack_from('>H',raw,offset)[0]
                    signed=lambda offset: struct.unpack_from('>h',raw,offset)[0]*0.1
                    if block == 3:
                        decoded.update(rpm=u(0),rf=u(8)*0.1,ro=u(20)*100/32768,
                            throttle=signed(27),iat=raw[10]-48,coolant=raw[11]-48,
                            ambientPressure=500+raw[19]*3)
                    elif block == 35:
                        decoded.setdefault('rpm',u(0))
                        decoded.update(evanIst=signed(2),evanSoll=signed(4),avanIst=signed(6),avanSoll=signed(8),map=u(22)/32)
            else:
                failures += 1
        if sample.get('acquisitionFailed'):
            if decoded.get('rpm') is not None: raise ValueError('Failed sample has decoded RPM block')
        for field,value in decoded.items():
            saved=sample.get(field)
            if not isinstance(saved,(int,float)) or not math.isfinite(saved) or not math.isclose(saved,value,rel_tol=1e-12,abs_tol=1e-10):
                raise ValueError(f'Decoded value differs from raw: {field}')
        for field in ('rf','ro','throttle','coolant','iat','ambientPressure','map','evanIst','evanSoll','avanIst','avanSoll'):
            if sample.get(field) is not None and field not in decoded:
                raise ValueError(f'Value without successful source block: {field}')
    return {'status': 'evidence_consistent', 'calibration_sha256': digest, 'raw_error_blocks': failures,
            'fitting_ready': False, 'note': 'Integrity check only; steady visits, holdout and physical reference still required'}

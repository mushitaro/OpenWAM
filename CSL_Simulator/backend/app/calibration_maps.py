"""0401 partial calibration maps. BIN bytes take precedence over cached display values."""
import hashlib
import json
import os
import struct


def extract_vanos(image):
    if len(image) != 65536:
        raise ValueError('Expected MSS54HP 0401 slave/master 65536-byte calibration')
    result = {}
    for key, x, y, table, intake in (
        ('kf_evan1_soll', 0x18D0, 0x18F0, 0x1910, True),
        ('kf_avan1_soll', 0x1BF6, 0x1C16, 0x1C36, False),
    ):
        rpm = list(struct.unpack_from('>16H', image, x))
        load = [v * 100 / 32768 for v in struct.unpack_from('>16H', image, y)]
        if not all(a < b for a, b in zip(rpm, rpm[1:])) or not all(a < b for a, b in zip(load, load[1:])):
            raise ValueError('Calibration axes incompatible with declared 0401 layout')
        raw = struct.unpack_from('256b', image, table)
        values = [70 + v if intake else 128 - v for v in raw]
        result[key] = {'x_axis': rpm, 'y_axis': load, 'values': [values[i:i+16] for i in range(0,256,16)]}
    return result


def maps_for_image(cached, image):
    maps = dict(cached)
    fresh = extract_vanos(image)
    differences = []
    for key, table in fresh.items():
        old = cached.get(key, {})
        if old.get('values') != table['values']:
            differences.append(key)
        maps[key] = table
    maps['vanos_provenance'] = {'source': 'bin', 'sha256': hashlib.sha256(image).hexdigest(),
        'layout': 'mss54hp-0401-slave-master-64k', 'cache_value_mismatches': differences,
        'coordinate': 'display: intake=70+live; exhaust=128-live',
        'physical_cam_datum_verified': False}
    return maps


def load_maps(data_dir):
    with open(os.path.join(data_dir, 'csl_ecu_maps.json'), encoding='utf-8') as f:
        cached = json.load(f)
    path = os.path.join(data_dir, 'uploaded_mss54.bin')
    if os.path.exists(path):
        with open(path, 'rb') as f:
            return maps_for_image(cached, f.read())
    cached['vanos_provenance'] = {'source': 'reference_cache', 'sha256': None,
                                'physical_cam_datum_verified': False}
    return cached

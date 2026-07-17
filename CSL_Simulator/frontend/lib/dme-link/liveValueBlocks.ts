/**
 * DS2 live-measurement block layouts for blocks 3 / 19 / 35 (Stage 76).
 *
 * Byte offsets, formats and scaling are taken VERBATIM from the reference
 * Mss54Ds2Tool DmeLiveValueCatalog.cs (decompiled-source/Core) — the
 * authoritative, hardware-verified catalog. Do not "fix" numbers here without
 * re-checking that file.
 *
 * Field formats mirror DmeLiveValueFieldFormat:
 *   int7   = sign-extended byte        uint8  = byte
 *   uint10 = 2-byte big-endian (10-bit ADC held in 16)   uint16 = 2-byte BE
 *   int15  = sign-extended 2-byte BE
 */
import { LiveSample } from './types';

export type FieldFormat = 'int7' | 'uint8' | 'uint10' | 'int15' | 'uint16';

export interface FieldDef {
    symbol: string;
    offset: number;
    format: FieldFormat;
    scale: number;
    add: number;
}

function F(symbol: string, offset: number, format: FieldFormat, scale = 1.0, add = 0.0): FieldDef {
    return { symbol, offset, format, scale, add };
}

function byteLength(format: FieldFormat): number {
    switch (format) {
        case 'int7': case 'uint8': return 1;
        default: return 2;
    }
}

function readRaw(bytes: Uint8Array, format: FieldFormat): number {
    switch (format) {
        case 'int7': return (bytes[0] << 24) >> 24;                       // sign-extend int8
        case 'uint8': return bytes[0];
        case 'uint10': case 'uint16': return (bytes[0] << 8) | bytes[1];
        case 'int15': return (((bytes[0] << 8) | bytes[1]) << 16) >> 16;  // sign-extend int16
    }
}

export function decodeField(payload: Uint8Array, field: FieldDef): number | null {
    const len = byteLength(field.format);
    if (field.offset < 0 || field.offset + len > payload.length) return null;
    const raw = readRaw(payload.subarray(field.offset, field.offset + len), field.format);
    return field.add + raw * field.scale;
}

// ---------------------------------------------------------------------------
// Block 3 "Standard Measurements" (35 bytes) — DmeLiveValueCatalog lines 47-73
// ---------------------------------------------------------------------------
export const BLOCK3 = {
    selection: 3 as const,
    expectedLength: 35,
    fields: {
        rpm: F('n', 0, 'uint16'),
        ml: F('ml', 4, 'uint16', 0.25),                       // kg/h
        rf: F('rf', 8, 'uint16', 0.1),                        // % relative filling
        iat: F('tan', 10, 'uint8', 1.0, -48),                 // degC
        coolant: F('tmot', 11, 'uint8', 1.0, -48),
        ambientTemp: F('tumg', 15, 'uint8', 1.0, -48),
        battV: F('ub', 16, 'uint8', 0.1),
        ambientPressure: F('pumg', 19, 'uint8', 3.0, 500),    // mbar
        ro: F('aq_rel', 20, 'uint16', 0.46511627906976744),   // % relative opening (map load axis)
        pedal: F('pwg1', 23, 'int15', 0.1),                   // %
        throttle: F('wdk1', 27, 'int15', 0.1),                // %
        throttleTarget: F('edk_soll', 31, 'int15', 0.1),      // %
    },
};

// ---------------------------------------------------------------------------
// Block 19 "Operating Measurements" (90 bytes) — catalog lines 120-170 (subset)
// ---------------------------------------------------------------------------
export const BLOCK19 = {
    selection: 19 as const,
    expectedLength: 90,
    fields: {
        speed: F('v', 0, 'uint16'),                           // km/h
        tz1: F('tz1', 22, 'int15', 0.1),                      // deg KW, ignition actual
        tz2: F('tz2', 24, 'int15', 0.1),
        tz3: F('tz3', 26, 'int15', 0.1),
        tz4: F('tz4', 28, 'int15', 0.1),
        tz5: F('tz5', 30, 'int15', 0.1),
        tz6: F('tz6', 32, 'int15', 0.1),
        stft1: F('la_f_regler1', 40, 'uint16', 3.0517578125e-05),
        stft2: F('la_f_regler2', 42, 'uint16', 3.0517578125e-05),
        frRegler: F('fr_regler', 79, 'uint16', 3.0517578125e-05),
    },
};

// ---------------------------------------------------------------------------
// Block 35 "VANOS/CSL Measurements" (39 bytes) — catalog lines 180-202
// ---------------------------------------------------------------------------
export const BLOCK35 = {
    selection: 35 as const,
    expectedLength: 39,
    fields: {
        rpm35: F('n', 0, 'uint16'),
        evanIst: F('evan1_ist', 2, 'int15', 0.1),             // deg KW spread, actual
        evanSoll: F('evan1_soll', 4, 'int15', 0.1),
        avanIst: F('avan1_ist', 6, 'int15', 0.1),
        avanSoll: F('avan1_soll', 8, 'int15', 0.1),
        evan2Ist: F('evan2_ist', 10, 'int15', 0.1),
        evan2Soll: F('evan2_soll', 12, 'int15', 0.1),
        avan2Ist: F('avan2_ist', 14, 'int15', 0.1),
        avan2Soll: F('avan2_soll', 16, 'int15', 0.1),
        flapPos: F('gks', 18, 'uint16'),                      // CSL snorkel flap (counts)
        map: F('psau_local', 22, 'uint16', 1.0 / 32.0),       // mbar (real sensor)
        drRel: F('dr_rel', 26, 'uint16', 0.0030517578125),    // %
        rfPsau: F('rf_psau', 29, 'uint8', 0.001),             // 0-1
        rfDrrel: F('rf_drrel', 30, 'uint16', 0.001),          // 0-1
    },
};

export type DecodedBlock = Record<string, number | null>;

function decodeBlock(payload: Uint8Array, fields: Record<string, FieldDef>): DecodedBlock {
    const out: DecodedBlock = {};
    for (const [key, def] of Object.entries(fields)) {
        out[key] = decodeField(payload, def);
    }
    return out;
}

export function decodeBlock3(payload: Uint8Array): DecodedBlock { return decodeBlock(payload, BLOCK3.fields); }
export function decodeBlock19(payload: Uint8Array): DecodedBlock { return decodeBlock(payload, BLOCK19.fields); }
export function decodeBlock35(payload: Uint8Array): DecodedBlock { return decodeBlock(payload, BLOCK35.fields); }

/** Merges decoded block records into one LiveSample (t/rpm filled by the caller). */
export function mergeSample(
    t: number,
    b3: DecodedBlock | null,
    b19: DecodedBlock | null,
    b35: DecodedBlock | null,
): LiveSample {
    const num = (v: number | null | undefined): number | undefined => (v == null ? undefined : v);
    const rpm = num(b3?.rpm) ?? num(b35?.rpm35) ?? 0;
    const sample: LiveSample = { t, rpm };
    if (b3) {
        sample.rf = num(b3.rf);
        sample.ml = num(b3.ml);
        sample.iat = num(b3.iat);
        sample.coolant = num(b3.coolant);
        sample.ambientTemp = num(b3.ambientTemp);
        sample.ambientPressure = num(b3.ambientPressure);
        sample.ro = num(b3.ro);
        sample.pedal = num(b3.pedal);
        sample.throttle = num(b3.throttle);
        sample.throttleTarget = num(b3.throttleTarget);
        sample.battV = num(b3.battV);
    }
    if (b19) {
        sample.tz = [b19.tz1, b19.tz2, b19.tz3, b19.tz4, b19.tz5, b19.tz6];
        sample.stft1 = num(b19.stft1);
        sample.stft2 = num(b19.stft2);
        sample.frRegler = num(b19.frRegler);
        sample.speed = num(b19.speed);
    }
    if (b35) {
        sample.evanIst = num(b35.evanIst);
        sample.evanSoll = num(b35.evanSoll);
        sample.avanIst = num(b35.avanIst);
        sample.avanSoll = num(b35.avanSoll);
        sample.evan2Ist = num(b35.evan2Ist);
        sample.evan2Soll = num(b35.evan2Soll);
        sample.avan2Ist = num(b35.avan2Ist);
        sample.avan2Soll = num(b35.avan2Soll);
        sample.map = num(b35.map);
        sample.rfPsau = num(b35.rfPsau);
        sample.rfDrrel = num(b35.rfDrrel);
        sample.drRel = num(b35.drRel);
        sample.flapPos = num(b35.flapPos);
    }
    return sample;
}

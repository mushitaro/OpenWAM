/**
 * BMW DS2 protocol primitives — READ-ONLY subset for telemetry (Stage 76).
 * Ported from E46M3CSL_TuningTool ds2.ts (itself ported from the reference
 * Mss54Ds2Tool: Ds2Frame.cs, Ds2Checksum.cs, Ds2Client.cs,
 * Mss54SeedKeyCalculator.cs). The flash-write/programming machinery is
 * DELIBERATELY not ported: this integration only reads live values and
 * identity; flashing stays in the owner's dedicated tools.
 *
 * Frame layout: [Address][Length][ControlOrStatus][Payload...][XOR checksum]
 * Length counts the whole frame (Address+Length+Control+Payload+Checksum), minimum 4 bytes.
 */

export const DS2_DEFAULT_ADDRESS = 0x12; // MSS54 DME slave address

export const Ds2Control = {
    READ_MEMORY: 0x06,
    READ_IO_STATUS: 0x0B,          // live-measurement block read: payload = [selection]
    READ_SYSTEM_ADDRESSES: 0x0D,
    REQUEST_LOGIN_SEED: 0x90,
    SEND_LOGIN_KEY: 0x90,
    KEEP_ALIVE: 0x9E,
    END_DIAGNOSTIC_MODE: 0x9F,
} as const;

export const Ds2Status = {
    ACKNOWLEDGE: 0xA0,
    BUSY: 0xA1,
    REJECTED: 0xA2,
    PARAMETER_ERROR: 0xB0,
    FUNCTION_ERROR: 0xB1,
    NOT_ACKNOWLEDGE: 0xFF,
} as const;

export function ds2Checksum(bytes: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum ^= bytes[i];
    return sum & 0xFF;
}

export interface Ds2Frame {
    address: number;
    length: number;
    controlOrStatus: number;
    payload: Uint8Array;
    checksum: number;
}

export function buildDs2Frame(address: number, controlByte: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    const length = 4 + payload.length;
    if (length > 255) throw new Error(`DS2 frame too long: ${length} bytes`);
    const frame = new Uint8Array(length);
    frame[0] = address;
    frame[1] = length;
    frame[2] = controlByte;
    frame.set(payload, 3);
    frame[length - 1] = ds2Checksum(frame.subarray(0, length - 1));
    return frame;
}

export function parseDs2Frame(bytes: Uint8Array): Ds2Frame {
    if (bytes.length < 4) throw new Error(`Invalid DS2 frame: ${bytes.length} bytes (minimum 4)`);
    const checksum = bytes[bytes.length - 1];
    const calculated = ds2Checksum(bytes.subarray(0, bytes.length - 1));
    if (checksum !== calculated) {
        throw new Error(`Invalid DS2 checksum: expected 0x${calculated.toString(16)}, got 0x${checksum.toString(16)}`);
    }
    return {
        address: bytes[0],
        length: bytes[1],
        controlOrStatus: bytes[2],
        payload: bytes.subarray(3, bytes.length - 1),
        checksum,
    };
}

export function isPositiveResponse(frame: Ds2Frame): boolean {
    return frame.controlOrStatus === Ds2Status.ACKNOWLEDGE;
}

/** Reconstructs the raw frame bytes from a parsed frame (needed by the seed/key computation). */
export function frameToBytes(frame: Ds2Frame): Uint8Array {
    const bytes = new Uint8Array(frame.length);
    bytes[0] = frame.address;
    bytes[1] = frame.length;
    bytes[2] = frame.controlOrStatus;
    bytes.set(frame.payload, 3);
    bytes[frame.length - 1] = frame.checksum;
    return bytes;
}

/**
 * Seed/key login algorithm, ported exactly from Mss54SeedKeyCalculator.CalculateKey.
 * seedFrame must be a 46-byte positive response to a REQUEST_LOGIN_SEED request.
 */
export function calculateLoginKey(accessLevel: number, seedFrameBytes: Uint8Array): number {
    if (seedFrameBytes.length !== 46) {
        throw new Error(`Expected a 46-byte seed response, got ${seedFrameBytes.length} bytes`);
    }
    let key = 0;
    for (let i = 0; i < 4; i++) {
        const idx = (accessLevel + i) % seedFrameBytes[1];
        const term = seedFrameBytes[idx] + seedFrameBytes[18 + i] + seedFrameBytes[41 + i];
        key = ((key << 8) | (term & 0xFF)) >>> 0;
    }
    return key;
}

export function buildSeedRequestPayload(accessLevel: number = 5): Uint8Array {
    // ASCII "BMW" + access level byte
    return new Uint8Array([0x42, 0x4D, 0x57, accessLevel]);
}

export function buildKeyPayload(key: number): Uint8Array {
    return new Uint8Array([(key >>> 24) & 0xFF, (key >>> 16) & 0xFF, (key >>> 8) & 0xFF, key & 0xFF]);
}

/** A positive login response of length 5 means the session was already unlocked (no seed needed). */
export function isAlreadyUnlockedResponse(frame: Ds2Frame): boolean {
    return isPositiveResponse(frame) && frame.length === 5;
}

/** A positive login response of length 46 is a genuine seed to compute a key from. */
export function isSeedResponse(frame: Ds2Frame): boolean {
    return isPositiveResponse(frame) && frame.length === 46;
}

export function buildReadMemoryPayload(segment: number, address24: number, count: number): Uint8Array {
    return new Uint8Array([segment, (address24 >>> 16) & 0xFF, (address24 >>> 8) & 0xFF, address24 & 0xFF, count]);
}

/** Read addressing constants (identity reads only — no write segments here). */
export const Ds2ReadLayout = {
    readSegment: 0,   // Ds2MemoryReader.LinearProgrammingSegment
    chunkSize: 122,
} as const;

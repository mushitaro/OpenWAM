/**
 * BMW DS2 protocol primitives (Stage 76; VANOS actuator control added Stage 121).
 * Ported from E46M3CSL_TuningTool ds2.ts (itself ported from the reference
 * Mss54Ds2Tool: Ds2Frame.cs, Ds2Checksum.cs, Ds2Client.cs,
 * Mss54SeedKeyCalculator.cs).
 *
 * WHAT THIS CAN WRITE, and what it still cannot:
 *   - SET_IO_STATUS (0x0C) for the two VANOS target pins, so a cam sweep can
 *     command an angle while the engine runs. This is VOLATILE: the DME reverts
 *     to map control on the next background cycle once the diagnostic session
 *     lapses, which is also the documented abort (stop the keep-alive).
 *   - Nothing else. The flash-write / programming machinery is DELIBERATELY not
 *     ported; flashing stays in the owner's dedicated tools.
 *
 * Frame layout: [Address][Length][ControlOrStatus][Payload...][XOR checksum]
 * Length counts the whole frame (Address+Length+Control+Payload+Checksum), minimum 4 bytes.
 */

export const DS2_DEFAULT_ADDRESS = 0x12; // MSS54 DME slave address

export const Ds2Control = {
    READ_MEMORY: 0x06,
    READ_IO_STATUS: 0x0B,          // live-measurement block read: payload = [selection]
    SET_IO_STATUS: 0x0C,           // actuator control ("Steuern"): payload = [pin, value, period]
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

/* ---------------------------------------------------------------------------
 * VANOS target override (DS2 0x0C)
 *
 * Established by disassembly of the MSS54HP '0401' firmware
 * (CSL_0401_Binary_Disassembly_Notes/docs/vanos_ds2_target_override.md):
 * the accept gate reads only ZUSTAND_MOTOR & 0x1C (idle | part load | full
 * load) and the VANOS hydraulic-readiness bit. There is NO road-speed and NO
 * engine-speed check, so an angle can be commanded while driving. The
 * "must be stationary" rule found in diagnostic tools is the client's, not the
 * DME's.
 *
 * The commanded byte is a SIGNED whole degree KW; the firmware multiplies by 10
 * into its internal 0.1 degKW units. Note this is the plain live angle — NOT the
 * map-table encoding (intake +70 / exhaust 128−x).
 * ------------------------------------------------------------------------- */

/** Actuator pins for the two bank-1 VANOS targets. */
export const VanosPin = {
    INTAKE: 0x07,
    EXHAUST: 0x0A,
} as const;
export type VanosPinValue = (typeof VanosPin)[keyof typeof VanosPin];

/**
 * The only clamp the firmware still applies on this path. Every OTHER limiter
 * (K_EVAN1_SOLL_MIN/MAX, the rpm-dependent KL_EVAN_SOLL_BEGR) is bypassed by the
 * override, so callers must impose their own window — see SWEEP_LIMITS.
 */
export const VANOS_CMD_MIN_DEG = -20;
export const VANOS_CMD_MAX_DEG = 80;

/**
 * What the cams can actually hold AND what the map can store afterwards. A sweep
 * must stay inside this or it can find an optimum that cannot be written back.
 */
export const VANOS_STORABLE = {
    intake: { min: 0, max: 60 },
    exhaust: { min: 0, max: 45 },
} as const;

/** payload = [pin, signed angle byte, period]. `period` is unused on this path. */
export function buildVanosTargetPayload(pin: VanosPinValue, angleDegKw: number): Uint8Array {
    if (!Number.isFinite(angleDegKw)) {
        throw new Error(`VANOS angle must be a finite number, got ${angleDegKw}`);
    }
    const angle = Math.round(angleDegKw);
    if (angle < VANOS_CMD_MIN_DEG || angle > VANOS_CMD_MAX_DEG) {
        throw new Error(
            `VANOS angle ${angle}degKW is outside the DME's accept range `
            + `${VANOS_CMD_MIN_DEG}..${VANOS_CMD_MAX_DEG}`);
    }
    return new Uint8Array([pin, angle & 0xFF, 0x00]);
}

/** I/O-control feedback, returned as payload[1] of the 0x0C response. */
export const VanosAckCode = {
    ACCEPTED: 0,
    ABOVE_MAX: 2,
    BELOW_MIN: 3,
    CONDITIONS_NOT_MET: 4,
} as const;

export interface VanosAck {
    code: number;
    accepted: boolean;
    /** Whether retrying the same command could ever succeed. */
    retryable: false;
    /** User-facing Japanese explanation — shown verbatim in the sweep UI. */
    message: string;
}

/**
 * Classify the ack. Every non-zero code is a SEMANTIC refusal: the DME
 * understood the frame and declined it, so re-sending it unchanged will be
 * declined again. Only transport faults (timeout, echo mismatch) are worth a
 * retry, and those never reach here.
 */
export function describeVanosAck(code: number): VanosAck {
    switch (code) {
        case VanosAckCode.ACCEPTED:
            return { code, accepted: true, retryable: false, message: 'VANOS 目標を受理しました。' };
        case VanosAckCode.ABOVE_MAX:
            return {
                code, accepted: false, retryable: false,
                message: `指令angle が上限 +${VANOS_CMD_MAX_DEG}°KW を超えています。`,
            };
        case VanosAckCode.BELOW_MIN:
            return {
                code, accepted: false, retryable: false,
                message: `指令angle が下限 ${VANOS_CMD_MIN_DEG}°KW を下回っています。`,
            };
        case VanosAckCode.CONDITIONS_NOT_MET:
            return {
                code, accepted: false, retryable: false,
                message: 'DME が作動条件を満たしていません。エンジンが回っていること、'
                    + '油温・水温が上がっていること、VANOS 学習が実行中でないことを確認してください。',
            };
        default:
            return {
                code, accepted: false, retryable: false,
                message: `DME から未知の応答コード ${code} が返りました。`,
            };
    }
}

/** Read addressing constants (identity reads only — no write segments here). */
export const Ds2ReadLayout = {
    readSegment: 0,   // Ds2MemoryReader.LinearProgrammingSegment
    chunkSize: 122,
} as const;

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
    WRITE_MEMORY: 0x07,            // also carries every programming control (erase/finalize)
    QUERY_ENCODING_CHECKSUM: 0x0A,
    READ_IO_STATUS: 0x0B,          // live-measurement block read: payload = [selection]
    SET_IO_STATUS: 0x0C,           // actuator control ("Steuern"): payload = [pin, value, period]
    READ_SYSTEM_ADDRESSES: 0x0D,
    REQUEST_LOGIN_SEED: 0x90,
    SEND_LOGIN_KEY: 0x90,
    /**
     * Clear adaptations. Payload is [mask1] when mask2 is 0, else [mask1, mask2].
     *
     * OVERLOADED: payload `00 01` is not a clear at all — it starts VANOS diagnostic idle mode
     * (reference Ds2Client.StartVanosDiagnosticIdleModeAsync). Setting mask2 bit 0 on a running
     * engine would trip that mode instead of clearing anything, which is why ClearAll is 0xF7/0x32
     * and not 0xFF/0x33. buildClearAdaptationsPayload enforces this.
     */
    CLEAR_ADAPTATIONS: 0x43,
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

/** Read addressing constants (identity reads). Kept as the name the telemetry path already uses;
 *  the calibration read/write path takes its geometry from Mss54HpDataTuneLayout below. */
export const Ds2ReadLayout = {
    readSegment: 0,   // Ds2MemoryReader.LinearProgrammingSegment
    chunkSize: 122,
} as const;


/* ===========================================================================
 * CALIBRATION READ / WRITE  (Stage 122 - preparation flash)
 *
 * Ported from E46M3CSL_TuningTool/src/lib/dme-link/ds2.ts, VERBATIM between the
 * BEGIN/END markers below. `npm run check:ported` asserts every marked block is
 * byte-identical to the tuner's, so a divergence fails the build instead of
 * being noticed on a car. Do not edit inside a marked block.
 *
 * Deliberately NOT ported: the baud-switch specs (0x91). This link reads and
 * writes at 9600 only. The tuner's own note calls 9600 "the proven path" and
 * places the boost at the single most expensive instant to lose the link - after
 * the erase, with the data area already gone. A prep flash runs once, parked;
 * ~2.5 min at 9600 buys the removal of that whole failure mode.
 * ======================================================================== */

// --- BEGIN VERBATIM buildWriteMemoryPayload ---
export function buildWriteMemoryPayload(segment: number, address24: number, data: Uint8Array): Uint8Array {
    if (data.length > 123) throw new Error(`DS2 memory write count must be 123 bytes or less, got ${data.length}`);
    const payload = new Uint8Array(5 + data.length);
    payload[0] = segment;
    payload[1] = (address24 >>> 16) & 0xFF;
    payload[2] = (address24 >>> 8) & 0xFF;
    payload[3] = address24 & 0xFF;
    payload[4] = data.length;
    payload.set(data, 5);
    return payload;
}

// --- END VERBATIM buildWriteMemoryPayload ---

// --- BEGIN VERBATIM adaptationClear ---
/**
 * Adaptation clear mask bits (control 0x43), from the reference AdaptationClearOptions. The DME
 * clears every category whose bit is set; the reference's "Clear All" is the bitwise OR of all of
 * them (0xF7 / 0x32).
 */
export const Ds2AdaptationMask1 = {
    IDLE_FUEL: 0x01,
    KNOCK: 0x02,
    LAMBDA: 0x04,
    PEDAL: 0x10,
    THROTTLE_EGAS: 0x20,
    VANOS: 0x40,
    SMG: 0x80,
} as const;

export const Ds2AdaptationMask2 = {
    /** Bit 0 (0x01) is deliberately absent: `00 01` is the VANOS diagnostic overload, not a clear
     *  bit. See Ds2Control.CLEAR_ADAPTATIONS. */
    MISFIRE_OBSERVATION: 0x02,
    CRANK_IDLE_SYNC: 0x10,
    DETECTED_EQUIPMENT: 0x20,
} as const;

/**
 * What a re-tune needs zeroed so the next log is captured from a known base: lambda trim, knock, and
 * the idle/fuel demand values.
 *
 * Deliberately NOT the reference's "Clear All" (0xF7 / 0x32), which also wipes throttle/pedal/EGAS,
 * SMG, detected-equipment and crank-wheel adaptations. Those are irrelevant to a tune and expensive
 * to lose: the CSL is SMG-II only, so clearing SMG adaptation forces a clutch re-adaptation
 * procedure.
 *
 * **VANOS left this mask on 2026-08-15** (was 0x47). karter16, thread 242281 #161: "There's nothing
 * in this tuning process that impacts them, and it's probably just a distraction to reset them and
 * force the DME to re-learn them. I'd suggest dropping this and removing one more potential variable
 * in the process." The stronger form of that argument is the reason it went: the re-learn moves cam
 * phase, cam phase moves filling, and filling is the quantity the log exists to measure — so
 * clearing VANOS does not merely fail to help, it perturbs the measurement. The two VANOS rows are
 * still *read* and still shown; see adaptationBlocks.ts.
 *
 * Everything this clears is shown in the reset dialog first, with one exception that predates this
 * change: IDLE_FUEL (bit 0) has no display row in either block, so four values are cleared that the
 * dialog never lists. That is a real gap, recorded here rather than papered over — the old comment
 * claimed this mask was "exactly the twelve values the reset dialog shows", which was never true.
 */
export const TUNE_ADAPTATION_CLEAR = {
    mask1: Ds2AdaptationMask1.IDLE_FUEL | Ds2AdaptationMask1.KNOCK
        | Ds2AdaptationMask1.LAMBDA,   // 0x07
    mask2: 0,
} as const;

/**
 * VANOS adaptation, on its own, for the one workflow that genuinely needs it gone.
 *
 * The max-power cam sweep drives VANOS targets over DS2 control 0x0C and requires a clean adaptation
 * state — a learned offset shifts the actual cam position away from the commanded one, which
 * corrupts the whole sweep (docs/ecu-logic/70-max-power-methodology.md). Until now the tune reset
 * supplied that as a side effect; removing VANOS from it would have quietly removed a documented
 * prerequisite.
 *
 * A second constant rather than a mask parameter, for the same reason clearTuneAdaptations() takes
 * none (see DmeLink): which adaptations a tuning tool may clear is a product decision, and there are
 * now two such decisions — not an open door.
 */
export const VANOS_ADAPTATION_CLEAR = {
    mask1: Ds2AdaptationMask1.VANOS,   // 0x40
    mask2: 0,
} as const;

/**
 * Builds a control-0x43 payload. Variable length, matching the reference: one byte when mask2 is 0,
 * two otherwise — the DME reads the payload length, so padding a zero mask2 is not the same request.
 */
export function buildClearAdaptationsPayload(mask1: number, mask2: number): Uint8Array {
    if (mask1 === 0 && mask2 === 0) {
        throw new Error('At least one adaptation clear mask bit must be set');
    }
    // The reference's own guard only rejects all-zero masks, so `00 01` slips through it and reaches
    // the DME as "start VANOS diagnostic idle mode". Reject it here instead: no clear needs this bit.
    if (mask2 & 0x01) {
        throw new Error('mask2 bit 0 is the VANOS diagnostic idle-mode overload (payload 00 01), not a clear bit');
    }
    return mask2 === 0 ? new Uint8Array([mask1]) : new Uint8Array([mask1, mask2]);
}
// --- END VERBATIM adaptationClear ---

// --- BEGIN VERBATIM Ds2ProgrammingControl ---
export const Ds2ProgrammingControl = {
    WriteSegment: 2,
    EraseSegment: 6,
    /** Recycling control segment — carries the recycle-only / recycle-off addresses below. */
    RecyclingSegment: 14,
    FinishSegment: 15,
    /**
     * Address sent with the data-area erase (segment 6) and the pre-clean (segment 15).
     *
     * NOTE a deliberate divergence from the reference: Ds2ProgrammingControl.cs uses 10502144,
     * which is 0xA04000 — not the 0xA02000 below. Both land inside the same slave DataBlock
     * subsegment (nibble 0xA) and differ only in the offset within it, and 0xA02000 is what this
     * app has actually flashed a real vehicle with, read-back verification included. Since a
     * skipped erase cannot survive that verification — NOR flash can only clear bits, so writing
     * into un-erased cells mismatches, and the DME would have answered verify byte 3 ("cells were
     * not erased") on the first chunk anyway — the proven value stays. Don't "fix" it to match the
     * reference without re-proving it on a car.
     */
    DataProgrammingSessionAddress: 0xA02000,
    /** ASCII "BAQ" — enter recycle-only mode before erasing the service block. */
    RecycleOnlyAddress: 0x424151,
    /** ASCII "BAR" — leave recycle mode once the service block has been rewritten. */
    RecycleOffAddress: 0x424152,
} as const;
// --- END VERBATIM Ds2ProgrammingControl ---

// --- BEGIN VERBATIM writeResult ---
/** Parsed DS2 write/programming response: [segment, addrHi, addrMid, addrLo, writtenCount, verifyByte]. */
export interface Ds2WriteResult {
    segment: number;
    nextAddress24: number;
    writtenCount: number;
    verifyByte: number;
}

/**
 * Parses a positive write/programming response payload. Some control responses (prepare/erase/
 * finalize) legitimately return an empty payload — this returns null in that case. A non-empty
 * payload shorter than 6 bytes is a protocol error.
 * Ported from Ds2MemoryWriteResult.FromPositiveResponse.
 */
export function parseWriteResult(frame: Ds2Frame): Ds2WriteResult | null {
    if (frame.payload.length === 0) return null;
    if (frame.payload.length < 6) {
        throw new Error(`DS2 write response payload is ${frame.payload.length} byte(s), expected 0 or at least 6`);
    }
    const p = frame.payload;
    return {
        segment: p[0],
        nextAddress24: (p[1] << 16) | (p[2] << 8) | p[3],
        writtenCount: p[4],
        verifyByte: p[5],
    };
}

/** Human-readable meaning of a DME programming verify byte (Ds2MemoryWriteResult.DescribeVerifyByte). */
export function describeVerifyByte(verifyByte: number): string {
    switch (verifyByte) {
        case 1: return 'programming OK';
        case 2: return 'verify failed';
        case 3: return 'cells were not erased before programming attempt';
        case 4: return 'copying/backing up AIF not possible';
        case 5: return 'copying/backing up ZIF not possible';
        case 6: return 'boot-mode field management error; programming not possible';
        case 7: return 'program programming session active';
        case 8: return 'data programming session active';
        case 9: return 'hardware reference implausible';
        case 10: return 'program reference implausible';
        case 11: return 'program and hardware references do not match';
        case 12: return 'program incomplete';
        case 13: return 'data reference implausible';
        case 14: return 'program and data references do not match';
        case 15: return 'data incomplete';
        default: return `unknown verify byte 0x${verifyByte.toString(16)}`;
    }
}
// --- END VERBATIM writeResult ---

// --- BEGIN VERBATIM encodingChecksum ---
// checksum/dmeDataChecksum.ts — two slots covering 65528 of the data pair's 65536 bytes). This asks
// the DME whether its own stored CRCs match its own contents. So it is an external authority on the
// bytes rather than a second copy of our read path — a systematic transport fault corrupts a
// read-back and a re-read identically, and cannot forge a CRC the ECU computed for itself. What it
// cannot do is say WHERE a mismatch is, or catch a corruption that happens to preserve CRC-16.

export interface Ds2EncodingChecksumArea {
    bit: number;
    name: string;
    /** **A SET BIT MEANS FAULTED.** The polarity is the easy thing to get backwards, and getting it
     *  backwards turns this check into one that passes on a broken flash and fails on a good one. */
    faulted: boolean;
}

export interface Ds2EncodingChecksum {
    /** The raw status byte, kept so a report can carry what the DME actually said. */
    lowByte: number;
    /** Some DMEs answer with a second byte. The reference accepts 1 or 2 and decodes only the first;
     *  it is retained rather than dropped so an unexpected value is visible in a saved report. */
    extraByte: number | null;
    areas: Ds2EncodingChecksumArea[];
}

/** Bit → area, exactly the reference's table. Bits 3 and 7 are not assigned by it. */
const ENCODING_CHECKSUM_AREAS: readonly { bit: number; name: string }[] = [
    { bit: 0, name: 'Boot sector master' },
    { bit: 1, name: 'Program master' },
    { bit: 2, name: 'Data master' },
    { bit: 4, name: 'Boot sector slave' },
    { bit: 5, name: 'Program slave' },
    { bit: 6, name: 'Data slave' },
];

/**
 * The two areas a DataTune write touches, and therefore the only two a tune's QuickVerify may judge.
 *
 * Matches the reference's `DataChecksumBits = { 2, 6 }`. Deliberately not "all areas must be clean":
 * a program-area fault is a real fact about the ECU but it is not something this write caused or
 * could fix, and failing a good tune write on it would be wrong. It is reported, not thrown on.
 */
export const DATA_TUNE_CHECKSUM_BITS: readonly number[] = [2, 6];

export function parseEncodingChecksum(frame: Ds2Frame): Ds2EncodingChecksum {
    if (!isPositiveResponse(frame)) {
        throw new Error(`Encoding checksum query answered DS2 status 0x${frame.controlOrStatus.toString(16)}`);
    }
    if (frame.payload.length < 1 || frame.payload.length > 2) {
        throw new Error(`Encoding checksum payload must be 1 or 2 bytes, got ${frame.payload.length}`);
    }
    const lowByte = frame.payload[0];
    return {
        lowByte,
        extraByte: frame.payload.length === 2 ? frame.payload[1] : null,
        areas: ENCODING_CHECKSUM_AREAS.map(a => ({ ...a, faulted: (lowByte & (1 << a.bit)) !== 0 })),
    };
}

/** The faulted areas among `bits`. Empty means those areas are clean by the DME's own reckoning. */
export function faultedAreas(result: Ds2EncodingChecksum, bits: readonly number[]): Ds2EncodingChecksumArea[] {
    return result.areas.filter(a => bits.includes(a.bit) && a.faulted);
}
// --- END VERBATIM encodingChecksum ---

// --- BEGIN VERBATIM dataTuneLayout ---

/**
 * DS2 addressing for the MSS54HP "DataTune" region (our app's 65536-byte "0401 partial BIN" =
 * Slave data block followed by Master data block), confirmed against the reference
 * Mss54Ds2Tool source (DmeBinaryLayout.cs, Ds2ProgrammingSubsegment.cs, Ds2MemoryReader.cs,
 * Ds2MemoryProgrammer.cs, Ds2ProgrammingControl.cs).
 */
export const Mss54HpDataTuneLayout = {
    readSegment: 0, // Ds2MemoryReader.LinearProgrammingSegment — used for all Ds2MemoryBlock reads
    writeSegment: Ds2ProgrammingControl.WriteSegment,
    slave: { address: 0xA00000, length: 32768 },
    master: { address: 0x200000, length: 32768 },
    /**
     * Bytes per read telegram. Deliberately SEPARATE from writeChunkSize even though both are 122
     * today, because they are bounded by different things and only one of them can ever grow.
     *
     * A read is bounded by DS2 framing alone: buildDs2Frame caps a frame at 255 bytes and a read
     * response is [addr][len][status][N][cksum], so N <= 251. 122 is not a protocol limit — it is the
     * reference tool's undocumented default, and BMW's own SGBD job FLASH_LESEN uses 120. The DME
     * publishes its real maximum in the system address table (see SYSTEM_ADDRESS_INDEX.MAX_TELEGRAM).
     *
     * They shared one constant until 2026-07-29. That is a latent brick: writePartialBinInner erases
     * before it writes, and the only thing stopping an over-long write is a runtime throw inside
     * buildWriteMemoryPayload — which would fire on the first chunk, i.e. on an already-erased ECU.
     */
    readChunkSize: 122,
    /**
     * Bytes per write telegram. **122 is already the maximum legal value and cannot be raised.**
     * The DS2 write count caps at 123 (buildWriteMemoryPayload), and flash programming needs an even
     * length at an even address — so 122 is the largest even value that fits. Splitting the constants
     * therefore costs the write path nothing; it only removes the coupling.
     */
    writeChunkSize: 122,
} as const;

/**
 * Load-time invariant on the write chunk. This exists to turn a mid-flash throw — the failure mode
 * that lands on a half-erased ECU — into an import-time failure that cannot reach a car.
 *
 * Runs at module scope on purpose: `npm run build` prerenders, so a bad constant fails the build.
 */
(function assertWriteChunkIsFlashSafe() {
    const { writeChunkSize, slave, master } = Mss54HpDataTuneLayout;
    if (writeChunkSize > 123) {
        throw new Error(`Mss54HpDataTuneLayout.writeChunkSize ${writeChunkSize} exceeds the DS2 write cap of 123`);
    }
    if (writeChunkSize <= 0 || writeChunkSize % 2 !== 0) {
        throw new Error(`Mss54HpDataTuneLayout.writeChunkSize ${writeChunkSize} must be positive and even (flash writes are even-aligned)`);
    }
    // An even chunk size only keeps every write even-aligned if the block base is even too.
    for (const [name, block] of [['slave', slave], ['master', master]] as const) {
        if (block.address % 2 !== 0) {
            throw new Error(`Mss54HpDataTuneLayout.${name}.address 0x${block.address.toString(16)} must be even`);
        }
    }
})();
// --- END VERBATIM dataTuneLayout ---

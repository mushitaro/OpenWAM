import type { VanosAck, VanosPinValue } from './ds2';
import type { AdaptationSnapshot } from './adaptationBlocks';

export type { AdaptationSnapshot };
// DS2 link types. Ported/adapted from E46M3CSL_TuningTool (same owner project).
//
// Stage 76 was telemetry-only and this header said flashing stays in the owner's
// existing tools. Stage 122 ported the erase-and-rewrite path here too, at the
// owner's explicit instruction, so the preparation a sweep needs and the sweep
// itself are one app in the car. The tuner remains READ ONLY as a source: every
// flash-critical block is copied, never edited, and `npm run check:ported`
// asserts that byte for byte.

export interface DmeIdentity {
    vin: string;
    aif: string;
    softwareVersion: string;
}

/**
 * One merged telemetry sample. Field availability depends on which DS2 blocks
 * were polled (3 = Standard, 19 = Operating, 35 = VANOS/CSL); absent blocks
 * leave their fields undefined. Units follow DmeLiveValueCatalog exactly.
 */
export interface LiveSample {
    t: number;                 // s since recording start (host clock)
    rpm: number;               // block 3 n (also cross-checked by block 35 n)

    // --- block 3 "Standard Measurements" ---
    rf?: number;               // relative filling %  (the DME's own fill estimate)
    ml?: number;               // total air mass kg/h (model-derived on the MAF-less CSL)
    iat?: number;              // tan, intake air temp degC
    coolant?: number;          // tmot degC
    oil?: number;              // toel degC (VANOS readiness precondition)
    exhaustTemp?: number;      // tabg degC, 16 degC/LSB (the sweep's only thermal guard)
    ambientTemp?: number;      // tumg degC (CAN)
    ambientPressure?: number;  // pumg mbar
    ro?: number;               // aq_rel, relative opening cross-section % (THE map load axis)
    pedal?: number;            // pwg1 %
    throttle?: number;         // wdk1 %
    throttleTarget?: number;   // edk_soll %
    battV?: number;            // ub V

    // --- block 19 "Operating Measurements" ---
    tz?: (number | null)[];    // tz1..tz6 ignition angle actual, deg KW (knock-retard proxy)
    stft1?: number;            // la_f_regler1 (lambda controller factor, ~1.0 neutral)
    stft2?: number;
    frRegler?: number;         // filling controller factor
    speed?: number;            // v km/h

    // --- block 35 "VANOS/CSL Measurements" ---
    evanIst?: number;          // intake VANOS bank1 actual, deg KW (spread)
    evanSoll?: number;         // intake VANOS bank1 target
    avanIst?: number;          // exhaust VANOS bank1 actual
    avanSoll?: number;         // exhaust VANOS bank1 target
    evan2Ist?: number;
    evan2Soll?: number;
    avan2Ist?: number;
    avan2Soll?: number;
    map?: number;              // psau_local, manifold absolute pressure mbar (real sensor)
    rfPsau?: number;           // relative filling from MAP sensor (0-1)
    rfDrrel?: number;          // relative filling from Alpha-N (0-1)
    drRel?: number;            // relative throttle %
    flapPos?: number;          // gks CSL snorkel flap position (raw counts)

    // --- sweep bookkeeping (not from the DME) ---
    /** Cam angle this sample was recorded under; null = no override (baseline).
     *  Stamped by the poll loop so a saved log is analysable on its own. */
    cmdIntake?: number | null;
    cmdExhaust?: number | null;
    /** True while a cam is being ramped to a new target. Those samples sit at
     *  whatever intermediate angle the ramp had reached, which is NOT a setting
     *  anyone chose to measure — counting them would put ghost columns on the
     *  coverage board and ask the driver for more pulls at angles they never
     *  selected. */
    cmdTransient?: boolean;
}

/** Block selections this app knows how to decode. */
export type LiveBlockSelection = 3 | 19 | 35;

/** Abstraction the Live tab depends on; implemented by WebSerialDmeLink (real
 *  K-line hardware) and MockDmeLink (synthetic drive cycle for development). */
export interface DmeTelemetryLink {
    connect(): Promise<DmeIdentity>;
    disconnect(): Promise<void>;
    /** Polls the given blocks once (one DS2 round-trip each) and merges the sample. */
    pollSample(blocks: LiveBlockSelection[]): Promise<LiveSample>;
    /** Resets the sample clock (t=0) — call when a recording starts. */
    resetClock(): void;

    /* --- optional control surface (Stage 121) -----------------------------
     * Present on WebSerialDmeLink and MockDmeLink. Declared optional so a
     * read-only link is still a valid DmeTelemetryLink, and so the sweep UI can
     * ask `supportsVanosControl(link)` instead of testing for a concrete class. */

    /**
     * Command one VANOS bank to an absolute LIVE cam angle (signed whole degKW;
     * intake 0..60, exhaust 0..45 are what the map can store afterwards).
     * Resolves with the DME's verdict — a refusal is a value, not an exception,
     * because every refusal here is semantic and re-sending cannot fix it.
     * Rejects only on transport faults, which ARE worth retrying.
     */
    setVanosTarget?(pin: VanosPinValue, angleDegKw: number): Promise<VanosAck>;

    /**
     * Tester-present. Holds the diagnostic session open, which is the only thing
     * keeping a commanded target from reverting to map control. Best effort:
     * never throws, and skips rather than queues when the line is busy.
     */
    keepAlive?(): Promise<boolean>;

    /* --- preflight surface (Stage 122) ------------------------------------
     * The 事前準備 panel. Optional for the same reason the control surface is:
     * a read-only link stays a valid DmeTelemetryLink. */

    /** Reads a run of calibration bytes addressed by BIN offset (0..65535). Read-only. */
    readCalibrationBytes?(binOffset: number, length: number): Promise<Uint8Array>;
    /** Reads the whole 65536-byte DataTune image. Read-only, ~123 s at 9600. */
    readCalibration?(onProgress?: (pct: number) => void): Promise<Uint8Array>;
    /**
     * Erases and rewrites all 65536 bytes, then reads every byte back to prove it.
     *
     * `onBackup` receives what is currently in the ECU BEFORE any erase and is awaited: rejecting
     * it means no erase is sent. The ordering belongs to the implementation, not the caller,
     * because that is the layer that issues the erase.
     */
    writeCalibration?(opts: {
        image: Uint8Array;
        /** What is in the ECU now, if already read — saves a second ~123 s pass. */
        backup?: Uint8Array;
        onBackup: (currentImage: Uint8Array) => Promise<void>;
        onProgress?: (pct: number, phase: 'backup' | 'erase' | 'write' | 'verify') => void;
    }): Promise<void>;
    /** Clears VANOS adaptation — a learned offset makes every commanded angle a different real one. */
    clearVanosAdaptations?(): Promise<AdaptationSnapshot>;
    /** Clears lambda-trim / knock / idle-fuel adaptation (the tuner's RESET ADAPT). Not VANOS. */
    clearTuneAdaptations?(): Promise<AdaptationSnapshot>;
    /** Engine speed alone — "is this engine turning?", which gates every programming operation. */
    readEngineRpm?(): Promise<number>;
}

/** Narrow a link to one that can drive the cams. */
export function supportsVanosControl(
    link: DmeTelemetryLink,
): link is DmeTelemetryLink & Required<Pick<DmeTelemetryLink, 'setVanosTarget' | 'keepAlive'>> {
    return typeof link.setVanosTarget === 'function' && typeof link.keepAlive === 'function';
}

/** The six calls the 事前準備 panel needs. All or nothing: a panel that could read but not clear
 *  would show a verdict with no way to act on it. */
export type PreflightCapableLink = DmeTelemetryLink & Required<Pick<DmeTelemetryLink,
    'readCalibrationBytes' | 'readCalibration' | 'writeCalibration'
    | 'clearVanosAdaptations' | 'clearTuneAdaptations' | 'readEngineRpm'>>;

export function supportsPreflight(link: DmeTelemetryLink): link is PreflightCapableLink {
    return typeof link.readCalibrationBytes === 'function'
        && typeof link.readCalibration === 'function'
        && typeof link.writeCalibration === 'function'
        && typeof link.clearVanosAdaptations === 'function'
        && typeof link.clearTuneAdaptations === 'function'
        && typeof link.readEngineRpm === 'function';
}

export class DmeLinkError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'DmeLinkError';
    }
}

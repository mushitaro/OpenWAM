// DS2 live-telemetry types (Stage 76). Ported/adapted from E46M3CSL_TuningTool
// (same owner project) — telemetry-only: this integration READS the DME; all
// flashing stays in the owner's existing tools.

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
}

export class DmeLinkError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'DmeLinkError';
    }
}

/**
 * Sweep thresholds — one definition, shared by the live panel and the verdict.
 *
 * These numbers are the experiment. They are stated once here so the coverage
 * board cannot promise a cell is done on a looser rule than the fit applies, and
 * so the Python analyser (CSL_Simulator/backend/scripts/analyze_vanos_sweep.py)
 * has one place to agree with. `lib/sweep/__fixtures__/gates.json` pins them for
 * the cross-implementation test.
 */

export interface SweepDefaults {
    /** Arrival gate: |ist − soll| must be within this before a sample counts.
     *  A sample taken while the cam is still travelling is not a measurement of
     *  the commanded angle — it is a measurement of somewhere in between. */
    arrivalTolDeg: number;
    /** Both banks are gated, not just the one being swept: the other cam moving
     *  changes the breathing just as much. */
    arrivalTolDegOtherBank: number;

    /** WOT gate. Pedal is preferred; wdk1 is the fallback when block 3 is
     *  polled sparsely and pedal is absent from a given sample. */
    pedalMinPct: number;
    wdkMinPct: number;
    /** How long a block-3 reading stays representative when forward-filled.
     *  Older than this and the sample is rejected rather than assumed to be at
     *  WOT — an off-throttle sample counted as WOT poisons the mean silently. */
    throttleFillMaxMs: number;

    /** Steady-state: rate of change over the settle window. */
    settleSec: number;
    maxRpmDriftPctPerSettle: number;
    maxThrottleDriftPct: number;

    /** Engine readiness, mirroring the DME's own VANOS preconditions. */
    minCoolantC: number;
    minOilC: number;

    /** The lambda integrator is the observable, so it must be free to move: a
     *  reading against its clamp is not a measurement of anything. */
    lambdaClampLow: number;
    lambdaClampHigh: number;

    /** Analysis band. Below this the pull has not settled after the shift. */
    analysisMinRpm: number;
    rpmBinWidth: number;

    /** Evidence gates, both required (the tuner's two-part rule): samples alone
     *  can be many and weightless, weight alone can come from one long dwell. */
    minSamplesPerCell: number;
    minVisitsPerCell: number;
    /** A gap longer than this starts a new visit. */
    visitGapMs: number;

    /** How far outside the swept angles a vertex may still be trusted. Zero
     *  would reject a vertex that lands exactly on an endpoint through rounding. */
    vertexRangeSlackDeg: number;

    /** Cam ramp: the override bypasses the DME's own rate limit, so this side
     *  owns it. Bigger steps risk EVAN1_XD > 10 degKW, which logs a VANOS DTC. */
    rampStepDeg: number;
    rampIntervalMs: number;
    /** Give up waiting for arrival after this and report it, rather than
     *  dwelling on an angle the cam never reached. */
    arrivalTimeoutMs: number;
    /** Keep-alive cadence. The DME drops the override without it. */
    keepAliveMs: number;
}

export const SWEEP_DEFAULTS: SweepDefaults = {
    arrivalTolDeg: 2.0,
    arrivalTolDegOtherBank: 3.0,

    pedalMinPct: 99,
    wdkMinPct: 90,
    throttleFillMaxMs: 4000,

    settleSec: 0.6,
    maxRpmDriftPctPerSettle: 45,
    maxThrottleDriftPct: 8,

    minCoolantC: 75,
    minOilC: 40,

    lambdaClampLow: 0.80,
    lambdaClampHigh: 1.25,

    analysisMinRpm: 2700,
    rpmBinWidth: 300,

    minSamplesPerCell: 6,
    minVisitsPerCell: 2,
    visitGapMs: 3000,

    vertexRangeSlackDeg: 0.5,

    rampStepDeg: 2,
    rampIntervalMs: 150,
    arrivalTimeoutMs: 6000,
    keepAliveMs: 2000,
};

/**
 * Spread that SKIPS undefined, which `{...DEFAULTS, ...opts}` does not.
 * The tuner hit this for real: an options object carrying `minSamples:
 * undefined` wrote the undefined straight over the default and silently
 * disabled the gate, so everything passed and the run looked clean.
 */
export function withDefaults(opts: Partial<SweepDefaults> = {}): SweepDefaults {
    const out = { ...SWEEP_DEFAULTS };
    for (const [k, v] of Object.entries(opts)) {
        if (v !== undefined && v !== null) {
            (out as unknown as Record<string, unknown>)[k] = v;
        }
    }
    return out;
}

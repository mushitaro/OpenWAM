/**
 * Is this sample evidence? One function, called by BOTH the live coverage board
 * and the final fit.
 *
 * The tuner learned this the hard way (src/lib/inertia/liveCoverage.ts): "265
 * samples collected, 265 samples rejected, and nothing on screen said so until
 * the run had already ended." A second copy of the rules for the live view is
 * how a driver gets told a cell is finished when the verdict will throw it away.
 *
 * Every refusal is NAMED, because "not enough data" does not tell a driver
 * whether to pull again, pull in a different gear, or wait for the oil to warm.
 */
import { SweepDefaults, withDefaults } from './options';

/** The channels admission needs. A superset of LiveSample, so a replayed CSV
 *  row and a live sample can both be judged by the same code. */
export interface SweepSample {
    /** Milliseconds since the recording started. */
    tMs: number;
    rpm?: number;
    /** Lambda integrators — the observable. */
    stft1?: number;
    stft2?: number;
    /** Cam actual/target, LIVE degKW. */
    evanIst?: number;
    evanSoll?: number;
    avanIst?: number;
    avanSoll?: number;
    pedal?: number;
    throttle?: number;
    coolant?: number;
    oil?: number;
    /** Commanded setting label for this sample; null/undefined = baseline
     *  (the DME's own map), which is what the anchor is built from. */
    cmdIntake?: number | null;
    cmdExhaust?: number | null;
    /** True when the throttle reading was forward-filled from a stale block 3. */
    throttleStale?: boolean;
}

export type RejectReason =
    | 'no-rpm'
    | 'below-analysis-band'
    | 'throttle-unknown'
    | 'throttle-stale'
    | 'not-wot'
    | 'cam-not-arrived'
    | 'other-cam-moving'
    | 'no-lambda'
    | 'lambda-at-clamp'
    | 'engine-cold'
    | 'rpm-transient'
    | 'throttle-transient';

/** Driver-facing text. Says what to DO, not just what was wrong. */
export const REJECT_TEXT: Record<RejectReason, string> = {
    'no-rpm': '回転数が読めていません（ブロック3/35の応答なし）',
    'below-analysis-band': `解析下限より低い回転数です`,
    'throttle-unknown': 'スロットル開度が不明です。ブロック3を4秒に1回以上ポーリングしてください',
    'throttle-stale': 'スロットル値が古すぎます。ブロック3のポーリング間隔を詰めてください',
    'not-wot': '全開ではありません。アクセルを踏み切ってください',
    'cam-not-arrived': 'カムが指令角に到達していません。到達を待ってから計測されます',
    'other-cam-moving': '反対バンクのカムが動いています。片側ずつ振ってください',
    'no-lambda': 'λ積分器が読めていません（ブロック19の応答なし）',
    'lambda-at-clamp': 'λ積分器が張り付いています。この状態では比較できません（燃調の余裕を確認）',
    'engine-cold': '水温・油温が不足しています。暖機してください',
    'rpm-transient': '回転変化が速すぎます（過渡）。ギアを上げて緩やかに引いてください',
    'throttle-transient': 'スロットルが動いています。開度を一定に保ってください',
};

export type AdmitResult =
    | { ok: true; lambda: number; isBaseline: boolean }
    | { ok: false; reason: RejectReason };

const lambdaOf = (s: SweepSample): number | null => {
    const vals = [s.stft1, s.stft2].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
};

export const isBaselineSample = (s: SweepSample): boolean =>
    (s.cmdIntake === null || s.cmdIntake === undefined)
    && (s.cmdExhaust === null || s.cmdExhaust === undefined);

/**
 * Walk back by TIME, not by sample count, to find the settle reference.
 *
 * The tuner documents why (src/lib/log-engine/filter.ts): a live flush and a
 * batch pass see different sample rates, so a count-based window gives two
 * different answers for the same drive — 37 valid samples live vs 41 batch.
 * Here the rate genuinely varies with the block selection and with K-line
 * retries, so an index window would drift between the panel and the verdict.
 */
export function findSettleReference(
    samples: readonly SweepSample[], i: number, settleSec: number,
): SweepSample | null {
    const now = samples[i].tMs;
    for (let j = i - 1; j >= 0; j--) {
        if ((now - samples[j].tMs) / 1000 >= settleSec) return samples[j];
    }
    return null;
}

/**
 * Judge sample `i` of `samples`. Takes the array and an index (not a lone
 * sample) because the transient gates need the history behind it.
 *
 * `axis` says which cam is being swept, so the OTHER bank is held to a
 * stillness check rather than an arrival check — during a baseline pull there
 * is no commanded angle for it to arrive at.
 */
export function admitSample(
    samples: readonly SweepSample[], i: number,
    axis: 'intake' | 'exhaust',
    opts: Partial<SweepDefaults> = {},
): AdmitResult {
    const o = withDefaults(opts);
    const s = samples[i];

    if (typeof s.rpm !== 'number' || !Number.isFinite(s.rpm) || s.rpm <= 0) {
        return { ok: false, reason: 'no-rpm' };
    }
    if (s.rpm < o.analysisMinRpm) return { ok: false, reason: 'below-analysis-band' };

    // Throttle: require positive evidence. A sample whose throttle is unknown is
    // NOT assumed to be at WOT — that assumption silently folds every
    // off-throttle coast between pulls into the mean.
    if (s.throttleStale) return { ok: false, reason: 'throttle-stale' };
    const ped = s.pedal, wdk = s.throttle;
    if (typeof ped === 'number' && Number.isFinite(ped)) {
        if (ped < o.pedalMinPct) return { ok: false, reason: 'not-wot' };
    } else if (typeof wdk === 'number' && Number.isFinite(wdk)) {
        if (wdk < o.wdkMinPct) return { ok: false, reason: 'not-wot' };
    } else {
        return { ok: false, reason: 'throttle-unknown' };
    }

    if (typeof s.coolant === 'number' && s.coolant < o.minCoolantC) {
        return { ok: false, reason: 'engine-cold' };
    }
    if (typeof s.oil === 'number' && s.oil < o.minOilC) {
        return { ok: false, reason: 'engine-cold' };
    }

    // Arrival. The swept bank must be AT the commanded angle; the other bank
    // must at least be tracking its own target.
    const gap = (ist?: number, soll?: number) =>
        (typeof ist === 'number' && typeof soll === 'number') ? Math.abs(ist - soll) : null;
    const inGap = gap(s.evanIst, s.evanSoll);
    const exGap = gap(s.avanIst, s.avanSoll);
    const sweptGap = axis === 'intake' ? inGap : exGap;
    const otherGap = axis === 'intake' ? exGap : inGap;
    if (sweptGap !== null && sweptGap > o.arrivalTolDeg) {
        return { ok: false, reason: 'cam-not-arrived' };
    }
    if (otherGap !== null && otherGap > o.arrivalTolDegOtherBank) {
        return { ok: false, reason: 'other-cam-moving' };
    }

    const la = lambdaOf(s);
    if (la === null) return { ok: false, reason: 'no-lambda' };
    if (la <= o.lambdaClampLow || la >= o.lambdaClampHigh) {
        return { ok: false, reason: 'lambda-at-clamp' };
    }

    // Transients, referenced by time.
    const ref = findSettleReference(samples, i, o.settleSec);
    if (ref) {
        if (typeof ref.rpm === 'number' && ref.rpm > 0) {
            const drift = Math.abs((s.rpm - ref.rpm) / ref.rpm) * 100;
            if (drift > o.maxRpmDriftPctPerSettle) return { ok: false, reason: 'rpm-transient' };
        } else if (typeof ref.rpm === 'number') {
            // A zero/!finite reference rpm makes the relative test meaningless.
            // NaN > threshold is false, which would pass a crank-up as steady.
            return { ok: false, reason: 'rpm-transient' };
        }
        const t0 = ref.pedal ?? ref.throttle;
        const t1 = s.pedal ?? s.throttle;
        if (typeof t0 === 'number' && typeof t1 === 'number'
            && Math.abs(t1 - t0) > o.maxThrottleDriftPct) {
            return { ok: false, reason: 'throttle-transient' };
        }
    }

    return { ok: true, lambda: la, isBaseline: isBaselineSample(s) };
}

/** Bin an rpm onto the analysis grid. */
export const rpmBin = (rpm: number, width = 300): number => Math.round(rpm / width) * width;

/**
 * Forward-fill throttle across sparsely-polled block 3, marking anything older
 * than the window as stale so admission can refuse it instead of assuming WOT.
 * Mutates in place; call once when a recording is loaded or extended.
 */
export function fillThrottle(samples: SweepSample[], opts: Partial<SweepDefaults> = {}): void {
    const o = withDefaults(opts);
    let lastPedal: number | undefined;
    let lastThrottle: number | undefined;
    let lastAt: number | null = null;
    for (const s of samples) {
        const fresh = typeof s.pedal === 'number' || typeof s.throttle === 'number';
        if (fresh) {
            if (typeof s.pedal === 'number') lastPedal = s.pedal;
            if (typeof s.throttle === 'number') lastThrottle = s.throttle;
            lastAt = s.tMs;
            s.throttleStale = false;
            continue;
        }
        if (lastAt === null || Math.abs(s.tMs - lastAt) > o.throttleFillMaxMs) {
            s.throttleStale = true;
            continue;
        }
        s.throttleStale = false;
        if (s.pedal === undefined) s.pedal = lastPedal;
        if (s.throttle === undefined) s.throttle = lastThrottle;
    }
}

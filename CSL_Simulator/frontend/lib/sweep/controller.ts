/**
 * Cam ramp planning and arrival detection — the pure half of the sweep driver.
 *
 * The override bypasses the DME's own rate limiter (KF_EVAN1_SOLL_DMAX), so the
 * ramp is this side's responsibility. It is not a nicety: the firmware raises a
 * VANOS DTC when |soll − ist| exceeds K_EVAN1_XD_MAX (10 degKW), so a single
 * large step both trips a fault and leaves the cam chasing a target it was never
 * going to reach in one go.
 */
import { VANOS_STORABLE } from '../dme-link/ds2';
import { SweepDefaults, withDefaults } from './options';

export type SweepAxis = 'intake' | 'exhaust';

/** Where the search is allowed to go: what the cams travel AND the map can store. */
export function clampToStorable(axis: SweepAxis, angleDegKw: number): number {
    const w = axis === 'intake' ? VANOS_STORABLE.intake : VANOS_STORABLE.exhaust;
    return Math.min(w.max, Math.max(w.min, Math.round(angleDegKw)));
}

export function isStorable(axis: SweepAxis, angleDegKw: number): boolean {
    const w = axis === 'intake' ? VANOS_STORABLE.intake : VANOS_STORABLE.exhaust;
    return angleDegKw >= w.min && angleDegKw <= w.max;
}

/**
 * Steps from `from` to `to`, none larger than `rampStepDeg`, ending exactly on
 * the target. An empty array means there is nothing to do.
 */
export function planRamp(from: number, to: number, opts: Partial<SweepDefaults> = {}): number[] {
    const o = withDefaults(opts);
    const step = Math.max(1, Math.abs(o.rampStepDeg));
    const start = Math.round(from), end = Math.round(to);
    if (start === end) return [];
    const dir = end > start ? 1 : -1;
    const out: number[] = [];
    let cur = start;
    // Bounded by construction, but guard anyway: a NaN `from` would otherwise
    // spin here rather than fail visibly.
    const maxSteps = Math.ceil(Math.abs(end - start) / step) + 1;
    for (let i = 0; i < maxSteps && cur !== end; i++) {
        cur = dir > 0 ? Math.min(end, cur + step) : Math.max(end, cur - step);
        out.push(cur);
    }
    return out;
}

/** Has the commanded bank arrived, and is the other one holding still? */
export function hasArrived(
    axis: SweepAxis,
    sample: { evanIst?: number; evanSoll?: number; avanIst?: number; avanSoll?: number },
    opts: Partial<SweepDefaults> = {},
): boolean {
    const o = withDefaults(opts);
    const gap = (i?: number, s?: number) =>
        (typeof i === 'number' && typeof s === 'number') ? Math.abs(i - s) : null;
    const swept = axis === 'intake' ? gap(sample.evanIst, sample.evanSoll) : gap(sample.avanIst, sample.avanSoll);
    const other = axis === 'intake' ? gap(sample.avanIst, sample.avanSoll) : gap(sample.evanIst, sample.evanSoll);
    if (swept === null) return false;                       // no reading = not arrived
    if (swept > o.arrivalTolDeg) return false;
    if (other !== null && other > o.arrivalTolDegOtherBank) return false;
    return true;
}

/**
 * The sweep schedule: which settings to visit, in the order the protocol wants.
 * Baseline first and re-visited between settings, so drift is measured rather
 * than assumed — every setting is compared against a baseline taken near it in
 * time.
 */
export interface SweepStep {
    /** null = release the override and let the DME's own map drive (the anchor). */
    angle: number | null;
    label: string;
}

export function buildSchedule(
    axis: SweepAxis, angles: readonly number[], opts: { baselineEvery?: number } = {},
): SweepStep[] {
    const every = Math.max(1, opts.baselineEvery ?? 3);
    const out: SweepStep[] = [{ angle: null, label: '基準（指令なし）' }];
    angles.forEach((a, i) => {
        out.push({ angle: a, label: `${axis === 'intake' ? '吸気' : '排気'} ${a}°` });
        const last = i === angles.length - 1;
        if (!last && (i + 1) % every === 0) out.push({ angle: null, label: '基準（指令なし）' });
    });
    out.push({ angle: null, label: '基準（指令なし）' });
    return out;
}

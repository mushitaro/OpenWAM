/**
 * Sweep aggregation: samples -> per (rpm bin, cam angle) evidence -> vertex.
 *
 * The method is the tuner's rf_korr census (src/lib/ve-calculator/rfKorrTuner.ts)
 * applied to cams. Its central argument transfers exactly:
 *
 *   Express every sample as a RATIO to a baseline anchor measured in the same
 *   cell. The cell's own VE error is common to both and divides out — which is
 *   why a cam sweep is valid BEFORE the VE table has converged. That is the
 *   whole reason this experiment can run on the car as it is today.
 *
 * Two evidence gates, both required, from the same source:
 *   - samples: ten readings spread over a moving cam carry little.
 *   - VISITS: a single 30-second dwell is one occasion, not ninety samples'
 *     worth of independent evidence. Without this a driver who sat at one angle
 *     would be told the cell was finished.
 */
import { admitSample, isBaselineSample, rpmBin, RejectReason, REJECT_TEXT, SweepSample } from './admit';
import { SweepDefaults, withDefaults } from './options';
import { fitVertex, VertexPoint, VertexResult } from './vertex';

export interface AnglePoint {
    /** Commanded cam angle, live degKW. */
    angle: number;
    /** Mean lambda delta vs the anchor, and its standard error. */
    mean: number;
    sem: number;
    n: number;
    visits: number;
    satisfied: boolean;
}

export interface BinResult {
    rpm: number;
    /** Baseline (map-control) mean lambda in this bin — the anchor. */
    anchor: number | null;
    anchorN: number;
    points: AnglePoint[];
    vertex: VertexResult | null;
    /** True when every gate the VERDICT applies is already met — deliberately
     *  the same threshold, not a stricter one. A board that demands more than
     *  the fit does tells the driver to keep going long after the measurement
     *  is good. */
    ready: boolean;
}

export interface SweepAggregate {
    axis: 'intake' | 'exhaust';
    bins: BinResult[];
    /** Total admitted / seen. */
    admitted: number;
    total: number;
    /** Rejections, most common first — the list that tells a driver what to change. */
    rejects: { reason: RejectReason; text: string; n: number }[];
}

/** Distinct occasions, not samples: a gap longer than `gapMs` starts a new one. */
export function countVisits(timesMs: readonly number[], gapMs: number): number {
    if (!timesMs.length) return 0;
    const t = [...timesMs].sort((a, b) => a - b);
    let visits = 1;
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > gapMs) visits++;
    return visits;
}

const commandedAngle = (s: SweepSample, axis: 'intake' | 'exhaust'): number | null => {
    const cmd = axis === 'intake' ? s.cmdIntake : s.cmdExhaust;
    if (typeof cmd === 'number' && Number.isFinite(cmd)) return Math.round(cmd);
    // Fall back to the actual cam position, so a log without explicit command
    // labels (a replayed CSV) still aggregates.
    const ist = axis === 'intake' ? s.evanIst : s.avanIst;
    return typeof ist === 'number' && Number.isFinite(ist) ? Math.round(ist) : null;
};

/**
 * Aggregate a recording. Pure and cheap enough to re-run on every flush, which
 * is what the live board does — recomputing beats accumulating here, because
 * the newest samples are always pending a settle reference and an incremental
 * accumulator would need drift-prone bookkeeping to take them back.
 */
export function aggregateSweep(
    samples: readonly SweepSample[],
    axis: 'intake' | 'exhaust',
    opts: Partial<SweepDefaults> = {},
): SweepAggregate {
    const o = withDefaults(opts);
    const rejects = new Map<RejectReason, number>();
    let admitted = 0;

    // bin -> baseline lambdas, and bin -> angle -> samples
    const anchors = new Map<number, number[]>();
    const cells = new Map<number, Map<number, { la: number[]; t: number[] }>>();

    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const verdict = admitSample(samples, i, axis, o);
        if (!verdict.ok) {
            rejects.set(verdict.reason, (rejects.get(verdict.reason) ?? 0) + 1);
            continue;
        }
        admitted++;
        const bin = rpmBin(s.rpm!, o.rpmBinWidth);
        if (isBaselineSample(s)) {
            if (!anchors.has(bin)) anchors.set(bin, []);
            anchors.get(bin)!.push(verdict.lambda);
            continue;
        }
        const angle = commandedAngle(s, axis);
        if (angle === null) continue;
        if (!cells.has(bin)) cells.set(bin, new Map());
        const byAngle = cells.get(bin)!;
        if (!byAngle.has(angle)) byAngle.set(angle, { la: [], t: [] });
        byAngle.get(angle)!.la.push(verdict.lambda);
        byAngle.get(angle)!.t.push(s.tMs);
    }

    const bins: BinResult[] = [];
    const allBins = new Set<number>([...anchors.keys(), ...cells.keys()]);
    for (const rpm of [...allBins].sort((a, b) => a - b)) {
        const anchorVals = anchors.get(rpm) ?? [];
        const anchor = anchorVals.length
            ? anchorVals.reduce((a, b) => a + b, 0) / anchorVals.length
            : null;

        const points: AnglePoint[] = [];
        const byAngle: Map<number, { la: number[]; t: number[] }> = cells.get(rpm) ?? new Map();
        for (const [angle, acc] of byAngle.entries()) {
            const n = acc.la.length;
            if (!n) continue;
            const mean = acc.la.reduce((a, b) => a + b, 0) / n;
            // Ratio to the anchor. Without an anchor the bin has no zero, so the
            // absolute lambda is reported and the fit is refused below.
            const rel = anchor !== null ? mean - anchor : mean;
            const varr = n > 1
                ? acc.la.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
                : 0;
            const visits = countVisits(acc.t, o.visitGapMs);
            points.push({
                angle, mean: rel, sem: n > 1 ? Math.sqrt(varr / n) : 0, n, visits,
                satisfied: n >= o.minSamplesPerCell && visits >= o.minVisitsPerCell,
            });
        }
        points.sort((a, b) => a.angle - b.angle);

        // Fit only the angles that actually cleared both gates, and only when a
        // baseline exists to have measured them against.
        const usable = points.filter(p => p.satisfied);
        const vertex: VertexResult | null = (anchor !== null && usable.length >= 3)
            ? fitVertex(
                usable.map<VertexPoint>(p => ({
                    x: p.angle, y: p.mean,
                    // Weight by precision: a noisy angle should not drag the vertex.
                    w: p.sem > 0 ? 1 / (p.sem * p.sem) : p.n,
                })), o)
            : null;

        bins.push({
            rpm, anchor, anchorN: anchorVals.length, points, vertex,
            ready: vertex !== null && vertex.ok,
        });
    }

    return {
        axis, bins, admitted, total: samples.length,
        rejects: [...rejects.entries()]
            .map(([reason, n]) => ({ reason, text: REJECT_TEXT[reason], n }))
            .sort((a, b) => b.n - a.n),
    };
}

/**
 * What the driver still needs to do, in plain language. Empty means the sweep
 * has what it came for.
 */
export function nextActions(agg: SweepAggregate, opts: Partial<SweepDefaults> = {}): string[] {
    const o = withDefaults(opts);
    const out: string[] = [];
    for (const b of agg.bins) {
        if (b.ready) continue;
        if (b.anchor === null) {
            out.push(`${b.rpm} rpm: 基準（VANOS指令なし）のプルがまだありません`);
            continue;
        }
        const thin = b.points.filter(p => !p.satisfied);
        if (thin.length) {
            const worst = thin.sort((a, b2) => a.n - b2.n)[0];
            const needSamples = Math.max(0, o.minSamplesPerCell - worst.n);
            const needVisits = Math.max(0, o.minVisitsPerCell - worst.visits);
            out.push(
                `${b.rpm} rpm / ${worst.angle}°: `
                + (needVisits > 0 ? `あと${needVisits}回のプルが必要` : `あと${needSamples}サンプル必要`));
            continue;
        }
        if (b.points.length < 3) {
            out.push(`${b.rpm} rpm: 角度が${b.points.length}点だけです。3点以上振ってください`);
            continue;
        }
        if (b.vertex && !b.vertex.ok) out.push(`${b.rpm} rpm: ${b.vertex.message}`);
    }
    return out;
}

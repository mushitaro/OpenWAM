/**
 * Quadratic fit and vertex — "which cam angle breathed best", answered honestly.
 *
 * The sweep's whole output is a vertex, so the refusals matter more than the
 * arithmetic. Modelled on the tuner's `fitLine` (src/lib/inertia/estimator.ts):
 * a degenerate input must come back as `null`, because that is the case a
 * least-squares fit otherwise reports as a confident answer.
 *
 * Three refusals, all of them real failures seen in cam-sweep data:
 *   - fewer than 3 distinct angles: a parabola through 2 points is not a
 *     measurement, it is an assumption about curvature.
 *   - a >= 0 (the fit opens upward, or is flat): there is no maximum inside
 *     this data. The best angle might be at either end, or the response might
 *     be noise; either way the vertex of an upward parabola is a MINIMUM and
 *     reporting it as the optimum would command exactly the wrong cam.
 *   - vertex outside the swept range: extrapolating a calibration invents data.
 *     Sweep wider, do not guess.
 */
import { SweepDefaults, withDefaults } from './options';

export interface VertexPoint {
    /** Commanded cam angle, live degKW. */
    x: number;
    /** Mean response at that angle (lambda-integrator delta vs the anchor). */
    y: number;
    /** Optional weight — the confidence the anchor blend carries. */
    w?: number;
}

export interface VertexFit {
    a: number;
    b: number;
    c: number;
    /** Cam angle of the maximum, live degKW. */
    vertex: number;
    /** Fitted response at the vertex. */
    peak: number;
    /** Coefficient of determination, weighted. 1 = the points lie on the curve. */
    r2: number;
    /** Angles actually used, ascending. */
    range: { min: number; max: number };
    nPoints: number;
}

export type VertexRefusal =
    | 'too-few-points'
    | 'degenerate'
    | 'not-concave'
    | 'vertex-outside-range';

export type VertexResult =
    | { ok: true; fit: VertexFit }
    | { ok: false; reason: VertexRefusal; message: string; nPoints: number };

const REFUSAL_TEXT: Record<VertexRefusal, string> = {
    'too-few-points': '角度が3点そろっていないため、山の形を判定できません。掃引点を増やしてください。',
    'degenerate': '角度に広がりがないため、当てはめができません。掃引幅を広げてください。',
    'not-concave': '山の形になっていません（谷型か平坦）。最適点はこの範囲の外か、応答が雑音に埋もれています。',
    'vertex-outside-range': '頂点が掃引した範囲の外に出ました。外挿はしません。その向きへ掃引を広げてください。',
};

/**
 * Weighted least-squares y = a x^2 + b x + c, solved by Cramer's rule on the
 * 3x3 normal equations. Returns the vertex only when it is a maximum that the
 * data actually contains.
 */
export function fitVertex(points: readonly VertexPoint[], opts: Partial<SweepDefaults> = {}): VertexResult {
    const o = withDefaults(opts);
    const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (p.w ?? 1) > 0);
    const distinct = new Set(pts.map(p => p.x)).size;
    if (distinct < 3) {
        return { ok: false, reason: 'too-few-points', message: REFUSAL_TEXT['too-few-points'], nPoints: distinct };
    }

    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const p of pts) {
        const w = p.w ?? 1;
        const x = p.x, x2 = x * x;
        s0 += w; s1 += w * x; s2 += w * x2; s3 += w * x2 * x; s4 += w * x2 * x2;
        t0 += w * p.y; t1 += w * x * p.y; t2 += w * x2 * p.y;
    }
    const A = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]];
    const B = [t2, t1, t0];
    const det3 = (m: number[][]) =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const det = det3(A);
    // Scale-aware: an absolute epsilon would call a small-but-real system
    // degenerate whenever the angles are close together.
    if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * Math.max(1, Math.abs(s4))) {
        return { ok: false, reason: 'degenerate', message: REFUSAL_TEXT.degenerate, nPoints: distinct };
    }
    const solve = (col: number) => {
        const m = A.map(r => r.slice());
        for (let i = 0; i < 3; i++) m[i][col] = B[i];
        return det3(m) / det;
    };
    const a = solve(0), b = solve(1), c = solve(2);

    if (!(a < 0)) {
        return { ok: false, reason: 'not-concave', message: REFUSAL_TEXT['not-concave'], nPoints: distinct };
    }
    const vertex = -b / (2 * a);
    const xs = pts.map(p => p.x);
    const min = Math.min(...xs), max = Math.max(...xs);
    if (vertex < min - o.vertexRangeSlackDeg || vertex > max + o.vertexRangeSlackDeg) {
        return {
            ok: false, reason: 'vertex-outside-range',
            message: REFUSAL_TEXT['vertex-outside-range'], nPoints: distinct,
        };
    }

    // Weighted r2 against the weighted mean.
    const ybar = t0 / s0;
    let ssRes = 0, ssTot = 0;
    for (const p of pts) {
        const w = p.w ?? 1;
        const yhat = a * p.x * p.x + b * p.x + c;
        ssRes += w * (p.y - yhat) ** 2;
        ssTot += w * (p.y - ybar) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

    return {
        ok: true,
        fit: { a, b, c, vertex, peak: a * vertex * vertex + b * vertex + c, r2, range: { min, max }, nPoints: distinct },
    };
}

/** Human-readable reason, for the panel and the report. */
export function describeVertexRefusal(reason: VertexRefusal): string {
    return REFUSAL_TEXT[reason];
}

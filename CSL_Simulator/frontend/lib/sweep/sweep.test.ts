/**
 * Stage 121 — sweep engine checks, and the cross-implementation fixture.
 *
 * Two jobs:
 *  1. Prove the gates and the vertex fit behave, including every refusal. A
 *     vertex fit that answers when it should refuse is the failure that puts a
 *     wrong cam angle into a map.
 *  2. Emit `__fixtures__/vertex_cases.json`, which the Python analyser
 *     (backend/scripts/analyze_vanos_sweep.py) must reproduce. The live board is
 *     TS and the verdict is Python; they cannot share code, so they share a
 *     fixture instead — otherwise the two implementations drift and the board
 *     starts promising things the verdict will not honour.
 *
 * Run: npx tsx lib/sweep/sweep.test.ts     Exit 0 = all pass.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { admitSample, fillThrottle, SweepSample } from './admit';
import { aggregateSweep, countVisits, nextActions } from './aggregate';
import { SWEEP_DEFAULTS, withDefaults } from './options';
import { fitVertex } from './vertex';
import { axisBracket, interpAxis } from './axisBracket';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
    if (cond) console.log(`  ok   ${name}`);
    else { failures++; console.log(`  FAIL ${name}${detail ? ': ' + detail : ''}`); }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log('\naxisBracket (copied verbatim — the NaN contract is the point)');
{
    check('NaN has no bracket', axisBracket([1, 2, 3], NaN) === null);
    check('empty axis has no bracket', axisBracket([], 1) === null);
    check('below the axis pins to the first', JSON.stringify(axisBracket([10, 20], 5)) === '{"i0":0,"i1":0,"w1":0}');
    check('above the axis pins to the last', JSON.stringify(axisBracket([10, 20], 99)) === '{"i0":1,"i1":1,"w1":0}');
    check('midpoint weights 0.5', axisBracket([10, 20], 15)!.w1 === 0.5);
    check('interp is flat outside', interpAxis([10, 20], [1, 2], 99) === 2);
    check('interp of NaN is NaN', Number.isNaN(interpAxis([10, 20], [1, 2], NaN)));
}

console.log('\nwithDefaults skips undefined (the gate-disabling bug)');
{
    const o = withDefaults({ minSamplesPerCell: undefined, arrivalTolDeg: 1 });
    check('undefined does not overwrite the default',
        o.minSamplesPerCell === SWEEP_DEFAULTS.minSamplesPerCell, `got ${o.minSamplesPerCell}`);
    check('a real value does overwrite', o.arrivalTolDeg === 1);
}

console.log('\nVertex fit — answers, and refuses');
{
    // y = -0.0002 (x-12)^2 + 0.03
    const pts = [0, 5, 10, 12, 15, 20].map(x => ({ x, y: -0.0002 * (x - 12) ** 2 + 0.03 }));
    const r = fitVertex(pts);
    check('recovers a known vertex', r.ok && near(r.fit.vertex, 12, 0.01),
        r.ok ? `got ${r.fit.vertex.toFixed(3)}` : r.reason);
    check('reports r2 = 1 on exact data', r.ok && near(r.fit.r2, 1, 1e-9));

    check('refuses 2 points', !fitVertex(pts.slice(0, 2)).ok);
    check('refuses repeated x', !fitVertex([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }]).ok);

    const up = [0, 5, 10, 15].map(x => ({ x, y: 0.0002 * (x - 7) ** 2 }));
    const upFit = fitVertex(up);
    check('refuses an upward parabola (its vertex is a MINIMUM)',
        !upFit.ok && upFit.reason === 'not-concave');

    // Concave, but peaking beyond the swept range.
    const outside = [0, 5, 10].map(x => ({ x, y: -0.0002 * (x - 40) ** 2 + 0.05 }));
    const outFit = fitVertex(outside);
    check('refuses to extrapolate a vertex outside the range',
        !outFit.ok && outFit.reason === 'vertex-outside-range',
        outFit.ok ? `answered ${outFit.fit.vertex}` : outFit.reason);

    const flat = [0, 5, 10, 15].map(x => ({ x, y: 0.01 }));
    check('refuses a flat response', !fitVertex(flat).ok);
}

console.log('\nVisits — occasions, not samples');
{
    const oneDwell = Array.from({ length: 90 }, (_, i) => i * 300);          // 27 s continuous
    check('one long dwell is one visit', countVisits(oneDwell, 3000) === 1);
    const three = [0, 300, 600, 20000, 20300, 40000];
    check('gaps split visits', countVisits(three, 3000) === 3);
    check('empty is zero', countVisits([], 3000) === 0);
}

console.log('\nThrottle fill — the off-throttle-counted-as-WOT trap');
{
    const s: SweepSample[] = [];
    for (let i = 0; i < 8; i++) s.push({ tMs: i * 330, rpm: 3100, stft1: 1.03, stft2: 1.02,
        evanIst: 10, evanSoll: 10, avanIst: 41, avanSoll: 41,
        ...(i === 0 ? { pedal: 100, throttle: 99 } : {}) });
    for (let i = 8; i < 16; i++) s.push({ tMs: i * 330, rpm: 3100, stft1: 0.99, stft2: 0.99,
        evanIst: 10, evanSoll: 10, avanIst: 41, avanSoll: 41,
        ...(i === 8 ? { pedal: 0, throttle: 3 } : {}) });
    fillThrottle(s);
    const wot = s.slice(0, 8).filter((_, i) => admitSample(s, i, 'intake').ok).length;
    const lifted = s.slice(8).filter((_, i) => admitSample(s, i + 8, 'intake').ok).length;
    check('WOT block admitted', wot === 8, `got ${wot}/8`);
    check('lifted block entirely rejected', lifted === 0, `got ${lifted} admitted`);

    // A block-3 reading far in the past must not be trusted forward.
    const stale: SweepSample[] = [
        { tMs: 0, rpm: 3100, pedal: 100, throttle: 99, stft1: 1.0, stft2: 1.0, evanIst: 10, evanSoll: 10 },
        { tMs: 30000, rpm: 3100, stft1: 1.0, stft2: 1.0, evanIst: 10, evanSoll: 10 },
    ];
    fillThrottle(stale);
    check('a stale throttle is refused, not assumed',
        !admitSample(stale, 1, 'intake').ok && admitSample(stale, 1, 'intake').ok === false);
}

console.log('\nAdmission gates, each with its own reason');
{
    const base = (over: Partial<SweepSample> = {}): SweepSample[] => ([{
        tMs: 0, rpm: 3100, pedal: 100, throttle: 99, coolant: 90, oil: 80,
        stft1: 1.03, stft2: 1.02, evanIst: 10, evanSoll: 10, avanIst: 41, avanSoll: 41, ...over,
    }]);
    const reason = (over: Partial<SweepSample>) => {
        const r = admitSample(base(over), 0, 'intake');
        return r.ok ? 'ok' : r.reason;
    };
    check('baseline sample admits', admitSample(base(), 0, 'intake').ok);
    check('no rpm', reason({ rpm: undefined }) === 'no-rpm');
    check('below band', reason({ rpm: 1500 }) === 'below-analysis-band');
    check('not WOT', reason({ pedal: 40, throttle: 30 }) === 'not-wot');
    check('throttle unknown', reason({ pedal: undefined, throttle: undefined }) === 'throttle-unknown');
    check('cam not arrived', reason({ evanIst: 0, evanSoll: 15 }) === 'cam-not-arrived');
    check('other cam moving', reason({ avanIst: 20, avanSoll: 41 }) === 'other-cam-moving');
    check('no lambda', reason({ stft1: undefined, stft2: undefined }) === 'no-lambda');
    check('lambda at clamp', reason({ stft1: 1.30, stft2: 1.30 }) === 'lambda-at-clamp');
    check('engine cold', reason({ coolant: 40 }) === 'engine-cold');
}

console.log('\nEnd-to-end aggregate on a synthetic sweep');
let fixture: Record<string, unknown> = {};
{
    // 4 baseline pulls + 6 angles x 4 pulls, 13 samples per pull, vertex at +12.
    //
    // Four, not three: a 13-sample pull spread over ~5 rpm bins leaves only ~2
    // samples per bin, so at minSamplesPerCell=6 three pulls leaves the outer
    // bins short. That is a real property of the experiment, not a test
    // artefact — recorded in docs/LIVE_VANOS_SWEEP_PROTOCOL.md.
    const TRUE_VERTEX = 12;
    let t = 0;
    const rng = (() => { let s = 12345; return () => { s = (1103515245 * s + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; })();
    const samples: SweepSample[] = [];
    const pull = (cam: number | null) => {
        for (let i = 0; i < 13; i++) {
            const rpm = 2500 + i * 140;
            // Still travelling for the first 4 samples. Samples 0-1 sit below the
            // analysis band and are refused for that first (gate order), so the
            // lag has to outlast the band entry for the arrival gate to be the
            // binding one — which is exactly the case worth testing.
            const settled = i >= 4;
            const ist = settled ? (cam ?? 0) : (cam ?? 0) - 9;
            const gain = cam === null ? 0 : -0.00020 * (cam - TRUE_VERTEX) ** 2 + 0.030;
            const la = 1.0 + gain + 0.004 * rng();
            samples.push({
                tMs: t, rpm, pedal: 100, throttle: 99, coolant: 92, oil: 80,
                stft1: la, stft2: la,
                evanIst: ist, evanSoll: cam ?? 0, avanIst: 41, avanSoll: 41,
                cmdIntake: cam, cmdExhaust: null,
            });
            t += 330;
        }
        t += 5000;   // cruise back — also what separates visits
    };
    for (let rep = 0; rep < 4; rep++) {
        pull(null);
        for (const cam of [0, 5, 10, 12, 15, 20]) pull(cam);
    }
    fillThrottle(samples);
    const agg = aggregateSweep(samples, 'intake');

    check('a clear majority of samples admitted', agg.admitted > samples.length * 0.6,
        `${agg.admitted}/${agg.total}`);
    check('the travelling samples were rejected by name',
        agg.rejects.some(r => r.reason === 'cam-not-arrived'),
        agg.rejects.map(r => r.reason).join(','));

    const withVertex = agg.bins.filter(b => b.vertex?.ok);
    // Pin the arithmetic rather than a loose count. A 13-sample pull entering at
    // 2500 rpm puts ~1/2/2/3/1 settled samples into bins 3000/3300/3600/3900/4200,
    // so at minSamplesPerCell=6 four pulls satisfy the three middle bins and
    // leave the band edges short. If this list changes, either the binning or
    // the evidence gate changed and the protocol's pull count needs revisiting.
    const readyBins = withVertex.map(b => b.rpm).sort((a, b) => a - b);
    check('exactly the bins with enough evidence are fitted',
        JSON.stringify(readyBins) === JSON.stringify([3300, 3600, 3900]),
        `got [${readyBins}]`);
    check('the thin edge bins ask for more pulls rather than answering',
        nextActions(agg).some(a => a.startsWith('3000') || a.startsWith('4200')),
        nextActions(agg).join(' / '));
    const errs = withVertex.map(b => Math.abs((b.vertex as { ok: true; fit: { vertex: number } }).fit.vertex - TRUE_VERTEX));
    const worst = Math.max(...errs);
    check(`vertex recovered within 2 deg in every bin (worst ${worst.toFixed(2)})`, worst <= 2);
    check('bins report ready', withVertex.every(b => b.ready));
    check('nothing left to ask for in ready bins',
        nextActions(agg).every(a => !withVertex.some(b => a.startsWith(String(b.rpm)))));

    fixture = {
        _comment: 'Shared TS/Python fixture. Both implementations must reproduce these vertices '
            + 'within tol. TS: lib/sweep/sweep.test.ts. Python: backend/scripts/analyze_vanos_sweep.py --fixture.',
        tolerance_deg: 0.05,
        cases: [
            { name: 'exact-parabola-vertex-12', tolerance_deg: 0.01,
              points: [0, 5, 10, 12, 15, 20].map(x => ({ x, y: -0.0002 * (x - 12) ** 2 + 0.03 })),
              expect: { ok: true, vertex: 12 } },
            { name: 'asymmetric-vertex-7.5', tolerance_deg: 0.05,
              points: [0, 5, 10, 15].map(x => ({ x, y: -0.0004 * (x - 7.5) ** 2 + 0.02 })),
              expect: { ok: true, vertex: 7.5 } },
            { name: 'refuse-not-concave',
              points: [0, 5, 10, 15].map(x => ({ x, y: 0.0002 * (x - 7) ** 2 })),
              expect: { ok: false, reason: 'not-concave' } },
            { name: 'refuse-outside-range',
              points: [0, 5, 10].map(x => ({ x, y: -0.0002 * (x - 40) ** 2 + 0.05 })),
              expect: { ok: false, reason: 'vertex-outside-range' } },
            { name: 'refuse-too-few',
              points: [{ x: 0, y: 0 }, { x: 5, y: 0.01 }],
              expect: { ok: false, reason: 'too-few-points' } },
        ],
        gates: SWEEP_DEFAULTS,
    };
}

const dir = join(__dirname, '__fixtures__');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'vertex_cases.json'), JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
console.log(`\nwrote ${join('lib', 'sweep', '__fixtures__', 'vertex_cases.json')}`);

console.log(failures === 0 ? '\nAll sweep-engine checks passed.\n'
                           : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

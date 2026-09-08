/**
 * Stage 122 — 事前準備, verified without a car.
 *
 * Three things are expensive to get wrong here, and each maps to a section below:
 *
 *  1. **The predicates.** A verdict that says PASS on a car that is not actually patched sends the
 *     owner out to record a drive whose lambda integrator is frozen. Every predicate is exercised
 *     against both a stock and a patched image, and against the boundary each one turns on.
 *  2. **The patch.** The bytes written must be the tuner's bytes, and both data CRCs must end up
 *     correct — an image flashed with stale checksums is one the DME mistrusts.
 *  3. **The backup ordering.** `writeCalibration` must hand over what is in the ECU and AWAIT it
 *     before anything is destroyed. This is the only test that can prove that property, because on
 *     real hardware failing it means the evidence is already gone.
 *
 * Run: npx tsx lib/preflight/preflight.test.ts     Exit 0 = all pass.
 */
import { PREFLIGHT_ITEMS, evaluate, buildPatchedImage, changedWindows } from './patch';
import { analyzeDataChecksum, DATA_PAIR_LENGTH } from '../checksum/dmeDataChecksum';
import { MockDmeLink } from '../dme-link/mockDmeLink';
import { supportsPreflight } from '../dme-link/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
    if (cond) console.log(`  ok   ${name}`);
    else { failures++; console.log(`  FAIL ${name}${detail ? ': ' + detail : ''}`); }
}
const item = (id: string) => {
    const found = PREFLIGHT_ITEMS.find(i => i.id === id);
    if (!found) throw new Error(`no preflight item "${id}"`);
    return found;
};
const slice = (img: Uint8Array, id: string) => {
    const it = item(id);
    return img.subarray(it.offset, it.offset + it.length);
};
const degC = (v: number) => v + 48;

async function main() {
    // -----------------------------------------------------------------------
    console.log('\n1. predicates on a STOCK image');
    // -----------------------------------------------------------------------
    const link = new MockDmeLink();
    if (!supportsPreflight(link)) {
        console.log('  FAIL MockDmeLink does not implement the preflight surface');
        failures++;
        return;
    }
    const stock = await link.readCalibration();

    check('image is 65536 bytes', stock.length === DATA_PAIR_LENGTH, `got ${stock.length}`);
    for (const it of PREFLIGHT_ITEMS) {
        const r = evaluate(it, slice(stock, it.id));
        check(`${it.symbol} FAILS on stock`, !r.ok, `read "${r.current}"`);
    }

    // -----------------------------------------------------------------------
    console.log('\n2. each predicate turns on the boundary it claims to');
    // -----------------------------------------------------------------------
    // KF_BZ_WDK_VL: unreachable means strictly above 100.0 %, and ONE low cell is enough to fail —
    // the lambda controller shuts off at whichever cell the engine is actually in.
    const all1010 = new Uint8Array(32);
    for (let i = 0; i < 16; i++) { all1010[i * 2] = (1010 >> 8) & 0xFF; all1010[i * 2 + 1] = 1010 & 0xFF; }
    check('WOT: 101.0 % everywhere passes', item('wot_threshold').satisfied(all1010));

    const exactly1000 = all1010.slice();
    exactly1000[0] = (1000 >> 8) & 0xFF; exactly1000[1] = 1000 & 0xFF;
    check('WOT: one cell at exactly 100.0 % fails', !item('wot_threshold').satisfied(exactly1000));

    const oneLow = all1010.slice();
    oneLow[30] = (650 >> 8) & 0xFF; oneLow[31] = 650 & 0xFF;   // last cell back to stock 65 %
    check('WOT: one stock cell among fifteen patched fails', !item('wot_threshold').satisfied(oneLow));

    check('k_rf_cfg: 0x02 passes', item('map_config').satisfied(new Uint8Array([0x02])));
    check('k_rf_cfg: 0x12 fails (MAP integral live)', !item('map_config').satisfied(new Uint8Array([0x12])));
    // Deliberate: 0x00 also clears bit 4 but is NOT the value this engine has been driven on, and
    // the byte's other bits are not documented here. Equality is the honest test — see patch.ts.
    check('k_rf_cfg: 0x00 fails despite bit 4 clear', !item('map_config').satisfied(new Uint8Array([0x00])));

    check('LTFT: MIN 100 / MAX 100 passes (empty window)',
        item('ltft_window').satisfied(new Uint8Array([degC(100), degC(100)])));
    check('LTFT: MIN 69 / MAX 100 fails (window open)',
        !item('ltft_window').satisfied(new Uint8Array([degC(69), degC(100)])));
    // Checked against THIS car's MAX, not a remembered 100: a car whose MAX is 80 is already frozen
    // at MIN 85, and demanding 100 would send it to a flash it does not need.
    check('LTFT: MIN 85 / MAX 80 passes without reaching 100 degC',
        item('ltft_window').satisfied(new Uint8Array([degC(85), degC(80)])));

    // -----------------------------------------------------------------------
    console.log('\n3. the patch');
    // -----------------------------------------------------------------------
    const { image: patched, changed } = buildPatchedImage(stock);
    check('all three items are reported changed', changed.length === 3, `changed ${changed.length}`);
    for (const it of PREFLIGHT_ITEMS) {
        const r = evaluate(it, slice(patched, it.id));
        check(`${it.symbol} PASSES after patch`, r.ok, `read "${r.current}"`);
    }
    check('the source image is not mutated',
        !PREFLIGHT_ITEMS.every(it => it.satisfied(slice(stock, it.id))));
    check('KF_BZ_WDK_VL is written as 1023 (102.3 %)',
        ((patched[0xAC54] << 8) | patched[0xAC54 + 1]) === 1023);
    check('k_rf_cfg is written as 0x02', patched[0xE5E4] === 0x02);
    check('K_LAA_TMOT_MIN is written as 100 degC', patched[0x4824] === 148);
    check('K_LAA_TMOT_MAX is left alone', patched[0x4825] === stock[0x4825]);

    for (const s of analyzeDataChecksum(patched)) {
        check(`${s.name} checksum is valid after patch`, s.isValid,
            `stored 0x${s.storedChecksum.toString(16)} calc 0x${s.calculatedChecksum.toString(16)}`);
    }
    check('stock image had valid checksums to begin with',
        analyzeDataChecksum(stock).every(s => s.isValid));

    // The patch must be surgical: 16 words + 1 byte + 1 byte + two 4-byte checksum slots.
    let diff = 0;
    for (let i = 0; i < patched.length; i++) if (patched[i] !== stock[i]) diff++;
    check('at most 32 + 1 + 1 + 8 bytes differ', diff <= 42, `${diff} bytes differ`);

    check('changedWindows names all three', changedWindows(stock, patched).length === 3);

    // Idempotence: re-patching an already-patched image must change nothing at all, including the
    // checksums — otherwise "no changes needed" and "flash again" would disagree.
    const again = buildPatchedImage(patched);
    check('re-patching reports no changes', again.changed.length === 0);
    check('re-patching is byte-identical', again.image.every((v, i) => v === patched[i]));

    // -----------------------------------------------------------------------
    console.log('\n4. writeCalibration hands over the backup BEFORE it destroys anything');
    // -----------------------------------------------------------------------
    {
        const l = new MockDmeLink();
        if (!supportsPreflight(l)) throw new Error('unreachable');
        const before = await l.readCalibration();

        // A box rather than a bare `let`: TypeScript does not track assignments made inside a
        // callback, so a plain variable narrows to `never` after the closure and `.every` stops
        // type-checking — which would quietly make this assertion unable to fail to compile.
        const captured: { backup: Uint8Array | null } = { backup: null };
        await l.writeCalibration({
            image: buildPatchedImage(before).image,
            onBackup: async (current) => { captured.backup = current.slice(); },
        });
        check('onBackup received the PRE-write image',
            captured.backup !== null && captured.backup.every((v, i) => v === before[i]));

        const after = await l.readCalibration();
        check('the write landed', PREFLIGHT_ITEMS.every(it => it.satisfied(slice(after, it.id))));
    }
    {
        // A rejecting backup handler must abort with the ECU untouched. On a real car this is the
        // difference between "no flash happened" and "the only copy of your calibration is gone".
        const l = new MockDmeLink();
        if (!supportsPreflight(l)) throw new Error('unreachable');
        const before = await l.readCalibration();
        let threw = false;
        try {
            await l.writeCalibration({
                image: buildPatchedImage(before).image,
                onBackup: async () => { throw new Error('caller refused to store the backup'); },
            });
        } catch { threw = true; }
        check('a rejecting onBackup aborts the write', threw);
        const after = await l.readCalibration();
        check('nothing was written when the backup was refused',
            after.every((v, i) => v === before[i]));
    }
    {
        const l = new MockDmeLink();
        if (!supportsPreflight(l)) throw new Error('unreachable');
        let threw = false;
        try {
            await l.writeCalibration({ image: new Uint8Array(1024), onBackup: async () => { } });
        } catch { threw = true; }
        check('a short image is refused', threw);

        // A supplied backup of the wrong size must be refused too — it is the only copy, and a
        // truncated one is not a copy.
        let threwBackup = false;
        try {
            const good = await l.readCalibration();
            await l.writeCalibration({
                image: buildPatchedImage(good).image,
                backup: new Uint8Array(1024),
                onBackup: async () => { },
            });
        } catch { threwBackup = true; }
        check('a short supplied backup is refused', threwBackup);
    }
    {
        const l = new MockDmeLink();
        if (!supportsPreflight(l)) throw new Error('unreachable');
        check('readEngineRpm reports a stopped engine offline', (await l.readEngineRpm()) === 0);
        const snap = await l.clearVanosAdaptations();
        check('clearVanosAdaptations returns a full snapshot', snap.readings.length >= 12,
            `${snap.readings.length} rows`);
        // Not all zero: two rows are multiplicative trims whose neutral is 1.0. A test asserting
        // "everything cleared to 0" would be asserting zero fuel.
        check('cleared values are the per-row neutral, not a blanket zero',
            snap.readings.some(r => r.value === 0) && snap.readings.some(r => r.value === 1));
    }
}

main().then(() => {
    console.log(failures === 0 ? '\nAll preflight checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
});

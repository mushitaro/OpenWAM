#!/usr/bin/env node
/**
 * Proves that every byte this app flashes an ECU with came from the tuner unmodified.
 *
 * WHY THIS EXISTS. The erase-then-write path in `webSerialDmeLink.ts` is the only thing in either
 * repository that can destroy hardware, and it is hardware that cannot be bought any more. It has
 * been proven on a real car exactly once — in `E46M3CSL_TuningTool`, not here. Porting it makes a
 * second copy that has never been near a car, so the only defensible claim this app can make about
 * it is "these bytes are that code". This script is what turns that claim into a check.
 *
 * It does NOT verify that the flash works. It verifies that the flash-critical modules and the
 * marked blocks inside partially-ported files are character-for-character what the tuner holds. A
 * well-meaning edit — a reordered constant, a "clearer" error message, a lint autofix — fails here
 * instead of on a car.
 *
 * The tuner is READ ONLY (owner's instruction). This script only reads from it, and it is the
 * mechanism by which "copy, never modify" is enforced in one direction rather than remembered.
 *
 * Exit codes: 0 identical (or the tuner is absent — see below), 1 a divergence.
 *
 * ABSENT TUNER. Anyone can build this app without a checkout of the tuner beside it, so a missing
 * source is a SKIP, not a failure — but a loud one, and it is reported as "unverified", never as
 * "passed". The check is a local gate, run by whoever is about to flash.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
/** Overridable so the check still runs when the tuner is checked out elsewhere. */
const TUNER = resolve(process.env.TUNER_SRC ?? join(APP, '..', '..', '..', 'E46M3CSL_TuningTool', 'src'));

/** Copied whole. Each must be byte-identical to its source. */
const WHOLE_FILES = [
    ['lib/checksum/crc16.ts', 'lib/checksum/crc16.ts'],
    ['lib/checksum/dmeDataChecksum.ts', 'lib/checksum/dmeDataChecksum.ts'],
    ['lib/dme-link/blockDecoder.ts', 'lib/dme-link/blockDecoder.ts'],
    ['lib/dme-link/adaptationBlocks.ts', 'lib/dme-link/adaptationBlocks.ts'],
];

/**
 * Files that carry verbatim blocks inside otherwise local code, and the tuner file each block must
 * appear in. The blocks are delimited by `// --- BEGIN VERBATIM <name> ---` / `// --- END VERBATIM
 * <name> ---`; the check is that the enclosed text occurs, unmodified, somewhere in the source file.
 *
 * A substring test rather than a line-range one on purpose: line numbers in the tuner drift with
 * every commit there, and a gate that goes red for a reason that is not a divergence is a gate that
 * gets switched off.
 */
const MARKED_FILES = [
    ['lib/dme-link/ds2.ts', 'lib/dme-link/ds2.ts'],
    ['lib/dme-link/webSerialDmeLink.ts', 'lib/dme-link/webSerialDmeLink.ts'],
];

const BEGIN = /^\/\/ --- BEGIN VERBATIM (.+?) ---$/;
const END = /^\/\/ --- END VERBATIM (.+?) ---$/;

/** Line endings only. Git may check the two repos out with different ones, and that is not a
 *  divergence in the code — everything else, whitespace included, is compared exactly. */
const normalize = (s) => s.replace(/\r\n/g, '\n');

function extractBlocks(text, path) {
    const lines = normalize(text).split('\n');
    const blocks = [];
    let open = null;
    let buf = [];
    lines.forEach((line, i) => {
        const b = BEGIN.exec(line);
        const e = END.exec(line);
        if (b) {
            if (open) throw new Error(`${path}:${i + 1}: BEGIN "${b[1]}" inside unclosed "${open}"`);
            open = b[1];
            buf = [];
            return;
        }
        if (e) {
            if (!open) throw new Error(`${path}:${i + 1}: END "${e[1]}" with no BEGIN`);
            if (e[1] !== open) throw new Error(`${path}:${i + 1}: END "${e[1]}" closes BEGIN "${open}"`);
            blocks.push({ name: open, body: buf.join('\n') });
            open = null;
            return;
        }
        if (open) buf.push(line);
    });
    if (open) throw new Error(`${path}: BEGIN "${open}" is never closed`);
    return blocks;
}

if (!existsSync(TUNER)) {
    console.warn(`[check-ported] SKIPPED — no tuner source at ${TUNER}.`);
    console.warn('[check-ported] The flash-critical modules are UNVERIFIED. Set TUNER_SRC and re-run');
    console.warn('[check-ported] before flashing an ECU with this build.');
    process.exit(0);
}

let failures = 0;
let checkedFiles = 0;
let checkedBlocks = 0;

for (const [mine, theirs] of WHOLE_FILES) {
    const a = join(APP, mine);
    const b = join(TUNER, theirs);
    if (!existsSync(a)) { console.error(`[check-ported] MISSING ${mine}`); failures++; continue; }
    if (!existsSync(b)) { console.error(`[check-ported] MISSING in tuner: ${theirs}`); failures++; continue; }
    if (normalize(readFileSync(a, 'utf-8')) !== normalize(readFileSync(b, 'utf-8'))) {
        console.error(`[check-ported] DIVERGED  ${mine}  !=  ${theirs}`);
        failures++;
    } else {
        checkedFiles++;
    }
}

for (const [mine, theirs] of MARKED_FILES) {
    const a = join(APP, mine);
    const b = join(TUNER, theirs);
    if (!existsSync(a)) { console.error(`[check-ported] MISSING ${mine}`); failures++; continue; }
    if (!existsSync(b)) { console.error(`[check-ported] MISSING in tuner: ${theirs}`); failures++; continue; }
    const source = normalize(readFileSync(b, 'utf-8'));
    let blocks;
    try {
        blocks = extractBlocks(readFileSync(a, 'utf-8'), mine);
    } catch (e) {
        console.error(`[check-ported] ${e.message}`);
        failures++;
        continue;
    }
    for (const { name, body } of blocks) {
        if (source.includes(body)) {
            checkedBlocks++;
        } else {
            console.error(`[check-ported] DIVERGED  ${mine} block "${name}" is not verbatim in ${theirs}`);
            failures++;
        }
    }
}

if (failures > 0) {
    console.error(`[check-ported] ${failures} divergence(s). These modules flash an ECU — fix the copy `
        + 'or, if the tuner genuinely changed, re-copy from it. Never edit the copy in place.');
    process.exit(1);
}
console.log(`[check-ported] OK — ${checkedFiles} whole file(s) and ${checkedBlocks} marked block(s) `
    + `are byte-identical to ${TUNER}`);

/**
 * 事前準備 — the calibration state the live VANOS sweep requires, as something measurable.
 *
 * All three constants live in the DME's flash, so setting them needs a full erase-and-rewrite. But
 * READING them is three small control-0x06 requests, and that is the half that earns its keep: it
 * turns "did I remember to patch?" from a memory into a fact, before a drive rather than after one.
 *
 * ## Why each one is here
 *
 * These are not general tuning options. Each one closes a specific way the sweep would silently
 * measure nothing:
 *
 *  - **KF_BZ_WDK_VL** is the throttle threshold at which the DME calls it full load, and full load
 *    is one of the conditions that switches the lambda controller OFF (Funktionsrahmen 5.01). The
 *    sweep's entire observable is the lambda integrator. Left stock, the integrator freezes at
 *    exactly the moment every WOT pull begins — the drive returns a full recording of a frozen
 *    number. This is the one that cannot be worked around afterwards.
 *  - **k_rf_cfg** bit 4 enables the MAP integral `rf_p_saug_i`, which corrects the load model
 *    towards measured manifold pressure. Any air the cams find would be absorbed by that integral
 *    instead of showing up in lambda — the improvement gets booked to the wrong account.
 *  - **K_LAA_TMOT_MIN vs MAX** is the coolant window in which long-term fuel adaptation learns.
 *    Learning during a sweep would slowly re-book the same improvement a third way.
 *
 * ## The predicates are functional, not "equals what the tuner writes"
 *
 * Each `satisfied` test asks whether the DME will actually behave the way the sweep needs, not
 * whether the bytes match one reference car. `K_LAA_TMOT_MIN >= K_LAA_TMOT_MAX` is the real
 * property (an empty window), and it is checked against this car's own MAX rather than against the
 * 100 degC that happens to be in one binary. The exception is `k_rf_cfg`, which is tested for
 * equality on purpose: bit 4 is the documented mechanism, but the byte's other bits are not
 * documented here, and 0x02 is the only value this engine has actually been driven on.
 */
import { correctDataChecksum, DATA_PAIR_LENGTH } from '@/lib/checksum/dmeDataChecksum';

/**
 * One preflight requirement.
 *
 * `offset`/`length` address the 65536-byte DataTune image ([slave 0x0000-0x7FFF | master
 * 0x8000-0xFFFF]), which is the same numbering the XDF uses, so an address copied out of the XDF
 * needs no translation. `WebSerialDmeLink.readCalibrationBytes` takes the same numbering.
 */
export interface PreflightItem {
    id: 'wot_threshold' | 'map_config' | 'ltft_window';
    /** Driver-facing name. */
    label: string;
    /** The calibration symbol, so a reading can be checked against the XDF by hand. */
    symbol: string;
    offset: number;
    length: number;
    /** What this stops the sweep from silently measuring wrong. One sentence, for the panel. */
    why: string;
    /** Whether the bytes as read satisfy the requirement. */
    satisfied(bytes: Uint8Array): boolean;
    /** What the bytes say, in units, for the panel to show beside the verdict. */
    describe(bytes: Uint8Array): string;
    /** What it has to become. Shown next to `describe` so a FAIL states both sides. */
    required: string;
    /** Writes this requirement into a full 65536-byte image, in place. */
    apply(image: Uint8Array): void;
}

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

/** `KF_BZ_WDK_VL` Z data — 4 rows x 4 cols of u16, scaled x/10 into throttle %. */
const WOT_THRESHOLD_Z = 0xAC54;
const WOT_CELLS = 16;
/** 102.3 %, above anything the throttle can report. The tuner's own DISABLED_RAW. */
const WOT_DISABLED_RAW = 1023;
/**
 * Above 100.0 %, i.e. unreachable. The functional test, and deliberately looser than
 * `=== WOT_DISABLED_RAW`: a car already patched to 1010 is just as closed-loop as one at 1023, and
 * failing it would send the owner to re-flash for nothing. Matches the tuner's own `wasDisabled`.
 */
const WOT_UNREACHABLE_RAW = 1000;

/** `k_rf_cfg`, master, one byte. Bit 4 (0x10) is the MAP integral. */
const MAP_CONFIG = 0xE5E4;
const MAP_CONFIG_PATCHED = 0x02;

/** `K_LAA_TMOT_MIN` and `K_LAA_TMOT_MAX`, adjacent slave bytes. Raw = degC + 48. */
const LTFT_WINDOW = 0x4824;
const LTFT_MIN_C = 100;
const rawToC = (raw: number) => raw - 48;
const cToRaw = (c: number) => c + 48;

export const PREFLIGHT_ITEMS: readonly PreflightItem[] = [
    {
        id: 'wot_threshold',
        label: '全開時のλ制御を有効化',
        symbol: 'KF_BZ_WDK_VL',
        offset: WOT_THRESHOLD_Z,
        length: WOT_CELLS * 2,
        why: '純正のままだと全開でλ制御が開ループになり、積分器が凍結します。'
            + '掃引の観測量そのものが消えるため、これが未処理だと走っても何も取れません。',
        satisfied: (b) => {
            for (let i = 0; i < WOT_CELLS; i++) if (u16(b, i * 2) <= WOT_UNREACHABLE_RAW) return false;
            return true;
        },
        describe: (b) => {
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < WOT_CELLS; i++) {
                const v = u16(b, i * 2) / 10;
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            return lo === hi ? `全 16 セル ${lo.toFixed(1)} %` : `${lo.toFixed(1)}–${hi.toFixed(1)} %`;
        },
        required: '全 16 セルが 100.0 % 超（書き込み値 102.3 %）',
        apply: (image) => {
            for (let i = 0; i < WOT_CELLS; i++) {
                image[WOT_THRESHOLD_Z + i * 2] = (WOT_DISABLED_RAW >> 8) & 0xFF;
                image[WOT_THRESHOLD_Z + i * 2 + 1] = WOT_DISABLED_RAW & 0xFF;
            }
        },
    },
    {
        id: 'map_config',
        label: 'MAP 補償を停止',
        symbol: 'k_rf_cfg',
        offset: MAP_CONFIG,
        length: 1,
        why: 'MAP 積分（rf_p_saug_i）が生きていると、カムが稼いだ空気をそちらが吸収してしまい、'
            + 'λ に現れません。改善が別の勘定に付け替えられます。',
        satisfied: (b) => b[0] === MAP_CONFIG_PATCHED,
        describe: (b) => `0x${b[0].toString(16).toUpperCase().padStart(2, '0')}`
            + `（bit4 MAP 積分 ${(b[0] & 0x10) ? 'ON' : 'OFF'}）`,
        required: '0x02',
        apply: (image) => { image[MAP_CONFIG] = MAP_CONFIG_PATCHED; },
    },
    {
        id: 'ltft_window',
        label: '長期学習を凍結',
        symbol: 'K_LAA_TMOT_MIN / MAX',
        offset: LTFT_WINDOW,
        length: 2,
        // MIN >= MAX empties the window, so the DME never enters the state where it learns. Reading
        // both bytes is what makes this checkable on THIS car rather than against a remembered 100.
        why: '学習が生きていると、掃引中に得た改善を燃料補正として少しずつ覚え込み、'
            + 'λ の読みが時間とともにずれていきます。',
        satisfied: (b) => b[0] >= b[1],
        describe: (b) => `MIN ${rawToC(b[0])} °C / MAX ${rawToC(b[1])} °C`
            + `（${b[0] >= b[1] ? '学習ウィンドウなし' : '学習が有効'}）`,
        required: 'MIN ≧ MAX（書き込み値 MIN 100 °C）',
        apply: (image) => { image[LTFT_WINDOW] = cToRaw(LTFT_MIN_C); },
    },
];

/** One item's verdict, with the reading that produced it. */
export interface PreflightReading {
    item: PreflightItem;
    bytes: Uint8Array;
    ok: boolean;
    current: string;
}

export function evaluate(item: PreflightItem, bytes: Uint8Array): PreflightReading {
    if (bytes.length !== item.length) {
        throw new Error(`${item.symbol}: ${bytes.length} バイト読めましたが ${item.length} バイト必要です`);
    }
    return { item, bytes, ok: item.satisfied(bytes), current: item.describe(bytes) };
}

/**
 * Applies every unsatisfied requirement to a copy of the image and corrects both data checksums.
 *
 * Returns a NEW buffer — the caller keeps the one it read from the car, which is the backup. Items
 * that already pass are not written: a byte that does not need to change should not be in the diff,
 * so a mismatch after the flash points at something real.
 *
 * The checksum correction is not optional. The DME validates its own data CRCs, and an image
 * flashed without them corrected is a calibration the ECU will refuse or mistrust.
 */
export function buildPatchedImage(current: Uint8Array): { image: Uint8Array; changed: PreflightItem[] } {
    if (current.length !== DATA_PAIR_LENGTH) {
        throw new Error(`${DATA_PAIR_LENGTH} バイトの BIN が必要です（${current.length} バイト受領）`);
    }
    const image = new Uint8Array(current);
    const changed: PreflightItem[] = [];
    for (const item of PREFLIGHT_ITEMS) {
        const slice = current.subarray(item.offset, item.offset + item.length);
        if (item.satisfied(slice)) continue;
        item.apply(image);
        changed.push(item);
    }
    if (changed.length > 0) correctDataChecksum(image);
    return { image, changed };
}

/**
 * The byte ranges a flash actually changed, for a targeted read-back.
 *
 * Cheap enough to run after every flash without anyone weighing it up, and it answers the one
 * question a whole-image comparison can also answer but nobody re-runs: are the bytes we came here
 * to change actually different now?
 */
export function changedWindows(before: Uint8Array, after: Uint8Array): { offset: number; length: number }[] {
    return PREFLIGHT_ITEMS
        .map(i => ({ offset: i.offset, length: i.length }))
        .filter(w => {
            for (let i = 0; i < w.length; i++) {
                if (before[w.offset + i] !== after[w.offset + i]) return true;
            }
            return false;
        });
}

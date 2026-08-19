/**
 * TSUNAGI ///M chart theme — the single place chart colours are defined.
 *
 * Tailwind classes cannot reach a recharts/plotly config, so these hexes are set
 * by hand from the ///M ramps. They were previously duplicated as GRID/TICK/AXIS
 * constants in five components (TuningResults, VeSurfaceChart, VeOverlayChart,
 * ValidityPanel, VETableComparison), each with its own copy of the same value —
 * which is how a chart ends up a different grey from the one beside it.
 *
 * Series colours are assigned by SEMANTIC ROLE, not by looks. The accent set is
 * the ///M tricolour only (blue = primary/output, violet = measured/diagnostic,
 * red = heat), so with one hue family serving several channels **dash pattern
 * and line weight are part of the encoding, not decoration**: a `soll` trace is
 * the same hue as its `ist` and is told apart by the dash.
 */

/** Chart chrome. Plot stays transparent and inherits the app's black surface. */
export const CHART = {
    paper: "rgba(0,0,0,0)",
    grid: "#17171C",        // slate-800
    zeroline: "#2A2A33",    // slate-700
    tick: "#9A9AA8",        // slate-400
    tickDim: "#70707E",     // slate-500
    /** A pointer is not a reading — the cursor never takes an accent. */
    cursor: "#F2F2F5",      // slate-100
    hoverBg: "rgba(23,23,28,0.95)",
    hoverBorder: "#2A2A33",
    hoverText: "#F2F2F5",
    spike: "rgba(154,154,168,0.2)",
} as const;

/** Back-compat aliases for the constants the chart components used to declare. */
export const GRID = CHART.grid;
export const TICK = CHART.tick;
export const AXIS = { color: CHART.tick, gridcolor: CHART.grid, zerolinecolor: CHART.zeroline };

/**
 * Data series by role. `dash` is a recharts `strokeDasharray`.
 * Roles follow references/color-system.md -> "Data-series palette".
 */
export const SERIES = {
    /** primary / output */
    rpm: { color: "#0A9BDB" },
    simVe: { color: "#0A9BDB", width: 2 },
    /** measured feedback (primary sensor) — violet, so it never competes with sim */
    measuredVe: { color: "#B9A6EE", width: 2 },
    stockVe: { color: "#B9A6EE", dash: "4 3" },
    /** computed / derived diagnostic */
    rf: { color: "#9B84E8" },
    ro: { color: "#CBBCF2" },
    /** measured pressure */
    map: { color: "#B9A6EE" },
    /** cams: bank hue + dash for target-vs-actual */
    evanIst: { color: "#26AEE4" },
    evanSoll: { color: "#26AEE4", dash: "4 3" },
    avanIst: { color: "#9B84E8" },
    avanSoll: { color: "#9B84E8", dash: "4 3" },
    /** heat: ignition proximity to knock, and exhaust temperature */
    ignition: { color: "#F87A7F" },
    egt: { color: "#F87A7F" },
    /** raw / reference */
    reference: { color: "#9A9AA8" },
} as const;

/**
 * Caution marks (model-limit bands, bistable markers).
 * `edge` is amber-700 at 3.2:1 — usable for a border, NEVER for text or a glyph;
 * label text uses `text` (amber-400, 9.8:1).
 */
export const CAUTION = {
    fill: "#B9A6EE",
    edge: "#7E63DB",
    text: "#B9A6EE",
} as const;

/**
 * Ordered palette for multi-series charts (waveform inspector), lightness-spaced
 * inside the tricolour so adjacent traces stay separable without a fourth hue.
 */
export const SERIES_CYCLE = [
    "#26AEE4", // blue-400
    "#B9A6EE", // violet
    "#F87A7F", // red-300
    "#6CCBEF", // ice blue (light)
    "#7E63DB", // violet, darker
    "#F64A50", // red-400
    "#B6E4F5", // ice blue
    "#CBBCF2", // violet, lightest
] as const;

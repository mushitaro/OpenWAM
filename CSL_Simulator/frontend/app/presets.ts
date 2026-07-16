// Vehicle presets (Stage 74 app-reflection).
//
// V14_OWNER  — the owner-car digital twin validated in Stage 70-74 (real
//              measured intake/exhaust dims + muffler internals). Single
//              source of truth = presets/v14_owner.json, which the backend
//              parity gate (scripts/v14_parity_check.py) also reads: a run
//              from this preset must produce byte-identical solver decks to
//              the research baseline (calib_data/stage74_v14_jobs.json).
// LEGACY_NEUTRAL — the Stage-69 model baseline: every field equals the
//              backend models.py default, so POSTing it is deck-equivalent
//              to an empty SimConfig(). Used as the merge base when loading
//              old saved projects (missing keys resolve to what those runs
//              actually used) and as a reset target.
//
// Parity notes (bugs the old inline default carried, fixed here):
//  - Wiebe 65/2.2 → 60/2.0 and duration_cycles 30 → 60 (research decks)
//  - bellmouth 150 → 170 (Stage 63 adopted measurement)
//  - section1 layout "Independent"(=straight) → "X-Pipe" (owner crosspipe)
//  - resonator_length was sent as 300 with resonator_fitted=false, but the
//    generator gates on length>0 — the UI was silently adding a resonator.
//    Neutral = 0; the checkbox now drives the length (VehicleBuilder).
import type { SimConfig } from "./api";
import v14OwnerJson from "../presets/v14_owner.json";

// Deep-merge (no proto pollution); arrays and scalars replace, objects merge.
export const deepMerge = (base: any, patch: any): any => {
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
    const out: any = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
    for (const k of Object.keys(patch)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        out[k] = deepMerge(out[k], patch[k]);
    }
    return out;
};

export const V14_OWNER: SimConfig = v14OwnerJson as unknown as SimConfig;

export const LEGACY_NEUTRAL: SimConfig = {
    environment: { ambient_temp: 298, ambient_pressure: 101325 },
    fuel: { lcv: 44000000, density: 750, stoich_ratio: 14.7 },
    simulation: { mesh_size: 0.01, openwam_version: 2200, duration_cycles: 60, step_size: 1.0 },
    intake: {
        type: "CSL Replica",
        inlet: { duct_length: 400, duct_diameter: 190, exit_width: 550, exit_height: 190, filter_diameter: 300, filter_thickness: 20 },
        plenum_vol: 22.9,
        bellmouth: { length: 170, diameter: 52, taper_angle: 3.5 },
        itb: { fitted: true, diameter: 52, plate_thickness: 2, discharge_coeff_map: "default_butterfly" },
        throttle: { idle_offset_deg: 2.0, pedal_gamma: 1.4 },
        runner: { upper_length: 10, lower_length: 60, entry_diameter: 70, length_scale: 1.0, friction_multiplier: 1.0 },
        eq_tube: {
            enabled: true, model: "rail",
            stub_diameter: 30, stub_length: 75, stub_friction: 0.02,
            volume_scale: 1.0, mistune_spread: 0.0,
            rail_diameter: 21, rail_length: 570,
            rail_tap_diameter: 30, rail_tap_length: 30,
            rail_tap_taper_end: null,
            return_pipe_diameter: 21, return_pipe_length: 250,
            return_tap: "center", icv_sigma: 0.15,
            rail_friction: 0.1, rail_tap_friction: 0.1,
        },
        head_return: { enabled: false, pipe_diameter: 19, pipe_length: 400, volume: 3.0, friction: 0.1, wall_temp: 90 },
    },
    engine: {
        cam_profile: "S54 Standard (260°/260°)",
        rpm: 7900,
        cylinders: 6,
        geometry: { bore: 87.0, stroke: 91.0, compression_ratio: 11.5, rod_length: 139.0 },
        combustion: { duration: 60.0, start_angle: -15.0, shape_parameter_m: 2.0, efficiency_a: 6.9, mass_burned_b: 0.5 },
        vanos_intake_bias: 0.0,
        vanos_exhaust_bias: 0.0,
        friction: { coeffs: [0.9, 0.12, 0, 0] },
        heat_transfer: { woschni_coeffs: [128.0, 2.28, 0.0], global_factor: 1.0 },
        head: {
            port_flow_coeff: 1.0,
            valves_per_cyl: 4,
            wall_temp: 450,
            intake_port_wall_temp: 127,
            intake_port: { length: 105, diameter: 52, wall_temp: 400 },
            exhaust_port: { length: 90, diameter: 48, wall_temp: 800 },
            intake_valve: { lift_profile: "Stock", max_lift: 11.8, duration: 260, diameter: 35, open_angle_base: 350, flow_coeff_map: "S54_In" },
            exhaust_valve: { lift_profile: "Stock", max_lift: 11.2, duration: 260, diameter: 30.5, open_angle_base: 130, flow_coeff_map: "S54_Ex" },
        },
    },
    exhaust: {
        headers: {
            type: "Stock Euro", collector_count: 2,
            primary_length: 300, primary_diameter: 48,
            primary_end_diameter: null,
            collector_vol: 1.5, collector_dia: 68, collector_length: 500,
            wall_temp: 800, heat_coeff: 45, header_friction: 0.02,
        },
        catalyst: { installed: true, location: "header_collector", cpsi: 200, length: 200, diameter: 120 },
        section1_1: {
            name: "Section 1 (Bank 1)", layout: "X-Pipe", crossover_type: "none",
            length: 1200, diameter: 68,
            cat_fitted: true, cat_offset: 600, crossover_offset: 600,
            cross_to_cat: 0, cat_taper_length: 0, wall_temp: 600,
        },
        section1_2: {
            name: "Section 1 (Bank 2)", layout: "X-Pipe", crossover_type: "none",
            length: 1200, diameter: 68,
            cat_fitted: true, cat_offset: 600, crossover_offset: 600,
            cross_to_cat: 0, cat_taper_length: 0, wall_temp: 600,
        },
        section2: {
            name: "Section 2", layout: "H-Pipe",
            length: 1400, diameter: 68, h_offset: 400,
            resonator_fitted: false, resonator_location: "before_h",
            resonator_length: 0, resonator_diameter: 90,
            resonator_offset: 400, resonator_friction: 0.1,
            cat_fitted: false, cat_offset: 200, wall_temp: 600,
        },
        section3: {
            volume: 15.0, tailpipe_length: 150, diameter: 68,
            internal_model: "single", chamber_split: 0.6,
            pass1_length: 1700, pass2_length: 2900,
            pass_diameter: 50, pass_friction: 0.1, pass_entry_diameter: 0,
        },
    },
} as unknown as SimConfig;

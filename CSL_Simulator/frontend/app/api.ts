
// Phase 9: Modular Topology Expansion

export interface CalibrationResult {
    rpm: number;
    tps: number;
    ve_sim: number;
    mass_mg: number;
    power_kw: number;
    ve_stock?: number;
    error_pct?: number;
    correction_factor?: number;
}

export interface CalibrationMatrix {
    rpm: number[];
    load: number[]; // Added Load Axis (Rows)
    target: number[][];
    sim: number[][];
    correction: number[][];
}

export interface CalibrationResponse {
    curve: CalibrationResult[];
    matrix: CalibrationMatrix;
}

// 1. Intake System
export interface InletConfig {
    duct_length: number;
    duct_diameter: number;
    // plenum-side slot opening (measured car 550x190); null = circular exit
    exit_width?: number | null;
    exit_height?: number | null;
    filter_diameter?: number;
    filter_thickness?: number;
}

export interface BellmouthConfig {
    length: number;
    diameter: number;
    taper_angle: number;
}

export interface ITBConfig {
    fitted: boolean;
    diameter: number;
    plate_thickness: number;
    discharge_coeff_map: string;
}

export interface ThrottleConfig {
    idle_offset_deg: number;
    pedal_gamma: number;
}

export interface RunnerConfig {
    upper_length: number;
    lower_length: number;
    entry_diameter: number;
    length_scale: number;
    friction_multiplier: number;
}

export interface EqTubeConfig {
    enabled: boolean;
    model: string;          // "plenum" | "chain" | "rail" (ICV-vented common rail)
    stub_diameter: number;
    stub_length: number;
    stub_friction: number;
    volume_scale: number;
    mistune_spread: number;
    // "rail" model (measured car; PLAN_PARTLOAD_CALIBRATION.md)
    rail_diameter?: number;
    rail_length?: number;
    rail_tap_diameter?: number;
    rail_tap_length?: number;
    return_pipe_diameter?: number;
    return_pipe_length?: number;
    return_tap?: string;    // "center" | "cyl1_end" | "cyl6_end"
    icv_sigma?: number;     // FIT parameter (Phase 4A), not measured
    rail_friction?: number;      // 0.1 kills the 2700-WOT cross-feed collapse
    rail_tap_friction?: number;
    // Stage 70: tapered runner->rail branch (owner car: phi30 boss -> phi21
    // hose, the representable form of the real phi10 pipe). null = straight.
    rail_tap_taper_end?: number | null;
}

// Stage 70-71: head (cam cover) -> plenum crankcase-vent return hose.
// Owner car: phi15 x 250mm into a ~2L effective head volume.
export interface HeadReturnConfig {
    enabled: boolean;
    pipe_diameter: number;  // mm
    pipe_length: number;    // mm
    volume: number;         // L (cam cover + passages, effective)
    friction: number;
    wall_temp: number;      // degC
}

export interface IntakeConfig {
    type: string;
    inlet: InletConfig;
    plenum_vol: number;
    bellmouth: BellmouthConfig;
    itb: ITBConfig; // New ITB Module
    throttle: ThrottleConfig;
    runner: RunnerConfig;
    eq_tube: EqTubeConfig;
    head_return: HeadReturnConfig;
}

// 2. Engine Core
export interface EngineGeometry {
    bore: number;
    stroke: number;
    compression_ratio: number;
    rod_length: number;
    // Piston Area & Head Area are computed derived values, typically not config inputs but can be overrides?
    // We will compute them in Python unless user wants to override Piston Geometry explicitly.
}

export interface CombustionConfig {
    duration: number;
    start_angle: number;
    shape_parameter_m: number;
    efficiency_a: number;
    mass_burned_b: number;
}

export interface ValveConfig {
    lift_profile: string;
    max_lift: number;
    duration: number;
    diameter: number; // New: Valve Head Diameter
    open_angle_base: number; // New: Base Timing
    flow_coeff_map: string;
}

export interface HeadConfig {
    port_flow_coeff: number;
    valves_per_cyl: number;
    wall_temp: number;
    intake_port_wall_temp?: number;
    port_friction?: number;

    // Detailed Port Geometry (New)
    intake_port: { length: number; diameter: number; wall_temp: number; };
    exhaust_port: { length: number; diameter: number; wall_temp: number; };

    intake_valve: ValveConfig;
    exhaust_valve: ValveConfig;
}

export interface EngineConfig {
    cam_profile: string;
    rpm: number; // Added specific RPM target
    cylinders: number; // Added Cylinder count

    geometry: EngineGeometry;
    combustion: CombustionConfig;

    vanos_intake_bias: number;
    vanos_exhaust_bias?: number;
    head: HeadConfig;

    // Friction & Woschni (Advanced)
    friction: { coeffs: number[] };         // 0.5 0 0 0
    heat_transfer: { woschni_coeffs: number[]; global_factor: number; };
}

// 3. Exhaust System (Modular Toplogy)
export type ExhaustLayoutType = "Straight" | "X-Pipe" | "H-Pipe" | "Merge 2-into-1" | "Split 1-into-2" | "Custom";

export interface HeaderConfig {
    type: string;
    primary_length: number;
    primary_diameter: number;
    collector_count: number;
    collector_dia: number;
    wall_temp: number;
    heat_coeff: number;
    header_friction?: number;
    // Stage 71 (owner-measured): collector body length (legacy hardcode was
    // 500mm; real car 90mm) and primary exit bore (null = legacy taper to
    // collector_dia; owner car 37.6 = no taper).
    collector_length?: number;
    primary_end_diameter?: number | null;
}

export interface ExhaustSectionConfig {
    name: string;
    layout: string; // ExhaustLayoutType
    length: number;
    diameter: number;
    cat_fitted: boolean;
    cat_offset: number;
    wall_temp: number;
}

// Detailed Section Interfaces (extending generic config)
export interface Section1Config extends ExhaustSectionConfig {
    crossover_type: string; // Alias for layout logic
    crossover_offset: number;
    // Stage 71 (owner-measured): straight run after the crossover and the
    // taper into the catalyst (cross -> 440mm -> 120mm taper -> cat).
    // 0 = legacy (cat starts at the X junction).
    cross_to_cat?: number;      // mm
    cat_taper_length?: number;  // mm
}

export interface Section2Config extends ExhaustSectionConfig {
    resonator_fitted: boolean;
    resonator_location: "before_h" | "after_h";
    resonator_length: number;   // mm
    resonator_diameter: number; // mm
    // Stage 72 (owner's stock-exhaust diagram): H sits right after the cats
    // (real 80mm; legacy hardcode 400) and a straight-through resonator sits
    // mid-pipe (offset = H-exit -> resonator inlet).
    h_offset?: number;            // mm
    resonator_offset?: number;    // mm
    resonator_friction?: number;
}

export interface Section3Config extends ExhaustSectionConfig {
    muffler_type: string;
    tailpipe_length: number;
    // Stage 72-74: multi-pass reflection internals (owner diagram; DME doc
    // p37 "funnel-shaped openings"). "single" = legacy one-volume.
    internal_model?: "single" | "chambers";
    chamber_split?: number;        // ChamberA volume fraction
    pass1_length?: number;         // mm (180-deg path)
    pass2_length?: number;         // mm (360-deg path)
    pass_diameter?: number;        // mm
    pass_friction?: number;
    pass_entry_diameter?: number;  // mm funnel entry; 0 = straight
}

export interface EnvironmentConfig {
    ambient_temp: number;
    ambient_pressure: number;
}

export interface ExhaustConfig {
    headers: HeaderConfig & { collector_vol: number; }; // Added Collector Volume
    port_junction_vol?: number;   // cc; >0 small plenum, <=0 plenumless Type-12 (validated)
    exhaust_port_mesh?: number;   // m; exhaust-port pipe mesh (default 0.010)
    muffler_friction?: number;
    // Stage 78: exhaust-main dx scale (0.5 = mesh-converged refinement; 1.0 legacy)
    main_dx_scale?: number;
    section1_1: Section1Config; // Bank 1 (Cyl 1-3)
    section1_2: Section1Config; // Bank 2 (Cyl 4-6)
    section2: Section2Config;
    section3: Section3Config & { volume: number; title: string }; // Muffler Vol
    catalyst: { installed: boolean; location: "header_collector" | "section1_end"; cpsi: number; length: number; diameter: number; }; // Global Cat Config or per bank? 
    // User asked for independent length/dia. Catalyst usually shared spec but maybe different units?
    // "1,2,3... and 4,5,6... independently set... length/dia/catalyst".
    // So catalyst config should also be per bank if "location specific". 
    // But usually simple model has same cat type. I'll stick to section pipe geometry for now.
    // Wait, user said "each limit length/dia before/after catalyst".
    // So Section 1 is "Pipe -> Cat -> Pipe". 
    // The "Cat parameter" (CPSI/Length/Dia) might be per bank too?
    // Let's assume Cat Type is same, but pipe lengths are different.
}

export interface FuelConfig {
    lcv: number;
    density: number;
    stoich_ratio: number; // For equivalence ratio calc if needed, usually 14.7
}

export interface SimConfig {
    environment: EnvironmentConfig;
    intake: IntakeConfig;
    engine: EngineConfig;
    exhaust: ExhaustConfig;

    // New Global / Advanced Sections
    fuel: FuelConfig;
    simulation: {
        mesh_size: number;
        openwam_version: number;
        duration_cycles: number;
        step_size: number;
    };
}

// --- M1 structured Run response (UX_APP_DEV_SPEC §5/§8) ---------------------
export type TrafficStatus = "green" | "yellow" | "red";

export interface CellHealth {
    converged: boolean;
    slope: number | null;
    cyc: number;
    cyl_ok: boolean;
    cyl_spread: number | null;
    nan_free: boolean;
    ve_in_band: boolean;
    valid: boolean;
}

export interface VeCell {
    rpm: number;
    tps: number;
    ve_sim: number;
    ve_stock: number | null;
    stock_source?: "wideband" | "ecu_map" | null;  // WOT = measured wideband; part load = kf_rf_soll
    mass_mg: number;
    power_kw: number;
    health: CellHealth;
}

export interface RunRow {
    load: number;
    r: number | null;
    max_shape_err: number | null;
    peak_rpm_sim: number | null;
    peak_rpm_stock: number | null;
    peak_match: boolean | null;
    range_sim_pp: number | null;
    range_stock_pp: number | null;
    tilt_sim: number | null;
    tilt_stock: number | null;
    wot_ratio_maxdp: number | null;
    score: number;
    status: TrafficStatus;
    n_trusted: number;
    n_gated: number;
    // Stage 74 supplementary (additive; §5 score/status untouched): the same
    // metrics excluding the 3900-5300 model-limit band (WOT rows only).
    r_ex_limit?: number | null;
    max_shape_err_ex_limit?: number | null;
}

export interface RunOverall {
    r: number | null;
    max_shape_err: number | null;
    score: number;
    status: TrafficStatus;
    verdict: string;
    any_red_health: boolean;
    n_cells: number;
    n_converged: number;
    n_cyl_ok: number;
}

export interface StockPoint { rpm: number; ve: number; }

// --- Stage 74 provenance (schema_version 2) ---------------------------------
export interface ModelLimits {
    wot_deficit_band: {
        load_min: number; rpm_min: number; rpm_max: number;
        label_ja: string; note: string; treatment: string;
    };
    bistable_cells: { rpm: number; load_min: number; amplitude_pp: number; note: string }[];
}

export interface ProvenanceFields {
    created_at?: string;                 // ISO8601 UTC (schema v2+)
    unit?: "rf_ecu" | "ve_legacy";       // scoring unit (v2+; absent = legacy)
    m_ref_mg?: number;                   // reference mass the VE% is scaled by
    model_limits?: ModelLimits;
}

export interface MetaResponse {
    app_version: string;
    sim_binary_sig: string;
    schema_version: number;
    unit: "rf_ecu" | "ve_legacy";
    m_ref_mg: number;
    model_limits: ModelLimits;
}

export interface RunResponse extends ProvenanceFields {
    schema_version: number;
    mode: "wot_quick" | "full_map";
    run_id: string;
    sim_binary_sig: string;
    calib: { alpha: number; w: number };
    axes: { rpm: number[]; load: number[] };
    cells: VeCell[][];          // [loadRow][rpmCol]
    rows: RunRow[];
    overall: RunOverall;
    stock_curve: StockPoint[];
    logs: string;
    status: string;
    elapsed_sec: number;
    results?: { rpm: number; tps: number; ve_sim: number; mass_mg: number; power_kw: number }[];
}

// --- M3b crank-angle waveform (UX_APP_DEV_SPEC §6.B-2(ii)) -----------------
export type WaveformGroup = "cylinder" | "intake" | "exhaust";

export interface WaveformTrace {
    id: number;            // pipe id or cylinder id
    label: string;         // semantic label, e.g. "Header_1", "Cyl 1"
    group: WaveformGroup;
    pressure_bar: number[];        // aligned to crank_deg
    velocity_ms?: number[] | null; // pipes only (in-cylinder has no velocity)
}

export interface WaveformResponse extends ProvenanceFields {
    run_id: string;
    sim_binary_sig: string;
    rpm: number;
    load: number;          // TPS %
    is_wot: boolean;
    n_cycles: number;      // cycles present in the INS.DAT
    crank_deg: number[];   // last COMPLETE cycle, 0..720 (4-stroke)
    cylinders: WaveformTrace[];
    pipes: WaveformTrace[];
    elapsed_sec: number;
    status: string;
    note?: string | null;
    cached?: boolean;       // true when served from the parsed-waveform cache
}

// --- M4 VANOS tuning (UX_APP_DEV_SPEC §7) ----------------------------------
export interface TuneEvalHealth {
    converged: boolean;
    slope: number | null;
    cyc: number;
    cyl_ok: boolean;
    nan_free: boolean;
    ve_in_band: boolean;
    blew_up: boolean;
}

export interface TuneEval {
    rpm: number;
    intake_cam: number;   // physical cam target (KF table value, deg)
    exhaust_cam: number;
    ve: number;
    valid: boolean;       // health-gated (converged, cyl-balanced, in-band, ...)
    health: TuneEvalHealth;
}

export interface TuneCell {
    rpm: number;
    stock: TuneEval;               // baseline at the stock table cams
    best: TuneEval | null;         // MAX_VE winner (null if nothing valid)
    smooth: TuneEval | null;       // SMOOTH selection over the evaluated set
    chosen: TuneEval;              // per the requested preference
    delta_ve: number | null;
    n_evals: number;
    confidence: "ok" | "low";      // low = far-from-stock (§4.C) or sick baseline
}

export interface EcuTable {
    name: string;                  // e.g. "KF_EVAN1_SOLL"
    unit: string;
    x_axis: number[];              // rpm breakpoints
    y_axis: number[];              // load breakpoints
    values: number[][];            // [loadRow][rpmCol]; WOT row replaced
    wot_row_index: number;
}

export interface OptimizationResponse extends ProvenanceFields {
    schema_version: number;
    mode: "optimization";
    run_id: string;
    sim_binary_sig: string;
    preference: "max_ve" | "smooth";
    budget: number;
    bounds: { intake: number[]; exhaust: number[] };
    cells: TuneCell[];
    tables: { intake: EcuTable; exhaust: EcuTable };
    stock_curve: StockPoint[];
    n_evals_total: number;
    failed_rpms: number[];         // rpm cells whose search crashed (rest kept)
    low_confidence_note: string;
    status: string;
    elapsed_sec: number;
}

const API_BASE_URL = "http://localhost:8000";

// --- Stage 76: DS2 live-telemetry logs ---------------------------------------
export interface TelemetryLogMeta {
    created_at?: string;
    n_samples?: number;
    source?: "webserial" | "mock";
    vin?: string;
    software?: string;
    blocks?: number[];
    note?: string;
    complete?: boolean;      // false = checkpoint of a recording still running
    decoder_version?: number;  // block-decode revision the samples were read with
}

export interface TelemetryLogSummary { log_id: string; meta: TelemetryLogMeta; }

/** Persist a recording into the repo (backend/app/data/telemetry/<id>.json).
 *  Pass logId to overwrite an in-progress recording's file (checkpointing);
 *  omit it to mint a new one. */
export const saveTelemetryLog = async (
    samples: unknown[], meta: TelemetryLogMeta, logId?: string | null,
): Promise<{ log_id: string; n_samples: number; path: string }> => {
    const response = await fetch(`${API_BASE_URL}/telemetry/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples, meta, log_id: logId ?? undefined }),
    });
    if (!response.ok) throw new Error(`telemetry save failed: ${response.statusText}`);
    return response.json();
};

export const fetchTelemetryLogs = async (): Promise<TelemetryLogSummary[]> => {
    const response = await fetch(`${API_BASE_URL}/telemetry/logs`);
    if (!response.ok) throw new Error(`telemetry list failed: ${response.statusText}`);
    return (await response.json()).logs as TelemetryLogSummary[];
};

// --- Stage 76 P2: measured-vs-sim validation ---------------------------------
export interface ValidationCell {
    rpm: number; ro: number; hits: number;
    rf_mean: number | null; rf_std: number | null;
    rf_drrel_mean: number | null; rf_psau_mean: number | null;
    map_mbar_mean: number | null;
    sim_ve: number | null; sim_valid: boolean;
    delta: number | null;                       // rf_mean − sim_ve [pp, ECU unit]
    evan_ist: number | null; evan_soll: number | null;
    avan_ist: number | null; avan_soll: number | null;
    evan_map: number | null; avan_map: number | null;
    tz_mean: number | null; tz_expected: number | null;
}

export interface ValidationResponse {
    schema_version: number;
    log_id: string;
    log_meta: TelemetryLogMeta;
    run_mode: string;
    run_id?: string;
    run_unit?: string;
    model_limits: ModelLimits;
    gates: { total: number; kept: number; rejected: number };
    conditions: {
        iat_mean: number | null; coolant_mean: number | null;
        ambient_pressure_mean: number | null;
    };
    cells: ValidationCell[];
    summary: {
        n_cells: number;
        wot_delta_mean_ex_band: number | null;
        wot_delta_mean_in_band: number | null;
        box_mode_note: string;
        vanos_tracking_mean_abs: number | null;
        vanos_map_match_mean_abs: number | null;
    };
}

export const compareValidation = async (
    logId: string, mode: string = "full_map",
): Promise<ValidationResponse> => {
    const response = await fetch(`${API_BASE_URL}/validation/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_id: logId, mode }),
    });
    if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail ?? `validation compare failed: ${response.statusText}`);
    }
    return response.json();
};

// Current backend provenance — the STALE-badge reference (Stage 74).
export const fetchMeta = async (): Promise<MetaResponse | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/meta`);
        if (!response.ok) return null;
        return await response.json() as MetaResponse;
    } catch {
        return null;   // backend down — provenance strip simply omits the check
    }
};

// (runCalibration removed in Stage 74 cleanup — the /simulate/calibration
// endpoint is a 501 stub; CalibrationResponse stays for VETableComparison.)

export const runSimulation = async (
    config: SimConfig,
    mode: "wot_quick" | "full_map" = "wot_quick",
): Promise<RunResponse> => {
    try {
        const response = await fetch(`${API_BASE_URL}/simulate/run?mode=${mode}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            // surface the backend's detail (e.g. the friendly cancel message)
            // instead of a generic "Internal Server Error"
            let detail = response.statusText;
            try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
            throw new Error(`API Error: ${detail}`);
        }

        const data = await response.json();
        return data as RunResponse;
    } catch (error) {
        console.error("Simulation failed:", error);
        throw error;
    }
};

export const runWaveform = async (
    config: SimConfig,
    rpm: number,
    load = 100.0,
): Promise<WaveformResponse> => {
    const response = await fetch(
        `${API_BASE_URL}/simulate/waveform?rpm=${rpm}&load=${load}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        },
    );
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`Waveform API Error: ${detail}`);
    }
    return (await response.json()) as WaveformResponse;
};

// Reload the last assembled map (persisted server-side) without re-running --
// recovers a long full_map whose browser fetch died ('Failed to fetch').
export const fetchLastRun = async (
    mode: "wot_quick" | "full_map" = "full_map",
): Promise<RunResponse> => {
    const response = await fetch(`${API_BASE_URL}/simulate/last?mode=${mode}`);
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`No saved ${mode} run: ${detail}`);
    }
    return (await response.json()) as RunResponse;
};

export const fetchMaps = async (): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/maps`);
        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fetch Maps failed:", error);
        throw error;
    }
};

// M4: WOT VANOS tuning. First run is a long real-sim search (deck-cached ->
// repeats resume instantly); the result also persists server-side, so a lost
// fetch is recoverable via fetchLastTuning().
export const runTuning = async (
    config: SimConfig,
    preference: "max_ve" | "smooth" = "max_ve",
    opts?: { rpms?: number[]; budget?: number },
): Promise<OptimizationResponse> => {
    const params = new URLSearchParams({ preference });
    if (opts?.rpms?.length) params.set("rpms", opts.rpms.join(","));
    if (opts?.budget) params.set("budget", String(opts.budget));
    const response = await fetch(`${API_BASE_URL}/simulate/optimization?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`Tuning API Error: ${detail}`);
    }
    return (await response.json()) as OptimizationResponse;
};

// M5: cancel every in-flight sim (map run / tuning / waveform). Finished
// cells stay in the deck cache, so re-running the same request resumes.
export const cancelRuns = async (): Promise<{ cancelled_tasks: number }> => {
    const response = await fetch(`${API_BASE_URL}/simulate/cancel`, { method: "POST" });
    if (!response.ok) throw new Error(`Cancel failed: ${response.statusText}`);
    return (await response.json()) as { cancelled_tasks: number };
};

export const fetchLastTuning = async (): Promise<OptimizationResponse> => {
    const response = await fetch(`${API_BASE_URL}/simulate/last?mode=optimization`);
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`No saved tuning run: ${detail}`);
    }
    return (await response.json()) as OptimizationResponse;
};

// Binary Patcher API
export const uploadBinary = async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(`${API_BASE_URL}/binary/upload`, {
            method: "POST",
            body: formData,
        });
        if (!response.ok) throw new Error("Upload failed");
        return await response.json();
    } catch (error) {
        console.error("Binary upload failed:", error);
        throw error;
    }
};

// Base VE map (kf_rf_soll shape): ECU relative-charge target, fractional values.
export interface EcuVeMap { x_axis: number[]; y_axis: number[]; values: number[][]; }

// Base VE map extracted from the currently-uploaded BIN (the per-vehicle
// ground truth). Returns null when no BIN is uploaded (404) or on any error,
// so callers fall back to the repo kf_rf_soll (via fetchMaps).
export const fetchBinVeMap = async (): Promise<EcuVeMap | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/binary/ve_map`);
        if (!response.ok) return null;
        return (await response.json()) as EcuVeMap;
    } catch {
        return null;
    }
};

export const patchBinary = async (optimizationConfig: any): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/binary/patch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(optimizationConfig),
        });
        if (!response.ok) throw new Error("Patch failed");
        return await response.json();
    } catch (error) {
        console.error("Binary patch failed:", error);
        throw error;
    }
};

export const downloadBinary = async (): Promise<Blob> => {
    try {
        const response = await fetch(`${API_BASE_URL}/binary/download`);
        if (!response.ok) throw new Error("Download failed");
        return await response.blob();
    } catch (error) {
        console.error("Binary download failed:", error);
        throw error;
    }
};

// Debug / Inspection
export const WS_BASE_URL = "ws://localhost:8000";

export const getTopology = async (config: SimConfig): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/simulate/topology`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Get Topology failed:", error);
        throw error;
    }
}

// --- Measurement parameter sheet (real-engine values: download / import) ----
export interface SheetImportResult {
    applied: { path: string; value: number | boolean; label: string; group: string; old: number | boolean | null }[];
    skipped: { path: string; label: string }[];
    warnings: string[];
}

// Download an .xlsx fill-in sheet of the physically measurable parameters,
// seeded with the CURRENT config's values (so the sheet shows the baseline).
export const downloadMeasurementSheet = async (config: SimConfig): Promise<Blob> => {
    const response = await fetch(`${API_BASE_URL}/parameters/sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    });
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`Sheet download failed: ${detail}`);
    }
    return await response.blob();
};

// Upload a filled sheet; the backend parses it into applied/skipped/warnings.
// The caller merges `applied` (path/value pairs) into its live config.
export const importMeasurementSheet = async (file: File): Promise<SheetImportResult> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE_URL}/parameters/import`, {
        method: "POST",
        body: formData,   // no Content-Type header — browser sets the multipart boundary
    });
    if (!response.ok) {
        let detail = response.statusText;
        try { detail = (await response.json())?.detail ?? detail; } catch { /* ignore */ }
        throw new Error(`Sheet import failed: ${detail}`);
    }
    return (await response.json()) as SheetImportResult;
};

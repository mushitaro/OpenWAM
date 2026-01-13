
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

export interface IntakeConfig {
    type: string;
    inlet: InletConfig;
    plenum_vol: number;
    bellmouth: BellmouthConfig;
    itb: ITBConfig; // New ITB Module
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
}

export interface Section2Config extends ExhaustSectionConfig {
    resonator_fitted: boolean;
    resonator_location: "before_h" | "after_h";
    resonator_length: number;   // mm
    resonator_diameter: number; // mm
}

export interface Section3Config extends ExhaustSectionConfig {
    muffler_type: string;
    tailpipe_length: number;
}

export interface EnvironmentConfig {
    ambient_temp: number;
    ambient_pressure: number;
}

export interface ExhaustConfig {
    headers: HeaderConfig & { collector_vol: number; }; // Added Collector Volume
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

const API_BASE_URL = "http://localhost:8000";

export const runCalibration = async (config: SimConfig): Promise<CalibrationResponse> => {
    try {
        const response = await fetch(`${API_BASE_URL}/simulate/calibration`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        return data as CalibrationResponse;
    } catch (error) {
        console.error("Calibration failed:", error);
        throw error;
    }
};

export const runSimulation = async (config: SimConfig): Promise<CalibrationResponse> => {
    try {
        const response = await fetch(`${API_BASE_URL}/simulate/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        return data as CalibrationResponse;
    } catch (error) {
        console.error("Simulation failed:", error);
        throw error;
    }
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

export const runOptimization = async (config: SimConfig): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/simulate/optimization`, {
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
        console.error("Optimization failed:", error);
        throw error;
    }
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

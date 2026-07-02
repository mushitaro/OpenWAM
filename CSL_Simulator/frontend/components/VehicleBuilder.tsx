"use client";

import React, { useState, useEffect, useRef } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Play, Activity, Settings2, Info, Wrench, BarChart2, Save, Upload, Download, History, Square } from "lucide-react";
import { runTuning, fetchLastTuning, runSimulation, fetchLastRun, cancelRuns, CalibrationResponse, RunResponse, OptimizationResponse, SimConfig, WS_BASE_URL } from "../app/api";
import VETableComparison from "./VETableComparison";
import BinaryPatchManager from "./BinaryPatchManager";
import SimulationDebugPanel from "./SimulationDebugPanel";
import InteractiveTopology, { SelectionType } from "./InteractiveTopology";
import SimulationController from "./SimulationController";
import VeOverlayChart from "./VeOverlayChart";
import ValidityPanel from "./ValidityPanel";
import VeSurfaceChart from "./VeSurfaceChart";
import VeWaveformChart from "./WaveformChart";
import TuningResults from "./TuningResults";

// Adapt the structured RunResponse into the matrix shape VETableComparison expects
// ([loadRow][rpmCol]). Off-WOT rows have no measured stock -> 0 / corr 1.
function runToCalibration(run: RunResponse): CalibrationResponse {
    const rpm = run.axes.rpm;
    const load = run.axes.load;
    const sim = run.cells.map((row) => row.map((c) => c.ve_sim));
    const target = run.cells.map((row) => row.map((c) => (c.ve_stock ?? 0)));
    const correction = run.cells.map((row) =>
        row.map((c) => (c.ve_stock && c.ve_stock > 0 ? c.ve_sim / c.ve_stock : 1)));
    return { curve: [], matrix: { rpm, load, target, sim, correction } } as CalibrationResponse;
}

const VehicleBuilder = () => {
    // --- STATE ---
    const [mainTab, setMainTab] = useState<"builder" | "simulation">("builder");

    const [loading, setLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [runData, setRunData] = useState<RunResponse | null>(null);
    // snapshot of the config that produced runData, so the Waveform view drills
    // into the SAME geometry the surface/summary show (config may be edited after).
    const [runConfig, setRunConfig] = useState<SimConfig | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number; eta?: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // non-error notices (cancel confirmations, config loaded, ...) — amber, not red
    const [notice, setNotice] = useState<string | null>(null);
    // M4 tuning state
    const [tuneData, setTuneData] = useState<OptimizationResponse | null>(null);
    const [tunePref, setTunePref] = useState<"max_ve" | "smooth">("max_ve");
    const [tuneProgress, setTuneProgress] = useState<{ done: number; total: number; eta?: number } | null>(null);
    // M3/M4: which results view is showing
    const [resultView, setResultView] = useState<"summary" | "surface" | "waveform" | "tuning">("summary");

    // Live progress: parse "CELL x/y" broadcasts on /ws/logs into a progress bar.
    useEffect(() => {
        let ws: WebSocket | null = null;
        try {
            ws = new WebSocket(`${WS_BASE_URL}/ws/logs`);
            ws.onmessage = (e) => {
                const s = typeof e.data === "string" ? e.data : "";
                const m = /CELL (\d+)\/(\d+)/.exec(s);
                if (m) {
                    const eta = /eta=(\d+)s/.exec(s);
                    setProgress({ done: parseInt(m[1], 10), total: parseInt(m[2], 10), eta: eta ? parseInt(eta[1], 10) : undefined });
                }
                // M4: "OPT k/N ... eta=Xs" broadcasts from the VANOS optimizer
                const t = /OPT (\d+)\/(\d+)/.exec(s);
                if (t) {
                    const eta = /eta=(\d+)s/.exec(s);
                    setTuneProgress({ done: parseInt(t[1], 10), total: parseInt(t[2], 10), eta: eta ? parseInt(eta[1], 10) : undefined });
                }
            };
        } catch { /* backend not up yet */ }
        return () => { try { ws?.close(); } catch { } };
    }, []);

    // Builder State
    const [selection, setSelection] = useState<SelectionType | null>({ type: "environment" });

    // config state
    const [config, setConfig] = useState<SimConfig>({
        environment: { ambient_temp: 298, ambient_pressure: 101325 },
        fuel: { lcv: 44000000, density: 750, stoich_ratio: 14.7 },
        simulation: { mesh_size: 0.01, openwam_version: 2200, duration_cycles: 30, step_size: 1.0 },
        intake: {
            type: "CSL Replica",
            inlet: { duct_length: 200, duct_diameter: 100 },
            plenum_vol: 10.5,
            bellmouth: { length: 150, diameter: 52, taper_angle: 3.5 },
            itb: { fitted: true, diameter: 52, plate_thickness: 2, discharge_coeff_map: "default_butterfly" },
            throttle: { idle_offset_deg: 2.0, pedal_gamma: 1.4 },
            runner: { upper_length: 15, lower_length: 25, entry_diameter: 70, length_scale: 1.0, friction_multiplier: 1.0 },
            eq_tube: { enabled: true, model: "plenum", stub_diameter: 30, stub_length: 75, stub_friction: 0.02, volume_scale: 1.0, mistune_spread: 0.0 }
        },
        engine: {
            cam_profile: "Stock CSL",
            rpm: 7900, // Default RPM
            cylinders: 6,
            geometry: { bore: 87.0, stroke: 91.0, compression_ratio: 11.5, rod_length: 139.0 },
            // Advanced Computed/Manual Overrides (Piston/Head Areas calculated in backend)
            combustion: { duration: 65.0, start_angle: -15.0, shape_parameter_m: 2.2, efficiency_a: 6.9, mass_burned_b: 0.5 },
            vanos_intake_bias: 0.0,
            vanos_exhaust_bias: 0.0,
            friction: { coeffs: [0.5, 0, 0, 0] },
            heat_transfer: { woschni_coeffs: [2.28, 0.4, 0], global_factor: 1.0 },
            head: {
                port_flow_coeff: 1.0,
                valves_per_cyl: 4,
                wall_temp: 450,
                intake_port_wall_temp: 127,
                intake_port: { length: 105, diameter: 52, wall_temp: 400 },
                exhaust_port: { length: 90, diameter: 48, wall_temp: 800 },
                intake_valve: { lift_profile: "Stock", max_lift: 11.8, duration: 260, diameter: 35, open_angle_base: 350, flow_coeff_map: "S54_In" },
                exhaust_valve: { lift_profile: "Stock", max_lift: 11.2, duration: 260, diameter: 30.5, open_angle_base: 130, flow_coeff_map: "S54_Ex" }
            }
        },
        exhaust: {
            headers: { primary_length: 300, primary_diameter: 48, collector_vol: 1.5, collector_dia: 68 }, // S54 Stock Headers (models.py canonical)
            catalyst: { installed: true, location: "header_collector", cpsi: 200, length: 200, diameter: 120 }, // Default Catalyst
            // models.py canonical: cat_offset must be > 0 or Section 1-1 becomes a
            // zero-length pipe that aborts the solver (cyc=0). 68mm / 1200 / 1400 = stock.
            section1_1: { length: 1200, diameter: 68, layout: "Independent", crossover_offset: 600, name: "Section 1 (Bank 1)", cat_fitted: true, cat_offset: 600, wall_temp: 600, crossover_type: "none" },
            section1_2: { length: 1200, diameter: 68, layout: "Independent", crossover_offset: 600, name: "Section 1 (Bank 2)", cat_fitted: true, cat_offset: 600, wall_temp: 600, crossover_type: "none" },
            section2: { length: 1400, diameter: 68, layout: "H-Pipe", resonator_fitted: false, resonator_location: "before_h", resonator_length: 300, resonator_diameter: 80, name: "Section 2", cat_fitted: false, cat_offset: 200, wall_temp: 600 },
            section3: { volume: 15.0, tailpipe_length: 150, diameter: 68 }, // Stock Muffler
        }
    });

    // --- UPDATERS ---
    const updateConfig = (section: keyof SimConfig, path: string, value: any) => {
        setConfig(prev => {
            const sectionData = { ...prev[section] };
            const keys = path.split('.');
            let current: any = sectionData;
            for (let i = 0; i < keys.length - 1; i++) { current = current[keys[i]]; }
            const finalKey = keys[keys.length - 1];
            current[finalKey] = !isNaN(Number(value)) && value !== "" ? Number(value) : value;
            return { ...prev, [section]: sectionData };
        });
    };

    const handleRun = async (mode: "wot_quick" | "full_map") => {
        setLoading(true);
        setError(null);
        setNotice(null);
        setRunData(null);
        setProgress({ done: 0, total: mode === "wot_quick" ? 20 : 480 });
        setMainTab("simulation"); // Auto switch to simulation tab
        try {
            const runCfg = structuredClone(config);
            const data = await runSimulation(runCfg, mode);
            setRunData(data);
            setRunConfig(runCfg);   // snapshot geometry for the Waveform drill-down
            // fresh run results must be visible, not hidden behind a stale
            // "tuning" (or other) view selection.
            setResultView("summary");
        } catch (err: any) {
            console.error("Simulation catch error:", err);
            // runData was cleared above; fall back to whatever still has data
            if (tuneData) setResultView("tuning");
            const msg = err.message || "Simulation failed";
            if (/cancel/i.test(msg)) {
                setNotice("Cancelled — finished cells are cached; re-run to resume.");
            } else {
                setError(msg);
            }
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    // Recover the last persisted map (e.g. a full_map whose fetch died) without re-running.
    const handleLoadLast = async (mode: "wot_quick" | "full_map") => {
        setError(null);
        try {
            const data = await fetchLastRun(mode);
            setRunData(data);
            setRunConfig(null);   // saved geometry unknown; waveform falls back to live config
            setResultView("summary");
            setMainTab("simulation");
        } catch (err: any) {
            setError(err?.message || "No saved run to load");
        }
    };

    // M4: WOT VANOS tuning (UX_APP_DEV_SPEC §7). Long real-sim search; the deck
    // cache makes re-runs resumable and the result persists server-side, so a
    // lost fetch is recoverable via "Load last tuning".
    const handleRunTuning = async () => {
        setOptimizing(true);
        setError(null);
        setTuneProgress(null);
        setMainTab("simulation");
        try {
            const runCfg = structuredClone(config);
            const data = await runTuning(runCfg, tunePref);
            setTuneData(data);
            setResultView("tuning");
        } catch (err: any) {
            const msg = err?.message || "Tuning failed";
            if (/cancel/i.test(msg)) {
                setNotice("Tuning cancelled — completed evaluations are cached; re-run to resume.");
            } else if (/fetch|network|load failed/i.test(msg)) {
                // network-layer failures (any browser's wording) — the search
                // keeps running server-side and persists on completion.
                setError(`${msg} — the search keeps running server-side; use "Load last tuning" when it finishes.`);
            } else {
                setError(msg);
            }
        } finally {
            setOptimizing(false);
            setTuneProgress(null);
        }
    };

    const handleLoadLastTuning = async () => {
        setError(null);
        try {
            const data = await fetchLastTuning();
            setTuneData(data);
            setResultView("tuning");
            setMainTab("simulation");
        } catch (err: any) {
            setError(err?.message || "No saved tuning run to load");
        }
    };

    // M5: cancel every in-flight sim (map / tuning / waveform). Finished cells
    // stay cached, so re-running the same request resumes where it stopped.
    const handleCancel = async () => {
        try {
            const r = await cancelRuns();
            setNotice(`Cancelled ${r.cancelled_tasks} in-flight sim task(s) — finished cells are cached; re-run to resume.`);
        } catch (err: any) {
            setError(err?.message || "Cancel failed");
        }
    };

    // M5: project (SimConfig) load — counterpart of handleConfigSave.
    const configFileRef = useRef<HTMLInputElement>(null);
    // pristine defaults, captured on FIRST render (before any edits): loading a
    // project reproduces the state it was saved from, not defaults+edits+file.
    const defaultConfigRef = useRef<SimConfig | null>(null);
    if (defaultConfigRef.current === null) defaultConfigRef.current = structuredClone(config);
    const handleConfigLoad = () => configFileRef.current?.click();
    const deepMerge = (base: any, patch: any): any => {
        if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
        const out: any = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
        for (const k of Object.keys(patch)) {
            if (k === "__proto__" || k === "constructor" || k === "prototype") continue; // no proto pollution
            out[k] = deepMerge(out[k], patch[k]);
        }
        return out;
    };
    const handleConfigFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";   // allow re-selecting the same file
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(String(ev.target?.result ?? ""));
                if (!parsed || typeof parsed !== "object" || !parsed.engine || !parsed.intake || !parsed.exhaust) {
                    setError("Invalid config file — expected a SimConfig JSON (engine/intake/exhaust sections).");
                    return;
                }
                // merge over PRISTINE DEFAULTS (not the currently-edited config)
                // so a load reproduces the saved project; defaults fill fields
                // that didn't exist when the file was saved.
                setConfig(deepMerge(defaultConfigRef.current, parsed) as SimConfig);
                setError(null);
                setNotice(`Config loaded from ${file.name}.`);
            } catch {
                setError(`Could not parse ${file.name} as JSON.`);
            }
        };
        reader.readAsText(file);
    };
    const handleConfigSave = () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "csl_sim_config.json";
        a.click();
    };

    // --- ID PREDICTION HELPER ---
    const getPredictedID = (sel: SelectionType | null) => {
        if (!sel) return "-";

        switch (sel.type) {
            case "environment": return "N/A";
            case "intake_duct": return "Pipe 1";
            case "plenum": return "Plenum 2";
            case "runner": return `Pipe ${2 + (sel.index * 3)}`;
            case "cylinder": return `Cylinder ${sel.index + 1}`;
            case "header": return `Pipe ${20 + (sel.index * 3)}`;
            case "collector": return "Collector (Plenum)";
            case "section1": return "Pipe (Merge)";
            case "section2": return "Pipe (Mid)";
            case "muffler": return "Plenum (Muffler)";
            default: return "-";
        }
    };

    // --- COMPONENTS ---

    // 1. Parameter Form
    const renderSelectionParams = () => {
        if (!selection) return <div className="text-neutral-500 text-sm italic p-4">Select a component to view parameters.</div>;
        const { type } = selection;

        const InputRow = ({ label, value, onChange, unit }: any) => (
            <div className="mb-3">
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label} {unit && `(${unit})`}</label>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 outline-none transition-colors font-mono"
                />
            </div>
        );

        const SectionHeader = ({ title, id }: { title: string, id: string }) => (
            <div className="mb-6 border-b border-neutral-800 pb-2">
                <h3 className="text-lg font-medium text-neutral-200">{title}</h3>
                <div className="text-xs text-neutral-500 font-mono mt-1">SIM ID: {id}</div>
            </div>
        );

        return (
            <div className="p-4">
                {/* Selection Specific Forms */}
                {type === "environment" && (
                    <>
                        <SectionHeader title="Environment & Simulation" id="N/A" />
                        <InputRow label="Ambient Temp" unit="K" value={config.environment.ambient_temp} onChange={(v: any) => updateConfig("environment", "ambient_temp", v)} />
                        <InputRow label="Pressure" unit="Pa" value={config.environment.ambient_pressure} onChange={(v: any) => updateConfig("environment", "ambient_pressure", v)} />

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <label className="block text-xs font-bold text-neutral-400 mb-2">ADVANCED / GLOBAL</label>
                            <InputRow label="RPM Target" unit="rpm" value={config.engine.rpm} onChange={(v: any) => updateConfig("engine", "rpm", v)} />
                            <InputRow label="Fuel LCV" unit="J/kg" value={config.fuel.lcv} onChange={(v: any) => updateConfig("fuel", "lcv", v)} />
                            <InputRow label="Fuel Density" unit="kg/m3" value={config.fuel.density} onChange={(v: any) => updateConfig("fuel", "density", v)} />
                            <InputRow label="Mesh Size" unit="m" value={config.simulation.mesh_size} onChange={(v: any) => updateConfig("simulation", "mesh_size", v)} />
                        </div>
                    </>
                )}

                {(type === "intake_duct" || type === "plenum") && (
                    <>
                        <SectionHeader title={type === "intake_duct" ? "Intake Duct" : "Plenum"} id={getPredictedID(selection)} />
                        <InputRow label="Duct Length" unit="mm" value={config.intake.inlet.duct_length} onChange={(v: any) => updateConfig("intake", "inlet.duct_length", v)} />
                        <InputRow label="Plenum Vol" unit="L" value={config.intake.plenum_vol} onChange={(v: any) => updateConfig("intake", "plenum_vol", v)} />
                        {type === "plenum" && (
                            <>
                                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-neutral-800">
                                    <input type="checkbox" checked={config.intake.itb.fitted} onChange={(e) => updateConfig("intake", "itb.fitted", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                                    <span className="text-sm font-medium text-neutral-300">ITB Fitted</span>
                                </div>
                                <InputRow label="ITB Diameter" unit="mm" value={config.intake.itb.diameter} onChange={(v: any) => updateConfig("intake", "itb.diameter", v)} />

                                <div className="mt-4 pt-4 border-t border-neutral-800">
                                    <h4 className="text-xs font-bold text-neutral-500 mb-2">THROTTLE MODEL (Butterfly)</h4>
                                    <InputRow label="Idle Offset" unit="deg" value={config.intake.throttle.idle_offset_deg} onChange={(v: any) => updateConfig("intake", "throttle.idle_offset_deg", v)} />
                                    <InputRow label="Pedal Gamma" unit="-" value={config.intake.throttle.pedal_gamma} onChange={(v: any) => updateConfig("intake", "throttle.pedal_gamma", v)} />
                                    <div className="text-[10px] text-neutral-600">γ&gt;1 = progressive metering (validated 1.4)</div>
                                </div>

                                <div className="mt-4 pt-4 border-t border-neutral-800">
                                    <h4 className="text-xs font-bold text-neutral-500 mb-2 flex items-center gap-2">
                                        EQUALIZATION TUBE
                                        <input type="checkbox" checked={config.intake.eq_tube.enabled} onChange={(e) => updateConfig("intake", "eq_tube.enabled", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                                    </h4>
                                    {config.intake.eq_tube.enabled && (
                                        <>
                                            <div className="mb-3">
                                                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Model</label>
                                                <select value={config.intake.eq_tube.model} onChange={(e) => updateConfig("intake", "eq_tube.model", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                                    <option value="plenum">Plenum (validated)</option>
                                                    <option value="chain">Continuous chain</option>
                                                </select>
                                            </div>
                                            <InputRow label="Stub Diameter" unit="mm" value={config.intake.eq_tube.stub_diameter} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_diameter", v)} />
                                            <InputRow label="Stub Length" unit="mm" value={config.intake.eq_tube.stub_length} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_length", v)} />
                                            <InputRow label="Stub Friction" unit="-" value={config.intake.eq_tube.stub_friction} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_friction", v)} />
                                            <InputRow label="Volume Scale" unit="×" value={config.intake.eq_tube.volume_scale} onChange={(v: any) => updateConfig("intake", "eq_tube.volume_scale", v)} />
                                            <InputRow label="Mistune Spread" unit="frac" value={config.intake.eq_tube.mistune_spread} onChange={(v: any) => updateConfig("intake", "eq_tube.mistune_spread", v)} />
                                            <div className="text-[10px] text-neutral-600">φ30 min stable; mistune detunes cyl-2 collapse</div>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}

                {type === "runner" && (
                    <>
                        <SectionHeader title={`Runner #${(selection as any).index + 1}`} id={getPredictedID(selection)} />
                        <InputRow label="Bellmouth Length" unit="mm" value={config.intake.bellmouth.length} onChange={(v: any) => updateConfig("intake", "bellmouth.length", v)} />
                        <InputRow label="Bellmouth Dia" unit="mm" value={config.intake.bellmouth.diameter} onChange={(v: any) => updateConfig("intake", "bellmouth.diameter", v)} />
                        <InputRow label="Mouth (Entry) Dia" unit="mm" value={config.intake.runner.entry_diameter} onChange={(v: any) => updateConfig("intake", "runner.entry_diameter", v)} />
                        <InputRow label="Runner Upper Len" unit="mm" value={config.intake.runner.upper_length} onChange={(v: any) => updateConfig("intake", "runner.upper_length", v)} />
                        <InputRow label="Runner Lower Len" unit="mm" value={config.intake.runner.lower_length} onChange={(v: any) => updateConfig("intake", "runner.lower_length", v)} />
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">RAM TUNING</h4>
                            <InputRow label="Length Scale" unit="×" value={config.intake.runner.length_scale} onChange={(v: any) => updateConfig("intake", "runner.length_scale", v)} />
                            <InputRow label="Friction Mult" unit="×" value={config.intake.runner.friction_multiplier} onChange={(v: any) => updateConfig("intake", "runner.friction_multiplier", v)} />
                            <div className="text-[10px] text-neutral-600">Length Scale shifts the ram-resonance rpm; Friction Mult broadens it (Q).</div>
                        </div>
                        <div className="text-xs text-neutral-600 mt-2">Note: intake geometry is global for all runners.</div>
                    </>
                )}

                {type === "cylinder" && (
                    <>
                        <SectionHeader title={`Cylinder #${(selection as any).index + 1}`} id={getPredictedID(selection)} />
                        <InputRow label="Bore" unit="mm" value={config.engine.geometry.bore} onChange={(v: any) => updateConfig("engine", "geometry.bore", v)} />
                        <InputRow label="Stroke" unit="mm" value={config.engine.geometry.stroke} onChange={(v: any) => updateConfig("engine", "geometry.stroke", v)} />
                        <InputRow label="Compression Ratio" unit=":1" value={config.engine.geometry.compression_ratio} onChange={(v: any) => updateConfig("engine", "geometry.compression_ratio", v)} />
                        <InputRow label="Rod Length" unit="mm" value={config.engine.geometry.rod_length} onChange={(v: any) => updateConfig("engine", "geometry.rod_length", v)} />
                        <div className="mt-4 p-3 bg-neutral-900 border border-neutral-800 rounded">
                            <InputRow label="VANOS Intake Bias" unit="Deg" value={config.engine.vanos_intake_bias} onChange={(v: any) => updateConfig("engine", "vanos_intake_bias", v)} />
                            <InputRow label="VANOS Exhaust Bias" unit="Deg" value={config.engine.vanos_exhaust_bias} onChange={(v: any) => updateConfig("engine", "vanos_exhaust_bias", v)} />
                        </div>

                        <div className="mt-4">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">INTAKE VALVE</h4>
                            <InputRow label="Max Lift" unit="mm" value={config.engine.head.intake_valve.max_lift} onChange={(v: any) => updateConfig("engine", "head.intake_valve.max_lift", v)} />
                            <InputRow label="Duration" unit="deg" value={config.engine.head.intake_valve.duration} onChange={(v: any) => updateConfig("engine", "head.intake_valve.duration", v)} />
                            <InputRow label="Diameter" unit="mm" value={config.engine.head.intake_valve.diameter} onChange={(v: any) => updateConfig("engine", "head.intake_valve.diameter", v)} />
                            <InputRow label="Base Timing" unit="deg" value={config.engine.head.intake_valve.open_angle_base} onChange={(v: any) => updateConfig("engine", "head.intake_valve.open_angle_base", v)} />

                            <h4 className="text-xs font-bold text-neutral-500 mb-2 mt-3">EXHAUST VALVE</h4>
                            <InputRow label="Max Lift" unit="mm" value={config.engine.head.exhaust_valve.max_lift} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.max_lift", v)} />
                            <InputRow label="Duration" unit="deg" value={config.engine.head.exhaust_valve.duration} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.duration", v)} />
                            <InputRow label="Diameter" unit="mm" value={config.engine.head.exhaust_valve.diameter} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.diameter", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">PORT GEOMETRY</h4>
                            <InputRow label="In-Port Len" unit="mm" value={config.engine.head.intake_port.length} onChange={(v: any) => updateConfig("engine", "head.intake_port.length", v)} />
                            <InputRow label="In-Port Dia" unit="mm" value={config.engine.head.intake_port.diameter} onChange={(v: any) => updateConfig("engine", "head.intake_port.diameter", v)} />
                            <InputRow label="Ex-Port Len" unit="mm" value={config.engine.head.exhaust_port.length} onChange={(v: any) => updateConfig("engine", "head.exhaust_port.length", v)} />
                            <InputRow label="Ex-Port Dia" unit="mm" value={config.engine.head.exhaust_port.diameter} onChange={(v: any) => updateConfig("engine", "head.exhaust_port.diameter", v)} />
                            <InputRow label="In-Port Wall Temp" unit="°C" value={config.engine.head.intake_port_wall_temp} onChange={(v: any) => updateConfig("engine", "head.intake_port_wall_temp", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">HEAD / FLOW</h4>
                            <InputRow label="Port Flow Coeff" unit="×" value={config.engine.head.port_flow_coeff} onChange={(v: any) => updateConfig("engine", "head.port_flow_coeff", v)} />
                            <InputRow label="Port Friction" unit="-" value={config.engine.head.port_friction ?? 0.05} onChange={(v: any) => updateConfig("engine", "head.port_friction", v)} />
                            <InputRow label="Head Wall Temp" unit="K" value={config.engine.head.wall_temp} onChange={(v: any) => updateConfig("engine", "head.wall_temp", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">COMBUSTION (Wiebe)</h4>
                            <InputRow label="Burn Duration" unit="deg" value={config.engine.combustion.duration} onChange={(v: any) => updateConfig("engine", "combustion.duration", v)} />
                            <InputRow label="Shape (m)" unit="-" value={config.engine.combustion.shape_parameter_m} onChange={(v: any) => updateConfig("engine", "combustion.shape_parameter_m", v)} />
                            <InputRow label="Efficiency (a)" unit="-" value={config.engine.combustion.efficiency_a} onChange={(v: any) => updateConfig("engine", "combustion.efficiency_a", v)} />
                            <InputRow label="Start Angle" unit="deg" value={config.engine.combustion.start_angle} onChange={(v: any) => updateConfig("engine", "combustion.start_angle", v)} />
                        </div>
                    </>
                )}

                {type === "header" && (
                    <>
                        <SectionHeader title="Header Primary" id={getPredictedID(selection)} />
                        <InputRow label="Primary Length" unit="mm" value={config.exhaust.headers.primary_length} onChange={(v: any) => updateConfig("exhaust", "headers.primary_length", v)} />
                        <InputRow label="Diameter" unit="mm" value={config.exhaust.headers.primary_diameter} onChange={(v: any) => updateConfig("exhaust", "headers.primary_diameter", v)} />
                        <InputRow label="Header Friction" unit="-" value={config.exhaust.headers.header_friction ?? 0.02} onChange={(v: any) => updateConfig("exhaust", "headers.header_friction", v)} />
                        <InputRow label="Wall Temp" unit="K" value={config.exhaust.headers.wall_temp ?? 800} onChange={(v: any) => updateConfig("exhaust", "headers.wall_temp", v)} />
                    </>
                )}

                {type === "collector" && (
                    <>
                        <SectionHeader title="Collector (Merge)" id={getPredictedID(selection)} />
                        <InputRow label="Collector Vol" unit="L" value={config.exhaust.headers.collector_vol} onChange={(v: any) => updateConfig("exhaust", "headers.collector_vol", v)} />
                        <InputRow label="Outlet Dia" unit="mm" value={config.exhaust.headers.collector_dia} onChange={(v: any) => updateConfig("exhaust", "headers.collector_dia", v)} />
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">EXHAUST PORT JUNCTION</h4>
                            <InputRow label="Port Junction Vol" unit="cc" value={config.exhaust.port_junction_vol ?? 0.0} onChange={(v: any) => updateConfig("exhaust", "port_junction_vol", v)} />
                            <InputRow label="Ex-Port Mesh" unit="m" value={config.exhaust.exhaust_port_mesh ?? 0.010} onChange={(v: any) => updateConfig("exhaust", "exhaust_port_mesh", v)} />
                            <div className="text-[10px] text-neutral-600">≤0 = plenumless Type-12 (validated); &gt;0 = small plenum/cyl</div>
                        </div>
                    </>
                )}

                {(type === "section1" || type === "section2" || type === "muffler") && (
                    <>
                        <SectionHeader
                            title={
                                type === "section1" ? `Section 1 (${(selection as any).index === 1 ? "Bank 2" : "Bank 1"})` :
                                    type === "section2" ? "Section 2 (Mid)" :
                                        "Muffler"
                            }
                            id={getPredictedID(selection)}
                        />

                        {type === "section1" && (() => {
                            const bankKey = (selection as any).index === 1 ? "section1_2" : "section1_1";
                            const secConfig = config.exhaust[bankKey as "section1_1" | "section1_2"];

                            return (
                                <div className="flex flex-col gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Layout</label>
                                        <select
                                            value={secConfig.layout}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                // Sync both banks
                                                setConfig(prev => ({
                                                    ...prev,
                                                    exhaust: {
                                                        ...prev.exhaust,
                                                        section1_1: { ...prev.exhaust.section1_1, layout: val },
                                                        section1_2: { ...prev.exhaust.section1_2, layout: val }
                                                    }
                                                }));
                                            }}
                                            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none"
                                        >
                                            <option value="Independent">Independent</option>
                                            <option value="X-Pipe">X-Pipe</option>
                                        </select>
                                    </div>
                                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded">
                                        <h4 className="text-xs font-bold text-neutral-400 mb-2 flex items-center gap-2">
                                            CATALYST
                                            <input type="checkbox" checked={config.exhaust.catalyst.installed} onChange={(e) => updateConfig("exhaust", "catalyst.installed", e.target.checked)} />
                                        </h4>
                                        {config.exhaust.catalyst.installed && (
                                            <div className="flex flex-col gap-2">
                                                <div className="flex flex-col">
                                                    <label className="text-[10px] text-neutral-500">LOCATION</label>
                                                    <select value={config.exhaust.catalyst.location} onChange={(e) => updateConfig("exhaust", "catalyst.location", e.target.value)} className="bg-neutral-950 border border-neutral-700 text-xs p-1 rounded">
                                                        <option value="header_collector">Post-Collector (Front)</option>
                                                        <option value="section1_end">Post-Section 1 (Rear)</option>
                                                    </select>
                                                </div>
                                                <InputRow label="Cell Density (CPSI)" unit="cpsi" value={config.exhaust.catalyst.cpsi} onChange={(v: any) => updateConfig("exhaust", "catalyst.cpsi", v)} />
                                                <InputRow label="Length" unit="mm" value={config.exhaust.catalyst.length} onChange={(v: any) => updateConfig("exhaust", "catalyst.length", v)} />
                                            </div>
                                        )}
                                    </div>

                                    {(secConfig.layout === "X-Pipe" || secConfig.layout === "H-Pipe") ? (
                                        <>
                                            <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-4">
                                                <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">FRONT SEGMENT (PRE-CROSSOVER)</h4>
                                                <InputRow label="Length" unit="mm" value={secConfig.crossover_offset} onChange={(v: any) => {
                                                    const front = Number(v);
                                                    const rear = secConfig.length - secConfig.crossover_offset;
                                                    updateConfig("exhaust", `${bankKey}.crossover_offset`, front);
                                                    updateConfig("exhaust", `${bankKey}.length`, front + rear);
                                                }} />
                                                <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                            </div>
                                            <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-2">
                                                <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">REAR SEGMENT (POST-CROSSOVER)</h4>
                                                <InputRow label="Length" unit="mm" value={secConfig.length - secConfig.crossover_offset} onChange={(v: any) => {
                                                    const rear = Number(v);
                                                    const front = secConfig.crossover_offset;
                                                    updateConfig("exhaust", `${bankKey}.length`, front + rear);
                                                }} />
                                                <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                                <div className="text-[10px] text-neutral-600 mt-2">*Diameter is shared</div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-4">
                                            <InputRow label="Total Length" unit="mm" value={secConfig.length} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.length`, v)} />
                                            <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {type === "section2" && (
                            <div className="flex flex-col gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Layout</label>
                                    <select value={config.exhaust.section2.layout} onChange={(e) => updateConfig("exhaust", "section2.layout", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                        <option value="Independent">Independent (Dual)</option>
                                        <option value="H-Pipe">H-Pipe</option>
                                        <option value="Single">Single Pipe</option>
                                    </select>
                                </div>
                                <InputRow label="Diameter" unit="mm" value={config.exhaust.section2.diameter} onChange={(v: any) => updateConfig("exhaust", "section2.diameter", v)} />
                                <InputRow label="Total Length" unit="mm" value={config.exhaust.section2.length} onChange={(v: any) => updateConfig("exhaust", "section2.length", v)} />

                                <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-2">
                                    <h4 className="text-xs font-bold text-neutral-400 mb-2 flex items-center gap-2">
                                        RESONATOR
                                        <input type="checkbox" checked={config.exhaust.section2.resonator_fitted} onChange={(e) => updateConfig("exhaust", "section2.resonator_fitted", e.target.checked)} />
                                    </h4>
                                    {config.exhaust.section2.resonator_fitted && (
                                        <div className="flex flex-col gap-2 mt-2">
                                            {config.exhaust.section2.layout === "H-Pipe" && (
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[10px] text-neutral-500">LOCATION (vs H-PIPE)</label>
                                                    <select value={config.exhaust.section2.resonator_location} onChange={(e) => updateConfig("exhaust", "section2.resonator_location", e.target.value)} className="bg-neutral-950 border border-neutral-700 text-xs p-1 rounded outline-none text-neutral-300">
                                                        <option value="before_h">Before H-Pipe (Front)</option>
                                                        <option value="after_h">After H-Pipe (Rear)</option>
                                                    </select>
                                                </div>
                                            )}
                                            <InputRow label="Length" unit="mm" value={config.exhaust.section2.resonator_length || 300} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_length", v)} />
                                            <InputRow label="Diameter" unit="mm" value={config.exhaust.section2.resonator_diameter || 80} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_diameter", v)} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {type === "muffler" && (
                            <>
                                <InputRow label="Tailpipe Length" unit="mm" value={config.exhaust.section3.tailpipe_length} onChange={(v: any) => updateConfig("exhaust", "section3.tailpipe_length", v)} />
                                <InputRow label="Muffler Vol" unit="L" value={config.exhaust.section3.volume} onChange={(v: any) => updateConfig("exhaust", "section3.volume", v)} />
                            </>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="h-screen max-h-screen bg-neutral-950 text-neutral-300 font-sans flex flex-col overflow-hidden selection:bg-neutral-800">

            {/* 1. MINIMAL HEADER */}
            <div className="h-14 border-b border-neutral-800 flex items-center justify-between px-6 bg-neutral-950 z-20 flex-shrink-0">
                <div className="flex items-center gap-6">
                    <div className="font-semibold text-neutral-100 tracking-tight">OpenWAM <span className="text-neutral-500 font-normal">CSL Simulator</span></div>

                    {/* Minimal Tabs */}
                    <div className="flex gap-1 bg-neutral-900 p-1 rounded-md">
                        <button
                            onClick={() => setMainTab("builder")}
                            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${mainTab === "builder" ? "bg-neutral-800 text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Builder
                        </button>
                        <button
                            onClick={() => setMainTab("simulation")}
                            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${mainTab === "simulation" ? "bg-neutral-800 text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Simulation
                        </button>
                    </div>
                </div>

                <div className="text-[10px] font-mono text-neutral-600">
                    STATUS: {loading || optimizing ? "RUNNING" : "IDLE"}
                </div>
            </div>

            {/* 2. CONTENT */}
            <div className="flex-1 relative overflow-hidden">

                {/* --- BUILDER MODE --- */}
                {mainTab === "builder" && (
                    <div className="grid grid-cols-12 h-full">
                        {/* Left Panel: Params */}
                        <div className="col-span-3 border-r border-neutral-800 bg-neutral-900/50 flex flex-col overflow-hidden">
                            {/* Global / Project Header */}
                            <div
                                onClick={() => setSelection({ type: "environment" })}
                                className={`px-4 py-3 border-b border-neutral-800 cursor-pointer flex items-center justify-between group transition-colors flex-shrink-0
                                    ${selection?.type === 'environment' ? 'bg-neutral-800/50' : 'hover:bg-neutral-800/30'}`}
                            >
                                <div>
                                    <div className="text-xs font-bold text-neutral-200">Global Settings</div>
                                    <div className="text-[10px] text-neutral-500 font-mono">Environment & Simulation</div>
                                </div>
                                <div className={`w-1.5 h-1.5 rounded-full ${selection?.type === 'environment' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-neutral-700 group-hover:bg-neutral-500'}`} />
                            </div>

                            {/* Scrollable Content */}
                            <div className="flex-1 overflow-y-scroll scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
                                {renderSelectionParams()}
                            </div>
                        </div>
                        {/* Right Panel: Topology */}
                        {/* Right Panel: Topology */}
                        <div className="col-span-9 bg-neutral-950 relative">
                            <InteractiveTopology
                                config={config}
                                activeSelection={selection}
                                onSelect={setSelection}
                                simulationStatus={optimizing ? "running" : "idle"}
                            />
                        </div>
                    </div>
                )}

                {/* --- SIMULATION MODE --- */}
                {mainTab === "simulation" && (
                    <div className="h-full flex flex-row">
                        {/* Main Result Area */}
                        <div className="flex-1 bg-neutral-950 p-6 flex flex-col gap-6">

                            {/* Result / Monitor Panel */}
                            <div className="flex-1 border border-neutral-800 rounded-lg bg-neutral-900/30 relative overflow-hidden flex flex-col">
                                <div className="h-10 border-b border-neutral-800 px-4 flex items-center justify-between bg-neutral-900/50">
                                    <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                                        <Activity size={14} /> Simulation Results
                                    </span>
                                    {!loading && (runData || tuneData) && (
                                        <div className="flex gap-1">
                                            {([
                                                ...(runData ? [["summary", "Charts"], ["surface", "3D Surface"], ["waveform", "Waveform"]] : []),
                                                ...(tuneData ? [["tuning", "Tuning"]] : []),
                                            ] as [typeof resultView, string][]).map(([id, label]) => (
                                                <button
                                                    key={id}
                                                    onClick={() => setResultView(id)}
                                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                                                        resultView === id
                                                            ? "bg-neutral-100 text-black"
                                                            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 relative">
                                    {loading && (
                                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                                            <div className="w-6 h-6 border-2 border-neutral-700 border-t-neutral-100 rounded-full animate-spin"></div>
                                            <div className="text-neutral-500 text-sm font-mono">
                                                {progress
                                                    ? `Simulating cell ${progress.done}/${progress.total} (omp1)${progress.eta != null ? ` · ETA ~${progress.eta}s` : ""}...`
                                                    : "Simulating Physics Model..."}
                                            </div>
                                            {progress && progress.total > 0 && (
                                                <div className="w-64 h-1.5 bg-neutral-800 rounded overflow-hidden">
                                                    <div className="h-full bg-emerald-500 transition-all duration-300"
                                                         style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!loading && !runData && !tuneData && (
                                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 text-neutral-600 text-sm">
                                            {optimizing ? (
                                                <>
                                                    <div className="w-6 h-6 border-2 border-neutral-700 border-t-amber-500 rounded-full animate-spin" />
                                                    <div className="font-mono text-neutral-500 text-xs">
                                                        VANOS tuning in progress{tuneProgress ? ` — sim ${tuneProgress.done}/${tuneProgress.total}${tuneProgress.eta != null ? ` · ETA ~${tuneProgress.eta}s` : ""}` : "..."}
                                                    </div>
                                                </>
                                            ) : (
                                                <span>No simulation data. Run a simulation to view results.</span>
                                            )}
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "summary" && (
                                        <div className="absolute inset-0 overflow-auto p-1 flex flex-col gap-4 animate-in fade-in duration-500">
                                            <ValidityPanel overall={runData.overall} rows={runData.rows} />
                                            <div className="h-72 flex-shrink-0"><VeOverlayChart runData={runData} /></div>
                                            <div className="min-h-[340px] flex-shrink-0">
                                                <VETableComparison calibrationResult={runToCalibration(runData)} />
                                            </div>
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "surface" && (
                                        <div className="absolute inset-0 p-3 animate-in fade-in duration-500">
                                            <VeSurfaceChart runData={runData} />
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "waveform" && (
                                        <div className="absolute inset-0 p-3 animate-in fade-in duration-500">
                                            <VeWaveformChart config={runConfig ?? config} runData={runData} />
                                        </div>
                                    )}

                                    {!loading && tuneData && resultView === "tuning" && (
                                        <div className="absolute inset-0 overflow-auto p-3 animate-in fade-in duration-500">
                                            <TuningResults data={tuneData} />
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>

                        {/* Right: Sidebar Controls */}
                        <div className="w-72 border-l border-neutral-800 bg-neutral-950 p-6 flex flex-col gap-8 z-10">

                            {/* Actions */}
                            <div className="flex flex-col gap-4">
                                <div>
                                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Run Simulation</h3>
                                    <button
                                        onClick={() => handleRun("wot_quick")}
                                        disabled={loading || optimizing}
                                        className="w-full py-3 bg-neutral-100 hover:bg-white text-black font-semibold rounded text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Play size={16} fill="black" /> Run WOT Quick (20)
                                    </button>
                                    <button
                                        onClick={() => handleRun("full_map")}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-2 border border-neutral-700 hover:bg-neutral-800 text-neutral-300 rounded text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        title="480 cells at omp1 — this is SLOW (tens of minutes to hours cold; cached cells are instant on re-run)"
                                    >
                                        Run Full Map (480) · slow
                                    </button>
                                    <button
                                        onClick={() => handleLoadLast("full_map")}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-1.5 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 rounded text-[11px] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        title="Reload the last completed Full Map from the server (no re-run) — recovers a run whose fetch died"
                                    >
                                        <History size={12} /> Load last Full Map
                                    </button>
                                    {(loading || optimizing) && (
                                        <button
                                            onClick={handleCancel}
                                            className="mt-2 w-full py-1.5 border border-red-900/60 text-red-400 hover:bg-red-950/40 rounded text-[11px] font-semibold transition-all flex items-center justify-center gap-2"
                                            title="Stop every in-flight sim now (solver processes are killed). Finished cells stay cached — re-running the same request resumes."
                                        >
                                            <Square size={11} /> Cancel run
                                        </button>
                                    )}
                                </div>

                                <div className="pt-4 border-t border-neutral-800">
                                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Tuning <span className="text-neutral-600 normal-case">(VANOS · WOT)</span></h3>
                                    {/* preference (§6.C): user picks the goal, the objective stays internal */}
                                    <div className="flex gap-1 bg-neutral-900 p-1 rounded-md mb-2">
                                        {([["max_ve", "Max VE"], ["smooth", "Smooth"]] as const).map(([id, label]) => (
                                            <button
                                                key={id}
                                                onClick={() => setTunePref(id)}
                                                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                                                    tunePref === id
                                                        ? "bg-neutral-700 text-neutral-100"
                                                        : "text-neutral-500 hover:text-neutral-300"
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={handleRunTuning}
                                        disabled={loading || optimizing}
                                        className="w-full py-2 border border-neutral-700 hover:bg-neutral-800 text-neutral-200 rounded text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        title="Per-rpm VANOS cam search on the deterministic omp1 surface. SLOW cold (up to ~1h for all 20 rpm); cached evaluations resume instantly."
                                    >
                                        <Wrench size={13} /> {optimizing ? "Tuning..." : "Run VANOS Tuning"}
                                    </button>
                                    {optimizing && tuneProgress && (
                                        <div className="mt-2">
                                            <div className="text-[10px] font-mono text-neutral-500 mb-1">
                                                sim {tuneProgress.done}/{tuneProgress.total}{tuneProgress.eta != null ? ` · ETA ~${tuneProgress.eta}s` : ""}
                                            </div>
                                            <div className="w-full h-1 bg-neutral-800 rounded overflow-hidden">
                                                <div className="h-full bg-amber-500 transition-all duration-300"
                                                     style={{ width: `${Math.min(100, (tuneProgress.done / Math.max(1, tuneProgress.total)) * 100)}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleLoadLastTuning}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-1.5 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 rounded text-[11px] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        title="Reload the last completed tuning from the server (no re-run)"
                                    >
                                        <History size={12} /> Load last tuning
                                    </button>
                                    {(!runData || runData.overall.status === "red") && (
                                        <div className="text-[10px] text-amber-500/80 mt-2 leading-tight">
                                            {runData
                                                ? "Model is Not valid (§5) — tuning proposals are LOW-CONFIDENCE until the geometry calibration lands (§10)."
                                                : "No validity data yet — run a simulation first (§5); proposals are low-confidence."}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Config Actions */}
                            <div className="mt-auto">
                                <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Configuration</h3>
                                <div className="flex gap-2 text-neutral-400">
                                    <input type="file" accept=".json,application/json" ref={configFileRef}
                                        className="hidden" onChange={handleConfigFile} />
                                    <button onClick={handleConfigLoad} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Load config JSON (project)">
                                        <Upload size={14} />
                                    </button>
                                    <button onClick={handleConfigSave} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Save config JSON (project)">
                                        <Save size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Logs */}
                            <div className="mt-4 border-t border-neutral-800 pt-4">
                                <div className="h-24 font-mono text-[10px] text-neutral-600 overflow-y-auto">
                                    <div>[SYSTEM] Ready</div>
                                    {loading && progress && <div>[RUN] cell {progress.done}/{progress.total}</div>}
                                    {runData && <div className="text-emerald-500">[DONE] {runData.overall.verdict} ({runData.elapsed_sec}s)</div>}
                                    {notice && <div className="text-amber-400">[INFO] {notice}</div>}
                                    {error && <div className="text-red-500 font-bold">[ERROR] {error}</div>}
                                </div>
                            </div>

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VehicleBuilder;

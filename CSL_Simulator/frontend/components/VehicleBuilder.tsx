"use client";

import React, { useState } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Play, Activity, Settings2, Info, Wrench, BarChart2, Save, Upload, Download } from "lucide-react";
import { runCalibration, runOptimization, runSimulation, CalibrationResponse, SimConfig } from "../app/api";
import MapVisualizer from "./MapVisualizer";
import VETableComparison from "./VETableComparison";
import BinaryPatchManager from "./BinaryPatchManager";
import SimulationDebugPanel from "./SimulationDebugPanel";
import InteractiveTopology, { SelectionType } from "./InteractiveTopology";
import SimulationController from "./SimulationController";

const VehicleBuilder = () => {
    // --- STATE ---
    const [mainTab, setMainTab] = useState<"builder" | "simulation">("builder");

    const [loading, setLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [calibrationData, setCalibrationData] = useState<CalibrationResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [optimizationResult, setOptimizationResult] = useState<{ best_bias: number, max_ve: number } | null>(null);

    // Builder State
    const [selection, setSelection] = useState<SelectionType | null>({ type: "environment" });

    // config state
    const [config, setConfig] = useState<SimConfig>({
        environment: { ambient_temp: 298, ambient_pressure: 101325 },
        fuel: { lcv: 44000000, density: 750, stoich_ratio: 14.7 },
        simulation: { mesh_size: 0.01, openwam_version: 2200, duration_cycles: 10, step_size: 1.0 },
        intake: {
            type: "CSL Replica",
            inlet: { duct_length: 200, duct_diameter: 100 },
            plenum_vol: 10.5,
            bellmouth: { length: 120, diameter: 50, taper_angle: 3.5 },
            itb: { fitted: true, diameter: 50, plate_thickness: 2, discharge_coeff_map: "default_butterfly" }
        },
        engine: {
            cam_profile: "Stock CSL",
            rpm: 7900, // Default RPM
            cylinders: 6,
            geometry: { bore: 87.0, stroke: 91.0, compression_ratio: 11.5, rod_length: 139.0 },
            // Advanced Computed/Manual Overrides (Piston/Head Areas calculated in backend)
            combustion: { duration: 60.0, start_angle: -15.0, shape_parameter_m: 2.0, efficiency_a: 6.9, mass_burned_b: 0.5 },
            vanos_intake_bias: 0.0,
            friction: { coeffs: [0.5, 0, 0, 0] },
            heat_transfer: { woschni_coeffs: [2.28, 0.4, 0], global_factor: 1.0 },
            head: {
                port_flow_coeff: 1.0,
                valves_per_cyl: 4,
                wall_temp: 450,
                intake_port: { length: 80, diameter: 35, wall_temp: 400 },
                exhaust_port: { length: 60, diameter: 30, wall_temp: 800 },
                intake_valve: { lift_profile: "Stock", max_lift: 11.8, duration: 260, diameter: 35, open_angle_base: 350, flow_coeff_map: "S54_In" },
                exhaust_valve: { lift_profile: "Stock", max_lift: 11.2, duration: 260, diameter: 30, open_angle_base: 130, flow_coeff_map: "S54_Ex" }
            }
        },
        exhaust: {
            headers: { primary_length: 350, primary_diameter: 42, collector_vol: 1.5, collector_dia: 60 }, // S54 Stock Headers
            catalyst: { installed: true, location: "header_collector", cpsi: 200, length: 200, diameter: 120 }, // Default Catalyst
            section1_1: { length: 800, diameter: 60, layout: "Independent", crossover_offset: 400, name: "Section 1 (Bank 1)", cat_fitted: false, cat_offset: 0, wall_temp: 400, crossover_type: "none" },
            section1_2: { length: 800, diameter: 60, layout: "Independent", crossover_offset: 400, name: "Section 1 (Bank 2)", cat_fitted: false, cat_offset: 0, wall_temp: 400, crossover_type: "none" },
            section2: { length: 1200, diameter: 60, layout: "H-Pipe", resonator_fitted: true, resonator_location: "before_h", resonator_length: 300, resonator_diameter: 80, name: "Section 2", cat_fitted: false, cat_offset: 0, wall_temp: 400 }, // Default H-Pipe
            section3: { volume: 15.0, tailpipe_length: 200, diameter: 70 }, // Stock Muffler
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

    const handleRunCalibration = async () => {
        console.log("Button Clicked: Run Flow Sim");
        setLoading(true);
        setError(null);
        setMainTab("simulation"); // Auto switch to simulation tab
        try {
            console.log("Calling API runSimulation with config:", config);
            const data = await runSimulation(config);
            console.log("API Response:", data);
            setCalibrationData(data);
        } catch (err: any) {
            console.error("Simulation catch error:", err);
            setError(err.message || "Simulation failed");
        } finally {
            console.log("Finished (Finally block)");
            setLoading(false);
        }
    };

    const handleRunOptimization = async () => {
        setOptimizing(true);
        setMainTab("simulation"); // Auto switch
        try {
            const result = await runOptimization(config);
            setCalibrationData(result as any);
            alert("Optimization Completed! Check the 'Map Visualizer' for results.");
        } catch (error) {
            console.error(error);
            alert("Optimization Failed.");
        } finally {
            setOptimizing(false);
        }
    };

    const handleConfigLoad = () => { alert("Load Config Feature TBD (File Input)"); };
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
                            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-neutral-800">
                                <input type="checkbox" checked={config.intake.itb.fitted} onChange={(e) => updateConfig("intake", "itb.fitted", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                                <span className="text-sm font-medium text-neutral-300">ITB Fitted</span>
                            </div>
                        )}
                    </>
                )}

                {type === "runner" && (
                    <>
                        <SectionHeader title={`Runner #${(selection as any).index + 1}`} id={getPredictedID(selection)} />
                        <InputRow label="Runner Length" unit="mm" value={config.intake.bellmouth.length} onChange={(v: any) => updateConfig("intake", "bellmouth.length", v)} />
                        <div className="text-xs text-neutral-600 mt-2">Note: Changing this updates global bellmouth spec for all runners.</div>
                    </>
                )}

                {type === "cylinder" && (
                    <>
                        <SectionHeader title={`Cylinder #${(selection as any).index + 1}`} id={getPredictedID(selection)} />
                        <InputRow label="Bore" unit="mm" value={config.engine.geometry.bore} onChange={(v: any) => updateConfig("engine", "geometry.bore", v)} />
                        <InputRow label="Stroke" unit="mm" value={config.engine.geometry.stroke} onChange={(v: any) => updateConfig("engine", "geometry.stroke", v)} />
                        <div className="mt-4 p-3 bg-neutral-900 border border-neutral-800 rounded">
                            <InputRow label="VANOS Intake Bias" unit="Deg" value={config.engine.vanos_intake_bias} onChange={(v: any) => updateConfig("engine", "vanos_intake_bias", v)} />
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
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">PORT GEOMETRY (FIXED)</h4>
                            <InputRow label="In-Port Len" unit="mm" value={config.engine.head.intake_port.length} onChange={(v: any) => updateConfig("engine", "head.intake_port.length", v)} />
                            <InputRow label="Ex-Port Len" unit="mm" value={config.engine.head.exhaust_port.length} onChange={(v: any) => updateConfig("engine", "head.exhaust_port.length", v)} />
                        </div>
                    </>
                )}

                {type === "header" && (
                    <>
                        <SectionHeader title="Header Primary" id={getPredictedID(selection)} />
                        <InputRow label="Primary Length" unit="mm" value={config.exhaust.headers.primary_length} onChange={(v: any) => updateConfig("exhaust", "headers.primary_length", v)} />
                        <InputRow label="Diameter" unit="mm" value={config.exhaust.headers.primary_diameter} onChange={(v: any) => updateConfig("exhaust", "headers.primary_diameter", v)} />
                    </>
                )}

                {type === "collector" && (
                    <>
                        <SectionHeader title="Collector (Merge)" id={getPredictedID(selection)} />
                        <InputRow label="Collector Vol" unit="L" value={config.exhaust.headers.collector_vol} onChange={(v: any) => updateConfig("exhaust", "headers.collector_vol", v)} />
                        <InputRow label="Outlet Dia" unit="mm" value={config.exhaust.headers.collector_dia} onChange={(v: any) => updateConfig("exhaust", "headers.collector_dia", v)} />
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
                                </div>
                                <div className="flex-1 relative">
                                    {loading && (
                                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                                            <div className="w-6 h-6 border-2 border-neutral-700 border-t-neutral-100 rounded-full animate-spin"></div>
                                            <div className="text-neutral-500 text-sm font-mono">Simulating Physics Model...</div>
                                        </div>
                                    )}

                                    {!loading && !calibrationData && !optimizationResult && (
                                        <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm">
                                            No simulation data. Run a simulation to view results.
                                        </div>
                                    )}

                                    {(calibrationData || optimizationResult) && !loading && (
                                        <div className="absolute inset-0 overflow-auto p-4 animate-in fade-in duration-500">
                                            <MapVisualizer calibrationResult={calibrationData || (optimizationResult as any)} />
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
                                        onClick={handleRunCalibration}
                                        disabled={loading || optimizing}
                                        className="w-full py-3 bg-neutral-100 hover:bg-white text-black font-semibold rounded text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Play size={16} fill="black" /> Run Flow Sim
                                    </button>
                                </div>

                                <div className="pt-4 border-t border-neutral-800">
                                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Optimization</h3>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={() => alert("Hardware Opt TBD")} className="py-2 border border-neutral-700 hover:bg-neutral-800 rounded text-xs text-neutral-300 transition-colors">
                                            Hardware
                                        </button>
                                        <button onClick={handleRunOptimization} className="py-2 border border-neutral-700 hover:bg-neutral-800 rounded text-xs text-neutral-300 transition-colors">
                                            VANOS
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Config Actions */}
                            <div className="mt-auto">
                                <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Configuration</h3>
                                <div className="flex gap-2 text-neutral-400">
                                    <button onClick={handleConfigLoad} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Load">
                                        <Upload size={14} />
                                    </button>
                                    <button onClick={handleConfigSave} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Save">
                                        <Save size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Logs */}
                            <div className="mt-4 border-t border-neutral-800 pt-4">
                                <div className="h-24 font-mono text-[10px] text-neutral-600 overflow-y-auto">
                                    <div>[SYSTEM] Ready</div>
                                    {loading && <div>[INFO] Starting Simulation...</div>}
                                    {calibrationData && <div>[SUCCESS] Data Received.</div>}
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

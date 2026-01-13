"use client";

import React, { useState } from "react";
import PhysicalParamTuner from "../../components/PhysicalParamTuner";
import VETableComparison from "../../components/VETableComparison";
import { SimConfig, runCalibration, CalibrationResponse } from "../api";
import Link from "next/link";

export default function VerificationPage() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<CalibrationResponse | null>(null);

    // Default CSL Spec (Base)
    const [config, setConfig] = useState<SimConfig>({
        environment: { ambient_temp: 293, ambient_pressure: 101325 },
        intake: {
            type: "stock_csl",
            inlet: { duct_length: 300, duct_diameter: 100 },
            plenum_vol: 16.5,
            bellmouth: { length: 220, diameter: 50, taper_angle: 0 },
            itb: { fitted: true, diameter: 50, plate_thickness: 2, discharge_coeff_map: "default" }
        },
        engine: {
            cam_profile: "stock_csl",
            geometry: { bore: 87, stroke: 91, compression_ratio: 11.5, rod_length: 139 },
            combustion: { duration: 60, start_angle: -10, shape_parameter_m: 2.0, efficiency_a: 6900, mass_burned_b: 1.0 },
            vanos_intake_bias: 0,
            head: {
                port_flow_coeff: 1.0, valves_per_cyl: 4, wall_temp: 450,
                intake_valve: { lift_profile: "stock", max_lift: 12.0, duration: 280, flow_coeff_map: "default" },
                exhaust_valve: { lift_profile: "stock", max_lift: 12.0, duration: 276, flow_coeff_map: "default" }
            }
        },
        exhaust: {
            headers: { type: "stock", primary_length: 400, primary_diameter: 42, collector_count: 2, collector_dia: 60, wall_temp: 800, heat_coeff: 20 },
            section1: { name: "Section1", layout: "H-Pipe", length: 1200, diameter: 60, cat_fitted: true, cat_offset: 200, wall_temp: 600, crossover_type: "H-Pipe", crossover_offset: 0 },
            section2: { name: "Section2", layout: "Straight", length: 1500, diameter: 60, cat_fitted: false, cat_offset: 0, wall_temp: 400, resonator_fitted: true },
            section3: { name: "Muffler", layout: "Straight", length: 800, diameter: 60, cat_fitted: false, cat_offset: 0, wall_temp: 350, muffler_type: "Reflection", tailpipe_length: 200 }
        }
    });

    const handleRun = async () => {
        setLoading(true);
        try {
            const data = await runCalibration(config);
            setResult(data);
        } catch (err) {
            console.error(err);
            alert("Simulation failed. Check console/backend logs.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col">
            {/* Header */}
            <header className="bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between shadow-md z-10">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500">
                        Physical Model Verification
                    </h1>
                    <span className="text-xs text-slate-500 border border-slate-700 rounded px-2 py-0.5">V4.0 OpenWAM Engine</span>
                </div>
                <div className="flex gap-4">
                    <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors">
                        ← Back to Home
                    </Link>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 flex overflow-hidden p-4 gap-4">

                {/* Left Panel: Tuner */}
                <aside className="w-[400px] flex flex-col gap-4">
                    <PhysicalParamTuner config={config} onConfigChange={setConfig} />

                    <button
                        onClick={handleRun}
                        disabled={loading}
                        className={`w-full py-4 rounded-lg font-bold text-lg shadow-lg transition-all transform active:scale-95 flex items-center justify-center gap-2
                            ${loading
                                ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                                : "bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white"
                            }`}
                    >
                        {loading ? (
                            <>
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Simulating...
                            </>
                        ) : (
                            "Run Verification"
                        )}
                    </button>
                </aside>

                {/* Right Panel: Visualization */}
                <section className="flex-1 min-w-0">
                    <VETableComparison calibrationResult={result} />
                </section>

            </main>
        </div>
    );
}

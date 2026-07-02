"use client";

import React, { useState, useRef } from "react";
import { CalibrationResponse } from "../app/api";
import { Upload, FileJson, X } from "lucide-react";

interface VETableComparisonProps {
    calibrationResult: CalibrationResponse | null;
}

type ViewMode = 'target' | 'sim' | 'reference' | 'diff_target' | 'diff_ref' | 'correction';

const VETableComparison: React.FC<VETableComparisonProps> = ({ calibrationResult }) => {
    const [viewMode, setViewMode] = useState<ViewMode>('correction');
    const [referenceData, setReferenceData] = useState<number[][] | null>(null);
    const [referenceName, setReferenceName] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const binInputRef = useRef<HTMLInputElement>(null);

    // Helper to load reference
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                // Expecting full CalibrationResponse or just matrix
                // We try to find 'matrix.sim' or 'matrix.target'
                let matrixData: number[][] | null = null;

                if (json.matrix && json.matrix.sim) {
                    matrixData = json.matrix.sim;
                } else if (Array.isArray(json) && Array.isArray(json[0])) {
                    // Raw 2D array
                    matrixData = json;
                }

                if (matrixData) {
                    setReferenceData(matrixData);
                    setReferenceName(file.name);
                    setViewMode('reference');
                } else {
                    alert("Invalid JSON format. Expected Simulation Result JSON.");
                }
            } catch (err) {
                console.error(err);
                alert("Failed to parse JSON.");
            }
        };
        reader.readAsText(file);
    };

    const handleBinaryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            // Dynamically import API to avoid circular deps if any
            const { uploadBinary } = await import("../app/api");
            await uploadBinary(file);
            alert(`Successfully uploaded ${file.name}. \nPlease 'Run Flow Simulation' to update the Base Map comparison.`);
        } catch (error) {
            console.error(error);
            alert("Failed to upload binary.");
        }
    };

    // Prepare data if available
    const matrix = calibrationResult?.matrix;
    const hasData = !!matrix;

    // Axes (Default or Data)
    const axisRpm = matrix?.rpm || [];
    const axisLoad = matrix?.load || [];
    // Fallback if load empty (legacy simulation result)
    if (axisLoad.length === 0 && !hasData) {
        // Just empty placeholders or don't render table
    } else if (axisLoad.length === 0) {
        for (let i = 0; i < 16; i++) axisLoad.push(Math.round((i + 1) * 6.25));
    }

    // Determine data to show based on mode
    let dataToShow: number[][] = [];
    let title = "";
    let colorScale = (val: number) => "";
    let valueFormatter = (val: number) => val.toFixed(2);
    // Use 3 decimal places for raw values if user requested "1.202" style
    // If factor is applied (0-160), 3 decimals is good.

    /*
     * Color Logic:
     * - Correction: > 1.0 = Red (Add Fuel), < 1.0 = Blue (Remove Fuel)
     * - Diff: > 0 = Blue (Current Higher), < 0 = Red (Current Lower)
     */

    if (hasData && matrix) {
        switch (viewMode) {
            case 'target':
                dataToShow = matrix.target;
                title = "Base VE (Stock/Binary)";
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 60%, 0.3)`;
                valueFormatter = (val) => val.toFixed(3);
                break;
            case 'sim':
                dataToShow = matrix.sim;
                title = "Current: Simulated VE";
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 60%, 0.3)`;
                valueFormatter = (val) => val.toFixed(3);
                break;
            case 'reference':
                dataToShow = referenceData || [];
                title = referenceName ? `Reference: ${referenceName}` : "Reference Data (Not Loaded)";
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 60%, 0.3)`;
                valueFormatter = (val) => val.toFixed(3);
                break;
            case 'diff_target':
                // Current - Base
                dataToShow = matrix.sim.map((row, r) => row.map((s, c) => s - matrix.target[r][c]));
                title = "Delta: Current - Base";
                colorScale = (val) => {
                    if (Math.abs(val) < 0.5) return 'transparent';
                    // Improvement (Higher VE) = Red? User said "Improved VE = Red".
                    // Usually Higher VE is good.
                    if (val > 0.01) return `rgba(239, 68, 68, ${Math.min(val / 15, 0.8)})`; // Red (Improved)
                    return `rgba(59, 130, 246, ${Math.min(Math.abs(val) / 15, 0.8)})`; // Blue (Lower)
                };
                valueFormatter = (val) => (val > 0 ? "+" : "") + val.toFixed(3);
                break;
            case 'diff_ref':
                // Current - Reference
                if (referenceData) {
                    dataToShow = matrix.sim.map((row, r) => row.map((s, c) => s - (referenceData[r]?.[c] || 0)));
                    title = `Delta: Current - ${referenceName || 'Ref'}`;
                    colorScale = (val) => {
                        if (Math.abs(val) < 0.5) return 'transparent';
                        if (val > 0.01) return `rgba(239, 68, 68, ${Math.min(val / 15, 0.8)})`; // Red
                        return `rgba(59, 130, 246, ${Math.min(Math.abs(val) / 15, 0.8)})`; // Blue
                    };
                    valueFormatter = (val) => (val > 0 ? "+" : "") + val.toFixed(3);
                }
                break;
            case 'correction':
                dataToShow = matrix.correction;
                title = "Correction Map (Sim / Base)";
                colorScale = (val) => {
                    // > 1.05 = Real is Higher (Sim Underestimated) -> Need to Increase Sim? 
                    // Correction = Target / Sim. (Wait, let's stick to Target/Sim or Sim/Target?)
                    // Previous logic: row_c.append(s_val / t_val) ? 
                    // backend logic: row_c.append(s_val / t_val). If S > T, then > 1.
                    // If Sim > Target, we are Richer/More Efficient than Stock says.
                    // Factor > 1.

                    if (val > 1.01) return `rgba(239, 68, 68, ${Math.min((val - 1.0) * 10, 0.8)})`; // Red
                    if (val < 0.99) return `rgba(59, 130, 246, ${Math.min((1.0 - val) * 10, 0.8)})`; // Blue
                    return 'transparent';
                };
                valueFormatter = (val) => val.toFixed(3);
                break;
        }
    } else {
        title = "No Data";
    }

    return (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-4 mb-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-200">{title}</h2>

                    {/* Reference Uploader */}
                    <div className="flex items-center gap-2">
                        {/* Binary Uploader Input (Hidden) */}
                        <input
                            type="file"
                            accept=".bin"
                            ref={binInputRef}
                            className="hidden"
                            onChange={handleBinaryUpload}
                        />

                        <input
                            type="file"
                            accept=".json"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileUpload}
                        />

                        {/* Buttons */}
                        <button
                            onClick={() => binInputRef.current?.click()}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-slate-200 rounded border border-indigo-600"
                            title="Upload Stock CSL Binary (mss54.bin)"
                        >
                            <Upload size={12} /> Upload BIN
                        </button>

                        <div className="w-px h-4 bg-slate-600 mx-1"></div>

                        {referenceData ? (
                            <div className="flex items-center gap-2 bg-slate-700 px-2 py-1 rounded border border-slate-600">
                                <FileJson size={14} className="text-amber-400" />
                                <span className="text-xs text-slate-300 max-w-[100px] truncate">{referenceName}</span>
                                <button onClick={() => { setReferenceData(null); setReferenceName(null); if (viewMode === 'reference' || viewMode === 'diff_ref') setViewMode('sim'); }} className="text-slate-400 hover:text-white">
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600"
                            >
                                <Upload size={12} /> Load Ref
                            </button>
                        )}
                    </div>
                </div>

                {hasData && (
                    <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-700 w-fit">
                        <button onClick={() => setViewMode('target')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'target' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Base</button>
                        <button onClick={() => setViewMode('sim')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'sim' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Current</button>
                        <button onClick={() => setViewMode('diff_target')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'diff_target' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Diff (Base)</button>
                        {referenceData && (
                            <>
                                <div className="w-px bg-slate-700 mx-1"></div>
                                <button onClick={() => setViewMode('reference')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'reference' ? 'bg-slate-700 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}>Ref</button>
                                <button onClick={() => setViewMode('diff_ref')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'diff_ref' ? 'bg-slate-700 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}>Diff (Ref)</button>
                            </>
                        )}
                        <div className="w-px bg-slate-700 mx-1"></div>
                        <button onClick={() => setViewMode('correction')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode === 'correction' ? 'bg-slate-700 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>Correction</button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto border border-slate-700 rounded-lg bg-slate-900/50">
                {hasData ? (
                    <table className="w-full text-xs text-center border-collapse table-fixed">
                        <thead>
                            <tr>
                                <th className="sticky top-0 left-0 z-20 bg-slate-900 p-2 border-b border-r border-slate-700 font-mono text-slate-500 w-16">
                                    Load \ RPM
                                </th>
                                {axisRpm.map((x) => (
                                    <th key={x} className="sticky top-0 z-10 bg-slate-900 p-2 border-b border-slate-700 text-slate-300 font-mono">
                                        {x}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {axisLoad.map((load, r) => (
                                <tr key={r}>
                                    <th className="sticky left-0 z-10 bg-slate-900 p-2 border-r border-slate-700 text-slate-300 font-mono">
                                        {load}%
                                    </th>
                                    {dataToShow[r] ? dataToShow[r].map((val, c) => (
                                        <td
                                            key={c}
                                            className="p-1 border border-slate-700/30 text-slate-200 font-mono cursor-default hover:border-slate-500 transition-colors"
                                            style={{ backgroundColor: colorScale(val) }}
                                            title={`Load: ${load}%, RPM: ${axisRpm[c]}, Value: ${val.toFixed(3)}`}
                                        >
                                            {valueFormatter(val)}
                                        </td>
                                    )) : <td colSpan={axisRpm.length} className="text-slate-600">-</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 italic flex-col gap-2">
                        <span>No simulation data available.</span>
                        <span className="text-xs">Upload a CSL Binary above, then run "Flow Simulation" to see comparison.</span>
                    </div>
                )}
            </div>

            {hasData && viewMode.includes('diff') && (
                <div className="mt-2 text-xs flex justify-end gap-4 font-mono">
                    <span className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 opacity-80"></div> Improved (Higher)</span>
                    <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 opacity-80"></div> Reduced (Lower)</span>
                </div>
            )}

            {/* provenance-aware copy (§5/§10): the measured target only covers WOT */}
            {hasData && viewMode === 'target' && (
                <div className="mt-2 text-[11px] text-slate-500 font-mono leading-tight">
                    Base = this engine&apos;s MEASURED stock VE (wideband) — WOT row (100%) only.
                    Part-load rows show 0: no measured target is wired yet (narrowband+log
                    part-load data / BIN-derived reference lands with the calibration re-fit, §10).
                </div>
            )}
            {hasData && (viewMode === 'diff_target' || viewMode === 'correction') && (
                <div className="mt-2 text-[11px] text-slate-500 font-mono leading-tight">
                    Only the WOT row (100%) has a measured Base — part-load deltas/corrections
                    compare against 0 and are not meaningful until part-load targets land (§10).
                </div>
            )}
        </div>
    );
};

export default VETableComparison;

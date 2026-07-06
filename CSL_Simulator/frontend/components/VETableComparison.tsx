"use client";

import React, { useState, useRef } from "react";
import { CalibrationResponse } from "../app/api";
import { Upload, FileJson, X } from "lucide-react";

interface VETableComparisonProps {
    calibrationResult: CalibrationResponse | null;
    // Called after a BIN is uploaded so the parent can re-fetch the BIN-sourced
    // base VE map and refresh the Base VE / Correction table immediately.
    onBinUploaded?: () => void;
}

type ViewMode = 'target' | 'sim' | 'reference' | 'diff_target' | 'diff_ref' | 'correction';

const VETableComparison: React.FC<VETableComparisonProps> = ({ calibrationResult, onBinUploaded }) => {
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
            // Pull the just-uploaded BIN's VE map into the base immediately.
            onBinUploaded?.();
            alert(`Successfully uploaded ${file.name}.\nBase VE / Correction now reference this BIN.`);
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
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 55%, 0.22)`;
                valueFormatter = (val) => val.toFixed(3);
                break;
            case 'sim':
                dataToShow = matrix.sim;
                title = "Current: Simulated VE";
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 55%, 0.22)`;
                valueFormatter = (val) => val.toFixed(3);
                break;
            case 'reference':
                dataToShow = referenceData || [];
                title = referenceName ? `Reference: ${referenceName}` : "Reference Data (Not Loaded)";
                colorScale = (val) => `hsla(${240 - (Math.min(Math.max((val - 50) / 80, 0), 1) * 240)}, 70%, 55%, 0.22)`;
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
                    if (val > 0.01) return `rgba(239, 68, 68, ${Math.min(val / 15, 0.7)})`; // Red (Improved)
                    return `rgba(59, 130, 246, ${Math.min(Math.abs(val) / 15, 0.7)})`; // Blue (Lower)
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
                        if (val > 0.01) return `rgba(239, 68, 68, ${Math.min(val / 15, 0.7)})`; // Red
                        return `rgba(59, 130, 246, ${Math.min(Math.abs(val) / 15, 0.7)})`; // Blue
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

                    if (val > 1.01) return `rgba(239, 68, 68, ${Math.min((val - 1.0) * 9, 0.7)})`; // Red
                    if (val < 0.99) return `rgba(59, 130, 246, ${Math.min((1.0 - val) * 9, 0.7)})`; // Blue
                    return 'transparent';
                };
                valueFormatter = (val) => val.toFixed(3);
                break;
        }
    } else {
        title = "No Data";
    }

    return (
        <div className="flex flex-col h-full overflow-hidden gap-3">
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-neutral-100">{title}</h2>

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
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-transparent hover:bg-neutral-800 text-neutral-300 rounded border border-neutral-700 transition-colors"
                            title="Upload Stock CSL Binary (mss54.bin)"
                        >
                            <Upload size={12} /> Upload BIN
                        </button>

                        <div className="w-px h-4 bg-neutral-800 mx-1"></div>

                        {referenceData ? (
                            <div className="flex items-center gap-2 bg-neutral-800 px-2 py-1 rounded border border-neutral-700">
                                <FileJson size={14} className="text-amber-400" />
                                <span className="text-xs text-neutral-300 max-w-[100px] truncate">{referenceName}</span>
                                <button onClick={() => { setReferenceData(null); setReferenceName(null); if (viewMode === 'reference' || viewMode === 'diff_ref') setViewMode('sim'); }} className="text-neutral-500 hover:text-neutral-200">
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-transparent hover:bg-neutral-800 text-neutral-400 rounded border border-neutral-800 transition-colors"
                            >
                                <Upload size={12} /> Load Ref
                            </button>
                        )}
                    </div>
                </div>

                {hasData && (
                    <div className="flex flex-wrap gap-1 bg-neutral-900 rounded-md p-1 border border-neutral-800 w-fit">
                        <button onClick={() => setViewMode('target')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'target' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>Base</button>
                        <button onClick={() => setViewMode('sim')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'sim' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>Current</button>
                        <button onClick={() => setViewMode('diff_target')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'diff_target' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>Diff (Base)</button>
                        {referenceData && (
                            <>
                                <div className="w-px bg-neutral-800 mx-1"></div>
                                <button onClick={() => setViewMode('reference')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'reference' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}>Ref</button>
                                <button onClick={() => setViewMode('diff_ref')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'diff_ref' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}>Diff (Ref)</button>
                            </>
                        )}
                        <div className="w-px bg-neutral-800 mx-1"></div>
                        <button onClick={() => setViewMode('correction')} className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${viewMode === 'correction' ? 'bg-neutral-800 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}`}>Correction</button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-auto border border-neutral-800 rounded-lg bg-neutral-950/50 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
                {hasData ? (
                    <table className="w-full text-xs text-center border-collapse table-fixed">
                        <thead>
                            <tr>
                                <th className="sticky top-0 left-0 z-20 bg-neutral-950 p-2 border-b border-neutral-800 font-mono text-neutral-500 w-16">
                                    Load \ RPM
                                </th>
                                {axisRpm.map((x) => (
                                    <th key={x} className="sticky top-0 z-10 bg-neutral-950 p-2 border-b border-neutral-800 text-neutral-400 font-mono font-medium">
                                        {x}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {axisLoad.map((load, r) => (
                                <tr key={r}>
                                    <th className="sticky left-0 z-10 bg-neutral-950 p-2 text-neutral-400 font-mono font-medium">
                                        {load}%
                                    </th>
                                    {dataToShow[r] ? dataToShow[r].map((val, c) => (
                                        <td
                                            key={c}
                                            className="p-1.5 text-neutral-200 font-mono cursor-default transition-colors hover:bg-white/[0.06]"
                                            style={{ backgroundColor: colorScale(val) }}
                                            title={`Load: ${load}%, RPM: ${axisRpm[c]}, Value: ${val.toFixed(3)}`}
                                        >
                                            {valueFormatter(val)}
                                        </td>
                                    )) : <td colSpan={axisRpm.length} className="text-neutral-600">-</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="h-full flex items-center justify-center text-neutral-600 italic flex-col gap-2">
                        <span>No simulation data available.</span>
                        <span className="text-xs">Upload a CSL Binary above, then run "Flow Simulation" to see comparison.</span>
                    </div>
                )}
            </div>

            {hasData && viewMode.includes('diff') && (
                <div className="mt-2 text-xs flex justify-end gap-4 font-mono text-neutral-400">
                    <span className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 opacity-80"></div> Improved (Higher)</span>
                    <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 opacity-80"></div> Reduced (Lower)</span>
                </div>
            )}

            {/* provenance-aware copy: Base = measured wideband at WOT, ECU base map
                (uploaded BIN, else this repo's reference) at part-load. Provisional
                until part-load itself is calibrated. */}
            {hasData && viewMode === 'target' && (
                <div className="mt-2 text-[11px] text-neutral-500 font-mono leading-tight">
                    Base = WOT: this engine&apos;s MEASURED stock VE (wideband). Part-load: the ECU
                    base VE map (KF_RF_SOLL) — from the uploaded BIN if one is loaded, else this
                    repo&apos;s reference map. Provisional until part-load is calibrated.
                </div>
            )}
            {hasData && (viewMode === 'diff_target' || viewMode === 'correction') && (
                <div className="mt-2 text-[11px] text-neutral-500 font-mono leading-tight">
                    Part-load deltas/corrections compare sim against the ECU base map, not a
                    calibrated target — read them as provisional until part-load calibration lands.
                </div>
            )}
        </div>
    );
};

export default VETableComparison;

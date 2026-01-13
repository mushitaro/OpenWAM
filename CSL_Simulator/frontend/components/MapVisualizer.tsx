
"use client";

import React, { useEffect, useState } from "react";
import { fetchMaps, CalibrationResponse } from "../app/api";

interface MapData {
    description: string;
    unit: string;
    x_axis_label: string;
    y_axis_label: string;
    x_axis: number[];
    y_axis: number[];
    values: number[][];
}

interface MapVisualizerProps {
    calibrationResult?: CalibrationResponse | null;
}

const MapVisualizer: React.FC<MapVisualizerProps> = ({ calibrationResult }) => {
    const [maps, setMaps] = useState<Record<string, MapData> | null>(null);
    const [selectedKey, setSelectedKey] = useState<string>("kf_evan1_soll");
    const [loading, setLoading] = useState(false); // Default false if we allow props mode

    useEffect(() => {
        // Only fetch maps if we are NOT in calibration mode (or fetch anyway for reference)
        if (!calibrationResult) {
            setLoading(true);
            fetchMaps()
                .then((data) => {
                    setMaps(data);
                    setLoading(false);
                })
                .catch((err) => {
                    console.error(err);
                    setLoading(false);
                });
        }
    }, [calibrationResult]);

    // --- RENDER MODE: OPTIMIZATION RESULT (DELTA VIEW) ---
    // If we have optimization data, compare it with Stock WOT Curve
    if (calibrationResult && (calibrationResult as any).intake_bias) {
        // HACK: Detect optimization result by generic property check or updated type
        // The optimization result structure is { rpm: [], intake_bias: [], max_ve: [] }
        const optData = calibrationResult as any;

        // We need the Stock Map to compare
        // If maps are not loaded, we can't show Delta yet
        if (!maps) return <div className="text-slate-400 p-6">Loading Reference Maps...</div>;

        const stockMap = maps["kf_evan1_soll"];
        if (!stockMap) return <div className="text-red-400 p-6">Stock Map Not Found</div>;

        // Extract Stock WOT Curve (Max Load Row)
        // Ensure values exist
        const stockWOT = stockMap.values[stockMap.values.length - 1]; // Last row
        const stockRPM = stockMap.x_axis;

        // Optimization Data
        // We need to interp Stock to Opt RPMs or vice versa?
        // Let's map everything to the STOCK RPM axis for cleaner table

        // Simple linear interp
        const interp = (x: number, xs: number[], ys: number[]) => {
            // Find left index
            let i = 0;
            while (i < xs.length - 1 && xs[i + 1] < x) i++;
            const x0 = xs[i], x1 = xs[i + 1];
            const y0 = ys[i], y1 = ys[i + 1];
            if (x1 === x0) return y0;
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        };

        const comparisonData = stockRPM.map((rpm, idx) => {
            const stockVal = stockWOT[idx];
            // Interp optimized value at this RPM
            const optVal = interp(rpm, optData.rpm, optData.intake_bias);
            return {
                rpm,
                stock: stockVal,
                opt: optVal,
                delta: optVal - stockVal
            };
        });

        return (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-200">Auto-Optimization Result (WOT)</h2>
                    <div className="flex gap-4 text-xs font-mono">
                        <span className="text-emerald-400">Optimized</span>
                        <span className="text-slate-500">Stock</span>
                    </div>
                </div>

                <div className="flex-1 overflow-auto border border-slate-700 rounded-lg">
                    <table className="w-full text-xs text-center border-collapse">
                        <thead>
                            <tr>
                                <th className="sticky top-0 z-20 bg-slate-900 p-2 border-b border-r border-slate-700 text-slate-500 font-mono w-20">RPM</th>
                                <th className="sticky top-0 z-20 bg-slate-900 p-2 border-b border-slate-700 text-slate-500 font-mono">Stock (Deg)</th>
                                <th className="sticky top-0 z-20 bg-slate-900 p-2 border-b border-slate-700 text-emerald-500 font-mono">Optimized</th>
                                <th className="sticky top-0 z-20 bg-slate-900 p-2 border-b border-slate-700 text-slate-300 font-mono">Delta</th>
                            </tr>
                        </thead>
                        <tbody>
                            {comparisonData.map((row) => (
                                <tr key={row.rpm} className="border-b border-slate-800 hover:bg-slate-700/30">
                                    <td className="p-2 border-r border-slate-700 text-slate-400 font-mono">{row.rpm}</td>
                                    <td className="p-2 text-slate-500 font-mono">{row.stock.toFixed(1)}</td>
                                    <td className="p-2 text-emerald-400 font-bold font-mono">{row.opt.toFixed(1)}</td>
                                    <td className="p-2 font-mono" style={{ color: row.delta > 0 ? '#ef4444' : row.delta < 0 ? '#3b82f6' : '#94a3b8' }}>
                                        {row.delta > 0 ? "+" : ""}{row.delta.toFixed(1)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-4 h-32 w-full border border-slate-700 rounded bg-slate-900 relative">
                    {/* Mini Chart Visualization */}
                    <svg className="w-full h-full p-2" viewBox={`0 0 ${comparisonData.length * 10} 100`} preserveAspectRatio="none">
                        {/* Stock Line (Grey) */}
                        <polyline
                            fill="none"
                            stroke="#64748b"
                            strokeWidth="2"
                            points={comparisonData.map((d, i) => `${i * 10},${100 - ((d.stock + 20) / 80) * 100}`).join(" ")}
                        />
                        {/* Opt Line (Green) */}
                        <polyline
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2"
                            points={comparisonData.map((d, i) => `${i * 10},${100 - ((d.opt + 20) / 80) * 100}`).join(" ")}
                        />
                    </svg>
                    <div className="absolute top-1 right-2 text-[10px] text-slate-500">Y: -20 to 60 deg</div>
                </div>
            </div>
        );
    }

    // --- RENDER MODE: SIMULATION RESULTS (VE TABLE GRID) ---
    // If we have 'results' array (from /simulate/run), render the VE Map
    if (calibrationResult && (calibrationResult as any).results && Array.isArray((calibrationResult as any).results)) {
        const results = (calibrationResult as any).results as any[];

        // 1. Pivot Data
        // Get Unique RPMs and TPSs
        const rpms = Array.from(new Set(results.map(r => r.rpm))).sort((a, b) => a - b);
        const tps = Array.from(new Set(results.map(r => r.tps))).sort((a, b) => b - a); // Descending Load (100% top)

        // Build Grid
        // grid[tps_idx][rpm_idx]
        const grid: number[][] = [];
        tps.forEach(t => {
            const row: number[] = [];
            rpms.forEach(r => {
                const item = results.find(x => x.rpm === r && x.tps === t);
                row.push(item ? item.ve_sim : 0);
            });
            grid.push(row);
        });

        // Color Helper
        const getVEColor = (val: number) => {
            // VE Range typically 60-120
            const min = 70, max = 110;
            const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
            // Blue (Low) -> Green (Mid) -> Red (High)
            // Or just Heatmap style
            // Simple: Opacity of Emerald
            return `rgba(16, 185, 129, ${0.1 + ratio * 0.8})`;
        };

        return (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-200">Simulation Output: VE Table</h2>
                    <div className="text-xs font-mono text-slate-400">
                        {rpms.length}x{tps.length} Grid ({results.length} Points)
                    </div>
                </div>

                <div className="flex-1 overflow-auto border border-slate-700 rounded-lg">
                    <table className="w-full text-xs text-center border-collapse">
                        <thead>
                            <tr>
                                <th className="sticky top-0 left-0 z-20 bg-slate-900 p-2 border-b border-r border-slate-700 font-mono text-slate-500">TPS \ RPM</th>
                                {rpms.map((r) => (
                                    <th key={r} className="sticky top-0 z-10 bg-slate-900 p-2 border-b border-slate-700 text-slate-300 font-mono">{r}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {tps.map((t, rowIdx) => (
                                <tr key={t}>
                                    <th className="sticky left-0 z-10 bg-slate-900 p-2 border-r border-slate-700 text-slate-300 font-mono min-w-[60px]">
                                        {(t * 100).toFixed(0)}%
                                    </th>
                                    {grid[rowIdx].map((val, colIdx) => (
                                        <td
                                            key={colIdx}
                                            className="p-1 border border-slate-700/30 text-slate-200 font-mono hover:border-slate-500"
                                            style={{ backgroundColor: getVEColor(val) }}
                                            title={`RPM: ${rpms[colIdx]}, TPS: ${(t * 100).toFixed(0)}%, VE: ${val.toFixed(2)}`}
                                        >
                                            {val.toFixed(1)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // --- RENDER MODE: CALIBRATION RESULT (HEATMAP) ---
    if (calibrationResult && calibrationResult.matrix) {
        const { matrix } = calibrationResult;

        // Correction Matrix: 0.95 means Sim is 5% higher than Real -> Correction is *0.95
        // For visualization: 
        // > 1.0 (Green/Red?): Real is HIGHER than Sim. Need to ADD VE.
        // < 1.0 : Real is LOWER than Sim. Need to REMOVE VE.

        // Let's visualize "Error %" or "Correction Factor"
        // Correction Factor 1.05 = Add 5% fuel/VE.

        const minVal = 0.8;
        const maxVal = 1.2;

        const getHeatmapColor = (val: number) => {
            // 1.0 = Transparent/Slate
            // > 1.0 = Red (Lean/Underestimated)
            // < 1.0 = Blue (Rich/Overestimated)

            if (val > 1.005) {
                const intensity = Math.min((val - 1.0) * 10, 1.0); // scale 5% to 50% opacity
                return `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`; // Red-500
            } else if (val < 0.995) {
                const intensity = Math.min((1.0 - val) * 10, 1.0);
                return `rgba(59, 130, 246, ${0.1 + intensity * 0.7})`; // Blue-500
            }
            return 'rgba(148, 163, 184, 0.1)'; // Slate-400 (Neutral)
        };

        // Mock X-Axis for Load (0-100%)
        const xAxis = Array.from({ length: 16 }, (_, i) => Math.round((i + 1) * 6.25));

        return (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-200">Reality Sync: Correction Grid</h2>
                    <div className="flex gap-4 text-xs font-mono">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500/50 rounded-sm"></div> +Corr (Under-est)</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500/50 rounded-sm"></div> -Corr (Over-est)</div>
                    </div>
                </div>
                <div className="flex-1 overflow-auto border border-slate-700 rounded-lg">
                    <table className="w-full text-xs text-center border-collapse">
                        <thead>
                            <tr>
                                <th className="sticky top-0 left-0 z-20 bg-slate-900 p-2 border-b border-r border-slate-700 font-mono text-slate-500">RPM \ TPS</th>
                                {xAxis.map((x) => (
                                    <th key={x} className="sticky top-0 z-10 bg-slate-900 p-2 border-b border-slate-700 text-slate-300 font-mono">{x}%</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {matrix.rpm.map((rpm, r) => (
                                <tr key={rpm}>
                                    <th className="sticky left-0 z-10 bg-slate-900 p-2 border-r border-slate-700 text-slate-300 font-mono">{rpm}</th>
                                    {matrix.correction[r].map((val, c) => (
                                        <td
                                            key={c}
                                            className="p-1 border border-slate-700/30 text-slate-200 font-mono transition-colors hover:border-slate-500 cursor-help"
                                            style={{ backgroundColor: getHeatmapColor(val) }}
                                            title={`Sim: ${matrix.sim[r][c].toFixed(2)}, Target: ${matrix.target[r][c].toFixed(2)}, Corr: ${val.toFixed(3)}`}
                                        >
                                            {val.toFixed(2)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // --- RENDER MODE: STANDARD MAP VIEWER (Legacy/Reference) ---
    if (loading) return <div className="text-slate-400 p-6">Loading Maps...</div>;
    if (!maps) return <div className="text-slate-500 p-6 italic">No Map Data Loaded</div>;

    const currentMap = maps[selectedKey];
    // ... existing legacy render logic ...

    // Helper to colorize cells (Legacy)
    const getCellColor = (val: number, min: number, max: number) => {
        const ratio = (val - min) / (max - min || 1);
        return `rgba(16, 185, 129, ${0.1 + ratio * 0.6})`;
    };
    let minVal = Infinity; let maxVal = -Infinity;
    currentMap.values.forEach(row => row.forEach(v => { minVal = Math.min(minVal, v); maxVal = Math.max(maxVal, v); }));

    return (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-200">ECU Map Viewer</h2>
                <select
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                    <option value="kf_evan1_soll">Intake VANOS</option>
                    <option value="kf_avan1_soll">Exhaust VANOS</option>
                    <option value="kf_rf_soll">Alpha-N VE</option>
                </select>
            </div>

            <div className="mb-2 text-sm text-slate-400">
                {currentMap.description} ({currentMap.unit})
            </div>

            <div className="flex-1 overflow-auto border border-slate-700 rounded-lg">
                <table className="w-full text-xs text-center border-collapse">
                    <thead>
                        <tr>
                            <th className="sticky top-0 left-0 z-20 bg-slate-900 p-2 border-b border-r border-slate-700 font-mono text-slate-500">
                                {currentMap.y_axis_label} \ {currentMap.x_axis_label}
                            </th>
                            {currentMap.x_axis.map((x) => (
                                <th key={x} className="sticky top-0 z-10 bg-slate-900 p-2 border-b border-slate-700 text-slate-300 font-mono">
                                    {x}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {currentMap.y_axis.map((y, rowIdx) => (
                            <tr key={y}>
                                <th className="sticky left-0 z-10 bg-slate-900 p-2 border-r border-slate-700 text-slate-300 font-mono">
                                    {y}
                                </th>
                                {currentMap.values[rowIdx].map((val, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className="p-2 border border-slate-700/50 text-slate-200 font-mono transition-colors hover:border-slate-500"
                                        style={{ backgroundColor: getCellColor(val, minVal, maxVal) }}
                                        title={`RPM: ${currentMap.x_axis[colIdx]}, Load: ${y}, Val: ${val}`}
                                    >
                                        {val.toFixed(currentMap.unit === 'ratio' ? 3 : 0)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


export default MapVisualizer;

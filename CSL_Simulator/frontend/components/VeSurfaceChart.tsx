"use client";

// M3a (UX_APP_DEV_SPEC §6.B-2): 3D VE surface — x=rpm, y=load, z=VE.
// Toggle sim / stock / Δ. Driven straight off RunResponse.cells (no extra sim).
// A full_map run gives a real surface; wot_quick has one load row -> a 3D ridge.

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import type { Data, Layout, Config } from "plotly.js";
import type { RunResponse } from "../app/api";

// plotly.js touches window/document at import time -> must be client-only.
const Plot = dynamic(() => import("react-plotly.js"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center text-neutral-600 text-xs font-mono">
            loading 3D…
        </div>
    ),
});

type Mode = "sim" | "stock" | "delta";

// neutral palette shared with VeOverlayChart / ValidityPanel / VETableComparison
const AXIS = { color: "#a3a3a3", gridcolor: "#262626", zerolinecolor: "#404040" };

function buildZ(run: RunResponse, mode: Mode): (number | null)[][] {
    return run.cells.map((row) =>
        row.map((c) => {
            if (!c) return null;
            const sim = c.health?.ve_in_band ? c.ve_sim : null; // mask blow-ups -> z gap
            const stock = c.ve_stock;
            if (mode === "sim") return sim;
            if (mode === "stock") return stock ?? null;
            return sim != null && stock != null ? sim - stock : null; // delta
        }),
    );
}

const VeSurfaceChart: React.FC<{ runData: RunResponse }> = ({ runData }) => {
    const rpm = runData.axes.rpm;
    const load = runData.axes.load;
    const isSurface = load.length >= 2; // need >=2 load rows for a real surface

    // stock/delta only meaningful where measured stock exists (the WOT row).
    const stockAvailable = useMemo(
        () => runData.cells.some((row) => row.some((c) => c && c.ve_stock != null)),
        [runData],
    );

    const [mode, setMode] = useState<Mode>("sim");
    const z = useMemo(() => buildZ(runData, mode), [runData, mode]);

    const zLabel = mode === "delta" ? "Δ VE (sim − stock, pp)" : "VE %rf (ECU basis)";
    const colorscale = mode === "delta" ? "RdBu" : "Viridis";

    // diverging scale centred at 0 for delta
    const deltaAbsMax = useMemo(() => {
        if (mode !== "delta") return 1;
        let m = 0;
        for (const row of z) for (const v of row) if (v != null) m = Math.max(m, Math.abs(v));
        return m || 1;
    }, [z, mode]);

    const data: Data[] = useMemo(() => {
        if (isSurface) {
            const trace = {
                type: "surface",
                x: rpm,
                y: load,
                z,
                colorscale,
                reversescale: mode === "delta",
                ...(mode === "delta" ? { cmid: 0, cmin: -deltaAbsMax, cmax: deltaAbsMax } : {}),
                colorbar: {
                    title: { text: zLabel, side: "right" },
                    thickness: 12, len: 0.7, outlinewidth: 0,
                    tickfont: { color: AXIS.color, size: 9 },
                },
                contours: { z: { show: true, usecolormap: true, project: { z: true } } },
                hovertemplate: "rpm %{x}<br>load %{y}<br>" + zLabel + " %{z:.1f}<extra></extra>",
            };
            return [trace as unknown as Data];
        }
        // single load row -> a 3D ridge line (markers+line) instead of a flat surface
        const row = z[0] ?? [];
        const colour = mode === "delta" ? "#f59e0b" : "#38bdf8";
        const trace = {
            type: "scatter3d",
            mode: "lines+markers",
            x: rpm,
            y: rpm.map(() => load[0] ?? 0),
            z: row,
            line: { color: colour, width: 5 },
            marker: { size: 3, color: colour },
            hovertemplate: "rpm %{x}<br>" + zLabel + " %{z:.1f}<extra></extra>",
        };
        return [trace as unknown as Data];
    }, [isSurface, rpm, load, z, mode, colorscale, deltaAbsMax, zLabel]);

    const layout: Partial<Layout> = useMemo(() => {
        const ax = (text: string) => ({
            title: { text }, ...AXIS,
            backgroundcolor: "rgba(0,0,0,0)", showbackground: false,
        });
        return {
            autosize: true,
            margin: { l: 0, r: 0, t: 0, b: 0 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: { color: AXIS.color, size: 10 },
            scene: {
                xaxis: ax("RPM"),
                yaxis: ax("Load (TPS %)"),
                zaxis: ax(zLabel),
                camera: { eye: { x: 1.7, y: -1.6, z: 0.9 } },
                aspectmode: "cube",
            },
        } as Partial<Layout>;
    }, [zLabel]);

    const config: Partial<Config> = {
        displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage"],
    };

    const tabs: { id: Mode; label: string; disabled?: boolean }[] = [
        { id: "sim", label: "Sim" },
        { id: "stock", label: "Stock", disabled: !stockAvailable },
        { id: "delta", label: "Δ", disabled: !stockAvailable },
    ];

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                    <BarChart3 size={14} /> VE Surface
                </div>
                <div className="flex gap-1 bg-neutral-900 p-1 rounded-md border border-neutral-800">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => !t.disabled && setMode(t.id)}
                            disabled={t.disabled}
                            title={t.disabled ? "No measured stock for these cells" : `Show ${t.label}`}
                            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                mode === t.id
                                    ? "bg-neutral-800 text-neutral-100"
                                    : t.disabled
                                      ? "text-neutral-700 cursor-not-allowed"
                                      : "text-neutral-500 hover:text-neutral-300"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>
            {!isSurface && (
                <div className="text-[10px] font-mono text-amber-500/80 mb-1 flex-shrink-0">
                    Single load row ({load[0] ?? "—"}% TPS). Run{" "}
                    <span className="text-amber-400">Full Map</span> for a rpm×load surface.
                </div>
            )}
            {runData.model_limits && (
                <div className="text-[10px] font-mono text-amber-700 mb-1 flex-shrink-0">
                    ⚠ WOT {runData.model_limits.wot_deficit_band.rpm_min}-{runData.model_limits.wot_deficit_band.rpm_max}rpm:
                    1Dモデル恒久限界(3D箱モード欠落)— この帯の不足は仕様 ·
                    {runData.model_limits.bistable_cells.map(b => ` ${b.rpm}rpm: 双安定 ±${b.amplitude_pp}pp`)}
                </div>
            )}
            <div className="flex-1 min-h-[300px]">
                <Plot
                    data={data}
                    layout={layout}
                    config={config}
                    useResizeHandler
                    style={{ width: "100%", height: "100%" }}
                />
            </div>
        </div>
    );
};

export default VeSurfaceChart;

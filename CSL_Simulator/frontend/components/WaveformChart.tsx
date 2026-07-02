"use client";

// M3b (UX_APP_DEV_SPEC §6.B-2(ii)): crank-angle waveform inspector for ONE cell.
// Calls POST /simulate/waveform (a real full-monitoring sim ~2-3 min the first
// time, cached after) and plots last-complete-cycle in-cylinder pressure +
// curated intake/exhaust pipe pressure / velocity vs crank angle.

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, Play } from "lucide-react";
import type { Data, Layout, Config } from "plotly.js";
import { runWaveform, cancelRuns } from "../app/api";
import type { SimConfig, RunResponse, WaveformResponse } from "../app/api";

const Plot = dynamic(() => import("react-plotly.js"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center text-slate-600 text-xs font-mono">
            loading 3D…
        </div>
    ),
});

const AXIS = { color: "#94a3b8", gridcolor: "#334155", zerolinecolor: "#475569" };
const COLORS = ["#38bdf8", "#f59e0b", "#34d399", "#f43f5e", "#a78bfa", "#fbbf24",
    "#22d3ee", "#fb7185", "#4ade80", "#c084fc", "#60a5fa", "#f97316"];

type Metric = "pressure" | "velocity";

const VeWaveformChart: React.FC<{ config: SimConfig; runData: RunResponse }> = ({ config, runData }) => {
    const rpmAxis = runData.axes.rpm;
    const loadAxis = runData.axes.load.length ? runData.axes.load : [100];
    const defaultRpm = useMemo(
        () => rpmAxis.reduce((best, r) => (Math.abs(r - 3900) < Math.abs(best - 3900) ? r : best),
            rpmAxis[0] ?? 3900),
        [rpmAxis],
    );

    const [rpm, setRpm] = useState<number>(defaultRpm);
    const [load, setLoad] = useState<number>(loadAxis.includes(100) ? 100 : loadAxis[0]);
    const [data, setData] = useState<WaveformResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [metric, setMetric] = useState<Metric>("pressure");
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // M5 ETA polish: elapsed counter while the single-cell sim runs.
    // Timestamp-based (not tick-counted) so a backgrounded tab stays accurate.
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!loading) return;
        const start = Date.now();
        setElapsed(0);
        const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(id);
    }, [loading]);

    const run = async () => {
        setLoading(true);
        setError(null);
        try {
            const d = await runWaveform(config, rpm, load);
            if (d.status !== "success" || (d.cylinders.length === 0 && d.pipes.length === 0)) {
                setData(null);
                setError(d.note ?? "Waveform run produced no traces.");
                return;
            }
            setData(d);
            // default selection: cyl 1 + first intake pipe + first exhaust pipe
            const sel = new Set<string>();
            if (d.cylinders[0]) sel.add("c" + d.cylinders[0].id);
            const intake = d.pipes.find((p) => p.group === "intake");
            const exhaust = d.pipes.find((p) => p.group === "exhaust");
            if (intake) sel.add("p" + intake.id);
            if (exhaust) sel.add("p" + exhaust.id);
            setSelected(sel);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    const toggle = (key: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    const yTitle = metric === "pressure" ? "Pressure (bar)" : "Velocity (m/s)";

    const traces: Data[] = useMemo(() => {
        if (!data) return [];
        const out: Record<string, unknown>[] = [];
        let ci = 0;
        const push = (name: string, y: (number | null)[], color: string, dash?: string) =>
            out.push({
                type: "scatter", mode: "lines", name, x: data.crank_deg, y,
                line: { color, width: 1.6, ...(dash ? { dash } : {}) },
                hovertemplate: `${name}: %{y:.2f}<br>%{x:.0f}°<extra></extra>`,
            });
        if (metric === "pressure") {
            for (const c of data.cylinders) {
                if (selected.has("c" + c.id)) push(c.label, c.pressure_bar, COLORS[ci++ % COLORS.length]);
            }
        }
        for (const p of data.pipes) {
            if (!selected.has("p" + p.id)) continue;
            const y = metric === "pressure" ? p.pressure_bar : (p.velocity_ms ?? []);
            push(p.label, y, COLORS[ci++ % COLORS.length], p.group === "exhaust" ? "dot" : undefined);
        }
        return out as unknown as Data[];
    }, [data, selected, metric]);

    const layout: Partial<Layout> = useMemo(() => ({
        autosize: true,
        margin: { l: 52, r: 12, t: 8, b: 40 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: AXIS.color, size: 10 },
        showlegend: true,
        legend: { orientation: "h", y: -0.18, font: { size: 9 } },
        xaxis: { title: { text: "Crank angle (deg)" }, ...AXIS, dtick: 90, range: [0, 720] },
        yaxis: { title: { text: yTitle }, ...AXIS },
    }), [yTitle]);

    const config3d: Partial<Config> = { displaylogo: false, responsive: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d"] };

    const chip = (key: string, label: string, on: boolean, disabled = false) => (
        <button
            key={key}
            onClick={() => !disabled && toggle(key)}
            disabled={disabled}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                disabled
                    ? "border-slate-800 text-slate-700 cursor-not-allowed"
                    : on
                      ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                      : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700 flex flex-col h-full">
            <div className="flex items-center justify-between mb-2 flex-shrink-0 flex-wrap gap-2">
                <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Activity size={14} /> Crank-Angle Waveform
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-400">rpm</label>
                    <select
                        value={rpm}
                        onChange={(e) => setRpm(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 px-1.5 py-1"
                    >
                        {rpmAxis.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {loadAxis.length > 1 && (
                        <select
                            value={load}
                            onChange={(e) => setLoad(Number(e.target.value))}
                            className="bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 px-1.5 py-1"
                        >
                            {loadAxis.map((l) => <option key={l} value={l}>{l}% TPS</option>)}
                        </select>
                    )}
                    <button
                        onClick={run}
                        disabled={loading}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-100 text-black hover:bg-white disabled:opacity-50 flex items-center gap-1"
                    >
                        <Play size={11} fill="black" /> {data ? "Re-run" : "Run waveform"}
                    </button>
                </div>
            </div>

            {!data && !loading && (
                <div className="flex-1 flex items-center justify-center text-center text-slate-500 text-xs px-6">
                    Pick an operating point and run a single full-monitoring sim to inspect
                    in-cylinder pressure & in-pipe pressure / velocity vs crank angle.
                    <br />First run for a cell is a real sim (~2–3 min); repeats are cached & instant.
                </div>
            )}

            {loading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs font-mono">
                    <div className="w-6 h-6 border-2 border-slate-700 border-t-slate-100 rounded-full animate-spin" />
                    Running full-monitoring sim at {rpm} rpm… {elapsed}s elapsed (typically ~2–3 min, omp1)
                    <button
                        onClick={() => { void cancelRuns().catch(() => { /* surfaced via the failed fetch */ }); }}
                        className="mt-1 px-3 py-1 rounded text-[11px] border border-red-900/60 text-red-400 hover:bg-red-950/40"
                        title="Stop the waveform sim (no INS.DAT is produced for a killed run)"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {error && !loading && (
                <div className="text-[11px] text-red-400 font-mono mb-2">{error}</div>
            )}

            {data && !loading && (
                <>
                    <div className="flex flex-col gap-1.5 mb-2 flex-shrink-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14">Metric</span>
                            <div className="flex gap-1 bg-slate-900 p-0.5 rounded">
                                {(["pressure", "velocity"] as Metric[]).map((m) => (
                                    <button key={m} onClick={() => setMetric(m)}
                                        className={`px-2 py-0.5 rounded text-[10px] capitalize ${
                                            metric === m ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                                        {m}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[10px] font-mono text-slate-600">
                                {data.cached ? "cached · " : ""}{data.n_cycles} cyc · {data.crank_deg.length} pts
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14">In-cyl</span>
                            {data.cylinders.map((c) =>
                                chip("c" + c.id, c.label, selected.has("c" + c.id), metric === "velocity"))}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14">Intake</span>
                            {data.pipes.filter((p) => p.group === "intake").map((p) =>
                                chip("p" + p.id, p.label, selected.has("p" + p.id)))}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14">Exhaust</span>
                            {data.pipes.filter((p) => p.group === "exhaust").map((p) =>
                                chip("p" + p.id, p.label, selected.has("p" + p.id)))}
                        </div>
                    </div>
                    <div className="flex-1 min-h-[260px]">
                        {traces.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                                Select one or more channels above.
                            </div>
                        ) : (
                            <Plot data={traces} layout={layout} config={config3d} useResizeHandler
                                style={{ width: "100%", height: "100%" }} />
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default VeWaveformChart;

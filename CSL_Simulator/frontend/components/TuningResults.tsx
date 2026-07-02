"use client";

// M4 (UX_APP_DEV_SPEC §6.C/§7): VANOS tuning results — optimized-vs-baseline VE
// curve, per-rpm cam table with confidence flags, and ECU-table-layout export
// (clipboard TSV + CSV download of KF_EVAN1_SOLL / KF_AVAN1_SOLL with the
// optimized WOT row).

import React, { useMemo, useState } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Copy, Download, SlidersHorizontal, AlertTriangle, Check } from "lucide-react";
import type { OptimizationResponse, EcuTable } from "../app/api";

// slate palette shared with VeOverlayChart / ValidityPanel
const GRID = "#334155";
const TICK = "#94a3b8";

function tableToDelim(t: EcuTable, sep: string): string {
    const lines: string[] = [];
    lines.push([`${t.name} (${t.unit})`, ...t.x_axis.map(String)].join(sep));
    t.values.forEach((row, i) =>
        lines.push([String(t.y_axis[i]), ...row.map(String)].join(sep)));
    return lines.join("\n");
}

const TuningResults: React.FC<{ data: OptimizationResponse }> = ({ data }) => {
    const [copied, setCopied] = useState<string | null>(null);

    const chartData = useMemo(() => {
        const meas = new Map(data.stock_curve.map((p) => [p.rpm, p.ve]));
        return data.cells.map((c) => ({
            rpm: c.rpm,
            measured: meas.get(c.rpm) ?? null,
            baseline: c.stock.valid ? c.stock.ve : null,   // mask sick baselines
            optimized: c.chosen.valid ? c.chosen.ve : null,
        }));
    }, [data]);

    const anyLow = data.cells.some((c) => c.confidence === "low");

    const copy = async (key: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // clipboard denied (non-secure context) — fall back to download
            downloadText(`${key}.tsv`, text);
        }
    };

    const downloadText = (filename: string, text: string) => {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const downloadCsv = () => {
        const csv =
            tableToDelim(data.tables.intake, ",") + "\n\n" +
            tableToDelim(data.tables.exhaust, ",") + "\n";
        downloadText(`vanos_tuning_${data.run_id}.csv`, csv);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* header */}
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <SlidersHorizontal size={14} /> VANOS Tuning — WOT
                        <span className="text-[10px] font-mono text-slate-500">
                            {data.preference === "max_ve" ? "MAX VE" : "SMOOTH"} ·{" "}
                            {data.n_evals_total} sims · {Math.round(data.elapsed_sec)}s
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => copy("intake", tableToDelim(data.tables.intake, "\t"))}
                            className="px-2.5 py-1 rounded text-[11px] font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 flex items-center gap-1"
                            title="Copy KF_EVAN1_SOLL as a tab-separated block (paste into tuning software)"
                        >
                            {copied === "intake" ? <Check size={11} /> : <Copy size={11} />} Intake TSV
                        </button>
                        <button
                            onClick={() => copy("exhaust", tableToDelim(data.tables.exhaust, "\t"))}
                            className="px-2.5 py-1 rounded text-[11px] font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 flex items-center gap-1"
                            title="Copy KF_AVAN1_SOLL as a tab-separated block"
                        >
                            {copied === "exhaust" ? <Check size={11} /> : <Copy size={11} />} Exhaust TSV
                        </button>
                        <button
                            onClick={downloadCsv}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-100 text-black hover:bg-white flex items-center gap-1"
                            title="Download both ECU tables (WOT row optimized) as CSV"
                        >
                            <Download size={11} /> CSV
                        </button>
                    </div>
                </div>
                {anyLow && (
                    <div className="mt-2 text-[11px] text-amber-400/90 flex items-start gap-1.5">
                        <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                        <span>{data.low_confidence_note}</span>
                    </div>
                )}
            </div>

            {/* optimized vs baseline curve */}
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700 h-72 flex flex-col">
                <div className="text-xs font-semibold text-slate-300 mb-2">
                    WOT VE — baseline vs optimized
                </div>
                <div className="flex-1 min-h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                            <XAxis dataKey="rpm" tick={{ fill: TICK, fontSize: 10 }} stroke={GRID} />
                            <YAxis tick={{ fill: TICK, fontSize: 10 }} stroke={GRID}
                                domain={["dataMin - 2", "dataMax + 2"]} width={40} />
                            <Tooltip
                                contentStyle={{ backgroundColor: "#0f172a", border: `1px solid ${GRID}`, fontSize: 11 }}
                                labelStyle={{ color: TICK }}
                            />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Line type="monotone" dataKey="measured" name="Stock (measured)"
                                stroke="#f43f5e" strokeDasharray="4 3" dot={false} connectNulls />
                            <Line type="monotone" dataKey="baseline" name="Sim baseline"
                                stroke="#38bdf8" dot={{ r: 2 }} connectNulls />
                            <Line type="monotone" dataKey="optimized" name="Sim optimized"
                                stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* per-rpm cam table */}
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700 overflow-auto">
                <div className="text-xs font-semibold text-slate-300 mb-2">
                    Per-rpm cam targets (deg) — stock → optimized
                </div>
                <table className="w-full text-[11px] font-mono text-center border-collapse">
                    <thead>
                        <tr className="text-slate-500 border-b border-slate-700">
                            <th className="p-1.5 text-left">rpm</th>
                            <th className="p-1.5">Intake</th>
                            <th className="p-1.5">Exhaust</th>
                            <th className="p-1.5">VE base</th>
                            <th className="p-1.5">VE opt</th>
                            <th className="p-1.5">Δ VE</th>
                            <th className="p-1.5">evals</th>
                            <th className="p-1.5">conf</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.cells.map((c) => {
                            const changedIn = c.chosen.intake_cam !== c.stock.intake_cam;
                            const changedEx = c.chosen.exhaust_cam !== c.stock.exhaust_cam;
                            return (
                                <tr key={c.rpm} className="border-b border-slate-700/40 text-slate-300">
                                    <td className="p-1.5 text-left text-slate-400">{c.rpm}</td>
                                    <td className={`p-1.5 ${changedIn ? "text-emerald-300" : ""}`}>
                                        {c.stock.intake_cam}{changedIn ? ` → ${c.chosen.intake_cam}` : ""}
                                    </td>
                                    <td className={`p-1.5 ${changedEx ? "text-emerald-300" : ""}`}>
                                        {c.stock.exhaust_cam}{changedEx ? ` → ${c.chosen.exhaust_cam}` : ""}
                                    </td>
                                    <td className={`p-1.5 ${c.stock.valid ? "" : "text-red-400/70"}`}>
                                        {c.stock.ve.toFixed(1)}{c.stock.valid ? "" : " !"}
                                    </td>
                                    <td className={`p-1.5 ${c.chosen.valid ? "" : "text-red-400/70"}`}>
                                        {c.chosen.ve.toFixed(1)}{c.chosen.valid ? "" : " !"}
                                    </td>
                                    <td className={`p-1.5 ${(c.delta_ve ?? 0) > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                                        {c.delta_ve != null ? (c.delta_ve > 0 ? "+" : "") + c.delta_ve.toFixed(1) : "—"}
                                    </td>
                                    <td className="p-1.5 text-slate-500">{c.n_evals}</td>
                                    <td className="p-1.5">
                                        {c.confidence === "low"
                                            ? <span className="text-amber-400">low</span>
                                            : <span className="text-slate-500">ok</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div className="mt-2 text-[10px] font-mono text-slate-600">
                    &quot;!&quot; = health-gated (unconverged / imbalance / blow-up). Export tables carry the
                    full 16×16 ECU layout with only the WOT row ({data.tables.intake.y_axis[data.tables.intake.wot_row_index]}%) replaced.
                </div>
            </div>
        </div>
    );
};

export default TuningResults;

"use client";

import React from "react";
import { RunOverall, RunRow, TrafficStatus } from "../app/api";

const DOT: Record<TrafficStatus, string> = {
    green: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
    yellow: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]",
    red: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]",
};
const TEXT: Record<TrafficStatus, string> = {
    green: "text-emerald-400",
    yellow: "text-amber-400",
    red: "text-rose-400",
};

const Dot = ({ s }: { s: TrafficStatus }) => <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[s]}`} />;

const fmt = (v: number | null, nd = 3) => (v == null ? "—" : v.toFixed(nd));

/**
 * §5 validity-metrics panel: overall verdict chip + per-rpm-row traffic lights +
 * health strip. Tells the user whether the sim is a faithful representation
 * before they proceed to Tuning.
 */
const ValidityPanel: React.FC<{ overall: RunOverall; rows: RunRow[] }> = ({ overall, rows }) => {
    return (
        <div className="flex flex-col gap-3">
            {/* verdict */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Dot s={overall.status} />
                    <div>
                        <div className={`text-sm font-semibold ${TEXT[overall.status]}`}>{overall.verdict}</div>
                        <div className="text-[11px] font-mono text-neutral-500">
                            score {overall.score}/100 · r {fmt(overall.r)} · maxShapeErr {fmt(overall.max_shape_err)}
                        </div>
                    </div>
                </div>
                <div className="text-[11px] font-mono text-neutral-400 text-right">
                    <div>converged {overall.n_converged}/{overall.n_cells}</div>
                    <div>cyl-ok {overall.n_cyl_ok}/{overall.n_cells}</div>
                    {overall.any_red_health && <div className="text-rose-400 font-bold">health flags!</div>}
                </div>
            </div>

            {/* per-row table */}
            <div className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/50 scrollbar-thin scrollbar-thumb-neutral-800 scrollbar-track-transparent">
                <table className="w-full text-[11px] text-center font-mono border-collapse">
                    <thead>
                        <tr className="bg-neutral-950 text-neutral-500">
                            <th className="p-1.5">load</th>
                            <th className="p-1.5">r</th>
                            <th className="p-1.5">shapeErr</th>
                            <th className="p-1.5">maxΔp</th>
                            <th className="p-1.5">peak</th>
                            <th className="p-1.5">range s/k</th>
                            <th className="p-1.5">tilt s/k</th>
                            <th className="p-1.5">gated</th>
                            <th className="p-1.5">score</th>
                            <th className="p-1.5">status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="border-t border-neutral-800 text-neutral-300">
                                <td className="p-1.5">{row.load}%</td>
                                <td className={`p-1.5 ${TEXT[statusOf(row.r, 0.95, 0.85, true)]}`}>{fmt(row.r)}</td>
                                <td className={`p-1.5 ${TEXT[statusOf(row.max_shape_err, 0.05, 0.12, false)]}`}>{fmt(row.max_shape_err)}</td>
                                <td className={`p-1.5 ${row.wot_ratio_maxdp == null ? "text-neutral-600" : TEXT[statusOf(row.wot_ratio_maxdp, 0.05, 0.12, false)]}`}>{fmt(row.wot_ratio_maxdp)}</td>
                                <td className="p-1.5">{row.peak_match == null ? "—" : row.peak_match ? "✓" : "✗"}</td>
                                <td className="p-1.5">{fmt(row.range_sim_pp, 1)}/{fmt(row.range_stock_pp, 1)}</td>
                                <td className="p-1.5">{fmt(row.tilt_sim, 2)}/{fmt(row.tilt_stock, 2)}</td>
                                <td className={`p-1.5 ${row.n_gated > 0 ? "text-rose-400" : "text-neutral-500"}`}>{row.n_gated}</td>
                                <td className="p-1.5">{row.score}</td>
                                <td className="p-1.5"><Dot s={row.status} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="text-[10px] text-neutral-500">
                WOT = wideband (tight tolerances); part-load = narrowband-log (shape-based). Cells failing
                converged / cylinder-balance / VE-band are gated out of the shape metrics.
            </div>
        </div>
    );
};

// higher-is-better (r) vs lower-is-better (shapeErr) thresholding for cell tint
function statusOf(v: number | null, green: number, yellow: number, higherBetter: boolean): TrafficStatus {
    if (v == null || Number.isNaN(v)) return "red";
    if (higherBetter) return v >= green ? "green" : v >= yellow ? "yellow" : "red";
    return v <= green ? "green" : v <= yellow ? "yellow" : "red";
}

export default ValidityPanel;

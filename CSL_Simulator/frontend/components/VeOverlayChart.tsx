"use client";

import React from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ReferenceLine,
} from "recharts";
import { RunResponse } from "../app/api";

/**
 * 2D sim-vs-stock VE overlay for the WOT row (UX_APP_DEV_SPEC §6.B.3).
 * sim = solid, measured stock = dashed; a reference line marks the stock peak rpm.
 */
const VeOverlayChart: React.FC<{ runData: RunResponse }> = ({ runData }) => {
    const rpms = runData.axes.rpm;

    // pick the WOT row: the load row closest to 100% (= the measured wideband row)
    let wotRow = 0;
    let best = Infinity;
    runData.axes.load.forEach((l, i) => {
        const d = Math.abs(l - 100);
        if (d < best) { best = d; wotRow = i; }
    });

    const stockByRpm = new Map(runData.stock_curve.map((p) => [p.rpm, p.ve]));
    const data = rpms.map((rpm, c) => {
        const cell = runData.cells[wotRow]?.[c];
        // Only plot in-band VE so a blown-up / failed cell (e.g. 1925%) can't
        // distort the axis; the validity panel still reports those flags.
        const inBand = !!cell && cell.health.ve_in_band;
        return {
            rpm,
            sim: inBand ? cell!.ve_sim : null,
            stock: stockByRpm.has(rpm) ? stockByRpm.get(rpm)! : null,
            valid: cell ? cell.health.valid : false,
        };
    });

    const peakStock = runData.rows[wotRow]?.peak_rpm_stock ?? null;

    return (
        <div className="flex flex-col gap-2 h-full">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-200">
                    VE — Sim vs Stock (WOT, {runData.axes.load[wotRow]}%)
                </h3>
                <span className="text-[10px] font-mono text-neutral-500">
                    peak: sim {runData.rows[wotRow]?.peak_rpm_sim ?? "-"} / stock {peakStock ?? "-"}
                </span>
            </div>
            <div className="flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                        <XAxis dataKey="rpm" stroke="#a3a3a3" tick={{ fontSize: 11 }}
                               tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
                        <YAxis stroke="#a3a3a3" tick={{ fontSize: 11 }} domain={["auto", "auto"]}
                               label={{ value: "VE %", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "#171717", border: "1px solid #262626", borderRadius: 8, fontSize: 12 }}
                                 labelStyle={{ color: "#e5e5e5" }} formatter={(v: any) => (v == null ? "-" : Number(v).toFixed(1) + " %")} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {peakStock != null && (
                            <ReferenceLine x={peakStock} stroke="#f59e0b" strokeDasharray="4 4"
                                           label={{ value: "stock peak", fill: "#f59e0b", fontSize: 10, position: "top" }} />
                        )}
                        <Line type="monotone" dataKey="sim" name="Sim" stroke="#38bdf8" strokeWidth={2}
                              dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="stock" name="Stock (measured)" stroke="#f43f5e"
                              strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default VeOverlayChart;

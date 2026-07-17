"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ReferenceArea,
} from "recharts";
import { FlaskConical, RefreshCw } from "lucide-react";
import {
    TelemetryLogSummary, ValidationResponse, ValidationCell,
    fetchTelemetryLogs, compareValidation,
} from "../app/api";
import { useElementSize } from "./LiveTelemetry";

/**
 * Stage 76 P2 — measured-vs-simulated validation view.
 * Picks a recorded DS2 telemetry log, bins it onto the ECU map axes server-side
 * and shows: WOT overlay (measured rf vs sim VE, model-limit band shaded),
 * a per-cell delta matrix, and the VANOS ist/soll/map consistency check.
 *
 * Reading the 3900-5300 WOT band: the 1D model CANNOT host the airbox 3D box
 * mode there, so measured-minus-sim in that band is the EMPIRICAL box-mode
 * contribution, not a calibration error.
 */

const fmt = (v: number | null | undefined, nd = 1, unit = "") =>
    v == null ? "—" : `${v.toFixed(nd)}${unit}`;

// delta [pp] → cell background (red = measured above sim, blue = below)
function deltaColor(d: number | null): string {
    if (d == null) return "transparent";
    const a = Math.min(Math.abs(d) / 15, 1) * 0.55;
    return d >= 0 ? `rgba(239,68,68,${a})` : `rgba(59,130,246,${a})`;
}

const ValidationView: React.FC = () => {
    const [logs, setLogs] = useState<TelemetryLogSummary[]>([]);
    const [logId, setLogId] = useState<string>("");
    const [mode, setMode] = useState<string>("full_map");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rep, setRep] = useState<ValidationResponse | null>(null);
    const [chartRef, chartBox] = useElementSize();

    const refreshLogs = async () => {
        try {
            const ls = await fetchTelemetryLogs();
            setLogs(ls);
            // reset the selection when it's empty OR points at a deleted log
            // (otherwise the select DISPLAYS the first option while the stale
            // id is what actually gets submitted)
            if (!ls.some(l => l.log_id === logId)) setLogId(ls[0]?.log_id ?? "");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    useEffect(() => { refreshLogs(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const run = async () => {
        if (!logId) return;
        setBusy(true); setError(null);
        try {
            setRep(await compareValidation(logId, mode));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // ---- WOT overlay data (highest-RO row with data) ----
    const wotData = useMemo(() => {
        if (!rep) return [];
        const wot = rep.cells.filter(c => c.ro >= 85);
        const byRpm = new Map<number, { rpm: number; measured?: number; sim?: number; drrel?: number; psau?: number }>();
        for (const c of wot) {
            const e = byRpm.get(c.rpm) ?? { rpm: c.rpm };
            if (c.rf_mean != null) e.measured = c.rf_mean;
            if (c.sim_ve != null) e.sim = c.sim_ve;
            if (c.rf_drrel_mean != null) e.drrel = c.rf_drrel_mean;
            if (c.rf_psau_mean != null) e.psau = c.rf_psau_mean;
            byRpm.set(c.rpm, e);
        }
        return [...byRpm.values()].sort((a, b) => a.rpm - b.rpm);
    }, [rep]);

    // ---- delta matrix (RO rows x RPM cols) ----
    const matrix = useMemo(() => {
        if (!rep) return null;
        const rpms = [...new Set(rep.cells.map(c => c.rpm))].sort((a, b) => a - b);
        const ros = [...new Set(rep.cells.map(c => c.ro))].sort((a, b) => b - a);
        const idx = new Map<string, ValidationCell>();
        for (const c of rep.cells) idx.set(`${c.ro}|${c.rpm}`, c);
        return { rpms, ros, idx };
    }, [rep]);

    const band = rep?.model_limits?.wot_deficit_band;
    const vanosCells = rep?.cells.filter(c => c.evan_ist != null && c.evan_soll != null) ?? [];

    return (
        <div className="h-full overflow-auto p-4 flex flex-col gap-5 animate-in fade-in duration-500">
            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                    <FlaskConical size={14} /> 実測 vs シミュ検証
                </span>
                <select
                    value={logId}
                    onChange={e => setLogId(e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                >
                    {logs.length === 0 && <option value="">(記録ログなし — Live タブで記録)</option>}
                    {logs.map(l => (
                        <option key={l.log_id} value={l.log_id}>
                            {l.log_id.startsWith("mock_") ? "[合成] " : ""}{l.log_id}
                            {l.meta?.n_samples ? ` · ${l.meta.n_samples}pt` : ""}
                            {l.meta?.complete === false ? " · ⚠未完(記録中/中断)" : ""}
                        </option>
                    ))}
                </select>
                <button onClick={refreshLogs} title="ログ一覧を更新"
                        className="p-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800">
                    <RefreshCw size={13} />
                </button>
                <select
                    value={mode}
                    onChange={e => setMode(e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                >
                    <option value="full_map">vs full_map</option>
                    <option value="wot_standard">vs wot_standard</option>
                    <option value="wot_quick">vs wot_quick</option>
                </select>
                <button
                    onClick={run}
                    disabled={busy || !logId}
                    className="px-3 py-1 rounded text-xs font-medium bg-neutral-100 text-black disabled:opacity-40"
                >
                    {busy ? "比較中..." : "比較実行"}
                </button>
                {error && <span className="text-xs text-red-400">{error}</span>}
            </div>

            {!rep && !error && (
                <div className="text-neutral-600 text-sm">
                    Live (DS2) タブで記録したログを選び、シミュ結果 (last_run) と比較します。
                    実測 rf とシミュ VE は同じ ECU 単位 (m_ref 606.06mg) なので Δ はそのまま pp です。
                </div>
            )}

            {rep && (
                <>
                    {/* Summary chips */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            ["ビン化セル", `${rep.summary.n_cells}`, `gate: ${rep.gates.kept}/${rep.gates.total} 採択`],
                            ["WOT Δ (帯域外)", fmt(rep.summary.wot_delta_mean_ex_band, 1, " pp"), "校正誤差の指標 (小さいほど良)"],
                            ["WOT Δ (3900-5300)", fmt(rep.summary.wot_delta_mean_in_band, 1, " pp"), "≈ 箱モード寄与の実測値 (正が期待値)"],
                            ["VANOS 追従 |ist−soll|", fmt(rep.summary.vanos_tracking_mean_abs, 2, "°"), `map照合 ${fmt(rep.summary.vanos_map_match_mean_abs, 2, "°")}`],
                        ].map(([label, value, note]) => (
                            <div key={label as string} className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/40">
                                <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
                                <div className="text-lg font-mono text-neutral-100">{value}</div>
                                <div className="text-[10px] text-neutral-500">{note}</div>
                            </div>
                        ))}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                        条件: IAT {fmt(rep.conditions.iat_mean, 1, "°C")} / 水温 {fmt(rep.conditions.coolant_mean, 1, "°C")} /
                        大気圧 {fmt(rep.conditions.ambient_pressure_mean, 0, " mbar")} · 比較対象 run: {rep.run_id ?? "?"} ({rep.run_mode}, {rep.run_unit})
                    </div>

                    {/* WOT overlay */}
                    {wotData.length > 0 && (
                        <div className="border border-neutral-800 rounded-lg bg-neutral-900/40 p-3">
                            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                                WOT: 実測 rf vs シミュ VE
                            </div>
                            <div className="text-[10px] text-neutral-500 mb-2">
                                {band ? `${band.rpm_min}-${band.rpm_max} の網掛け帯 = 1Dモデル限界 (3D箱モード非搭載)。この帯の 実測−シミュ 差 ≈ 箱モード寄与の実測値。` : ""}
                            </div>
                            <div ref={chartRef} className="h-72 w-full">
                                {chartBox.w > 0 && chartBox.h > 0 && (
                                    <ComposedChart width={chartBox.w} height={chartBox.h} data={wotData}
                                                   margin={{ top: 6, right: 18, bottom: 4, left: 0 }}>
                                        <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                                        <XAxis dataKey="rpm" type="number" domain={["dataMin", "dataMax"]}
                                               stroke="#525252" tick={{ fontSize: 10 }} />
                                        <YAxis stroke="#525252" tick={{ fontSize: 10 }}
                                               domain={["auto", "auto"]}
                                               label={{ value: "rf / VE [%]", angle: -90, position: "insideLeft", fill: "#737373", fontSize: 10 }} />
                                        <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 11 }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        {band && (
                                            <ReferenceArea x1={band.rpm_min} x2={band.rpm_max}
                                                           fill="#f59e0b" fillOpacity={0.08}
                                                           stroke="#f59e0b" strokeOpacity={0.25} strokeDasharray="4 4" />
                                        )}
                                        <Line dataKey="sim" name="シミュ VE" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                                        <Scatter dataKey="measured" name="実測 rf (ビン平均)" fill="#f87171" />
                                        <Line dataKey="psau" name="rf_psau (MAP系)" stroke="#818cf8" strokeWidth={1}
                                              strokeDasharray="5 3" dot={false} connectNulls />
                                    </ComposedChart>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Delta matrix */}
                    {matrix && matrix.ros.length > 0 && (
                        <div className="border border-neutral-800 rounded-lg bg-neutral-900/40 p-3 overflow-x-auto">
                            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                                Δ マトリクス (実測 rf − シミュ VE) [pp] — 赤=実測が上 / 青=実測が下
                            </div>
                            <table className="text-[10px] font-mono border-collapse">
                                <thead>
                                    <tr>
                                        <th className="px-1.5 py-0.5 text-neutral-500 text-right">RO% \ rpm</th>
                                        {matrix.rpms.map(r => (
                                            <th key={r} className="px-1.5 py-0.5 text-neutral-500 text-right">{r}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrix.ros.map(ro => (
                                        <tr key={ro}>
                                            <td className="px-1.5 py-0.5 text-neutral-500 text-right">{ro}</td>
                                            {matrix.rpms.map(rpm => {
                                                const c = matrix.idx.get(`${ro}|${rpm}`);
                                                const inBand = !!band && ro >= band.load_min
                                                    && rpm >= band.rpm_min && rpm <= band.rpm_max;
                                                return (
                                                    <td key={rpm}
                                                        title={c ? `hits ${c.hits} · rf ${fmt(c.rf_mean)} vs sim ${fmt(c.sim_ve)}${c.sim_valid ? "" : " (sim invalid)"}` : ""}
                                                        style={{ background: deltaColor(c?.delta ?? null) }}
                                                        className={`px-1.5 py-0.5 text-right ${inBand ? "outline outline-1 outline-amber-500/40" : ""} ${c && !c.sim_valid ? "text-neutral-600 line-through" : "text-neutral-200"}`}>
                                                        {c?.delta != null ? c.delta.toFixed(1) : ""}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="text-[10px] text-neutral-500 mt-1.5">
                                琥珀枠 = モデル限界帯 (箱モード欠落 → 正の Δ が正常)。打消線 = シミュ側セルが invalid。
                            </div>
                        </div>
                    )}

                    {/* VANOS consistency */}
                    {vanosCells.length > 0 && (
                        <div className="border border-neutral-800 rounded-lg bg-neutral-900/40 p-3 overflow-x-auto">
                            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                                VANOS 整合 (吸気 evan / 排気 avan) [°KW]
                            </div>
                            <table className="text-[10px] font-mono border-collapse w-full max-w-3xl">
                                <thead>
                                    <tr className="text-neutral-500">
                                        {["rpm", "RO%", "evan ist", "evan soll", "evan map", "avan ist", "avan soll", "avan map", "tz実測", "tz期待"].map(h => (
                                            <th key={h} className="px-2 py-0.5 text-right border-b border-neutral-800">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {vanosCells.map(c => (
                                        <tr key={`${c.ro}|${c.rpm}`} className="text-neutral-300">
                                            <td className="px-2 py-0.5 text-right">{c.rpm}</td>
                                            <td className="px-2 py-0.5 text-right">{c.ro}</td>
                                            <td className="px-2 py-0.5 text-right">{fmt(c.evan_ist)}</td>
                                            <td className="px-2 py-0.5 text-right">{fmt(c.evan_soll)}</td>
                                            <td className="px-2 py-0.5 text-right text-neutral-500">{fmt(c.evan_map)}</td>
                                            <td className="px-2 py-0.5 text-right">{fmt(c.avan_ist)}</td>
                                            <td className="px-2 py-0.5 text-right">{fmt(c.avan_soll)}</td>
                                            <td className="px-2 py-0.5 text-right text-neutral-500">{fmt(c.avan_map)}</td>
                                            <td className="px-2 py-0.5 text-right">{fmt(c.tz_mean)}</td>
                                            <td className="px-2 py-0.5 text-right text-neutral-500">{fmt(c.tz_expected)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="text-[10px] text-neutral-500 mt-1.5">
                                soll vs map の恒常オフセット = DME 文書で未確認だった°KW⇄カム角変換規約の実測値。tz期待 = シミュが使う KF_TZ_VL / 二段引き。
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ValidationView;

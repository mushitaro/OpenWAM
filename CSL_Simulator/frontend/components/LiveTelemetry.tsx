"use client";

import React, { useEffect, useRef, useState } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Plug, PlugZap, Circle, Square, Download, Radio } from "lucide-react";
import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection } from "../lib/dme-link/types";
import { WebSerialTransport } from "../lib/dme-link/webSerialTransport";
import { WebSerialDmeLink } from "../lib/dme-link/webSerialDmeLink";
import { MockDmeLink } from "../lib/dme-link/mockDmeLink";
import { saveTelemetryLog } from "../app/api";

/**
 * Stage 76 — Live DS2 telemetry: connect to the real MSS54 DME over a K-line
 * cable (Web Serial; Chrome/Edge desktop) or the built-in mock, watch live
 * values, and record logs for the measured-vs-simulated validation pipeline.
 */

const CHART_WINDOW_S = 60;
type ChartGroup = "rpm" | "load" | "vanos" | "ign";

// MLV/Testo-compatible CSV channel names (megalogsetting/*.settings) so a
// recorded log drops straight into the owner's MegaLogViewer workflow.
const CSV_COLUMNS: { header: string; get: (s: LiveSample) => number | string }[] = [
    { header: "time", get: s => s.t.toFixed(3) },
    { header: "RPM", get: s => s.rpm },
    { header: "relativer Oeffnungsquerschnitt", get: s => s.ro ?? "" },
    { header: "Relative Fuellung", get: s => s.rf ?? "" },
    { header: "rf_psau", get: s => s.rfPsau ?? "" },
    { header: "rf_drrel", get: s => s.rfDrrel ?? "" },
    { header: "MAP", get: s => s.map ?? "" },
    { header: "evan1_ist", get: s => s.evanIst ?? "" },
    { header: "evan1_soll", get: s => s.evanSoll ?? "" },
    { header: "avan1_ist", get: s => s.avanIst ?? "" },
    { header: "avan1_soll", get: s => s.avanSoll ?? "" },
    { header: "Lambdaintegrator 1", get: s => s.stft1 ?? "" },
    { header: "Lambdaintegrator 2", get: s => s.stft2 ?? "" },
    { header: "Kuehlmitteltemperatur", get: s => s.coolant ?? "" },
    { header: "Ansauglufttemperatur", get: s => s.iat ?? "" },
    { header: "Umgebungsdruck", get: s => s.ambientPressure ?? "" },
    { header: "Pedalwert", get: s => s.pedal ?? "" },
    { header: "Drosselklappe", get: s => s.throttle ?? "" },
    { header: "Zuendwinkel 1", get: s => s.tz?.[0] ?? "" },
    { header: "Zuendwinkel 2", get: s => s.tz?.[1] ?? "" },
    { header: "Zuendwinkel 3", get: s => s.tz?.[2] ?? "" },
    { header: "Zuendwinkel 4", get: s => s.tz?.[3] ?? "" },
    { header: "Zuendwinkel 5", get: s => s.tz?.[4] ?? "" },
    { header: "Zuendwinkel 6", get: s => s.tz?.[5] ?? "" },
    { header: "Geschwindigkeit", get: s => s.speed ?? "" },
];

function toCsv(samples: LiveSample[]): string {
    const lines = [CSV_COLUMNS.map(c => c.header).join(";")];
    for (const s of samples) lines.push(CSV_COLUMNS.map(c => String(c.get(s))).join(";"));
    return lines.join("\n");
}

const fmt = (v: number | undefined, nd = 1, unit = "") =>
    v == null ? "—" : `${v.toFixed(nd)}${unit}`;

/**
 * Explicit element-size hook: ResizeObserver + a slow polling fallback.
 * recharts' ResponsiveContainer can wedge at 0x0 in headless/embedded
 * browsers whose ResizeObserver never fires after the initial 0-size mount —
 * measuring ourselves and passing explicit width/height renders everywhere.
 * Uses a CALLBACK ref so it also works for conditionally-rendered targets
 * (the chart box only mounts once connected).
 */
function useElementSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
        if (!el) { setSize({ w: 0, h: 0 }); return; }
        const measure = () => {
            const w = el.clientWidth, h = el.clientHeight;
            setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        const iv = setInterval(measure, 1000);   // fallback for wedged observers
        window.addEventListener("resize", measure);
        return () => { ro?.disconnect(); clearInterval(iv); window.removeEventListener("resize", measure); };
    }, [el]);
    return [setEl, size];
}

const LiveTelemetry: React.FC = () => {
    const webSerialOk = WebSerialTransport.isSupported();
    const [mode, setMode] = useState<"webserial" | "mock">(webSerialOk ? "webserial" : "mock");
    const [state, setState] = useState<"disconnected" | "connecting" | "connected">("disconnected");
    const [identity, setIdentity] = useState<DmeIdentity | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [blocks, setBlocks] = useState<LiveBlockSelection[]>([3, 19, 35]);
    const [latest, setLatest] = useState<LiveSample | null>(null);
    const [rateHz, setRateHz] = useState<number | null>(null);
    const [chartGroup, setChartGroup] = useState<ChartGroup>("rpm");
    const [recording, setRecording] = useState(false);
    const [recCount, setRecCount] = useState(0);
    const [lastSaved, setLastSaved] = useState<string | null>(null);

    const [chartBoxRef, chartBox] = useElementSize();
    const linkRef = useRef<DmeTelemetryLink | null>(null);
    const pollingRef = useRef(false);
    const blocksRef = useRef<LiveBlockSelection[]>(blocks);
    const recordingRef = useRef(false);
    const recordedRef = useRef<LiveSample[]>([]);
    const windowRef = useRef<LiveSample[]>([]);   // rolling chart window
    const stampsRef = useRef<number[]>([]);       // wall-clock stamps for the rate
    const [, forceRender] = useState(0);

    useEffect(() => { blocksRef.current = blocks; }, [blocks]);
    useEffect(() => () => { pollingRef.current = false; linkRef.current?.disconnect(); }, []);

    const connect = async () => {
        setError(null);
        setState("connecting");
        const link: DmeTelemetryLink = mode === "mock" ? new MockDmeLink() : new WebSerialDmeLink();
        try {
            const id = await link.connect();
            linkRef.current = link;
            setIdentity(id);
            setState("connected");
            pollingRef.current = true;
            void pollLoop(link);
        } catch (e) {
            setState("disconnected");
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const disconnect = async () => {
        pollingRef.current = false;
        recordingRef.current = false;
        setRecording(false);
        try { await linkRef.current?.disconnect(); } catch { }
        linkRef.current = null;
        setState("disconnected");
        setIdentity(null);
        setRateHz(null);
    };

    const pollLoop = async (link: DmeTelemetryLink) => {
        let consecutiveErrors = 0;
        while (pollingRef.current) {
            try {
                const sample = await link.pollSample(blocksRef.current);
                consecutiveErrors = 0;
                setLatest(sample);

                const now = performance.now();
                stampsRef.current.push(now);
                while (stampsRef.current.length && stampsRef.current[0] < now - 5000) stampsRef.current.shift();
                setRateHz(stampsRef.current.length / 5);

                windowRef.current.push(sample);
                while (windowRef.current.length && sample.t - windowRef.current[0].t > CHART_WINDOW_S) {
                    windowRef.current.shift();
                }
                if (recordingRef.current) {
                    recordedRef.current.push(sample);
                    setRecCount(recordedRef.current.length);
                }
                forceRender(n => n + 1);
            } catch (e) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                    setError(`ポーリングが連続失敗しました: ${e instanceof Error ? e.message : e}`);
                    await disconnect();
                    return;
                }
            }
        }
    };

    const startRecording = () => {
        recordedRef.current = [];
        setRecCount(0);
        linkRef.current?.resetClock();
        windowRef.current = [];
        recordingRef.current = true;
        setRecording(true);
        setNotice(null);
        setLastSaved(null);
    };

    const stopRecording = async () => {
        recordingRef.current = false;
        setRecording(false);
        const samples = recordedRef.current;
        if (!samples.length) { setNotice("記録サンプルがありません。"); return; }
        try {
            const res = await saveTelemetryLog(samples, {
                source: mode, vin: identity?.vin, software: identity?.softwareVersion,
                blocks: blocksRef.current,
            });
            setLastSaved(res.log_id);
            setNotice(`ログを保存しました: ${res.log_id}(${res.n_samples} サンプル)。Validation ビューで比較できます。`);
        } catch (e) {
            setNotice(`バックエンド保存に失敗(${e instanceof Error ? e.message : e})。CSV ダウンロードは可能です。`);
        }
    };

    const downloadCsv = () => {
        const samples = recordedRef.current.length ? recordedRef.current : windowRef.current;
        if (!samples.length) return;
        const blob = new Blob([toCsv(samples)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ds2_log_${lastSaved ?? new Date().toISOString().replace(/[:T-]/g, "").slice(0, 14)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleBlock = (b: LiveBlockSelection) => {
        setBlocks(prev => prev.includes(b)
            ? (b === 3 ? prev : prev.filter(x => x !== b))   // block 3 stays (rpm/RO source)
            : [...prev, b].sort((x, y) => x - y) as LiveBlockSelection[]);
    };

    const chartData = windowRef.current.map(s => ({
        t: Math.round(s.t * 10) / 10,
        rpm: s.rpm,
        rf: s.rf ?? null,
        ro: s.ro ?? null,
        map: s.map != null ? s.map / 10 : null,   // mbar/10 to share the % scale loosely
        evanIst: s.evanIst ?? null, evanSoll: s.evanSoll ?? null,
        avanIst: s.avanIst ?? null, avanSoll: s.avanSoll ?? null,
        tzAvg: s.tz && s.tz.some(v => v != null)
            ? Math.round((s.tz.filter((v): v is number => v != null)
                .reduce((a, b) => a + b, 0) / s.tz.filter(v => v != null).length) * 10) / 10
            : null,
        speed: s.speed ?? null,
    }));

    const groupLines: Record<ChartGroup, { key: string; name: string; color: string; dash?: string }[]> = {
        rpm: [{ key: "rpm", name: "RPM", color: "#38bdf8" }],
        load: [
            { key: "rf", name: "rf %", color: "#34d399" },
            { key: "ro", name: "RO %", color: "#f59e0b" },
            { key: "map", name: "MAP/10 mbar", color: "#a78bfa" },
        ],
        vanos: [
            { key: "evanIst", name: "EVAN ist", color: "#38bdf8" },
            { key: "evanSoll", name: "EVAN soll", color: "#38bdf8", dash: "4 3" },
            { key: "avanIst", name: "AVAN ist", color: "#f43f5e" },
            { key: "avanSoll", name: "AVAN soll", color: "#f43f5e", dash: "4 3" },
        ],
        ign: [
            { key: "tzAvg", name: "点火平均 °KW", color: "#f59e0b" },
            { key: "speed", name: "車速 km/h", color: "#525252" },
        ],
    };

    return (
        <div className="flex flex-col gap-4 h-full overflow-auto p-1">
            {/* connection bar */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1 bg-neutral-900 p-1 rounded-md border border-neutral-800">
                    {(["webserial", "mock"] as const).map(m => (
                        <button key={m} disabled={state !== "disconnected"} onClick={() => setMode(m)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium ${mode === m ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"} disabled:opacity-60`}>
                            {m === "webserial" ? "実車 (K-Line)" : "モック"}
                        </button>
                    ))}
                </div>
                {state !== "connected" ? (
                    <button onClick={connect} disabled={state === "connecting" || (mode === "webserial" && !webSerialOk)}
                        className="px-3 py-1.5 rounded text-[12px] font-semibold bg-neutral-100 text-black hover:bg-white disabled:opacity-50 flex items-center gap-1.5">
                        <Plug size={13} /> {state === "connecting" ? "接続中..." : "接続"}
                    </button>
                ) : (
                    <button onClick={disconnect}
                        className="px-3 py-1.5 rounded text-[12px] font-semibold border border-neutral-700 text-neutral-300 hover:bg-neutral-800 flex items-center gap-1.5">
                        <PlugZap size={13} /> 切断
                    </button>
                )}
                {!webSerialOk && mode === "webserial" && (
                    <span className="text-[11px] text-amber-400">Web Serial 非対応の環境です(Chrome/Edge デスクトップが必要)— モックを使用してください</span>
                )}
                {identity && (
                    <span className="text-[10px] font-mono text-neutral-500">
                        VIN {identity.vin} · SW {identity.softwareVersion}
                    </span>
                )}
                {rateHz != null && state === "connected" && (
                    <span className="text-[10px] font-mono text-emerald-500 flex items-center gap-1">
                        <Radio size={11} /> {rateHz.toFixed(1)} Hz
                    </span>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[10px] text-neutral-500">ブロック:</span>
                    {([3, 19, 35] as LiveBlockSelection[]).map(b => (
                        <label key={b} className="flex items-center gap-1 text-[11px] text-neutral-400">
                            <input type="checkbox" checked={blocks.includes(b)} disabled={b === 3}
                                onChange={() => toggleBlock(b)} className="rounded border-neutral-700 bg-neutral-900" />
                            {b === 3 ? "3 基本" : b === 19 ? "19 点火/λ" : "35 VANOS"}
                        </label>
                    ))}
                </div>
            </div>

            {error && <div className="text-[11px] text-red-400 font-mono">{error}</div>}
            {notice && <div className="text-[11px] text-amber-400/90">{notice}</div>}

            {/* live value grid */}
            {latest && state === "connected" && (
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                    {[
                        ["RPM", fmt(latest.rpm, 0)],
                        ["RO", fmt(latest.ro, 1, " %")],
                        ["rf", fmt(latest.rf, 1, " %")],
                        ["rf α-N", latest.rfDrrel != null ? (latest.rfDrrel * 100).toFixed(1) + " %" : "—"],
                        ["MAP", fmt(latest.map, 0, " mbar")],
                        ["吸気温", fmt(latest.iat, 0, " °C")],
                        ["EVAN ist/soll", `${fmt(latest.evanIst, 1)}/${fmt(latest.evanSoll, 1)}`],
                        ["AVAN ist/soll", `${fmt(latest.avanIst, 1)}/${fmt(latest.avanSoll, 1)}`],
                        ["点火 (cyl1)", fmt(latest.tz?.[0] ?? undefined, 1, " °KW")],
                        ["水温", fmt(latest.coolant, 0, " °C")],
                        ["大気圧", fmt(latest.ambientPressure, 0, " mbar")],
                        ["ペダル/スロットル", `${fmt(latest.pedal, 0)}/${fmt(latest.throttle, 0)} %`],
                    ].map(([label, value]) => (
                        <div key={label as string} className="bg-neutral-900/60 border border-neutral-800 rounded px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-neutral-600">{label}</div>
                            <div className="text-[13px] font-mono text-neutral-200">{value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* strip chart */}
            {state === "connected" && (
                <div className="flex-1 min-h-[260px] flex flex-col border border-neutral-800 rounded-lg bg-neutral-950/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex gap-1 bg-neutral-900 p-0.5 rounded border border-neutral-800">
                            {(Object.keys(groupLines) as ChartGroup[]).map(g => (
                                <button key={g} onClick={() => setChartGroup(g)}
                                    className={`px-2 py-0.5 rounded text-[10px] ${chartGroup === g ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>
                                    {g === "rpm" ? "RPM" : g === "load" ? "負荷/充填" : g === "vanos" ? "VANOS" : "点火/車速"}
                                </button>
                            ))}
                        </div>
                        <span className="text-[10px] font-mono text-neutral-600">直近 {CHART_WINDOW_S}s</span>
                    </div>
                    <div ref={chartBoxRef} className="flex-1 min-h-[200px]">
                        {chartBox.w > 40 && chartBox.h > 40 && (
                            <LineChart data={chartData} width={chartBox.w} height={chartBox.h}
                                margin={{ top: 4, right: 12, bottom: 0, left: -8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                                <XAxis dataKey="t" stroke="#a3a3a3" tick={{ fontSize: 10 }} unit="s" />
                                <YAxis stroke="#a3a3a3" tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                                <Tooltip contentStyle={{ background: "#171717", border: "1px solid #262626", borderRadius: 8, fontSize: 11 }} labelStyle={{ color: "#e5e5e5" }} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                {groupLines[chartGroup].map(l => (
                                    <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color}
                                        strokeDasharray={l.dash} dot={false} isAnimationActive={false} connectNulls />
                                ))}
                            </LineChart>
                        )}
                    </div>
                </div>
            )}

            {/* recording bar */}
            {state === "connected" && (
                <div className="flex items-center gap-3 flex-wrap">
                    {!recording ? (
                        <button onClick={startRecording}
                            className="px-3 py-1.5 rounded text-[12px] font-semibold bg-red-600 text-white hover:bg-red-500 flex items-center gap-1.5">
                            <Circle size={11} fill="white" /> 記録開始
                        </button>
                    ) : (
                        <button onClick={stopRecording}
                            className="px-3 py-1.5 rounded text-[12px] font-semibold border border-red-700 text-red-400 hover:bg-red-950 flex items-center gap-1.5 animate-pulse">
                            <Square size={11} fill="currentColor" /> 停止して保存 ({recCount})
                        </button>
                    )}
                    <button onClick={downloadCsv} disabled={!recordedRef.current.length && !windowRef.current.length}
                        className="px-3 py-1.5 rounded text-[12px] border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1.5">
                        <Download size={12} /> CSV (MLV互換)
                    </button>
                    <span className="text-[10px] text-neutral-600 leading-tight max-w-md">
                        WOT プル計測の推奨: 同一ギア・水温 80-100°C 窓・往復 N 回。保存したログは
                        Validation ビューでシミュレーションと比較できます。
                        ⚠ 記録中はこのタブを前面に保ってください — ブラウザはバックグラウンドタブの
                        タイマーを間引くため、サンプリングが崩れます。
                    </span>
                </div>
            )}

            {state === "disconnected" && (
                <div className="flex-1 flex items-center justify-center text-neutral-600 text-xs text-center px-8">
                    K-Line アダプタを接続し「接続」を押してください(Chrome/Edge、実ブラウザのみ)。<br />
                    ハードウェアなしで試す場合は「モック」を選択 — 合成走行サイクルで全機能を確認できます。
                </div>
            )}
        </div>
    );
};

export default LiveTelemetry;

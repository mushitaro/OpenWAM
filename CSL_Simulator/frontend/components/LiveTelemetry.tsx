"use client";

import React, { useEffect, useRef, useState } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Plug, PlugZap, Circle, Square, Download, Radio, HardDriveDownload } from "lucide-react";
import { DmeTelemetryLink, DmeIdentity, LiveSample, LiveBlockSelection } from "../lib/dme-link/types";
import { DECODER_VERSION } from "../lib/dme-link/liveValueBlocks";
import { kLineAvailable, kLineTransportName } from "../lib/dme-link/webSerialDmeLink";
import { WebSerialDmeLink } from "../lib/dme-link/webSerialDmeLink";
import { MockDmeLink } from "../lib/dme-link/mockDmeLink";
import { saveTelemetryLog } from "../app/api";
import VanosSweepPanel from "./VanosSweepPanel";
import { appendChunk, beginRun, discardRun, endRun, findRecoverableRun, loadRunSamples, RunRecord } from "../lib/sweep/recordingStore";

/**
 * Stage 76 — Live DS2 telemetry: connect to the real MSS54 DME over a K-line
 * cable (Web Serial; Chrome/Edge desktop) or the built-in mock, watch live
 * values, and record logs for the measured-vs-simulated validation pipeline.
 */

const CHART_WINDOW_S = 60;
// A drive log costs the owner an actual drive, so the recording is checkpointed
// into the repo while it runs: a dropped K-line, a closed tab or a dead backend
// can then cost at most this much data instead of the whole session.
const PERSIST_MS = 5000;   // durable chunk flush
const CHECKPOINT_MS = 20_000;
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
    { header: "Luftmasse", get: s => s.ml ?? "" },
    { header: "Kuehlmitteltemperatur", get: s => s.coolant ?? "" },
    { header: "Oeltemperatur", get: s => s.oil ?? "" },
    { header: "Abgastemperatur", get: s => s.exhaustTemp ?? "" },
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
    { header: "Umgebungstemperatur", get: s => s.ambientTemp ?? "" },
    { header: "Batteriespannung", get: s => s.battV ?? "" },
    { header: "Drosselklappe Sollwert", get: s => s.throttleTarget ?? "" },
    { header: "dr_rel", get: s => s.drRel ?? "" },
    { header: "Fuellungsregler", get: s => s.frRegler ?? "" },
    { header: "Ansaugklappe", get: s => s.flapPos ?? "" },
    // The sweep's setting label. Without these a saved log cannot be analysed
    // on its own -- every sample would look like baseline.
    { header: "cmd_intake", get: s => s.cmdIntake ?? "base" },
    { header: "cmd_exhaust", get: s => s.cmdExhaust ?? "base" },
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
export function useElementSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
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
    // Android Chrome has no Web Serial but does have WebUSB, so the question is
    // "can we reach the DME at all", not "is Web Serial here".
    const linkOk = kLineAvailable();
    const transportName = kLineTransportName();
    const [mode, setMode] = useState<"webserial" | "mock">(linkOk ? "webserial" : "mock");
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
    const [savedPath, setSavedPath] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [subView, setSubView] = useState<"telemetry" | "sweep">("telemetry");

    const [chartBoxRef, chartBox] = useElementSize();
    const linkRef = useRef<DmeTelemetryLink | null>(null);
    /** Latest sample as a ref: the sweep's ramp/arrival loop polls it without
     *  re-rendering, the way the poll loop already treats the hot path. */
    const latestRef = useRef<LiveSample | null>(null);
    /** Commanded cam state, read by the poll loop to stamp each sample. Held as
     *  a ref by the sweep hook so a command mid-pull lands on the very next
     *  sample rather than a render later. */
    const sweepCmdRef = useRef<{ intake: number | null; exhaust: number | null; transient?: boolean }>(
        { intake: null, exhaust: null, transient: false });
    const pollingRef = useRef(false);
    const blocksRef = useRef<LiveBlockSelection[]>(blocks);
    const recordingRef = useRef(false);
    const recordedRef = useRef<LiveSample[]>([]);
    const windowRef = useRef<LiveSample[]>([]);   // rolling chart window
    const stampsRef = useRef<number[]>([]);       // wall-clock stamps for the rate
    const logIdRef = useRef<string | null>(null); // set by the first checkpoint
    const savingRef = useRef(false);
    /** Durable copy of the recording. Chunks are appended as samples arrive, so
     *  a browser kill mid-drive costs at most PERSIST_MS of data instead of the
     *  whole run. */
    const runIdRef = useRef<string | null>(null);
    const pendingRef = useRef<LiveSample[]>([]);
    const seqRef = useRef(0);
    const persistBusyRef = useRef(false);
    const persistTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [recoverable, setRecoverable] = useState<RunRecord | null>(null);
    const checkpointRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [, forceRender] = useState(0);

    useEffect(() => { blocksRef.current = blocks; }, [blocks]);
    useEffect(() => () => {
        pollingRef.current = false;
        if (checkpointRef.current) clearInterval(checkpointRef.current);
        if (persistTimerRef.current) clearInterval(persistTimerRef.current);
        linkRef.current?.disconnect();
    }, []);

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
        // a dropped link (or a stray disconnect click) must never cost the drive
        if (recordingRef.current) await stopRecording();
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
                // Stamp the sweep's commanded angles onto the sample itself, so
                // the recording is analysable on its own — a saved log whose
                // rows cannot say which setting they were taken under is just a
                // drive log.
                sample.cmdIntake = sweepCmdRef.current.intake;
                sample.cmdExhaust = sweepCmdRef.current.exhaust;
                sample.cmdTransient = sweepCmdRef.current.transient === true;
                latestRef.current = sample;
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
                    pendingRef.current.push(sample);
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

    /** Write the recording into the repo (backend/app/data/telemetry/<id>.json).
     *  complete=false marks a mid-recording checkpoint of the SAME file. */
    const saveLog = async (complete: boolean): Promise<boolean> => {
        if (!recordedRef.current.length) return false;
        if (savingRef.current) {
            if (!complete) return false;                    // another checkpoint owns the file
            for (let i = 0; savingRef.current && i < 50; i++)
                await new Promise(r => setTimeout(r, 100)); // final write must land last
        }
        savingRef.current = true;
        try {
            const res = await saveTelemetryLog(recordedRef.current, {
                source: mode, vin: identity?.vin, software: identity?.softwareVersion,
                blocks: blocksRef.current, complete, decoder_version: DECODER_VERSION,
            }, logIdRef.current);
            logIdRef.current = res.log_id;
            setLastSaved(res.log_id);
            setSavedPath(res.path);
            setSaveError(null);
            if (complete) {
                setNotice(`保存しました (${res.n_samples} サンプル) — Validation ビューで比較できます。`);
            }
            return true;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setSaveError(`保存に失敗: ${msg}`);
            if (complete) {
                setNotice(`バックエンドへの保存に失敗しました(${msg})。データはこのタブ内に残っています — バックエンド起動後に「再保存」、または CSV 退避を使ってください。`);
            }
            return false;
        } finally {
            savingRef.current = false;
        }
    };
    const saveLogRef = useRef(saveLog);
    useEffect(() => { saveLogRef.current = saveLog; });

    /** Flush queued samples to IndexedDB. Never throws into the poll loop, and
     *  never stacks: a slow write must not queue a second one behind it. */
    const persist = async (force: boolean) => {
        const runId = runIdRef.current;
        if (!runId || persistBusyRef.current) return;
        if (!force && pendingRef.current.length === 0) return;
        const batch = pendingRef.current;
        if (!batch.length) return;
        pendingRef.current = [];
        const seq = seqRef.current++;
        persistBusyRef.current = true;
        try {
            await appendChunk(runId, seq, batch);
        } catch {
            // Put the batch back at the FRONT and give the seq back, so capture
            // order survives a failed write rather than silently reordering.
            pendingRef.current = batch.concat(pendingRef.current);
            seqRef.current = seq;
        } finally {
            persistBusyRef.current = false;
        }
    };
    const persistRef = useRef(persist);
    useEffect(() => { persistRef.current = persist; });

    // Offer a recovery once, on mount: a run with samples and no upload is one
    // the driver never got to keep.
    useEffect(() => {
        void (async () => {
            const r = await findRecoverableRun();
            if (r) setRecoverable(r);
        })();
    }, []);

    const recoverRun = async () => {
        if (!recoverable) return;
        const samples = await loadRunSamples(recoverable.runId);
        if (!samples.length) { setRecoverable(null); return; }
        recordedRef.current = samples;
        runIdRef.current = recoverable.runId;
        seqRef.current = Math.ceil(samples.length / 50) + 1;
        setRecCount(samples.length);
        setNotice(`前回の記録 ${samples.length.toLocaleString()} サンプルを復元しました。`
            + "保存またはアップロードしてください。");
        setRecoverable(null);
    };

    const dropRecoverable = async () => {
        if (recoverable) await discardRun(recoverable.runId);
        setRecoverable(null);
    };

    const startRecording = () => {
        recordedRef.current = [];
        logIdRef.current = null;
        setRecCount(0);
        setSavedPath(null);
        setSaveError(null);
        linkRef.current?.resetClock();
        windowRef.current = [];
        recordingRef.current = true;
        setRecording(true);
        setNotice(null);
        setLastSaved(null);
        if (checkpointRef.current) clearInterval(checkpointRef.current);
        checkpointRef.current = setInterval(() => { void saveLogRef.current(false); }, CHECKPOINT_MS);
        // Durable store: begin un-awaited so the first samples never wait on
        // IndexedDB. They queue regardless — persist() no-ops until the id lands.
        pendingRef.current = [];
        seqRef.current = 0;
        runIdRef.current = null;
        void beginRun({ mock: mode === "mock" }).then(id => { runIdRef.current = id; });
        if (persistTimerRef.current) clearInterval(persistTimerRef.current);
        persistTimerRef.current = setInterval(() => { void persistRef.current(false); }, PERSIST_MS);
    };

    const stopRecording = async () => {
        recordingRef.current = false;
        setRecording(false);
        if (checkpointRef.current) { clearInterval(checkpointRef.current); checkpointRef.current = null; }
        if (persistTimerRef.current) { clearInterval(persistTimerRef.current); persistTimerRef.current = null; }
        // Authoritative flush BEFORE anything can fail: the durable copy must be
        // complete even if the backend save below does not happen.
        await persist(true);
        if (runIdRef.current) await endRun(runIdRef.current);
        if (!recordedRef.current.length) { setNotice("記録サンプルがありません。"); return; }
        await saveLog(true);
    };

    /** Offline fallback only: if the backend is unreachable the samples live
     *  solely in this tab, so keep an escape hatch that needs no server. */
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
        rpm: [{ key: "rpm", name: "RPM", color: "#26AEE4" }],
        load: [
            { key: "rf", name: "rf %", color: "#B6E4F5" },
            { key: "ro", name: "RO %", color: "#B9A6EE" },
            { key: "map", name: "MAP/10 mbar", color: "#9B84E8" },
        ],
        vanos: [
            { key: "evanIst", name: "EVAN ist", color: "#26AEE4" },
            { key: "evanSoll", name: "EVAN soll", color: "#26AEE4", dash: "4 3" },
            { key: "avanIst", name: "AVAN ist", color: "#F64A50" },
            { key: "avanSoll", name: "AVAN soll", color: "#F64A50", dash: "4 3" },
        ],
        ign: [
            { key: "tzAvg", name: "点火平均 °KW", color: "#B9A6EE" },
            { key: "speed", name: "車速 km/h", color: "#4C4C58" },
        ],
    };

    return (
        <div className="flex flex-col gap-4 h-full overflow-auto p-1">
            {/* sub-view. The link, the recording and the sweep all live in THIS
                component, so switching views never tears down a running session
                — only what is painted changes. */}
            <div className="flex gap-1 bg-slate-900 p-1 rounded-md border border-slate-800 self-start">
                {([["telemetry", "テレメトリ"], ["sweep", "VANOS 掃引"]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setSubView(id)}
                        className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                            subView === id ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
                        {label}
                    </button>
                ))}
                {recording && (
                    <span className="self-center ml-2 mr-1 flex items-center gap-1.5 text-[10px] text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        記録中 {recCount.toLocaleString()}
                    </span>
                )}
            </div>

            {/* Recovery offer. A run with samples and no upload is one the driver
                never got to keep — say so before anything else. */}
            {recoverable && (
                <div className="flex items-center gap-3 rounded border border-amber-700 bg-amber-900/20 px-3 py-2">
                    <span className="text-[11px] text-amber-400 flex-1">
                        前回の記録が {recoverable.sampleCount.toLocaleString()} サンプル残っています
                        （保存もアップロードもされていません）。
                    </span>
                    <button onClick={() => void recoverRun()}
                        className="px-3 py-1 rounded text-[11px] font-semibold border border-amber-700
                                   text-amber-400 hover:bg-amber-900/40">
                        復元する
                    </button>
                    <button onClick={() => void dropRecoverable()}
                        className="px-3 py-1 rounded text-[11px] border border-slate-700 text-slate-400
                                   hover:border-slate-600">
                        破棄
                    </button>
                </div>
            )}

            {subView === "sweep" && (
                <VanosSweepPanel
                    linkRef={linkRef} latestRef={latestRef} latest={latest}
                    connected={state === "connected"} recording={recording}
                    recorded={recordedRef.current} cmdRef={sweepCmdRef} />
            )}

            <div className={subView === "telemetry" ? "flex flex-col gap-4" : "hidden"}>
            {/* connection bar */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1 bg-slate-900 p-1 rounded-md border border-slate-800">
                    {(["webserial", "mock"] as const).map(m => (
                        <button key={m} disabled={state !== "disconnected"} onClick={() => setMode(m)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium ${mode === m ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"} disabled:opacity-60`}>
                            {m === "webserial" ? "実車 (K-Line)" : "モック"}
                        </button>
                    ))}
                </div>
                {state !== "connected" ? (
                    <button onClick={connect} disabled={state === "connecting" || (mode === "webserial" && !linkOk)}
                        className="px-3 py-1.5 rounded text-[12px] font-semibold bg-slate-100 text-black hover:bg-white disabled:opacity-50 flex items-center gap-1.5">
                        <Plug size={13} /> {state === "connecting" ? "接続中..." : "接続"}
                    </button>
                ) : (
                    <button onClick={disconnect}
                        className="px-3 py-1.5 rounded text-[12px] font-semibold border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5">
                        <PlugZap size={13} /> 切断
                    </button>
                )}
                {!linkOk && mode === "webserial" && (
                    <span className="text-[11px] text-amber-400">
                        この端末では実車に接続できません。PC は Chrome/Edge、Android は Chrome と FTDI ケーブルが必要です。
                        まずは「モック」で操作を確認できます。
                    </span>
                )}
                {linkOk && mode === "webserial" && state === "disconnected" && (
                    <span className="text-[10px] text-slate-500">
                        接続方式: {transportName === "webusb" ? "WebUSB (Android・FTDI)" : "Web Serial (PC)"}
                    </span>
                )}
                {identity && (
                    <span className="text-[10px] font-mono text-slate-500">
                        VIN {identity.vin} · SW {identity.softwareVersion}
                    </span>
                )}
                {rateHz != null && state === "connected" && (
                    <span className="text-[10px] font-mono text-emerald-500 flex items-center gap-1">
                        <Radio size={11} /> {rateHz.toFixed(1)} Hz
                    </span>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[10px] text-slate-500">ブロック:</span>
                    {([3, 19, 35] as LiveBlockSelection[]).map(b => (
                        <label key={b} className="flex items-center gap-1 text-[11px] text-slate-400">
                            <input type="checkbox" checked={blocks.includes(b)} disabled={b === 3}
                                onChange={() => toggleBlock(b)} className="rounded border-slate-700 bg-slate-900" />
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
                        <div key={label as string} className="bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
                            <div className="text-[13px] font-mono text-slate-200">{value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* strip chart */}
            {state === "connected" && (
                <div className="flex-1 min-h-[260px] flex flex-col border border-slate-800 rounded-lg bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
                            {(Object.keys(groupLines) as ChartGroup[]).map(g => (
                                <button key={g} onClick={() => setChartGroup(g)}
                                    className={`px-2 py-0.5 rounded text-[10px] ${chartGroup === g ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
                                    {g === "rpm" ? "RPM" : g === "load" ? "負荷/充填" : g === "vanos" ? "VANOS" : "点火/車速"}
                                </button>
                            ))}
                        </div>
                        <span className="text-[10px] font-mono text-slate-600">直近 {CHART_WINDOW_S}s</span>
                    </div>
                    <div ref={chartBoxRef} className="flex-1 min-h-[200px]">
                        {chartBox.w > 40 && chartBox.h > 40 && (
                            <LineChart data={chartData} width={chartBox.w} height={chartBox.h}
                                margin={{ top: 4, right: 12, bottom: 0, left: -8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#17171C" />
                                <XAxis dataKey="t" stroke="#9A9AA8" tick={{ fontSize: 10 }} unit="s" />
                                <YAxis stroke="#9A9AA8" tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                                <Tooltip contentStyle={{ background: "#0A0A0D", border: "1px solid #17171C", borderRadius: 8, fontSize: 11 }} labelStyle={{ color: "#DFDFE6" }} />
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
                            className="px-3 py-1.5 rounded text-[12px] font-semibold border border-red-600 text-red-400 hover:bg-red-900 flex items-center gap-1.5 animate-pulse">
                            <Square size={11} fill="currentColor" /> 停止して保存 ({recCount})
                        </button>
                    )}
                    {saveError && recordedRef.current.length > 0 && (
                        <button onClick={() => void saveLog(true)}
                            className="px-3 py-1.5 rounded text-[12px] font-semibold border border-amber-700 text-amber-400 hover:bg-amber-900/40 flex items-center gap-1.5">
                            <HardDriveDownload size={12} /> 再保存
                        </button>
                    )}
                    <button onClick={downloadCsv} disabled={!recordedRef.current.length && !windowRef.current.length}
                        title="予備: バックエンドに保存できないときの退避用 (MLV 互換 CSV)"
                        className="px-3 py-1.5 rounded text-[12px] border border-slate-800 text-slate-500 hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40 flex items-center gap-1.5">
                        <Download size={12} /> CSV 退避 (予備)
                    </button>
                    <span className="text-[10px] text-slate-600 leading-tight max-w-md">
                        WOT プル計測の推奨: 同一ギア・水温 80-100°C 窓・往復 N 回。停止すると
                        リポジトリ内 (backend/app/data/telemetry/) に保存され、記録中も
                        {Math.round(CHECKPOINT_MS / 1000)} 秒ごとに自動保存されます。
                        ⚠ 記録中はこのタブを前面に保ってください — ブラウザはバックグラウンドタブの
                        タイマーを間引くため、サンプリングが崩れます。
                    </span>
                </div>
            )}

            {/* where the data landed — this is the path handed to analysis */}
            {savedPath && (
                <div className="text-[11px] font-mono flex items-center gap-2 flex-wrap">
                    <span className={saveError ? "text-red-400" : "text-emerald-500"}>
                        {saveError ? "未保存" : recording ? "自動保存中" : "保存済"}
                    </span>
                    <span className="text-slate-400">{savedPath}</span>
                    {recording && <span className="text-slate-600">({recCount} サンプル · {Math.round(CHECKPOINT_MS / 1000)}s ごと)</span>}
                    {!recording && logIdRef.current?.startsWith("mock_") && (
                        <span className="text-amber-500/80">mock_ 接頭辞 = 合成データ(実測ではありません)</span>
                    )}
                </div>
            )}

            {state === "disconnected" && (
                <div className="flex-1 flex items-center justify-center text-slate-600 text-xs text-center px-8">
                    K-Line アダプタを接続し「接続」を押してください(Chrome/Edge、実ブラウザのみ)。<br />
                    ハードウェアなしで試す場合は「モック」を選択 — 合成走行サイクルで全機能を確認できます。
                </div>
            )}
            </div>
        </div>
    );
};

export default LiveTelemetry;

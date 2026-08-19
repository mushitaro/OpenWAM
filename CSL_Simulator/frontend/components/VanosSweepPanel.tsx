"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Radio, Square, Thermometer, Target, Activity } from "lucide-react";
import { DmeTelemetryLink, LiveSample } from "../lib/dme-link/types";
import { useVanosSweep } from "../hooks/useVanosSweep";
import { aggregateSweep, nextActions, SweepAggregate } from "../lib/sweep/aggregate";
import { SweepSample, fillThrottle } from "../lib/sweep/admit";
import { SWEEP_DEFAULTS } from "../lib/sweep/options";
import { VANOS_STORABLE } from "../lib/dme-link/ds2";
import {
    canUpload, CollectorSettings, loadCollectorSettings, saveCollectorSettings,
    uploadSweep, UploadResult,
} from "../lib/sweep/collector";
import { UploadCloud, KeyRound } from "lucide-react";

/** Default grids from docs/LIVE_VANOS_SWEEP_PROTOCOL.md section 4. */
const ANGLES: Record<"intake" | "exhaust", number[]> = {
    intake: [0, 5, 10, 15, 20],
    exhaust: [30, 35, 41, 45],
};

/** EGT ceiling. rf_korr is zeroed in the owner tune, so nothing in the DME backs
 *  this off — the number on screen is the whole protection. */
const EGT_WARN_C = 880;
const EGT_STOP_C = 940;

function toSweepSamples(rows: LiveSample[]): SweepSample[] {
    const out: SweepSample[] = rows.map(s => ({
        tMs: s.t * 1000,
        rpm: s.rpm, stft1: s.stft1, stft2: s.stft2,
        evanIst: s.evanIst, evanSoll: s.evanSoll,
        avanIst: s.avanIst, avanSoll: s.avanSoll,
        pedal: s.pedal, throttle: s.throttle,
        coolant: s.coolant, oil: s.oil,
        cmdIntake: s.cmdIntake ?? null, cmdExhaust: s.cmdExhaust ?? null,
        cmdTransient: s.cmdTransient === true,
    }));
    fillThrottle(out);
    return out;
}

/** Confidence -> cell tint. Deliberately NOT the lambda value: a board coloured
 *  by the reading invites reading the answer off the coverage map, and a noisy
 *  cell would look as solid as a good one. */
function coverageTint(n: number, satisfied: boolean): string {
    if (satisfied) return "bg-emerald-400/30 text-emerald-400";
    if (n >= SWEEP_DEFAULTS.minSamplesPerCell / 2) return "bg-amber-400/20 text-amber-400";
    if (n > 0) return "bg-amber-400/10 text-slate-400";
    return "bg-slate-800/40 text-slate-600";
}

const VanosSweepPanel: React.FC<{
    linkRef: React.MutableRefObject<DmeTelemetryLink | null>;
    latestRef: React.MutableRefObject<LiveSample | null>;
    latest: LiveSample | null;
    connected: boolean;
    recording: boolean;
    recorded: LiveSample[];
    cmdRef: React.MutableRefObject<{ intake: number | null; exhaust: number | null; transient?: boolean }>;
}> = ({ linkRef, latestRef, latest, connected, recording, recorded, cmdRef }) => {
    const sweep = useVanosSweep(linkRef, connected, latestRef, cmdRef);
    const [showAll, setShowAll] = useState(false);
    const [settings, setSettings] = useState<CollectorSettings>(() => loadCollectorSettings());
    const [showSettings, setShowSettings] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const uploadIdRef = React.useRef<string>(
        `sweep-${new Date().toISOString().replace(/[:.TZ-]/g, "").slice(0, 14)}`);

    const doUpload = async () => {
        if (uploading) return;
        setUploading(true);
        // The id is stable for this recording, and the server upserts on it, so
        // a retry overwrites rather than duplicating — which is what makes
        // pressing this twice safe.
        const r = await uploadSweep(recorded, {
            id: uploadIdRef.current,
            label: `${sweep.axis === "intake" ? "吸気" : "排気"}掃引`,
            settings: ANGLES[sweep.axis],
        }, settings);
        setUploadResult(r);
        setUploading(false);
    };

    // Recompute rather than accumulate: the newest samples are always pending a
    // settle reference, so an incremental accumulator would need drift-prone
    // bookkeeping to take them back once they resolve.
    const agg: SweepAggregate = useMemo(
        () => aggregateSweep(toSweepSamples(recorded), sweep.axis),
        [recorded, sweep.axis, recorded.length]);
    const actions = useMemo(() => nextActions(agg), [agg]);

    const egt = latest?.exhaustTemp;
    const egtState = egt == null ? "unknown"
        : egt >= EGT_STOP_C ? "stop" : egt >= EGT_WARN_C ? "warn" : "ok";

    const angles = ANGLES[sweep.axis];
    const bins = showAll ? agg.bins : agg.bins.filter(b => b.rpm >= 2700 && b.rpm <= 4500);
    const w = sweep.axis === "intake" ? VANOS_STORABLE.intake : VANOS_STORABLE.exhaust;

    return (
        <div className="flex flex-col gap-3 text-[12px]">
            {/* ---- safety strip: always visible, never behind a scroll ---- */}
            <div className="flex items-center gap-3 rounded border border-slate-700 bg-slate-900 px-3 py-2">
                <Thermometer className="w-4 h-4 shrink-0" />
                <div className="flex-1">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">排気温度（唯一の保護）</div>
                    <div className={`font-mono text-[15px] font-bold ${
                        egtState === "stop" ? "text-red-400"
                            : egtState === "warn" ? "text-amber-400"
                                : egtState === "ok" ? "text-emerald-400" : "text-slate-600"}`}>
                        {egt == null ? "—" : `${egt} °C`}
                    </div>
                </div>
                <div className="text-[10px] leading-tight text-slate-500 max-w-[19rem]">
                    {egtState === "stop"
                        ? <span className="text-red-400">上限超過。直ちにアクセルを戻し、この設定は破棄してください。</span>
                        : egtState === "warn"
                            ? <span className="text-amber-400">高温です。プルを短く切り上げてください。</span>
                            : `${EGT_WARN_C}°C で警告、${EGT_STOP_C}°C で中止。この車は EGT 由来の自動増量が無効のため、この表示が唯一の保護です。`}
                </div>
            </div>

            {!sweep.supported && (
                <div className="flex items-start gap-2 rounded border border-amber-700 bg-amber-900/20 px-3 py-2 text-amber-400">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>先に「接続」してください。接続するとカム角の指令が使えるようになります（モックでも可）。</span>
                </div>
            )}

            {/* ---- axis + command ---- */}
            <div className="rounded border border-slate-700 bg-slate-900 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">掃引するカム</span>
                    {(["intake", "exhaust"] as const).map(a => (
                        <button key={a} onClick={() => sweep.setAxis(a)} disabled={sweep.busy}
                            className={`min-h-[40px] px-4 rounded text-[11px] border transition-colors disabled:opacity-40 ${
                                sweep.axis === a
                                    ? "border-blue-500 bg-blue-500/15 text-blue-400"
                                    : "border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                            {a === "intake" ? "吸気" : "排気"}
                        </button>
                    ))}
                    <span className="ml-auto text-[10px] text-slate-500">
                        指令できる範囲 {w.min}〜{w.max}°（書き戻せる範囲）
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => void sweep.goTo(null)} disabled={!sweep.supported || sweep.busy}
                        className="min-h-[44px] px-4 rounded text-[11px] font-semibold border border-slate-700 text-slate-300
                                   hover:border-slate-600 disabled:opacity-40">
                        基準（指令なし）
                    </button>
                    {angles.map(a => (
                        <button key={a} onClick={() => void sweep.goTo(a)} disabled={!sweep.supported || sweep.busy}
                            className={`min-h-[44px] min-w-[52px] px-3 rounded text-[11px] font-mono font-semibold border
                                        transition-colors disabled:opacity-40 ${
                                (sweep.axis === "intake" ? sweep.commandRef.current.intake : sweep.commandRef.current.exhaust) === a
                                    ? "border-blue-500 bg-blue-500/15 text-blue-400"
                                    : "border-slate-700 text-slate-300 hover:border-slate-600"}`}>
                            {a}°
                        </button>
                    ))}
                    <button onClick={() => void sweep.abort()} disabled={!sweep.supported}
                        className="ml-auto min-h-[44px] px-4 rounded text-[11px] font-semibold border border-red-500
                                   text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5">
                        <Square className="w-3 h-3" /> 中止（マップ制御へ戻す）
                    </button>
                </div>

                {/* Fixed-height status slot: the message changes, the layout does not. */}
                <div className="h-[34px] flex items-center gap-2 rounded bg-slate-800/60 px-3">
                    <Radio className={`w-3 h-3 shrink-0 ${sweep.keepAliveOn ? "text-emerald-400 animate-pulse" : "text-slate-600"}`} />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500 shrink-0">
                        {sweep.keepAliveOn ? "保持中" : "未保持"}
                    </span>
                    <span className={`text-[11px] truncate ${
                        sweep.phase === "error" ? "text-red-400"
                            : sweep.phase === "holding" ? "text-emerald-400" : "text-slate-300"}`}>
                        {sweep.message ?? "カム角を選ぶと、ランプ指令 → 到達待ち → 計測可能になります。"}
                    </span>
                </div>
                {!recording && sweep.phase === "holding" && (
                    <div className="text-[11px] text-amber-400">
                        記録が開始されていません。「テレメトリ」タブで記録を開始してからプルしてください。
                    </div>
                )}
            </div>

            {/* ---- upload ---- */}
            <div className="rounded border border-slate-700 bg-slate-900 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <UploadCloud className="w-4 h-4" />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">サーバーへ送信</span>
                    <span className="font-mono text-[10px] text-slate-500">
                        {recorded.length.toLocaleString()} サンプル
                    </span>
                    <button onClick={() => void doUpload()}
                        disabled={uploading || !recorded.length || !canUpload(settings)}
                        className="ml-auto min-h-[44px] px-4 rounded text-[11px] font-semibold border border-blue-500
                                   text-blue-400 hover:bg-blue-500/10 disabled:opacity-40">
                        {uploading ? "送信中…" : "アップロード"}
                    </button>
                    <button onClick={() => setShowSettings(v => !v)}
                        className="min-h-[44px] px-3 rounded text-[11px] border border-slate-700 text-slate-400
                                   hover:border-slate-600 flex items-center gap-1">
                        <KeyRound className="w-3 h-3" /> 設定
                    </button>
                </div>
                {!canUpload(settings) && (
                    <div className="text-[11px] text-amber-400">
                        アップロード用トークンが未設定です。「設定」から入力してください（初回のみ）。
                    </div>
                )}
                {showSettings && (
                    <div className="flex flex-col gap-2 rounded bg-slate-800/60 p-2">
                        <label className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="w-16 shrink-0">送信先</span>
                            <input value={settings.baseUrl}
                                onChange={e => setSettings(s2 => ({ ...s2, baseUrl: e.target.value }))}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1
                                           font-mono text-[10px] text-slate-300" />
                        </label>
                        <label className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="w-16 shrink-0">トークン</span>
                            <input value={settings.token} type="password" autoComplete="off"
                                onChange={e => setSettings(s2 => ({ ...s2, token: e.target.value }))}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1
                                           font-mono text-[10px] text-slate-300" />
                        </label>
                        <button onClick={() => { saveCollectorSettings(settings); setShowSettings(false); }}
                            className="self-start px-3 py-1 rounded text-[11px] border border-slate-700
                                       text-slate-300 hover:border-slate-600">
                            この端末に保存
                        </button>
                    </div>
                )}
                {/* Fixed-height result slot so the panel does not jump on send. */}
                <div className="h-[18px] text-[11px] leading-[18px]">
                    {uploadResult && (uploadResult.ok
                        ? <span className="text-emerald-400">
                            送信しました（{uploadResult.nSamples.toLocaleString()} サンプル /
                            {(uploadResult.bytes / 1024).toFixed(0)} KB）。同じ記録を再送しても重複しません。
                          </span>
                        : <span className="text-red-400">
                            {uploadResult.message}{uploadResult.retryable ? "（再送できます）" : ""}
                          </span>)}
                </div>
            </div>

            {/* ---- coverage ---- */}
            <div className="rounded border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4" />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">
                        カバレッジ（色 = 証拠の量。λ の値ではありません）
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-slate-500">
                        採用 {agg.admitted} / {agg.total}
                    </span>
                    <button onClick={() => setShowAll(v => !v)}
                        className="text-[10px] text-slate-500 hover:text-slate-300 underline">
                        {showAll ? "谷帯のみ" : "全回転域"}
                    </button>
                </div>

                {bins.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-slate-600">
                        まだ有効なデータがありません。記録を開始し、全開プルを行ってください。
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="text-[10px] font-mono border-collapse table-fixed">
                            <thead>
                                <tr>
                                    <th className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-left text-slate-500 w-[70px]">rpm</th>
                                    <th className="px-2 py-1 text-slate-500 w-[46px]">基準</th>
                                    {angles.map(a => (
                                        <th key={a} className="px-2 py-1 text-slate-500 w-[46px]">{a}°</th>
                                    ))}
                                    <th className="px-2 py-1 text-slate-500 w-[92px]">最適カム角</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bins.map(b => (
                                    <tr key={b.rpm}>
                                        <td className="sticky left-0 z-10 bg-slate-900 px-2 py-1 text-slate-300">{b.rpm}</td>
                                        <td className={`px-2 py-1 text-center ${coverageTint(b.anchorN, b.anchorN >= SWEEP_DEFAULTS.minSamplesPerCell)}`}>
                                            {b.anchorN || "–"}
                                        </td>
                                        {angles.map(a => {
                                            const p = b.points.find(x => x.angle === a);
                                            return (
                                                <td key={a} className={`px-2 py-1 text-center ${coverageTint(p?.n ?? 0, !!p?.satisfied)}`}
                                                    title={p ? `${p.n} サンプル / ${p.visits} 回のプル` : "データなし"}>
                                                    {p ? p.n : "–"}
                                                </td>
                                            );
                                        })}
                                        <td className="px-2 py-1 text-center">
                                            {b.vertex?.ok
                                                ? <span className="text-emerald-400 font-bold">{b.vertex.fit.vertex.toFixed(1)}°</span>
                                                : <span className="text-slate-600">–</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ---- what to do next, and why samples were dropped ---- */}
            <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-3">
                <div className="rounded border border-slate-700 bg-slate-900 p-3">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-2">次にやること</div>
                    {actions.length === 0 ? (
                        <div className="text-[11px] text-emerald-400">
                            必要なデータは揃っています。保存してアップロードしてください。
                        </div>
                    ) : (
                        <ul className="space-y-1 text-[11px] text-slate-300">
                            {actions.slice(0, 8).map((a, i) => <li key={i}>· {a}</li>)}
                        </ul>
                    )}
                </div>
                <div className="rounded border border-slate-700 bg-slate-900 p-3">
                    <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-2">
                        除外されたサンプル（多い順）
                    </div>
                    {agg.rejects.length === 0 ? (
                        <div className="text-[11px] text-slate-600">まだありません。</div>
                    ) : (
                        <ul className="space-y-1 text-[11px]">
                            {agg.rejects.slice(0, 6).map(r => (
                                <li key={r.reason} className="flex gap-2">
                                    <span className="font-mono text-slate-500 w-10 shrink-0 text-right">{r.n}</span>
                                    <span className="text-slate-400">{r.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VanosSweepPanel;

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ShieldCheck, ShieldAlert, AlertTriangle, Check, X, Flame, Thermometer,
    RefreshCw, HardDriveDownload, Loader2, Save,
} from 'lucide-react';
import type { DmeTelemetryLink, DmeIdentity, LiveSample, AdaptationSnapshot } from '@/lib/dme-link/types';
import { supportsPreflight } from '@/lib/dme-link/types';
import { PREFLIGHT_ITEMS, evaluate, buildPatchedImage, PreflightReading } from '@/lib/preflight/patch';
import { readStoredChecksums } from '@/lib/checksum/dmeDataChecksum';
import { storeBackup, listBackups, offerDownload, backupFilename } from '@/lib/preflight/backupStore';
import { isClearedByTuneReset } from '@/lib/dme-link/adaptationBlocks';

/** The two the sweep's arrival gate needs. Below these the VANOS is slow, stiff, and the DME can
 *  refuse a cam command outright — so this is a readiness fact, not a suggestion. */
const MIN_COOLANT_C = 75;
const MIN_OIL_C = 40;

type Busy = null | 'inspect' | 'flash' | 'vanos' | 'tune';

interface Props {
    linkRef: React.RefObject<DmeTelemetryLink | null>;
    connected: boolean;
    identity: DmeIdentity | null;
    latest: LiveSample | null;
    /** A drive recording in progress. The flash is refused while one is open — see the button. */
    recording: boolean;
    /**
     * Stop / restart the telemetry poll loop without dropping the link.
     *
     * Every operation here takes the K-line for itself: an inspection is a second, a calibration
     * read two minutes, a flash five. The CommandGate would queue a poll behind the whole thing
     * rather than fail, so this is not about correctness — it is about not leaving the erase and
     * write sharing a line with a loop that has its own error budget and its own reconnect.
     */
    pausePolling: () => void;
    resumePolling: () => void;
}

/**
 * 事前準備 — everything that has to be true before the car leaves, in the order it has to be true.
 *
 * The panel is built around one idea: the drive is expensive and the failure is silent. If
 * `KF_BZ_WDK_VL` is stock, every WOT pull records a frozen lambda integrator and looks completely
 * normal on the screen — the loss is only discovered back at the desk. So the calibration is READ
 * back from the ECU and judged, rather than remembered.
 *
 * Steps are numbered and gated on each other because the order is not cosmetic: flashing resets
 * nothing that adaptation clearing resets, but clearing adaptations before a flash wastes them, and
 * warming up before either just means idling through a two-minute read.
 */
export default function PreflightPanel({
    linkRef, connected, identity, latest, recording, pausePolling, resumePolling,
}: Props) {
    const [busy, setBusy] = useState<Busy>(null);
    const [error, setError] = useState<string | null>(null);
    const [readings, setReadings] = useState<PreflightReading[] | null>(null);
    const [checkedAt, setCheckedAt] = useState<number | null>(null);
    const [armed, setArmed] = useState(false);
    const [progress, setProgress] = useState<{ pct: number; phase: string } | null>(null);
    const [adaptations, setAdaptations] = useState<AdaptationSnapshot | null>(null);
    const [vanosClearedAt, setVanosClearedAt] = useState<number | null>(null);
    const [backups, setBackups] = useState<{ id: string; at: number; vin: string; note: string }[]>([]);
    const [flashNote, setFlashNote] = useState<string | null>(null);

    const link = linkRef.current;
    const capable = link != null && connected && supportsPreflight(link);

    const refreshBackups = useCallback(() => {
        listBackups().then(b => setBackups(b.map(({ id, at, vin, note }) => ({ id, at, vin, note }))))
            .catch(() => { /* an unreadable backup list must not block the panel */ });
    }, []);
    useEffect(refreshBackups, [refreshBackups]);

    // Any change to the calibration invalidates the verdict on screen. Rather than leave a stale
    // PASS sitting there, the readings are dropped whenever the link changes underneath.
    useEffect(() => { if (!connected) { setReadings(null); setCheckedAt(null); setArmed(false); } }, [connected]);

    const failing = readings?.filter(r => !r.ok) ?? [];
    const allPass = readings != null && failing.length === 0;

    const coolant = latest?.coolant ?? null;
    const oil = latest?.oil ?? null;
    const warmOk = coolant != null && oil != null && coolant >= MIN_COOLANT_C && oil >= MIN_OIL_C;

    /**
     * Every operation on this panel, wrapped identically: the poll loop is stopped for the duration
     * and restarted in a `finally` so it comes back even when the operation threw. Restarting is
     * not conditional on success — the alternative is a live tab that silently stopped updating
     * because something failed here, which is how a driver ends up watching a frozen EGT.
     */
    const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
        if (busy) return;
        setBusy(kind);
        setError(null);
        pausePolling();
        try { await fn(); } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            resumePolling();
            setBusy(null);
            setProgress(null);
        }
    };

    /* ---- ① inspect ---------------------------------------------------- */
    const inspect = () => run('inspect', async () => {
        if (!link || !supportsPreflight(link)) throw new Error('接続してから点検してください。');
        const out: PreflightReading[] = [];
        for (const item of PREFLIGHT_ITEMS) {
            const bytes = await link.readCalibrationBytes(item.offset, item.length);
            out.push(evaluate(item, bytes));
        }
        setReadings(out);
        setCheckedAt(Date.now());
        // Re-arming has to be a fresh decision every time the picture changes.
        setArmed(false);
    });

    /* ---- ② flash ------------------------------------------------------- */
    const flash = () => run('flash', async () => {
        if (!link || !supportsPreflight(link)) throw new Error('接続してから書き込んでください。');
        setFlashNote(null);

        const rpm = await link.readEngineRpm();
        if (rpm > 0) throw new Error(`エンジンが回転しています（${rpm} rpm）。停止してから実行してください。`);

        // One read, used for BOTH the patch and the backup. Nothing else talks to this DME while
        // the operation holds the link's gate, so an image read moments ago is what is in the ECU
        // — and a second ~2-minute pass would buy nothing but a longer window to lose power in.
        const current = await link.readCalibration(
            p => setProgress({ pct: Math.round(p * 0.35), phase: '現在の内容を読み出し中（約 2 分）' }));
        const { image, changed } = buildPatchedImage(current);
        if (changed.length === 0) {
            setFlashNote('書き換えの必要はありませんでした。すでに全項目が条件を満たしています。');
            await inspectInline(link);
            return;
        }

        await link.writeCalibration({
            image,
            backup: current,
            onBackup: async (backupImage) => {
                // Durable FIRST. This promise is what the erase waits on, so it must not resolve on
                // anything weaker than a committed write — see backupStore.
                const at = Date.now();
                const vin = identity?.vin ?? 'UNKNOWN';
                await storeBackup({
                    id: `${vin}-${at}`, at, vin, image: backupImage,
                    checksums: readStoredChecksums(backupImage),
                    note: `事前準備の書き込み前（${changed.map(c => c.symbol).join(', ')}）`,
                });
                // Convenience only, and never awaited: a blocked download must not abort a flash
                // whose real backup is already on disk.
                offerDownload(backupImage, backupFilename(vin, at));
                refreshBackups();
            },
            onProgress: (pct, phase) => setProgress({
                pct,
                phase: phase === 'backup' ? 'バックアップ保存中（消去前）'
                    : phase === 'erase' ? '消去中'
                        : phase === 'write' ? '書き込み中'
                            : '全バイト読み戻し検証中',
            }),
        });

        setFlashNote(`書き込み完了。${changed.map(c => c.symbol).join(' / ')} を変更し、全 65536 バイトの読み戻しが一致しました。`);
        await inspectInline(link);
    });

    /** Re-read straight after a flash. Separate from `inspect` only so it can run inside the same
     *  busy window rather than being refused by it. */
    const inspectInline = async (l: DmeTelemetryLink) => {
        if (!supportsPreflight(l)) return;
        const out: PreflightReading[] = [];
        for (const item of PREFLIGHT_ITEMS) {
            out.push(evaluate(item, await l.readCalibrationBytes(item.offset, item.length)));
        }
        setReadings(out);
        setCheckedAt(Date.now());
        setArmed(false);
    };

    /* ---- ③ adaptations -------------------------------------------------- */
    const clearVanos = () => run('vanos', async () => {
        if (!link || !supportsPreflight(link)) throw new Error('接続してから実行してください。');
        setAdaptations(await link.clearVanosAdaptations());
        setVanosClearedAt(Date.now());
    });
    const clearTune = () => run('tune', async () => {
        if (!link || !supportsPreflight(link)) throw new Error('接続してから実行してください。');
        setAdaptations(await link.clearTuneAdaptations());
    });

    const stamp = (t: number) => new Date(t).toLocaleString('ja-JP', { hour12: false });

    /* -------------------------------------------------------------------- */
    const ready = allPass && vanosClearedAt != null && warmOk;
    const remaining = [
        !allPass && (readings == null ? 'キャリブレーション点検' : `キャリブレーション ${failing.length} 項目`),
        vanosClearedAt == null && 'VANOS 学習クリア',
        !warmOk && '暖機',
    ].filter(Boolean) as string[];

    return (
        <div className="flex flex-col gap-3 text-[12px]">

            {/* ---- verdict strip: the one line that answers "can I go?" ---- */}
            <div className={`flex items-start gap-3 rounded border px-3 py-2.5 ${ready
                ? 'border-emerald-700 bg-emerald-900/15'
                : 'border-slate-700 bg-slate-900'}`}>
                {ready
                    ? <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-400" />
                    : <ShieldAlert className="w-5 h-5 shrink-0 text-slate-500" />}
                <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold ${ready ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {ready ? '走行して掃引できます' : '走行前に残っている作業があります'}
                    </div>
                    <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                        {ready
                            ? 'この状態なら、全開でλ制御が生きたまま記録できます。'
                            : remaining.length > 0
                                ? `残り: ${remaining.join(' / ')}`
                                : '接続してから点検してください。'}
                    </div>
                </div>
            </div>

            {!capable && (
                <div className="flex items-start gap-2 rounded border border-amber-700 bg-amber-900/20 px-3 py-2 text-amber-400">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        先に「テレメトリ」タブで接続してください。モックでも一通り試せます
                        （モックは純正状態から始まるので、点検 → 書き込み → 再点検が通しで確認できます）。
                    </span>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded border border-red-600 bg-red-900/20 px-3 py-2 text-red-400">
                    <X className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="break-words">{error}</span>
                </div>
            )}

            {/* ================= ① calibration ================= */}
            <section className="rounded border border-slate-700 bg-slate-900 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">
                        ① キャリブレーション点検
                    </span>
                    {checkedAt && (
                        <span className="text-[10px] text-slate-600 font-mono">{stamp(checkedAt)} 時点</span>
                    )}
                    <button onClick={inspect} disabled={!capable || busy != null}
                        className="ml-auto min-h-[44px] px-4 rounded text-[11px] font-semibold border
                                   border-blue-500 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40
                                   flex items-center gap-2">
                        {busy === 'inspect'
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 読み出し中</>
                            : <><RefreshCw className="w-3.5 h-3.5" /> ECU から点検</>}
                    </button>
                </div>

                <p className="text-[10px] leading-relaxed text-slate-500">
                    ECU から実際に読み出して判定します（読み出しのみ・約 1 秒）。
                    覚えている状態ではなく、いま車に入っている値で判断してください。
                </p>

                {readings == null ? (
                    <div className="rounded bg-slate-800/50 px-3 py-4 text-center text-[11px] text-slate-600">
                        未点検
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {readings.map(r => (
                            <div key={r.item.id}
                                className={`rounded border px-3 py-2 flex flex-col gap-1 ${r.ok
                                    ? 'border-emerald-800 bg-emerald-900/10'
                                    : 'border-red-800 bg-red-900/10'}`}>
                                <div className="flex items-center gap-2">
                                    {r.ok
                                        ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                                        : <X className="w-3.5 h-3.5 shrink-0 text-red-400" />}
                                    <span className={`text-[12px] font-semibold ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {r.item.label}
                                    </span>
                                    <span className="ml-auto font-mono text-[9px] text-slate-600 shrink-0">
                                        {r.item.symbol}
                                    </span>
                                </div>
                                <div className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
                                    <span className="text-slate-600">現在</span>
                                    <span className={r.ok ? 'text-slate-300' : 'text-red-300'}>{r.current}</span>
                                    {!r.ok && <><span className="text-slate-600">必要</span>
                                        <span className="text-slate-400">{r.item.required}</span></>}
                                </div>
                                {!r.ok && (
                                    <p className="text-[10px] leading-relaxed text-slate-500">{r.item.why}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ================= ② flash ================= */}
            {readings != null && failing.length > 0 && (
                <section className="rounded border border-red-800 bg-red-950/20 p-3 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Flame className="w-4 h-4 text-red-400" />
                        <span className="text-[9px] uppercase tracking-widest text-red-400">
                            ② ECU へ書き込み（{failing.length} 項目）
                        </span>
                    </div>

                    <div className="rounded bg-black/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400 flex flex-col gap-1.5">
                        <p className="text-red-300 font-semibold">
                            これは 64KB 全消去 → 全書き込みです。途中で電源が切れると ECU が起動しなくなります。
                        </p>
                        <p>
                            エンジン停止・イグニッション ON のまま、バッテリー充電器を繋いだ状態で実行してください。
                            所要時間は約 5 分（読み出し 2 分 + 書き込み 1 分 + 全バイト読み戻し検証 2 分）。
                            開始後は中断できません — 途中でやめる方が壊れます。
                        </p>
                        <p>
                            消去の前に現在の内容を端末に保存し、保存が完了してからでないと消去しません。
                            ファイルとしても自動保存されます。
                        </p>
                    </div>

                    <div className="rounded bg-slate-900/60 px-3 py-2 flex flex-col gap-1">
                        <span className="text-[9px] uppercase tracking-widest text-slate-500">変更される項目</span>
                        {failing.map(r => (
                            <div key={r.item.id} className="font-mono text-[10px] text-slate-400">
                                {r.item.symbol}: <span className="text-red-300">{r.current}</span>
                                {' → '}<span className="text-emerald-400">{r.item.required}</span>
                            </div>
                        ))}
                        <span className="text-[10px] text-slate-600 mt-0.5">
                            これ以外のバイトは触りません（チェックサム 2 か所を除く）。
                        </span>
                    </div>

                    <label className="flex items-start gap-2.5 rounded border border-slate-700 px-3 py-2.5
                                      cursor-pointer select-none min-h-[44px]">
                        <input type="checkbox" checked={armed} disabled={busy != null}
                            onChange={e => setArmed(e.target.checked)}
                            className="mt-0.5 w-4 h-4 shrink-0 accent-red-500" />
                        <span className="text-[11px] text-slate-300 leading-relaxed">
                            エンジンは停止していて、電源が安定していることを確認しました
                        </span>
                    </label>

                    <button onClick={flash} disabled={!capable || !armed || busy != null || recording}
                        className="min-h-[52px] rounded text-[13px] font-bold border-2 border-red-500
                                   text-red-400 hover:bg-red-500/10 disabled:opacity-30
                                   disabled:hover:bg-transparent flex items-center justify-center gap-2">
                        {busy === 'flash'
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> 実行中 — 電源を切らないでください</>
                            : <><Flame className="w-4 h-4" /> バックアップして書き込む</>}
                    </button>

                    {recording && (
                        // Refused rather than merely discouraged: the flash stops the poll loop for
                        // about five minutes, which would leave a five-minute hole in the middle of
                        // a recording that looks like a normal gap.
                        <span className="text-[10px] text-amber-400">
                            記録中です。書き込みは K-Line を約 5 分占有するため、
                            テレメトリタブで記録を停止してから実行してください。
                        </span>
                    )}

                    {progress && (
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>{progress.phase}</span>
                                <span className="font-mono">{progress.pct} %</span>
                            </div>
                            <div className="h-2 rounded bg-slate-800 overflow-hidden">
                                <div className="h-full bg-red-500 transition-[width] duration-300"
                                    style={{ width: `${progress.pct}%` }} />
                            </div>
                        </div>
                    )}
                </section>
            )}

            {flashNote && (
                <div className="flex items-start gap-2 rounded border border-emerald-700 bg-emerald-900/15
                                px-3 py-2 text-emerald-400">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{flashNote}</span>
                </div>
            )}

            {/* ================= ③ adaptations ================= */}
            <section className="rounded border border-slate-700 bg-slate-900 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">③ 学習クリア</span>
                    {vanosClearedAt && (
                        <span className="text-[10px] text-emerald-400 font-mono">
                            VANOS {stamp(vanosClearedAt)}
                        </span>
                    )}
                </div>
                <p className="text-[10px] leading-relaxed text-slate-500">
                    VANOS に学習オフセットが残っていると、指令した角度と実際のカム位置がずれます。
                    ずれた分だけ全サンプルが「誰も記録していない角度」のものになるため、掃引の前に必ず消します。
                    クリア後、DME が書き込むまで 2 秒待ってから読み戻します。
                </p>
                <div className="flex flex-wrap gap-2">
                    <button onClick={clearVanos} disabled={!capable || busy != null}
                        className="min-h-[44px] px-4 rounded text-[11px] font-semibold border border-blue-500
                                   text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 flex items-center gap-2">
                        {busy === 'vanos'
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> クリア中</>
                            : <>VANOS 学習をクリア</>}
                    </button>
                    <button onClick={clearTune} disabled={!capable || busy != null}
                        className="min-h-[44px] px-4 rounded text-[11px] border border-slate-700 text-slate-400
                                   hover:border-slate-600 disabled:opacity-40 flex items-center gap-2">
                        {busy === 'tune'
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> クリア中</>
                            : <>λ / ノック学習もクリア（任意）</>}
                    </button>
                </div>
                <p className="text-[10px] text-slate-600 leading-relaxed">
                    右のボタンは SMG やスロットルの学習には触れません（CSL は SMG-II なので、
                    クラッチ再学習が必要になる範囲は意図的に外してあります）。
                </p>

                {adaptations && (
                    <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full text-[10px] font-mono border-collapse min-w-[22rem]">
                            <thead>
                                <tr className="text-slate-500">
                                    <th className="text-left py-1 pr-2 font-normal">値</th>
                                    <th className="text-right py-1 px-2 font-normal">読み値</th>
                                    <th className="text-right py-1 pl-2 font-normal">期待値</th>
                                </tr>
                            </thead>
                            <tbody>
                                {adaptations.readings.map(r => (
                                    <tr key={r.symbol} className="border-t border-slate-800">
                                        <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">
                                            {r.label}
                                            {!isClearedByTuneReset(r) && (
                                                <span className="ml-1 text-slate-600">(対象外)</span>
                                            )}
                                        </td>
                                        <td className="py-1 px-2 text-right text-slate-300">
                                            {r.value == null ? '—' : r.value.toFixed(3)} {r.unit}
                                        </td>
                                        <td className="py-1 pl-2 text-right text-slate-600">
                                            {isClearedByTuneReset(r) ? r.cleared.toFixed(3) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="mt-1.5 text-[10px] text-slate-600 leading-relaxed">
                            期待値がすべて 0 でないのは正常です。2 行は乗算補正で、中立が 1.000 です
                            （0 は「燃料ゼロ」を意味してしまいます）。
                        </p>
                    </div>
                )}
            </section>

            {/* ================= ④ warm-up ================= */}
            <section className="rounded border border-slate-700 bg-slate-900 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-slate-500" />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">④ 暖機</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {([['水温', coolant, MIN_COOLANT_C], ['油温', oil, MIN_OIL_C]] as const).map(([label, v, min]) => (
                        <div key={label} className={`rounded border px-3 py-2 ${v == null ? 'border-slate-800'
                            : v >= min ? 'border-emerald-800 bg-emerald-900/10' : 'border-amber-800 bg-amber-900/10'}`}>
                            <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
                            <div className={`font-mono text-[16px] font-bold ${v == null ? 'text-slate-600'
                                : v >= min ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {v == null ? '—' : `${v.toFixed(0)} °C`}
                            </div>
                            <div className="text-[9px] text-slate-600">{min} °C 以上</div>
                        </div>
                    ))}
                </div>
                {(coolant == null || oil == null) && (
                    <span className="text-[10px] text-slate-600">
                        接続すると、ここが実測値で更新されます。
                        点検や書き込みの間はポーリングを止めるため、値は一時的に止まります。
                    </span>
                )}
            </section>

            {/* ================= backups ================= */}
            <section className="rounded border border-slate-800 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Save className="w-3.5 h-3.5 text-slate-600" />
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">
                        保存済みバックアップ（この端末内）
                    </span>
                </div>
                {backups.length === 0 ? (
                    <span className="text-[10px] text-slate-600">まだありません。書き込み時に自動で作られます。</span>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {backups.map(b => (
                            <li key={b.id} className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
                                <HardDriveDownload className="w-3 h-3 shrink-0 text-slate-600" />
                                <span>{stamp(b.at)}</span>
                                <span className="text-slate-600 truncate">{b.vin}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

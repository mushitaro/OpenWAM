"use client";
import { useEffect, useState } from "react";
import { correctedCases, correctedRun, correctedLast, cancelRuns, CorrectedResult, CorrectedCase } from "../app/api";

export default function CorrectedEvaluation({ onBusy }: { onBusy: (busy: boolean) => void }) {
    const [cases, setCases] = useState<CorrectedCase[]>([]);
    const [id, setId] = useState("");
    const [available, setAvailable] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<CorrectedResult | null>(null);
    const [error, setError] = useState("");
    useEffect(() => { correctedCases().then(c => {
        setCases(c.cases); setId(c.cases[0]?.id ?? ""); setAvailable(c.corrected_available);
    }).catch(e => setError(String(e))); }, []);
    const run = async (extent: "short" | "cycle") => {
        setBusy(true); onBusy(true); setError(""); setResult(null);
        try { setResult(await correctedRun(id, extent, extent === "short" ? 60 : 14400)); }
        catch (e) { setError(String(e)); } finally { setBusy(false); onBusy(false); }
    };
    const selected = cases.find(c => c.id === id);
    return <section className="p-6 h-[calc(100%-64px)] overflow-auto text-slate-200 space-y-4">
        <h2 className="text-lg font-bold">修正モデル — 登録ケースのVE評価</h2>
        <p>固定した管網・弁駆動・保存状態から計算します。BuilderのRPM・RO・形状変更は適用されません。</p>
        <p className="text-amber-300">格子・周期基準は未達、実車精度は未証明です。通常探索には従来モデルを使ってください。</p>
        {!available && <p>修正モデルは未ビルドです。導入手順に従ってビルドしてください。</p>}
        {!cases.length && <p>登録ケースがありません。検証済み入力と保存状態の登録が必要です。</p>}
        <select aria-label="修正モデルの検証ケース" className="bg-slate-800 p-2" value={id} disabled={busy}
            onChange={e => setId(e.target.value)}>
            {cases.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {selected && <p>{selected.conditions.rpm} rpm / RO: {selected.conditions.ro ?? "未同定"} / {selected.conditions.scope}</p>}
        <div className="flex flex-wrap gap-3">
            <button className="border p-2" disabled={busy || !id || !available} onClick={() => run("short")}>短区間の動作確認（上限60秒）</button>
            <button className="border p-2" disabled={busy || !id || !available} onClick={() => run("cycle")}>1周期のVE再評価（上限4時間）</button>
            <button className="border p-2" disabled={busy} onClick={() => correctedLast().then(setResult).catch(e => setError(String(e)))}>修正モデルの前回結果を読む</button>
            {busy && <button className="border p-2" onClick={() => cancelRuns().catch(e => setError(String(e)))}>計算を中断</button>}
        </div>
        {busy && <p>計算中です。完了後にモデル・入力SHA・結果を保存します。</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {result && <div className="space-y-3">
            <h3>保存結果: {result.model} / {result.case_id}</h3>
            <p>{result.ivc_all_refreshed ? "6気筒のIVC更新を確認" : "短区間確認のみ。未更新の値は以前のIVCから保持した値です。"}</p>
            <p>VE定義: {result.ve_definition}。参照空気質量: {result.reference_air_mass_kg} kg</p>
            <p>{result.reference_definition}</p>
            <table className="w-full text-left"><thead><tr><th>気筒</th><th>酸素換算VE %</th><th>今回IVC更新</th></tr></thead>
                <tbody>{result.cylinders.map(c => <tr key={c.cylinder}><td>{c.cylinder}</td><td>{c.ve_oxygen_percent.toFixed(6)}</td><td>{c.ivc_refreshed ? "あり" : "なし"}</td></tr>)}</tbody></table>
            <p>計算時間 {result.elapsed_sec.toFixed(2)} 秒 / 収支残差 {result.budget_max.toExponential(3)}</p>
            <p>{result.limits}</p>
            <details><summary>モデル・入力と結果の記録</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre></details>
            <a className="underline" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result, null, 2))}`}
                download={`corrected-ve-${result.run_id}.json`}>結果JSONを保存</a>
        </div>}
    </section>;
}

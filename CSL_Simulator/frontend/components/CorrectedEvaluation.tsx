"use client";
import { useEffect, useState } from "react";
import { correctedCases, correctedBuilderRun, correctedBuilderInputs, correctedLast, cancelRuns, CorrectedResult, SimConfig } from "../app/api";

export default function CorrectedEvaluation({ config, onConfigChange, onBusy }: { config: SimConfig; onConfigChange: (config: SimConfig) => void; onBusy: (busy: boolean) => void }) {
    const [cycles, setCycles] = useState(1);
    const [prepared, setPrepared] = useState("");
    const [available, setAvailable] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<CorrectedResult | null>(null);
    const [error, setError] = useState("");
    useEffect(() => { correctedCases().then(c => {
        setAvailable(c.corrected_builder_available);
    }).catch(e => setError(String(e))); }, []);
    const run = async (extent: "inputs" | "short" | "cycles") => {
        setBusy(true); onBusy(true); setError(""); setResult(null);
        try {
            setPrepared("");
            if (extent === "inputs") {
                const p = await correctedBuilderInputs(config);
                setPrepared(`入力保存・全720度の開口確認済み: ${p.input_validation.pipes}管 / ${p.input_validation.sampled_crank_angles}角度 / ${p.run_id}`);
            } else setResult(await correctedBuilderRun(config, extent, cycles, extent === "short" ? 60 : 14400));
        }
        catch (e) { setError(String(e)); } finally { setBusy(false); onBusy(false); }
    };
    const throttle = config.engine.throttle_position ?? 1;
    const valid = Number.isFinite(config.engine.rpm) && config.engine.rpm > 0 && config.engine.rpm <= 20000 &&
        Number.isFinite(throttle) && throttle >= 0 && throttle <= 1 &&
        Number.isInteger(cycles) && cycles >= 1 && cycles <= 120;
    return <section className="p-6 h-[calc(100%-64px)] overflow-auto text-slate-200 space-y-4">
        <h2 className="text-lg font-bold">修正モデル — Builder条件のVE評価</h2>
        <p>現在のBuilder形状・VANOS・下記RPMとROから入力を生成し、初期状態から計算します。形状はBuilderタブで変更できます。</p>
        <p className="text-amber-300">格子・周期基準は未達、実車精度は未証明です。通常探索には従来モデルを使ってください。</p>
        {!available && <p>修正モデルは未ビルドです。導入手順に従ってビルドしてください。</p>}
        <div className="flex gap-4">
            <label>RPM <input aria-label="修正モデルRPM" type="number" min="1" max="20000" className="bg-slate-800 p-2 w-28" disabled={busy} value={config.engine.rpm}
                onChange={e => onConfigChange({ ...config, engine: { ...config.engine, rpm: Number(e.target.value) } })} /></label>
            <label>RO % <input aria-label="修正モデルRO" type="number" min="0" max="100" step="0.1" className="bg-slate-800 p-2 w-24" disabled={busy} value={throttle*100}
                onChange={e => onConfigChange({ ...config, engine: { ...config.engine, throttle_position: Number(e.target.value)/100 } })} /></label>
            <label>周期数 <input aria-label="修正モデル周期数" type="number" min="1" max="120" className="bg-slate-800 p-2 w-20" disabled={busy} value={cycles} onChange={e => setCycles(Number(e.target.value))} /></label>
        </div>
        <p>有限周期の結果は過渡値です。周期数を指定しても収束済みにはなりません。管壁は断熱、筒壁は333.15Kの修正モデル設定です。</p>
        <div className="flex flex-wrap gap-3">
            <button className="border p-2" disabled={busy || !valid || !available} onClick={() => run("inputs")}>入力生成・確認のみ</button>
            <button className="border p-2" disabled={busy || !valid || !available} onClick={() => run("short")}>短区間の動作確認（上限60秒）</button>
            <button className="border p-2" disabled={busy || !valid || !available} onClick={() => run("cycles")}>指定周期のVE評価（上限4時間）</button>
            <button className="border p-2" disabled={busy} onClick={() => correctedLast().then(setResult).catch(e => setError(String(e)))}>修正モデルの前回結果を読む</button>
            {busy && <button className="border p-2" onClick={() => cancelRuns().catch(e => setError(String(e)))}>計算を中断</button>}
        </div>
        {busy && <p>計算中です。完了後にモデル・入力SHA・結果を保存します。</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {prepared && <p role="status">{prepared}。流体計算・VE評価は未実施です。</p>}
        {result && <div className="space-y-3">
            <h3>保存結果: {result.model} / {result.case_id}</h3>
            {result.conditions && <p>保存時の条件: {result.conditions.rpm} RPM / RO {result.conditions.ro ?? "未同定"}%（現在の編集値とは別です）</p>}
            <p>{result.ivc_all_refreshed ? "6気筒のIVC更新を確認。周期収束は未確認です。" : "短区間確認のみ。IVC未更新はVE未評価です。登録済み旧ケースを読み込んだ場合は保存状態の保持値を含みます。"}</p>
            <p>VE定義: {result.ve_definition}。参照空気質量: {result.reference_air_mass_kg} kg</p>
            <p>{result.reference_definition}</p>
            <table className="w-full text-left"><thead><tr><th>気筒</th><th>酸素換算VE %</th><th>今回IVC更新</th></tr></thead>
                <tbody>{result.cylinders.map(c => <tr key={c.cylinder}><td>{c.cylinder}</td><td>{c.ve_oxygen_percent === null ? "未評価" : c.ve_oxygen_percent.toFixed(6)}</td><td>{c.ivc_refreshed ? "あり" : "なし"}</td></tr>)}</tbody></table>
            <p>計算時間 {result.elapsed_sec.toFixed(2)} 秒 / 収支残差 {result.budget_max.toExponential(3)}</p>
            <p>{result.limits}</p>
            <details><summary>モデル・入力と結果の記録</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(result, null, 2)}</pre></details>
            <a className="underline" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result, null, 2))}`}
                download={`corrected-ve-${result.run_id}.json`}>結果JSONを保存</a>
        </div>}
    </section>;
}

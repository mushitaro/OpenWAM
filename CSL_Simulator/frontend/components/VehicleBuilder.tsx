"use client";

import React, { useState, useEffect, useRef } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Play, Activity, Settings2, Info, Wrench, BarChart2, Save, Upload, Download, History, Square, FileSpreadsheet } from "lucide-react";
import { runTuning, fetchLastTuning, runSimulation, fetchLastRun, cancelRuns, fetchMaps, fetchBinVeMap, fetchMeta, CalibrationResponse, RunResponse, OptimizationResponse, MetaResponse, SimConfig, EcuVeMap, WS_BASE_URL, downloadMeasurementSheet, importMeasurementSheet, SheetImportResult } from "../app/api";
import ProvenanceStrip from "./ProvenanceStrip";
import VETableComparison from "./VETableComparison";
import BinaryPatchManager from "./BinaryPatchManager";
import SimulationDebugPanel from "./SimulationDebugPanel";
import InteractiveTopology, { SelectionType } from "./InteractiveTopology";
import LiveTelemetry from "./LiveTelemetry";
import { V14_OWNER, LEGACY_NEUTRAL, deepMerge } from "../app/presets";
import VeOverlayChart from "./VeOverlayChart";
import ValidityPanel from "./ValidityPanel";
import VeSurfaceChart from "./VeSurfaceChart";
import VeWaveformChart from "./WaveformChart";
import TuningResults from "./TuningResults";

// Nearest-breakpoint lookup into an ECU VE map (kf_rf_soll shape). The run axes
// ARE the map's axes for this engine, so nearest == exact. Values are fractional
// (1.202 = 120.2 %) -> multiply by 100 to match VE% used everywhere else.
const nearestIdx = (axis: number[], v: number) =>
    axis.reduce((best, a, i) => (Math.abs(a - v) < Math.abs(axis[best] - v) ? i : best), 0);
function ecuBaseAt(map: EcuVeMap | null, rpm: number, load: number): number | null {
    if (!map?.values?.length) return null;
    const val = map.values?.[nearestIdx(map.y_axis, load)]?.[nearestIdx(map.x_axis, rpm)];
    return typeof val === "number" ? val * 100 : null;
}

// Adapt the structured RunResponse into the matrix shape VETableComparison expects
// ([loadRow][rpmCol]). Base resolution per cell: ECU base map (uploaded BIN, else
// repo kf_rf_soll) -> measured WOT stock -> 0. This fills the part-load Base VE /
// Correction that measured data alone leaves at 0. §5 validity is untouched (it
// reads ve_stock server-side); this is display-only.
function runToCalibration(run: RunResponse, baseMap: EcuVeMap | null): CalibrationResponse {
    const rpm = run.axes.rpm;
    const load = run.axes.load;
    const baseAt = (c: RunResponse["cells"][number][number]) =>
        ecuBaseAt(baseMap, c.rpm, c.tps) ?? c.ve_stock ?? null;
    const sim = run.cells.map((row) => row.map((c) => c.ve_sim));
    const target = run.cells.map((row) => row.map((c) => baseAt(c) ?? 0));
    const correction = run.cells.map((row) =>
        row.map((c) => { const b = baseAt(c); return b && b > 0 ? c.ve_sim / b : 1; }));
    return { curve: [], matrix: { rpm, load, target, sim, correction } } as CalibrationResponse;
}

const VehicleBuilder = () => {
    // --- STATE ---
    const [mainTab, setMainTab] = useState<"builder" | "simulation" | "live">("builder");

    const [loading, setLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [runData, setRunData] = useState<RunResponse | null>(null);
    // snapshot of the config that produced runData, so the Waveform view drills
    // into the SAME geometry the surface/summary show (config may be edited after).
    const [runConfig, setRunConfig] = useState<SimConfig | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number; eta?: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // non-error notices (cancel confirmations, config loaded, ...) — amber, not red
    const [notice, setNotice] = useState<string | null>(null);
    // M4 tuning state
    const [tuneData, setTuneData] = useState<OptimizationResponse | null>(null);
    const [tunePref, setTunePref] = useState<"max_ve" | "smooth">("max_ve");
    const [tuneProgress, setTuneProgress] = useState<{ done: number; total: number; eta?: number } | null>(null);
    // M3/M4: which results view is showing
    const [resultView, setResultView] = useState<"summary" | "surface" | "waveform" | "tuning">("summary");
    // Stage 74 provenance: current backend meta (STALE-badge reference) and
    // whether the shown result came from disk (Load last) vs a fresh run.
    const [meta, setMeta] = useState<MetaResponse | null>(null);
    const [runFromDisk, setRunFromDisk] = useState(false);
    const [tuneFromDisk, setTuneFromDisk] = useState(false);
    useEffect(() => { fetchMeta().then(setMeta); }, []);

    // Live progress: parse "CELL x/y" broadcasts on /ws/logs into a progress bar.
    useEffect(() => {
        let ws: WebSocket | null = null;
        try {
            ws = new WebSocket(`${WS_BASE_URL}/ws/logs`);
            ws.onmessage = (e) => {
                const s = typeof e.data === "string" ? e.data : "";
                const m = /CELL (\d+)\/(\d+)/.exec(s);
                if (m) {
                    const eta = /eta=(\d+)s/.exec(s);
                    setProgress({ done: parseInt(m[1], 10), total: parseInt(m[2], 10), eta: eta ? parseInt(eta[1], 10) : undefined });
                }
                // M4: "OPT k/N ... eta=Xs" broadcasts from the VANOS optimizer
                const t = /OPT (\d+)\/(\d+)/.exec(s);
                if (t) {
                    const eta = /eta=(\d+)s/.exec(s);
                    setTuneProgress({ done: parseInt(t[1], 10), total: parseInt(t[2], 10), eta: eta ? parseInt(eta[1], 10) : undefined });
                }
            };
        } catch { /* backend not up yet */ }
        return () => { try { ws?.close(); } catch { } };
    }, []);

    // Base VE map source: prefer the uploaded BIN's KF_RF_SOLL (per-vehicle
    // ground truth), fall back to the repo kf_rf_soll. Feeds the part-load Base
    // VE / Correction table (display only; §5 validity reads ve_stock server-side
    // and is unaffected). Refreshed on mount and after a BIN upload.
    const [ecuBaseMap, setEcuBaseMap] = useState<EcuVeMap | null>(null);
    const refreshBaseMap = async () => {
        const bin = await fetchBinVeMap();
        if (bin?.values?.length) { setEcuBaseMap(bin); return; }
        try {
            const maps = await fetchMaps();
            const rf = maps?.kf_rf_soll;
            if (rf?.values?.length) setEcuBaseMap({ x_axis: rf.x_axis, y_axis: rf.y_axis, values: rf.values });
        } catch { /* backend down -> base stays null -> per-cell falls back to ve_stock */ }
    };
    useEffect(() => { refreshBaseMap(); }, []);

    // Builder State
    const [selection, setSelection] = useState<SelectionType | null>({ type: "environment" });

    // config state — starts as the v14 owner-car digital twin (Stage 74).
    // The full value set lives in presets/v14_owner.json (also read by the
    // backend parity gate); LEGACY_NEUTRAL is the Stage-69 model baseline.
    const [config, setConfig] = useState<SimConfig>(() => structuredClone(V14_OWNER));
    const [activePreset, setActivePreset] = useState<"v14" | "legacy">("v14");
    const applyPreset = (which: "v14" | "legacy") => {
        if (!window.confirm("プリセットを適用すると未保存の編集は破棄されます。よろしいですか?")) return;
        setConfig(structuredClone(which === "v14" ? V14_OWNER : LEGACY_NEUTRAL));
        setActivePreset(which);
        setNotice(which === "v14"
            ? "プリセット「v14 オーナー実車」を適用しました(Stage 74 実測ツイン)。"
            : "プリセット「レガシー中立 (Stage 69 基準)」を適用しました(モデル既定値)。");
    };

    // --- UPDATERS ---
    const updateConfig = (section: keyof SimConfig, path: string, value: any) => {
        setConfig(prev => {
            const sectionData = { ...prev[section] };
            const keys = path.split('.');
            let current: any = sectionData;
            for (let i = 0; i < keys.length - 1; i++) { current = current[keys[i]]; }
            const finalKey = keys[keys.length - 1];
            current[finalKey] = !isNaN(Number(value)) && value !== "" ? Number(value) : value;
            return { ...prev, [section]: sectionData };
        });
    };

    const handleRun = async (mode: "wot_quick" | "full_map") => {
        setLoading(true);
        setError(null);
        setNotice(null);
        setRunData(null);
        setProgress({ done: 0, total: mode === "wot_quick" ? 20 : 480 });
        setMainTab("simulation"); // Auto switch to simulation tab
        try {
            const runCfg = structuredClone(config);
            const data = await runSimulation(runCfg, mode);
            setRunData(data);
            setRunFromDisk(false);
            setRunConfig(runCfg);   // snapshot geometry for the Waveform drill-down
            // fresh run results must be visible, not hidden behind a stale
            // "tuning" (or other) view selection.
            setResultView("summary");
        } catch (err: any) {
            console.error("Simulation catch error:", err);
            // runData was cleared above; fall back to whatever still has data
            if (tuneData) setResultView("tuning");
            const msg = err.message || "Simulation failed";
            if (/cancel/i.test(msg)) {
                setNotice("Cancelled — finished cells are cached; re-run to resume.");
            } else {
                setError(msg);
            }
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    // Recover the last persisted map (e.g. a full_map whose fetch died) without re-running.
    const handleLoadLast = async (mode: "wot_quick" | "full_map") => {
        setError(null);
        try {
            const data = await fetchLastRun(mode);
            setRunData(data);
            setRunFromDisk(true);
            setRunConfig(null);   // saved geometry unknown; waveform falls back to live config
            setResultView("summary");
            setMainTab("simulation");
        } catch (err: any) {
            setError(err?.message || "No saved run to load");
        }
    };

    // M4: WOT VANOS tuning (UX_APP_DEV_SPEC §7). Long real-sim search; the deck
    // cache makes re-runs resumable and the result persists server-side, so a
    // lost fetch is recoverable via "Load last tuning".
    const handleRunTuning = async () => {
        setOptimizing(true);
        setError(null);
        setTuneProgress(null);
        setMainTab("simulation");
        try {
            const runCfg = structuredClone(config);
            const data = await runTuning(runCfg, tunePref);
            setTuneData(data);
            setTuneFromDisk(false);
            setResultView("tuning");
        } catch (err: any) {
            const msg = err?.message || "Tuning failed";
            if (/cancel/i.test(msg)) {
                setNotice("Tuning cancelled — completed evaluations are cached; re-run to resume.");
            } else if (/fetch|network|load failed/i.test(msg)) {
                // network-layer failures (any browser's wording) — the search
                // keeps running server-side and persists on completion.
                setError(`${msg} — the search keeps running server-side; use "Load last tuning" when it finishes.`);
            } else {
                setError(msg);
            }
        } finally {
            setOptimizing(false);
            setTuneProgress(null);
        }
    };

    const handleLoadLastTuning = async () => {
        setError(null);
        try {
            const data = await fetchLastTuning();
            setTuneData(data);
            setTuneFromDisk(true);
            setResultView("tuning");
            setMainTab("simulation");
        } catch (err: any) {
            setError(err?.message || "No saved tuning run to load");
        }
    };

    // M5: cancel every in-flight sim (map / tuning / waveform). Finished cells
    // stay cached, so re-running the same request resumes where it stopped.
    const handleCancel = async () => {
        try {
            const r = await cancelRuns();
            setNotice(`Cancelled ${r.cancelled_tasks} in-flight sim task(s) — finished cells are cached; re-run to resume.`);
        } catch (err: any) {
            setError(err?.message || "Cancel failed");
        }
    };

    // M5: project (SimConfig) load — counterpart of handleConfigSave.
    const configFileRef = useRef<HTMLInputElement>(null);
    // real-engine measurement sheet (.xlsx) import
    const sheetFileRef = useRef<HTMLInputElement>(null);
    // Merge base for loaded project files: LEGACY_NEUTRAL (= backend model
    // defaults), NOT the active preset — a saved project missing new keys
    // actually RAN with the backend defaults filling them (Pydantic), so
    // merging over LEGACY_NEUTRAL reproduces that run exactly; merging over
    // v14 would retroactively inject v14 geometry into old projects.
    const defaultConfigRef = useRef<SimConfig | null>(null);
    if (defaultConfigRef.current === null) defaultConfigRef.current = structuredClone(LEGACY_NEUTRAL);
    const handleConfigLoad = () => configFileRef.current?.click();
    const handleConfigFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";   // allow re-selecting the same file
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(String(ev.target?.result ?? ""));
                if (!parsed || typeof parsed !== "object" || !parsed.engine || !parsed.intake || !parsed.exhaust) {
                    setError("Invalid config file — expected a SimConfig JSON (engine/intake/exhaust sections).");
                    return;
                }
                // merge over PRISTINE DEFAULTS (not the currently-edited config)
                // so a load reproduces the saved project; defaults fill fields
                // that didn't exist when the file was saved.
                setConfig(deepMerge(defaultConfigRef.current, parsed) as SimConfig);
                setError(null);
                setNotice(`Config loaded from ${file.name}.`);
            } catch {
                setError(`Could not parse ${file.name} as JSON.`);
            }
        };
        reader.readAsText(file);
    };
    const handleConfigSave = () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "csl_sim_config.json";
        a.click();
    };

    // --- Real-engine measurement sheet (Excel): download / import ---
    // DL: POST the current config so the sheet's "現在値" column mirrors it.
    const handleSheetDownload = async () => {
        try {
            const blob = await downloadMeasurementSheet(config);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "csl_measurement_sheet.xlsx";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setNotice("計測記入シート (Excel) をダウンロードしました。実測値を記入し「シート取込」で反映できます。");
            setError(null);
        } catch (err: any) {
            setError(err?.message || "計測シートのダウンロードに失敗しました。");
        }
    };

    // Import: parse on the backend, then merge the applied path/value pairs into
    // the live config via the same deepMerge used by the JSON project loader.
    const handleSheetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";   // allow re-selecting the same file
        if (!file) return;
        try {
            const res: SheetImportResult = await importMeasurementSheet(file);
            if (res.applied.length === 0) {
                setNotice(`シートに記入値が見つかりませんでした（スキップ ${res.skipped.length} 件）。「計測値(記入)」列に入力して保存したか確認してください。`);
                return;
            }
            // build one nested patch object from the dotted paths, then deep-merge
            const patch: any = {};
            for (const a of res.applied) {
                const keys = a.path.split(".");
                let cur = patch;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
                    cur = cur[keys[i]];
                }
                cur[keys[keys.length - 1]] = a.value;
            }
            setConfig(prev => deepMerge(prev, patch) as SimConfig);

            const preview = res.applied.slice(0, 4)
                .map(a => `${a.label} ${a.old ?? "—"}→${a.value}`).join(", ");
            const more = res.applied.length > 4 ? ` 他${res.applied.length - 4}件` : "";
            let msg = `計測シートから ${res.applied.length} 項目を反映（${preview}${more}）。空欄 ${res.skipped.length} 項目はスキップ。`;
            if (res.warnings.length) msg += ` ⚠ ${res.warnings.join(" / ")}`;
            setNotice(msg);
            setError(null);
        } catch (err: any) {
            setError(err?.message || "計測シートの取込に失敗しました。");
        }
    };

    // --- ID PREDICTION HELPER ---
    const getPredictedID = (sel: SelectionType | null) => {
        if (!sel) return "-";

        switch (sel.type) {
            case "environment": return "N/A";
            case "intake_duct": return "Pipe 1";
            case "plenum": return "Plenum 2";
            case "itb": return "ITB Butterfly ×6";
            case "eq_tube": return "EQ Balance Tube";
            case "runner": return `Pipe ${2 + (sel.index * 3)}`;
            case "cylinder": return `Cylinder ${sel.index + 1}`;
            case "header": return `Pipe ${20 + (sel.index * 3)}`;
            case "collector": return "Collector (Plenum)";
            case "section1": return "Pipe (Merge)";
            case "section2": return "Pipe (Mid)";
            case "muffler": return "Plenum (Muffler)";
            case "head_return": return "Pipe (Head Return)";
            default: return "-";
        }
    };

    // --- COMPONENTS ---

    // 1. Parameter Form
    const renderSelectionParams = () => {
        if (!selection) return <div className="text-neutral-500 text-sm italic p-4">Select a component to view parameters.</div>;
        const { type } = selection;

        const InputRow = ({ label, value, onChange, unit }: any) => (
            <div className="mb-3">
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label} {unit && `(${unit})`}</label>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 outline-none transition-colors font-mono"
                />
            </div>
        );

        const SectionHeader = ({ title, id }: { title: string, id: string }) => (
            <div className="mb-6 border-b border-neutral-800 pb-2">
                <h3 className="text-lg font-medium text-neutral-200">{title}</h3>
                <div className="text-xs text-neutral-500 font-mono mt-1">SIM ID: {id}</div>
            </div>
        );

        return (
            <div className="p-4">
                {/* Selection Specific Forms */}
                {type === "environment" && (
                    <>
                        <SectionHeader title="Environment & Simulation" id="N/A" />
                        <InputRow label="Ambient Temp" unit="K" value={config.environment.ambient_temp} onChange={(v: any) => updateConfig("environment", "ambient_temp", v)} />
                        <InputRow label="Pressure" unit="Pa" value={config.environment.ambient_pressure} onChange={(v: any) => updateConfig("environment", "ambient_pressure", v)} />

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <label className="block text-xs font-bold text-neutral-400 mb-2">ADVANCED / GLOBAL</label>
                            <InputRow label="RPM Target" unit="rpm" value={config.engine.rpm} onChange={(v: any) => updateConfig("engine", "rpm", v)} />
                            <InputRow label="Fuel LCV" unit="J/kg" value={config.fuel.lcv} onChange={(v: any) => updateConfig("fuel", "lcv", v)} />
                            <InputRow label="Fuel Density" unit="kg/m3" value={config.fuel.density} onChange={(v: any) => updateConfig("fuel", "density", v)} />
                            <InputRow label="Mesh Size" unit="m" value={config.simulation.mesh_size} onChange={(v: any) => updateConfig("simulation", "mesh_size", v)} />
                        </div>
                    </>
                )}

                {(type === "intake_duct" || type === "plenum") && (
                    <>
                        <SectionHeader title={type === "intake_duct" ? "Intake Duct" : "Plenum"} id={getPredictedID(selection)} />
                        <InputRow label="Duct Length" unit="mm" value={config.intake.inlet.duct_length} onChange={(v: any) => updateConfig("intake", "inlet.duct_length", v)} />
                        <InputRow label="Duct Inlet Dia" unit="mm" value={config.intake.inlet.duct_diameter} onChange={(v: any) => updateConfig("intake", "inlet.duct_diameter", v)} />
                        <InputRow label="Exit Slot W" unit="mm" value={config.intake.inlet.exit_width ?? ""} onChange={(v: any) => updateConfig("intake", "inlet.exit_width", v === "" || v == null ? null : v)} />
                        <InputRow label="Exit Slot H" unit="mm" value={config.intake.inlet.exit_height ?? ""} onChange={(v: any) => updateConfig("intake", "inlet.exit_height", v === "" || v == null ? null : v)} />
                        <div className="text-[10px] text-neutral-600 mb-2">Slot empty = circular exit (= inlet dia). Measured car: 550×190.</div>
                        <InputRow label="Filter Thickness" unit="mm" value={config.intake.inlet.filter_thickness} onChange={(v: any) => updateConfig("intake", "inlet.filter_thickness", v)} />
                        <InputRow label="Plenum Vol" unit="L" value={config.intake.plenum_vol} onChange={(v: any) => updateConfig("intake", "plenum_vol", v)} />
                        {type === "plenum" && (
                            <div className="text-[11px] text-neutral-600 mt-3 leading-snug">
                                ITB and Equalization Tube are separate components — select them in the diagram.
                            </div>
                        )}
                    </>
                )}

                {type === "itb" && (
                    <>
                        <SectionHeader title="Individual Throttle Bodies" id={getPredictedID(selection)} />
                        <div className="flex items-center gap-2 mb-4">
                            <input type="checkbox" checked={config.intake.itb.fitted} onChange={(e) => updateConfig("intake", "itb.fitted", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                            <span className="text-sm font-medium text-neutral-300">ITB Fitted</span>
                        </div>
                        <InputRow label="ITB Diameter" unit="mm" value={config.intake.itb.diameter} onChange={(v: any) => updateConfig("intake", "itb.diameter", v)} />
                        <InputRow label="Plate Thickness" unit="mm" value={config.intake.itb.plate_thickness} onChange={(v: any) => updateConfig("intake", "itb.plate_thickness", v)} />

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">THROTTLE MODEL (Butterfly)</h4>
                            <InputRow label="Idle Offset" unit="deg" value={config.intake.throttle.idle_offset_deg} onChange={(v: any) => updateConfig("intake", "throttle.idle_offset_deg", v)} />
                            <InputRow label="Pedal Gamma" unit="-" value={config.intake.throttle.pedal_gamma} onChange={(v: any) => updateConfig("intake", "throttle.pedal_gamma", v)} />
                            <div className="text-[10px] text-neutral-600">γ&gt;1 = progressive metering (validated 1.4)</div>
                        </div>
                    </>
                )}

                {type === "eq_tube" && (
                    <>
                        <SectionHeader title="Equalization Tube" id={getPredictedID(selection)} />
                        <div className="flex items-center gap-2 mb-4">
                            <input type="checkbox" checked={config.intake.eq_tube.enabled} onChange={(e) => updateConfig("intake", "eq_tube.enabled", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                            <span className="text-sm font-medium text-neutral-300">Enabled</span>
                        </div>
                        {config.intake.eq_tube.enabled && (
                            <>
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Model</label>
                                    <select value={config.intake.eq_tube.model} onChange={(e) => updateConfig("intake", "eq_tube.model", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                        <option value="plenum">Plenum (legacy)</option>
                                        <option value="chain">Continuous chain</option>
                                        <option value="rail">Common rail + ICV (measured car)</option>
                                    </select>
                                </div>
                                {config.intake.eq_tube.model === "rail" ? (
                                    <>
                                        <InputRow label="Rail Diameter" unit="mm" value={config.intake.eq_tube.rail_diameter} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_diameter", v)} />
                                        <InputRow label="Rail Length" unit="mm" value={config.intake.eq_tube.rail_length} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_length", v)} />
                                        <InputRow label="Tap Diameter" unit="mm" value={config.intake.eq_tube.rail_tap_diameter} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_tap_diameter", v)} />
                                        <InputRow label="Tap Length" unit="mm" value={config.intake.eq_tube.rail_tap_length} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_tap_length", v)} />
                                        <InputRow label="Tap Taper End Dia" unit="mm" value={config.intake.eq_tube.rail_tap_taper_end ?? ""} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_tap_taper_end", v === "" || v == null ? null : v)} />
                                        <div className="text-[10px] text-neutral-600 mb-2">実車ブランチはレール側 φ21 へ絞る(テーパ表現; Stage 70)。空欄 = ストレート(レガシー)。実 φ10 は数値限界で直接表現不可。</div>
                                        <InputRow label="Return Pipe Dia" unit="mm" value={config.intake.eq_tube.return_pipe_diameter} onChange={(v: any) => updateConfig("intake", "eq_tube.return_pipe_diameter", v)} />
                                        <InputRow label="Return Pipe Len" unit="mm" value={config.intake.eq_tube.return_pipe_length} onChange={(v: any) => updateConfig("intake", "eq_tube.return_pipe_length", v)} />
                                        <InputRow label="Rail Friction" unit="-" value={config.intake.eq_tube.rail_friction} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_friction", v)} />
                                        <InputRow label="Tap Friction" unit="-" value={config.intake.eq_tube.rail_tap_friction} onChange={(v: any) => updateConfig("intake", "eq_tube.rail_tap_friction", v)} />
                                        <div className="mb-3">
                                            <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Return Tap</label>
                                            <select value={config.intake.eq_tube.return_tap} onChange={(e) => updateConfig("intake", "eq_tube.return_tap", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                                <option value="center">Center (measured)</option>
                                                <option value="cyl1_end">Cyl-1 end</option>
                                                <option value="cyl6_end">Cyl-6 end</option>
                                            </select>
                                        </div>
                                        <InputRow label="ICV σ (fit)" unit="-" value={config.intake.eq_tube.icv_sigma} onChange={(v: any) => updateConfig("intake", "eq_tube.icv_sigma", v)} />
                                        <div className="text-[10px] text-neutral-600">φ21×570 rail taps all runners; returns to plenum through the ICV (throttle bypass). Tap φ30 = numerical floor (R1). ICV σ is calibrated, not measured.</div>
                                    </>
                                ) : (
                                    <>
                                        <InputRow label="Stub Diameter" unit="mm" value={config.intake.eq_tube.stub_diameter} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_diameter", v)} />
                                        <InputRow label="Stub Length" unit="mm" value={config.intake.eq_tube.stub_length} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_length", v)} />
                                        <InputRow label="Stub Friction" unit="-" value={config.intake.eq_tube.stub_friction} onChange={(v: any) => updateConfig("intake", "eq_tube.stub_friction", v)} />
                                        <InputRow label="Volume Scale" unit="×" value={config.intake.eq_tube.volume_scale} onChange={(v: any) => updateConfig("intake", "eq_tube.volume_scale", v)} />
                                        <InputRow label="Mistune Spread" unit="frac" value={config.intake.eq_tube.mistune_spread} onChange={(v: any) => updateConfig("intake", "eq_tube.mistune_spread", v)} />
                                        <div className="text-[10px] text-neutral-600">φ30 min stable; mistune detunes cyl-2 collapse</div>
                                    </>
                                )}
                            </>
                        )}
                    </>
                )}

                {type === "head_return" && (
                    <>
                        <SectionHeader title="Head Return (Crankcase Vent)" id={getPredictedID(selection)} />
                        <div className="flex items-center gap-2 mb-4">
                            <input type="checkbox" checked={config.intake.head_return.enabled} onChange={(e) => updateConfig("intake", "head_return.enabled", e.target.checked)} className="rounded border-neutral-700 bg-neutral-900" />
                            <span className="text-sm font-medium text-neutral-300">Fitted (owner car: yes)</span>
                        </div>
                        {config.intake.head_return.enabled && (
                            <>
                                <InputRow label="Hose Dia" unit="mm" value={config.intake.head_return.pipe_diameter} onChange={(v: any) => updateConfig("intake", "head_return.pipe_diameter", v)} />
                                <InputRow label="Hose Length" unit="mm" value={config.intake.head_return.pipe_length} onChange={(v: any) => updateConfig("intake", "head_return.pipe_length", v)} />
                                <InputRow label="Head Volume" unit="L" value={config.intake.head_return.volume} onChange={(v: any) => updateConfig("intake", "head_return.volume", v)} />
                                <div className="text-[10px] text-neutral-600 mb-2">ヘッド(カムカバー)→プレナムのブローバイ戻りホース(Stage 70-71 実測: φ15×250mm)。音響的にはエアボックスの Helmholtz 側枝。容積はカムカバー実効値(実測 2L 仮置き; オーナー承認済み)。</div>
                                <div className="mt-3 pt-3 border-t border-neutral-800">
                                    <h4 className="text-xs font-bold text-neutral-500 mb-2">ADVANCED</h4>
                                    <InputRow label="Hose Friction" unit="-" value={config.intake.head_return.friction} onChange={(v: any) => updateConfig("intake", "head_return.friction", v)} />
                                    <InputRow label="Wall Temp" unit="°C" value={config.intake.head_return.wall_temp} onChange={(v: any) => updateConfig("intake", "head_return.wall_temp", v)} />
                                </div>
                            </>
                        )}
                    </>
                )}

                {type === "runner" && (
                    <>
                        <SectionHeader title={`Runner #${selection.type === "runner" ? selection.index + 1 : ""}`} id={getPredictedID(selection)} />
                        <InputRow label="Bellmouth Length" unit="mm" value={config.intake.bellmouth.length} onChange={(v: any) => updateConfig("intake", "bellmouth.length", v)} />
                        <InputRow label="Bellmouth Dia" unit="mm" value={config.intake.bellmouth.diameter} onChange={(v: any) => updateConfig("intake", "bellmouth.diameter", v)} />
                        <InputRow label="Mouth (Entry) Dia" unit="mm" value={config.intake.runner.entry_diameter} onChange={(v: any) => updateConfig("intake", "runner.entry_diameter", v)} />
                        <InputRow label="Runner Upper Len" unit="mm" value={config.intake.runner.upper_length} onChange={(v: any) => updateConfig("intake", "runner.upper_length", v)} />
                        <InputRow label="Runner Lower Len" unit="mm" value={config.intake.runner.lower_length} onChange={(v: any) => updateConfig("intake", "runner.lower_length", v)} />
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">RAM TUNING</h4>
                            <InputRow label="Length Scale" unit="×" value={config.intake.runner.length_scale} onChange={(v: any) => updateConfig("intake", "runner.length_scale", v)} />
                            <InputRow label="Friction Mult" unit="×" value={config.intake.runner.friction_multiplier} onChange={(v: any) => updateConfig("intake", "runner.friction_multiplier", v)} />
                            <div className="text-[10px] text-neutral-600">Length Scale shifts the ram-resonance rpm; Friction Mult broadens it (Q).</div>
                        </div>
                        <div className="text-xs text-neutral-600 mt-2">Note: intake geometry is global for all runners.</div>
                    </>
                )}

                {type === "cylinder" && (
                    <>
                        <SectionHeader title={`Cylinder #${selection.type === "cylinder" ? selection.index + 1 : ""}`} id={getPredictedID(selection)} />
                        <InputRow label="Bore" unit="mm" value={config.engine.geometry.bore} onChange={(v: any) => updateConfig("engine", "geometry.bore", v)} />
                        <InputRow label="Stroke" unit="mm" value={config.engine.geometry.stroke} onChange={(v: any) => updateConfig("engine", "geometry.stroke", v)} />
                        <InputRow label="Compression Ratio" unit=":1" value={config.engine.geometry.compression_ratio} onChange={(v: any) => updateConfig("engine", "geometry.compression_ratio", v)} />
                        <InputRow label="Rod Length" unit="mm" value={config.engine.geometry.rod_length} onChange={(v: any) => updateConfig("engine", "geometry.rod_length", v)} />
                        <div className="mt-4 p-3 bg-neutral-900 border border-neutral-800 rounded">
                            <InputRow label="VANOS Intake Bias" unit="Deg" value={config.engine.vanos_intake_bias} onChange={(v: any) => updateConfig("engine", "vanos_intake_bias", v)} />
                            <InputRow label="VANOS Exhaust Bias" unit="Deg" value={config.engine.vanos_exhaust_bias} onChange={(v: any) => updateConfig("engine", "vanos_exhaust_bias", v)} />
                        </div>

                        <div className="mt-4">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">INTAKE VALVE</h4>
                            <InputRow label="Max Lift" unit="mm" value={config.engine.head.intake_valve.max_lift} onChange={(v: any) => updateConfig("engine", "head.intake_valve.max_lift", v)} />
                            <InputRow label="Duration" unit="deg" value={config.engine.head.intake_valve.duration} onChange={(v: any) => updateConfig("engine", "head.intake_valve.duration", v)} />
                            <InputRow label="Diameter" unit="mm" value={config.engine.head.intake_valve.diameter} onChange={(v: any) => updateConfig("engine", "head.intake_valve.diameter", v)} />
                            <InputRow label="Base Timing" unit="deg" value={config.engine.head.intake_valve.open_angle_base} onChange={(v: any) => updateConfig("engine", "head.intake_valve.open_angle_base", v)} />

                            <h4 className="text-xs font-bold text-neutral-500 mb-2 mt-3">EXHAUST VALVE</h4>
                            <InputRow label="Max Lift" unit="mm" value={config.engine.head.exhaust_valve.max_lift} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.max_lift", v)} />
                            <InputRow label="Duration" unit="deg" value={config.engine.head.exhaust_valve.duration} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.duration", v)} />
                            <InputRow label="Diameter" unit="mm" value={config.engine.head.exhaust_valve.diameter} onChange={(v: any) => updateConfig("engine", "head.exhaust_valve.diameter", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">PORT GEOMETRY</h4>
                            <InputRow label="In-Port Len" unit="mm" value={config.engine.head.intake_port.length} onChange={(v: any) => updateConfig("engine", "head.intake_port.length", v)} />
                            <InputRow label="In-Port Dia" unit="mm" value={config.engine.head.intake_port.diameter} onChange={(v: any) => updateConfig("engine", "head.intake_port.diameter", v)} />
                            <InputRow label="Ex-Port Len" unit="mm" value={config.engine.head.exhaust_port.length} onChange={(v: any) => updateConfig("engine", "head.exhaust_port.length", v)} />
                            <InputRow label="Ex-Port Dia" unit="mm" value={config.engine.head.exhaust_port.diameter} onChange={(v: any) => updateConfig("engine", "head.exhaust_port.diameter", v)} />
                            <InputRow label="In-Port Wall Temp" unit="°C" value={config.engine.head.intake_port_wall_temp} onChange={(v: any) => updateConfig("engine", "head.intake_port_wall_temp", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">HEAD / FLOW</h4>
                            <InputRow label="Port Flow Coeff" unit="×" value={config.engine.head.port_flow_coeff} onChange={(v: any) => updateConfig("engine", "head.port_flow_coeff", v)} />
                            <InputRow label="Port Friction" unit="-" value={config.engine.head.port_friction ?? 0.05} onChange={(v: any) => updateConfig("engine", "head.port_friction", v)} />
                            <InputRow label="Head Wall Temp" unit="K" value={config.engine.head.wall_temp} onChange={(v: any) => updateConfig("engine", "head.wall_temp", v)} />
                        </div>

                        <div className="mt-4 pt-4 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">COMBUSTION (Wiebe)</h4>
                            <InputRow label="Burn Duration" unit="deg" value={config.engine.combustion.duration} onChange={(v: any) => updateConfig("engine", "combustion.duration", v)} />
                            <InputRow label="Shape (m)" unit="-" value={config.engine.combustion.shape_parameter_m} onChange={(v: any) => updateConfig("engine", "combustion.shape_parameter_m", v)} />
                            <InputRow label="Efficiency (a)" unit="-" value={config.engine.combustion.efficiency_a} onChange={(v: any) => updateConfig("engine", "combustion.efficiency_a", v)} />
                            <InputRow label="Start Angle" unit="deg" value={config.engine.combustion.start_angle} onChange={(v: any) => updateConfig("engine", "combustion.start_angle", v)} />
                        </div>
                    </>
                )}

                {type === "header" && (
                    <>
                        <SectionHeader title="Header Primary" id={getPredictedID(selection)} />
                        <InputRow label="Primary Length" unit="mm" value={config.exhaust.headers.primary_length} onChange={(v: any) => updateConfig("exhaust", "headers.primary_length", v)} />
                        <InputRow label="Diameter" unit="mm" value={config.exhaust.headers.primary_diameter} onChange={(v: any) => updateConfig("exhaust", "headers.primary_diameter", v)} />
                        <InputRow label="Primary Exit Dia" unit="mm" value={config.exhaust.headers.primary_end_diameter ?? ""} onChange={(v: any) => updateConfig("exhaust", "headers.primary_end_diameter", v === "" || v == null ? null : v)} />
                        <div className="text-[10px] text-neutral-600 mb-2">一次管出口の内径。空欄 = 集合部径へテーパ(レガシー)。実車は φ37.6 のまま(テーパ無し; Stage 71 実測)。</div>
                        <InputRow label="Header Friction" unit="-" value={config.exhaust.headers.header_friction ?? 0.02} onChange={(v: any) => updateConfig("exhaust", "headers.header_friction", v)} />
                        <InputRow label="Wall Temp" unit="K" value={config.exhaust.headers.wall_temp ?? 800} onChange={(v: any) => updateConfig("exhaust", "headers.wall_temp", v)} />
                    </>
                )}

                {type === "collector" && (
                    <>
                        <SectionHeader title="Collector (Merge)" id={getPredictedID(selection)} />
                        <InputRow label="Collector Vol" unit="L" value={config.exhaust.headers.collector_vol} onChange={(v: any) => updateConfig("exhaust", "headers.collector_vol", v)} />
                        <InputRow label="Outlet Dia" unit="mm" value={config.exhaust.headers.collector_dia} onChange={(v: any) => updateConfig("exhaust", "headers.collector_dia", v)} />
                        <InputRow label="Collector Length" unit="mm" value={config.exhaust.headers.collector_length ?? 500} onChange={(v: any) => updateConfig("exhaust", "headers.collector_length", v)} />
                        <div className="text-[10px] text-neutral-600 mb-2">集合部本体(Col_Out 管)の長さ。実車 90mm(Stage 71 実測; 旧ハードコード 500mm)。</div>
                        <div className="mt-3 pt-3 border-t border-neutral-800">
                            <h4 className="text-xs font-bold text-neutral-500 mb-2">EXHAUST PORT JUNCTION</h4>
                            <InputRow label="Port Junction Vol" unit="cc" value={config.exhaust.port_junction_vol ?? 0.0} onChange={(v: any) => updateConfig("exhaust", "port_junction_vol", v)} />
                            <InputRow label="Ex-Port Mesh" unit="m" value={config.exhaust.exhaust_port_mesh ?? 0.010} onChange={(v: any) => updateConfig("exhaust", "exhaust_port_mesh", v)} />
                            <div className="text-[10px] text-neutral-600">≤0 = plenumless Type-12 (validated); &gt;0 = small plenum/cyl</div>
                        </div>
                    </>
                )}

                {(type === "section1" || type === "section2" || type === "muffler") && (
                    <>
                        <SectionHeader
                            title={
                                selection.type === "section1" ? `Section 1 (${selection.index === 1 ? "Bank 2" : "Bank 1"})` :
                                    type === "section2" ? "Section 2 (Mid)" :
                                        "Muffler"
                            }
                            id={getPredictedID(selection)}
                        />

                        {type === "section1" && (() => {
                            const bankKey = selection.type === "section1" && selection.index === 1 ? "section1_2" : "section1_1";
                            const secConfig = config.exhaust[bankKey as "section1_1" | "section1_2"];

                            return (
                                <div className="flex flex-col gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Layout</label>
                                        <select
                                            value={secConfig.layout}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                // Sync both banks
                                                setConfig(prev => ({
                                                    ...prev,
                                                    exhaust: {
                                                        ...prev.exhaust,
                                                        section1_1: { ...prev.exhaust.section1_1, layout: val },
                                                        section1_2: { ...prev.exhaust.section1_2, layout: val }
                                                    }
                                                }));
                                            }}
                                            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none"
                                        >
                                            <option value="Independent">Independent</option>
                                            <option value="X-Pipe">X-Pipe</option>
                                        </select>
                                    </div>
                                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded">
                                        <h4 className="text-xs font-bold text-neutral-400 mb-2 flex items-center gap-2">
                                            CATALYST
                                            <input type="checkbox" checked={config.exhaust.catalyst.installed} onChange={(e) => updateConfig("exhaust", "catalyst.installed", e.target.checked)} />
                                        </h4>
                                        {config.exhaust.catalyst.installed && (
                                            <div className="flex flex-col gap-2">
                                                <div className="flex flex-col">
                                                    <label className="text-[10px] text-neutral-500">LOCATION</label>
                                                    <select value={config.exhaust.catalyst.location} onChange={(e) => updateConfig("exhaust", "catalyst.location", e.target.value)} className="bg-neutral-950 border border-neutral-700 text-xs p-1 rounded">
                                                        <option value="header_collector">Post-Collector (Front)</option>
                                                        <option value="section1_end">Post-Section 1 (Rear)</option>
                                                    </select>
                                                </div>
                                                <InputRow label="Cell Density (CPSI)" unit="cpsi" value={config.exhaust.catalyst.cpsi} onChange={(v: any) => updateConfig("exhaust", "catalyst.cpsi", v)} />
                                                <InputRow label="Length" unit="mm" value={config.exhaust.catalyst.length} onChange={(v: any) => updateConfig("exhaust", "catalyst.length", v)} />
                                                <InputRow label="Diameter" unit="mm" value={config.exhaust.catalyst.diameter} onChange={(v: any) => updateConfig("exhaust", "catalyst.diameter", v)} />
                                                <div className="text-[10px] text-neutral-600">実車触媒 180×φ105.6(Stage 71 実測、壁厚 1.2mm 換算)。</div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded">
                                        <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">CROSSOVER → CAT (両バンク共通)</h4>
                                        <InputRow label="Straight Run" unit="mm" value={config.exhaust.section1_1.cross_to_cat ?? 0} onChange={(v: any) => updateConfig("exhaust", "section1_1.cross_to_cat", v)} />
                                        <InputRow label="Cat Inlet Taper" unit="mm" value={config.exhaust.section1_1.cat_taper_length ?? 0} onChange={(v: any) => updateConfig("exhaust", "section1_1.cat_taper_length", v)} />
                                        <div className="text-[10px] text-neutral-600">クロス管 → 直管 → テーパ → 触媒(実車: 440 + 120mm; Stage 71 実測)。0 = レガシー(クロス直後に触媒)。</div>
                                    </div>

                                    {(secConfig.layout === "X-Pipe" || secConfig.layout === "H-Pipe") ? (
                                        <>
                                            <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-4">
                                                <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">FRONT SEGMENT (PRE-CROSSOVER)</h4>
                                                <InputRow label="Length" unit="mm" value={secConfig.crossover_offset} onChange={(v: any) => {
                                                    const front = Number(v);
                                                    const rear = secConfig.length - secConfig.crossover_offset;
                                                    updateConfig("exhaust", `${bankKey}.crossover_offset`, front);
                                                    // cat_offset is the field the deck generator actually
                                                    // reads for the collector->crossover leg (Stage 71
                                                    // per-bank wiring); crossover_offset is SVG-only.
                                                    updateConfig("exhaust", `${bankKey}.cat_offset`, front);
                                                    updateConfig("exhaust", `${bankKey}.length`, front + rear);
                                                }} />
                                                <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                            </div>
                                            <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-2">
                                                <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">REAR SEGMENT (POST-CROSSOVER)</h4>
                                                <InputRow label="Length" unit="mm" value={secConfig.length - secConfig.crossover_offset} onChange={(v: any) => {
                                                    const rear = Number(v);
                                                    const front = secConfig.crossover_offset;
                                                    updateConfig("exhaust", `${bankKey}.length`, front + rear);
                                                }} />
                                                <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                                <div className="text-[10px] text-neutral-600 mt-2">*Diameter is shared</div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-4">
                                            <InputRow label="Total Length" unit="mm" value={secConfig.length} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.length`, v)} />
                                            <InputRow label="Diameter" unit="mm" value={secConfig.diameter} onChange={(v: any) => updateConfig("exhaust", `${bankKey}.diameter`, v)} />
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {type === "section2" && (
                            <div className="flex flex-col gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Layout</label>
                                    <select value={config.exhaust.section2.layout} onChange={(e) => updateConfig("exhaust", "section2.layout", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                        <option value="Independent">Independent (Dual)</option>
                                        <option value="H-Pipe">H-Pipe</option>
                                        <option value="Single">Single Pipe</option>
                                    </select>
                                </div>
                                <InputRow label="Diameter" unit="mm" value={config.exhaust.section2.diameter} onChange={(v: any) => updateConfig("exhaust", "section2.diameter", v)} />
                                <InputRow label="Total Length" unit="mm" value={config.exhaust.section2.length} onChange={(v: any) => updateConfig("exhaust", "section2.length", v)} />
                                {config.exhaust.section2.layout === "H-Pipe" && (
                                    <>
                                        <InputRow label="Cat Exit → H" unit="mm" value={config.exhaust.section2.h_offset ?? 400} onChange={(v: any) => updateConfig("exhaust", "section2.h_offset", v)} />
                                        <div className="text-[10px] text-neutral-600">H 管の位置。実車は触媒直後 80mm(Stage 72 純正図面; 旧ハードコード 400)。1600rpm セルに ±40pp 級の感度(Stage 73 除去分離)。</div>
                                    </>
                                )}

                                <div className="p-3 bg-neutral-900 border border-neutral-800 rounded mt-2">
                                    <h4 className="text-xs font-bold text-neutral-400 mb-2 flex items-center gap-2">
                                        RESONATOR
                                        {/* The deck generator gates the resonator on resonator_length>0
                                            (resonator_fitted alone changed NOTHING — the old UI silently
                                            shipped a 300mm resonator with the box unchecked). The checkbox
                                            now drives the length so UI and deck can never disagree. */}
                                        <input type="checkbox" checked={(config.exhaust.section2.resonator_length ?? 0) > 0} onChange={(e) => {
                                            updateConfig("exhaust", "section2.resonator_fitted", e.target.checked);
                                            updateConfig("exhaust", "section2.resonator_length", e.target.checked ? 300 : 0);
                                        }} />
                                    </h4>
                                    {(config.exhaust.section2.resonator_length ?? 0) > 0 && (
                                        <div className="flex flex-col gap-2 mt-2">
                                            {config.exhaust.section2.layout === "H-Pipe" && (
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[10px] text-neutral-500">LOCATION (vs H-PIPE)</label>
                                                    <select value={config.exhaust.section2.resonator_location} onChange={(e) => updateConfig("exhaust", "section2.resonator_location", e.target.value)} className="bg-neutral-950 border border-neutral-700 text-xs p-1 rounded outline-none text-neutral-300">
                                                        <option value="before_h">Before H-Pipe (Front)</option>
                                                        <option value="after_h">After H-Pipe (Rear)</option>
                                                    </select>
                                                </div>
                                            )}
                                            <InputRow label="Length" unit="mm" value={config.exhaust.section2.resonator_length} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_length", v)} />
                                            <InputRow label="Diameter" unit="mm" value={config.exhaust.section2.resonator_diameter || 90} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_diameter", v)} />
                                            <InputRow label="H → Resonator" unit="mm" value={config.exhaust.section2.resonator_offset ?? 400} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_offset", v)} />
                                            <InputRow label="Lining Friction" unit="-" value={config.exhaust.section2.resonator_friction ?? 0.1} onChange={(v: any) => updateConfig("exhaust", "section2.resonator_friction", v)} />
                                            <div className="text-[10px] text-neutral-600">貫通吸音レゾネーター(実車 φ90×300 @ H後 800mm; Stage 72 純正図面)。</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {type === "muffler" && (
                            <>
                                <InputRow label="Muffler Vol" unit="L" value={config.exhaust.section3.volume} onChange={(v: any) => updateConfig("exhaust", "section3.volume", v)} />
                                <div className="text-[10px] text-neutral-600 mb-2">実車外形 1000×300×160mm ≈ 48L(オーナー実測; 内容積 ~46L)。生成側は 30L を下限に持ち上げる点に注意。</div>
                                <InputRow label="Tailpipe Length" unit="mm" value={config.exhaust.section3.tailpipe_length} onChange={(v: any) => updateConfig("exhaust", "section3.tailpipe_length", v)} />
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Internal Model</label>
                                    <select value={config.exhaust.section3.internal_model ?? "single"} onChange={(e) => updateConfig("exhaust", "section3.internal_model", e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 outline-none">
                                        <option value="single">Single volume (legacy)</option>
                                        <option value="chambers">Multi-pass chambers (実車)</option>
                                    </select>
                                    <div className="text-[10px] text-neutral-600 mt-1">chambers = 前室 → 180°/360° 通し管 → 後室 → テール(Stage 72 オーナー図面)。中域 5300/6300 に ±20-30pp 級の感度。</div>
                                </div>
                                {config.exhaust.section3.internal_model === "chambers" && (
                                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded">
                                        <h4 className="text-[10px] font-bold text-neutral-500 mb-2 border-b border-neutral-800 pb-1">MULTI-PASS INTERNALS</h4>
                                        <InputRow label="Front Chamber Frac" unit="-" value={config.exhaust.section3.chamber_split ?? 0.6} onChange={(v: any) => updateConfig("exhaust", "section3.chamber_split", v)} />
                                        <InputRow label="Pass 1 Length (180°)" unit="mm" value={config.exhaust.section3.pass1_length ?? 1130} onChange={(v: any) => updateConfig("exhaust", "section3.pass1_length", v)} />
                                        <InputRow label="Pass 2 Length (360°)" unit="mm" value={config.exhaust.section3.pass2_length ?? 1930} onChange={(v: any) => updateConfig("exhaust", "section3.pass2_length", v)} />
                                        <InputRow label="Pass Bore" unit="mm" value={config.exhaust.section3.pass_diameter ?? 65} onChange={(v: any) => updateConfig("exhaust", "section3.pass_diameter", v)} />
                                        <InputRow label="Funnel Entry Dia" unit="mm" value={config.exhaust.section3.pass_entry_diameter ?? 0} onChange={(v: any) => updateConfig("exhaust", "section3.pass_entry_diameter", v)} />
                                        <div className="text-[10px] text-neutral-600 mb-2">ファンネル状開口(DME 文書 p37)。0 = ストレート。φ90 プローブで 5300 +3.8 / 6300 +2.4。</div>
                                        <InputRow label="Pass Friction" unit="-" value={config.exhaust.section3.pass_friction ?? 0.02} onChange={(v: any) => updateConfig("exhaust", "section3.pass_friction", v)} />
                                        <div className="text-[10px] text-neutral-600">通し管長は 1000mm ケースへの再スケール値(1130/1930)。旧 1700/2900 は 6300 を発散させる(Stage 73)。</div>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="h-screen max-h-screen bg-neutral-950 text-neutral-300 font-sans flex flex-col overflow-hidden selection:bg-neutral-800">

            {/* 1. MINIMAL HEADER */}
            <div className="h-14 flex items-center justify-between px-6 bg-neutral-950 z-20 flex-shrink-0">
                <div className="flex items-center gap-6">
                    <div className="font-semibold text-neutral-100 tracking-tight">OpenWAM <span className="text-neutral-500 font-normal">CSL Simulator</span></div>

                    {/* Minimal Tabs */}
                    <div className="flex gap-1 bg-neutral-900 p-1 rounded-md">
                        <button
                            onClick={() => setMainTab("builder")}
                            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${mainTab === "builder" ? "bg-neutral-800 text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Builder
                        </button>
                        <button
                            onClick={() => setMainTab("simulation")}
                            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${mainTab === "simulation" ? "bg-neutral-800 text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Simulation
                        </button>
                        <button
                            onClick={() => setMainTab("live")}
                            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${mainTab === "live" ? "bg-neutral-800 text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-300"}`}
                        >
                            Live (DS2)
                        </button>
                    </div>
                </div>

                <div className="text-[10px] font-mono text-neutral-600">
                    STATUS: {loading || optimizing ? "RUNNING" : "IDLE"}
                </div>
            </div>

            {/* 2. CONTENT */}
            <div className="flex-1 relative overflow-hidden">

                {/* --- BUILDER MODE --- */}
                {mainTab === "builder" && (
                    <div className="flex flex-row h-full">
                        {/* Topology (wide, left, floating card — matches the param panel's spacing) */}
                        <div className="order-1 flex-1 min-w-0 my-6 ml-6 mr-6 relative">
                            <InteractiveTopology
                                config={config}
                                activeSelection={selection}
                                onSelect={setSelection}
                                simulationStatus={optimizing ? "running" : "idle"}
                            />
                        </div>
                        {/* Params (fixed width, right, floating card) */}
                        <div className="order-2 w-[340px] flex-shrink-0 my-6 mr-6 rounded-lg border border-neutral-800 bg-neutral-950/60 flex flex-col overflow-hidden">
                            {/* Global / Project Header */}
                            <div
                                onClick={() => setSelection({ type: "environment" })}
                                className={`px-4 py-3 border-b border-neutral-800 cursor-pointer flex items-center justify-between group transition-colors flex-shrink-0
                                    ${selection?.type === 'environment' ? 'bg-neutral-800/50' : 'hover:bg-neutral-800/30'}`}
                            >
                                <div>
                                    <div className="text-xs font-bold text-neutral-200">Global Settings</div>
                                    <div className="text-[10px] text-neutral-500 font-mono">Environment & Simulation</div>
                                </div>
                                <div className={`w-1.5 h-1.5 rounded-full ${selection?.type === 'environment' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-neutral-700 group-hover:bg-neutral-500'}`} />
                            </div>

                            {/* Scrollable Content */}
                            <div className="flex-1 overflow-y-scroll">
                                {renderSelectionParams()}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- SIMULATION MODE --- */}
                {mainTab === "simulation" && (
                    <div className="h-full flex flex-row">
                        {/* Main Result Area */}
                        <div className="flex-1 bg-neutral-950 p-6 flex flex-col gap-6">

                            {/* Result / Monitor Panel */}
                            <div className="flex-1 border border-neutral-800 rounded-lg bg-neutral-950/60 relative overflow-hidden flex flex-col">
                                <div className="h-10 border-b border-neutral-800 px-4 flex items-center justify-between">
                                    <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                                        <Activity size={14} /> Simulation Results
                                    </span>
                                    {!loading && resultView !== "tuning" && runData && (
                                        <ProvenanceStrip info={runData} meta={meta} loadedFromDisk={runFromDisk} />
                                    )}
                                    {!loading && resultView === "tuning" && tuneData && (
                                        <ProvenanceStrip info={tuneData} meta={meta} loadedFromDisk={tuneFromDisk} />
                                    )}
                                    {!loading && (runData || tuneData) && (
                                        <div className="flex gap-1">
                                            {([
                                                ...(runData ? [["summary", "Charts"], ["surface", "3D Surface"], ["waveform", "Waveform"]] : []),
                                                ...(tuneData ? [["tuning", "Tuning"]] : []),
                                            ] as [typeof resultView, string][]).map(([id, label]) => (
                                                <button
                                                    key={id}
                                                    onClick={() => setResultView(id)}
                                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                                                        resultView === id
                                                            ? "bg-neutral-100 text-black"
                                                            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 relative">
                                    {loading && (
                                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-4">
                                            <div className="w-6 h-6 border-2 border-neutral-700 border-t-neutral-100 rounded-full animate-spin"></div>
                                            <div className="text-neutral-500 text-sm font-mono">
                                                {progress
                                                    ? `Simulating cell ${progress.done}/${progress.total} (omp1)${progress.eta != null ? ` · ETA ~${progress.eta}s` : ""}...`
                                                    : "Simulating Physics Model..."}
                                            </div>
                                            {progress && progress.total > 0 && (
                                                <div className="w-64 h-1.5 bg-neutral-800 rounded overflow-hidden">
                                                    <div className="h-full bg-emerald-500 transition-all duration-300"
                                                         style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!loading && !runData && !tuneData && (
                                        <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 text-neutral-600 text-sm">
                                            {optimizing ? (
                                                <>
                                                    <div className="w-6 h-6 border-2 border-neutral-700 border-t-amber-500 rounded-full animate-spin" />
                                                    <div className="font-mono text-neutral-500 text-xs">
                                                        VANOS tuning in progress{tuneProgress ? ` — sim ${tuneProgress.done}/${tuneProgress.total}${tuneProgress.eta != null ? ` · ETA ~${tuneProgress.eta}s` : ""}` : "..."}
                                                    </div>
                                                </>
                                            ) : (
                                                <span>No simulation data. Run a simulation to view results.</span>
                                            )}
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "summary" && (
                                        <div className="absolute inset-0 overflow-auto p-4 flex flex-col gap-6 divide-y divide-neutral-800 animate-in fade-in duration-500">
                                            <ValidityPanel overall={runData.overall} rows={runData.rows} />
                                            <div className="h-72 flex-shrink-0 pt-6"><VeOverlayChart runData={runData} /></div>
                                            <div className="min-h-[340px] flex-shrink-0 pt-6">
                                                <VETableComparison calibrationResult={runToCalibration(runData, ecuBaseMap)} onBinUploaded={refreshBaseMap} />
                                            </div>
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "surface" && (
                                        <div className="absolute inset-0 p-3 animate-in fade-in duration-500">
                                            <VeSurfaceChart runData={runData} />
                                        </div>
                                    )}

                                    {!loading && runData && resultView === "waveform" && (
                                        <div className="absolute inset-0 p-3 animate-in fade-in duration-500">
                                            <VeWaveformChart config={runConfig ?? config} runData={runData} />
                                        </div>
                                    )}

                                    {!loading && tuneData && resultView === "tuning" && (
                                        <div className="absolute inset-0 overflow-auto p-4 animate-in fade-in duration-500">
                                            <TuningResults data={tuneData} />
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>

                        {/* Right: Sidebar Controls (floating card, matches the Builder param panel's width) */}
                        <div className="w-[340px] flex-shrink-0 my-6 mr-6 rounded-lg border border-neutral-800 bg-neutral-950/60 p-6 flex flex-col gap-8 z-10 overflow-y-auto">

                            {/* Actions */}
                            <div className="flex flex-col gap-4">
                                <div>
                                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Run Simulation</h3>
                                    <button
                                        onClick={() => handleRun("wot_quick")}
                                        disabled={loading || optimizing}
                                        className="w-full py-3 bg-neutral-100 hover:bg-white text-black font-semibold rounded text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Play size={16} fill="black" /> Run WOT Quick (20)
                                    </button>
                                    <button
                                        onClick={() => handleRun("full_map")}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-2 border border-neutral-700 hover:bg-neutral-800 text-neutral-300 rounded text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        title="480 cells at omp1 — this is SLOW (tens of minutes to hours cold; cached cells are instant on re-run)"
                                    >
                                        Run Full Map (480) · slow
                                    </button>
                                    <button
                                        onClick={() => handleLoadLast("full_map")}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-1.5 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 rounded text-[11px] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        title="Reload the last completed Full Map from the server (no re-run) — recovers a run whose fetch died"
                                    >
                                        <History size={12} /> Load last Full Map
                                    </button>
                                    {(loading || optimizing) && (
                                        <button
                                            onClick={handleCancel}
                                            className="mt-2 w-full py-1.5 border border-red-900/60 text-red-400 hover:bg-red-950/40 rounded text-[11px] font-semibold transition-all flex items-center justify-center gap-2"
                                            title="Stop every in-flight sim now (solver processes are killed). Finished cells stay cached — re-running the same request resumes."
                                        >
                                            <Square size={11} /> Cancel run
                                        </button>
                                    )}
                                </div>

                                <div className="pt-4 border-t border-neutral-800">
                                    <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Tuning <span className="text-neutral-600 normal-case">(VANOS · WOT)</span></h3>
                                    {/* preference (§6.C): user picks the goal, the objective stays internal */}
                                    <div className="flex gap-1 bg-neutral-900 p-1 rounded-md mb-2">
                                        {([["max_ve", "Max VE"], ["smooth", "Smooth"]] as const).map(([id, label]) => (
                                            <button
                                                key={id}
                                                onClick={() => setTunePref(id)}
                                                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                                                    tunePref === id
                                                        ? "bg-neutral-700 text-neutral-100"
                                                        : "text-neutral-500 hover:text-neutral-300"
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={handleRunTuning}
                                        disabled={loading || optimizing}
                                        className="w-full py-2 border border-neutral-700 hover:bg-neutral-800 text-neutral-200 rounded text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        title="Per-rpm VANOS cam search on the deterministic omp1 surface. SLOW cold (up to ~1h for all 20 rpm); cached evaluations resume instantly."
                                    >
                                        <Wrench size={13} /> {optimizing ? "Tuning..." : "Run VANOS Tuning"}
                                    </button>
                                    {optimizing && tuneProgress && (
                                        <div className="mt-2">
                                            <div className="text-[10px] font-mono text-neutral-500 mb-1">
                                                sim {tuneProgress.done}/{tuneProgress.total}{tuneProgress.eta != null ? ` · ETA ~${tuneProgress.eta}s` : ""}
                                            </div>
                                            <div className="w-full h-1 bg-neutral-800 rounded overflow-hidden">
                                                <div className="h-full bg-amber-500 transition-all duration-300"
                                                     style={{ width: `${Math.min(100, (tuneProgress.done / Math.max(1, tuneProgress.total)) * 100)}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleLoadLastTuning}
                                        disabled={loading || optimizing}
                                        className="mt-2 w-full py-1.5 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 rounded text-[11px] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        title="Reload the last completed tuning from the server (no re-run)"
                                    >
                                        <History size={12} /> Load last tuning
                                    </button>
                                    {(!runData || runData.overall.status === "red") && (
                                        <div className="text-[10px] text-amber-500/80 mt-2 leading-tight">
                                            {runData
                                                ? "Model is Not valid (§5) — tuning proposals are LOW-CONFIDENCE until the geometry calibration lands (§10)."
                                                : "No validity data yet — run a simulation first (§5); proposals are low-confidence."}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Config Actions */}
                            <div className="mt-auto">
                                <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Configuration</h3>

                                {/* Vehicle preset (Stage 74): the v14 owner-car twin vs the Stage-69 neutral baseline */}
                                <div className="mb-2">
                                    <div className="text-[10px] text-neutral-600 mb-1">プリセット</div>
                                    <div className="flex gap-1">
                                        <button onClick={() => applyPreset("v14")}
                                            className={`flex-1 py-1.5 rounded text-[11px] border ${activePreset === "v14" ? "border-emerald-700 text-emerald-400 bg-emerald-950/40" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}
                                            title="Stage 74 実測デジタルツイン(実測吸排気寸法・マフラー内部構造・ヘッド戻り管)">
                                            v14 オーナー実車
                                        </button>
                                        <button onClick={() => applyPreset("legacy")}
                                            className={`flex-1 py-1.5 rounded text-[11px] border ${activePreset === "legacy" ? "border-emerald-700 text-emerald-400 bg-emerald-950/40" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}
                                            title="Stage 69 モデル既定値(バックエンド models.py と同一)">
                                            レガシー中立
                                        </button>
                                    </div>
                                </div>

                                <div className="flex gap-2 text-neutral-400">
                                    <input type="file" accept=".json,application/json" ref={configFileRef}
                                        className="hidden" onChange={handleConfigFile} />
                                    <button onClick={handleConfigLoad} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Load config JSON (project)">
                                        <Upload size={14} />
                                    </button>
                                    <button onClick={handleConfigSave} className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center" title="Save config JSON (project)">
                                        <Save size={14} />
                                    </button>
                                </div>

                                {/* Real-engine measurement sheet (Excel) */}
                                <input type="file" accept=".xlsx" ref={sheetFileRef}
                                    className="hidden" onChange={handleSheetFile} />
                                <div className="flex gap-2 mt-2">
                                    <button onClick={handleSheetDownload}
                                        className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center gap-1.5 text-[11px] text-neutral-300"
                                        title="実測できるパラメータの記入シート (Excel) をダウンロード">
                                        <FileSpreadsheet size={14} /> 計測シート
                                    </button>
                                    <button onClick={() => sheetFileRef.current?.click()}
                                        className="flex-1 py-2 border border-neutral-800 hover:border-neutral-600 rounded flex items-center justify-center gap-1.5 text-[11px] text-neutral-300"
                                        title="記入済みの計測シート (Excel) を取り込み、パラメータへ反映">
                                        <Upload size={14} /> シート取込
                                    </button>
                                </div>
                                <p className="text-[10px] text-neutral-600 mt-1.5 leading-tight">
                                    実測寸法を Excel に記入 → 取込で反映（空欄は現状維持）
                                </p>
                            </div>

                            {/* Logs */}
                            <div className="mt-4 border-t border-neutral-800 pt-4">
                                <div className="h-24 font-mono text-[10px] text-neutral-600 overflow-y-auto">
                                    <div>[SYSTEM] Ready</div>
                                    {loading && progress && <div>[RUN] cell {progress.done}/{progress.total}</div>}
                                    {runData && <div className="text-emerald-500">[DONE] {runData.overall.verdict} ({runData.elapsed_sec}s)</div>}
                                    {notice && <div className="text-amber-400">[INFO] {notice}</div>}
                                    {error && <div className="text-red-500 font-bold">[ERROR] {error}</div>}
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                {/* --- LIVE (DS2) MODE (Stage 76) --- */}
                {mainTab === "live" && (
                    <div className="h-full p-6">
                        <LiveTelemetry />
                    </div>
                )}
            </div>
        </div>
    );
};

export default VehicleBuilder;

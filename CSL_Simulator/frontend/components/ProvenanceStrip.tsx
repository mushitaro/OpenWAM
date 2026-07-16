"use client";

import React from "react";
import { MetaResponse } from "../app/api";

// Stage 74: compact provenance strip shown above every result view.
// Flags STALE when a (possibly disk-loaded) result was produced under an
// older solver binary or the pre-ECU-unit schema (v1 results are a uniform
// x1.0573 LOW vs the current %rf scale and used the old WOT ignition).
export interface ProvenanceInfo {
    run_id?: string;
    sim_binary_sig?: string;
    schema_version?: number;
    created_at?: string;
    unit?: string;
    m_ref_mg?: number;
    calib?: { alpha: number; w: number };
}

const ProvenanceStrip: React.FC<{
    info: ProvenanceInfo | null;
    meta: MetaResponse | null;
    loadedFromDisk?: boolean;
}> = ({ info, meta, loadedFromDisk }) => {
    if (!info) return null;
    const schemaStale = (info.schema_version ?? 0) < 2 || info.unit === "ve_legacy";
    const sigStale = !!(meta?.sim_binary_sig && info.sim_binary_sig
        && info.sim_binary_sig !== meta.sim_binary_sig);
    const stale = schemaStale || sigStale;
    const unitLabel = info.unit === "rf_ecu" || (!info.unit && !schemaStale)
        ? `%rf (ECU basis${info.m_ref_mg ? `, m_ref ${info.m_ref_mg}mg` : ""})`
        : "VE% (旧単位)";
    const staleReason = schemaStale
        ? "旧世代の結果です(旧単位: 現行 %rf より一律 ×1.0573 低い / 旧 WOT 点火)。再実行してください。"
        : "この結果は現行と異なるソルバーバイナリで計算されています。再実行を推奨します。";
    return (
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-neutral-500 border border-neutral-800 rounded px-2 py-1 bg-neutral-950/60">
            {stale && (
                <span className="px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-bold tracking-wider"
                    title={staleReason}>
                    STALE(旧世代)
                </span>
            )}
            {loadedFromDisk && <span className="text-neutral-600">(saved run)</span>}
            {info.run_id && <span title="run id">{String(info.run_id).slice(0, 12)}</span>}
            {info.sim_binary_sig && (
                <span title="solver binary signature"
                    className={sigStale ? "text-amber-400" : undefined}>
                    bin:{String(info.sim_binary_sig).slice(0, 14)}
                </span>
            )}
            <span title="scoring unit" className={schemaStale ? "text-amber-400" : undefined}>
                unit:{unitLabel}
            </span>
            {info.calib && <span title="mouth-rad calibration">α{info.calib.alpha}/w{info.calib.w}</span>}
            {info.created_at && <span title="created (UTC)">{info.created_at.replace("T", " ").replace("+00:00", "Z")}</span>}
            <span title="result schema">v{info.schema_version ?? 1}</span>
        </div>
    );
};

export default ProvenanceStrip;

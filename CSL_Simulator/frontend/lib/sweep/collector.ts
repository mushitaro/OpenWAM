/**
 * Upload a sweep recording to the vanos-sweep-collector Worker.
 *
 * This is the ONLY sink reachable from the car. The FastAPI backend the Live
 * view normally saves to lives on localhost, which does not exist on a phone at
 * the side of a road — a recording that only ever reached it would be a
 * recording that never left the device.
 *
 * Best-effort by contract, like the tuner's uploadDiagnostic: it returns a
 * result and never throws, so a dead cell connection can never take down the
 * poll loop or lose what is already in memory.
 */
import { LiveSample } from '../dme-link/types';
import { DECODER_VERSION } from '../dme-link/liveValueBlocks';

const SETTINGS_KEY = 'csl.sweepCollector.v1';
/** The deployed collector. Overridable for a bench rig via localStorage. */
export const DEFAULT_COLLECTOR_URL = 'https://vanos-sweep-collector.kazuhiro-mushi.workers.dev';
/** The server caps a gzipped part at 900 KB (D1 caps a value at 1,000,000). */
const SOFT_LIMIT_BYTES = 900_000;
const TIMEOUT_MS = 30_000;

export interface CollectorSettings {
    baseUrl: string;
    token: string;
}

export const EMPTY_SETTINGS: CollectorSettings = { baseUrl: DEFAULT_COLLECTOR_URL, token: '' };

export function loadCollectorSettings(): CollectorSettings {
    if (typeof window === 'undefined') return EMPTY_SETTINGS;
    try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (!raw) return EMPTY_SETTINGS;
        const p = JSON.parse(raw) as Partial<CollectorSettings>;
        return {
            baseUrl: (p.baseUrl || DEFAULT_COLLECTOR_URL).replace(/\/+$/, ''),
            token: p.token ?? '',
        };
    } catch {
        return EMPTY_SETTINGS;
    }
}

export function saveCollectorSettings(s: CollectorSettings): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        baseUrl: s.baseUrl.replace(/\/+$/, ''), token: s.token,
    }));
}

export const canUpload = (s: CollectorSettings) => s.token.trim().length > 0 && s.baseUrl.length > 0;

async function gzipJson(value: unknown): Promise<Uint8Array> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Chunked, because String.fromCharCode(...bytes) throws RangeError above ~120k
 *  arguments — which a long sweep will absolutely reach. */
function toBase64(bytes: Uint8Array): string {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
}

/**
 * One uploaded row, in the canonical wire shape.
 *
 * Uploading raw LiveSample objects silently lost three things, all found by
 * fetching a real upload back and reading it:
 *   - `t` is SECONDS; the server's `t_ms` alias accepted it as milliseconds, so
 *     every timestamp came back 1000x too small and the visit gap (3 s) and the
 *     settle window (0.6 s) were both meaningless.
 *   - `tz` is an ARRAY; the CSV exporter looks for tz1..tz6, so per-cylinder
 *     ignition — the knock-monitoring channel — arrived empty.
 *   - throttle is called `throttle` here and `wdk1` on the wire, so the WOT
 *     gate's fallback arrived empty too.
 * Converting explicitly here beats teaching the server to guess.
 */
export interface SweepWireSample {
    t_ms: number;
    rpm: number;
    evan1_ist?: number; evan1_soll?: number;
    avan1_ist?: number; avan1_soll?: number;
    la_f_regler1?: number; la_f_regler2?: number;
    ml?: number; rf?: number; psau_local?: number;
    tz1?: number; tz2?: number; tz3?: number; tz4?: number; tz5?: number; tz6?: number;
    tabg?: number; pedal?: number; wdk1?: number;
    coolant?: number; toel?: number; ro?: number;
    cmd_intake?: number | 'base'; cmd_exhaust?: number | 'base';
}

const numOrUndef = (v: number | null | undefined): number | undefined =>
    (typeof v === 'number' && Number.isFinite(v)) ? v : undefined;

export function toWireSamples(samples: readonly LiveSample[]): SweepWireSample[] {
    return samples.map(s => {
        const tz = s.tz ?? [];
        return {
            t_ms: Math.round(s.t * 1000),          // seconds -> milliseconds, once, here
            rpm: s.rpm,
            evan1_ist: numOrUndef(s.evanIst), evan1_soll: numOrUndef(s.evanSoll),
            avan1_ist: numOrUndef(s.avanIst), avan1_soll: numOrUndef(s.avanSoll),
            la_f_regler1: numOrUndef(s.stft1), la_f_regler2: numOrUndef(s.stft2),
            ml: numOrUndef(s.ml), rf: numOrUndef(s.rf), psau_local: numOrUndef(s.map),
            tz1: numOrUndef(tz[0]), tz2: numOrUndef(tz[1]), tz3: numOrUndef(tz[2]),
            tz4: numOrUndef(tz[3]), tz5: numOrUndef(tz[4]), tz6: numOrUndef(tz[5]),
            tabg: numOrUndef(s.exhaustTemp),
            pedal: numOrUndef(s.pedal), wdk1: numOrUndef(s.throttle),
            coolant: numOrUndef(s.coolant), toel: numOrUndef(s.oil), ro: numOrUndef(s.ro),
            cmd_intake: s.cmdIntake ?? 'base',
            cmd_exhaust: s.cmdExhaust ?? 'base',
        };
    });
}

export type UploadResult =
    | { ok: true; id: string; nSamples: number; bytes: number }
    | { ok: false; message: string; retryable: boolean };

export interface SweepUploadMeta {
    id: string;
    label?: string;
    vin?: string;
    achievedHz?: number;
    settings?: unknown;
    appBuild?: string;
}

/**
 * Upload one recording. `id` is client-minted and the server upserts on it, so
 * re-uploading the same recording overwrites rather than duplicating — which is
 * what makes a retry safe and a mid-drive checkpoint possible.
 */
export async function uploadSweep(
    samples: readonly LiveSample[],
    meta: SweepUploadMeta,
    settings: CollectorSettings,
): Promise<UploadResult> {
    if (!canUpload(settings)) {
        return { ok: false, retryable: false, message: 'アップロード先のトークンが未設定です。' };
    }
    if (!samples.length) {
        return { ok: false, retryable: false, message: '送信するサンプルがありません。' };
    }
    let gz: Uint8Array;
    try {
        gz = await gzipJson(toWireSamples(samples));
    } catch (e) {
        return { ok: false, retryable: false, message: `圧縮に失敗しました: ${String(e)}` };
    }
    if (gz.byteLength > SOFT_LIMIT_BYTES) {
        return {
            ok: false, retryable: false,
            message: `圧縮後 ${(gz.byteLength / 1024).toFixed(0)} KB で上限 `
                + `${(SOFT_LIMIT_BYTES / 1024).toFixed(0)} KB を超えています。記録を分割してください。`,
        };
    }

    const body = {
        id: meta.id,
        client_time: new Date().toISOString(),
        label: meta.label ?? null,
        vin: meta.vin ?? null,
        decoder_version: DECODER_VERSION,
        achieved_hz: meta.achievedHz ?? null,
        n_settings: Array.isArray(meta.settings) ? meta.settings.length : null,
        settings: meta.settings ?? null,
        app_build: meta.appBuild ?? null,
        samples_gz_b64: toBase64(gz),
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${settings.baseUrl}/sweeps`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.token}` },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            // Surface the server's own message: its 413 knows the actual sizes,
            // which is the difference between "too big" and "split the run".
            const detail = await res.json().catch(() => null) as { error?: string } | null;
            return {
                ok: false,
                // 4xx is the server declining this payload; retrying it unchanged
                // cannot help. 5xx and network faults can.
                retryable: res.status >= 500,
                message: detail?.error ?? `アップロードに失敗しました (HTTP ${res.status})`,
            };
        }
        const out = await res.json() as { id: string; n_samples: number };
        return { ok: true, id: out.id, nSamples: out.n_samples, bytes: gz.byteLength };
    } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        return {
            ok: false, retryable: true,
            message: aborted
                ? 'アップロードがタイムアウトしました。電波の良い場所で再送してください。'
                : `アップロードに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        };
    } finally {
        clearTimeout(timer);
    }
}

/** Newest recordings on the server, so the panel can show what actually landed. */
export async function listSweeps(settings: CollectorSettings): Promise<
    { ok: true; sweeps: Array<Record<string, unknown>> } | { ok: false; message: string }> {
    if (!canUpload(settings)) return { ok: false, message: 'トークンが未設定です。' };
    try {
        const res = await fetch(`${settings.baseUrl}/sweeps?limit=20`, {
            headers: { authorization: `Bearer ${settings.token}` },
        });
        if (!res.ok) {
            const d = await res.json().catch(() => null) as { error?: string } | null;
            return { ok: false, message: d?.error ?? `HTTP ${res.status}` };
        }
        const j = await res.json() as { sweeps: Array<Record<string, unknown>> };
        return { ok: true, sweeps: j.sweeps ?? [] };
    } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
}

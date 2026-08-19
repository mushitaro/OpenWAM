/**
 * vanos-sweep-collector — standalone Cloudflare Worker + D1 for Stage-121
 * live-VANOS-sweep datalogs (E46 M3 CSL, MSS54HP '0401').
 *
 * Deliberately SEPARATE from the tuner deployment and its D1 (owner directive):
 * own Worker, own database (`vanos-sweeps`), own UPLOAD_TOKEN.
 *
 * Routes (all Bearer-token gated, fail-closed):
 *   POST   /sweeps            ingest one sweep recording (idempotent upsert on id)
 *   GET    /sweeps            list recordings (newest first, ?limit=N)
 *   GET    /sweeps/:id        one recording; ?format=csv returns the wide CSV
 *                             that CSL_Simulator/backend/scripts/analyze_vanos_sweep.py reads
 *   DELETE /sweeps/:id        remove a recording
 *   OPTIONS *                 CORS preflight
 */
export interface Env {
  DB: D1Database;
  UPLOAD_TOKEN?: string;
}

// ---------------------------------------------------------------------------
// helpers (self-contained port of the tuner's _shared.ts patterns)
// ---------------------------------------------------------------------------
// D1 caps a single bound value at 1,000,000 bytes. A payload above that is
// rejected deep in the D1 layer with an opaque error AFTER we have already
// accepted, inflated and parsed it -- so cap below the limit and say so in a
// 413 the driver can act on. (Same value the tuner's _shared.ts settled on.)
const MAX_GZ_BYTES = 900_000;

function corsHeaders(): Record<string, string> {
  // Bearer auth (no cookies), so a wildcard origin is safe and lets the logger
  // page POST from any host the owner serves it from.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function bad(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** Length-independent constant-time comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i % Math.max(ab.length, 1)] ?? 0) ^ (bb[i % Math.max(bb.length, 1)] ?? 0);
  }
  return diff === 0;
}

/** Fails CLOSED: no configured token -> 503, wrong token -> 401, ok -> null. */
function requireToken(request: Request, env: Env): Response | null {
  if (!env.UPLOAD_TOKEN) {
    return bad("This deployment has no UPLOAD_TOKEN configured.", 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token || !constantTimeEqual(token, env.UPLOAD_TOKEN)) {
    return bad("Unauthorized.", 401);
  }
  return null;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as unknown as ArrayBufferView]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

/** D1 returns BLOBs as ArrayBuffer or number[] depending on path; normalize. */
function blobToBytes(v: unknown): Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Uint8Array(v as number[]);
  if (v instanceof Uint8Array) return v;
  return new Uint8Array(0);
}

// ---------------------------------------------------------------------------
// CSV export — the wide format analyze_vanos_sweep.py reads (aliases included)
// ---------------------------------------------------------------------------
const CSV_COLUMNS = [
  "t_ms", "rpm",
  "evan1_ist", "evan1_soll", "avan1_ist", "avan1_soll",
  "la_f_regler1", "la_f_regler2",
  "ml", "rf", "psau_local",
  "tz1", "tz2", "tz3", "tz4", "tz5", "tz6",
  "tabg", "pedal", "wdk1",
  "cmd_intake", "cmd_exhaust",
] as const;

/** Per-column accepted aliases in the uploaded sample objects. */
const SAMPLE_ALIASES: Record<string, string[]> = {
  t_ms: ["t_ms", "time_ms", "t", "time", "elapsedMilliseconds"],
  rpm: ["rpm", "n"],
  evan1_ist: ["evan1_ist", "evanIst"],
  evan1_soll: ["evan1_soll", "evanSoll"],
  avan1_ist: ["avan1_ist", "avanIst"],
  avan1_soll: ["avan1_soll", "avanSoll"],
  la_f_regler1: ["la_f_regler1", "stft1", "la1"],
  la_f_regler2: ["la_f_regler2", "stft2", "la2"],
  ml: ["ml"],
  rf: ["rf"],
  psau_local: ["psau_local", "map", "psauLocal"],
  tz1: ["tz1"], tz2: ["tz2"], tz3: ["tz3"], tz4: ["tz4"], tz5: ["tz5"], tz6: ["tz6"],
  tabg: ["tabg", "exhaustTemp"],
  pedal: ["pedal", "pwg"],
  wdk1: ["wdk1"],
  cmd_intake: ["cmd_intake", "cmdIntake"],
  cmd_exhaust: ["cmd_exhaust", "cmdExhaust"],
};

function sampleValue(sample: Record<string, unknown>, canon: string): unknown {
  for (const k of SAMPLE_ALIASES[canon] ?? [canon]) {
    if (k in sample && sample[k] !== null && sample[k] !== undefined) return sample[k];
  }
  return "";
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function samplesToCsv(samples: Array<Record<string, unknown>>): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const s of samples) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(sampleValue(s, c))).join(","));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// ingest body
// ---------------------------------------------------------------------------
interface IngestBody {
  id: string;
  created_at?: number;       // ms epoch (client)
  client_time?: string;
  label?: string;
  vin?: string;
  decoder_version?: number;
  achieved_hz?: number;
  sigma_pct?: number;
  n_settings?: number;
  settings?: unknown;        // settings table / notes -> meta
  meta?: unknown;            // free-form extras -> meta
  app_build?: string;
  samples_gz_b64: string;    // gzip(JSON array of sample objects), base64
}

async function gzipText(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([text]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  let body: IngestBody;
  try {
    body = await request.json<IngestBody>();
  } catch {
    return bad("Body is not JSON.");
  }
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    return bad("Missing id.");
  }
  if (typeof body.samples_gz_b64 !== "string" || !body.samples_gz_b64) {
    return bad("Missing samples_gz_b64.");
  }
  let gz: Uint8Array;
  try {
    gz = decodeBase64(body.samples_gz_b64);
  } catch {
    return bad("samples_gz_b64 is not valid base64.");
  }
  if (!isGzip(gz)) return bad("samples_gz_b64 is not gzip data.");
  if (gz.length > MAX_GZ_BYTES) {
    // Name the actual numbers: "too large" alone leaves the driver guessing
    // whether to shorten the run, drop a block, or stop trying.
    return bad(
      `samples_gz_b64 is ${(gz.length / 1024).toFixed(0)} KB compressed; the limit is `
      + `${(MAX_GZ_BYTES / 1024).toFixed(0)} KB. Split the sweep into shorter runs.`,
      413);
  }

  // Validate the payload actually parses, and derive summary columns server-side
  // so the list view never lies about its blob.
  let samples: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(await gunzipToText(gz));
    if (!Array.isArray(parsed)) return bad("samples payload is not a JSON array.");
    samples = parsed as Array<Record<string, unknown>>;
  } catch {
    return bad("samples payload is not valid gzipped JSON.");
  }
  const rpms: number[] = [];
  for (const s of samples) {
    const r = Number(sampleValue(s, "rpm"));
    if (Number.isFinite(r) && r > 0) rpms.push(r);
  }
  const nSamples = samples.length;
  const rpmMin = rpms.length ? Math.round(Math.min(...rpms)) : null;
  const rpmMax = rpms.length ? Math.round(Math.max(...rpms)) : null;

  let metaGz: Uint8Array | null = null;
  if (body.settings !== undefined || body.meta !== undefined) {
    metaGz = await gzipText(JSON.stringify({ settings: body.settings ?? null, meta: body.meta ?? null }));
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO vanos_sweeps
       (id, created_at, synced_at, client_time, label, vin, decoder_version,
        achieved_hz, sigma_pct, n_samples, n_settings, rpm_min, rpm_max,
        app_build, meta_json_gz, samples_json_gz)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
     ON CONFLICT(id) DO UPDATE SET
       created_at=excluded.created_at, synced_at=excluded.synced_at,
       client_time=excluded.client_time, label=excluded.label, vin=excluded.vin,
       decoder_version=excluded.decoder_version, achieved_hz=excluded.achieved_hz,
       sigma_pct=excluded.sigma_pct, n_samples=excluded.n_samples,
       n_settings=excluded.n_settings, rpm_min=excluded.rpm_min,
       rpm_max=excluded.rpm_max, app_build=excluded.app_build,
       meta_json_gz=excluded.meta_json_gz, samples_json_gz=excluded.samples_json_gz`
  ).bind(
    body.id.trim(),
    body.created_at ?? now,
    now,
    body.client_time ?? null,
    body.label ?? null,
    body.vin ?? null,
    body.decoder_version ?? null,
    body.achieved_hz ?? null,
    body.sigma_pct ?? null,
    nSamples,
    body.n_settings ?? null,
    rpmMin,
    rpmMax,
    body.app_build ?? null,
    metaGz ? (metaGz.buffer as ArrayBuffer) : null,
    gz.buffer as ArrayBuffer,
  ).run();

  return json({ ok: true, id: body.id.trim(), n_samples: nSamples, rpm_min: rpmMin, rpm_max: rpmMax });
}

// ---------------------------------------------------------------------------
// list / fetch / delete
// ---------------------------------------------------------------------------
const LIST_COLS =
  "id, created_at, synced_at, client_time, label, vin, decoder_version, " +
  "achieved_hz, sigma_pct, n_samples, n_settings, rpm_min, rpm_max, app_build";
// The list must never inflate a blob to report its size: length() is computed
// by SQLite over the stored bytes.
const LIST_COLS_SIZED = LIST_COLS + ", length(samples_json_gz) AS samples_bytes";

async function handleList(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLS_SIZED} FROM vanos_sweeps ORDER BY created_at DESC LIMIT ?1`
  ).bind(limit).all();
  return json({ ok: true, sweeps: results });
}

async function handleGet(id: string, url: URL, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${LIST_COLS}, meta_json_gz, samples_json_gz FROM vanos_sweeps WHERE id = ?1`
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return bad("Not found.", 404);

  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const samplesGz = blobToBytes(row["samples_json_gz"]);

  if (format === "csv") {
    let samples: Array<Record<string, unknown>>;
    try {
      samples = JSON.parse(await gunzipToText(samplesGz));
    } catch {
      return bad("Stored samples blob is corrupt.", 500);
    }
    const csv = samplesToCsv(samples);
    const name = `sweep_${String(row["id"]).replace(/[^A-Za-z0-9_-]/g, "_")}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        ...corsHeaders(),
      },
    });
  }

  // JSON: metadata + samples inline (decoded), meta decoded too
  let samples: unknown = null;
  try {
    samples = JSON.parse(await gunzipToText(samplesGz));
  } catch {
    samples = null;
  }
  let meta: unknown = null;
  const metaGz = blobToBytes(row["meta_json_gz"]);
  if (metaGz.length) {
    try {
      meta = JSON.parse(await gunzipToText(metaGz));
    } catch {
      meta = null;
    }
  }
  const { meta_json_gz: _m, samples_json_gz: _s, ...summary } = row;
  return json({ ok: true, sweep: { ...summary, meta, samples } });
}

async function handleDelete(id: string, env: Env): Promise<Response> {
  const res = await env.DB.prepare(`DELETE FROM vanos_sweeps WHERE id = ?1`).bind(id).run();
  const changes = (res.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (!changes) return bad("Not found.", 404);
  return json({ ok: true, deleted: id });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return preflight();

    const denied = requireToken(request, env);
    if (denied) return denied;

    const m = url.pathname.match(/^\/sweeps(?:\/([^/]+))?\/?$/);
    if (!m) return bad("Not found.", 404);
    const id = m[1] ? decodeURIComponent(m[1]) : null;

    try {
      if (!id) {
        if (request.method === "POST") return await handleIngest(request, env);
        if (request.method === "GET") return await handleList(url, env);
        return bad("Method not allowed.", 405);
      }
      if (request.method === "GET") return await handleGet(id, url, env);
      if (request.method === "DELETE") return await handleDelete(id, env);
      return bad("Method not allowed.", 405);
    } catch (err) {
      return bad(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  },
} satisfies ExportedHandler<Env>;

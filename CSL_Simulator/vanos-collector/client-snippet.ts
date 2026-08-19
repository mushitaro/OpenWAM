/**
 * uploadSweep() — drop-in snippet for the tuner-side logger (owner integrates).
 *
 * The collector is a SEPARATE Cloudflare Worker + D1 from the tuner deployment;
 * point COLLECTOR_URL at it and use its own UPLOAD_TOKEN (not the tuner's).
 *
 * Call this from the sweep-recording finish hook with the recorded samples.
 * Each sample object should carry (aliases accepted server-side):
 *   t_ms, rpm, evan1_ist, evan1_soll, avan1_ist, avan1_soll,
 *   la_f_regler1, la_f_regler2, ml, rf, psau_local, tz1..tz6,
 *   tabg, pedal, wdk1, cmd_intake, cmd_exhaust   (cmd_* = "base" when no override)
 *
 * Best-effort like the tuner's uploadDiagnostic(): never throws, returns ok flag,
 * so a dead network on the road never loses the local recording.
 */

export interface SweepUploadSettings {
  collectorUrl: string; // e.g. "https://vanos-sweep-collector.<subdomain>.workers.dev"
  token: string;        // the collector's UPLOAD_TOKEN (NOT the tuner sync token)
}

export interface SweepRecord {
  id: string;                    // client-minted, stable across retries
  label?: string;
  vin?: string;
  decoderVersion?: number;
  achievedHz?: number;           // measured during the path-check step
  sigmaPct?: number;             // measured lambda limit-cycle sigma (steady holds)
  settings?: unknown;            // the cam-setting table for this session
  appBuild?: string;
  samples: Array<Record<string, unknown>>;
}

async function gzipJsonBase64(value: unknown): Promise<string> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(cs);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export async function uploadSweep(
  record: SweepRecord,
  settings: SweepUploadSettings,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = {
      id: record.id,
      created_at: Date.now(),
      client_time: new Date().toISOString(),
      label: record.label,
      vin: record.vin,
      decoder_version: record.decoderVersion,
      achieved_hz: record.achievedHz,
      sigma_pct: record.sigmaPct,
      n_settings: Array.isArray(record.settings) ? record.settings.length : undefined,
      settings: record.settings,
      app_build: record.appBuild,
      samples_gz_b64: await gzipJsonBase64(record.samples),
    };
    const res = await fetch(`${settings.collectorUrl.replace(/\/$/, "")}/sweeps`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

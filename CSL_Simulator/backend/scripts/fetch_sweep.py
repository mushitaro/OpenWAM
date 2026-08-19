#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage 121 - fetch a live-VANOS-sweep recording from the vanos-sweep-collector
Worker (standalone Cloudflare Worker + D1, separate from the tuner deployment)
and optionally run it straight through analyze_vanos_sweep.py.

Usage:
  python fetch_sweep.py --list                       # newest recordings
  python fetch_sweep.py <id>                         # save CSV to calib_data/stage121_vanos_sweep/
  python fetch_sweep.py <id> --analyze               # + run the analyzer with the S120 overlay
  python fetch_sweep.py <id> --analyze --axis exhaust

Token resolution order:
  --token > env VANOS_COLLECTOR_TOKEN > CSL_Simulator/vanos-collector/.dev.vars (UPLOAD_TOKEN=)
URL resolution order:
  --url > env VANOS_COLLECTOR_URL > http://127.0.0.1:8787 (local dev)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))       # backend/
SIM = os.path.dirname(HERE)                                              # CSL_Simulator/
OUT_DIR = os.path.join(HERE, "calib_data", "stage121_vanos_sweep")
S120_JSON = os.path.join(HERE, "calib_data", "stage120_cam_sens", "cam_sensitivity.json")
DEV_VARS = os.path.join(SIM, "vanos-collector", ".dev.vars")
TOKEN_FILE = os.path.join(SIM, "vanos-collector", ".upload-token.local")
# The deployed collector Worker (separate from the tuner deployment).
DEFAULT_URL = "https://vanos-sweep-collector.kazuhiro-mushi.workers.dev"


def resolve_token(cli: str | None) -> str:
    if cli:
        return cli
    envv = os.environ.get("VANOS_COLLECTOR_TOKEN")
    if envv:
        return envv
    if os.path.isfile(TOKEN_FILE):
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            tok = f.read().strip()
            if tok:
                return tok
    if os.path.isfile(DEV_VARS):
        with open(DEV_VARS, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("UPLOAD_TOKEN="):
                    return line.split("=", 1)[1].strip()
    sys.exit("No token: pass --token, set VANOS_COLLECTOR_TOKEN, or put the token in "
             + TOKEN_FILE)


def req(url: str, token: str, path: str) -> bytes:
    # An explicit UA matters: urllib's default ("Python-urllib/3.x") is rejected
    # with 403 by Cloudflare's bot protection before the request reaches the Worker.
    r = urllib.request.Request(url.rstrip("/") + path,
                               headers={"Authorization": "Bearer " + token,
                                        "User-Agent": "vanos-sweep-fetch/1.0"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {path}: {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"Cannot reach collector at {url}: {e.reason}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch a VANOS sweep from the collector Worker")
    ap.add_argument("id", nargs="?", help="sweep id (omit with --list)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--url", default=os.environ.get("VANOS_COLLECTOR_URL", DEFAULT_URL))
    ap.add_argument("--token", default=None)
    ap.add_argument("--analyze", action="store_true", help="run analyze_vanos_sweep.py on the CSV")
    ap.add_argument("--axis", choices=["intake", "exhaust"], default="intake")
    ap.add_argument("--out", default=None, help="explicit CSV output path")
    args = ap.parse_args()

    token = resolve_token(args.token)

    if args.list or not args.id:
        data = json.loads(req(args.url, token, "/sweeps?limit=50"))
        rows = data.get("sweeps", [])
        if not rows:
            print("(no sweeps stored)")
            return
        print(f"{'id':32} {'label':30} {'samples':>7} {'rpm':>11} {'Hz':>5}  client_time")
        for s in rows:
            rpm = f"{s.get('rpm_min') or '?'}-{s.get('rpm_max') or '?'}"
            print(f"{str(s['id'])[:32]:32} {str(s.get('label') or '')[:30]:30} "
                  f"{s.get('n_samples') or 0:>7} {rpm:>11} "
                  f"{s.get('achieved_hz') or 0:>5} {s.get('client_time') or ''}")
        return

    csv_bytes = req(args.url, token, f"/sweeps/{urllib.request.quote(args.id)}?format=csv")
    os.makedirs(OUT_DIR, exist_ok=True)
    out = args.out or os.path.join(
        OUT_DIR, f"sweep_{args.id.replace('/', '_').replace(chr(92), '_')}.csv")
    with open(out, "wb") as f:
        f.write(csv_bytes)
    n_lines = csv_bytes.count(b"\n")
    print(f"saved {out}  ({len(csv_bytes)} bytes, ~{max(0, n_lines - 1)} samples)")

    if args.analyze:
        cmd = [sys.executable, os.path.join(HERE, "scripts", "analyze_vanos_sweep.py"),
               out, "--axis", args.axis,
               "--out", os.path.splitext(out)[0] + f"_{args.axis}_analysis.json"]
        if os.path.isfile(S120_JSON):
            cmd += ["--compare", S120_JSON]
        print("+ " + " ".join(cmd))
        subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()

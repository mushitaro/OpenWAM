#!/usr/bin/env python3
"""Stage 74 — parasitic-resonance census (localize the ~100x amplifier).

Fork/driver of wave_box_fft.py: extends the monitored stations to the FULL
suspected network (eq rail + stubs + runners + head return), passes the
box-mode ROM env through to the solver, and adds full-spectrum peak
localization per station (Hz, not just engine orders).

Usage:
  python parasite_census.py --rpm 4600 --cycles 8 --tag p0            # baseline
  OPENWAM_BOX_MODE=318,1.5,1 OPENWAM_BOX_MODE_CC1=4,11,18 \
  OPENWAM_BOX_MODE_CC2=25,32,39 OPENWAM_BOX_MODE_POST=1 ... \
  python parasite_census.py --rpm 4600 --cycles 8 --tag p1            # pumped

Solver binary: OPENWAM_EXE (use build_rom for ROM runs). Results:
calib_data/stage74_wave/<tag>_<rpm>.json + localization table on stdout.
"""
import argparse
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wave_box_fft as W  # noqa: E402
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator.output_parser import OpenWAMOutputParser  # noqa: E402

# extended station set: the parasite is suspected in the eq/runner network
W.MON_RE = re.compile(
    r"^(Bellmouth_\d+|Runner_Upper_\d+|Runner_Lower_\d+|EqTube_Stub_\d+"
    r"|EqRail_Tap_\d+|EqRail_Return|Head_Return|CSL_Intake_Pipe"
    r"|CSL_Panel_Filter)")

if os.environ.get("OPENWAM_EXE"):
    W.BIN = os.environ["OPENWAM_EXE"]
W.OUT_DIR = os.path.join(HERE, "calib_data", "stage74_wave")

_orig_run_capped = W.run_capped


def _run_with_rom_env(cmd, wd, log, timeout, env):
    env = dict(env)
    for k, v in os.environ.items():
        if k.startswith("OPENWAM_BOX_MODE") or k == "OPENWAM_MOUTH_RAD_T12_CC":
            env[k] = v
    return _orig_run_capped(cmd, wd, log, timeout, env)


W.run_capped = _run_with_rom_env


def localize(wd, rpm, n_cyc_use=6, top=4):
    """Full-spectrum peak table per station from the retained INS.DAT."""
    ins = os.path.join(wd, "cellINS.DAT")
    if not os.path.exists(ins):
        print(f"  !! no INS.DAT in {wd}")
        return None
    df = OpenWAMOutputParser.parse_ins_dat(ins)
    cols = [str(c) for c in df.columns]
    ang_j = next((j for j, c in enumerate(cols) if c.startswith("Angle")), 1)
    ang = df.iloc[:, ang_j].to_numpy()
    starts = [0] + [i for i in range(1, len(ang))
                    if ang[i] == ang[i] and ang[i] < ang[i - 1] - 1.0]
    starts.append(len(ang))
    segs = [(starts[k], starts[k + 1]) for k in range(len(starts) - 1)]
    lens = sorted(e - s for s, e in segs if e > s)
    med = lens[len(lens) // 2]
    full = [(s, e) for s, e in segs if (e - s) >= 0.9 * med]
    use = full[-n_cyc_use:]
    if len(use) < 3:
        print(f"  !! only {len(use)} full cycles")
        return None
    C = len(use)
    L = min(e - s for s, e in use)
    t_cycle = 120.0 / rpm  # s per 720-deg cycle
    re_pp = re.compile(r"^P_duct_(\d+)_at_([0-9.]+)_m\(")
    rows = []
    for j, c in enumerate(cols):
        m = re_pp.match(c)
        if not m:
            continue
        x = np.concatenate([df.iloc[s:s + L, j].to_numpy(dtype=float)
                            for s, e in use])
        x = x - np.mean(x)
        F = np.abs(np.fft.rfft(x)) * 2.0 / len(x)
        # bin k -> freq: window = C cycles of t_cycle -> f = k / (C*t_cycle)
        hz = np.arange(len(F)) / (C * t_cycle)
        lo = np.searchsorted(hz, 20.0)  # skip sub-firing DC-ish region
        pk = np.argsort(F[lo:])[::-1][:top] + lo
        rows.append({
            "col": c, "rms_mbar": float(np.std(x)) * 1000.0,
            "peaks": [(round(float(hz[k]), 1), round(float(F[k]) * 1000.0, 2))
                      for k in pk],
        })
    rows.sort(key=lambda r: -r["rms_mbar"])
    print(f"\n# station AC ranking (rms mbar; top peaks Hz@mbar), {C} cycles")
    for r in rows[:25]:
        pks = " ".join(f"{h}Hz@{a}" for h, a in r["peaks"])
        print(f"  {r['rms_mbar']:9.2f}  {r['col'][:46]:46s} {pks}")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpm", type=float, default=4600)
    ap.add_argument("--cycles", type=int, default=8)
    ap.add_argument("--tag", default="p0")
    ap.add_argument("--timeout", type=int, default=2400)
    ap.add_argument("--set", action="append", default=[])
    args = ap.parse_args()
    sets = {}
    for s in args.set:
        k, _, v = s.partition("=")
        # W._apply_set only type-converts when the current value is numeric;
        # None-default fields (e.g. rail_tap_taper_end) need a real float.
        try:
            sets[k] = float(v)
        except ValueError:
            sets[k] = v
    res = W.run_cell(args.rpm, sets, args.cycles, args.tag, args.timeout)
    if res.get("error"):
        print("run_cell:", res["error"])
    wd = os.path.join(W.OUT_DIR, f"_run_{args.tag}_{int(args.rpm)}")
    rows = localize(wd, args.rpm)
    if rows is not None:
        with open(os.path.join(W.OUT_DIR, f"{args.tag}_{int(args.rpm)}_loc.json"),
                  "w") as f:
            json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()

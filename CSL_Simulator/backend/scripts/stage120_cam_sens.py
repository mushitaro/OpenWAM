#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage 120 - sim cam->air sensitivity: the PRE-REGISTERED prediction for S121.

WHY
---
S119 showed BMW's own residual-gas model cannot make the valley (internal EGR delta
valley->peak is ~1.3pp of trapped mass vs a 42-rf-pp VE swing). So the valley is a
fresh-induction (gas-dynamic) deficit and the cam lever on it is IVC/scavenging - the
quantity the 1D solver computes. This script measures, in the sim, how WOT VE moves
when we sweep the intake and exhaust cam phase around the stock map values, at the
valley (2900/3100) and the peak (3900). The resulting dVE/d(cam) table is the sim's
prediction; the live VANOS sweep on the real car (S121) validates it on the same axis
(delta air per delta cam), a differential both can produce even though the sim's
ABSOLUTE valley depth is imperfect.

This is NOT fitting: the cams are swept as independent inputs; nothing is tuned to any
target. (Stage-69: cams are experiment variables, never error-absorbing knobs.)

HARNESS
-------
Reuses run_cells_local.run_all verbatim (same deck, same solver env, same VE + gates,
resumable CSV, omp1 cell-parallel) with in_spread/ex_spread job overrides = the pure
BMW-spread path. Runs the HEALTHY BASELINE STACK on build_audit:
  SPECIES_FIX SPECIES11_FIX INTAKE_DUCT_MODEL=jet INTAKE_NO_FILTER LIFT_EXP=1.6
  BC_AREAFIX T12_EXP=0 MASS_AUDIT ; intake.eq_tube.model=plenum ; car ambient.
Cam values are DISPLAY units (intake 70..130, exhaust 83..128); live cam = intake-70
/ 128-exhaust, matching the DS2 command axis in S121.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
OUT_DIR = os.path.join(HERE, "calib_data", "stage120_cam_sens")
REPO = os.path.dirname(os.path.dirname(HERE))
AUDIT_EXE = os.path.join(REPO, "build_audit", "bin", "release", "OpenWAM.exe")
PRESET = os.path.normpath(os.path.join(HERE, "..", "frontend", "presets", "v14_owner.json"))

# stock WOT-row cam (display) at each cell, from csl_ecu_maps.json nearest-breakpoint
STOCK = {
    2900: {"in": 80, "ex": 93},
    3100: {"in": 70, "ex": 87},
    3900: {"in": 70, "ex": 87},
}
# one-factor sweeps as DELTAS from stock (display deg); baseline (0,0) shared
IN_DELTAS = [0, 5, 10, 15, 20]      # +display = advance intake (live = display-70)
EX_DELTAS = [-8, -4, 0, 4]          # display; live = 128-display


def _healthy_env():
    os.environ.update({
        "OPENWAM_EXE": AUDIT_EXE,
        "OPENWAM_NO_CACHE": "1",       # force build_audit physics, never a stale cache hit
        "OMP_NUM_THREADS": "1",        # determinism at WOT (Stage 56)
        "OPENWAM_SPECIES_FIX": "1",
        "OPENWAM_SPECIES11_FIX": "1",
        "OPENWAM_INTAKE_DUCT_MODEL": "jet",
        "OPENWAM_INTAKE_NO_FILTER": "1",
        "OPENWAM_LIFT_EXP": "1.6",
        "OPENWAM_BC_AREAFIX": "1",
        "OPENWAM_T12_EXP": "0",
        "OPENWAM_MASS_AUDIT": "1",
    })


def build_jobs(rpms, quick=False):
    sets = {
        "intake.eq_tube.model": "plenum",
        "environment.ambient_pressure": "94480",
        "environment.ambient_temp": "298.15",
    }
    jobs, seen = [], set()

    def add(rpm, isp, esp, axis):
        key = (rpm, isp, esp)
        if key in seen:
            return
        seen.add(key)
        ilive, elive = isp - 70, 128 - esp
        jobs.append({
            "rpm": rpm, "load": 100.0,
            "in_spread": isp, "ex_spread": esp,
            "set": dict(sets),
            "tag": f"s120_{rpm}_{axis}_i{ilive:+d}e{elive:+d}",
        })

    for rpm in rpms:
        st = STOCK[rpm]
        in_d = [0, 10] if quick else IN_DELTAS
        ex_d = [0] if quick else EX_DELTAS
        for d in in_d:                       # intake sweep, exhaust @ stock
            add(rpm, min(130, st["in"] + d), st["ex"], "in")
        for d in ex_d:                       # exhaust sweep, intake @ stock
            esp = max(83, min(128, st["ex"] + d))
            add(rpm, st["in"], esp, "ex")
    return jobs


def summarize(csv_path, rpms):
    import csv
    rows = []
    if os.path.exists(csv_path):
        with open(csv_path, newline="") as f:
            rows = [r for r in csv.DictReader(f)]

    def cell(rpm, isp, esp):
        for r in rows:
            if (int(float(r["rpm"])) == rpm and round(float(r["in_spread"])) == isp
                    and round(float(r["ex_spread"])) == esp):
                return r
        return None

    report = {}
    print("\n=== Stage 120: sim cam->air sensitivity (build_audit, healthy stack) ===")
    for rpm in rpms:
        st = STOCK[rpm]
        base = cell(rpm, st["in"], st["ex"])
        if not base:
            print(f" {rpm}: baseline missing")
            continue
        bve = float(base["ve"])
        rec = {"stock_in": st["in"], "stock_ex": st["ex"], "baseline_ve": round(bve, 2),
               "baseline_valid": int(base["valid"]), "intake": [], "exhaust": []}
        print(f"\n {rpm} rpm  baseline VE {bve:.1f} (int{st['in']}/exh{st['ex']}, "
              f"live i{st['in']-70:+d}/e{128-st['ex']:+d})  valid={base['valid']}")
        print("   axis  disp  live   VE    dVE   valid cyc")
        for d in IN_DELTAS:
            isp = min(130, st["in"] + d)
            r = cell(rpm, isp, st["ex"])
            if not r:
                continue
            ve = float(r["ve"])
            rec["intake"].append({"in_disp": isp, "in_live": isp - 70,
                                   "ve": round(ve, 2), "dve": round(ve - bve, 2),
                                   "valid": int(r["valid"]), "cyc": int(r["cyc"])})
            print(f"   in    {isp:4d}  {isp-70:+4d}  {ve:5.1f} {ve-bve:+5.1f}   "
                  f"{r['valid']}    {r['cyc']}")
        for d in EX_DELTAS:
            esp = max(83, min(128, st["ex"] + d))
            r = cell(rpm, st["in"], esp)
            if not r:
                continue
            ve = float(r["ve"])
            rec["exhaust"].append({"ex_disp": esp, "ex_live": 128 - esp,
                                   "ve": round(ve, 2), "dve": round(ve - bve, 2),
                                   "valid": int(r["valid"]), "cyc": int(r["cyc"])})
            print(f"   ex    {esp:4d}  {128-esp:+4d}  {ve:5.1f} {ve-bve:+5.1f}   "
                  f"{r['valid']}    {r['cyc']}")
        # local slopes (VE per deg live cam) by least-squares over valid points
        def slope(pts, live_key):
            v = [(p[live_key], p["ve"]) for p in pts if p["valid"]]
            if len(v) < 2:
                return None
            xs = [a for a, _ in v]
            ys = [b for _, b in v]
            mx, my = statistics.mean(xs), statistics.mean(ys)
            den = sum((x - mx) ** 2 for x in xs)
            return round(sum((x - mx) * (y - my) for x, y in v) / den, 3) if den else None
        rec["dVE_dintake_live"] = slope(rec["intake"], "in_live")
        rec["dVE_dexhaust_live"] = slope(rec["exhaust"], "ex_live")
        print(f"   => dVE/d(intake live) = {rec['dVE_dintake_live']}  "
              f"dVE/d(exhaust live) = {rec['dVE_dexhaust_live']}  (VE% per deg)")
        report[str(rpm)] = rec

    os.makedirs(OUT_DIR, exist_ok=True)
    outp = os.path.join(OUT_DIR, "cam_sensitivity.json")
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nwrote {outp}")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpms", default="2900,3100,3900")
    ap.add_argument("--cycles", type=int, default=40)
    ap.add_argument("--conc", type=int, default=max(1, min(10, (os.cpu_count() or 8) - 2)))
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--quick", action="store_true", help="tiny slice to validate the harness")
    ap.add_argument("--summarize-only", action="store_true")
    args = ap.parse_args()
    rpms = [int(x) for x in args.rpms.split(",")]

    os.makedirs(OUT_DIR, exist_ok=True)
    csv_path = os.path.join(OUT_DIR, "cam_sweep_quick.csv" if args.quick else "cam_sweep.csv")

    if not args.summarize_only:
        if not os.path.isfile(AUDIT_EXE):
            sys.exit(f"build_audit binary not found: {AUDIT_EXE}")
        _healthy_env()
        with open(PRESET, encoding="utf-8") as f:
            preset = json.load(f)
        import run_cells_local as R
        jobs = build_jobs(rpms, quick=args.quick)
        print(f"# Stage 120: {len(jobs)} cells, cycles={args.cycles}, conc={args.conc}, "
              f"exe={os.path.basename(AUDIT_EXE)}", flush=True)
        asyncio.run(R.run_all(jobs, csv_path, cycles=args.cycles, conc=args.conc,
                              timeout=args.timeout, preset_data=preset))

    if not args.quick:
        summarize(csv_path, rpms)


if __name__ == "__main__":
    main()

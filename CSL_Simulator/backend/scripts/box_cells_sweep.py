#!/usr/bin/env python3
# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Stage 64 Phase-2 — multi-cell airbox tuning grids (jobs-json generator).

Generates the screening grid for the internal box-mode tuning and hands it to
run_cells_local.py (canonical calibrated path, deck-cached, resumable):

  open    : connector D=230mm (box Deq, "open box"), L_c in {50,70,100,150}mm
            -> internal Helmholtz mode ~276-310 Hz -> order-4.5 resonance
            ~3680-4130 rpm
  baffled : D_c in {70,80,100,130} x L_c in {100,150,200}mm -> ~100 Hz
            -> order-1.5 resonance ~4000 rpm

All jobs: intake.plenum_box.model=cells, n_cells=2, rpm 3900 WOT (screening) --
extend with --rpms for the full-column validation of finalists.

Usage:
  python box_cells_sweep.py --grid open,baffled --csv calib_data/stage64_cells.csv
  python box_cells_sweep.py --grid finalists --dcl "230:70,80:150" \
      --rpms 2700,3900,4600,5300,6300,6900 --csv calib_data/stage64_final.csv
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def jobs_for(grid, rpms, dcl_pairs):
    jobs = []

    def add(d_mm, l_mm, extra=None, tagsfx=""):
        for rpm in rpms:
            st = {"intake.plenum_box.model": "cells",
                  "intake.plenum_box.n_cells": "2",
                  "intake.plenum_box.connector_diameter": str(d_mm),
                  "intake.plenum_box.connector_length": str(l_mm)}
            if extra:
                st.update(extra)
            jobs.append({"rpm": rpm, "load": 100,
                         "set": st, "tag": f"c{d_mm}x{l_mm}{tagsfx}"})

    if "open" in grid:
        for L in (50, 70, 100, 150):
            add(230, L)
    if "baffled" in grid:
        for D in (70, 80, 100, 130):
            for L in (100, 150, 200):
                add(D, L)
    if "finalists" in grid:
        for pair in dcl_pairs:
            d, l = pair.split(":")
            add(float(d), float(l))
            add(float(d), float(l),
                extra={"intake.plenum_box.duct_split": "true"}, tagsfx="_split")
    return jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", default="open,baffled")
    ap.add_argument("--rpms", default="3900")
    ap.add_argument("--dcl", default="", help="finalist D:L pairs, comma-separated")
    ap.add_argument("--csv", required=True)
    ap.add_argument("--cycles", type=int, default=60)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--conc", type=int, default=8)
    args = ap.parse_args()

    rpms = [int(x) for x in args.rpms.split(",") if x.strip()]
    dcl = [p for p in args.dcl.split(",") if p.strip()]
    jobs = jobs_for(args.grid.split(","), rpms, dcl)
    jpath = os.path.splitext(args.csv)[0] + "_jobs.json"
    os.makedirs(os.path.dirname(os.path.abspath(jpath)), exist_ok=True)
    with open(jpath, "w") as f:
        json.dump(jobs, f, indent=1)
    print(f"# {len(jobs)} jobs -> {jpath}")
    cmd = [sys.executable, os.path.join(HERE, "run_cells_local.py"),
           "--csv", args.csv, "--jobs-json", jpath,
           "--cycles", str(args.cycles), "--timeout", str(args.timeout),
           "--conc", str(args.conc)]
    print("# exec:", " ".join(cmd), flush=True)
    sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()

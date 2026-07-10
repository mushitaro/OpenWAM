#!/usr/bin/env python3
"""Stage 68 — THE MISSION: per-rpm physical-VANOS optimization (M4 optimizer).

Runs `OptimizationService.optimize_wot` headless on the validated WOT columns:
coordinate descent over PHYSICAL (intake_cam, exhaust_cam) map targets (integer
degrees, steps 8/4/2, budget evals per rpm), bounds = the stock ECU tables'
mechanical envelope, **base (EXVANOS scaffold) untouched** (calibration only —
csl-mission-vanos-valley rule). Baseline = stock cams (deck-cache hit).
Deliverable = optimal KF_EVAN1_SOLL / KF_AVAN1_SOLL WOT rows + per-rpm ΔVE.

Usage:
  python stage68_vanos_opt.py [--rpms 2700,3900,4600,5300,6300,6900]
                              [--budget 18] [--out calib_data/stage68_vanos_opt.json]
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.models import SimConfig  # noqa: E402
from app.simulator.optimization_service import OptimizationService  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpms", default="2700,3900,4600,5300,6300,6900")
    ap.add_argument("--budget", type=int, default=18)
    ap.add_argument("--preference", default="max_ve")
    ap.add_argument("--out", default=os.path.join(HERE, "calib_data",
                                                  "stage68_vanos_opt.json"))
    args = ap.parse_args()

    os.environ["OPENWAM_FAST_OUTPUT"] = "1"
    svc = OptimizationService(DATA_DIR, SIM_DIR)
    cfg = SimConfig()  # production defaults: X-Pipe + 170mm + Stage-65 calibration
    rpms = [int(x) for x in args.rpms.split(",") if x.strip()]

    result = asyncio.run(svc.optimize_wot(cfg, preference=args.preference,
                                          rpms=rpms, budget=args.budget))
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=1)

    print(f"\n# Stage 68 VANOS optimization -> {args.out}")
    print(f"{'rpm':>5} {'stock cams':>12} {'stock VE':>9} "
          f"{'best cams':>12} {'best VE':>8} {'dVE':>6}  conf")
    for c in result["cells"]:
        st, ch = c["stock"], c["chosen"]
        print(f"{int(c['rpm']):>5} "
              f"{int(st['intake_cam']):>5}/{int(st['exhaust_cam']):<5} "
              f"{st['ve']:>9.1f} "
              f"{int(ch['intake_cam']):>5}/{int(ch['exhaust_cam']):<5} "
              f"{ch['ve']:>8.1f} {c['delta_ve'] if c['delta_ve'] is not None else 0:>+6.1f}  "
              f"{c['confidence']}")
    ti = result["tables"]["intake"]
    te = result["tables"]["exhaust"]
    wi = ti["wot_row_index"]
    print(f"\n# optimized KF_EVAN1_SOLL WOT row: {ti['values'][wi]}")
    print(f"# optimized KF_AVAN1_SOLL WOT row: {te['values'][wi]}")
    print(f"# n_evals={result['n_evals_total']} failed_rpms={result['failed_rpms']}")


if __name__ == "__main__":
    main()

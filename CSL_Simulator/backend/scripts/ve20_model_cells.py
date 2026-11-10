#!/usr/bin/env python3
"""Current-model predictions for the frozen VE scoring cells (2026-11-10).

Runs the healthy stack (Stage 115/120: build_audit + SPECIES/AREAFIX/T12_EXP=0
...) unchanged -- no calibration is touched -- on every cell of
build/ve_accuracy_20261110/scored_cells.json, at the cell's own measured
ambient, three times per scored cell (ambient pressure x0.99/1.00/1.01) to
expose part-load attractor sensitivity, once per reference cell (RO < 1),
plus two harness checks: a byte-identical repeat (determinism) and a +25 K
ambient-temperature arm (the ambient-T gate, ~7% expected).

Rules: build/ve_accuracy_20261110/PREREG.md (incl. amendment 1).

    cd CSL_Simulator/backend && python scripts/ve20_model_cells.py [--conc 14]
Resumable: finished job ids in the CSV are skipped.
"""
import argparse
import asyncio
import bisect
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage120_cam_sens as S  # noqa: E402  (healthy env + paths)

REPO = S.REPO
OUT = os.path.join(REPO, "build", "ve_accuracy_20261110")
CELLS = os.path.join(OUT, "scored_cells.json")
CSV = os.path.join(OUT, "model_cells.csv")

# TUNER's opening correction: physical opening = node RO x factor(rpm)
FACTOR = [(0, .7), (900, .7), (1100, .7), (1300, .75), (1400, .8), (1600, .85),
          (1800, .9), (2100, .95), (2400, 1.0), (3000, 1.0), (3900, 1.0), (7000, 1.0)]


def factor(rpm):
    xs = [r for r, _ in FACTOR]
    i = min(len(xs) - 2, max(0, bisect.bisect_right(xs, rpm) - 1))
    a = (rpm - xs[i]) / (xs[i + 1] - xs[i])
    return FACTOR[i][1] * (1 - a) + FACTOR[i + 1][1] * a


def job(c, tag, p_scale=1.0, dT=0.0):
    load = c["ro"] * factor(c["rpm"])
    return {
        "rpm": c["rpm"], "load": round(load, 4),
        "in_spread": round(c["evan_map_display"], 2),
        "ex_spread": round(c["avan_map_display"], 2),
        "set": {"intake.eq_tube.model": "plenum",
                "environment.ambient_pressure": str(round(c["pamb_med"] * 100 * p_scale, 1)),
                "environment.ambient_temp": str(round(c["tamb_med"] + 273.15 + dT, 2))},
        "tag": f"ve20_{c['rpm']}_{c['ro']}_{tag}",
    }


def build_jobs(doc):
    jobs = []
    for c in doc["scored"]:
        jobs += [job(c, "p100"), job(c, "p099", 0.99), job(c, "p101", 1.01)]
    for c in doc["reference_ro_below_1"]:
        jobs.append(job(c, "p100"))
    probe = next(c for c in doc["scored"] if c["rpm"] == 2700 and abs(c["ro"] - 7.495) < 1e-6)
    jobs.append(job(probe, "dup"))          # identical inputs, different tag -> determinism
    jobs.append(job(probe, "dT25", dT=25))  # ambient-T gate
    return jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conc", type=int, default=max(1, min(14, (os.cpu_count() or 8) - 2)))
    ap.add_argument("--cycles", type=int, default=40)
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--rerun-early-nan", action="store_true",
                    help="PREREG amendment 2: re-run only the jobs the harness killed early on "
                         "'nan' text (stop_reason=nan, 0 cycles) with CSL_NAN_KILL_POLLS=0, "
                         "into model_cells_rerun.csv")
    a = ap.parse_args()
    doc = json.load(open(CELLS, encoding="ascii"))
    jobs = build_jobs(doc)
    csv_path = CSV
    if a.rerun_early_nan:
        import csv as _csv
        killed = {r["tag"] for r in _csv.DictReader(open(CSV, newline=""))
                  if r["stop_reason"] == "nan" and r["cyc"] == "0"}
        jobs = [j for j in jobs if j["tag"] in killed]
        csv_path = os.path.join(OUT, "model_cells_rerun.csv")
        os.environ["CSL_NAN_KILL_POLLS"] = "0"
    if a.dry:
        for j in jobs[:4] + jobs[-2:]:
            print(json.dumps(j))
        print(len(jobs), "jobs")
        return
    if not os.path.isfile(S.AUDIT_EXE):
        sys.exit(f"build_audit binary not found: {S.AUDIT_EXE}")
    S._healthy_env()
    with open(S.PRESET, encoding="utf-8") as f:
        preset = json.load(f)
    import run_cells_local as R
    print(f"# ve20: {len(jobs)} jobs, cycles={a.cycles}, conc={a.conc}, exe={S.AUDIT_EXE}", flush=True)
    asyncio.run(R.run_all(jobs, csv_path, cycles=a.cycles, conc=a.conc, timeout=a.timeout,
                          preset_data=preset))


if __name__ == "__main__":
    main()

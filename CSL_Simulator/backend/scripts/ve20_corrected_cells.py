#!/usr/bin/env python3
"""Corrected finite-volume model (corrected_fv_builder_v1) on the frozen VE
scoring cells -- same generator inputs as ve20_model_cells.py (2026-11-11).

The corrected kernel costs ~3.4 core-hours per 2400 rpm cycle, so this runs a
pre-registered 14-cell subset, one core each, up to a few cycles, and reads
the per-cycle IVC air from each run's CSV while it runs. No convergence is
claimed. Rules: build/ve_accuracy_20261110/PREREG.md amendment 3.

    cd CSL_Simulator/backend
    python scripts/ve20_corrected_cells.py --launch [--cycles 3]   # detached children
    python scripts/ve20_corrected_cells.py --collect               # any time
"""
import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage120_cam_sens as S  # noqa: E402
import ve20_model_cells as VM  # noqa: E402

OUT = os.path.join(VM.OUT, "corrected")
EXE = os.path.join(S.REPO, "build", "corrected_ve", "Release", "corrected_ve_builder.exe")
T_RUN_K = 298.15          # PREREG amendment 3: cell ambient T stops the kernel
M_REF_MG = 606.06         # ECU rf reference (metrics.m_ref_mg)
CELLS = [(2400, 1.001), (2400, 1.392), (2400, 2.393), (2400, 3.198), (2400, 5.005), (2400, 7.495),
         (2200, 7.495), (2700, 7.495), (2700, 1.392), (2700, 5.005), (2700, 10.01),
         (1800, 1.392), (1800, 3.198), (2900, 10.01)]


def cell_dir(rpm, ro):
    return os.path.join(OUT, f"{rpm}_{ro}")


def launch(cycles):
    import run_cells_local as R
    from app.simulator import corrected_builder as CB
    S._healthy_env()
    os.environ["OPENWAM_FAST_OUTPUT"] = "1"
    # PREREG amendment 4: start the pipes downstream of the throttles at
    # ambient instead of the estimated MAP -- the initial discontinuity across
    # the throttle stopped 10 of 14 cells before any IVC.
    os.environ["OPENWAM_MAP_EXP"] = "0"
    doc = json.load(open(VM.CELLS, encoding="ascii"))
    preset = json.load(open(S.PRESET, encoding="utf-8"))
    by = {(c["rpm"], c["ro"]): c for c in doc["scored"] + doc["reference_ro_below_1"]}
    os.makedirs(OUT, exist_ok=True)
    for rpm, ro in CELLS:
        c = by[(rpm, ro)]
        j = VM.job(c, "corr")
        j["set"]["environment.ambient_temp"] = str(T_RUN_K)
        cfg = R.build_config(j, 40, preset)
        cfg.engine.intake_cam_spread = j["in_spread"]
        cfg.engine.exhaust_cam_spread = j["ex_spread"]
        d = cell_dir(rpm, ro)
        shutil.rmtree(d, ignore_errors=True)
        manifest = CB.generate(cfg, d)
        target = cycles * 120.0 / rpm
        meta = {"rpm": rpm, "ro": ro, "load": j["load"], "in_spread": j["in_spread"],
                "ex_spread": j["ex_spread"], "pamb_pa": float(j["set"]["environment.ambient_pressure"]),
                "t_run_k": T_RUN_K, "t_cell_k": c["tamb_med"] + 273.15, "target_s": target,
                "cycles": cycles, "period_s": 120.0 / rpm, "started": time.time(),
                "exe_sha256": __import__("hashlib").sha256(open(EXE, "rb").read()).hexdigest(),
                "input_files": manifest["files"],
                "throttle_sigma_points": manifest.get("throttle_sigma_points")}
        json.dump(meta, open(os.path.join(d, "ve20_meta.json"), "w"), indent=1)
        flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0   # detached, own group
        with open(os.path.join(d, "stdout.txt"), "w") as so, open(os.path.join(d, "stderr.txt"), "w") as se:
            p = subprocess.Popen([EXE, d, repr(target), os.path.join(d, "out"), "1", "0.0375"],
                                 stdout=so, stderr=se, creationflags=flags)
        meta["pid"] = p.pid
        json.dump(meta, open(os.path.join(d, "ve20_meta.json"), "w"), indent=1)
        print(f"launched {rpm}/{ro} pid {p.pid} target {target:.4f}s", flush=True)


def read_cell(rpm, ro):
    d = cell_dir(rpm, ro)
    meta = json.load(open(os.path.join(d, "ve20_meta.json")))
    rec = {"rpm": rpm, "ro": ro, "meta": meta, "cycles": [], "reached_s": None, "error": None, "done": False}
    err = open(os.path.join(d, "stderr.txt")).read().strip()
    out = open(os.path.join(d, "stdout.txt")).read().strip()
    rec["error"] = err or None
    rec["done"] = bool(out)
    path = os.path.join(d, "out.csv")
    if not os.path.exists(path):
        return rec
    seen = {}            # (cyl, count) -> ivc_air kg, first row where the count appears
    budget = 0.0
    last_t = None
    with open(path, newline="") as f:
        r = csv.reader(f)
        head = next(r, None)
        if not head:
            return rec
        ia = [head.index(f"ivc_air{i}") for i in range(1, 7)]
        ic = [head.index(f"ivc_count{i}") for i in range(1, 7)]
        for row in r:
            if len(row) != len(head):
                continue            # torn last line of a live file
            try:
                last_t = float(row[0])
                budget = max(budget, float(row[1]))
                for cyl in range(6):
                    n = int(row[ic[cyl]])
                    if n >= 1 and (cyl, n) not in seen:
                        seen[(cyl, n)] = float(row[ia[cyl]])
            except ValueError:
                continue
    rec["reached_s"] = last_t
    rec["budget_max"] = budget
    rec["cycles_reached"] = (last_t / meta["period_s"]) if last_t else 0
    n = 1
    while all((cyl, n) in seen for cyl in range(6)):
        air = [seen[(cyl, n)] for cyl in range(6)]
        mean_mg = 1e6 * sum(air) / 6
        rec["cycles"].append({"n": n, "rf_ecu_at_run_T": 100 * mean_mg / M_REF_MG,
                              "rf_ecu_at_cell_T": 100 * mean_mg / M_REF_MG * meta["t_run_k"] / meta["t_cell_k"],
                              "cyl_spread_pct": 100 * (max(air) - min(air)) / (sum(air) / 6)})
        n += 1
    return rec


def collect():
    recs = [read_cell(*c) for c in CELLS if os.path.exists(os.path.join(cell_dir(*c), "ve20_meta.json"))]
    json.dump(recs, open(os.path.join(VM.OUT, "corrected_cells.json"), "w"), indent=1)
    for r in recs:
        cyc = " ".join(f"c{c['n']}={c['rf_ecu_at_cell_T']:.1f}" for c in r["cycles"])
        state = "ERROR " + r["error"][-70:] if r["error"] else ("done" if r["done"] else "running")
        print(f"{r['rpm']:5d} {r['ro']:7.3f} reached {r.get('cycles_reached', 0):5.2f} cyc  {cyc:40s} {state}")
    return recs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--launch", action="store_true")
    ap.add_argument("--collect", action="store_true")
    ap.add_argument("--cycles", type=int, default=3)
    a = ap.parse_args()
    if a.launch:
        launch(a.cycles)
    if a.collect or not a.launch:
        collect()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Stage 74 parity gate: the app's v14 preset must produce BYTE-IDENTICAL
solver decks to the research baseline.

Compares, for every rpm in calib_data/stage74_v14_jobs.json (WOT):
  (a) research path — run_cells_local.build_config(job) + run_job's wiring
      (the path that produced calib_data/stage74_v14.csv), vs
  (b) app path     — SimConfig(**frontend/presets/v14_owner.json) + the same
      per-cell wiring run_ve_map_generation.run_point applies (rpm/throttle,
      VANOS spreads from the maps, calib ICV, sigma table, KF ignition).

Any hash mismatch = a P1/P2-class parity break (frontend default drift,
model default drift, or generator change) — fix before trusting UI numbers.

Run:  cd CSL_Simulator/backend && python scripts/v14_parity_check.py
Exit: 0 = all decks identical; 1 = mismatch (diff summary printed).
"""
import contextlib
import hashlib
import io
import json
import os
import sys

os.environ["OPENWAM_FAST_OUTPUT"] = "1"   # deck-side; matches app + research runs

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, BACKEND)

import run_cells_local as R  # noqa: E402
from app.models import SimConfig  # noqa: E402
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

PRESET = os.path.normpath(os.path.join(
    BACKEND, "..", "frontend", "presets", "v14_owner.json"))
JOBS = os.path.join(BACKEND, "calib_data", "stage74_v14_jobs.json")
OUT = os.path.join(BACKEND, "calib_data", "_parity_tmp")


def deck_research(job, cal):
    cfg = R.build_config(job, 60)
    _icv = calib.icv_sigma(cal)
    if _icv is not None and "intake.eq_tube.icv_sigma" not in (job.get("set") or {}):
        cfg.intake.eq_tube.icv_sigma = _icv
    rpm, load = float(job["rpm"]), float(job["load"])
    cfg.engine.intake_cam_spread = float(R._lut(R.MAPS["kf_evan1_soll"], rpm, load))
    cfg.engine.exhaust_cam_spread = float(R._lut(R.MAPS["kf_avan1_soll"], rpm, load))
    cfg.engine.vanos_intake_bias = 0.0
    cfg.engine.vanos_exhaust_bias = 0.0
    gen = WAMGenerator(cfg, OUT)
    gen._sigma_bp = calib.thr_sigma_points(cal)
    ign = M.ignition_for(R.MAPS, rpm, load)
    with contextlib.redirect_stdout(io.StringIO()):
        return gen.generate(ignition_timing=ign)


def deck_app(preset_json, rpm, load, cal, maps):
    cfg = SimConfig(**preset_json)          # what FastAPI does with the POST body
    cfg = cfg.model_copy(deep=True)         # run_point's per-cell copy
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = float(load / 100.0)
    cfg.engine.intake_cam_spread = float(R._lut(maps["kf_evan1_soll"], rpm, load))
    cfg.engine.exhaust_cam_spread = float(R._lut(maps["kf_avan1_soll"], rpm, load))
    _icv = calib.icv_sigma(cal)
    if _icv is not None:
        cfg.intake.eq_tube.icv_sigma = _icv
    gen = WAMGenerator(cfg, OUT)
    gen._sigma_bp = calib.thr_sigma_points(cal)
    ign = M.ignition_for(maps, rpm, load)
    with contextlib.redirect_stdout(io.StringIO()):
        return gen.generate(ignition_timing=ign)


def main():
    os.makedirs(OUT, exist_ok=True)
    cal = calib.load(R.DATA_DIR)
    preset = json.load(open(PRESET, encoding="utf-8"))
    jobs = json.load(open(JOBS, encoding="utf-8"))
    bad = []
    for job in jobs:
        rpm, load = float(job["rpm"]), float(job["load"])
        a = deck_research(job, cal)
        b = deck_app(preset, rpm, load, cal, R.MAPS)
        ha = hashlib.sha256(a.encode()).hexdigest()[:16]
        hb = hashlib.sha256(b.encode()).hexdigest()[:16]
        ok = ha == hb
        print(f"  {int(rpm):5d}/{int(load):3d}  research {ha}  app {hb}  "
              f"{'OK' if ok else 'MISMATCH'}")
        if not ok:
            la, lb = a.splitlines(), b.splitlines()
            diffs = [(i, x, y) for i, (x, y) in enumerate(zip(la, lb)) if x != y]
            if len(la) != len(lb):
                print(f"    line counts differ: {len(la)} vs {len(lb)}")
            for i, x, y in diffs[:6]:
                print(f"    L{i}: research={x!r}")
                print(f"    L{i}:      app={y!r}")
            bad.append(int(rpm))
    if bad:
        print(f"PARITY FAIL: {bad}")
        sys.exit(1)
    print(f"v14 parity OK ({len(jobs)} cells byte-identical)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Stage 87 -- long-horizon MASS_AUDIT run, no per-pipe INS monitoring.

WHY: the 80-cycle rail-deleted run showed the intake's MEAN flow moving on a
~50-60 cycle hump (port sum 0.013 -> 0.065 at cycle 31 -> ~0 at cycle 59 ->
rising again). Every window-based number in Stages 80-87 is therefore a sample of
an unknown phase of that swing, including the "+101% of census" match that made
s85_noeq look correct -- it simply landed on the peak.

The open question is whether that swing DAMPS to a steady mean or is a sustained
limit cycle. 40-80 cycles cannot tell them apart. This script runs the same deck
far longer by dropping the expensive part (1-degree INS monitoring of ~40 pipes)
and keeping only the C++ MASSAUDIT trace, which is all the flux balance needs.

The census/gates from intake_acoustics.py are NOT produced here -- analyse the
resulting run.log with junction_audit.py's parse_audit + the window helpers.

Usage:
    python scripts/long_audit.py --rpm 2400 --cycles 250 --tag s87_long \
        [--set intake.eq_tube.enabled=false]
"""
import argparse
import contextlib
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wave_box_fft as W  # noqa: E402
from _local import BIN, HERE, run_capped  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.simulation_service import SimulationService  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "calib_data", "stage80_acoustics")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpm", type=float, default=2400.0)
    ap.add_argument("--cycles", type=int, default=250)
    ap.add_argument("--tag", default="s87_long")
    ap.add_argument("--timeout", type=int, default=86400)
    ap.add_argument("--set", action="append", default=[])
    a = ap.parse_args()

    sets = dict(s.split("=", 1) for s in a.set)
    os.makedirs(OUT_DIR, exist_ok=True)
    wd = os.path.join(OUT_DIR, f"_run_{a.tag}_{int(a.rpm)}")
    os.makedirs(wd, exist_ok=True)

    cal = calib.load(DATA_DIR)
    cfg = W.build_config(a.rpm, sets, a.cycles)
    W.coordinate_vanos(cfg, cal, a.rpm)
    icv = calib.icv_sigma(cal)
    if icv is not None:
        cfg.intake.eq_tube.icv_sigma = icv
    ign = M.ignition_for(MAPS, cfg.engine.rpm, cfg.engine.throttle_position * 100.0)

    gen = WAMGenerator(cfg, wd)
    gen._sigma_bp = calib.thr_sigma_points(cal)
    # NOTE: no _fast_output_override and no _monitor_pipe_ids -> the deck keeps the
    # cheap output path. MASSAUDIT is emitted by the solver regardless, on stdout.
    with contextlib.redirect_stdout(io.StringIO()):
        deck = gen.generate(ignition_timing=ign)
    with open(os.path.join(wd, "cell.wam"), "w", encoding="utf-8") as f:
        f.write(deck)

    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    env = svc._build_sim_env(cal, is_wot=True, fast=True, load=100.0)
    env["OMP_NUM_THREADS"] = "1"
    env["OPENWAM_MASS_AUDIT"] = "1"
    for k, v in os.environ.items():
        if k.startswith(("OPENWAM_INTAKE_", "OPENWAM_EQ_", "OPENWAM_MOUTH_RAD")):
            env[k] = v
    exe = os.environ.get("OPENWAM_EXE") or BIN
    print(f"  [long] {a.tag} {a.rpm:.0f} WOT, {a.cycles} cycles, audit-only\n"
          f"         bin={exe}\n         wd={wd}", flush=True)
    run_capped([exe, "cell.wam"], wd, os.path.join(wd, "run.log"), a.timeout, env)
    print(f"  [done] {wd}/run.log", flush=True)


if __name__ == "__main__":
    main()

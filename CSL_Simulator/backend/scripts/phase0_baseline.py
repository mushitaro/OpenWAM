#!/usr/bin/env python3
"""Phase 0.2 baseline datum (PLAN_PARTLOAD_CALIBRATION.md).

Runs the APP-PATH wot_quick map (20 WOT cells) on the DEFAULT SimConfig
(legacy geometry) via SimulationService.run_ve_map_generation -- the exact
production path -- and copies the resulting last_run_wot_quick.json (cells +
row metrics + overall) to backend/calib_data/phase0_wot_quick_legacy.json as
the pre-geometry datum. The part-load column datum (5300 x tps 20/45/65) is
collected separately with run_cells_local.py into
backend/calib_data/phase0_partload_legacy.csv.
"""
import asyncio
import contextlib
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.models import SimConfig  # noqa: E402
from app.simulator.simulation_service import SimulationService  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "calib_data")


async def amain():
    os.makedirs(OUT_DIR, exist_ok=True)
    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    cfg = SimConfig()
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = await svc.run_ve_map_generation(cfg, mode="wot_quick")
    dst = os.path.join(OUT_DIR, "phase0_wot_quick_legacy.json")
    shutil.copyfile(os.path.join(DATA_DIR, "last_run_wot_quick.json"), dst)
    row = result["rows"][0]
    print(json.dumps({
        "elapsed_sec": result["elapsed_sec"],
        "row": {k: row[k] for k in ("r", "max_shape_err", "peak_rpm_sim",
                                    "peak_rpm_stock", "range_sim_pp",
                                    "range_stock_pp", "score", "status",
                                    "n_trusted", "n_gated")},
        "overall": result["overall"],
        "saved": dst,
    }, indent=2))


if __name__ == "__main__":
    asyncio.run(amain())

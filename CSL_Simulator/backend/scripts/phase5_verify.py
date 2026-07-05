#!/usr/bin/env python3
"""Phase 5 final verification map (PLAN_PARTLOAD_CALIBRATION.md).

Runs the APP-PATH full map restricted to the calibration target rows
(CSL_LOAD_SUBSET \">=10\": ICV duty control makes <10% un-fittable, §0.3-6)
on the DEFAULT config + active calibration.json (rail geometry, sigma(pedal),
ICV, base surface, per-rpm WOT points). Saves the assembled result -- rows
with r / shape / wot_ratio_maxdp + overall verdict -- to
backend/calib_data/phase5_final_map.json.
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
    os.environ["CSL_LOAD_SUBSET"] = os.environ.get("CSL_LOAD_SUBSET", ">=10")
    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    cfg = SimConfig()
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = await svc.run_ve_map_generation(cfg, mode="full_map")
    dst = os.path.join(OUT_DIR, "phase5_final_map.json")
    shutil.copyfile(os.path.join(DATA_DIR, "last_run_full_map.json"), dst)
    print(json.dumps({
        "elapsed_sec": result["elapsed_sec"],
        "axes": result["axes"],
        "rows": [{k: r.get(k) for k in ("load", "r", "max_shape_err",
                                        "wot_ratio_maxdp", "peak_match",
                                        "n_trusted", "n_gated", "score", "status")}
                 for r in result["rows"]],
        "overall": result["overall"],
        "saved": dst,
    }, indent=1))


if __name__ == "__main__":
    asyncio.run(amain())

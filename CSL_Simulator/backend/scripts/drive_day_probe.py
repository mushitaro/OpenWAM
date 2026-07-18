"""Stage-1 model diagnostic: run the v14 twin AT THE DRIVE-DAY CONDITIONS.

Purpose (owner's doctrine, 2026-07-18): the drive logs are HINTS FOR MODEL
RECONSTRUCTION. The current deficit numbers carry a +-7% systematic from the
density correction (ambient- vs IAT-basis k). Running the sim at the actual
drive-day ambient (944 mbar / 26 C, Jul-18 WOT log) removes that correction
entirely: sim rf and measured rf are then in the SAME air, so
measured - sim = the model's true reproduction error B(rpm), no k involved.
(Charge-temp uncertainty remains: this anchors the ambient basis; the
heat-soak band is reported alongside, not hidden.)

Runs the wot_quick row (RO=100, 20 rpm points — valley 2100-3100 + peak 3900 +
4600 in one standard artifact), persists it to
app/data/driveday_wot_quick_944mbar.json, then RESTORES the app's v14
last_run_wot_quick.json via a pristine re-run (all deck-cache hits, minutes).

Off-HTTP on purpose (Stage-75 lesson: agent-hosted uvicorn gets reaped).

Usage:  cd CSL_Simulator/backend && python scripts/drive_day_probe.py
"""
import asyncio
import json
import os
import shutil
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

from app.models import SimConfig  # noqa: E402
from app.simulator.simulation_service import SimulationService  # noqa: E402

DATA_DIR = os.path.join(BACKEND, "app", "data")
SIM_DIR = os.path.dirname(BACKEND)
PRESET = os.path.normpath(os.path.join(BACKEND, "..", "frontend", "presets",
                                       "v14_owner.json"))
# Jul-18 WOT-pull log conditions (pumg mean 944 mbar, ambientTemp 26 C)
DRIVE_PA = 94400.0
DRIVE_K = 299.15
OUT = os.path.join(DATA_DIR, "driveday_wot_quick_944mbar.json")


async def main():
    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    raw = json.load(open(PRESET, encoding="utf-8"))

    cfg = SimConfig(**raw)
    cfg.environment.ambient_pressure = DRIVE_PA
    cfg.environment.ambient_temp = DRIVE_K
    t0 = time.time()
    print(f"# drive-day probe: wot_quick at {DRIVE_PA/100:.0f}mbar/{DRIVE_K-273.15:.0f}C",
          flush=True)
    res = await svc.run_ve_map_generation(cfg, mode="wot_quick")
    res["probe"] = {"purpose": "stage1 model diagnostic at drive-day ambient",
                    "log_ref": "20260718_092402",
                    "ambient_pa": DRIVE_PA, "ambient_k": DRIVE_K}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f)
    print(f"# probe done in {time.time()-t0:.0f}s -> {os.path.basename(OUT)} "
          f"(cells={res['overall']['n_cells']})", flush=True)

    # restore the app's v14 artifact (pristine preset -> all deck-cache hits)
    cfg_v14 = SimConfig(**json.load(open(PRESET, encoding="utf-8")))
    res2 = await svc.run_ve_map_generation(cfg_v14, mode="wot_quick")
    print(f"# v14 last_run_wot_quick restored (cells={res2['overall']['n_cells']})",
          flush=True)


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Regenerate app/data/last_run_<mode>.json from the app's v14 preset.

Same code path the HTTP endpoint uses — POST /simulate/run does
`SimConfig(**body)` then `SimulationService.run_ve_map_generation(config, mode)`,
and that method persists last_run_<mode>.json itself. Calling it directly just
drops the HTTP layer, which is what we want for a multi-hour full_map: a
uvicorn hosted as an agent background task can be reaped mid-run (that is how
the Stage-75 first attempt died at 3.27h with the result unpersisted), whereas
this survives as a plain detached process.

Finished cells are deck-cached, so a re-run after a death resumes cheaply.

Usage:
  cd CSL_Simulator/backend
  python scripts/regen_last_run.py full_map      # 480 cells (~3h cold)
  python scripts/regen_last_run.py wot_quick     # 20 cells
"""
import asyncio
import json
import os
import sys
import time

# The run's verdict strings contain an em-dash; on a Japanese Windows console
# (cp932) printing one raises UnicodeEncodeError and kills the script AFTER the
# multi-hour run already finished and persisted (it looks exactly like a crashed
# run). Force UTF-8 on our own streams.
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


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "full_map"
    cfg = SimConfig(**json.load(open(PRESET, encoding="utf-8")))
    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    t0 = time.time()
    print(f"# regenerating last_run_{mode} from {os.path.basename(PRESET)}",
          flush=True)
    res = await svc.run_ve_map_generation(cfg, mode=mode)
    print(f"# done in {time.time()-t0:.0f}s: schema=v{res['schema_version']} "
          f"unit={res['unit']} m_ref={res['m_ref_mg']} "
          f"cells={res['overall']['n_cells']} verdict={res['overall']['verdict']}",
          flush=True)
    print(f"# persisted -> app/data/last_run_{mode}.json", flush=True)


if __name__ == "__main__":
    asyncio.run(main())

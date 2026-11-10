"""Register explicit, immutable inputs; never substitute Builder conditions.

Use a complete cycle-end checkpoint. Large historical inputs remain external.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "CSL_Simulator/backend"))
from app.simulator.corrected_service import CorrectedService, REQUIRED, sha, save


def register(root, seed, case_id, label, reference_mass, reference_definition):
    service = CorrectedService(REPO)
    _, inspector = service.executables()
    staging = service.home / ("registration_" + uuid.uuid4().hex)
    staging.mkdir()
    shutil.copyfile(seed, staging / "seed.bin")
    state = json.loads(subprocess.check_output([str(inspector), str(staging / "seed.bin")], timeout=30))
    period = 120 / 3900
    cycle = round(state["time"] / period)
    if abs(state["time"] - cycle * period) > 1e-14:
        raise ValueError("Registration requires a complete cycle endpoint")
    drive = root / "native_cycle/thermal_drive_cycle_2_5us.txt"
    with drive.open() as f:
        header = f.readline().split()
        if header[:2] != ["THERMAL_DRIVE_V1", "3900"] or abs(float(header[2])-period)>1e-14:
            raise ValueError("Unsupported drive")
        ends = [float(line.split()[2]) for line in f if line.startswith("FRAME ")]
    entry = {"label": label, "conditions": {"rpm": 3900, "ro": None,
             "scope": "固定C-cycle入力。ROは未同定。Builder条件は未適用。", "seed_cycle": cycle},
             "reference_air_mass_kg": reference_mass, "reference_definition": reference_definition,
             "short_target": cycle * period + ends[9], "cycle_target": (cycle + 1) * period,
             "files": {name: {"path": str((seed if name == "seed.bin" else root / name).resolve()),
                                "sha256": sha(seed if name == "seed.bin" else root / name)}
                       for name in sorted(REQUIRED)}}
    entries = service.registry()
    if case_id in entries and entries[case_id] != entry:
        raise ValueError("Refuse changing an existing registered case; use a new ID")
    entries[case_id] = entry
    save(service.home / "cases.json", entries)
    save(staging / "registration.json", entry)
    return entry


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("root", type=Path)
    p.add_argument("seed", type=Path)
    p.add_argument("--id", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--reference-mass-kg", type=float, required=True)
    p.add_argument("--reference-definition", required=True)
    a = p.parse_args()
    if not math.isfinite(a.reference_mass_kg) or a.reference_mass_kg <= 0:
        p.error("positive reference mass required")
    print(json.dumps(register(a.root, a.seed, a.id, a.label, a.reference_mass_kg,
                              a.reference_definition), ensure_ascii=True, indent=2))

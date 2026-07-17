"""Stage 76 P2 self-check: synthetic-log round trip through ValidationService.

Builds a telemetry log FROM the sim's own last_run_full_map.json (rf = ve_sim
+ small noise, VANOS soll = our commanded map value, tz = the sim's ignition
lookup), persists it exactly like the Live tab would, then runs
ValidationService.compare on it. If binning, axis mapping, unit handling and
the map lookups are all correct, every delta must be ~= the injected noise.

Run:  cd CSL_Simulator/backend && python scripts/validation_selfcheck.py
"""
import datetime
import json
import os
import random
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.simulator import metrics as M                      # noqa: E402
from app.simulator.validation_service import ValidationService  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "data")
NOISE_RF = 0.3      # pp — injected measurement noise on rf
HITS = 6            # samples per synthetic cell
rng = random.Random(76)


def nearest(axis, v):
    return min(range(len(axis)), key=lambda i: abs(axis[i] - v))


def main():
    with open(os.path.join(DATA_DIR, "last_run_full_map.json"), encoding="utf-8") as f:
        run = json.load(f)
    with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8") as f:
        maps = json.load(f)

    rpm_axis = run["axes"]["rpm"]
    ro_axis = run["axes"]["load"]
    evan = maps["kf_evan1_soll"]
    avan = maps["kf_avan1_soll"]

    # every valid cell of the WOT row + a part-load band (RO 20/30/45/65)
    targets = []
    for li, ro in enumerate(ro_axis):
        if ro not in (20, 25, 30, 45, 64.99, 85.01, 100):
            continue
        for ri, rpm in enumerate(rpm_axis):
            cell = run["cells"][li][ri]
            if cell.get("health", {}).get("valid") and cell.get("ve_sim") is not None:
                targets.append((ri, li, rpm, ro, cell["ve_sim"]))

    samples, t = [], 0.0
    for (ri, li, rpm, ro, ve) in targets:
        t += 10.0  # big gap between cells so the dRPM/dt gate passes the jump
        evan_soll = evan["values"][nearest(evan["y_axis"], ro)][nearest(evan["x_axis"], rpm)]
        avan_soll = avan["values"][nearest(avan["y_axis"], ro)][nearest(avan["x_axis"], rpm)]
        tz_exp = M.ignition_for(maps, rpm, ro)
        for _ in range(HITS):
            t += 0.2
            samples.append({
                "t": round(t, 2),
                "rpm": rpm + rng.uniform(-15, 15),
                "ro": ro + rng.uniform(-0.3, 0.3),
                "rf": ve + rng.gauss(0, NOISE_RF),
                "rfDrrel": (ve + rng.gauss(0, NOISE_RF)) / 100.0,
                "rfPsau": (ve + rng.gauss(0, NOISE_RF)) / 100.0,
                "map": 950.0 + rng.uniform(-5, 5),
                "coolant": 90.0 + rng.uniform(-1, 1),
                "iat": 25.0 + rng.uniform(-0.5, 0.5),
                "ambientPressure": 960.0,
                "evanIst": evan_soll + rng.gauss(0, 0.2),
                "evanSoll": evan_soll,
                "avanIst": avan_soll + rng.gauss(0, 0.2),
                "avanSoll": avan_soll,
                "tz": [tz_exp + rng.gauss(0, 0.2) for _ in range(6)],
            })

    # mock_ prefix = synthetic, never to be read as measurement (and gitignored)
    log_id = "mock_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    tdir = os.path.join(DATA_DIR, "telemetry")
    os.makedirs(tdir, exist_ok=True)
    path = os.path.join(tdir, f"{log_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"log_id": log_id, "samples": samples,
                   "meta": {"source": "validation_selfcheck", "synthetic": True,
                            "decoder_version": 2, "n_samples": len(samples)}}, f)
    print(f"synthetic log {log_id}: {len(targets)} cells x {HITS} hits = {len(samples)} samples")

    svc = ValidationService(data_dir=DATA_DIR)
    rep = svc.compare(log_id, mode="full_map")

    cells = rep["cells"]
    fails = []
    if rep["gates"]["kept"] != rep["gates"]["total"]:
        fails.append(f"gate rejected {rep['gates']['rejected']} synthetic samples (want 0)")
    if len(cells) != len(targets):
        fails.append(f"cell count {len(cells)} != target {len(targets)}")

    deltas = [c["delta"] for c in cells if c["delta"] is not None]
    if len(deltas) != len(cells):
        fails.append(f"{len(cells) - len(deltas)} cells missing delta")
    worst = max((abs(d) for d in deltas), default=0.0)
    if worst > 4 * NOISE_RF:  # mean of HITS=6 noise draws stays well inside this
        fails.append(f"worst |delta| {worst:.2f}pp > {4 * NOISE_RF}pp")

    vt = rep["summary"]["vanos_tracking_mean_abs"]
    vm = rep["summary"]["vanos_map_match_mean_abs"]
    if vt is None or vt > 0.3:
        fails.append(f"vanos tracking {vt} (want <0.3)")
    if vm is None or vm > 1e-9:
        fails.append(f"vanos map match {vm} (want 0: soll==map by construction)")
    # exhaust side has DIFFERENT axes than intake — regression gate for the
    # lookup that must use each map's own breakpoints
    av_bad = [c for c in cells
              if c["avan_soll"] is not None and c["avan_map"] is not None
              and abs(c["avan_soll"] - c["avan_map"]) > 1e-9]
    if av_bad:
        fails.append(f"{len(av_bad)} cells with avan_soll != avan_map (axis mixup?)")

    tz_bad = [c for c in cells if c["tz_mean"] is None or c["tz_expected"] is None
              or abs(c["tz_mean"] - c["tz_expected"]) > 0.5]
    if tz_bad:
        fails.append(f"{len(tz_bad)} cells with tz mismatch > 0.5deg")

    print(f"cells={len(cells)} worst|delta|={worst:.3f}pp "
          f"vanos_track={vt:.3f} vanos_map={vm:.3g} unit={rep['run_unit']}")

    if "--keep" not in sys.argv:      # leave no synthetic clutter in the log list
        os.remove(path)
    else:
        print(f"kept synthetic log: {path}")

    if fails:
        print("FAIL:")
        for m in fails:
            print("  - " + m)
        sys.exit(1)
    print("PASS: synthetic round-trip clean (binning/axes/units/map lookups)")


if __name__ == "__main__":
    main()

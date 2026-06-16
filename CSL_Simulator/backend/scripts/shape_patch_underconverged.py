#!/usr/bin/env python3
"""Patch-up under-converged shape-map cells (Stage 49 (8)).

Scans the main shape-map CSV for cells with cyc < MIN_CYC (default 26) and re-runs
ONLY those, with a long timeout so the low-rpm cells (whose engine cycle spans more
wall-clock time -> fewer cycles per timeout window) reach convergence. Results go to a
separate patch CSV; merge.py folds them back, preferring the higher-cyc row per cell.

Resumable: re-invoke after a reboot; done patch cells are skipped by the sweep script's
own dedup. Env: PATCH_MIN_CYC (26), PATCH_TIMEOUT (2400), PATCH_CYCLES (34).
"""
import csv, os, subprocess, sys

HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
MAIN = os.environ.get("PATCH_MAIN", "/tmp/shape_map_choke.csv")
PATCH = os.environ.get("PATCH_CSV", "/tmp/shape_map_patch.csv")
MIN_CYC = int(os.environ.get("PATCH_MIN_CYC", "26"))
TIMEOUT = os.environ.get("PATCH_TIMEOUT", "2400")
CYCLES = os.environ.get("PATCH_CYCLES", "34")

todo = {}
for r in csv.reader(open(MAIN)):
    if len(r) >= 8 and r[0] != "rpm" and int(r[7]) < MIN_CYC:
        todo[(int(r[0]), int(float(r[1])))] = int(r[7])
if not todo:
    print("# no under-converged cells (all cyc >= %d)" % MIN_CYC); sys.exit(0)

print(f"# patch-up {len(todo)} cells (cyc < {MIN_CYC}): " +
      ", ".join(f"{r}/{l}(cyc{c})" for (r, l), c in sorted(todo.items())))
rpms = sorted({r for r, l in todo})
loads = sorted({l for r, l in todo}, reverse=True)
# Run grouped by load so each invocation shares a timeout class; the sweep script
# takes the full cross product, so pass exactly the needed (rpm,load) per load group.
for ld in loads:
    rr = sorted({r for (r, l) in todo if l == ld})
    env = os.environ.copy()
    env.update(dict(SWEEP_GRID="custom", SWEEP_BASES="150", SWEEP_OMP="4",
                    SWEEP_CYCLES=CYCLES, SWEEP_TIMEOUT=TIMEOUT, SWEEP_CSV=PATCH,
                    OPENWAM_THR_CHOKE="1", OPENWAM_THR_AGAIN="3.2",
                    SWEEP_RPMS=",".join(str(x) for x in rr), SWEEP_LOADS=str(ld)))
    subprocess.run([sys.executable, "scripts/exvanos_base_sweep.py"], cwd=HERE, env=env)

print("\n# patch results:")
for r in csv.reader(open(PATCH)):
    print("  " + ",".join(r))

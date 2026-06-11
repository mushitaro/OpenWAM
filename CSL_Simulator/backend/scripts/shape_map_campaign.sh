#!/bin/bash
# Stage 49 (8): representative 32-cell shape map under the gated choke BC.
# Canonical 16 cells first (the Stage-45/47 comparison grid), then the extension
# columns. Load-20 cells get a longer timeout (they are the slowest to converge).
# Resumable: done cells are skipped via the CSV; just re-invoke after a reboot.
cd /home/user/OpenWAM/CSL_Simulator/backend || exit 1
CSV=/tmp/shape_map_choke.csv
COMMON="SWEEP_GRID=custom SWEEP_BASES=150 SWEEP_CYCLES=30 SWEEP_OMP=4 SWEEP_CSV=$CSV"
CHOKE="OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2"

# Phase 1a: canonical rpms, mid/high loads
env $COMMON $CHOKE SWEEP_TIMEOUT=900 \
    SWEEP_RPMS=2700,3900,5300,6900 SWEEP_LOADS=100,65,45 \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -1
# Phase 1b: canonical rpms, load 20 (slowest)
env $COMMON $CHOKE SWEEP_TIMEOUT=1300 \
    SWEEP_RPMS=2700,3900,5300,6900 SWEEP_LOADS=20 \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -1
# Phase 2a: extension rpms, mid/high loads
env $COMMON $CHOKE SWEEP_TIMEOUT=900 \
    SWEEP_RPMS=2100,4600,6300,7300 SWEEP_LOADS=100,65,45 \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -1
# Phase 2b: extension rpms, load 20
env $COMMON $CHOKE SWEEP_TIMEOUT=1300 \
    SWEEP_RPMS=2100,4600,6300,7300 SWEEP_LOADS=20 \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -1

echo "=== SHAPE MAP CAMPAIGN COMPLETE ==="
python3 scripts/ve_shape_report.py $CSV

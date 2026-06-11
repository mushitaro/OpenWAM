#!/bin/bash
# Stage 49 (7): verification of the legacy-anchored chi fix (resumable).
cd /home/user/OpenWAM/CSL_Simulator/backend || exit 1
COMMON="SWEEP_GRID=custom SWEEP_BASES=150 SWEEP_OMP=4"

# V1: WOT invariance with the fix, same AGAIN as the failing run 3.
env $COMMON SWEEP_CYCLES=18 SWEEP_TIMEOUT=480 OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 \
    SWEEP_RPMS=3900 SWEEP_LOADS=100 SWEEP_CSV=/tmp/v2_wot_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

# V2: part-load anchor under the new convention (expect below the old 85.1).
env $COMMON SWEEP_CYCLES=30 SWEEP_TIMEOUT=900 OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 \
    SWEEP_RPMS=6900 SWEEP_LOADS=20 SWEEP_CSV=/tmp/v2_6900_20_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

# V3: second rpm at the same gain (re-anchor 5300 too).
env $COMMON SWEEP_CYCLES=30 SWEEP_TIMEOUT=900 OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 \
    SWEEP_RPMS=5300 SWEEP_LOADS=20 SWEEP_CSV=/tmp/v2_5300_20_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

echo "=== VERIFY2 COMPLETE ==="
for f in /tmp/v2_wot_a32.csv /tmp/v2_6900_20_a32.csv /tmp/v2_5300_20_a32.csv; do
  echo "--- $f"; cat "$f" 2>/dev/null
done

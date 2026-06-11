#!/bin/bash
# Stage 49 OPENWAM_THR_CHOKE validation campaign (resumable: re-invoke after reboots).
# Four cells, serial OMP=4, one CSV per configuration (the sweep script's done-cell
# dedup key is rpm/load/base only, so different THR configs need different CSVs).
cd /home/user/OpenWAM/CSL_Simulator/backend || exit 1
COMMON="SWEEP_GRID=custom SWEEP_BASES=150 SWEEP_CYCLES=30 SWEEP_OMP=4"

# 1) Stage-48 validation (1) as specified: pure geometry choke at the dead cell.
#    Prediction (Stage 49 (2)): ~25-30%, i.e. BELOW the legacy 47 -- area is the gap.
env $COMMON OPENWAM_THR_CHOKE=1 OPENWAM_THRDIAG=1 SWEEP_TIMEOUT=900 \
    SWEEP_RPMS=6900 SWEEP_LOADS=20 SWEEP_CSV=/tmp/choke_6900_20_a10.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

# 2) Area-corrected choke at the same cell: sigma_eff = 0.02*3.2 = 0.064.
#    Prediction: ~stock (70.3) without any K_CEIL.
env $COMMON OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 OPENWAM_THRDIAG=1 SWEEP_TIMEOUT=900 \
    SWEEP_RPMS=6900 SWEEP_LOADS=20 SWEEP_CSV=/tmp/choke_6900_20_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

# 3) WOT invariance under the gate (validation (2)): prediction == gate-off (~122.5@cyc22).
env $COMMON OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 SWEEP_TIMEOUT=600 \
    SWEEP_RPMS=3900 SWEEP_LOADS=100 SWEEP_CSV=/tmp/choke_3900_100_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

# 4) rpm-independence of the single gain: 5300/20 with the same sigma_eff.
#    Prediction: ~stock 83.9 (maybe a few % over).
env $COMMON OPENWAM_THR_CHOKE=1 OPENWAM_THR_AGAIN=3.2 OPENWAM_THRDIAG=1 SWEEP_TIMEOUT=900 \
    SWEEP_RPMS=5300 SWEEP_LOADS=20 SWEEP_CSV=/tmp/choke_5300_20_a32.csv \
    python3 scripts/exvanos_base_sweep.py 2>&1 | tail -2

echo "=== CAMPAIGN COMPLETE ==="
for f in /tmp/choke_6900_20_a10.csv /tmp/choke_6900_20_a32.csv /tmp/choke_3900_100_a32.csv /tmp/choke_5300_20_a32.csv; do
  echo "--- $f"; cat "$f" 2>/dev/null
done

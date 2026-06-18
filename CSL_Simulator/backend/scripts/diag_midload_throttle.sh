#!/bin/bash
# Stage 50 diagnostic: is the 3900/65 mid-load deficit throttle- or breathing/VANOS-limited?
# At AGAIN=3.2 the pedal-0.65 sigma is ~0.91 (nearly wide open) yet VE is 0.69 of WOT.
# Sweep sigma via AGAIN at fixed cell 3900/65: if VE is insensitive across sigma
# 0.28..0.96 the throttle is saturated (breathing/VANOS caps it -> deferred lever);
# if VE rises strongly the throttle IS the mid-load lever (sigma(pedal) calibratable).
cd /home/user/OpenWAM/CSL_Simulator/backend || exit 1
# wait for the in-flight 32-cell campaign to finish its last cell (avoid 4-core oversub)
until grep -q "^7300,20" /tmp/shape_map_choke.csv 2>/dev/null; do
  pgrep -f "shape_map_campaig[n]" >/dev/null || break
  sleep 30
done
COMMON="SWEEP_GRID=custom SWEEP_RPMS=3900 SWEEP_LOADS=65 SWEEP_BASES=150 SWEEP_CYCLES=30 SWEEP_OMP=4 SWEEP_TIMEOUT=900 OPENWAM_THR_CHOKE=1"
# sigma(pedal0.65) = cd_geom(0.283) * AGAIN ; ceiling 0.96
for AG in 1.0 2.0 6.0; do
  env $COMMON OPENWAM_THR_AGAIN=$AG SWEEP_CSV=/tmp/diag_midload_a${AG}.csv \
      python3 scripts/exvanos_base_sweep.py >/dev/null 2>&1
done
echo "=== 3900/65 sigma-sensitivity (AGAIN -> sigma@p0.65 -> VE) ==="
echo "  AGAIN  sigma   sim_VE  stock=111.8"
for AG in 1.0 2.0 6.0; do
  row=$(grep "^3900,65" /tmp/diag_midload_a${AG}.csv 2>/dev/null | tail -1)
  sig=$(python3 -c "s=0.283*$AG; print(f'{min(s,0.96):.3f}')")
  ve=$(echo "$row" | cut -d, -f6); cyc=$(echo "$row" | cut -d, -f8)
  echo "  $AG    $sig   ${ve:-?}  (cyc ${cyc:-?})"
done

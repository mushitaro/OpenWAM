#!/usr/bin/env bash
# Launch the Step-1 coordinated-WOT runner-length sweep in the background.
# Grid + cycles come from par_sweep_wot.py defaults / these env vars.
cd "$(dirname "$0")/.." || exit 1
rm -f /tmp/step1_wot.csv
export PS_CYCLES=55 PS_OMP=4 PS_CONC=4 PS_TIMEOUT=4000 PS_CSV=/tmp/step1_wot.csv
nohup python scripts/par_sweep_wot.py > /tmp/step1_wot.out 2>&1 &
echo "launched step1 sweep PID $!"

#!/usr/bin/env bash
# Safe OpenWAM runner: caps log size (head -c) so a divergent run can never
# flood the disk, applies a wall-clock timeout, and reports completion state.
# Usage: run_safe.sh <wam_file> <log_file> [timeout_sec] [maxbytes]
set -u
WAM="$1"; LOG="$2"; TMO="${3:-240}"; MAXB="${4:-5000000}"
BIN=/home/user/OpenWAM/build/bin/release/OpenWAM
timeout "$TMO" "$BIN" "$WAM" 2>&1 | head -c "$MAXB" > "$LOG"
rc=${PIPESTATUS[0]}
echo "----- run_safe: exit=$rc  logbytes=$(wc -c < "$LOG") -----"
echo "tail:"; tail -n 8 "$LOG"

#!/usr/bin/env python3
"""Merge a patch CSV into the main shape-map CSV, keeping the higher-cyc row per
(rpm,load) cell. Writes the merged result to the OUT path (default: overwrite main).
Usage: merge_shape_csv.py MAIN PATCH [OUT]"""
import csv, sys

MAIN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shape_map_choke.csv"
PATCH = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shape_map_patch.csv"
OUT = sys.argv[3] if len(sys.argv) > 3 else MAIN

header = None
best = {}  # (rpm,load) -> row, keeping max cyc
for path in (MAIN, PATCH):
    try:
        for r in csv.reader(open(path)):
            if not r: continue
            if r[0] == "rpm":
                header = r; continue
            if len(r) < 8: continue
            k = (int(r[0]), int(float(r[1])))
            if k not in best or int(r[7]) > int(best[k][7]):
                best[k] = r
    except FileNotFoundError:
        pass

with open(OUT, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(header or ["rpm","load","base","exbias","stock","sim","valid","cyc"])
    for k in sorted(best, key=lambda x: (x[0], -x[1])):
        w.writerow(best[k])
print(f"# merged {len(best)} cells -> {OUT}")

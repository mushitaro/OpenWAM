#!/usr/bin/env python3
"""Task 4 (Stage 65) — part-load dp scorer for run_cells_local CSVs.

dp = |p_sim - p_stock|, p = VE(load)/VE(WOT) per rpm column: the part-load
fill-fraction metric the Stage 57/60 fits used. Normalizing by each side's own
WOT divides out the WOT-level deficit (notably the 3900 structural limit), so
the part-load surface CAN be fit even where absolute VE cannot.

p_stock from the owner map (csl_ecu_maps kf_rf_soll load rows / stock_csl_ve
WOT row). p_sim uses the Stage-63 validated X+170mm WOT row (deck-cached,
omp1): 2700=75.3 3900=96.2 4600=121.2 5300=115.6 6300=112.4 6900=110.2.

Usage: python t4_dp_score.py csv1 [csv2 ...] [--gate 0.06]
Rows FLAGged invalid by the runner are marked; best-per-(rpm,load) by dp shown
when multiple bases exist.
"""
import argparse
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402
sys.path.insert(0, HERE)
from app.simulator import metrics as M  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))

# Stage-63 X+170mm WOT row (validated, cache-backed; see stage63_refit note)
SIM_WOT = {2700: 75.3, 3900: 96.2, 4600: 121.2, 5300: 115.6,
           6300: 112.4, 6900: 110.2}


def _lut(m, rpm, load):
    rx, ly, v = m["x_axis"], m["y_axis"], m["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def stock_wot(rpm):
    stock = M.load_stock_wot(DATA_DIR)
    return M.stock_on_axis([rpm], stock)[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csvs", nargs="+")
    ap.add_argument("--gate", type=float, default=0.06)
    args = ap.parse_args()

    rows = []
    for path in args.csvs:
        with open(path, newline="") as f:
            rows.extend(csv.DictReader(f))

    # best-per-cell by dp among VALID rows (fall back to best invalid, marked)
    cells = {}
    for r in rows:
        rpm, load = int(float(r["rpm"])), float(r["load"])
        if load >= 100:
            continue
        ve = float(r["ve"])
        wot = SIM_WOT.get(rpm)
        if not wot or ve <= 0:
            continue
        p_sim = ve / wot
        p_stock = _lut(MAPS["kf_rf_soll"], rpm, load) * 100.0 / stock_wot(rpm)
        dp = abs(p_sim - p_stock)
        valid = r.get("valid") == "1"
        rec = {"rpm": rpm, "load": load, "base": float(r["base"]), "ve": ve,
               "p_sim": p_sim, "p_stock": p_stock, "dp": dp, "valid": valid,
               "tag": r.get("tag", ""), "cyc": r.get("cyc"), "slope": r.get("slope")}
        key = (rpm, load)
        cur = cells.get(key)
        # prefer VALID rows, then lowest dp
        if cur is None or (valid, -dp) > (cur["valid"], -cur["dp"]):
            cells[key] = rec
        # keep all for the per-cell listing
        cells.setdefault(("all", rpm, load), []).append(rec)

    loads = sorted({k[1] for k in cells if k[0] != "all"})
    rpms = sorted({k[0] for k in cells if k[0] != "all"})
    print(f"# dp = |p_sim - p_stock|  (gate {args.gate}; * = best row INVALID/FLAG)")
    for load in loads:
        print(f"\n== load {load:g} ==")
        print("  rpm   base    ve     p_sim  p_stock   dp     verdict")
        for rpm in rpms:
            c = cells.get((rpm, load))
            if not c:
                continue
            flag = "" if c["valid"] else "*"
            verdict = ("GREEN" if c["dp"] <= args.gate else
                       "amber" if c["dp"] <= 2 * args.gate else "RED")
            print(f"  {rpm:>4}  {c['base']:6.1f} {c['ve']:6.1f}  {c['p_sim']:.3f}"
                  f"  {c['p_stock']:.3f}  {c['dp']:.3f}{flag}  {verdict} ({c['tag']})")
    # sweep detail per cell when multiple bases present
    print("\n# per-cell base candidates (dp ascending):")
    for key in sorted(k for k in cells if k[0] == "all"):
        _, rpm, load = key
        lst = sorted(cells[key], key=lambda r: r["dp"])
        if len(lst) > 1:
            det = "  ".join(f"b{r['base']:.0f}->dp{r['dp']:.3f}"
                            f"{'' if r['valid'] else '*'}" for r in lst)
            print(f"  {rpm}/{load:g}: {det}")


if __name__ == "__main__":
    main()

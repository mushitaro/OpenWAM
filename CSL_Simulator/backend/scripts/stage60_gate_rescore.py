#!/usr/bin/env python3
"""Stage 60 — adoption-gate re-examination (Stage 59 reframe).

Re-scores the Stage-58 alpha-0.4 part-load refit against the current Stage-57
alpha-null production, per fitted cell (2700-6900 x load 20/30/45/65), then
applies SEVERAL gate policies to decide whether alpha-0.4 becomes adoptable
once the un-fixable 2700 low-load column (Stage 59: supply-limited, dp floor)
is excluded/down-weighted.

Data provenance (all on disk, no solver runs):
  p_stock(rpm,load) = kf_rf_soll(rpm,load)/kf_rf_soll(rpm,100)  [ECU fill target]
  WOT denominator   = phase3_wot_row.json fitted points (SAME for both states:
                      WOT always gets mouth_rad.alpha=0.4 regardless of part_load_alpha)
  alpha-null VE     = phase5_final_map.json (current production map)
  alpha-0.4  VE     = stage58_alpha04_fit_base_sweep.csv regate cells at the
                      FINAL fitted surface base
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "app", "data")
CD = os.path.join(HERE, "calib_data")

MAPS = json.load(open(os.path.join(DATA, "csl_ecu_maps.json")))
KF = MAPS["kf_rf_soll"]

FIT_RPMS = [2700, 3900, 4600, 5300, 6300, 6900]
FIT_LOADS = [20.0, 30.0, 45.0, 64.99]
LOAD_LABEL = {20.0: 20, 30.0: 30, 45.0: 45, 64.99: 65}

# WOT denominators (fitted points; identical for both states)
WOT = {2700: 97.34, 3900: 88.72, 4600: 111.79, 5300: 108.76, 6300: 111.95, 6900: 110.18}


def kf_lut(rpm, load):
    rx, ly, v = KF["x_axis"], KF["y_axis"], KF["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def p_stock(rpm, load):
    k100 = kf_lut(rpm, 100.0)
    return kf_lut(rpm, load) / k100 if k100 else None


# --- alpha-null production part-load VE from phase5_final_map -----------------
def load_anull():
    d = json.load(open(os.path.join(CD, "phase5_final_map.json")))
    rpms = [float(r) for r in d["axes"]["rpm"]]
    loads = [float(l) for l in d["axes"]["load"]]
    ve = {}
    for L in FIT_LOADS:
        # map load key: phase5 uses 20.0/30.0/45.0/64.99
        li = min(range(len(loads)), key=lambda i: abs(loads[i] - L))
        for R in FIT_RPMS:
            ri = rpms.index(float(R))
            c = d["cells"][li][ri]
            ve[(R, L)] = (c.get("ve_sim"), c.get("health", {}).get("valid"))
    return ve


# --- alpha-0.4 part-load VE from the regate cells at the FINAL surface base ---
def load_a04():
    surf = json.load(open(os.path.join(CD, "stage58_alpha04_fit_base.json")))["surface"]
    srpms = [float(r) for r in surf["rpms"]]
    sloads = [float(l) for l in surf["loads"]]
    def base_of(R, L):
        li = min(range(len(sloads)), key=lambda i: abs(sloads[i] - L))
        ri = srpms.index(float(R))
        return surf["values"][li][ri]
    rows = list(csv.DictReader(open(os.path.join(CD, "stage58_alpha04_fit_base_sweep.csv"))))
    reg = [r for r in rows if r["tag"] == "baseC-regate"]
    ve = {}
    for R in FIT_RPMS:
        for L in FIT_LOADS:
            b = base_of(R, L)
            # pick the regate cell matching this rpm/load AND base (nearest base)
            cand = [r for r in reg if int(float(r["rpm"])) == R
                    and abs(float(r["load"]) - L) < 0.5]
            if not cand:
                ve[(R, L)] = (None, None); continue
            best = min(cand, key=lambda r: abs(float(r["base"]) - b))
            ve[(R, L)] = (float(best["ve"]), best["valid"] == "1")
    return ve


def dp_of(ve, R, L):
    v, valid = ve.get((R, L), (None, None))
    if v is None or not valid:
        return None
    return abs(v / WOT[R] - p_stock(R, L))


def main():
    anull = load_anull()
    a04 = load_a04()

    print("=== per-cell dp (alpha-null -> alpha-0.4), fitted columns ===")
    dp_null = {}
    dp_a04 = {}
    for L in FIT_LOADS:
        cells = []
        for R in FIT_RPMS:
            dn = dp_of(anull, R, L)
            da = dp_of(a04, R, L)
            dp_null[(R, L)] = dn
            dp_a04[(R, L)] = da
            sn = f"{dn:.3f}" if dn is not None else "  -  "
            sa = f"{da:.3f}" if da is not None else "  -  "
            mark = ""
            if dn is not None and da is not None:
                mark = " up" if da < dn - 0.001 else (" DN" if da > dn + 0.001 else " ==")
            cells.append(f"{R}:{sn}->{sa}{mark}")
        print(f"load {LOAD_LABEL[L]:>2}: " + " | ".join(cells))

    # --- gate policies -------------------------------------------------------
    def row_max(dp, L, cols):
        vals = [dp[(R, L)] for R in cols if dp.get((R, L)) is not None]
        return max(vals) if vals else None

    def row_mean(dp, L, cols):
        vals = [dp[(R, L)] for R in cols if dp.get((R, L)) is not None]
        return sum(vals) / len(vals) if vals else None

    policies = [
        ("FULL max (6 cols)", FIT_RPMS, row_max),
        ("EXCLUDE 2700, max (5 cols)", [r for r in FIT_RPMS if r != 2700], row_max),
        ("EXCLUDE 2700+low-load-highrpm caveat -> MEAN (6 cols)", FIT_RPMS, row_mean),
        ("EXCLUDE 2700, MEAN (5 cols)", [r for r in FIT_RPMS if r != 2700], row_mean),
    ]
    for name, cols, fn in policies:
        print(f"\n=== gate policy: {name} ===")
        won = 0; total = 0
        for L in FIT_LOADS:
            n = fn(dp_null, L, cols); a = fn(dp_a04, L, cols)
            if n is None or a is None:
                print(f"  load {LOAD_LABEL[L]:>2}: n/a"); continue
            total += 1
            verdict = "IMPROVED" if a < n - 0.001 else ("worse" if a > n + 0.001 else "tie")
            won += verdict == "IMPROVED"
            print(f"  load {LOAD_LABEL[L]:>2}: {n:.3f} -> {a:.3f}  {verdict}")
        print(f"  => {won}/{total} rows improved")


if __name__ == "__main__":
    main()

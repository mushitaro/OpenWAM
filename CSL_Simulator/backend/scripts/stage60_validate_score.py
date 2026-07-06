#!/usr/bin/env python3
"""Stage 60 — score the load-scheduled HYBRID (end-to-end validation run) vs the
Stage-57 alpha-null production, per fitted cell and per row."""
import csv, json, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "app", "data"); CD = os.path.join(HERE, "calib_data")
KF = json.load(open(os.path.join(DATA, "csl_ecu_maps.json")))["kf_rf_soll"]

def kf(rpm, load):
    rx, ly, v = KF["x_axis"], KF["y_axis"], KF["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][
        min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]

def p_stock(r, l):
    k = kf(r, 100.0); return kf(r, l)/k if k else None

WOT = {2700: 97.34, 3900: 88.72, 4600: 111.79, 5300: 108.76, 6300: 111.95, 6900: 110.18}
RPMS = [2700, 3900, 4600, 5300, 6300, 6900]; LOADS = [20.0, 30.0, 45.0, 64.99]
LL = {20.0: 20, 30.0: 30, 45.0: 45, 64.99: 65}

hyb = {}
for r in csv.DictReader(open(os.path.join(CD, "stage60_validate.csv"))):
    if r["valid"] == "1":
        hyb[(int(float(r["rpm"])), float(r["load"]))] = float(r["ve"])

d = json.load(open(os.path.join(CD, "phase5_final_map.json")))
prpms = [float(x) for x in d["axes"]["rpm"]]; ploads = [float(x) for x in d["axes"]["load"]]
s57 = {}
for L in LOADS:
    li = min(range(len(ploads)), key=lambda i: abs(ploads[i]-L))
    for R in RPMS:
        c = d["cells"][li][prpms.index(float(R))]
        if c["health"]["valid"]:
            s57[(R, L)] = c["ve_sim"]

def dp(ve, R, L):
    return abs(ve/WOT[R] - p_stock(R, L)) if ve is not None else None

print("=== per fitted cell dp: Stage-57 -> hybrid (+ better / - worse / = same) ===")
for L in LOADS:
    cells = []
    for R in RPMS:
        a = dp(s57.get((R, L)), R, L); b = dp(hyb.get((R, L)), R, L)
        if a is None or b is None:
            cells.append(f"{R}:  -  "); continue
        mk = "+" if b < a-.001 else ("-" if b > a+.001 else "=")
        cells.append(f"{R}:{a:.2f}>{b:.2f}{mk}")
    print(f"load {LL[L]:>2}: " + " | ".join(cells))

print("\n=== per-row max|dp| EXCLUDING un-fixable 2700: Stage-57 -> hybrid ===")
cols = [r for r in RPMS if r != 2700]
for L in LOADS:
    a = max(dp(s57[(R, L)], R, L) for R in cols if (R, L) in s57)
    b = max(dp(hyb[(R, L)], R, L) for R in cols if (R, L) in hyb)
    v = "IMPROVED" if b < a-.001 else ("worse" if b > a+.001 else "same")
    print(f"  load {LL[L]:>2}: {a:.3f} -> {b:.3f}  {v}")

print("\n=== full-row max INCLUDING 2700 (un-fixable): Stage-57 -> hybrid ===")
for L in LOADS:
    a = max(dp(s57[(R, L)], R, L) for R in RPMS if (R, L) in s57)
    b = max(dp(hyb[(R, L)], R, L) for R in RPMS if (R, L) in hyb)
    v = "IMPROVED" if b < a-.001 else ("worse" if b > a+.001 else "same")
    d27a = dp(s57.get((2700, L)), 2700, L); d27b = dp(hyb.get((2700, L)), 2700, L)
    print(f"  load {LL[L]:>2}: {a:.3f} -> {b:.3f}  {v}   (2700 cell: {d27a:.3f}->{d27b:.3f})")

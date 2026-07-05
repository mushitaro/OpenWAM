#!/usr/bin/env python3
"""Stage-58 adoption gate: compare two phase5 final maps on the FITTED columns.

The plan's own load-profile metric, per row: max over the six fitted rpm
columns (2700/3900/4600/5300/6300/6900) of |sim/sim_WOT - stock/stock_WOT|,
health-gated on BOTH the part-load and the WOT cell (same exclusion the app's
wot_ratio_maxdp uses). The full-20-column map maxdp is printed too, but the
adoption decision reads the fitted columns: the 600-2400 columns were never in
any fit scope.

  python phase5_compare.py calib_data/stage57_phase5_final_map.json \
                           calib_data/phase5_final_map.json
"""
import json
import sys

FIT_RPMS = [2700.0, 3900.0, 4600.0, 5300.0, 6300.0, 6900.0]


def _ok(c):
    h = (c or {}).get("health", {})
    return bool(h.get("converged") and h.get("cyl_ok") and h.get("ve_in_band"))


def row_maxdp(cells_row, wot_row, rpms, restrict=None):
    worst, worst_rpm = None, None
    for c, w, r in zip(cells_row, wot_row, rpms):
        if restrict and r not in restrict:
            continue
        if not (_ok(c) and _ok(w)):
            continue
        s, k = c.get("ve_sim"), c.get("ve_stock")
        sw, kw = w.get("ve_sim"), w.get("ve_stock")
        if s is None or k is None or not sw or not kw:
            continue
        d = abs(s / sw - k / kw)
        if worst is None or d > worst:
            worst, worst_rpm = d, r
    return worst, worst_rpm


def load_map(path):
    d = json.load(open(path))
    rpms = [float(r) for r in d["axes"]["rpm"]]
    loads = [float(l) for l in d["axes"]["load"]]
    return d, rpms, loads


def report(path):
    d, rpms, loads = load_map(path)
    wot = d["cells"][loads.index(100.0)]
    out = {}
    for li, load in enumerate(loads):
        if load == 100.0:
            continue
        fit_dp, fit_rpm = row_maxdp(d["cells"][li], wot, rpms, set(FIT_RPMS))
        all_dp, all_rpm = row_maxdp(d["cells"][li], wot, rpms)
        out[load] = (fit_dp, fit_rpm, all_dp, all_rpm)
    return out


def main():
    old_p, new_p = sys.argv[1], sys.argv[2]
    old, new = report(old_p), report(new_p)
    crit_loads = [20.0, 30.0, 45.0, 64.99]
    print(f"{'load':>6} | {'old fit-maxdp':>16} | {'new fit-maxdp':>16} | verdict"
          f"   (full-map maxdp old->new)")
    better = worse = 0
    for load in sorted(set(old) | set(new)):
        o = old.get(load, (None,) * 4)
        n = new.get(load, (None,) * 4)
        vo = f"{o[0]:.3f}@{int(o[1])}" if o[0] is not None else "-"
        vn = f"{n[0]:.3f}@{int(n[1])}" if n[0] is not None else "-"
        verdict = ""
        if load in crit_loads and o[0] is not None and n[0] is not None:
            verdict = "IMPROVED" if n[0] < o[0] else "worse"
            better += verdict == "IMPROVED"
            worse += verdict == "worse"
        fo = f"{o[2]:.3f}" if o[2] is not None else "-"
        fn = f"{n[2]:.3f}" if n[2] is not None else "-"
        print(f"{load:>6} | {vo:>16} | {vn:>16} | {verdict:<9} ({fo} -> {fn})")
    print(f"\nadoption rows (20/30/45/65): {better} improved, {worse} worse")


if __name__ == "__main__":
    main()

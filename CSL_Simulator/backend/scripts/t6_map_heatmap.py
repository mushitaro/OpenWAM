#!/usr/bin/env python3
"""Stage 68 — full-map calibration validation heatmap (sim vs owner base map).

Scores every (rpm, load) cell of a run_cells_local CSV against the owner base
map:
  load=100 : absolute Delta pp = ve_sim - stock_wot(rpm)   (GREEN<=5 / amber<=10)
  part load: dp = |ve/simWOT(rpm) - stock(load)/stockWOT(rpm)|  (GREEN<=0.06 /
             amber<=0.12) -- the Stage-57/60 p-metric; simWOT(rpm) comes from
             the SAME csv's load-100 row (self-consistent, no hardcoding).

Cell flags: '!' invalid (FLAG row), '?' missing. Known permanent limit: the
3900 WOT column (annotate, don't chase).

Usage: python t6_map_heatmap.py csv1 [csv2 ...]
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402
sys.path.insert(0, HERE)
from app.simulator import metrics as M  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))


def _lut(m, rpm, load):
    rx, ly, v = m["x_axis"], m["y_axis"], m["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def main():
    rows = []
    for path in sys.argv[1:]:
        with open(path, newline="") as f:
            rows.extend(csv.DictReader(f))

    cells = {}
    for r in rows:
        rpm, load = int(float(r["rpm"])), round(float(r["load"]))
        rec = {"ve": float(r["ve"]), "valid": r.get("valid") == "1"}
        cur = cells.get((rpm, load))
        if cur is None or (rec["valid"], 0) > (cur["valid"], 0):
            cells[(rpm, load)] = rec

    rpms = sorted({k[0] for k in cells})
    loads = sorted({k[1] for k in cells}, reverse=True)
    stock_wot_map = M.load_stock_wot(DATA_DIR)
    stock_wot = dict(zip(rpms, M.stock_on_axis(rpms, stock_wot_map)))
    sim_wot = {r: cells[(r, 100)]["ve"] for r in rpms if (r, 100) in cells}

    def score(rpm, load):
        c = cells.get((rpm, load))
        if c is None:
            return None, "?", " "
        flag = "" if c["valid"] else "!"
        if load >= 100:
            sw = stock_wot.get(rpm)
            if sw is None:
                return None, "?", " "
            d = c["ve"] - sw
            v = "G" if abs(d) <= 5 else "a" if abs(d) <= 10 else "R"
            return d, f"{d:+.0f}{flag}", v
        sw, ow = sim_wot.get(rpm), stock_wot.get(rpm)
        if not sw or not ow or (rpm, 100) not in cells:
            return None, "?", " "
        if not cells[(rpm, 100)]["valid"]:
            flag = flag or "~"   # denominator itself unconverged
        p_sim = c["ve"] / sw
        p_stock = _lut(MAPS["kf_rf_soll"], rpm, load) * 100.0 / ow
        dp = abs(p_sim - p_stock)
        v = "G" if dp <= 0.06 else "a" if dp <= 0.12 else "R"
        return dp, f"{dp:.2f}{flag}", v

    print("# full-map heatmap: load=100 -> Delta pp (G<=5,a<=10); part load -> "
          "dp (G<=0.06,a<=0.12); '!'=cell FLAG, '~'=WOT denom FLAG, '?'=missing")
    hdr = "load\\rpm" + "".join(f"{r:>7}" for r in rpms)
    print(hdr)
    counts = {"G": 0, "a": 0, "R": 0}
    reds = []
    for load in loads:
        line = f"{load:>8}"
        for rpm in rpms:
            val, txt, v = score(rpm, load)
            line += f"{txt:>7}"
            if v in counts:
                counts[v] += 1
                if v == "R":
                    reds.append((rpm, load, txt))
        print(line)
    total = sum(counts.values())
    print(f"\n# verdicts: GREEN {counts['G']}/{total}  amber {counts['a']}  "
          f"RED {counts['R']}")
    if reds:
        print("# RED cells: " + "  ".join(f"{r}/{l}={t}" for r, l, t in reds))
    print("# NOTE: 3900/100 is the documented permanent model limit.")


if __name__ == "__main__":
    main()

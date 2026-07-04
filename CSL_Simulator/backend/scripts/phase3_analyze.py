#!/usr/bin/env python3
"""Phase-3 WOT shape analysis over run_cells_local CSVs.

For each --tag: aligns the tag's WOT cells (load>=85) on the rpm axis, compares
against the measured wideband stock row (stock_csl_ve.json) with the §5 shape
metrics (health-gated cells excluded), prints a table. Optionally writes the
winner row to calib_data/phase3_wot_row.json (--emit-wot-row TAG [--base B]).

  python phase3_analyze.py --csv ../calib_data/phase3_wotcmp.csv \
      --tags p3-plenum,p3-rail
  python phase3_analyze.py --csv ../calib_data/phase3_basefit.csv \
      --tags b140 --emit-wot-row b140 --base 140
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator import metrics as M  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
OUT = os.path.join(HERE, "calib_data")


def rows_of(csv_path, tag):
    out = {}
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("tag") != tag or float(row["load"]) < M.WOT_TPS:
                continue
            out[float(row["rpm"])] = row      # last write wins (resume overwrite)
    return out


def analyze(csv_path, tag):
    cells = rows_of(csv_path, tag)
    rpms = sorted(cells)
    stock = M.load_stock_wot(DATA_DIR)
    stock_axis = M.stock_on_axis(rpms, stock)
    sim_row, healths = [], []
    for r in rpms:
        c = cells[r]
        sim_row.append(float(c["ve"]))
        healths.append({"converged": c["converged"] == "1",
                        "cyl_ok": c["cyl_ok"] == "1",
                        "ve_in_band": not (c["blew_up"] == "1")
                        and M.VE_BAND[0] <= float(c["ve"]) <= M.VE_BAND[1]})
    row = M.row_metrics(100.0, sim_row, stock_axis, rpms, healths)
    row["rpms"] = rpms
    row["sim"] = sim_row
    row["stock"] = [round(s, 1) if s else s for s in stock_axis]
    row["mean_norm"] = [round(v / (sum(x for x in sim_row) / len(sim_row)), 3)
                        for v in sim_row]
    return row, cells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--tags", required=True)
    ap.add_argument("--emit-wot-row", default=None,
                    help="tag whose cells become calib_data/phase3_wot_row.json")
    ap.add_argument("--base", type=float, default=150.0,
                    help="the EXVANOS base these WOT cells ran at (recorded)")
    ap.add_argument("--alpha", type=float, default=None)
    args = ap.parse_args()

    for tag in args.tags.split(","):
        row, cells = analyze(args.csv, tag)
        print(f"\n== {tag} ==")
        print(f" rpm   sim    stock  norm(sim)")
        for r, s, k, n in zip(row["rpms"], row["sim"], row["stock"], row["mean_norm"]):
            h = cells[r]
            flag = "" if h["valid"] == "1" else "  <-- gated"
            print(f"{int(r):>5} {s:>6.1f} {k:>6.1f}  {n:.3f}{flag}")
        print(f" r={row['r']} shape_err={row['max_shape_err']} "
              f"peak={row['peak_rpm_sim']}(stock {row['peak_rpm_stock']}) "
              f"range={row['range_sim_pp']}/{row['range_stock_pp']} "
              f"gated={row['n_gated']} status={row['status']}")

    if args.emit_wot_row:
        row, cells = analyze(args.csv, args.emit_wot_row)
        doc = {"tag": args.emit_wot_row, "base": args.base,
               "alpha": args.alpha,
               "ve_by_rpm": {str(int(r)): float(cells[r]["ve"]) for r in row["rpms"]
                             if cells[r]["valid"] == "1"},
               "metrics": {k: row[k] for k in ("r", "max_shape_err", "peak_rpm_sim",
                                               "range_sim_pp", "n_gated")}}
        out = os.path.join(OUT, "phase3_wot_row.json")
        json.dump(doc, open(out, "w"), indent=2)
        print("\nwrote", out)


if __name__ == "__main__":
    main()

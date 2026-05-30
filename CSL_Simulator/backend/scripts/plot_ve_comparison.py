#!/usr/bin/env python3
"""Plot the first-cycle simulated VE against the stock CSL VE curve.

Reads /tmp/ve_first_cycle.csv (produced by ve_first_cycle_sweep.py) and writes
a PNG comparison. The simulated curve is FIRST-CYCLE (pre-freeze) data, so it is
a trend indicator, not a converged result -- see EXHAUST_STABILIZATION_NOTES.md.
"""
import csv, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

csv_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ve_first_cycle.csv"
out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/ve_comparison.png"

rpm, ve_sim, ve_stk = [], [], []
with open(csv_path) as f:
    for r in csv.DictReader(f):
        try:
            vs = float(r["ve_sim_pct"])
        except (ValueError, KeyError):
            vs = float("nan")
        rpm.append(int(r["rpm"]))
        ve_sim.append(vs)
        ve_stk.append(float(r["ve_stock_pct"]))

fig, ax = plt.subplots(figsize=(10, 6))
ax.plot(rpm, ve_stk, "o-", color="#1f77b4", lw=2, ms=7, label="Stock CSL VE (reference)")
ax.plot(rpm, ve_sim, "s--", color="#d62728", lw=2, ms=7,
        label="OpenWAM (first-cycle, pre-freeze)")
for x, y in zip(rpm, ve_sim):
    if y == y:
        ax.annotate(f"{y:.0f}", (x, y), textcoords="offset points",
                    xytext=(0, 8), ha="center", fontsize=8, color="#d62728")

ax.set_xlabel("Engine speed (RPM)")
ax.set_ylabel("Volumetric efficiency (%)")
ax.set_title("S54 CSL — Volumetric Efficiency: OpenWAM (first-cycle) vs Stock")
ax.grid(True, alpha=0.3)
ax.legend(loc="best")
ax.set_ylim(60, 140)
fig.tight_layout()
fig.savefig(out_path, dpi=120)
print(f"wrote {out_path}")

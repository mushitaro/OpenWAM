#!/usr/bin/env python3
"""Plot VE vs RPM at fixed cam timing against the stock CSL curve.

Reads a whitespace table (RPM trap_g VE% stock% NaN) on stdin or a file and
writes a PNG. Used to judge whether the intake is over-resonant (jagged VE) or
healthy (smooth broad tuning peak).
"""
import sys, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/rs_out.txt"
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/ve_vs_rpm.png"
rpm, ve, stk = [], [], []
for line in open(path):
    m = re.match(r"\s*(\d+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)", line)
    if m:
        rpm.append(int(m.group(1))); ve.append(float(m.group(3))); stk.append(float(m.group(4)))

fig, ax = plt.subplots(figsize=(10, 6))
ax.plot(rpm, stk, "o-", color="#1f77b4", lw=2, ms=7, label="Stock CSL VE")
ax.plot(rpm, ve, "s--", color="#d62728", lw=2, ms=7, label="OpenWAM (fixed S54 cam, HLLC, converged)")
for x, y in zip(rpm, ve):
    ax.annotate(f"{y:.0f}", (x, y), textcoords="offset points", xytext=(0, 8),
                ha="center", fontsize=8, color="#d62728")
ax.set_xlabel("Engine speed (RPM)"); ax.set_ylabel("Volumetric efficiency (%)")
ax.set_title("S54 CSL VE vs RPM — OpenWAM (fixed cam) vs Stock")
ax.grid(True, alpha=0.3); ax.legend(loc="best"); ax.set_ylim(0, max(160, max(ve+stk)+10))
fig.tight_layout(); fig.savefig(out, dpi=120)
print(f"wrote {out}")

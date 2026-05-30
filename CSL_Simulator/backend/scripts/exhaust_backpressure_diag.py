#!/usr/bin/env python3
"""Localise the exhaust back-pressure: is the ~1.8 bar at overlap a physical
restriction or a model artifact?

Runs one WOT point (HLLC) producing <model>INS.DAT, then reports, over the last
converged cycle:
  - cylinder pressure during the EXHAUST STROKE (mean/peak) = the back-pressure
    the piston pushes against;
  - the time-mean static pressure at each exhaust station from port -> tail, so
    the pressure DROP per component shows WHERE the restriction sits. A big drop
    across one part (cat / muffler / a junction) points to an over-stated loss
    (a fixable model bug); a smooth, modest gradient points to physical reality.

Usage: exhaust_backpressure_diag.py [rpm]
"""
import os, io, sys, subprocess, re, statistics, math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
RPM = float(sys.argv[1]) if len(sys.argv) > 1 else 4000.0

# Current exhaust topology (bank-L chain), pipe_id -> (label, length_m)
EXH_CHAIN = [
    (39, "Port_Ex_1_1", 0.090),
    (41, "Header_1",     0.300),
    (57, "Col_Out_L",    0.500),
    (59, "Sec1_1_L",     0.600),
    (61, "FrontCat_L",   0.200),
    (63, "Sec1_2_L",     0.400),
    (65, "Sec2_1_L",     0.400),
    (70, "Sec2_2_L",     0.800),
    (72, "Muf_Adapter_L",0.150),
    (74, "Tail_1",       0.150),
]

os.environ["OPENWAM_IVO"] = "330.0"
os.environ["OPENWAM_HLLC"] = "1"
cfg = SimConfig()
cfg.engine.rpm = RPM
cfg.engine.throttle_position = 1.0
cfg.simulation.duration_cycles = 8
cfg.exhaust.port_junction_vol = 0.0
buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
gen = WAMGenerator(cfg, output_dir="/tmp"); content = gen.generate(ignition_timing=20.0)
sys.stdout = old
model = "exbp"
open(f"/tmp/{model}.wam", "w").write(content)
print(f"Running {RPM:.0f} RPM WOT, HLLC, 8 cycles ...")
subprocess.run(["timeout", "120", "env", "OMP_NUM_THREADS=1", BIN, f"/tmp/{model}.wam"],
               capture_output=True, text=True, errors="ignore")

ins = f"/tmp/{model}INS.DAT"
if not os.path.exists(ins):
    print("ERROR: no INS.DAT produced"); sys.exit(1)

with open(ins, errors="ignore") as f:
    cols = f.readline().rstrip("\n").split("\t")
    rows = f.readlines()

def col(idx_name_prefix):
    for i, c in enumerate(cols):
        if c.startswith(idx_name_prefix):
            return i
    return None

c_ang = col("Angle(deg)")
c_pcyl = col("Pressure_Cyl_1(bar)")
exh_cols = {pid: col(f"P_duct_{pid}_at_0_m") for pid, _, _ in EXH_CHAIN}

# Use the LAST cycle worth of rows (720 deg). Find last-cycle slice by angle wrap.
n = len(rows)
last = rows[int(n * 0.85):]
def fnum(parts, i):
    try:
        v = float(parts[i]);  return v if -50 < v < 500 else None
    except (ValueError, IndexError, TypeError):
        return None

pcyl_all, pcyl_exh = [], []
station = {pid: [] for pid, _, _ in EXH_CHAIN}
for line in last:
    p = line.rstrip("\n").split("\t")
    ang = fnum(p, c_ang)
    pc = fnum(p, c_pcyl)
    if pc is not None:
        pcyl_all.append(pc)
        # Exhaust stroke ~ 100..360 deg (EVO 102 ATDC-combustion -> gas-exch TDC)
        if ang is not None and 110.0 <= (ang % 720) <= 350.0:
            pcyl_exh.append(pc)
    for pid in station:
        v = fnum(p, exh_cols[pid]) if exh_cols[pid] is not None else None
        if v is not None:
            station[pid].append(v)

def stats(xs):
    if not xs: return (float("nan"),) * 3
    return (statistics.mean(xs), min(xs), max(xs))

print(f"\n=== Cylinder-1 pressure (last cycle, n={len(pcyl_all)}) ===")
m, lo, hi = stats(pcyl_all)
print(f"  full cycle : mean {m:.2f}  min {lo:.2f}  max {hi:.2f} bar")
m, lo, hi = stats(pcyl_exh)
print(f"  EXH stroke : mean {m:.2f}  min {lo:.2f}  max {hi:.2f} bar  <- back-pressure seen by piston")
print(f"  (real CSL WOT exhaust back-pressure ~1.1-1.3 bar abs)")

print(f"\n=== Exhaust static-pressure profile (time-mean, last cycle) ===")
print(f"{'station':<16}{'mean':>7}{'min':>7}{'max':>7}{'drop_to_next':>13}")
prev = None
for pid, label, length in EXH_CHAIN:
    m, lo, hi = stats(station[pid])
    drop = "" if prev is None else f"{prev - m:+.3f}"
    print(f"{label:<16}{m:>7.3f}{lo:>7.3f}{hi:>7.3f}{drop:>13}")
    prev = m
print("  (drop_to_next = mean pressure lost from the PREVIOUS station to this one)")

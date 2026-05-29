#!/usr/bin/env python3
"""Measure OpenWAM progress-rate vs exhaust port-junction volume.

For each volume (cc) it generates a WAM, runs OpenWAM for a fixed wall-clock
budget, and records how far (% of the run) it got plus any divergence markers.
This finds the smallest junction volume (best port-wave fidelity) that still
makes the 480-point VE sweep feasible.

Writes a machine-readable report to /tmp/vol_scan_report.txt.
Usage: vol_scan.py [budget_s] [vols_csv]   e.g. vol_scan.py 60 20,50,100
"""
import sys, io, os, re, subprocess, time

BUDGET = int(sys.argv[1]) if len(sys.argv) > 1 else 60
VOLS = [float(x) for x in (sys.argv[2].split(",") if len(sys.argv) > 2
                            else ["20", "50", "100"])]
RPM = 4000.0
CYCLES = 10

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

binr = "/home/user/OpenWAM/build/bin/release/OpenWAM"
report = []

for vol in VOLS:
    cfg = SimConfig()
    cfg.engine.rpm = RPM
    cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = CYCLES
    cfg.exhaust.port_junction_vol = vol

    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    gen = WAMGenerator(cfg, output_dir='.')
    content = gen.generate(ignition_timing=27.0)
    sys.stdout = old

    wam = f"/tmp/vscan_{int(vol)}.wam"
    log = f"/tmp/vscan_{int(vol)}.log"
    open(wam, "w").write(content)

    t0 = time.time()
    with open(log, "wb") as lf:
        p = subprocess.Popen(["timeout", str(BUDGET), binr, wam],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        written, cap = 0, 5_000_000
        for chunk in iter(lambda: p.stdout.read(65536), b""):
            if written < cap:
                lf.write(chunk[: cap - written]); written += len(chunk)
        p.wait()
    dt = time.time() - t0

    t = open(log, encoding="utf-8", errors="ignore").read()
    prog = [int(x) for x in re.findall(r"Progress\s*:\s*(\d+)", t)]
    maxp = max(prog) if prog else 0
    nan = len(re.findall(r"DEBUG BC NaN", t))
    abort = len(re.findall(r"ERROR : in time step", t))
    rate = maxp / dt if dt > 0 else 0.0
    # est. wall to finish one 10-cycle point, and 480 points at 8x parallel
    est_point = (100.0 / rate) if rate > 0 else float("inf")
    est_480 = est_point * 480 / 8 / 3600.0  # hours
    report.append(dict(vol=vol, maxp=maxp, dt=round(dt, 1),
                       rate=round(rate, 3), nan=nan, abort=abort,
                       est_point_s=round(est_point), est_480_h=round(est_480, 1)))

with open("/tmp/vol_scan_report.txt", "w") as f:
    f.write(f"budget={BUDGET}s rpm={RPM} cycles={CYCLES}\n")
    f.write(f"{'vol_cc':>7} {'maxp%':>6} {'dt_s':>6} {'%/s':>7} "
            f"{'NaN':>4} {'abort':>5} {'est_pt_s':>9} {'est_480_h@8x':>13}\n")
    for r in report:
        f.write(f"{r['vol']:7.0f} {r['maxp']:6d} {r['dt']:6.1f} {r['rate']:7.3f} "
                f"{r['nan']:4d} {r['abort']:5d} {r['est_point_s']:9} "
                f"{r['est_480_h']:13}\n")
print("wrote /tmp/vol_scan_report.txt")

#!/usr/bin/env python3
"""Resumable EXHAUST-VANOS-base sweep for part-load VE calibration.

Stage 47 coordinated the exhaust cam (vanos_exhaust_bias = EXVANOS_BASE - kf_avan1_soll),
calibrating EXVANOS_BASE=150 on the WOT row. At part load the same base over/under-
corrects the overlap, so the sim mis-tracks stock (sim/stock ~0.5-0.8 at load 45/20).
This sweep varies EXVANOS_BASE per (rpm, load) cell so the per-row optimum (the base that
reproduces kf_rf_soll) can be fitted into a load-dependent law.

Robust to the ~7-15 min container reboots: results append to a CSV after every batch and
finished (rpm,load,base) triples are skipped, so just re-invoke after each reboot.

RUN SPEED / THREADS (important): a 30-cycle part-load run is ~26 s/cycle single-threaded
(~13 min), which NEVER survives the 7-15 min reboot window -- so the old OMP_NUM_THREADS=1
runs were all timeout-truncated mid-climb (cyc 12-17), not converged. Verified that OMP=4
reproduces the OMP=1 physics faithfully (per-cylinder Mtrap matches within ~1%, incl. the
real cyl-2 part-load collapse) at ~2.3x speed, so each run finishes in ~5 min INSIDE a
reboot window. We therefore run cells SERIALLY with OMP=4 (not parallel/OMP=1) and append
the CSV after EVERY cell, so a reboot loses only the in-flight cell.

Env knobs:
  SWEEP_CYCLES   duration_cycles (default 30; the intake needs ~25-30 to converge)
  SWEEP_TIMEOUT  per-run timeout in seconds (default 480 -- 30 cyc * ~11 s/cyc OMP=4 + margin)
  SWEEP_OMP      OpenMP threads per run (default 4; serial cells)
  SWEEP_MAXCELLS cells to attempt this invocation (default 99 = chew through all TODO)
  SWEEP_GRID     "all" (default, the JOBS grid below) or "load65" (the load-65 gate re-check)
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
CYCLES = int(os.environ.get("SWEEP_CYCLES", "30"))
TIMEOUT = os.environ.get("SWEEP_TIMEOUT", "480")
OMP = os.environ.get("SWEEP_OMP", "4")
MAXCELLS = int(os.environ.get("SWEEP_MAXCELLS", "99"))
GRID = os.environ.get("SWEEP_GRID", "all")
CSV = os.environ.get("SWEEP_CSV", "/tmp/exvanos_sweep.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm, load): return lut(M["kf_rf_soll"], rpm, load)*100
def aval(rpm, load):  return lut(M["kf_avan1_soll"], rpm, load)
def eval_(rpm, load): return lut(M["kf_evan1_soll"], rpm, load)

# (rpm, load, exvanos_base). Default grid: 3900-column part load, 3 bases to bracket the
# sign and optimum, plus base=150 (current default) for reference.
if GRID == "load65":
    # gate re-check: the four load-65 cells at the default base, 30 cycles
    JOBS = [(r, 65.0, 150.0) for r in (2700, 3900, 5300, 6900)]
else:
    JOBS = []
    for load in (65.0, 45.0, 20.0):
        for base in (110.0, 150.0, 190.0):
            JOBS.append((3900, load, base))

def done_cells():
    d = set()
    if os.path.exists(CSV):
        for row in csv.reader(open(CSV)):
            if len(row) >= 3 and row[0] != "rpm":
                d.add((int(row[0]), int(float(row[1])), int(float(row[2]))))
    return d

def gate(t, n=6, tol=0.20):
    ms = [float(x) for x in re.findall(r"VEDIAG Cyl:\d+ .*?Mtrap:([0-9.]+) g", t)]
    if len(ms) < n: return float("nan"), False, len(ms)//6
    seg = ms[-n:]; med = statistics.median(seg)
    if med <= 0: return float("nan"), False, len(ms)//6
    sp = max(abs(x-med) for x in seg)/med
    return statistics.mean(seg)/M_REF*100, sp <= tol, len(ms)//6

def gen(rpm, load, base, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = float(load/100.0)
    cfg.engine.vanos_intake_bias = float(130.0 - eval_(rpm, load))
    cfg.engine.vanos_exhaust_bias = float(base - aval(rpm, load))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)   # generate() writes intake.vlv/exhaust.vlv into wd itself

def run_cell(rpm, load, base):
    """Run ONE cell serially with OMP threads; append its row immediately."""
    wd = f"/tmp/ex_{rpm}_{int(load)}_{int(base)}"; gen(rpm, load, base, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP; env["OPENWAM_VEDIAG"]="1"
    subprocess.run(["timeout", TIMEOUT, BIN, "m.wam"], cwd=wd,
                   stdout=open(wd+"/run.log", "wb"), stderr=subprocess.STDOUT, env=env)
    t = open(wd+"/run.log", encoding="utf-8", errors="ignore").read()
    ve, ok, cyc = gate(t)
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm", "load", "base", "exbias", "stock", "sim", "valid", "cyc"])
        w.writerow([rpm, int(load), int(base), f"{base-aval(rpm,load):.1f}",
                    f"{stock(rpm,load):.1f}", f"{ve:.1f}", 1 if ok else 0, cyc])
    return ve, ok, cyc

todo = [j for j in JOBS if (j[0], int(j[1]), int(j[2])) not in done_cells()]
for rpm, load, base in todo[:MAXCELLS]:
    ve, ok, cyc = run_cell(rpm, load, base)
    print(f"  ran {rpm}/{int(load)} base{int(base)} -> sim {ve:.1f} {'OK' if ok else 'REJ'} cyc{cyc}", flush=True)

# ---- print accumulated sweep ----
rows = []
if os.path.exists(CSV):
    for row in csv.reader(open(CSV)):
        if len(row) >= 8 and row[0] != "rpm":
            rows.append(row)
done = done_cells()
print(f"# EXVANOS base sweep  ({len([j for j in JOBS if (j[0],int(j[1]),int(j[2])) in done])}/{len(JOBS)} jobs done, CYCLES={CYCLES}, grid={GRID})")
print(f"# rpm load  base  exbias  stock   sim   valid cyc   sim/stock")
for r in sorted(rows, key=lambda x: (int(x[0]), -float(x[1]), float(x[2]))):
    rpm, load, base, exbias, st, sim, ok, cyc = r[:8]
    ratio = (float(sim)/float(st)) if float(st) > 0 and sim != "nan" else float("nan")
    print(f"  {rpm:>4} {load:>4} {base:>5} {exbias:>6}  {st:>5} {sim:>5}   {'OK ' if ok=='1' else 'REJ'} {cyc:>3}   {ratio:.2f}")

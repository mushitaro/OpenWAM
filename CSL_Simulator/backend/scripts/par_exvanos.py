#!/usr/bin/env python3
"""Parallel DETERMINISTIC EXVANOS_BASE sweep (Step 3) -- base x rpm at fixed load.

Fits EXVANOS_BASE(rpm,load): for each (rpm,load) the exhaust-cam coordination is
vanos_exhaust_bias = base - kf_avan1_soll(rpm,load); varying `base` moves the valve
overlap (and hence the intake resonance / scavenging), so the per-cell base that makes
sim VE == stock VE is the calibration. Lower base = more overlap = higher VE.

MUST run omp1 (PV_OMP=1): omp>1 is non-deterministic at the WOT bifurcation (Step 2e).
Decks generated sequentially (env-mutating), OpenWAM cells run in a thread pool, resumable.

Env: PV_RPMS, PV_BASES, PV_LOAD(100), PV_CYCLES(55), PV_OMP(1), PV_CONC(16),
PV_TIMEOUT(6000), PV_CSV. Per-cell cylinder-balance gate (valid flag) included.
"""
import sys, os, io, re, json, math, statistics, csv, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_until_converged
# Stage 56: calibration tools need only VEDIAG -> drop the heavy 75-pipe
# instantaneous monitoring (pure I/O) for a big per-cell speedup.
os.environ["OPENWAM_FAST_OUTPUT"] = "1"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("PV_RPMS", "2700,3900,4600,5300,6300,6900").split(",")]
BASES = [float(x) for x in os.environ.get("PV_BASES", "90,120,150,180").split(",")]
# Mouth acoustic-radiation damping alpha(s) (runtime env OPENWAM_MOUTH_RAD; deck-independent
# so decks are reused across rad values). PV_RADW = the EMA weight. 0.0 = legacy/off.
RADS = [float(x) for x in os.environ.get("PV_RADS", "0").split(",")]
RADW = os.environ.get("PV_RADW", "0.02")
LOAD = float(os.environ.get("PV_LOAD", "100"))
CYCLES = int(os.environ.get("PV_CYCLES", "55"))
OMP = os.environ.get("PV_OMP", "1")
CONC = int(os.environ.get("PV_CONC", "16"))
TIMEOUT = os.environ.get("PV_TIMEOUT", "6000")
CSV = os.environ.get("PV_CSV", "/tmp/par_exvanos.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm, load): return lut(M["kf_rf_soll"], rpm, load)*100
def aval(rpm, load):  return lut(M["kf_avan1_soll"], rpm, load)
def eval_(rpm, load): return lut(M["kf_evan1_soll"], rpm, load)

def metrics(t):
    """all-cyl VE, healthy-cyl VE, ncol, slope, ncyc, cyl-balance-OK."""
    pairs = re.findall(r"VEDIAG Cyl:(\d+) .*?Mtrap:([0-9.]+) g", t)
    if len(pairs) < 12: return (float("nan"),)*2 + (-1, float("nan"), len(pairs)//6, False)
    ncyc = len(pairs)//6
    ms = [float(m) for _, m in pairs]
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(ncyc)]
    slope = (cyc_ve[-1]-cyc_ve[-5])/4 if ncyc >= 5 else float("nan")
    last = {}
    for c, m in pairs[-12:]: last.setdefault(int(c), []).append(float(m))
    means = {c: statistics.mean(v) for c, v in last.items()}
    med = statistics.median(means.values())
    healthy = [v for v in means.values() if v >= 0.5*med]
    ve_all = statistics.mean(list(means.values()))/M_REF*100
    ve_h = (statistics.mean(healthy)/M_REF*100) if healthy else float("nan")
    spread = max(abs(v-med) for v in means.values())/med if med > 0 else 9.9
    return ve_all, ve_h, len(means)-len(healthy), slope, ncyc, (spread <= 0.20)

def gen(rpm, base, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = float(LOAD/100.0)
    cfg.engine.vanos_intake_bias = float(130.0 - eval_(rpm, LOAD))
    cfg.engine.vanos_exhaust_bias = float(base - aval(rpm, LOAD))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 3 and r[0] != "rpm": d.add((int(r[0]), float(r[1]), float(r[2])))
    return d

_lock = threading.Lock()
def run_cell(rpm, base, rad):
    wd = os.path.abspath(f"/tmp/pv_{rpm}_{int(base)}_{int(LOAD)}")
    env = os.environ.copy(); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = OMP
    env["OPENWAM_VEDIAG"] = "1"; env["OPENWAM_THR_CHOKE"] = "1"
    if rad > 0:
        env["OPENWAM_MOUTH_RAD"] = str(rad); env["OPENWAM_MOUTH_RAD_W"] = RADW
    else:
        env.pop("OPENWAM_MOUTH_RAD", None); env.pop("OPENWAM_MOUTH_RAD_W", None)
    log = wd + f"/run_rad{rad}.log"
    run_until_converged([BIN, "m.wam"], wd, log, TIMEOUT, env)
    ve_all, ve_h, ncol, slope, ncyc, ok = metrics(open(log, encoding="utf-8", errors="ignore").read())
    with _lock:
        new = not os.path.exists(CSV)
        with open(CSV, "a", newline="") as f:
            w = csv.writer(f)
            if new: w.writerow(["rpm", "base", "rad", "radw", "load", "stock", "ve_all", "ve_h", "ncol", "slope", "cyc", "valid"])
            w.writerow([rpm, base, rad, RADW, int(LOAD), f"{stock(rpm,LOAD):.1f}", f"{ve_all:.1f}", f"{ve_h:.1f}",
                        ncol, f"{slope:+.2f}", ncyc, 1 if ok else 0])
    return rpm, base, rad, ve_h, slope, ncyc, ok

jobs = [(rpm, base, rad) for rad in RADS for base in BASES for rpm in RPMS]
dn = done()
todo = [j for j in jobs if (j[0], j[1], j[2]) not in dn]
print(f"# EXVANOS base sweep (load={LOAD}): {len(todo)}/{len(jobs)} TODO, conc={CONC} omp={OMP} cyc={CYCLES} radw={RADW}", flush=True)
# generate decks once per (rpm,base) (shared across rad values)
for rpm, base in {(j[0], j[1]) for j in todo}:
    gen(rpm, base, os.path.abspath(f"/tmp/pv_{rpm}_{int(base)}_{int(LOAD)}"))
with ThreadPoolExecutor(max_workers=CONC) as ex:
    futs = {ex.submit(run_cell, rpm, base, rad): (rpm, base, rad) for rpm, base, rad in todo}
    for fut in as_completed(futs):
        rpm, base, rad, ve, slope, ncyc, ok = fut.result()
        print(f"  {rpm} base{int(base)} rad{rad} -> VE_h {ve:.1f} slope{slope:+.2f} cyc{ncyc} {'OK' if ok else 'REJ'} (stock {stock(rpm,LOAD):.0f})", flush=True)

# report: VE_h vs base for each (rpm, rad) -- shows whether radiation damping smooths VE(base)
print(f"\n# ==== VE_h vs base per rad @ load {LOAD:.0f} (smooth across base = monostabilized) ====")
rows = [r for r in csv.reader(open(CSV)) if len(r) >= 12 and r[0] != "rpm"] if os.path.exists(CSV) else []
bs = sorted({float(r[1]) for r in rows}); rds = sorted({float(r[2]) for r in rows})
for rpm in RPMS:
    seg = {(float(r[1]), float(r[2])): float(r[7]) for r in rows if int(r[0]) == rpm}
    if not seg: continue
    print(f"\n  rpm {rpm} (stock {stock(rpm,LOAD):.0f}):  base-> " + " ".join(f"{int(b):>4}" for b in bs))
    for rad in rds:
        vals = [seg.get((b, rad)) for b in bs]
        # jaggedness metric: mean abs successive difference (low = smooth)
        diffs = [abs(vals[i+1]-vals[i]) for i in range(len(vals)-1) if vals[i] is not None and vals[i+1] is not None]
        jag = sum(diffs)/len(diffs) if diffs else float('nan')
        line = f"    rad {rad:<4} VE-> " + " ".join(f"{v:>4.0f}" if v is not None else "   -" for v in vals)
        print(line + f"   |jag={jag:.1f}|")
print("# done", flush=True)

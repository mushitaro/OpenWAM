#!/usr/bin/env python3
"""Parallel coordinated-WOT runner-length sweep (local multi-core).

Same physics as runner_tune_wot.py (coordinated stock VANOS at WOT, choke BC +
init-MAP on, Mtrap-based VE, slope-judged convergence) but built for the local
box: it generates ALL decks first (sequential, since deck-gen mutates os.environ
to bake in OPENWAM_RUNNER_SC), then runs the OpenWAM cells CONCURRENTLY in a
thread pool. Resumable (merged CSV, done-cell skip). Prints the same
peak-normalised VE-shape report as runner_tune_wot.py at the end.

Env: PS_RPMS, PS_SCS, PS_CYCLES(50), PS_OMP(4), PS_CONC(4), PS_TIMEOUT(3000), PS_CSV
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
RPMS = [int(x) for x in os.environ.get("PS_RPMS", "2700,3900,4600,5300,6300,6900").split(",")]
SCS = [float(x) for x in os.environ.get("PS_SCS", "1.0,1.2,1.4,1.7,2.0").split(",")]
CYCLES = int(os.environ.get("PS_CYCLES", "50"))
OMP = os.environ.get("PS_OMP", "4")
CONC = int(os.environ.get("PS_CONC", "4"))
TIMEOUT = os.environ.get("PS_TIMEOUT", "3000")
CSV = os.environ.get("PS_CSV", "/tmp/par_sweep_wot.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm): return lut(M["kf_rf_soll"], rpm, 100)*100
def aval(rpm):  return lut(M["kf_avan1_soll"], rpm, 100)
def eval_(rpm): return lut(M["kf_evan1_soll"], rpm, 100)

def metrics(t):
    ms = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", t)]
    n = len(ms)//6
    if n < 5: return float("nan"), float("nan"), n
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(n)]
    return cyc_ve[-1], (cyc_ve[-1]-cyc_ve[-5])/4, n

def gen(rpm, sc, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"; os.environ["OPENWAM_RUNNER_SC"] = str(sc)
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.engine.vanos_intake_bias = float(130.0 - eval_(rpm))   # stock WOT VANOS
    cfg.engine.vanos_exhaust_bias = float(150.0 - aval(rpm))   # stock-coordinated
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 2 and r[0] != "rpm": d.add((int(r[0]), float(r[1])))
    return d

_lock = threading.Lock()
def run_cell(rpm, sc):
    wd = os.path.abspath(f"/tmp/rt_{rpm}_{sc}")
    env = os.environ.copy(); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = OMP
    env["OPENWAM_VEDIAG"] = "1"; env["OPENWAM_THR_CHOKE"] = "1"
    run_until_converged([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    with _lock:
        new = not os.path.exists(CSV)
        with open(CSV, "a", newline="") as f:
            w = csv.writer(f)
            if new: w.writerow(["rpm", "sc", "stock", "ve", "slope", "cyc"])
            w.writerow([rpm, sc, f"{stock(rpm):.1f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return rpm, sc, ve, slope, n

jobs = [(rpm, sc) for sc in SCS for rpm in RPMS]
dn = done()
todo = [j for j in jobs if (j[0], j[1]) not in dn]
print(f"# par-sweep WOT: {len(todo)}/{len(jobs)} cells TODO, conc={CONC} omp={OMP} cyc={CYCLES}", flush=True)
# 1) generate all decks sequentially (env-mutating; cheap, no simulation)
for rpm, sc in todo:
    gen(rpm, sc, os.path.abspath(f"/tmp/rt_{rpm}_{sc}"))
# 2) run OpenWAM cells concurrently
with ThreadPoolExecutor(max_workers=CONC) as ex:
    futs = {ex.submit(run_cell, rpm, sc): (rpm, sc) for rpm, sc in todo}
    for fut in as_completed(futs):
        rpm, sc, ve, slope, n = fut.result()
        print(f"  {rpm} sc={sc} -> VE {ve:.1f} slope{slope:+.2f} cyc{n} (stock {stock(rpm):.0f})", flush=True)

# report: VE-shape per SC, normalised to each curve's own peak, vs stock-normalised
print("\n# ==== WOT VE-shape vs runner length (normalised to each curve peak) ====")
rows = [r for r in csv.reader(open(CSV)) if len(r) >= 6 and r[0] != "rpm"] if os.path.exists(CSV) else []
allscs = sorted({float(r[1]) for r in rows})
stk = {rpm: stock(rpm) for rpm in RPMS}
stkpk = max(stk.values()) if stk else 1
print("  rpm   stock(norm) " + " ".join(f"sc{sc}(norm)" for sc in allscs))
for rpm in RPMS:
    line = f"  {rpm:>4}   {stk[rpm]/stkpk:.2f}        "
    for sc in allscs:
        v = [float(r[3]) for r in rows if int(r[0]) == rpm and abs(float(r[1])-sc) < 1e-6]
        if v and v[0] == v[0]:
            pk = max((float(r[3]) for r in rows if abs(float(r[1])-sc) < 1e-6 and float(r[3]) == float(r[3])), default=float("nan"))
            line += f"  {v[0]/pk:.2f}    " if pk == pk and pk else "   -     "
        else:
            line += "   -     "
    print(line)
print(f"\n# stock WOT peak rpm: {max(stk, key=stk.get)} ; sim peak rpm per sc:")
for sc in allscs:
    seg = [(int(r[0]), float(r[3])) for r in rows if abs(float(r[1])-sc) < 1e-6 and float(r[3]) == float(r[3])]
    if seg: print(f"   sc={sc}: peak at {max(seg, key=lambda x: x[1])[0]} rpm")
print("# done", flush=True)

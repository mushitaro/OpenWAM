#!/usr/bin/env python3
"""Parallel coordinated-WOT diagnostic sweep over NAMED CONFIGS x rpm (local multi-core).

Step 2 fork diagnosis. Each config is a label + a dict of env overrides applied at
deck-generation time (RUNNER_SC, INTAKE_V2, INTAKE_MOUTH_CD, NO_EQTUBE, EQ_DIA,
PORT_TWALL, ...). All cells use coordinated stock VANOS at WOT, choke+init-MAP on,
Mtrap VE, slope-judged convergence. Same parallel machinery as par_sweep_wot.py
(decks generated sequentially since deck-gen mutates os.environ; OpenWAM cells run
in a thread pool; resumable). Prints a mean-normalised shape table + range/tilt vs
stock for each config.

Edit CONFIGS below for each diagnostic. Env: PC_RPMS, PC_CYCLES(55), PC_OMP(4),
PC_CONC(4), PC_TIMEOUT(4000), PC_CSV.
"""
import sys, os, io, re, json, math, statistics, csv, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_capped
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

# ---- the diagnostic matrix (label -> env overrides applied during deck gen) ----
# DETERMINISTIC re-run (must use PC_OMP=1 -- omp>1 is non-deterministic at the WOT
# bifurcation, Step 2e). Stage 56: re-test RUNNER LENGTH with the C++ mouth radiation
# damping ON (export OPENWAM_MOUTH_RAD=0.4) -- Step 1's "length can't move the peak" was
# measured on the CHAOTIC pre-damping model; now monostable, does longer runner cleanly
# walk the ram peak 5300 -> 3900? Cams coordinated at the UN-FUDGED base 150 so the peak
# location reflects intake physics, not EXVANOS_BASE compensation.
CONFIGS = [
    ("sc1.0_rad",  {"OPENWAM_RUNNER_SC": "1.0"}),
    ("sc1.2_rad",  {"OPENWAM_RUNNER_SC": "1.2"}),
    ("sc1.35_rad", {"OPENWAM_RUNNER_SC": "1.35"}),
    ("sc1.5_rad",  {"OPENWAM_RUNNER_SC": "1.5"}),
]

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("PC_RPMS", "2700,3900,4600,5300,6300,6900").split(",")]
CYCLES = int(os.environ.get("PC_CYCLES", "55"))
OMP = os.environ.get("PC_OMP", "4")
CONC = int(os.environ.get("PC_CONC", "4"))
TIMEOUT = os.environ.get("PC_TIMEOUT", "4000")
CSV = os.environ.get("PC_CSV", "/tmp/par_sweep_cfg.csv")

# env keys a config may set; cleared before each gen so configs don't leak into each other
_CFG_KEYS = ["OPENWAM_NO_EQTUBE", "OPENWAM_EQ_CHAIN", "OPENWAM_EQ_DIA", "OPENWAM_EQ_MISTUNE",
             "OPENWAM_EQ_FRIC", "OPENWAM_EQ_VOL_MULT", "OPENWAM_RUNNER_SC",
             "OPENWAM_RUNNER_FRIC_MULT", "OPENWAM_INTAKE_V2",
             "OPENWAM_INTAKE_MOUTH_CD", "OPENWAM_PORT_TWALL"]

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

def gen(rpm, label, overrides, wd):
    os.makedirs(wd, exist_ok=True)
    for k in _CFG_KEYS: os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    for k, v in overrides.items(): os.environ[k] = v
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.engine.vanos_intake_bias = float(130.0 - eval_(rpm))
    cfg.engine.vanos_exhaust_bias = float(150.0 - aval(rpm))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 2 and r[0] != "label": d.add((r[0], int(r[1])))
    return d

_lock = threading.Lock()
def run_cell(label, rpm):
    wd = os.path.abspath(f"/tmp/cfg_{label}_{rpm}")
    env = os.environ.copy(); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = OMP
    env["OPENWAM_VEDIAG"] = "1"; env["OPENWAM_THR_CHOKE"] = "1"
    run_capped([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    with _lock:
        new = not os.path.exists(CSV)
        with open(CSV, "a", newline="") as f:
            w = csv.writer(f)
            if new: w.writerow(["label", "rpm", "stock", "ve", "slope", "cyc"])
            w.writerow([label, rpm, f"{stock(rpm):.1f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return label, rpm, ve, slope, n

jobs = [(label, rpm, ov) for (label, ov) in CONFIGS for rpm in RPMS]
dn = done()
todo = [j for j in jobs if (j[0], j[1]) not in dn]
print(f"# cfg sweep: {len(todo)}/{len(jobs)} cells TODO, conc={CONC} omp={OMP} cyc={CYCLES}", flush=True)
print(f"# configs: {', '.join(l for l,_ in CONFIGS)}", flush=True)
for label, rpm, ov in todo:
    gen(rpm, label, ov, os.path.abspath(f"/tmp/cfg_{label}_{rpm}"))
with ThreadPoolExecutor(max_workers=CONC) as ex:
    futs = {ex.submit(run_cell, label, rpm): (label, rpm) for label, rpm, ov in todo}
    for fut in as_completed(futs):
        label, rpm, ve, slope, n = fut.result()
        print(f"  {label:14} {rpm} -> VE {ve:.1f} slope{slope:+.2f} cyc{n} (stock {stock(rpm):.0f})", flush=True)

# report
print("\n# ==== WOT VE-shape per config (mean-normalised; range & tilt vs stock) ====")
rows = [r for r in csv.reader(open(CSV)) if len(r) >= 6 and r[0] != "label"] if os.path.exists(CSV) else []
sk = [stock(r) for r in RPMS]; skm = statistics.mean(sk)
print("  config          range(pp) tilt(hi-lo)  " + "/".join(str(r) for r in RPMS) + "  abs@peak")
print(f"  {'STOCK':14}  {max(sk)-min(sk):>7.0f} {statistics.mean(sk[2:])-statistics.mean(sk[:2]):>9.1f}   " + " ".join(f"{v/skm:.2f}" for v in sk))
for label, _ in CONFIGS:
    seg = {int(r[1]): float(r[3]) for r in rows if r[0] == label}
    ve = [seg.get(r, float('nan')) for r in RPMS]
    if all(v != v for v in ve): continue
    if any(v != v for v in ve):
        print(f"  {label:14}  (incomplete {sum(1 for v in ve if v==v)}/{len(RPMS)})"); continue
    m = statistics.mean(ve); tilt = statistics.mean(ve[2:]) - statistics.mean(ve[:2])
    pk = RPMS[ve.index(max(ve))]
    print(f"  {label:14}  {max(ve)-min(ve):>7.0f} {tilt:>9.1f}   " + " ".join(f"{v/m:.2f}" for v in ve) + f"  pk{pk}={max(ve):.0f}")
print("# done", flush=True)

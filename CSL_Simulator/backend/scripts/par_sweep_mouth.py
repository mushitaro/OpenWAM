#!/usr/bin/env python3
# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Parallel coordinated-WOT sweep of the INTAKE_V2 trumpet-mouth Cd (the Q lever).

Step 2 experiment. Holds runner length (PM_SC, default 1.0) and sweeps the soft
trumpet-mouth discharge coefficient (OPENWAM_INTAKE_MOUTH_CD, baked into the deck
via OPENWAM_INTAKE_V2) across rpm at WOT with coordinated stock VANOS. Cd=1.0 is
the built-in baseline (== legacy valve 25). Lower Cd adds Borda-Carnot loss at the
mouth -> tests whether it BROADENS the high-Q ram resonance (range/tilt -> stock).

Same machinery as par_sweep_wot.py (decks generated sequentially since deck-gen
mutates os.environ; OpenWAM cells run in a thread pool; resumable; Mtrap VE;
slope-judged). Env: PM_RPMS, PM_CDS, PM_SC(1.0), PM_CYCLES(55), PM_OMP(4),
PM_CONC(4), PM_TIMEOUT(4000), PM_CSV.
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
RPMS = [int(x) for x in os.environ.get("PM_RPMS", "2700,3900,4600,5300,6300,6900").split(",")]
CDS = [float(x) for x in os.environ.get("PM_CDS", "1.0,0.75,0.55").split(",")]
SC = os.environ.get("PM_SC", "1.0")
CYCLES = int(os.environ.get("PM_CYCLES", "55"))
OMP = os.environ.get("PM_OMP", "4")
CONC = int(os.environ.get("PM_CONC", "4"))
TIMEOUT = os.environ.get("PM_TIMEOUT", "4000")
CSV = os.environ.get("PM_CSV", "/tmp/par_sweep_mouth.csv")

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

def gen(rpm, cd, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"; os.environ["OPENWAM_RUNNER_SC"] = SC
    os.environ["OPENWAM_INTAKE_V2"] = "1"; os.environ["OPENWAM_INTAKE_MOUTH_CD"] = str(cd)
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
def run_cell(rpm, cd):
    wd = os.path.abspath(f"/tmp/mouth_{rpm}_{cd}_sc{SC}")
    env = os.environ.copy(); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = OMP
    env["OPENWAM_VEDIAG"] = "1"; env["OPENWAM_THR_CHOKE"] = "1"
    run_until_converged([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    with _lock:
        new = not os.path.exists(CSV)
        with open(CSV, "a", newline="") as f:
            w = csv.writer(f)
            if new: w.writerow(["rpm", "cd", "sc", "stock", "ve", "slope", "cyc"])
            w.writerow([rpm, cd, SC, f"{stock(rpm):.1f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return rpm, cd, ve, slope, n

jobs = [(rpm, cd) for cd in CDS for rpm in RPMS]
dn = done()
todo = [j for j in jobs if (j[0], j[1]) not in dn]
print(f"# mouth-Cd sweep: {len(todo)}/{len(jobs)} cells TODO, sc={SC} conc={CONC} omp={OMP} cyc={CYCLES}", flush=True)
for rpm, cd in todo:
    gen(rpm, cd, os.path.abspath(f"/tmp/mouth_{rpm}_{cd}_sc{SC}"))
with ThreadPoolExecutor(max_workers=CONC) as ex:
    futs = {ex.submit(run_cell, rpm, cd): (rpm, cd) for rpm, cd in todo}
    for fut in as_completed(futs):
        rpm, cd, ve, slope, n = fut.result()
        print(f"  {rpm} cd={cd} -> VE {ve:.1f} slope{slope:+.2f} cyc{n} (stock {stock(rpm):.0f})", flush=True)

# report: VE-shape per Cd vs stock, mean-normalised + range + tilt
print("\n# ==== WOT VE-shape vs trumpet-mouth Cd (mean-normalised; range & tilt vs stock) ====")
rows = [r for r in csv.reader(open(CSV)) if len(r) >= 7 and r[0] != "rpm"] if os.path.exists(CSV) else []
cds = sorted({float(r[1]) for r in rows}, reverse=True)
sk = [stock(r) for r in RPMS]; skm = statistics.mean(sk)
print("  src    range(pp)  tilt(hi-lo)   " + "/".join(str(r) for r in RPMS) + " (mean-norm)")
print(f"  STOCK  {max(sk)-min(sk):>7.0f}  {statistics.mean(sk[2:])-statistics.mean(sk[:2]):>10.1f}   " + " ".join(f"{v/skm:.2f}" for v in sk))
for cd in cds:
    seg = {int(r[0]): float(r[4]) for r in rows if abs(float(r[1])-cd) < 1e-6}
    ve = [seg.get(r, float('nan')) for r in RPMS]
    if any(v != v for v in ve):
        print(f"  cd{cd:<4} (incomplete: {sum(1 for v in ve if v==v)}/{len(RPMS)} cells)"); continue
    m = statistics.mean(ve)
    tilt = statistics.mean(ve[2:]) - statistics.mean(ve[:2])
    print(f"  cd{cd:<4} {max(ve)-min(ve):>7.0f}  {tilt:>10.1f}   " + " ".join(f"{v/m:.2f}" for v in ve))
print("# done", flush=True)

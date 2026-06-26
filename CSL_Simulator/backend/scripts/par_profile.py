#!/usr/bin/env python3
"""Verify a PER-RPM EXVANOS_BASE(rpm) profile at WOT (deterministic, omp1).

Unlike par_exvanos (one base for all rpm), this runs each rpm at its OWN base from a
profile, so a candidate EXVANOS_BASE(rpm) can be checked for the stock WOT SHAPE. With
the C++ mouth radiation damping ON (OPENWAM_MOUTH_RAD) the cycle is monostable, so this
is well-posed. Reports mean-normalised shape + range + tilt vs stock.

Env: PP_PROFILE = "rpm:base,rpm:base,..." (required), PP_RAD (alpha, default 0.4),
PP_RADW (0.005), PP_CYCLES(55), PP_OMP(1), PP_CONC(16), PP_TIMEOUT(6000), PP_CSV.
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
PROFILE = {}
for pair in os.environ.get("PP_PROFILE", "2700:135,3900:110,4600:150,5300:175,6300:170,6900:165").split(","):
    r, b = pair.split(":"); PROFILE[int(r)] = float(b)
RAD = os.environ.get("PP_RAD", "0.4")
RADW = os.environ.get("PP_RADW", "0.005")
CYCLES = int(os.environ.get("PP_CYCLES", "55"))
OMP = os.environ.get("PP_OMP", "1")
CONC = int(os.environ.get("PP_CONC", "16"))
TIMEOUT = os.environ.get("PP_TIMEOUT", "6000")
CSV = os.environ.get("PP_CSV", "/tmp/par_profile.csv")
LOAD = 100.0

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm): return lut(M["kf_rf_soll"], rpm, LOAD)*100
def aval(rpm):  return lut(M["kf_avan1_soll"], rpm, LOAD)
def eval_(rpm): return lut(M["kf_evan1_soll"], rpm, LOAD)

def metrics(t):
    pairs = re.findall(r"VEDIAG Cyl:(\d+) .*?Mtrap:([0-9.]+) g", t)
    if len(pairs) < 12: return float("nan"), float("nan"), -1
    ncyc = len(pairs)//6
    ms = [float(m) for _, m in pairs]
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(ncyc)]
    slope = (cyc_ve[-1]-cyc_ve[-5])/4 if ncyc >= 5 else float("nan")
    last = {}
    for c, m in pairs[-12:]: last.setdefault(int(c), []).append(float(m))
    means = {c: statistics.mean(v) for c, v in last.items()}
    med = statistics.median(means.values())
    healthy = [v for v in means.values() if v >= 0.5*med]
    ve_h = (statistics.mean(healthy)/M_REF*100) if healthy else float("nan")
    return ve_h, slope, ncyc

def gen(rpm, base, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.engine.vanos_intake_bias = float(130.0 - eval_(rpm))
    cfg.engine.vanos_exhaust_bias = float(base - aval(rpm))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

_lock = threading.Lock()
def run_cell(rpm, base):
    wd = os.path.abspath(f"/tmp/prof_{rpm}_{int(base)}")
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    if float(RAD) > 0: env["OPENWAM_MOUTH_RAD"]=RAD; env["OPENWAM_MOUTH_RAD_W"]=RADW
    run_until_converged([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, ncyc = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    with _lock:
        new = not os.path.exists(CSV)
        with open(CSV, "a", newline="") as f:
            w = csv.writer(f)
            if new: w.writerow(["rpm","base","rad","stock","ve_h","slope","cyc"])
            w.writerow([rpm, base, RAD, f"{stock(rpm):.1f}", f"{ve:.1f}", f"{slope:+.2f}", ncyc])
    return rpm, base, ve, slope, ncyc

rpms = sorted(PROFILE)
print(f"# profile fit @ WOT, rad={RAD} w={RADW}: " + " ".join(f"{r}:b{int(PROFILE[r])}" for r in rpms), flush=True)
# generate all decks sequentially (gen mutates global os.environ/sys.stdout -> not thread-safe)
for r in rpms:
    gen(r, PROFILE[r], os.path.abspath(f"/tmp/prof_{r}_{int(PROFILE[r])}"))
with ThreadPoolExecutor(max_workers=CONC) as ex:
    futs = {ex.submit(run_cell, r, PROFILE[r]): r for r in rpms}
    res = {}
    for fut in as_completed(futs):
        rpm, base, ve, slope, ncyc = fut.result(); res[rpm] = ve
        print(f"  {rpm} base{int(base)} -> VE {ve:.1f} slope{slope:+.2f} cyc{ncyc} (stock {stock(rpm):.0f})", flush=True)

ve = [res[r] for r in rpms]
if all(v == v for v in ve):
    m = statistics.mean(ve); tilt = statistics.mean(ve[2:]) - statistics.mean(ve[:2])
    sk = [stock(r) for r in rpms]; skm = statistics.mean(sk)
    pk = rpms[ve.index(max(ve))]
    print("\n# shape (mean-norm) vs stock:")
    print("  rpm    " + " ".join(f"{r:>5}" for r in rpms))
    print("  sim    " + " ".join(f"{v/m:>5.2f}" for v in ve) + f"   range={max(ve)-min(ve):.0f} tilt={tilt:+.1f} peak={pk}")
    print("  stock  " + " ".join(f"{s/skm:>5.2f}" for s in sk) + f"   range={max(sk)-min(sk):.0f}")
print("# done", flush=True)

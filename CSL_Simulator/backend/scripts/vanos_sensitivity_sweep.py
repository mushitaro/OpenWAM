#!/usr/bin/env python3
# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Stage 51 Step 2 — VANOS sensitivity at WOT (converged, throttle non-confounding).

The "VANOS over-response" (Stage 44/47) is the WOT-row over-fill that rises with rpm. At
WOT the throttle is wide open (sigma 0.96) and the manifold inits ~1.0 bar, so there is no
throttle/init confound -- this is the clean regime to measure dVE/d(cam phase). We sweep the
INTAKE bias and the EXHAUST bias INDEPENDENTLY at fixed rpm and read off the VE response and
the cyl balance, to quantify (a) how steep dVE/dbias is vs the physical ~10-20pp expectation,
(b) whether the stock cam targets sit at a sane VE, (c) intake-ram vs overlap-scavenge vs
exhaust-coordination split (via the overlap = 2 + bias_in - bias_ex relation).

Resumable: appends to SWEEP_CSV after each cell, skips done (rpm,mode,b_in,b_ex). Re-invoke
after reboots. Convergence judged by slope (last-5-cyc |dVE/dcyc|), reported per cell.

Env:
  VS_RPMS    comma rpms (default 3900,5300,6900)
  VS_MODE    "intake" (sweep b_in, exhaust at stock-coord) | "exhaust" (sweep b_ex, intake
             at stock) | "both" (default: run intake then exhaust)
  VS_BINS    intake-bias list (default 0,20,40,60)
  VS_BEXS    exhaust-bias list (default 33,45,57,63)   [stock-coord ~ 45-63]
  VS_CYCLES  cycles (default 38; WOT converges faster than part-load)
  VS_TIMEOUT per-run seconds (default 1100)
  VS_OMP     OMP threads (default 4)
  VS_CSV     output CSV (default /tmp/vanos_sens.csv)
Choke BC + init-MAP fix are ON (OPENWAM_THR_CHOKE=1); WOT so AGAIN is irrelevant.
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_capped
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("VS_RPMS", "3900,5300,6900").split(",")]
MODE = os.environ.get("VS_MODE", "both")
BINS = [float(x) for x in os.environ.get("VS_BINS", "0,20,40,60").split(",")]
BEXS = [float(x) for x in os.environ.get("VS_BEXS", "33,45,57,63").split(",")]
CYCLES = int(os.environ.get("VS_CYCLES", "38"))
TIMEOUT = os.environ.get("VS_TIMEOUT", "1100")
OMP = os.environ.get("VS_OMP", "4")
CSV = os.environ.get("VS_CSV", "/tmp/vanos_sens.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm, load): return lut(M["kf_rf_soll"], rpm, load)*100
def aval(rpm, load):  return lut(M["kf_avan1_soll"], rpm, load)
def eval_(rpm, load): return lut(M["kf_evan1_soll"], rpm, load)

def metrics(t):
    """Return (VE_all, VE_healthy, ncol, slope_last5, ncyc) from the VEDIAG stream."""
    pairs = re.findall(r"VEDIAG Cyl:(\d+) .*?Mtrap:([0-9.]+) g", t)
    if len(pairs) < 12: return float("nan"), float("nan"), -1, float("nan"), len(pairs)//6
    ncyc = len(pairs)//6
    # per-cycle all-cyl mean VE
    ms = [float(m) for _, m in pairs]
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(ncyc)]
    slope = (cyc_ve[-1]-cyc_ve[-5])/4 if ncyc >= 5 else float("nan")
    # last-2-cyc per-cyl for health
    last = {}
    for c, m in pairs[-12:]: last.setdefault(int(c), []).append(float(m))
    means = {c: statistics.mean(v) for c, v in last.items()}
    med = statistics.median(means.values())
    healthy = [v for v in means.values() if v >= 0.5*med]
    ve_all = statistics.mean(list(means.values()))/M_REF*100
    ve_h = (statistics.mean(healthy)/M_REF*100) if healthy else float("nan")
    return ve_all, ve_h, len(means)-len(healthy), slope, ncyc

def gen(rpm, b_in, b_ex, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0  # WOT
    cfg.engine.vanos_intake_bias = float(b_in)
    cfg.engine.vanos_exhaust_bias = float(b_ex)
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done_cells():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 4 and r[0] != "rpm":
                d.add((int(r[0]), r[1], int(float(r[2])), int(float(r[3]))))
    return d

def run_cell(rpm, mode, b_in, b_ex):
    wd = f"/tmp/vs_{rpm}_{mode}_{int(b_in)}_{int(b_ex)}"; gen(rpm, b_in, b_ex, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    run_capped([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    t = open(wd+"/run.log", encoding="utf-8", errors="ignore").read()
    ve_all, ve_h, ncol, slope, ncyc = metrics(t)
    ov = 2 + b_in - b_ex
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm","mode","b_in","b_ex","overlap","stockWOT","ve_all","ve_healthy","ncol","slope","cyc"])
        w.writerow([rpm, mode, f"{b_in:.0f}", f"{b_ex:.0f}", f"{ov:.0f}", f"{stock(rpm,100):.1f}",
                    f"{ve_all:.1f}", f"{ve_h:.1f}", ncol, f"{slope:+.2f}", ncyc])
    return ve_h, slope, ncyc

# build job list: intake sweep (exhaust at stock-coord 150-aval) + exhaust sweep (intake at stock 130-eval)
jobs = []
modes = ["intake","exhaust"] if MODE=="both" else [MODE]
for rpm in RPMS:
    ex_coord = 150.0 - aval(rpm,100)   # stock-coordinated exhaust bias at WOT
    in_stock = 130.0 - eval_(rpm,100)  # stock intake bias at WOT
    if "intake" in modes:
        for b in BINS: jobs.append((rpm,"intake",b,ex_coord))
    if "exhaust" in modes:
        for b in BEXS: jobs.append((rpm,"exhaust",in_stock,b))

done = done_cells()
todo = [j for j in jobs if (j[0],j[1],int(j[2]),int(j[3])) not in done]
print(f"# VANOS sensitivity: {len(todo)} of {len(jobs)} cells TODO (WOT, choke on)", flush=True)
for rpm, mode, b_in, b_ex in todo:
    ve, sl, cyc = run_cell(rpm, mode, b_in, b_ex)
    print(f"  {rpm} {mode} b_in={b_in:.0f} b_ex={b_ex:.0f} ov={2+b_in-b_ex:.0f} -> VE_h {ve:.1f} slope{sl:+.2f} cyc{cyc}", flush=True)

# report
print("\n# ==== VANOS sensitivity (WOT) ====")
rows=[r for r in csv.reader(open(CSV)) if len(r)>=11 and r[0]!="rpm"] if os.path.exists(CSV) else []
for rpm in RPMS:
    for mode in modes:
        seg=[r for r in rows if int(r[0])==rpm and r[1]==mode]
        if not seg: continue
        seg.sort(key=lambda r: float(r[2]) if mode=="intake" else float(r[3]))
        sw=seg[0][5]
        print(f"\n {rpm} rpm  {mode}-sweep  (stock WOT {sw})")
        print("   b_in b_ex overlap  VE_h  ncol slope cyc")
        for r in seg:
            print(f"   {r[2]:>3} {r[3]:>3}  {r[4]:>4}   {r[7]:>5} {r[8]:>2} {r[9]:>5} {r[10]:>3}")

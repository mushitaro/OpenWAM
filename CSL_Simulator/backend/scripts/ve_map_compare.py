#!/usr/bin/env python3
"""Stock vs Sim VE on a sub-grid of the 480-point (20 rpm x 24 load) CSL map.

For each (rpm, load) cell: look up the stock VE (kf_rf_soll) and the stock intake/
exhaust VANOS (kf_evan1_soll / kf_avan1_soll, both 2-D), run the plenum sim with that
VANOS, apply the cylinder-balance gate, and tabulate sim VE vs stock VE. (Running all 480
is infeasible here -- this samples the drivable high/part-load region to show the tracking.)
"""
import sys, os, io, re, json, math, subprocess, statistics
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
BORE, STROKE = 0.087, 0.091
M_REF = math.pi*(BORE/2)**2*STROKE*(101325/(287.05*298.0))*1000
CYCLES = 22

def lut2d(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    ri = min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))
    li = min(range(len(ly)), key=lambda i: abs(ly[i]-load))
    return V[li][ri]

VE = M["kf_rf_soll"]
def stock_ve(rpm, load): return lut2d(VE, rpm, load)

RPMS = [2700, 3900, 5300, 6900]
LOADS = [100.0, 65.0, 45.0, 20.0]

def gate(stdout, n=6, tol=0.20):
    ms = [float(x) for x in re.findall(r"VEDIAG Cyl:\d+ .*?Mtrap:([0-9.]+) g", stdout)]
    if len(ms) < n: return None, False
    seg = ms[-n:]; med = statistics.median(seg)
    if med <= 0: return None, False
    sp = max(abs(x-med) for x in seg)/med
    return statistics.mean(seg)/M_REF*100, (sp <= tol)

def gen(rpm, load, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = float(load/100.0)
    # Match production (simulation_service.run_ve_map_generation): intake VANOS bias
    # = 130 - kf_evan1_soll target; exhaust VANOS left at default.
    cfg.engine.vanos_intake_bias = float(130.0 - lut2d(M["kf_evan1_soll"], rpm, load))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)
    for f in ("intake.vlv", "exhaust.vlv"):
        s = "/tmp/vediag_5300/"+f
        if os.path.exists(s): open(wd+"/"+f, "wb").write(open(s, "rb").read())

def launch(rpm, load):
    wd = f"/tmp/map_{rpm}_{int(load)}"; gen(rpm, load, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]="1"; env["OPENWAM_VEDIAG"]="1"
    return wd, subprocess.Popen(["timeout","300",BIN,"m.wam"], cwd=wd,
                                stdout=open(wd+"/run.log","wb"), stderr=subprocess.STDOUT, env=env)

jobs = [(r, l) for l in LOADS for r in RPMS]
res = {}
i = 0
while i < len(jobs):
    batch = jobs[i:i+3]
    procs = [(r, l, *launch(r, l)) for r, l in batch]
    for r, l, wd, p in procs: p.wait()
    for r, l, wd, p in procs:
        t = open(wd+"/run.log", encoding="utf-8", errors="ignore").read()
        ve, ok = gate(t)
        res[(r, l)] = (ve, ok, len(re.findall(r"VEDIAG Cyl:1 ", t)))
    i += 3

print(f"# Stock vs Sim VE  (sub-grid of the 480-pt CSL map; CYCLES={CYCLES}, ~under-converged)")
print(f"# rows=load%  cols=rpm   cell = stock% / sim% (gate)")
hdr = "load\\rpm " + "".join(f"{r:>13}" for r in RPMS)
print(hdr)
pairs = []
for l in LOADS:
    cells = []
    for r in RPMS:
        s = stock_ve(r, l)*100
        ve, ok, cyc = res[(r, l)]
        tag = "" if ok else "X"
        cells.append(f"{s:3.0f}/{(('%3.0f'%ve) if ve else 'nan')}{tag:1s}")
        if ve and ok: pairs.append((s, ve))
    print(f"{l:6.0f}  " + "".join(f"{c:>13}" for c in cells))

if len(pairs) >= 3:
    ss = [a for a, b in pairs]; sims = [b for a, b in pairs]
    n = len(ss); ms_ = sum(ss)/n; mm = sum(sims)/n
    cov = sum((a-ms_)*(b-mm) for a, b in pairs)
    va = math.sqrt(sum((a-ms_)**2 for a in ss)); vb = math.sqrt(sum((b-mm)**2 for b in sims))
    r = cov/(va*vb) if va*vb > 0 else float("nan")
    k = sum(a/b for a, b in pairs)/n  # mean stock/sim correction
    resid = [abs(b*k-a) for a, b in pairs]
    print(f"\n# valid cells={n}  shape r={r:.3f}  correction k(stock/sim)={k:.2f}")
    print(f"# after k-correction: mean|resid|={sum(resid)/n:.1f} pp, max={max(resid):.1f} pp")

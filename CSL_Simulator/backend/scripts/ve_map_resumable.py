#!/usr/bin/env python3
"""Resumable Stock-vs-Sim VE map (sub-grid of the 480-pt CSL map).

Robust to the ~12-min container reboots: results are appended to a CSV after every
3-point batch, and already-done cells are skipped, so re-running resumes. Prints the
accumulated stock/sim map and the error stats over whatever has completed.
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
CYCLES = 18
CSV = "/tmp/map_results.csv"
RPMS = [2700, 3900, 5300, 6900]
LOADS = [100.0, 65.0, 45.0, 20.0]

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def stock(rpm, load): return lut(M["kf_rf_soll"], rpm, load)*100

def done_cells():
    d = {}
    if os.path.exists(CSV):
        for row in csv.reader(open(CSV)):
            if len(row) >= 5 and row[0] != "rpm":
                d[(int(row[0]), int(float(row[1])))] = (float(row[3]) if row[3] != "nan" else float("nan"), row[4] == "1")
    return d

def gate(t, n=6, tol=0.20):
    ms = [float(x) for x in re.findall(r"VEDIAG Cyl:\d+ .*?Mtrap:([0-9.]+) g", t)]
    if len(ms) < n: return float("nan"), False, len(ms)//6
    seg = ms[-n:]; med = statistics.median(seg)
    if med <= 0: return float("nan"), False, len(ms)//6
    sp = max(abs(x-med) for x in seg)/med
    return statistics.mean(seg)/M_REF*100, sp <= tol, len(ms)//6

def gen(rpm, load, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = float(load/100.0)
    cfg.engine.vanos_intake_bias = float(130.0 - lut(M["kf_evan1_soll"], rpm, load))
    # coordinate the exhaust cam too (Stage 47 fix): base 150 - exhaust target
    cfg.engine.vanos_exhaust_bias = float(150.0 - lut(M["kf_avan1_soll"], rpm, load))
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)
    for f in ("intake.vlv", "exhaust.vlv"):
        s = "/tmp/vediag_5300/"+f
        if os.path.exists(s): open(wd+"/"+f, "wb").write(open(s, "rb").read())

def run_batch(cells):
    procs = []
    for rpm, load in cells:
        wd = f"/tmp/mp_{rpm}_{int(load)}"; gen(rpm, load, wd)
        env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]="1"; env["OPENWAM_VEDIAG"]="1"
        procs.append((rpm, load, wd, subprocess.Popen(["timeout","220",BIN,"m.wam"], cwd=wd,
                      stdout=open(wd+"/run.log","wb"), stderr=subprocess.STDOUT, env=env)))
    for rpm, load, wd, p in procs: p.wait()
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm","load","stock","sim","valid","cyc"])
        for rpm, load, wd, p in procs:
            t = open(wd+"/run.log", encoding="utf-8", errors="ignore").read()
            ve, ok, cyc = gate(t)
            w.writerow([rpm, int(load), f"{stock(rpm,load):.1f}", f"{ve:.1f}", 1 if ok else 0, cyc])

todo = [(r, l) for l in LOADS for r in RPMS if (r, int(l)) not in done_cells()]
# one batch of up to 3 per invocation keeps us inside a reboot window
if todo:
    run_batch(todo[:3])

# ---- print accumulated map ----
res = done_cells()
print(f"# Stock vs Sim VE map ({len(res)}/{len(RPMS)*len(LOADS)} cells, CYCLES={CYCLES}, ~under-converged)")
print(f"# cell = stock / sim   (X = cylinder-balance gate REJECTED)")
print("load\\rpm " + "".join(f"{r:>12}" for r in RPMS))
pairs = []
for l in LOADS:
    cells = []
    for r in RPMS:
        if (r, int(l)) in res:
            sim, ok = res[(r, int(l))]
            cells.append(f"{stock(r,l):3.0f}/{sim:3.0f}{'' if ok else 'X'}")
            if ok and sim == sim: pairs.append((stock(r, l), sim, r, l))
        else:
            cells.append(f"{stock(r,l):3.0f}/  -")
    print(f"{l:6.0f}  " + "".join(f"{c:>12}" for c in cells))
if len(pairs) >= 3:
    ss = [a for a, b, r, l in pairs]; sm = [b for a, b, r, l in pairs]
    n = len(ss); cov = sum((a-sum(ss)/n)*(b-sum(sm)/n) for a, b, r, l in pairs)
    va = math.sqrt(sum((a-sum(ss)/n)**2 for a in ss)); vb = math.sqrt(sum((b-sum(sm)/n)**2 for b in sm))
    rr = cov/(va*vb) if va*vb > 0 else float("nan")
    ratios = [b/a for a, b, r, l in pairs]
    print(f"\n# valid cells={n}  shape r={rr:.3f}  sim/stock ratio: mean={statistics.mean(ratios):.2f} min={min(ratios):.2f} max={max(ratios):.2f}")
    worst = max(pairs, key=lambda p: abs(p[1]-p[0]))
    print(f"# worst cell: rpm{worst[2]} load{int(worst[3])}  stock {worst[0]:.0f} vs sim {worst[1]:.0f}")

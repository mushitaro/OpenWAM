#!/usr/bin/env python3
"""Stage 54 — calibrate the intake ram tuning: WOT VE-shape vs runner length.

Root cause (Stage 53): the intake-runner ram resonance is mis-tuned and too sharp, which
(a) makes VE over-respond to cam advance and (b) makes the WOT VE row over-fill non-
monotonically (sim peaks ~4600 rpm; STOCK peaks ~3900 then declines smoothly). The stock WOT
VE-shape is the ram-tuning fingerprint. This driver runs WOT (stock-coordinated VANOS) across
rpm for several runner lengths (OPENWAM_RUNNER_SC) so we can pick the length whose VE-shape
matches stock's -- i.e. the effective intake length that reproduces the real resonance.

Compares SHAPE (each curve normalised to its own peak) since the absolute level is removed by
the correction; what must match is WHERE the peak sits and how smoothly it declines.

wd includes SC so runs don't collide; CSV key (rpm,sc). Slope-converged, choke+init-MAP on.
Resumable. Env: RT_RPMS, RT_SCS, RT_CYCLES(38), RT_TIMEOUT(1300), RT_OMP(4), RT_CSV.
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("RT_RPMS", "2700,3900,4600,5300,6300,6900").split(",")]
SCS = [float(x) for x in os.environ.get("RT_SCS", "1.5,2.0").split(",")]
CYCLES = int(os.environ.get("RT_CYCLES", "38"))
TIMEOUT = os.environ.get("RT_TIMEOUT", "1300")
OMP = os.environ.get("RT_OMP", "4")
CSV = os.environ.get("RT_CSV", "/tmp/runner_tune_wot.csv")

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

def run_cell(rpm, sc):
    wd = f"/tmp/rt_{rpm}_{sc}"; gen(rpm, sc, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    subprocess.run(["timeout", TIMEOUT, BIN, "m.wam"], cwd=wd,
                   stdout=open(wd+"/run.log","wb"), stderr=subprocess.STDOUT, env=env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm","sc","stock","ve","slope","cyc"])
        w.writerow([rpm, sc, f"{stock(rpm):.1f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return ve, slope, n

jobs = [(rpm, sc) for sc in SCS for rpm in RPMS]
dn = done()
todo = [j for j in jobs if (j[0], j[1]) not in dn]
print(f"# runner-tune WOT: {len(todo)}/{len(jobs)} cells TODO", flush=True)
for rpm, sc in todo:
    ve, sl, n = run_cell(rpm, sc)
    print(f"  {rpm} sc={sc} -> VE {ve:.1f} slope{sl:+.2f} cyc{n} (stock {stock(rpm):.0f})", flush=True)

# report: VE-shape per SC, normalised to each curve's own peak, vs stock-normalised
print("\n# ==== WOT VE-shape vs runner length (normalised to each curve peak) ====")
rows = [r for r in csv.reader(open(CSV)) if len(r)>=6 and r[0]!="rpm"] if os.path.exists(CSV) else []
allscs = sorted({float(r[1]) for r in rows})
stk = {rpm: stock(rpm) for rpm in RPMS}
stkpk = max(stk.values()) if stk else 1
print("  rpm   stock(norm) " + " ".join(f"sc{sc}(norm)" for sc in allscs))
for rpm in RPMS:
    line = f"  {rpm:>4}   {stk[rpm]/stkpk:.2f}        "
    for sc in allscs:
        v = [float(r[3]) for r in rows if int(r[0])==rpm and abs(float(r[1])-sc)<1e-6]
        if v:
            pk = max(float(r[3]) for r in rows if abs(float(r[1])-sc)<1e-6)
            line += f"  {v[0]/pk:.2f}    "
        else:
            line += "   -     "
    print(line)
print(f"\n# stock WOT peak rpm: {max(stk, key=stk.get)} ; sim peak rpm per sc:")
for sc in allscs:
    seg = [(int(r[0]), float(r[3])) for r in rows if abs(float(r[1])-sc)<1e-6]
    if seg: print(f"   sc={sc}: peak at {max(seg, key=lambda x:x[1])[0]} rpm")

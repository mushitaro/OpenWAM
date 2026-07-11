#!/usr/bin/env python3
# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Stage 54b — does intake-tract DAMPING (lower Q) flatten the VANOS over-response?

Stage 53 confirmed the over-response is the intake ram resonance; Stage 54 showed it is too
SHARP (3900 WOT VE swings 132->100 for a 0.1 runner-length step) to match stock's BROAD WOT
curve by length alone. Q is set largely by the very low bellmouth friction (0.015). This test
raises the intake-tract friction (OPENWAM_RUNNER_FRIC_MULT) and measures the over-response
d = VE(bias60) - VE(bias40) at 3900 WOT. If d shrinks (and the absolute VE drops toward
stock) as friction rises, Q-damping is the fix lever.

Grid: 3900 WOT, exhaust bias 63, intake bias {40,60}, FRIC_MULT {1,2,4}. Choke+init-MAP on,
slope-converged, resumable. Env: FR_RPMS, FR_MULTS, FR_BINS, FR_CYCLES(40), FR_TIMEOUT(1400).
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_capped
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("FR_RPMS", "3900").split(",")]
MULTS = [float(x) for x in os.environ.get("FR_MULTS", "1,2,4").split(",")]
BINS = [float(x) for x in os.environ.get("FR_BINS", "40,60").split(",")]
CYCLES = int(os.environ.get("FR_CYCLES", "40"))
TIMEOUT = os.environ.get("FR_TIMEOUT", "1400")
OMP = os.environ.get("FR_OMP", "4")
CSV = os.environ.get("FR_CSV", "/tmp/fric_test.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def aval(rpm): return lut(M["kf_avan1_soll"], rpm, 100)

def metrics(t):
    ms = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", t)]
    n = len(ms)//6
    if n < 5: return float("nan"), float("nan"), n
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(n)]
    return cyc_ve[-1], (cyc_ve[-1]-cyc_ve[-5])/4, n

def gen(rpm, b_in, b_ex, fm, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"; os.environ["OPENWAM_RUNNER_FRIC_MULT"] = str(fm)
    os.environ.pop("OPENWAM_RUNNER_SC", None)  # nominal length
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.engine.vanos_intake_bias = float(b_in); cfg.engine.vanos_exhaust_bias = float(b_ex)
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 3 and r[0] != "rpm": d.add((int(r[0]), float(r[1]), int(float(r[2]))))
    return d

def run_cell(rpm, fm, b_in, b_ex):
    wd = f"/tmp/fr_{rpm}_{fm}_{int(b_in)}"; gen(rpm, b_in, b_ex, fm, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    run_capped([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm","fric_mult","b_in","b_ex","ve","slope","cyc"])
        w.writerow([rpm, fm, f"{b_in:.0f}", f"{b_ex:.0f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return ve, slope, n

jobs = [(rpm, fm, b) for rpm in RPMS for fm in MULTS for b in BINS]
dn = done()
todo = [j for j in jobs if (j[0], j[1], int(j[2])) not in dn]
print(f"# fric over-response test: {len(todo)}/{len(jobs)} cells TODO", flush=True)
for rpm, fm, b in todo:
    bex = 150.0 - aval(rpm)
    ve, sl, n = run_cell(rpm, fm, b, bex)
    print(f"  {rpm} fric_mult={fm} b_in={b:.0f} -> VE {ve:.1f} slope{sl:+.2f} cyc{n}", flush=True)

print("\n# ==== over-response vs intake damping ====")
rows = [r for r in csv.reader(open(CSV)) if len(r)>=7 and r[0]!="rpm"] if os.path.exists(CSV) else []
for rpm in RPMS:
    print(f" {rpm} rpm:")
    for fm in MULTS:
        d = {int(float(r[2])): (float(r[4]), r[5]) for r in rows if int(r[0])==rpm and abs(float(r[1])-fm)<1e-6}
        if 40 in d and 60 in d:
            print(f"   fric_mult={fm}: VE(b40)={d[40][0]:.1f}(sl{d[40][1]}) VE(b60)={d[60][0]:.1f}(sl{d[60][1]}) -> d={d[60][0]-d[40][0]:+.1f}pp")
        else:
            print(f"   fric_mult={fm}: incomplete {sorted(d)}")

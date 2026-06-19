#!/usr/bin/env python3
"""Stage 53 (Step 3) — is the VANOS over-response an over-strong intake RAM?

Stage 52 found at 3900 WOT the intake-advance response is over-steep: VE jumps +40pp going
bias 40->60 (the last 20deg of advance), far above the physical ~10-20pp. Hypothesis: the
intake runner is too resonant (Q too high / length mis-tuned), so once IVO is early enough
to catch the ram pulse the (exaggerated) ram over-fills. Test: detune the ram by scaling the
runner length (OPENWAM_RUNNER_SC) and measure whether the over-response slope d = VE(b60) -
VE(b40) shrinks. If detuning flattens it, the ram is the root cause (and RUNNER_SC / runner
geometry is the calibration lever); if d is invariant, the ram is NOT the cause (look to
overlap scavenging / exhaust).

Grid: 3900 WOT, exhaust bias 63 (stock-coord), intake bias in {40,60}, RUNNER_SC in
{0.8,1.0,1.2}. 6 cells. Choke on, init-MAP fix on, slope-converged. Resumable.

Env: RAM_RPMS (3900), RAM_SCS (0.8,1.0,1.2), RAM_BINS (40,60), RAM_BEX (auto stock-coord),
     RAM_CYCLES (40), RAM_TIMEOUT (1400), RAM_OMP (4), RAM_CSV (/tmp/ram_test.csv).
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = "/home/user/OpenWAM/CSL_Simulator/backend"
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPMS = [int(x) for x in os.environ.get("RAM_RPMS", "3900").split(",")]
SCS = [float(x) for x in os.environ.get("RAM_SCS", "0.8,1.0,1.2").split(",")]
BINS = [float(x) for x in os.environ.get("RAM_BINS", "40,60").split(",")]
CYCLES = int(os.environ.get("RAM_CYCLES", "40"))
TIMEOUT = os.environ.get("RAM_TIMEOUT", "1400")
OMP = os.environ.get("RAM_OMP", "4")
CSV = os.environ.get("RAM_CSV", "/tmp/ram_test.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def aval(rpm, load): return lut(M["kf_avan1_soll"], rpm, load)

def metrics(t):
    pairs = re.findall(r"Mtrap:([0-9.]+) g", t)
    if len(pairs) < 30: return float("nan"), float("nan"), 0
    ms = [float(x) for x in pairs]; ncyc = len(ms)//6
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(ncyc)]
    slope = (cyc_ve[-1]-cyc_ve[-5])/4 if ncyc >= 5 else float("nan")
    return cyc_ve[-1], slope, ncyc

def gen(rpm, b_in, b_ex, sc, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN"): os.environ.pop(k, None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    os.environ["OPENWAM_RUNNER_SC"] = str(sc)   # the detune lever (read at gen time)
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
            if len(r) >= 4 and r[0] != "rpm": d.add((int(r[0]), float(r[1]), int(float(r[2]))))
    return d

def run_cell(rpm, sc, b_in, b_ex):
    wd = f"/tmp/ram_{rpm}_{sc}_{int(b_in)}"; gen(rpm, b_in, b_ex, sc, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    subprocess.run(["timeout", TIMEOUT, BIN, "m.wam"], cwd=wd,
                   stdout=open(wd+"/run.log","wb"), stderr=subprocess.STDOUT, env=env)
    ve, slope, ncyc = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["rpm","runner_sc","b_in","b_ex","ve","slope","cyc"])
        w.writerow([rpm, sc, f"{b_in:.0f}", f"{b_ex:.0f}", f"{ve:.1f}", f"{slope:+.2f}", ncyc])
    return ve, slope, ncyc

jobs = [(rpm, sc, b) for rpm in RPMS for sc in SCS for b in BINS]
dn = done()
todo = [j for j in jobs if (j[0], j[1], int(j[2])) not in dn]
print(f"# RAM over-response test: {len(todo)}/{len(jobs)} cells TODO", flush=True)
for rpm, sc, b in todo:
    bex = 150.0 - aval(rpm, 100)
    ve, sl, cyc = run_cell(rpm, sc, b, bex)
    print(f"  {rpm} sc={sc} b_in={b:.0f} -> VE {ve:.1f} slope{sl:+.2f} cyc{cyc}", flush=True)

# report: over-response slope d = VE(b60)-VE(b40) per RUNNER_SC
print("\n# ==== over-response vs runner length ====")
rows = [r for r in csv.reader(open(CSV)) if len(r)>=7 and r[0]!="rpm"] if os.path.exists(CSV) else []
for rpm in RPMS:
    print(f" {rpm} rpm:")
    for sc in SCS:
        d = {int(float(r[2])): (float(r[4]), r[5], r[6]) for r in rows if int(r[0])==rpm and abs(float(r[1])-sc)<1e-6}
        if 40 in d and 60 in d:
            dd = d[60][0]-d[40][0]
            print(f"   sc={sc}: VE(b40)={d[40][0]:.1f}(sl{d[40][1]}) VE(b60)={d[60][0]:.1f}(sl{d[60][1]}) -> over-response d={dd:+.1f}pp")
        else:
            print(f"   sc={sc}: incomplete {sorted(d)}")

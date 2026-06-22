#!/usr/bin/env python3
"""Stage 55 — topology probe: which intake element makes the ram resonance too sharp?

Stage 54: the resonance is structurally too sharp (high Q); scalar knobs can't broaden it.
Before remodelling geometry, pinpoint WHICH topology element sets Q by measuring the
over-response d = VE(bias60) - VE(bias40) at 3900 WOT for existing topology variants (zero
code change -- all env flags):
  base      : current (central-plenum eq-tube)
  eqchain   : OPENWAM_EQ_CHAIN=1  (continuous balance tube -- no central Helmholtz cavity)
  noeqtube  : OPENWAM_NO_EQTUBE=1 (eq-tube removed -- isolates runner/plenum organ pipe)
If d collapses for eqchain/noeqtube, the eq-tube cross-coupling is the Q culprit (remodel the
balance tube). If d stays ~+40, it's the runner/plenum organ pipe (remodel runner L/D + plenum).

3900 WOT, exhaust bias 63, intake bias {40,60}. Choke+init-MAP on, slope-converged, resumable.
Env: TP_CONFIGS (base,eqchain,noeqtube), TP_BINS (40,60), TP_CYCLES(40), TP_TIMEOUT(1400).
"""
import sys, os, io, re, json, math, subprocess, statistics, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_capped
sys.path.insert(0, HERE)
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

M = json.load(open(os.path.join(HERE, "app/data/csl_ecu_maps.json")))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000
RPM = int(os.environ.get("TP_RPM", "3900"))
CONFIGS = os.environ.get("TP_CONFIGS", "base,eqchain,noeqtube").split(",")
BINS = [float(x) for x in os.environ.get("TP_BINS", "40,60").split(",")]
CYCLES = int(os.environ.get("TP_CYCLES", "40"))
TIMEOUT = os.environ.get("TP_TIMEOUT", "1400")
OMP = os.environ.get("TP_OMP", "4")
CSV = os.environ.get("TP_CSV", "/tmp/topo_probe.csv")

def lut(m, rpm, load):
    rx, ly, V = m["x_axis"], m["y_axis"], m["values"]
    return V[min(range(len(ly)), key=lambda i: abs(ly[i]-load))][min(range(len(rx)), key=lambda i: abs(rx[i]-rpm))]
def aval(rpm): return lut(M["kf_avan1_soll"], rpm, 100)

CFG_ENV = {  # extra env per config (applied at gen + run time)
    "base":     {},
    "eqchain":  {"OPENWAM_EQ_CHAIN": "1"},
    "noeqtube": {"OPENWAM_NO_EQTUBE": "1"},
}

def metrics(t):
    ms = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", t)]
    n = len(ms)//6
    if n < 5: return float("nan"), float("nan"), n
    cyc_ve = [statistics.mean(ms[c*6:(c+1)*6])/M_REF*100 for c in range(n)]
    return cyc_ve[-1], (cyc_ve[-1]-cyc_ve[-5])/4, n

def gen(cfg, b_in, b_ex, wd):
    os.makedirs(wd, exist_ok=True)
    for k in ("OPENWAM_EQ_MISTUNE", "OPENWAM_EQ_CHAIN", "OPENWAM_NO_EQTUBE"): os.environ.pop(k, None)
    os.environ.pop("OPENWAM_RUNNER_SC", None); os.environ.pop("OPENWAM_RUNNER_FRIC_MULT", None)
    os.environ["OPENWAM_THR_GAMMA"] = "1.4"
    for k, v in CFG_ENV[cfg].items(): os.environ[k] = v
    cfg_o = SimConfig(); cfg_o.engine.rpm = float(RPM); cfg_o.engine.throttle_position = 1.0
    cfg_o.engine.vanos_intake_bias = float(b_in); cfg_o.engine.vanos_exhaust_bias = float(b_ex)
    cfg_o.simulation.duration_cycles = CYCLES; cfg_o.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); o = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg_o, wd).generate(ignition_timing=20.0); sys.stdout = o
    open(wd+"/m.wam", "w").write(c)

def done():
    d = set()
    if os.path.exists(CSV):
        for r in csv.reader(open(CSV)):
            if len(r) >= 3 and r[0] != "config": d.add((r[0], int(float(r[1]))))
    return d

def run_cell(cfg, b_in, b_ex):
    wd = f"/tmp/tp_{cfg}_{int(b_in)}"; gen(cfg, b_in, b_ex, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]=OMP
    env["OPENWAM_VEDIAG"]="1"; env["OPENWAM_THR_CHOKE"]="1"
    for k, v in CFG_ENV[cfg].items(): env[k] = v
    run_capped([BIN, "m.wam"], wd, wd+"/run.log", TIMEOUT, env)
    ve, slope, n = metrics(open(wd+"/run.log", encoding="utf-8", errors="ignore").read())
    new = not os.path.exists(CSV)
    with open(CSV, "a", newline="") as f:
        w = csv.writer(f)
        if new: w.writerow(["config","b_in","ve","slope","cyc"])
        w.writerow([cfg, f"{b_in:.0f}", f"{ve:.1f}", f"{slope:+.2f}", n])
    return ve, slope, n

bex = 150.0 - aval(RPM)
jobs = [(cfg, b) for cfg in CONFIGS for b in BINS]
dn = done(); todo = [j for j in jobs if (j[0], int(j[1])) not in dn]
print(f"# topology probe @ {RPM} WOT: {len(todo)}/{len(jobs)} TODO", flush=True)
for cfg, b in todo:
    ve, sl, n = run_cell(cfg, b, bex)
    print(f"  {cfg} b_in={b:.0f} -> VE {ve:.1f} slope{sl:+.2f} cyc{n}", flush=True)

print(f"\n# ==== over-response by topology @ {RPM} WOT ====")
rows = [r for r in csv.reader(open(CSV)) if len(r)>=5 and r[0]!="config"] if os.path.exists(CSV) else []
for cfg in CONFIGS:
    d = {int(float(r[1])): (float(r[2]), r[3]) for r in rows if r[0]==cfg}
    if 40 in d and 60 in d:
        print(f"  {cfg:>9}: VE(b40)={d[40][0]:.1f}(sl{d[40][1]}) VE(b60)={d[60][0]:.1f}(sl{d[60][1]}) -> d={d[60][0]-d[40][0]:+.1f}pp")
    else:
        print(f"  {cfg:>9}: incomplete {sorted(d)}")

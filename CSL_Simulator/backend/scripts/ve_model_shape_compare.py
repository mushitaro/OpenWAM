#!/usr/bin/env python3
"""Compare the eq-tube model VARIANTS against the stock WOT VE-rpm SHAPE.

For each model (plenum = default, chain = OPENWAM_EQ_CHAIN) run WOT at the stock
table's own rpm breakpoints, converge, and report VE vs the stock target. The point
is the SHAPE match (does the sim reproduce the 3900 peak / high-rpm plateau / dips),
which is what matters for using the sim as a VANOS/front-pipe optimiser -- the
absolute offset is removed by the calibration correction matrix.
"""
import sys, os, io, re, subprocess, math, json, time

BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BORE, STROKE = 0.087, 0.091
M_REF = math.pi*(BORE/2)**2*STROKE * (101325/(287.05*298.0)) * 1000  # g @ VE=100%
STOCK = {d["rpm"]: d["ve"] for d in json.load(open(os.path.join(os.path.dirname(HERE),
         "app/data/stock_csl_ve.json")))}
# operating-range breakpoints that define the shape (skip idle <1800)
BP = [3900, 4600, 5300, 6300, 7300]
CYCLES = 26
VLV_SRC = "/tmp/vediag_5300"  # reuse an existing intake.vlv/exhaust.vlv

def gen(rpm, chain, wd):
    os.makedirs(wd, exist_ok=True)
    env_chain = os.environ.copy()
    if chain: env_chain["OPENWAM_EQ_CHAIN"] = "1"
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    # generator reads env at construction/generate time
    saved = dict(os.environ)
    if chain: os.environ["OPENWAM_EQ_CHAIN"] = "1"
    elif "OPENWAM_EQ_CHAIN" in os.environ: del os.environ["OPENWAM_EQ_CHAIN"]
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = old
    os.environ.clear(); os.environ.update(saved)
    open(os.path.join(wd, "m.wam"), "w").write(c)
    for f in ("intake.vlv", "exhaust.vlv"):
        s = os.path.join(VLV_SRC, f)
        if os.path.exists(s):
            open(os.path.join(wd, f), "wb").write(open(s, "rb").read())

def launch(rpm, chain):
    wd = f"/tmp/shp_{'chain' if chain else 'plen'}_{rpm}"
    gen(rpm, chain, wd)
    env = os.environ.copy(); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = "1"
    env["OPENWAM_VEDIAG"] = "1"
    lf = open(os.path.join(wd, "run.log"), "wb")
    return subprocess.Popen(["timeout", "320", BIN, "m.wam"], cwd=wd, stdout=lf,
                            stderr=subprocess.STDOUT, env=env)

def parse(rpm, chain):
    wd = f"/tmp/shp_{'chain' if chain else 'plen'}_{rpm}"
    t = open(os.path.join(wd, "run.log"), encoding='utf-8', errors='ignore').read()
    ms = [float(x) for x in re.findall(r'Mtrap:([0-9.]+) g', t)]
    if len(ms) < 6: return float('nan')
    seg = ms[-6:]
    if any(x > 1.5 or x < 1e-3 for x in seg): return float('nan')  # blown/collapsed
    return sum(seg)/len(seg)/M_REF*100

# run in parallel batches
BATCH = 5
jobs = [(rpm, ch) for ch in (False, True) for rpm in BP]
res = {}
i = 0
while i < len(jobs):
    batch = jobs[i:i+BATCH]
    procs = [(rpm, ch, launch(rpm, ch)) for (rpm, ch) in batch]
    for rpm, ch, p in procs:
        p.wait()
    i += BATCH

for rpm, ch in jobs:
    res[(rpm, ch)] = parse(rpm, ch)

print(f"# M_REF={M_REF:.4f} g  CYCLES={CYCLES}")
print(f"{'RPM':>5} {'stock%':>7} {'plenum%':>8} {'chain%':>7} {'plen/st':>8} {'chn/st':>7}")
sp, sc, st = [], [], []
for rpm in BP:
    s = STOCK[rpm]*100; p = res[(rpm, False)]; c = res[(rpm, True)]
    print(f"{rpm:5d} {s:7.1f} {p:8.1f} {c:7.1f} {p/s:8.2f} {c/s:7.2f}")
    if not math.isnan(p) and not math.isnan(c):
        st.append(s); sp.append(p); sc.append(c)

def corr(a, b):
    n=len(a); ma=sum(a)/n; mb=sum(b)/n
    cov=sum((x-ma)*(y-mb) for x,y in zip(a,b))
    va=math.sqrt(sum((x-ma)**2 for x in a)); vb=math.sqrt(sum((y-mb)**2 for y in b))
    return cov/(va*vb) if va*vb>0 else float('nan')

if len(st) >= 3:
    print(f"\n# SHAPE correlation vs stock (1.0=perfect shape match):")
    print(f"#   plenum: r={corr(sp,st):.3f}   chain: r={corr(sc,st):.3f}")
    # also detrended (remove mean ratio) peak/plateau check
    print(f"# stock peak @ {BP[st.index(max(st))]}  plenum peak @ {BP[sp.index(max(sp))]}  chain peak @ {BP[sc.index(max(sc))]}")

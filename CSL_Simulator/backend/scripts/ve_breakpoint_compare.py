#!/usr/bin/env python3
"""VE vs the REAL kf_rf_soll breakpoints (NO interpolation), three ways:
  (1) initial VE  -- early cycle, BEFORE the hot-recirculation feedback locks in
  (2) cold-pinned -- OPENWAM_TPIN=310 held all run (breathing with proper density)
  (3) converged   -- late cycle (hot feedback fully developed)
Each measured AT the table's own RPM breakpoints, compared to the table value there.

Goal: does the thermally-uncontaminated breathing (1)/(2) reproduce the real PEAKY
target shape, or is it flat? If cold/initial is peaky and converged is flat, the
flatness is purely the feedback. If even cold/initial is flat, the breathing model
itself is missing the tuning.
Usage: ve_breakpoint_compare.py [mode]   mode in {init,cold,conv}
"""
import sys, os, io, re, subprocess, math, json

MODE = sys.argv[1] if len(sys.argv) > 1 else "init"
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BORE, STROKE = 0.087, 0.091
M_REF = math.pi*(BORE/2)**2*STROKE * (101325/(287.05*298.0)) * 1000  # g @ VE=100%
STOCK = [(d["rpm"], d["ve"]) for d in json.load(open("app/data/stock_csl_ve.json"))]
# Use the table's own breakpoints (no interpolation). Skip <1500 (idle, unstable)
# and the very top to keep run time sane; these are all EXACT table RPMs.
BP = [r for r, _ in STOCK if 1500 <= r <= 7900]
TGT = dict(STOCK)

if MODE == "init":
    CYCLES, TPIN, TAKE = 3, None, "first"   # earliest converged-geometry cycle
elif MODE == "cold":
    CYCLES, TPIN, TAKE = 8, "310", "last"   # cold-pinned, settled
elif MODE == "conv":
    CYCLES, TPIN, TAKE = 10, None, "last"
else:
    raise SystemExit("mode must be init|cold|conv")

def run(rpm):
    # Each run gets its own working dir so parallel processes don't clobber the
    # generator's fixed-name side files (intake.vlv / exhaust.vlv) or each other.
    wd = f"/tmp/bpwd_{MODE}_{rpm}"
    os.makedirs(wd, exist_ok=True)
    cfg = SimConfig(); cfg.engine.rpm = float(rpm); cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = CYCLES; cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    c = WAMGenerator(cfg, wd).generate(ignition_timing=20.0); sys.stdout = old
    wam = os.path.join(wd, "model.wam"); log = f"/tmp/bp_{MODE}_{rpm}.log"
    open(wam, "w").write(c)
    env = dict(os.environ); env["OPENWAM_HLLC"] = "1"; env["OMP_NUM_THREADS"] = "1"
    if TPIN: env["OPENWAM_TPIN"] = TPIN
    with open(log, "wb") as lf:
        p = subprocess.Popen(["timeout", "90", BIN, "model.wam"], cwd=wd,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
        w, cap = 0, 4_000_000
        for ch in iter(lambda: p.stdout.read(65536), b""):
            if w < cap: lf.write(ch[:cap-w]); w += len(ch)
        p.wait()
    t = open(log, encoding='utf-8', errors='ignore').read()
    tms = [float(x) for x in re.findall(r'Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)', t)]
    # de-duplicate the double-print (each IVC printed twice) -- keep ORDER, do not
    # magnitude-filter yet (filtering first would reorder cycles).
    dd = []
    for v in tms:
        if not dd or abs(dd[-1]-v) > 1e-9: dd.append(v)
    nan = len(re.findall(r'DEBUG BC NaN', t)); fin = 1 if 'FINISHED CORRECTLY' in t else 0
    if len(dd) < 6: return float('nan'), nan, fin
    if TAKE == "first":
        # EXACTLY the first full cycle (6 cyl), before any thermal feedback or
        # divergence develops. Reject if that cycle already shows non-physical
        # fill (>1.2 g ~ 190% VE) -> unreliable.
        seg = dd[:6]
        if any(x > 1.2 or x < 1e-3 for x in seg):
            return float('nan'), nan, fin
    else:
        # last full cycle; here a magnitude sanity filter is appropriate
        good = [m for m in dd if 1e-3 < m < 1.2]
        if len(good) < 6: return float('nan'), nan, fin
        seg = good[-6:]
    m = sum(seg)/len(seg)
    return m, nan, fin

print(f"# MODE={MODE} CYCLES={CYCLES} TPIN={TPIN} TAKE={TAKE}  M_REF={M_REF:.4f} g")
print(f"{'RPM':>5} {'VE_sim%':>8} {'tgt%':>6} {'gap_pp':>7} {'ratio':>6} {'NaN':>4} {'FIN':>3}")
out = []
for rpm in BP:
    m, nan, fin = run(rpm)
    ve = m/M_REF*100
    tgt = TGT[rpm]*100
    print(f"{rpm:5d} {ve:8.1f} {tgt:6.1f} {ve-tgt:7.1f} {ve/tgt:6.2f} {nan:4d} {fin:3d}", flush=True)
    out.append((rpm, ve, tgt, nan, fin))
open(f"/tmp/bp_{MODE}.csv", "w").write(
    "rpm,ve_sim,ve_tgt,nan,fin\n" + "\n".join(f"{r},{v:.2f},{t:.2f},{n},{f}" for r,v,t,n,f in out))
print(f"# CSV: /tmp/bp_{MODE}.csv")

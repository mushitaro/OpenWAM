#!/usr/bin/env python3
"""First-cycle VE sweep (interim, pre-freeze-data harvest).

The exhaust 1-D solver currently freezes (dt->0) at the cyl-3 first blowdown,
but the cylinder trapped mass is recorded cleanly *before* the freeze (the gas
state is healthy, NaN=0). This sweep generates each WOT operating point, runs
OpenWAM single-threaded under a wall-clock + byte cap (so a freeze just hits the
timeout instead of hanging), reads the last `INFO: Trapped mass:` line, converts
it to volumetric efficiency, and compares against the stock CSL VE curve.

VE_sim = trapped_mass_per_cyl / (V_cyl * rho_ambient).
This is FIRST-CYCLE, not multi-cycle-converged -- treat as a trend, not a final
number. See docs/EXHAUST_STABILIZATION_NOTES.md (Stage 7).

Usage: ve_first_cycle_sweep.py [timeout_s]
"""
import sys, io, os, re, subprocess, time, json, math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
TMO = int(sys.argv[1]) if len(sys.argv) > 1 else 40

# Geometry (S54 CSL)
BORE, STROKE = 0.087, 0.091
V_CYL = math.pi * (BORE / 2) ** 2 * STROKE
RHO_AMB = 101325 / (287.05 * 298.0)
M_REF = V_CYL * RHO_AMB  # kg, VE=100% charge per cylinder

# Stock CSL VE (WOT), rpm -> VE
STOCK = {d["rpm"]: d["ve"] for d in
         json.load(open("app/data/stock_csl_ve.json"))}

def stock_ve(rpm):
    xs = sorted(STOCK)
    if rpm <= xs[0]: return STOCK[xs[0]]
    if rpm >= xs[-1]: return STOCK[xs[-1]]
    for i in range(len(xs) - 1):
        if xs[i] <= rpm <= xs[i + 1]:
            t = (rpm - xs[i]) / (xs[i + 1] - xs[i])
            return STOCK[xs[i]] * (1 - t) + STOCK[xs[i + 1]] * t
    return STOCK[xs[-1]]

RPMS = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000]

rows = []
for rpm in RPMS:
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = 2
    cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    gen = WAMGenerator(cfg, output_dir="."); content = gen.generate(ignition_timing=20.0)
    sys.stdout = old
    wam = f"/tmp/vefc_{rpm}.wam"; log = f"/tmp/vefc_{rpm}.log"; open(wam, "w").write(content)
    t0 = time.time()
    with open(log, "wb") as lf:
        p = subprocess.Popen(["timeout", str(TMO), "env", "OMP_NUM_THREADS=1", BIN, wam],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        w, cap = 0, 2_000_000
        for ch in iter(lambda: p.stdout.read(65536), b""):
            if w < cap: lf.write(ch[: cap - w]); w += len(ch)
        p.wait()
    dt = time.time() - t0
    t = open(log, encoding="utf-8", errors="ignore").read()
    tms = re.findall(r"Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)", t)
    nan = len(re.findall(r"DEBUG BC NaN", t))
    # last *physical* trapped mass (ignore the 1e-77 dead-system values)
    good = [float(x) for x in tms if 1e-3 < float(x) < 2.0]
    m_last = good[-1] if good else float("nan")
    ve_sim = (m_last / 1000.0) / M_REF * 100 if good else float("nan")
    ve_stk = stock_ve(rpm) * 100
    rows.append((rpm, m_last, ve_sim, ve_stk, ve_sim - ve_stk, nan, dt))

print(f"{'RPM':>5} {'trap_g':>7} {'VE_sim%':>8} {'VE_stock%':>9} {'delta%':>7} {'NaN':>4} {'wall_s':>6}")
print("-" * 56)
for rpm, m, vs, vk, dd, nan, dt in rows:
    ms = f"{m:.4f}" if m == m else "  --  "
    vss = f"{vs:7.1f}" if vs == vs else "   --  "
    print(f"{rpm:5d} {ms:>7} {vss} {vk:9.1f} {dd:+7.1f} {nan:4d} {dt:6.0f}")

# Save CSV
with open("/tmp/ve_first_cycle.csv", "w") as f:
    f.write("rpm,trapped_g,ve_sim_pct,ve_stock_pct,delta_pct,nan,wall_s\n")
    for rpm, m, vs, vk, dd, nan, dt in rows:
        f.write(f"{rpm},{m:.5f},{vs:.2f},{vk:.2f},{dd:.2f},{nan},{dt:.0f}\n")
print("\nCSV: /tmp/ve_first_cycle.csv")

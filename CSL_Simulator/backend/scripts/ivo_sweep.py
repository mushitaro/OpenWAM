#!/usr/bin/env python3
"""Intake-valve-opening (IVO) calibration sweep for the CSL 268 deg intake cam.

Why this exists
---------------
The cam base was corrected to the true E46 M3 *CSL* hardware: 268 deg intake /
264 deg exhaust (the standard S54B32 is 260/260). Because IVC = IVO + duration,
the +8 deg intake-duration bump moves IVC 8 deg *later*, which worsens the known
late-IVC backflow (hot charge pushed back into the runner during early
compression -> uniform VE under-fill). This sweep re-finds the IVO base
(``OPENWAM_IVO``) that places the 268 deg window correctly for the new cam.

Metric (important)
------------------
``ve_first_cycle_sweep.py`` used the *peak* physical trapped mass. Inspection of
the time series shows the peak is a START-UP overshoot (e.g. 0.666 g at t=5 ms),
NOT the settled value. The trapped mass then plateaus (e.g. 0.403 g held over
two consecutive dumps) before the cyl-3 exhaust freeze degrades it (0.37, 0.26,
then a dead ~1e-76 system). The MEDIAN of the physical readings is robust to
both the start-up overshoot and the freeze tail and lands on the plateau, so we
report the median as the primary VE estimate (peak/last shown for context).

VE_sim = trapped_mass_per_cyl / (V_cyl * rho_ambient).
First-cycle, not multi-cycle-converged -- read as a relative trend across IVO.

The VANOS reference offset (K_EVAN1_OFFSET = -2 deg) is always applied by the
generator, so the EFFECTIVE IVO = knob - (bias + offset) = knob + 2 with bias=0.
The table prints the effective IVO and the resulting IVC in deg ABDC.

Usage:
    ivo_sweep.py [--rpms 3000,4000,5000,6000] [--ivos 310,320,...,370]
                 [--timeout 30] [--cycles 2]
"""
import sys, io, os, re, subprocess, time, json, math, argparse, statistics

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"

# Geometry (S54 CSL)
BORE, STROKE = 0.087, 0.091
V_CYL = math.pi * (BORE / 2) ** 2 * STROKE
RHO_AMB = 101325 / (287.05 * 298.0)
M_REF = V_CYL * RHO_AMB                      # kg, 100% charge per cylinder
INTAKE_TDC, BDC = 360.0, 540.0              # gas-exchange reference angles

STOCK = {d["rpm"]: d["ve"] for d in
         json.load(open("app/data/stock_csl_ve.json"))}


def stock_ve(rpm):
    xs = sorted(STOCK)
    if rpm <= xs[0]:
        return STOCK[xs[0]]
    if rpm >= xs[-1]:
        return STOCK[xs[-1]]
    for i in range(len(xs) - 1):
        if xs[i] <= rpm <= xs[i + 1]:
            t = (rpm - xs[i]) / (xs[i + 1] - xs[i])
            return STOCK[xs[i]] * (1 - t) + STOCK[xs[i + 1]] * t
    return STOCK[xs[-1]]


def run_point(rpm, ivo, cycles, timeout):
    os.environ["OPENWAM_IVO"] = str(float(ivo))
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = cycles
    cfg.exhaust.port_junction_vol = 0.0
    in_dur = cfg.engine.head.intake_valve.duration
    off = cfg.engine.vanos_intake_offset
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    gen = WAMGenerator(cfg, output_dir="/tmp")
    content = gen.generate(ignition_timing=20.0)
    sys.stdout = old
    wam = f"/tmp/ivo_{rpm}_{ivo}.wam"
    open(wam, "w").write(content)
    t0 = time.time()
    p = subprocess.run(["timeout", str(timeout), "env", "OMP_NUM_THREADS=1", BIN, wam],
                       capture_output=True, text=True, errors="ignore")
    dt = time.time() - t0
    out = p.stdout + p.stderr
    tms = re.findall(r"Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)", out)
    nan = len(re.findall(r"DEBUG BC NaN", out))
    good = [float(x) for x in tms if 1e-3 < float(x) < 2.0]
    try:
        os.remove(wam)
    except OSError:
        pass
    if not good:
        return dict(rpm=rpm, ivo=ivo, med=float("nan"), peak=float("nan"),
                    last=float("nan"), n=0, nan=nan, dt=dt, in_dur=in_dur, off=off)
    return dict(rpm=rpm, ivo=ivo, med=statistics.median(good), peak=max(good),
                last=good[-1], n=len(good), nan=nan, dt=dt, in_dur=in_dur, off=off)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpms", default="3000,4000,5000,6000")
    ap.add_argument("--ivos", default="310,320,330,340,350,360,370")
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--cycles", type=int, default=2)
    a = ap.parse_args()
    rpms = [int(x) for x in a.rpms.split(",")]
    ivos = [float(x) for x in a.ivos.split(",")]

    all_rows = []
    for rpm in rpms:
        print(f"\n=== RPM {rpm}  (stock VE {stock_ve(rpm)*100:.0f}%) ===")
        print(f"{'IVOknob':>7} {'effIVO':>6} {'IVC_ABDC':>8} {'med_g':>7} "
              f"{'VE_med%':>7} {'dVE%':>6} {'peak_g':>6} {'last_g':>6} "
              f"{'n':>2} {'NaN':>4} {'s':>4}")
        print("-" * 78)
        rows = []
        for ivo in ivos:
            r = run_point(rpm, ivo, a.cycles, a.timeout)
            eff_ivo = ivo - (0.0 + r["off"])          # bias=0; +2 with off=-2
            ivc_abdc = (eff_ivo + r["in_dur"]) - BDC
            ve = (r["med"] / 1000.0) / M_REF * 100 if r["med"] == r["med"] else float("nan")
            dve = ve - stock_ve(rpm) * 100 if ve == ve else float("nan")
            r.update(eff_ivo=eff_ivo, ivc_abdc=ivc_abdc, ve=ve, dve=dve)
            rows.append(r); all_rows.append(r)
            ms = f"{r['med']:.4f}" if r["med"] == r["med"] else "  --  "
            vs = f"{ve:7.1f}" if ve == ve else "   --  "
            dv = f"{dve:+6.1f}" if dve == dve else "  --  "
            print(f"{ivo:7.0f} {eff_ivo:6.0f} {ivc_abdc:8.0f} {ms:>7} {vs} {dv} "
                  f"{r['peak']:6.3f} {r['last']:6.3f} {r['n']:2d} {r['nan']:4d} {r['dt']:4.0f}")
        good = [r for r in rows if r["ve"] == r["ve"]]
        if good:
            best = min(good, key=lambda r: abs(r["dve"]))   # closest to stock
            top = max(good, key=lambda r: r["ve"])           # max fill
            print(f"  -> closest-to-stock IVO knob={best['ivo']:.0f} "
                  f"(effIVO {best['eff_ivo']:.0f}, IVC {best['ivc_abdc']:.0f} ABDC, "
                  f"VE {best['ve']:.0f}%, dVE {best['dve']:+.0f})")
            print(f"  -> max-fill        IVO knob={top['ivo']:.0f} "
                  f"(VE {top['ve']:.0f}%)")

    with open("/tmp/ivo_sweep.csv", "w") as f:
        f.write("rpm,ivo_knob,eff_ivo,ivc_abdc,med_g,ve_med_pct,dve_pct,"
                "peak_g,last_g,n,nan,wall_s\n")
        for r in all_rows:
            f.write(f"{r['rpm']},{r['ivo']:.0f},{r['eff_ivo']:.0f},{r['ivc_abdc']:.0f},"
                    f"{r['med']:.5f},{r['ve']:.2f},{r['dve']:.2f},{r['peak']:.4f},"
                    f"{r['last']:.4f},{r['n']},{r['nan']},{r['dt']:.0f}\n")
    print("\nCSV: /tmp/ivo_sweep.csv")


if __name__ == "__main__":
    main()

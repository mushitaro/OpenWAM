#!/usr/bin/env python3
"""Intake energy/mass-flux balance: decide the ~570 K intake artifact root cause.

The converged combustion-OFF intake sits at ~570 K although every boundary is
cold (25 C source, 40 C walls/plenum) -- a numerical artifact (see Stage 16).
This driver answers the open question "energy GAINED (A) or mass LOST (B)?" and
localises WHERE, using the OPENWAM_ENBAL per-pipe balance probe.

For each pipe it reports, per crank-angle window, the time-averaged mass flux
and total-enthalpy flux carried at BOTH ends (mdot = rho*u*A, Hdot =
mdot*(cp*T + u^2/2)) plus the flux-weighted end temperatures. Steady state =>
<mdotL> == <mdotR> (mass conserved) and <HdotL> - <HdotR> ~ wall heat (~0).

Three variants isolate the equalization tube:
  baseline  - as shipped (eq-tube plenum + phi10 stubs)
  noeq      - OPENWAM_NO_EQTUBE=1  (eq-tube removed; junction reduces to 2-pipe)
  bigstub   - OPENWAM_EQ_DIA=0.052 (stub enlarged to the runner diameter)

Combustion is turned OFF (fuel LHV zeroed) so any heating is purely numerical.

Usage: intake_energy_balance.py [rpm] [variant]
       variant in {baseline, noeq, bigstub, all}  (default all)
"""
import os, io, sys, subprocess, re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
RPM = float(sys.argv[1]) if len(sys.argv) > 1 else 4000.0
WHICH = sys.argv[2] if len(sys.argv) > 2 else "all"

ENBAL_RE = re.compile(
    r"ENBAL pipe(\d+) Th=([\d.]+)-([\d.]+) mdot\[L,R\]=\s*(\S+)\s+(\S+) kg/s "
    r"dM=\s*(\S+) Hdot\[L,R\]=\s*(\S+)\s+(\S+) W dH\(in-out\)=\s*(\S+) W "
    r"Tflux\[L,R\]=([\d.]+) ([\d.]+) K")


def run_variant(name, extra_env):
    env = dict(os.environ)
    env["OPENWAM_IVO"] = "330.0"
    env["OPENWAM_HLLC"] = "1"
    env["OPENWAM_ENBAL"] = "1"
    env["OPENWAM_ENBAL_MAX"] = "8"
    env["OMP_NUM_THREADS"] = "1"
    env.update(extra_env)

    # Generate with the same env (NO_EQTUBE / EQ_DIA are read at generation time).
    gen_env = dict(os.environ); gen_env.update(extra_env)
    for k, v in gen_env.items():
        os.environ[k] = v
    cfg = SimConfig()
    cfg.engine.rpm = RPM
    cfg.engine.throttle_position = 1.0
    cfg.simulation.duration_cycles = 10
    cfg.exhaust.port_junction_vol = 0.0
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    content = WAMGenerator(cfg, output_dir="/tmp").generate(ignition_timing=20.0)
    sys.stdout = old
    # Combustion OFF: zero the fuel LHV so any heating is numerical.
    content = content.replace("0.98 44000000 750", "0.98 1 750")
    model = f"enbal_{name}"
    open(f"/tmp/{model}.wam", "w").write(content)

    print(f"\n=== variant '{name}' ({RPM:.0f} RPM WOT, HLLC, combustion OFF) ===")
    r = subprocess.run(["timeout", "240", BIN, f"/tmp/{model}.wam"],
                       capture_output=True, text=True, errors="ignore", env=env)
    # Keep the LAST window per pipe.
    last = {}
    for m in ENBAL_RE.finditer(r.stdout):
        last[int(m.group(1))] = m.groups()
    if not last:
        print("  (no ENBAL output -- run failed?)")
        tail = "\n".join(r.stdout.splitlines()[-4:])
        print("  tail:", tail)
        return
    print("  pipe |   mdotL      mdotR     dM     |   HdotL      HdotR    dH(in-out) | TfluxL TfluxR")
    for pid in sorted(last):
        g = last[pid]
        print(f"  {pid:>4} | {g[3]:>10} {g[4]:>10} {g[5]:>8} | "
              f"{g[6]:>10} {g[7]:>10} {g[8]:>10} | {g[9]:>5}  {g[10]:>5}")


VARIANTS = {
    "baseline": {},
    "noeq": {"OPENWAM_NO_EQTUBE": "1"},
    "bigstub": {"OPENWAM_EQ_DIA": "0.052"},
}

if WHICH == "all":
    for name in ("baseline", "noeq", "bigstub"):
        run_variant(name, VARIANTS[name])
else:
    run_variant(WHICH, VARIANTS.get(WHICH, {}))

print("\nReading: a per-pipe |dM| ~ |mdot| signals a mass leak (B); a large "
      "negative dH(in-out) with no heat source signals energy gain (A). "
      "Stage 16: the heat localises to the airbox plenum (T jumps between the "
      "filter and the bellmouth), fed by cylinder backflow -> hypothesis (A).")

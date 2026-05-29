#!/usr/bin/env python3
"""Self-contained smoke test for the small-plenum exhaust port-merge.

Generates a WAM at a given RPM with a reduced cycle count, runs OpenWAM under a
wall-clock + byte cap (log lands in /tmp, outside the repo so nothing in the
working tree can race it), and prints health metrics + a verdict.

Usage: smoke_sp.py [rpm] [cycles] [timeout_s]
"""
import sys, io, os, re, subprocess, time

RPM = float(sys.argv[1]) if len(sys.argv) > 1 else 4000.0
CYCLES = int(sys.argv[2]) if len(sys.argv) > 2 else 6
TMO = int(sys.argv[3]) if len(sys.argv) > 3 else 240

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

cfg = SimConfig()
cfg.engine.rpm = RPM
cfg.engine.throttle_position = 1.0
cfg.simulation.duration_cycles = CYCLES

buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
gen = WAMGenerator(cfg, output_dir='.')
content = gen.generate(ignition_timing=27.0)
sys.stdout = old

wam = f"/tmp/smoke_{int(RPM)}.wam"
log = f"/tmp/smoke_{int(RPM)}.log"
open(wam, "w").write(content)
print(f"GEN ok: plenums={len(gen.plenum_ids)} pipes={len(gen.pipes)} "
      f"cycles={CYCLES} -> {wam}")

binr = "/home/user/OpenWAM/build/bin/release/OpenWAM"
t0 = time.time()
with open(log, "wb") as lf:
    p = subprocess.Popen([ "timeout", str(TMO), binr, wam ],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    written = 0
    cap = 5_000_000
    for chunk in iter(lambda: p.stdout.read(65536), b""):
        if written < cap:
            lf.write(chunk[: cap - written]); written += len(chunk)
    p.wait()
rc = p.returncode
dt = time.time() - t0

t = open(log, encoding="utf-8", errors="ignore").read()
def c(pat): return len(re.findall(pat, t))
prog = [int(x) for x in re.findall(r"Progress\s*:\s*(\d+)", t)]
trap = re.findall(r"Trapped mass:\s*([0-9.]+)", t)
maxp = max(prog) if prog else -1
completed = "INFO: THE SIMULATION HAS FINISHED" in t.upper() or rc == 0 and maxp >= 99

print(f"RUN  rc={rc} wall={dt:.0f}s logbytes={len(t)} maxprogress={maxp}%")
print(f"  BC_NaN={c(r'DEBUG BC NaN')}  Sonic={c(r'Sonic condition')}  "
      f"floored={c(r'floored non-physical')}  no_mass={c(r'no mass in')}  "
      f"timestep_err={c(r'ERROR : in time step')}")
print(f"  trapped_samples={len(trap)} last_trapped={trap[-1] if trap else None} g")
crashed = c(r'DEBUG BC NaN') > 0 or c(r'ERROR : in time step') > 0
if completed:
    print("VERDICT: COMPLETED")
elif not crashed and maxp >= 1:
    print(f"VERDICT: STABLE-BUT-SLOW (reached {maxp}%, no NaN/abort, hit cap/timeout)")
else:
    print("VERDICT: DIVERGED")
print("--- tail ---")
print("\n".join(t.splitlines()[-8:]))

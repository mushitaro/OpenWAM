# Stage 73 box-mode ROM probe (moved from the session scratchpad).
# Outputs go to backend/rom_probe_out/. See HANDOFF Stage 73 banner.
#!/usr/bin/env python3
"""Stage 72 box-mode ROM diagnosis: generate the v11a deck at one WOT cell,
run the SVC binary directly with OPENWAM_BOX_MODE + _DIAG, capture q(t).

Usage: python boxdiag.py <rpm> <gain> [freq] [zeta] [tag]
Writes deck+output into the scratchpad dir; prints BOXMODE lines + cycle VEs.
"""
import io, contextlib, json, math, os, re, subprocess, sys, time

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rom_probe_out")
os.makedirs(HERE, exist_ok=True)
BACKEND = r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend"
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

os.environ["OPENWAM_FAST_OUTPUT"] = "1"  # DECK-side: must be set BEFORE generate()

import run_cells_local as R
from app.simulator import calibration_constants as calib
from app.simulator import metrics as M
from app.simulator.simulation_service import SimulationService
from app.simulator.wam_generator import WAMGenerator

rpm = float(sys.argv[1]) if len(sys.argv) > 1 else 4600.0
gain = sys.argv[2] if len(sys.argv) > 2 else "1e-4"
freq = sys.argv[3] if len(sys.argv) > 3 else "318"
zeta = sys.argv[4] if len(sys.argv) > 4 else "0.3"
tag = sys.argv[5] if len(sys.argv) > 5 else "diag"
vgate = sys.argv[6] if len(sys.argv) > 6 else ""
cap = sys.argv[7] if len(sys.argv) > 7 else ""

V11A = json.load(open(os.path.join(BACKEND, "calib_data", "stage72_v11_jobs.json")))[0]["set"]

job = {"rpm": rpm, "load": 100, "set": V11A, "tag": tag}
cfg = R.build_config(job, int(os.environ.get("BOXDIAG_CYCLES", "60")))
cal = calib.load(R.DATA_DIR)
_icv = calib.icv_sigma(cal)
if _icv is not None:
    cfg.intake.eq_tube.icv_sigma = _icv
cfg.engine.intake_cam_spread = float(R._lut(R.MAPS["kf_evan1_soll"], rpm, 100))
cfg.engine.exhaust_cam_spread = float(R._lut(R.MAPS["kf_avan1_soll"], rpm, 100))
cfg.engine.vanos_intake_bias = 0.0
cfg.engine.vanos_exhaust_bias = 0.0

gen = WAMGenerator(cfg, HERE)
gen._sigma_bp = calib.thr_sigma_points(cal)
ign = M.ignition_for(R.MAPS, rpm, 100)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    content = gen.generate(ignition_timing=ign)
deck = os.path.join(HERE, f"boxdiag_{tag}_{int(rpm)}.wam")
with open(deck, "w") as f:
    f.write(content)

mouths = {k: v for k, v in gen._box_cc_map.items() if k.endswith(".mouth")}
print("MOUTH CCs (deck cids):", mouths, flush=True)
# C++ FNumeroCC = deck cid + 1 (Stage 64)
cc1 = ",".join(str(mouths[f"Bellmouth_{i}.mouth"] + 1) for i in (1, 2, 3))
cc2 = ",".join(str(mouths[f"Bellmouth_{i}.mouth"] + 1) for i in (4, 5, 6))
print(f"CC1={cc1}  CC2={cc2}  ign={ign}", flush=True)

svc = SimulationService(data_dir=R.DATA_DIR, simulator_dir=R.SIM_DIR)
exe = svc._resolve_exe()
env = dict(os.environ)
env.update(svc._build_sim_env(cal, True, fast=True, load=100))
if gain != "off":
    env["OPENWAM_BOX_MODE"] = f"{freq},{zeta},{gain}"
    env["OPENWAM_BOX_MODE_CC1"] = cc1
    env["OPENWAM_BOX_MODE_CC2"] = cc2
    env["OPENWAM_BOX_MODE_DIAG"] = "1"
    if vgate:
        env["OPENWAM_BOX_MODE_VGATE"] = vgate
    if cap:
        env["OPENWAM_BOX_MODE_CAP"] = cap
    if os.environ.get("BOX_T0"):
        env["OPENWAM_BOX_MODE_T0"] = os.environ["BOX_T0"]
    if os.environ.get("BOX_TR"):
        env["OPENWAM_BOX_MODE_TR"] = os.environ["BOX_TR"]
print("EXE:", exe, flush=True)
print("ENV extras:", {k: v for k, v in env.items() if k.startswith("OPENWAM")}, flush=True)

t0 = time.time()
p = subprocess.run([exe, os.path.basename(deck)], cwd=HERE, env=env,
                   capture_output=True, text=True,
                   timeout=int(os.environ.get("BOXDIAG_TIMEOUT", "3600")))
out = p.stdout
open(os.path.join(HERE, f"boxdiag_{tag}_{int(rpm)}.out"), "w").write(out + "\n=== STDERR ===\n" + (p.stderr or ""))

mtrap = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", out)]
m_ref = M.m_ref_mg(cfg.engine.geometry.bore, cfg.engine.geometry.stroke,
                   cfg.environment.ambient_pressure, cfg.environment.ambient_temp)
ncyc = len(mtrap) // 6
cyc_ve = [sum(mtrap[c*6:(c+1)*6]) / 6.0 * 1000.0 / m_ref * 100.0 for c in range(ncyc)]
print(f"rc={p.returncode} t={time.time()-t0:.0f}s cycles={ncyc}", flush=True)
print("cycle VE:", " ".join(f"{v:.1f}" for v in cyc_ve), flush=True)
bm = [l for l in out.splitlines() if l.startswith("BOXMODE")]
print(f"BOXMODE lines: {len(bm)}")
for l in bm[:40]:
    print(" ", l)
if len(bm) > 40:
    print("  ... last 10:")
    for l in bm[-10:]:
        print(" ", l)

# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Diagnostic: Map plenum IDs to physical names"""
import sys, os, json
sys.path.insert(0, '.')
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

with open('app/data/csl_ecu_maps.json') as f:
    ECU_MAPS = json.load(f)

def interpolate_2d(x_axis, y_axis, data, x_val, y_val):
    x_idx = 0
    for i, x in enumerate(x_axis):
        if x >= x_val: x_idx = max(0, i-1); break
    else: x_idx = len(x_axis) - 2
    y_idx = 0
    for i, y in enumerate(y_axis):
        if y >= y_val: y_idx = max(0, i-1); break
    else: y_idx = len(y_axis) - 2
    x1, x2 = x_axis[x_idx], x_axis[min(x_idx+1, len(x_axis)-1)]
    y1, y2 = y_axis[y_idx], y_axis[min(y_idx+1, len(y_axis)-1)]
    q11 = data[y_idx][x_idx]; q21 = data[y_idx][min(x_idx+1, len(x_axis)-1)]
    q12 = data[min(y_idx+1, len(y_axis)-1)][x_idx]; q22 = data[min(y_idx+1, len(y_axis)-1)][min(x_idx+1, len(x_axis)-1)]
    dx = x2 - x1 if x2 != x1 else 1; dy = y2 - y1 if y2 != y1 else 1
    wx = max(0, min(1, (x_val - x1) / dx)); wy = max(0, min(1, (y_val - y1) / dy))
    return (q11*(1-wx)+q21*wx)*(1-wy) + (q12*(1-wx)+q22*wx)*wy

INTAKE_MAP = ECU_MAPS['kf_evan1_soll']
EXHAUST_MAP = ECU_MAPS['kf_avan1_soll']

rpm, ro = 2200, 0.39
b_in = 130.0 - interpolate_2d(INTAKE_MAP['x_axis'], INTAKE_MAP['y_axis'], INTAKE_MAP['values'], rpm, ro)
b_ex = interpolate_2d(EXHAUST_MAP['x_axis'], EXHAUST_MAP['y_axis'], EXHAUST_MAP['values'], rpm, ro) - 128.0

cfg = SimConfig()
cfg.engine.rpm = float(rpm)
cfg.engine.throttle_position = float(ro / 100.0)
cfg.engine.vanos_intake_bias = float(b_in)
cfg.engine.vanos_exhaust_bias = float(b_ex)

# Monkey-patch _add_plenum to log plenum creation
original_add_plenum = WAMGenerator._add_plenum
plenum_log = []

def logged_add_plenum(self, plid, label, vol, wall_temp, ptype=0):
    plenum_log.append((plid, label, vol, ptype))
    original_add_plenum(self, plid, label, vol, wall_temp, ptype)

WAMGenerator._add_plenum = logged_add_plenum

gen = WAMGenerator(cfg, '.')
content = gen.generate(ignition_timing=25.0)

print(f"\n=== Plenum ID Map ===")
print(f"{'ID':>4} {'Label':<30} {'Vol(cc)':>10} {'Type':>5}")
print("-" * 55)
for plid, label, vol, ptype in sorted(plenum_log, key=lambda x: x[0]):
    vol_cc = vol * 1e6
    marker = " <<<" if plid == 27 or plid == 28 else ""
    print(f"{plid:4d} {label:<30} {vol_cc:10.1f} {ptype:5d}{marker}")

print(f"\nTotal plenums: {len(plenum_log)}")

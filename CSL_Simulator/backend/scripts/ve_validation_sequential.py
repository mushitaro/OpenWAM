"""
VE Validation Sequential - Single-threaded execution with unique files per point
"""
import os
import sys
import subprocess
import re
import json
import time
import csv

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

WAM_BIN = r"c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"

# Load OEM VE Map
with open("app/data/csl_ecu_maps.json") as f:
    ECU_MAPS = json.load(f)
VE_MAP = ECU_MAPS["kf_rf_soll"]
INTAKE_MAP = ECU_MAPS["kf_evan1_soll"]
EXHAUST_MAP = ECU_MAPS["kf_avan1_soll"]

def interpolate_2d(x_axis, y_axis, data, x_val, y_val):
    x_idx = 0
    for i, x in enumerate(x_axis):
        if x >= x_val:
            x_idx = max(0, i - 1)
            break
    else:
        x_idx = len(x_axis) - 2
    
    y_idx = 0
    for i, y in enumerate(y_axis):
        if y >= y_val:
            y_idx = max(0, i - 1)
            break
    else:
        y_idx = len(y_axis) - 2
    
    x1, x2 = x_axis[x_idx], x_axis[min(x_idx+1, len(x_axis)-1)]
    y1, y2 = y_axis[y_idx], y_axis[min(y_idx+1, len(y_axis)-1)]
    
    q11 = data[y_idx][x_idx]
    q21 = data[y_idx][min(x_idx+1, len(x_axis)-1)]
    q12 = data[min(y_idx+1, len(y_axis)-1)][x_idx]
    q22 = data[min(y_idx+1, len(y_axis)-1)][min(x_idx+1, len(x_axis)-1)]
    
    dx = x2 - x1 if x2 != x1 else 1
    dy = y2 - y1 if y2 != y1 else 1
    
    wx = max(0, min(1, (x_val - x1) / dx))
    wy = max(0, min(1, (y_val - y1) / dy))
    
    r1 = q11 * (1 - wx) + q21 * wx
    r2 = q12 * (1 - wx) + q22 * wx
    return r1 * (1 - wy) + r2 * wy

def get_oem_ve(rpm, tps):
    return interpolate_2d(VE_MAP["x_axis"], VE_MAP["y_axis"], VE_MAP["values"], rpm, tps) * 100

def get_vanos_bias(rpm, tps):
    intake_raw = interpolate_2d(INTAKE_MAP["x_axis"], INTAKE_MAP["y_axis"], INTAKE_MAP["values"], rpm, tps)
    intake_bias = 130.0 - intake_raw
    exhaust_raw = interpolate_2d(EXHAUST_MAP["x_axis"], EXHAUST_MAP["y_axis"], EXHAUST_MAP["values"], rpm, tps)
    exhaust_bias = exhaust_raw - 128.0
    return intake_bias, exhaust_bias

# Validation points: (RPM, RO%)
# VE sensitivity is concentrated in RO 0.1-10% range.
# OEM map has 16/24 breakpoints in this range.
VALIDATION_POINTS = [
    # Low RO% - VE high-sensitivity zone (5% → 79% VE)
    (2200, 0.39),
    (2200, 1.0),
    (2200, 3.2),
    (2200, 7.5),
    (3100, 0.39),
    (3100, 1.0),
    (3100, 3.2),
    (3100, 7.5),
    (5000, 1.0),
    (5000, 5.0),
    (5000, 10.0),
    # Mid/High RO% - VE plateau zone
    (3100, 20.0),
    (3100, 45.0),
    (5000, 45.0),
    (5000, 100.0),
    (7000, 10.0),
    (7000, 100.0),
]

print("=" * 70)
print(" VE Validation - SEQUENTIAL Execution (v2)")
print("=" * 70)
print(f"\nRunning {len(VALIDATION_POINTS)} points sequentially (RO% = Relative Opening)...")
print()

# Initialize CSV with header
csv_path = os.path.join("output", "ve_validation_results_seq.csv")
os.makedirs("output", exist_ok=True)
with open(csv_path, "w", newline='') as f:
    writer = csv.DictWriter(f, fieldnames=["rpm", "ro", "exit_code", "mass_mg", "ve_sim", "ve_oem", "diff"])
    writer.writeheader()

print(f"Results will be saved incrementally to {csv_path}")

results = []
for i, (rpm, ro) in enumerate(VALIDATION_POINTS):
    print(f"[{i+1}/{len(VALIDATION_POINTS)}] Running {rpm} RPM @ RO={ro}%...")
    
    b_in, b_ex = get_vanos_bias(rpm, ro)
    
    # Use unique file names per point to avoid locking issues
    wam_file = f"temp_seq_{i}_{rpm}_{ro}.wam"
    log_file = f"log_seq_{i}_{rpm}_{ro}.txt"
    
    # Clean up any existing files first
    for f in [wam_file, log_file]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except:
                pass
    
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = float(ro / 100.0)
    cfg.engine.vanos_intake_bias = float(b_in)
    cfg.engine.vanos_exhaust_bias = float(b_ex)
    
    gen = WAMGenerator(cfg, ".")
    content = gen.generate(ignition_timing=25.0)
    
    with open(wam_file, "w") as f:
        f.write(content)
    
    mass_mg = 0.0
    exit_code = -1
    try:
        cmd = f'"{WAM_BIN}" {wam_file} > {log_file} 2>&1'
        result = subprocess.run(cmd, shell=True, timeout=120, check=False)
        exit_code = result.returncode
        
        # Wait a moment to ensure file is fully written
        time.sleep(0.1)
        
        if os.path.exists(log_file):
            with open(log_file, "r", encoding='utf-8', errors='ignore') as f:
                log_content = f.read()
            
            # Find ALL trapped mass values and take the LAST one
            masses = re.findall(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", log_content)
            if masses:
                mass_mg = float(masses[-1]) * 1000  # Take last (most stable) value
                
    except subprocess.TimeoutExpired:
        print(f"   TIMEOUT!")
    except Exception as e:
        print(f"   Error: {e}")
    
    # Calculate VE
    R_air = 287.058
    rho_air = 101325.0 / (R_air * 298.0)
    th_mass = 543.0 * (rho_air / 1000.0) * 1000.0  # mg
    
    ve_sim = (mass_mg / th_mass) * 100.0 if th_mass > 0 else 0
    ve_oem = get_oem_ve(rpm, ro)
    diff = ve_sim - ve_oem
    
    status = "✅" if ve_sim > 50 else "❌"
    print(f"   {status} Exit={exit_code}, Mass={mass_mg:.2f}mg, VE_sim={ve_sim:.1f}%, VE_oem={ve_oem:.1f}%, Δ={diff:+.1f}%")
    
    curr_result = {
        "rpm": rpm,
        "ro": ro,
        "exit_code": exit_code,
        "mass_mg": round(mass_mg, 2),
        "ve_sim": round(ve_sim, 1),
        "ve_oem": round(ve_oem, 1),
        "diff": round(diff, 1)
    }
    results.append(curr_result)
    
    # Append to CSV immediately
    with open(csv_path, "a", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["rpm", "ro", "exit_code", "mass_mg", "ve_sim", "ve_oem", "diff"])
        writer.writerow(curr_result)
    
    # Cleanup temp files immediately after each point
    # for f in [wam_file, log_file]:
    #     if os.path.exists(f):
    #         try:
    #             os.remove(f)
    #         except:
    #             pass

print("\n" + "=" * 70)
print(" SEQUENTIAL VALIDATION SUMMARY (RO% = Relative Opening)")
print("=" * 70)
print(f"\n{'RPM':>5} {'RO%':>7} {'Exit':>5} {'Mass(mg)':>10} {'VE_sim':>7} {'VE_oem':>7} {'Diff':>7}")
print("-" * 55)

success_count = 0
for r in results:
    status = "✓" if r['ve_sim'] > 50 else "✗"
    print(f"{r['rpm']:5d} {r['ro']:7.2f} {r['exit_code']:5d} {r['mass_mg']:10.2f} {r['ve_sim']:7.1f} {r['ve_oem']:7.1f} {r['diff']:+7.1f} {status}")
    if r['ve_sim'] > 50:
        success_count += 1

print("-" * 55)
print(f"\nSuccess Rate: {success_count}/{len(results)} ({100*success_count//len(results)}%)")

# Calculate statistics for successful points
successful_diffs = [abs(r['diff']) for r in results if r['ve_sim'] > 50]
if successful_diffs:
    avg_diff = sum(successful_diffs) / len(successful_diffs)
    print(f"Mean Absolute Error (successful points): {avg_diff:.1f}%")

if success_count == len(results):
    print("\n✅ All points passed!")
else:
    print(f"\n❌ {len(results) - success_count} points failed.")

# Save results to CSV
import csv
csv_path = os.path.join("output", "ve_validation_results_seq.csv")
os.makedirs("output", exist_ok=True)
with open(csv_path, "w", newline='') as f:
    writer = csv.DictWriter(f, fieldnames=["rpm", "ro", "exit_code", "mass_mg", "ve_sim", "ve_oem", "diff"])
    writer.writeheader()
    writer.writerows(results)
print(f"\nResults saved to {csv_path}")

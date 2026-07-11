# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""
VE Validation Sweep Script
Runs a focused set of operating points to compare simulation results with OEM ECU VE map
"""
import os
import sys
import subprocess
import re
import json
import concurrent.futures
from multiprocessing import freeze_support

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

WAM_BIN = r"c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"
MAX_WORKERS = 8

# Load OEM VE Map
with open("app/data/csl_ecu_maps.json") as f:
    ECU_MAPS = json.load(f)
VE_MAP = ECU_MAPS["kf_rf_soll"]

# VANOS Maps from ECU
INTAKE_MAP = ECU_MAPS["kf_evan1_soll"]
EXHAUST_MAP = ECU_MAPS["kf_avan1_soll"]

def interpolate_2d(x_axis, y_axis, data, x_val, y_val):
    """Bilinear interpolation"""
    # Find x index
    x_idx = 0
    for i, x in enumerate(x_axis):
        if x >= x_val:
            x_idx = max(0, i - 1)
            break
    else:
        x_idx = len(x_axis) - 2
    
    # Find y index
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
    
    wx = (x_val - x1) / dx
    wy = (y_val - y1) / dy
    wx = max(0, min(1, wx))
    wy = max(0, min(1, wy))
    
    r1 = q11 * (1 - wx) + q21 * wx
    r2 = q12 * (1 - wx) + q22 * wx
    return r1 * (1 - wy) + r2 * wy

def get_oem_ve(rpm, tps):
    """Get OEM VE value from ECU map"""
    return interpolate_2d(VE_MAP["x_axis"], VE_MAP["y_axis"], VE_MAP["values"], rpm, tps) * 100

def get_vanos_bias(rpm, tps):
    """Get VANOS bias from ECU maps"""
    # Intake: map value is target position, bias = 130 - value
    intake_raw = interpolate_2d(INTAKE_MAP["x_axis"], INTAKE_MAP["y_axis"], INTAKE_MAP["values"], rpm, tps)
    intake_bias = 130.0 - intake_raw
    
    # Exhaust: map value is target position, bias = value - 128  
    exhaust_raw = interpolate_2d(EXHAUST_MAP["x_axis"], EXHAUST_MAP["y_axis"], EXHAUST_MAP["values"], rpm, tps)
    exhaust_bias = exhaust_raw - 128.0
    
    return intake_bias, exhaust_bias

# Ignition timing table from CSL ECU
class IgnitionMapper:
    # Ignition BASE MAP (18x12)
    # X-Axis: RPM
    RPM = [600, 700, 900, 1000, 1200, 1300, 1600, 1900, 2200, 2400, 3000, 3500, 4400, 5200, 6000, 7000, 7200, 7600]
    # Y-Axis: rf% (load as ratio 0.1 - 1.1)
    LOAD = [0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00, 1.10]
    
    DATA = [
        # 600 700 900 1000 1200 1300 1600 1900 2200 2400 3000 3500 4400 5200 6000 7000 7200 7600
        [20, 26, 26, 32, 35, 30, 37, 40, 45, 49, 51, 60, 60, 60, 60, 60, 60, 60], # 0.10
        [16, 22, 22, 27, 30, 24, 32, 35, 40, 43, 45, 60, 60, 60, 60, 60, 60, 60], # 0.15
        [12, 21, 21, 20, 22, 23, 25, 30, 35, 38, 40, 52, 55, 60, 60, 60, 60, 60], # 0.20
        [ 8, 12, 16, 17, 18, 22, 24, 27, 30, 34, 36, 43, 50, 53, 58, 60, 60, 60], # 0.30
        [ 6, 12, 14, 14, 18, 20, 23, 23, 26, 29, 33, 34, 40, 44, 48, 55, 55, 60], # 0.40
        [ 4, 10, 11, 11, 14, 16, 18, 22, 24, 26, 31, 31, 36, 40, 41, 47, 47, 52], # 0.50
        [ 2,  6, 10,  8, 12, 15, 17, 22, 23, 25, 30, 30, 35, 35, 37, 40, 43, 45], # 0.60
        [ 0,  5,  9,  9, 15, 17, 17, 21, 23, 24, 26, 29, 32, 32, 32, 35, 36, 39], # 0.70
        [-2,  4,  9, 10, 15, 17, 18, 20, 21, 23, 24, 28, 30, 30, 31, 33, 33, 33], # 0.80
        [ 0,  4,  9, 10, 15, 17, 18, 20, 21, 22, 24, 27, 28, 28, 30, 31, 31, 31], # 0.90
        [ 2,  4,  9, 10, 15, 17, 18, 20, 21, 21, 23, 26, 27, 27, 29, 29, 28, 30], # 1.00
        [ 2,  4,  9, 10, 15, 17, 18, 20, 21, 20, 22, 25, 27, 27, 29, 27, 27, 29]  # 1.10
    ]

    @classmethod
    def get_timing(cls, rpm, load):
        """Get ignition timing from map using bilinear interpolation"""
        return interpolate_2d(cls.RPM, cls.LOAD, cls.DATA, rpm, load)

def run_point(args):
    """Run single simulation point"""
    rpm, tps, worker_id = args
    
    b_in, b_ex = get_vanos_bias(rpm, tps)
    
    # Calculate ignition timing (TPS% -> load ratio for lookup)
    rf_load = tps / 100.0
    ign_timing = IgnitionMapper.get_timing(rpm, rf_load)
    
    wam_file = f"temp_val_{worker_id}.wam"
    log_file = f"log_val_{worker_id}.txt"
    
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = float(tps / 100.0)
    cfg.engine.vanos_intake_bias = float(b_in)
    cfg.engine.vanos_exhaust_bias = float(b_ex)
    
    gen = WAMGenerator(cfg, ".")
    content = gen.generate(ignition_timing=ign_timing)
    
    with open(wam_file, "w") as f:
        f.write(content)
    
    mass_mg = 0.0
    try:
        cmd = f'"{WAM_BIN}" {wam_file} > {log_file} 2>&1'
        subprocess.run(cmd, shell=True, timeout=300, check=True)
        
        if os.path.exists(log_file):
            with open(log_file, "r", encoding='utf-8', errors='ignore') as f:
                for line in f:
                    match = re.search(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", line)
                    if match:
                        mass_mg = float(match.group(1)) * 1000  # Convert to mg
    except Exception as e:
        print(f"  Error at {rpm} RPM, {tps}% TPS: {e}")
    
    # Cleanup
    for f in [wam_file, log_file]:
        if os.path.exists(f):
            try: os.remove(f)
            except: pass
    
    # Calculate VE
    bore = 87.0 / 1000  # m
    stroke = 91.0 / 1000  # m
    import math
    displacement = (math.pi * (bore/2)**2 * stroke) * 6  # 6-cylinder
    rho_air = 101325 / (287.05 * 298)  # kg/m3
    theoretical_mass = displacement * rho_air * 1000 * 1000  # mg
    
    ve_sim = (mass_mg / theoretical_mass) * 100 if theoretical_mass > 0 else 0
    ve_oem = get_oem_ve(rpm, tps)
    
    return {
        "rpm": rpm,
        "tps": tps,
        "vanos_in": round(b_in, 1),
        "vanos_ex": round(b_ex, 1),
        "mass_mg": round(mass_mg, 2),
        "ve_sim": round(ve_sim, 1),
        "ve_oem": round(ve_oem, 1),
        "diff": round(ve_sim - ve_oem, 1),
        "diff_pct": round((ve_sim - ve_oem) / ve_oem * 100 if ve_oem > 0 else 0, 1)
    }

# Key validation points - spread across operating range
VALIDATION_POINTS = [
    # Low RPM / Low Load
    (1100, 5),
    (1400, 10),
    # Mid RPM / Part Load
    (2200, 20),
    (2700, 25),
    (3000, 45),
    (3100, 50),
    # Mid RPM / High Load
    (3500, 65),
    (4000, 85),
    # High RPM
    (5000, 65),
    (5500, 85),
    (6000, 100),
    (6500, 85),
    (7000, 100),
]

if __name__ == "__main__":
    freeze_support()
    
    print("=" * 70)
    print(" VE Validation Sweep - Comparing Simulation vs OEM ECU Map")
    print("=" * 70)
    print(f"\nRunning {len(VALIDATION_POINTS)} validation points...")
    print()
    
    # Prepare work items
    work_items = [(rpm, tps, i) for i, (rpm, tps) in enumerate(VALIDATION_POINTS)]
    
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(run_point, item): item for item in work_items}
        
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print(f"  ✓ {result['rpm']:4d} RPM @ {result['tps']:3d}% TPS: "
                  f"VE_sim={result['ve_sim']:5.1f}% vs VE_oem={result['ve_oem']:5.1f}% "
                  f"(Δ={result['diff']:+5.1f}%, {result['diff_pct']:+5.1f}% relative)")
    
    # Sort by RPM then TPS
    results.sort(key=lambda x: (x['rpm'], x['tps']))
    
    print("\n" + "=" * 70)
    print(" VALIDATION SUMMARY")
    print("=" * 70)
    print(f"\n{'RPM':>5} {'TPS%':>5} {'VANOS_In':>9} {'VANOS_Ex':>9} {'Mass(mg)':>10} {'VE_sim':>7} {'VE_oem':>7} {'Diff':>7} {'Rel%':>7}")
    print("-" * 70)
    
    total_diff = 0
    total_abs_diff = 0
    for r in results:
        print(f"{r['rpm']:5d} {r['tps']:5d} {r['vanos_in']:+9.1f} {r['vanos_ex']:+9.1f} {r['mass_mg']:10.2f} {r['ve_sim']:7.1f} {r['ve_oem']:7.1f} {r['diff']:+7.1f} {r['diff_pct']:+7.1f}")
        total_diff += r['diff']
        total_abs_diff += abs(r['diff'])
    
    avg_diff = total_diff / len(results)
    avg_abs_diff = total_abs_diff / len(results)
    
    print("-" * 70)
    print(f"\nStatistics:")
    print(f"  Average Difference: {avg_diff:+.1f}%")
    print(f"  Mean Absolute Error: {avg_abs_diff:.1f}%")
    print(f"  Total Points: {len(results)}")
    
    # Save results
    import csv
    with open("ve_validation_results.csv", "w", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print(f"\nResults saved to ve_validation_results.csv")

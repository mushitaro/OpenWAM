# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================

import os
import sys
import pandas as pd
import time
import subprocess
import re
import gc
import concurrent.futures
import csv
from multiprocessing import freeze_support, Manager

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import shared models/logic
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

# Configuration
OUTPUT_FILE = "ve_table_csl.csv"
WAM_BIN = r"c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"
MAX_WORKERS = 10  # Reduced to ~70% CPU (was 14 for 80%)

# --- VANOS MAP DATA (Shared) ---
class VANOSMapper:
    # 1. Intake Map (KF_EVAN1_SOLL)
    INTAKE_RPM = [600, 900, 1100, 1400, 1600, 1800, 2200, 2700, 2900, 3100, 4000, 5000, 5800, 6800, 7000, 7800]
    INTAKE_TPS = [0.15, 0.40, 0.80, 1.20, 1.60, 2.40, 4.80, 7.60, 11.00, 15.00, 20.00, 25.00, 30.00, 45.00, 65.00, 85.00]
    INTAKE_DATA = [
        [130,130,130,130,130,130,130,130,130,130,130,130,120,120,120,120],
        [130,130,130,130,130,130,130,130,130,130,130,130,120,120,120,120],
        [125,120,120,120,130,130,130,130,130,130,130,130,120,120,120,120],
        [120,120,120,120,125,125,125,125,125,125,130,130,120,120,120,120],
        [115,115,115,115,117,120,120,120,120,120,125,120,120,120,120,120],
        [110,115,115,115,110,115,115,115,115,115,120,115,115,120,120,120],
        [105,110,110,110,105,110,110,110,110,110,115,110,110,115,115,120],
        [100,105,105,105,100,105,105,105,105,105,105,105,105,110,110,120],
        [94, 100,105,100,95, 100,100,100,100,100,100,100,105,110,110,120],
        [88, 97, 105,94, 95, 95, 95, 95, 100,100,100,100,100,110,110,120],
        [82, 97, 100,89, 89, 90, 90, 90, 95, 95, 95, 95, 100,110,110,120],
        [76, 97, 95, 84, 82, 85, 85, 85, 90, 90, 90, 95, 100,110,110,120],
        [76, 97, 95, 79, 75, 80, 80, 85, 85, 85, 85, 90, 100,110,110,120],
        [76, 97, 97, 70, 70, 75, 75, 80, 85, 78, 78, 88, 98, 111,111,120],
        [76, 97, 97, 70, 70, 75, 75, 80, 80, 70, 70, 88, 96, 111,111,120],
        [76, 97, 97, 70, 70, 75, 75, 80, 80, 70, 70, 88, 96, 111,111,120]
    ]

    # 2. Exhaust Map (KF_AVAN1_SOLL)
    EXHAUST_RPM = [900, 1300, 2100, 2400, 2700, 2900, 3000, 3100, 3800, 4600, 5200, 5400, 6200, 6400, 7200, 7400]
    EXHAUST_TPS = [0.15, 0.40, 0.80, 1.20, 1.60, 2.40, 4.80, 7.60, 11.00, 15.00, 20.00, 25.00, 30.00, 45.00, 65.00, 85.00]
    EXHAUST_DATA = [
        [128,128,128,128,128,128,128,128,128,108,108,108,108,108,108,108],
        [123,118,113,116,116,116,116,116,118,108,108,108,108,108,108,108],
        [118,108,103,103,108,108,111,113,108,108,108,108,108,108,108,108],
        [113,98, 98, 98, 103,103,103,103,103,108,108,108,108,108,108,108],
        [108,98, 98, 98, 98, 98, 96, 93, 93, 98, 108,108,108,108,103,103],
        [103,98, 93, 93, 93, 93, 91, 88, 88, 103,103,103,103,103,103,103],
        [100,93, 88, 88, 93, 93, 91, 88, 88, 103,98, 98, 98, 98, 98, 98],
        [100,93, 88, 88, 93, 88, 88, 88, 88, 98, 93, 98, 98, 98, 98, 98],
        [100,93, 83, 88, 93, 88, 88, 88, 88, 98, 93, 98, 98, 98, 98, 98],
        [100,93, 83, 88, 93, 88, 88, 88, 93, 98, 98, 98, 103,103,103,103],
        [100,93, 83, 88, 93, 93, 88, 88, 93, 98, 98, 98, 103,103,103,103],
        [100,88, 83, 88, 93, 93, 88, 88, 93, 98, 98, 103,103,103,103,103],
        [100,83, 83, 88, 93, 93, 87, 87, 90, 101,100,103,108,108,108,107],
        [100,83, 83, 90, 93, 93, 87, 87, 87, 104,105,105,108,108,108,107],
        [100,83, 83, 93, 93, 93, 87, 87, 87, 104,105,108,108,111,111,107],
        [100,83, 83, 93, 93, 93, 87, 87, 87, 104,105,108,108,111,111,107]
    ]

    @staticmethod
    def interpolate(x_axis, y_axis, data, x_val, y_val):
        if x_val <= x_axis[0]: x_idx = 0
        elif x_val >= x_axis[-1]: x_idx = len(x_axis) - 2
        else:
            idx = 0
            for i, x in enumerate(x_axis):
                if x >= x_val: 
                    idx = i - 1 if i > 0 else 0
                    break
            x_idx = idx

        if y_val <= y_axis[0]: y_idx = 0
        elif y_val >= y_axis[-1]: y_idx = len(y_axis) - 2
        else:
            idx = 0
            for i, y in enumerate(y_axis):
                if y >= y_val: 
                    idx = i - 1 if i > 0 else 0
                    break
            y_idx = idx
            
        x1, x2 = x_axis[x_idx], x_axis[x_idx+1]
        y1, y2 = y_axis[y_idx], y_axis[y_idx+1]
        q11 = data[y_idx][x_idx]
        q21 = data[y_idx][x_idx+1]
        q12 = data[y_idx+1][x_idx]
        q22 = data[y_idx+1][x_idx+1]
        
        dx = float(x2 - x1)
        dy = float(y2 - y1)
        if dx == 0: dx = 1e-6
        if dy == 0: dy = 1e-6
        
        w_x = (x_val - x1) / dx
        w_y = (y_val - y1) / dy
        
        w_x = max(0.0, min(1.0, w_x))
        w_y = max(0.0, min(1.0, w_y))
        
        r1 = q11 * (1 - w_x) + q21 * w_x
        r2 = q12 * (1 - w_x) + q22 * w_x
        val = r1 * (1 - w_y) + r2 * w_y
        return val

    @classmethod
    def get_intake_bias(cls, rpm, tps):
        map_val = cls.interpolate(cls.INTAKE_RPM, cls.INTAKE_TPS, cls.INTAKE_DATA, rpm, tps)
        return 130.0 - map_val

    @classmethod
    def get_exhaust_bias(cls, rpm, tps):
        map_val = cls.interpolate(cls.EXHAUST_RPM, cls.EXHAUST_TPS, cls.EXHAUST_DATA, rpm, tps)
        return map_val - 128.0

class IgnitionMapper:
    # Ignition BASE MAP (18x12)
    # X-Axis: RPM
    RPM = [600, 700, 900, 1000, 1200, 1300, 1600, 1900, 2200, 2400, 3000, 3500, 4400, 5200, 6000, 7000, 7200, 7600]
    # Y-Axis: rf% (Approximated as TPS 0.1 - 1.1)
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
    def get_timing(cls, rpm, tps):
        # Use VANOSMapper's interpolate function (it's generic)
        return VANOSMapper.interpolate(cls.RPM, cls.LOAD, cls.DATA, rpm, tps)

# --- SIMULATION TARGET GRID (CSL Alpha-N) ---
TARGET_RPM = [600, 870, 1100, 1300, 1400, 1600, 1800, 2100, 2200, 2400, 2700, 2900, 3100, 3900, 4600, 5300, 6300, 6900, 7300, 7900]
TARGET_TPS = [0.10, 0.15, 0.20, 0.39, 0.61, 0.81, 1.00, 1.10, 1.20, 1.39, 1.61, 2.39, 3.20, 5.00, 7.50, 10.01, 14.99, 20.00, 25.00, 30.00, 45.00, 64.99, 85.01, 100.00]


def run_single_point(args):
    rpm, tps, worker_id = args
    
    # Calculate VANOS (Thread-safe locally)
    b_in = VANOSMapper.get_intake_bias(rpm, tps)
    b_ex = VANOSMapper.get_exhaust_bias(rpm, tps)
    
    # Calculate Ignition Timing (using TPS as rf% proxy)
    # rf ~= TPS/100 for NA ITB engine
    rf_load = tps / 100.0
    ign_timing = IgnitionMapper.get_timing(rpm, rf_load)
    
    # Unique ID per worker to avoid file collisions
    unique_id = f"w{worker_id}_{int(rpm)}_{int(tps*1000)}"
    wam_file = f"temp_{unique_id}.wam"
    unique_log = f"log_{unique_id}.txt"
    
    # Generate WAM
    # Config is simple object, cheap to create
    cfg = SimConfig()
    tps_ratio = tps / 100.0
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = float(tps_ratio)
    cfg.engine.vanos_intake_bias = float(b_in)
    cfg.engine.vanos_exhaust_bias = float(b_ex)
    
    # Modify generator path if needed (currently using . as artifacts dir)
    gen = WAMGenerator(cfg, ".")
    content = gen.generate(ignition_timing=ign_timing)
    
    # File I/O
    with open(wam_file, "w") as f: f.write(content)

    mass_mg = 0.0
    try:
        cmd = f'"{WAM_BIN}" {wam_file} > {unique_log} 2>&1'
        # Extended timeout for 2.0s simulation (was 180s for 0.5s)
        subprocess.run(cmd, shell=True, timeout=600, check=True) 
        
        # Parse Line-by-Line
        if os.path.exists(unique_log):
            with open(unique_log, "r", encoding='utf-8', errors='ignore') as f:
                for line in f:
                    match = re.search(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", line)
                    if match:
                        mass_g = float(match.group(1))
                        mass_mg = mass_g * 1000.0
    except Exception:
        pass
    
    finally:
        # Cleanup
        try:
            if os.path.exists(wam_file): os.remove(wam_file)
            if mass_mg > 0 and os.path.exists(unique_log): os.remove(unique_log)
        except: pass

    # VE Calculation
    ve = 0.0
    if mass_mg > 0:
        ve = (mass_mg / 643.0) * 100.0 # Approx theoretical for 540cc
        # Recalculate correctly:
        # 540cc * 1.2041 kg/m3 = 0.650g = 650mg
        # VE = Mass / 650 * 100
        R_air = 287.058
        rho_air = 101325.0 / (R_air * 298.0) # ~1.18
        th_mass = 543.0 * (rho_air / 1000.0) * 1000.0 # mg
        ve = (mass_mg / th_mass) * 100.0

    return (rpm, tps, b_in, b_ex, mass_mg, ve)

def main():
    freeze_support()
    print(f"------------------------------------------------")
    print(f" CSL VE Table PARALLEL Generator")
    print(f" Detected CPU: Intel Core Ultra 9 285H (16 Cores)")
    print(f" Spawning {MAX_WORKERS} Parallel Workers")
    print(f"------------------------------------------------")
    
    # prepare tasks
    tasks = []
    w_idx = 0
    for tps in TARGET_TPS:
        for rpm in TARGET_RPM:
            tasks.append( (rpm, tps, w_idx % MAX_WORKERS) )
            w_idx += 1
            
    print(f"Total Points to Measure: {len(tasks)}")
    
    # Prepare CSV header
    if not os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'w', newline='') as f:
            f.write("RPM,TPS_Target,Bias_Intake,Bias_Exhaust,TrappedMass_mg,VE_Percent\n")
            
    # Load completed
    completed = set()
    if os.path.exists(OUTPUT_FILE):
        try:
            df = pd.read_csv(OUTPUT_FILE)
            for idx, row in df.iterrows():
                completed.add( (int(row['RPM']), round(row['TPS_Target'], 2)) )
        except: pass
        
    # Filter tasks
    pending_tasks = [t for t in tasks if (int(t[0]), round(t[1], 2)) not in completed]
    print(f"Remaining Task: {len(pending_tasks)}\n")
    
    start_all = time.time()
    
    # Run Parallel
    completed_count = 0
    with concurrent.futures.ProcessPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all
        future_map = {executor.submit(run_single_point, t): t for t in pending_tasks}
        
        for future in concurrent.futures.as_completed(future_map):
            task_info = future_map[future]
            try:
                res = future.result()
                rpm, tps, bin_v, bex, mass, ve = res
                
                # Write immediately to CSV (thread safe enough for append usually, or use lock if needed, but low freq is fine)
                # For safety we open/close.
                if mass > 0:
                    with open(OUTPUT_FILE, 'a', newline='') as f:
                        writer = csv.writer(f)
                        writer.writerow([rpm, tps, f"{bin_v:.2f}", f"{bex:.2f}", f"{mass:.4f}", f"{ve:.4f}"])
                    
                    print(f"[{completed_count+1}/{len(pending_tasks)}] {rpm} RPM / {tps}% TPS -> VE: {ve:.1f}%")
                else:
                    print(f"[{completed_count+1}/{len(pending_tasks)}] {rpm} RPM / {tps}% TPS -> FAILED/TIMEOUT")
                
                completed_count += 1
            except Exception as e:
                print(f"Worker Error: {e}")

    duration = time.time() - start_all
    print(f"\nAll Done in {duration/60:.1f} minutes.")

if __name__ == "__main__":
    main()

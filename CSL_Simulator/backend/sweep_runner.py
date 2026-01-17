
import os
import sys
import subprocess
import re
import numpy as np
import pandas as pd
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator, SweepSchedule
from ve_table_runner_v2 import VANOSMapper

# Configuration
WAM_BIN = r"C:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"
OUTPUT_FILE = "ve_table_csl_sweep.csv"
RPM_START = 600.0
RPM_END = 8000.0
SWEEP_DURATION = 15.0 # Seconds
TIME_STEP = 0.5 # For Controller resolution

# Target Grids (for Binning in original code, now used for discrete points)
TARGET_RPMS = [600, 870, 1100, 1500, 1800, 2100, 2200, 2700, 3100, 3500, 3900, 4300, 4700, 5100, 5500, 5900, 6300, 6900, 7300, 7900]
TARGET_TPS_LIST = [0.1, 0.2, 0.39, 0.61, 0.81, 1.0, 1.1, 1.3, 1.61, 2.0, 2.7, 3.7, 4.9, 6.4, 8.4, 11.0, 14.99, 19.49, 29.0, 40.0, 55.0, 70.0, 85.0, 100.0]

def create_steady_schedule(rpm, tps_val, duration_sec=0.1):
    # Short steady hold
    # Times must be increasing
    times = [0.0, duration_sec]
    rpms = [rpm, rpm]
    b_in = VANOSMapper.get_intake_bias(rpm, tps_val)
    b_ex = VANOSMapper.get_exhaust_bias(rpm, tps_val)
    return SweepSchedule(duration_sec, times, rpms, [b_in, b_in], [b_ex, b_ex])

def calculate_ve(mass_mg, displacement_cc=540.0, ambient_temp=293.15, ambient_press=101325.0):
    R_air = 287.058
    rho_air = ambient_press / (R_air * ambient_temp)
    theoretical_mass = displacement_cc * rho_air # roughly 0.65g = 650mg
    if theoretical_mass <= 0: return 0.0
    return (mass_mg / (theoretical_mass * 1000.0)) * 100.0 # mass_mg is mg, theoretical is kg -> *1e6? 
    # Wait. theoretical_mass = 540(cc=ml=1e-6m3?) NO. cc = 1e-6 m3.
    # displacement_cc = 540. -> 540e-6 m3 (0.00054).
    # rho ~ 1.2 kg/m3.
    # th_mass = 0.00054 * 1.2 = 0.000648 kg = 0.648 g = 648 mg.
    # So if calculate_ve inputs mass_mg (e.g. 600).
    # Then we need theoretical in mg.
    # return (mass_mg / (theoretical_mass * 1e6)) * 100 ?
    # Let's fix units properly.
    # displacement (m3) = cc * 1e-6
    vol_m3 = displacement_cc * 1e-6
    th_mass_kg = vol_m3 * rho_air
    th_mass_mg = th_mass_kg * 1e6
    return (mass_mg / th_mass_mg) * 100.0

def process_quasi_steady_sweep(tps_val):
    print(f"Processing Quasi-Steady Sweep for TPS: {tps_val}%")
    results = []
    
    # We use a subset for verification, or full list?
    # Let's use full TARGET_RPMS for the real table.
    rpm_list = TARGET_RPMS  
    
    for rpm in rpm_list:
        print(f"  -> Point {rpm} RPM...")
        cfg = SimConfig()
        cfg.engine.rpm = rpm
        cfg.engine.throttle_position = tps_val / 100.0
        
        # Create steady schedule (Duration 3.0s to ensure cycles at 600RPM)
        # 600 RPM = 10 RPS = 0.1s/rev = 0.2s/cycle. 3.0s = 15 cycles.
        sched = create_steady_schedule(rpm, tps_val, duration_sec=3.0)
        gen = WAMGenerator(cfg, ".")
        content = gen.generate(schedule=sched)
        
        unique_id = f"steady_{int(tps_val)}_{rpm}"
        wam_file = f"{unique_id}.wam"
        log_file = f"{unique_id}.log"
        
        with open(wam_file, "w") as f: f.write(content)
        
        cmd = f'"{WAM_BIN}" {wam_file} > {log_file} 2>&1'
        try:
            # 300 second timeout (5 mins) to prevent premature kill, but streaming allows early exit if needed
            # Filtered Execution using Popen
            mass_mg = 0.0
            found = False
            
            with open(log_file, "w") as f_log:
                # Use shell=True to handle executable path properly on Windows if needed, 
                # but direct Popen is better. We'll use the command string but split it slightly?
                # Actually cmd is a string. shell=True is easiest for compat with existing `cmd` var.
                # Remove redirection from cmd string first.
                cmd_pure = f'"{WAM_BIN}" {wam_file}'
                
                process = subprocess.Popen(cmd_pure, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=True, text=True)
                
                try:
                    # Stream processing
                    for line in process.stdout:
                        # Filter: Keep only important info or Errors
                        # "Trapped mass", "Error", "Warning", "Supersonic"
                        if "Trapped mass" in line or "Error" in line or "Warning" in line or "Supersonic" in line:
                             f_log.write(line)
                             f_log.flush()
                             
                             # Check for Mass on the fly
                             if "Trapped mass" in line and "(g)" in line:
                                 try:
                                     parts = line.split("Trapped mass:")[-1]
                                     val_str = parts.split("(")[0].strip()
                                     val_g = float(val_str)
                                     mass_mg = val_g * 1000.0
                                     found = True
                                     # We don't break here because we want the *LAST* value
                                 except: pass
                                 
                    process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    process.kill()
                    print("     -> Timeout (Internal).")
                    
            if process.returncode != 0 and process.returncode is not None:
                 print(f"     -> Warning: OpenWAM exited with code {process.returncode}")
            
            if not found:
                 print("     -> Warning: Trapped mass not found.")
                 # Check for static "Static VE" issue? 
                 # If SimulationType=0, OpenWAM calculates cycles.
                 pass

            ve = calculate_ve(mass_mg)
            # VANOS
            b_in = VANOSMapper.get_intake_bias(rpm, tps_val)
            b_ex = VANOSMapper.get_exhaust_bias(rpm, tps_val)
            
            results.append({
                'RPM': rpm, 'TPS_Target': tps_val,
                'Bias_Intake': b_in, 'Bias_Exhaust': b_ex,
                'TrappedMass_mg': mass_mg, 'VE_Percent': ve
            })
            print(f"     -> VE: {ve:.2f}% Mass: {mass_mg:.1f}mg")
            
        except subprocess.TimeoutExpired:
             print("     -> Timeout.")
        except Exception as e:
            print(f"     -> Error: {e}")

    return results

def main():
    print("------------------------------------------------")
    print(" CSL VE Sweep Generator (Quasi-Steady)")
    print("------------------------------------------------")
    
    # Initialize CSV
    if not os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'w') as f:
            f.write("RPM,TPS_Target,Bias_Intake,Bias_Exhaust,TrappedMass_mg,VE_Percent\n")
            
    # For now, analyze dynamic VE on a few TPS points
    # Using 20% and 100% as key indicators
    test_tps = [20.0, 100.0] 
    
    for tps in test_tps:
        row_data = process_quasi_steady_sweep(tps)
        
        if row_data:
            df_res = pd.DataFrame(row_data)
            df_res.to_csv(OUTPUT_FILE, mode='a', header=False, index=False)
            print(f"  -> Saved {len(row_data)} points for TPS {tps}.")
        else:
            print("  -> Failed/Empty.")

if __name__ == "__main__":
    main()

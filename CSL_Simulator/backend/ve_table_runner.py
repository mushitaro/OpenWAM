import os
import sys
import pandas as pd
import numpy as np
import re
import time
import subprocess
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

# Configuration for Sweep (Alpha-N)
# X-Axis: RPM
RPMS = [2000]

# Y-Axis: Relative Opening (%) from kf_rf_soll
# Validation Run: 100% TPS
REL_OPENING = [100.0]

OUTPUT_FILE = "ve_table.csv"
WAM_BIN = r"c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"
LOG_FILE = "ve_sim_log.txt"

# Global config reference to be set by main/endpoint
CURRENT_CONFIG = None

def kill_zombie_processes():
    try:
        subprocess.run("taskkill /F /IM OpenWAM.exe", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass
    time.sleep(0.1)

def run_simulation(rpm, rel_opening, vanos_intake=0.0, vanos_exhaust=0.0, base_config=None):
    kill_zombie_processes() # Preemptive cleanup
    
    if base_config is None:
        cfg = SimConfig()
    else:
        import copy
        cfg = copy.deepcopy(base_config)
    
    tps = rel_opening / 100.0
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = float(tps)
    cfg.engine.vanos_intake_bias = float(vanos_intake)
    cfg.engine.vanos_exhaust_bias = float(vanos_exhaust)
    
    gen = WAMGenerator(cfg, ".")
    content = gen.generate()
    
    # 1. Unique Filenames
    unique_id = f"{rpm}_{int(tps*1000)}"
    wam_file = f"temp_calib_{unique_id}.wam"
    unique_log = f"ve_sim_log_{unique_id}.txt"
    
    with open(wam_file, "w") as f:
        f.write(content)

    # 2. Run OpenWAM with cleanup
    try:
        cmd = f'"{WAM_BIN}" {wam_file} > {unique_log} 2>&1'
        # Increased timeout to 30s for debug
        subprocess.run(cmd, shell=True, timeout=30, check=True)
        time.sleep(0.3) 
        
        with open(unique_log, "r") as f:
            log = f.read()
            
        try: 
            os.remove(unique_log)
            os.remove(wam_file)
        except: pass
            
        matches = re.findall(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", log)
        if matches:
            mass_g = float(matches[-1])
            return mass_g * 1000.0
        else:
            print(f" [DATA ERR] Log Tail:\n{log[-500:]}")
            return 0.0
            
    except subprocess.TimeoutExpired:
        # Dump log before killing
        try:
            with open(unique_log, "r") as f: 
                print(f" [TIMEOUT] Log Tail:\n{f.read()[-800:]}")
        except: pass
        kill_zombie_processes() 
        print(f" [TIMEOUT]", end="")
        return 0.0
    except subprocess.CalledProcessError:
        print(f" [CRASH]", end="")
        # Dump log if possible
        try:
            with open(unique_log, "r") as f: print(f.read()[-300:])
        except: pass
        return 0.0
    except Exception as e:
        print(f" [Ex: {e}]", end="")
        return 0.0
    return 0.0

def calculate_ve(mass_mg, displacement_cc=540.0, ambient_temp=293.15, ambient_press=101325.0):
    R_air = 287.058
    rho_air = ambient_press / (R_air * ambient_temp)
    theoretical_mass = displacement_cc * rho_air
    if theoretical_mass <= 0: return 0.0
    return (mass_mg / theoretical_mass) * 100.0

def main():
    print(f"Starting VE Table Generation (Alpha-N)")
    
    csv_mode = 'w'
    if not os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'w') as f:
            f.write("RPM,TPS_Target,TrappedMass_mg,VolumetricEff_Percent\n")
    
    for rel in REL_OPENING:
        print(f"\nProcessing Relative Opening {rel}%...")
        
        for rpm in RPMS:
            print(f"  > {rpm} RPM...", end="", flush=True)
            mass_mg = run_simulation(rpm, rel)
            
            ve = 0.0
            if mass_mg > 0:
                ve = calculate_ve(mass_mg)
                print(f" {ve:.2f}%", end="")
                
                # 5. Atomic Append to CSV
                with open(OUTPUT_FILE, 'a') as f:
                    f.write(f"{rpm},{rel},{mass_mg:.4f},{ve:.4f}\n")
            else:
                print(f" FAIL", end="")
        
        print("") # Newline
    
    print(f"\nSaved to {OUTPUT_FILE}")

if __name__ == "__main__":
    sys.path.append(os.getcwd())
    main()

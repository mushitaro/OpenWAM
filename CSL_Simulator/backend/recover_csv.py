import glob
import re
import pandas as pd
import os

def calculate_ve(mass_mg, displacement_cc=540.0, ambient_temp=293.15, ambient_press=101325.0):
    vol_m3 = displacement_cc * 1e-6
    rho_air = ambient_press / (287.058 * ambient_temp)
    th_mass_kg = vol_m3 * rho_air
    th_mass_mg = th_mass_kg * 1e6
    if th_mass_mg <= 0: return 0.0
    return (mass_mg / th_mass_mg) * 100.0

def process_logs():
    files = glob.glob("steady_20_*.log")
    results = []
    
    print(f"Found {len(files)} log files.")
    
    for log_file in files:
        # Filename: steady_20_600.log
        try:
            parts = log_file.replace(".log", "").split("_")
            tps = float(parts[1])
            rpm = float(parts[2])
        except:
            continue
            
        mass_mg = 0.0
        found = False
        
        try:
            with open(log_file, "r", encoding='utf-8', errors='ignore') as f:
                # Read entire file? huge. Read last 50 lines.
                # Seek to end
                f.seek(0, os.SEEK_END)
                size = f.tell()
                # Read last 50MB (due to massive debug logs)
                to_read = min(size, 52428800)
                f.seek(size - to_read)
                content = f.read()
                lines = content.splitlines()
                
                # Search reversed
                for line in reversed(lines):
                     if "Trapped mass:" in line:
                         # Format: Trapped mass: 604.2 (g)
                         # OR: INFO: ... Trapped mass: 0.6042 (g)
                         # Clean line
                         if "(g)" in line:
                             str_val = line.split("Trapped mass:")[-1].split("(")[0].strip()
                             val = float(str_val)
                             # Heuristic: If val > 100, it's mg (mislabeled as g in print?).
                             # If val < 1, it's kg (printed as g?) NO.
                             # OpenWAM print: val * 1e3.
                             # If Mass is 0.0006 kg => 0.6.
                             # If my code gets 600.
                             # Let's check magnitude.
                             # Cylinder mass ~ 600 mg.
                             # If val is 0.6 -> It is GRAMS. -> 600 mg.
                             # If val is 600 -> It is mg.
                             
                             if val < 10.0:
                                 mass_mg = val * 1000.0
                             else:
                                 mass_mg = val
                                 
                             found = True
                             break
        except Exception as e:
            print(f"Error reading {log_file}: {e}")
            
        if found:
            ve = calculate_ve(mass_mg)
            # Bias (Mock)
            b_in = 0; b_ex = 0
            results.append({
                'RPM': rpm, 'TPS_Target': tps, 
                'TrappedMass_mg': mass_mg, 'VE_Percent': ve
            })
            print(f"RPM {rpm}: {ve:.2f}% (Mass {mass_mg:.1f} mg)")

    # Sort
    results.sort(key=lambda x: x['RPM'])
    
    df = pd.DataFrame(results)
    print(df)
    df.to_csv("ve_table_recovered.csv", index=False)
    print("Saved to ve_table_recovered.csv")

if __name__ == "__main__":
    process_logs()

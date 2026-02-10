"""
Valve Overlap Scavenging Analysis for OpenWAM S54 CSL Simulation.

Analyzes INS.DAT data to detect whether valve overlap produces scavenging flow.
During overlap, both intake and exhaust valves are open. Scavenging occurs when
fresh charge flows through the cylinder (intake flow > 0 AND exhaust flow > 0).

S54 CSL Valve Timing (from wam_generator.py):
  Intake:  base_open = 360° (TDC-GE), duration = 260°
  Exhaust: base_open = 102° (ATDC-comb), duration = 260°
  IVO = 360 - intake_bias,  IVC = IVO + 260
  EVO = 102 - exhaust_bias, EVC = EVO + 260

  Overlap occurs between IVO and EVC (both valves open).

Key flow sign convention (OpenWAM):
  Positive mass flow = INTO cylinder
  Negative mass flow = OUT OF cylinder
  
Scavenging indicator: During overlap period, if intake flow > 0 (fresh charge entering)
  AND exhaust flow < 0 (gas leaving through exhaust), scavenging is occurring.
"""
import os
import sys
import json
import glob

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig

# Load ECU maps for VANOS bias lookup
with open("app/data/csl_ecu_maps.json") as f:
    ECU_MAPS = json.load(f)
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

def get_vanos_bias(rpm, tps):
    intake_raw = interpolate_2d(INTAKE_MAP["x_axis"], INTAKE_MAP["y_axis"], INTAKE_MAP["values"], rpm, tps)
    intake_bias = 130.0 - intake_raw
    exhaust_raw = interpolate_2d(EXHAUST_MAP["x_axis"], EXHAUST_MAP["y_axis"], EXHAUST_MAP["values"], rpm, tps)
    exhaust_bias = exhaust_raw - 128.0
    return intake_bias, exhaust_bias

def calculate_valve_timing(rpm, ro):
    """Calculate IVO, IVC, EVO, EVC for given operating point."""
    b_in, b_ex = get_vanos_bias(rpm, ro)
    
    # From wam_generator.py:
    ivo = 360.0 - b_in   # Intake valve open
    ivc = ivo + 260.0     # Intake valve close
    evo = 102.0 - b_ex   # Exhaust valve open
    evc = evo + 260.0     # Exhaust valve close
    
    # Overlap region
    overlap_start = ivo       # IVO (intake opens)
    overlap_end = evc         # EVC (exhaust closes)
    overlap_deg = overlap_end - overlap_start
    
    return {
        'ivo': ivo, 'ivc': ivc, 'evo': evo, 'evc': evc,
        'overlap_start': overlap_start, 'overlap_end': overlap_end,
        'overlap_deg': overlap_deg,
        'intake_bias': b_in, 'exhaust_bias': b_ex,
    }

def analyze_ins_file(filepath, rpm, ro, cyl=1):
    """Analyze overlap scavenging for a single cylinder from INS.DAT."""
    timing = calculate_valve_timing(rpm, ro)
    
    with open(filepath, 'r', errors='ignore') as f:
        header = f.readline().strip().split('\t')
        lines = f.readlines()
    
    # Column indices for cylinder (0-indexed: Cyl 1 = cols 2-10)
    base = 2 + (cyl - 1) * 9  # 9 columns per cylinder
    col_pressure = base + 0     # Pressure_Cyl_N(bar)
    col_exh_flow_total = base + 4  # Total_Exh_Mass_Flow_Cyl_N
    col_int_flow_0 = base + 5   # Mass_Flow_Int_Valve_0_Cyl_N
    col_int_flow_1 = base + 6   # Mass_Flow_Int_Valve_1_Cyl_N
    col_int_flow_total = base + 7  # Total_Int_Mass_Flow_Cyl_N
    col_mass = base + 8         # Mass_Cyl_N
    
    # S54 firing order: 1-5-3-6-2-4 (120° spacing)
    # Cylinder angle offsets from Cyl 1:
    cyl_offsets = {1: 0, 2: 480, 3: 240, 4: 600, 5: 120, 6: 360}
    cyl_offset = cyl_offsets[cyl]
    
    # Use last 2 full cycles (last ~1440° of data) for stable analysis
    n = len(lines)
    start = max(0, int(n * 0.8))
    
    overlap_samples = []
    all_samples = []
    
    for line in lines[start:]:
        parts = line.strip().split('\t')
        try:
            angle = float(parts[1])  # Global crank angle
            
            # Convert to cylinder-local angle (0-720°)
            local_angle = (angle - cyl_offset) % 720.0
            
            pressure = float(parts[col_pressure])
            exh_total = float(parts[col_exh_flow_total])
            int_0 = float(parts[col_int_flow_0])
            int_1 = float(parts[col_int_flow_1])
            int_total = float(parts[col_int_flow_total]) if parts[col_int_flow_total].strip() else int_0 + int_1
            mass = float(parts[col_mass])
            
            sample = {
                'angle': angle,
                'local_angle': local_angle,
                'pressure': pressure,
                'exh_total': exh_total,
                'int_0': int_0,
                'int_1': int_1,
                'int_total': int_total,
                'mass': mass,
            }
            all_samples.append(sample)
            
            # Check if in overlap window
            ivo = timing['ivo']
            evc = timing['evc']
            
            if ivo <= local_angle <= evc:
                overlap_samples.append(sample)
                
        except (ValueError, IndexError):
            continue
    
    return timing, overlap_samples, all_samples

def print_analysis(rpm, ro, filepath, cyl=1):
    """Print comprehensive overlap scavenging analysis."""
    timing, overlap_samples, all_samples = analyze_ins_file(filepath, rpm, ro, cyl)
    
    print(f"\n{'='*70}")
    print(f" VALVE OVERLAP SCAVENGING ANALYSIS")
    print(f" {rpm} RPM @ RO={ro}% | Cylinder {cyl}")
    print(f"{'='*70}")
    
    print(f"\n--- Valve Timing (Cyl {cyl} local angle) ---")
    print(f"  EVO = {timing['evo']:.1f}°  EVC = {timing['evc']:.1f}°")
    print(f"  IVO = {timing['ivo']:.1f}°  IVC = {timing['ivc']:.1f}°")
    print(f"  VANOS Intake Bias  = {timing['intake_bias']:.1f}°")
    print(f"  VANOS Exhaust Bias = {timing['exhaust_bias']:.1f}°")
    print(f"  Overlap Window     = {timing['overlap_start']:.1f}° → {timing['overlap_end']:.1f}°")
    print(f"  Overlap Duration   = {timing['overlap_deg']:.1f}°")
    
    if not overlap_samples:
        print(f"\n  ⚠️ No data points found in overlap window!")
        print(f"     Total samples: {len(all_samples)}")
        if all_samples:
            angles = [s['local_angle'] for s in all_samples]
            print(f"     Angle range: {min(angles):.1f}° - {max(angles):.1f}°")
        return
    
    # Analyze flow during overlap
    scav_count = 0      # Intake > 0 AND Exhaust < 0 (through-flow)
    backflow_count = 0  # Exhaust flow into intake (bad)
    neutral_count = 0
    
    int_flows = []
    exh_flows = []
    pressures = []
    
    for s in overlap_samples:
        int_flows.append(s['int_total'])
        exh_flows.append(s['exh_total'])
        pressures.append(s['pressure'])
        
        if s['int_total'] > 0.0001 and s['exh_total'] < -0.0001:
            scav_count += 1
        elif s['int_total'] < -0.0001:
            backflow_count += 1
        else:
            neutral_count += 1
    
    total = len(overlap_samples)
    
    print(f"\n--- Overlap Flow Analysis ({total} samples) ---")
    print(f"  Scavenging (Int>0, Exh<0):  {scav_count:4d} ({100*scav_count/total:.1f}%)")
    print(f"  Backflow (Int<0):           {backflow_count:4d} ({100*backflow_count/total:.1f}%)")
    print(f"  Neutral/Stagnant:           {neutral_count:4d} ({100*neutral_count/total:.1f}%)")
    
    avg_int = sum(int_flows) / len(int_flows) if int_flows else 0
    avg_exh = sum(exh_flows) / len(exh_flows) if exh_flows else 0
    avg_p   = sum(pressures) / len(pressures) if pressures else 0
    max_int = max(int_flows) if int_flows else 0
    min_exh = min(exh_flows) if exh_flows else 0
    
    print(f"\n--- Flow Statistics During Overlap ---")
    print(f"  Intake Flow:   Avg={avg_int*1000:.3f} g/s  Max={max_int*1000:.3f} g/s")
    print(f"  Exhaust Flow:  Avg={avg_exh*1000:.3f} g/s  Min={min_exh*1000:.3f} g/s")
    print(f"  Cylinder Pressure: Avg={avg_p:.4f} bar")
    
    # Scavenging efficiency estimate
    if scav_count > 0:
        scav_flows = [s['int_total'] for s in overlap_samples if s['int_total'] > 0.0001 and s['exh_total'] < -0.0001]
        scav_mass = sum(scav_flows) / len(scav_flows) if scav_flows else 0
        print(f"\n  ✅ SCAVENGING DETECTED")
        print(f"     Avg scavenging intake flow: {scav_mass*1000:.3f} g/s")
        print(f"     Coverage: {100*scav_count/total:.1f}% of overlap period")
    else:
        print(f"\n  ❌ NO SCAVENGING DETECTED")
        if backflow_count > total * 0.5:
            print(f"     Dominant backflow suggests exhaust pressure >> intake pressure")
        else:
            print(f"     Valve overlap may be insufficient or pressure differential too small")
    
    # Print angle-resolved snapshot (10 representative points)
    print(f"\n--- Angle-Resolved Flow During Overlap (every ~{max(1, len(overlap_samples)//10)}th sample) ---")
    print(f"  {'Angle°':>8} {'P(bar)':>8} {'Int(g/s)':>10} {'Exh(g/s)':>10} {'Status':>10}")
    print(f"  {'-'*48}")
    step = max(1, len(overlap_samples) // 10)
    for i in range(0, len(overlap_samples), step):
        s = overlap_samples[i]
        status = "SCAV" if s['int_total'] > 0.0001 and s['exh_total'] < -0.0001 else \
                 "BACK" if s['int_total'] < -0.0001 else "NEUT"
        print(f"  {s['local_angle']:8.1f} {s['pressure']:8.4f} {s['int_total']*1000:10.3f} {s['exh_total']*1000:10.3f} {status:>10}")


# ============================================================
# Main: Analyze key operating points
# ============================================================
if __name__ == "__main__":
    # Map of INS files with their operating points
    ins_files = [
        ("temp_seq_3_2200_7.5INS.DAT", 2200, 7.5),   # Good VE match
        ("temp_seq_7_3100_7.5INS.DAT", 3100, 7.5),    # Best VE match (+3.4%)
        ("temp_seq_11_3100_20.0INS.DAT", 3100, 20.0), # Mid load
        ("temp_seq_14_5000_100.0INS.DAT", 5000, 100.0),# WOT
        ("temp_seq_15_7000_10.0INS.DAT", 7000, 10.0), # High RPM
    ]
    
    for fname, rpm, ro in ins_files:
        if os.path.exists(fname):
            print_analysis(rpm, ro, fname, cyl=1)
        else:
            print(f"\n⚠️ File not found: {fname}")
    
    print(f"\n{'='*70}")
    print(" ANALYSIS COMPLETE")
    print(f"{'='*70}")

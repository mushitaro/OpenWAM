
import sys
import os
import re
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

def verify_vanos_logic():
    print("Verifying VANOS Logic...")
    
    # 1. Setup Config with Specific Bias
    cfg = SimConfig()
    
    # Base: Intake=350, Exhaust=130
    # Test Case: Intake Advance 10 deg (Should be 340)
    # Test Case: Exhaust Retard 10 deg (Bias = -10, Should be 130 - (-10) = 140)
    
    cfg.engine.vanos_intake_bias = 10.0 
    cfg.engine.vanos_exhaust_bias = -10.0
    
    gen = WAMGenerator(cfg, ".")
    content = gen.generate()
    
    # 2. Parse Content to find Valve Headers
    # Format: diameter num_lev incr_ang OPEN_ANGLE diameter 0.0
    # We look for lines starting with "35.0 37 5.0" (Intake) or "30.0 37 5.0" (Exhaust)
    
    # Intake Check
    # Valve Dia 35.0
    intake_match = re.search(r"35\.0 37 5\.0 ([0-9.]+) 35\.0 0\.0", content)
    if intake_match:
        val = float(intake_match.group(1))
        print(f"INTAKE Found Angle: {val} (Expected 340.0)")
        if abs(val - 340.0) < 0.1:
            print(" [PASS] Intake Logic Correct")
        else:
            print(" [FAIL] Intake Logic Incorrect")
    else:
        print(" [FAIL] Could not find Intake Valve Definition")

    # Exhaust Check
    # Valve Dia 35.0 -> No, defined as 30.0 in models.py default?
    # models.py: exhaust_valve diameter=35.0 ? No checklist said 30... 
    # Let's check models.py: Default Exhaust Valve Dia is 35.0 defined in Validation?
    # Actually models.py says: diameter: float = 35.0 # mm for ValveConfig by default?
    # But HeadConfig overrides? 
    #  intake_valve: ValveConfig = ValveConfig(max_lift=11.8, duration=260.0)
    #  So diameter uses default 35.0.
    #  exhaust_valve: ValveConfig = ValveConfig(max_lift=11.2, duration=260.0)
    #  So diameter also 35.0. 
    # Wait, check generator line 799/800:
    # self._add_valve_def(..., c.engine.head.intake_valve.diameter/1000.0)
    # So if models.py defaults to 35mm, it will be 0.035 in WAM (35.0 in WAM scale? No WAM uses SI?)
    # WAM Generator: self.wam_lines.append(f"{dia} ...") where dia is passed in.
    # passed in is c.engine.head...diameter / 1000.0 (meters)
    # So 35mm -> 0.035.
    # BUT wait, the regex above `35\.0` implies mm?
    # Let's check generator output format.
    # Line 908: self.wam_lines.append(f"{dia} {num_lev} {incr_ang} {open_angle:.2f} {dia} 0.0")
    # If dia is 0.035, then string is "0.035 ...".
    # My regex was looking for "35.0". 
    # Let's adjust regex to be robust.
    
    # Actually wait, let's check what I wrote in `wam_generator.py`.
    # Line 799: `c.engine.head.intake_valve.diameter/1000.0`
    # Line 908: variable `dia` is used.
    # So it is 0.035.
    
    # Re-writing regex for 0.035
    
    intake_match = re.search(r"0\.035 37 5\.0 ([0-9.]+) 0\.035 0\.0", content)
    if intake_match:
        val = float(intake_match.group(1))
        print(f"INTAKE Found Angle: {val} (Expected 340.00)")
        if abs(val - 340.0) < 0.1:
            print(" [PASS] Intake Logic Correct")
        else:
            print(f" [FAIL] Intake Logic Incorrect (Got {val})")
    else:
        print(" [FAIL] Could not find Intake Valve Definition")
        
    # Exhaust
    # Bias -10. Base 130. Expect 140.
    exhaust_match = re.search(r"0\.035 37 5\.0 ([0-9.]+) 0\.035 0\.0", content)
    # NOTE: Since both are 0.035, regex might match the first one twice if simple search.
    # We should find all.
    
    matches = re.finditer(r"0\.035 37 5\.0 ([0-9.]+) 0\.035 0\.0", content)
    vals = [float(m.group(1)) for m in matches]
    print(f"Found Angles: {vals}")
    
    # We expect one ~340 and one ~140.
    has_340 = any(abs(v - 340.0) < 0.1 for v in vals)
    has_140 = any(abs(v - 140.0) < 0.1 for v in vals)
    
    if has_340: print(" [PASS] Intake Angle confirmed")
    else: print(" [FAIL] Intake Angle not found")
    
    if has_140: print(" [PASS] Exhaust Angle confirmed (130 - (-10) = 140)")
    else: print(" [FAIL] Exhaust Angle not found")

if __name__ == "__main__":
    verify_vanos_logic()

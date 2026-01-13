import sys
import os
sys.path.append(r"c:\Users\kazuh\OpenWAM\CSL_Simulator\backend")
from app.simulator.wam_generator import WAMGenerator
from app.models import SimConfig

def verify_vanos():
    print("Verifying VANOS Impact on WAM Generation...")
    
    # Case 1: Bias 0
    cfg1 = SimConfig()
    cfg1.engine.vanos_intake_bias = 0.0
    gen1 = WAMGenerator(cfg1, ".")
    wam1 = gen1.generate()
    
    # Case 2: Bias 10 (Advance)
    cfg2 = SimConfig()
    cfg2.engine.vanos_intake_bias = 10.0
    gen2 = WAMGenerator(cfg2, ".")
    wam2 = gen2.generate()
    
    # Find the valve definition lines
    # We look for the intake valve timing line.
    # It should look like: "35.0 37 5.0 350.00 35.0 0.0" vs "35.0 37 5.0 340.00 35.0 0.0"
    
    def extract_intake_timing(wam_content):
        lines = wam_content.splitlines()
        for line in lines:
            # Simple heuristic: Look for 37 points and 5.0 increment
            if "37 5.0" in line: 
                # Check if it is around 350 (Intake)
                parts = line.split()
                if len(parts) >= 4:
                    angle = float(parts[3])
                    if angle > 200: # Intake is around 350, Exhaust around 130
                        return angle
        return None

    angle1 = extract_intake_timing(wam1)
    angle2 = extract_intake_timing(wam2)
    
    print(f"Bias 0.0  -> Intake Angle: {angle1}")
    print(f"Bias 10.0 -> Intake Angle: {angle2}")
    
    if angle1 is None or angle2 is None:
        print("FAIL: Could not find intake valve definition.")
    elif abs(angle1 - 350.0) < 0.1 and abs(angle2 - 340.0) < 0.1:
        print("SUCCESS: Valve timing shifted correctly (10 deg advance).")
    else:
        print("FAIL: Angles did not match expectation.")

if __name__ == "__main__":
    verify_vanos()

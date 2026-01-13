import os
import sys
import subprocess
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

def run_debug():
    rpm = 600
    rel = 85.01
    tps = rel / 100.0
    
    print(f"DEBUG: Setting up 8000 RPM, TPS {tps}")
    
    cfg = SimConfig()
    cfg.engine.rpm = 8000.0
    cfg.engine.throttle_position = float(tps)
    
    gen = WAMGenerator(cfg, ".")
    content = gen.generate()
    wam_file = "debug_8000.wam"
    with open(wam_file, "w") as f:
        f.write(content)
        
    print(f"DEBUG: WAM generated {wam_file}")
    
    # Check RPM line
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if "RPM" in line and "InitP" in line:
            print(f"DEBUG: Found RPM Line {i}: {line}")
    
    wam_bin = r"c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe"
    cmd = [wam_bin, wam_file]
    
    print(f"DEBUG: Executing {cmd}")
    # Run with Popen to stream output
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    while True:
        line = p.stdout.readline()
        if not line and p.poll() is not None:
            break
        if line:
            print(line.strip())
            
    print(f"DEBUG: Process Exited with {p.returncode}")

if __name__ == "__main__":
    run_debug()

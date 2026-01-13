
import os
import sys
import subprocess
import time
from typing import Dict, List, Optional

# Adjust path if running closely
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.abspath(os.path.join(current_dir, "../../../")))

from backend.app.simulator.wam_generator import WAMGenerator
from backend.app.models import SimConfig, EngineConfig, IntakeConfig, ExhaustLayoutType, HeadConfig, ExhaustConfig, EngineGeometry, ValveConfig, Section2Config
from backend.app.models import HeatTransferConfig, FrictionConfig, CombustionConfig, SimulationConfig, EnvironmentConfig

class OpenWAMRunner:
    def __init__(self, output_dir: str = "output"):
        self.output_dir = output_dir
        self.openwam_exe = r"c:\Users\kazuh\OpenWAM\bin\release\OpenWAM.exe"
        os.makedirs(self.output_dir, exist_ok=True)

    def run_virtual_dyno(self, rpm_start: float, rpm_end: float, duration_sec: float) -> str:
        """
        Runs a virtual dyno sweep from rpm_start to rpm_end over duration_sec.
        Returns the path to the generated WAM file.
        """
        print(f"Initializing Virtual Dyno: {rpm_start}-{rpm_end} RPM over {duration_sec}s")
        
        # 1. Configure Simulation (S54 CSL Baseline)
        conf = SimConfig(
            engine=EngineConfig(
                cylinders=6,
                rpm=rpm_start, # Initial RPM
                geometry=EngineGeometry(),
                head=HeadConfig(
                    intake_valve=ValveConfig(duration=260, max_lift=12.0, diameter=35.0),
                    exhaust_valve=ValveConfig(duration=260, max_lift=12.0, diameter=30.5)
                ),
                heat_transfer=HeatTransferConfig(),
                friction=FrictionConfig(),
                combustion=CombustionConfig()
            ),
            intake=IntakeConfig(),
            exhaust=ExhaustConfig(
                section2=Section2Config()
            ),
            simulation=SimulationConfig(
                # Calculate cycles based on average RPM?
                # Duration is in seconds. OpenWAM takes Cycles.
                # Avg RPM = (Start + End) / 2
                # Cycles = (AvgRPM / 60) * Duration
                # We'll let OpenWAM handle Time via Sensors, but we need to set DurationCycles high enough.
                # Let's estimate:
                duration_cycles=int(((rpm_start + rpm_end)/2 / 60) * duration_sec * 1.5), # *1.5 safety buffer
                step_size=0.5 
            ),
            environment=EnvironmentConfig()
        )
        
        # 2. Define Schedule
        schedule = {
            'time': [0.0, duration_sec],
            'rpm': [rpm_start, rpm_end],
            'tps': [1.0, 1.0] # WOT
        }
        
        # 3. Generate WAM
        gen = WAMGenerator(conf, self.output_dir)
        wam_content = gen.generate(schedule=schedule, simplify_exhaust=False)
        
        wam_filename = f"dyno_sweep_{int(rpm_start)}_{int(rpm_end)}.wam"
        wam_path = os.path.join(self.output_dir, wam_filename)
        
        with open(wam_path, "w") as f:
            f.write(wam_content)
        
        print(f"Generated WAM: {wam_path}")
        
        # 4. Execute
        self._execute_openwam(wam_path)
        
        return wam_path

    def _execute_openwam(self, wam_path: str):
        cmd = [self.openwam_exe, wam_path]
        print(f"Executing: {' '.join(cmd)}")
        
        start_time = time.time()
        # Run and capture output
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300) # 5 min timeout
            
            elapsed = time.time() - start_time
            print(f"Simulation completed in {elapsed:.2f}s")
            
            if result.returncode != 0:
                print("ERROR: Simulation failed.")
                print("STDOUT:", result.stdout)
                print("STDERR:", result.stderr)
            else:
                print("SUCCESS: Simulation finished.")
                print("STDOUT (Last 5 lines):", "\n".join(result.stdout.splitlines()[-5:]))
                # print("STDOUT (Last 500 chars):", result.stdout[-500:])
                
        except subprocess.TimeoutExpired:
            print("ERROR: Simulation timed out!")

if __name__ == "__main__":
    # Test Run
    runner = OpenWAMRunner(output_dir="dyno_output")
    # Run Dyno Sweep
    try:
        runner.run_virtual_dyno(2000, 8000, 2.0)
    except Exception as e:
        print(f"An error occurred during dyno sweep: {e}")

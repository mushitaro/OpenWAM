
import json
import pandas as pd
import numpy as np
import os
import math
from .mock_data_generator import MockDataGenerator
from .output_parser import OpenWAMOutputParser

class CalibrationService:
    def __init__(self, data_dir="backend/app/data", simulator_dir="CSL_Simulator"):
        self.data_dir = data_dir
        self.simulator_dir = simulator_dir
        self.mock_generator = MockDataGenerator(output_dir=simulator_dir)
        self.parser = OpenWAMOutputParser()

    def load_target_data(self):
        """Loads stock CSL VE data."""
        filepath = os.path.join(self.data_dir, "stock_csl_ve.json")
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            return pd.DataFrame(data)
        except Exception as e:
            with open("error_log.txt", "a") as log:
                log.write(f"Load Target Data Failed: {e}\n")
            raise

    def _generate_config_hash(self, config):
        """Generates a SHA256 hash of the physical configuration."""
        import hashlib
        
        # Extract physical parameters that affect VE
        # We exclude RPM, Throttle (Transient), Environment (maybe?)
        # We MUST include: Cams, Head Geometry, Valves, Intake/Exhaust lengths
        
        # Helper to traverse model
        def get_phys_dict(c):
            if isinstance(c, dict): return c
            if hasattr(c, "dict"): return c.dict()
            return str(c)
            
        # Simplified Physical Config Extraction
        # In a real scenario, we'd pick specific fields. 
        # For now, we hash the entire 'engine', 'intake', 'exhaust' structure
        # BUT excluding 'rpm', 'throttle_position', 'target_lambda'
        
        c_dict = get_phys_dict(config)
        # Deep copy to modify
        import copy
        phys = copy.deepcopy(c_dict)
        
        # Prune runtime vars
        if "engine" in phys:
            e = phys["engine"]
            if isinstance(e, dict):
                e.pop("rpm", None)
                e.pop("throttle_position", None)
                e.pop("vanos_intake_bias", None) # VANOS is tunable, but baseline calibration should be for a specific hw?
                # Actually, if we calibrate the MODEL parameters (friction etc), it should hold across VANOS changes?
                # User said: "Correction Matrix" (Ratio).
                # If we apply a ratio correction, it MIGHT be invalid if we change VANOS.
                # Usually Calibration (Reality Sync) is done at STOCK VANOS settings.
                # So if we change VANOS in Optimization, should we apply the SAME correction?
                # Ideally yes, if the error is due to "Friction" or "Heat Transfer".
                # If the error is due to "Bad Valve Model", changing valve timing might change the error.
                # For Phase 2 robustness, let's INCLUDE vanos in the hash?
                # NO. Optimization Changes VANOS. Valid calibration should persist.
                # So we EXCLUDE vanos_intake_bias from Hash.
                e.pop("vanos_exhaust_bias", None)
            else:
                 # Object mode, harder to pop. 
                 # We rely on Config being a Pydantic model often.
                 pass

        config_str = json.dumps(phys, sort_keys=True, default=str)
        return hashlib.sha256(config_str.encode('utf-8')).hexdigest()

    def save_calibration_state(self, config, correction_matrix):
        """Saves corrections with config hash."""
        state = {
            "config_hash": self._generate_config_hash(config),
            "correction_matrix": correction_matrix,
            "timestamp": pd.Timestamp.now().isoformat()
        }
        with open(os.path.join(self.data_dir, "calibration_state.json"), "w") as f:
            json.dump(state, f, indent=2)
            
    def load_calibration_state(self):
        try:
            path = os.path.join(self.data_dir, "calibration_state.json")
            if os.path.exists(path):
                with open(path, "r") as f:
                    return json.load(f)
        except:
             return None
        return None

    def log_error(self, msg):
        with open("error_log.txt", "a") as log:
            log.write(f"{msg}\n")


    def run_simulation(self, model_name="test_calib", config=None):
        """
        Runs the simulation REAL (OpenWAM).
        """
        if config is None:
             raise ValueError("Config is required for real simulation")
             
        # Generate WAM
        from .wam_generator import WAMGenerator
        import subprocess
        
        # Define paths
        wam_filename = f"{model_name}.wam"
        # Use simulator_dir (e.g., CSL_Simulator root) as working dir for sim
        wam_path = os.path.join(self.simulator_dir, wam_filename)
        
        # 1. Generate
        print(f"Generating WAM model for config: {config.intake.type}...")
        generator = WAMGenerator(config, self.simulator_dir)
        wam_content = generator.generate()
        with open(wam_path, "w") as f:
            f.write(wam_content)
            
        # 2. Execute
        # Executable Path: Use the updated binary in backend folder
        # simulator_dir = C:\Users\kazuh\OpenWAM\CSL_Simulator
        # Correct Path: C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\OpenWAM.exe
        exe_path = os.path.join(self.simulator_dir, "backend", "OpenWAM.exe")
        
        if not os.path.exists(exe_path):
             # Just in case, try absolute fallback
             exe_path = r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\OpenWAM.exe"
        
        print(f"Running OpenWAM: {exe_path} {wam_filename}")
        
        # Run in simulator_dir so outputs land there
        try:
            # Capture output to debug
             result = subprocess.run([exe_path, wam_filename], 
                                    cwd=self.simulator_dir, 
                                    capture_output=True, 
                                    text=True, 
                                    timeout=1200) # 1200s timeout (20 mins) for full simulation
                                    
             print("STDOUT:", result.stdout)
             if result.returncode != 0:
                 print("STDERR:", result.stderr)
                 raise RuntimeError(f"OpenWAM crashed with code {result.returncode}. Output:\n{result.stdout}")
                 
        except subprocess.TimeoutExpired as e:
             # Include stdout in error message for API visibility
             raise RuntimeError(f"OpenWAM timed out. Last Output:\n{e.stdout}")
        except Exception as e:
             raise RuntimeError(f"Failed to launch OpenWAM: {e}")

        # 3. Return Output
        # OpenWAM generated 'test_calibAVG.DAT' (No underscore before AVG?)
        # Let's support both or fix expectation.
        outfile = os.path.join(self.simulator_dir, f"{model_name}AVG.DAT")
        if not os.path.exists(outfile):
            # Fallback for mock/legacy
            outfile_legacy = os.path.join(self.simulator_dir, f"{model_name}_AVG.DAT")
            if os.path.exists(outfile_legacy):
                outfile = outfile_legacy
            else:
                 raise FileNotFoundError(f"Simulation output missing: {outfile}")
            
        return outfile

    async def run_simulation_async(self, config, model_name="test_calib"):
        """
        Async generator for streaming OpenWAM output.
        PERFORMS A FULL RPM SWEEP (WOT) using the parameters from Config.
        Yields lines of stdout/stderr and Progress updates.
        """
        import asyncio
        import subprocess
        import threading
        from .wam_generator import WAMGenerator
        import re
        
        # Load Map Data
        import json
        maps_file = os.path.join(self.app_dir, "data", "csl_ecu_maps.json")
        rpm_points = []
        try:
            with open(maps_file, "r") as f:
                maps = json.load(f)
                # target VE table (kf_rf_soll) for RPM breakpoints
                rpm_points = maps.get("kf_rf_soll", {}).get("x_axis", [])
        except Exception as e:
            await log(f"WARNING: Could not load maps ({e}). Using default points.")
            rpm_points = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000]

        # Ensure we have valid points
        if not rpm_points: rpm_points = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]

        # Use full RPM range from Map
        rpms = [float(r) for r in rpm_points]
        
        results_accumulated = []
        
        yield f"INFO: Starting RPM Sweep ({len(rpms)} points) using CSL Table Breakpoints...\n"
        
        # Loop
        for idx, rpm in enumerate(rpms):
            # Update Config safely
            config.engine.rpm = float(rpm)
            config.engine.throttle_position = 1.0 # WOT for Calibration Curve
            
            # VANOS Lookup Logic (Simple Nearest/Direct if compliant)
            # Assumption: Map X-Axis matches exactly. Y-Axis 100% is last index.
            # Base S54 Intake Timing: 0 bias (Retarded) = 130 deg map value?
            # Max Advance = 70 deg map value -> Bias = +60.
            try:
                # Intake
                van_in_map = maps.get("kf_evan1_soll", {})
                v_x = van_in_map.get("x_axis", [])
                v_vals = van_in_map.get("values", [])
                # Find RPM index (Nearest)
                v_idx = min(range(len(v_x)), key=lambda i: abs(v_x[i] - rpm))
                # Load Index: WOT is last (index -1)
                map_val_in = v_vals[v_idx][-1]
                
                # Convert to Bias (Assuming 130 is Base/Retarded, Lower is Advance)
                # Bias > 0 is Advance in WAM Generator logic
                bias_in = 130.0 - map_val_in
                config.engine.vanos_intake_bias = float(bias_in)
                
            except Exception as e:
                # await log(f"WARN: VANOS lookup failed: {e}")
                pass # Default 0.0

            sub_model_name = f"{model_name}_{int(rpm)}"
            wam_filename = f"{sub_model_name}.wam"
            wam_path = os.path.join(self.simulator_dir, wam_filename)
            
            # 1. Generate
            generator = WAMGenerator(config, self.simulator_dir)
            wam_content = generator.generate()
            with open(wam_path, "w") as f: f.write(wam_content)
                
            yield f"INFO: [{idx+1}/{len(rpms)}] Running {rpm} RPM...\n"
            
            # 2. Execute
            exe_path = os.path.join(self.simulator_dir, "backend", "OpenWAM.exe")
            if not os.path.exists(exe_path):
                 exe_path = r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\OpenWAM.exe"
            
            # Run Sync (to keep loop simple, but we yield logs so it feels async-ish)
            # Actually we should use asyncio to not block the main thread
            
            proc = await asyncio.create_subprocess_exec(
                exe_path, wam_filename,
                cwd=self.simulator_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            
            log_buffer = ""
            while True:
                line_b = await proc.stdout.readline()
                if not line_b: break
                line = line_b.decode('utf-8', errors='replace')
                log_buffer += line
                # yield line # Too verbose? Just yield errors or summary?
                # User wants to see progress. We yield critical lines maybe?
                if "Error" in line or "Warning" in line:
                    yield f" [WAM]: {line}"
            
            await proc.wait()
            
            if proc.returncode != 0:
                yield f"ERROR: Simulation failed at {rpm} RPM\n"
                continue # Skip or abort?
                
            # 3. Parse Instant Result for this point
            # Regex log_buffer for Trapped Mass
            # "Trapped mass: 0.616445 (g)"
            matches = re.findall(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", log_buffer)
            mass_g = 0.0
            if matches:
                 mass_g = float(matches[-1])
                 
            # Calculate VE immediately for logging
            # Need displacement per cyl (cc)
            cyl_vol_cc = (math.pi * (config.engine.geometry.bore/200.0)**2 * config.engine.geometry.stroke/100.0)
            # Rough calc: bore/2 in mm -> cm? No. 
            # Bore 87mm. Radius 4.35cm. Area = pi * 4.35^2 = 59.4 sqcm. Stroke 91mm = 9.1cm. Vol = 540cc.
            # config units are mm?
            # Geometry Config: bore (mm), stroke (mm)
            # Stage 74: shared reference-mass helper (ECU rf unit by default;
            # CSL_MREF_LEGACY=1 restores standard-air) -- keeps this dormant
            # endpoint consistent with the Run/optimizer paths.
            from . import metrics as _M
            theo_mass_mg = _M.m_ref_mg(config.engine.geometry.bore,
                                       config.engine.geometry.stroke,
                                       config.environment.ambient_pressure,
                                       config.environment.ambient_temp)
            mass_mg = mass_g * 1000.0
            ve = (mass_mg / theo_mass_mg) * 100.0 if theo_mass_mg > 0 else 0.0
            
            yield f"RESULT: {rpm} RPM -> {ve:.2f}% VE (Mass: {mass_mg:.1f}mg)\n"
            
            results_accumulated.append({
                "rpm": rpm,
                "ve_sim": ve,
                "mass_mg": mass_mg,
                "power_kw": (mass_mg * rpm * 6 / 1000.0 / 60.0) * 44000.0 * 0.35 / 1000.0 # Rough Power est
            })
            
            # Cleanup
            try:
                os.remove(wam_path)
            except: pass
            
        yield "INFO: Sweep Complete. Aggregating Results...\n"
        
        # 4. Generate Synthetic AVG.DAT for the existing parser logic?
        # Or easier: Create the DataFrame directly and save it where `calibrate` expects?
        # `calibrate` calls parser.parse_avg_dat.
        # Let's CREATE a valid .DAT file format so we don't break `calibrate` logic.
        # OpenWAM .DAT format:
        # Time(s)  RPM  ... 
        # Or actually parser looks for specific columns.
        
        # We can bypass the parser if we write a CSV or JSON that `calibrate` understands?
        # `calibrate` uses `parser.parse_avg_dat`.
        # Taking a look at `calibration_service.py`:
        # sim_full_df = self.parser.parse_avg_dat(sim_outfile)
        # sim_ve_df = self.parser.extract_ve_curve(sim_full_df)
        
        # We can write a CSV and change `calibrate` to read CSV if DAT missing?
        # Or just overwrite `calibrate` logic later.
        # Ideally, `run_simulation_async` should handle the execution.
        # `calibrate` handles the comparison.
        
        # Let's save a custom JSON "sim_results.json" and have `calibrate` read it.
        out_json_path = os.path.join(self.simulator_dir, f"{model_name}_results.json")
        with open(out_json_path, "w") as f:
            json.dump(results_accumulated, f)
            
        yield f"INFO: Results saved to {out_json_path}\n"


    async def calibrate(self, config=None, binary_service=None, log_callback=None):
        """
        Performs the calibration routine (Reality Sync).
        Now Async to support Log Streaming.
        """
        try:
            # Helper to log
            async def log(msg):
                if log_callback:
                    await log_callback(msg)
                # Also write to file for persistence
                self.log_error(msg)
            
            await log("INFO: Starting Calibration Routine...")

            # 1. Load Target Data
            target_df = None
            target_matrix = []
            csl_rpm_axis = []
            csl_load_axis = []
            
            bin_path = os.path.join(self.data_dir, "uploaded_mss54.bin")
            
            # Try reading from Binary if Service and File exist
            if binary_service and os.path.exists(bin_path):
                try:
                    # Use BinaryService to read Sim Target
                    if binary_service.ADDR_VE_MAP != 0x0000:
                        await log("INFO: Reading VE from Binary (CSL 24x20)...")
                        bin_data = binary_service.read_binary(bin_path)
                        
                        # Read 24x20 VE Map (KF_RF_SOLL)
                        ve_matrix = binary_service.read_table_generic(
                            bin_data, 
                            binary_service.ADDR_VE_MAP, 
                            rows=24, 
                            cols=20, 
                            factor=binary_service.VE_FACTOR
                        )
                        
                        # Read Axes
                        csl_rpm_axis = binary_service.read_axis(bin_data, binary_service.ADDR_VE_AXIS_RPM, 20)
                        csl_load_axis = binary_service.read_axis(bin_data, binary_service.ADDR_VE_AXIS_LOAD, 24)
                        
                        if len(csl_rpm_axis) == 20 and len(ve_matrix) == 24:
                            ve_wot = ve_matrix[-1] # Last Row = Max Load
                            
                            target_df = pd.DataFrame({
                                'rpm': csl_rpm_axis,
                                've': ve_wot
                            })
                            target_matrix = ve_matrix
                            await log("INFO: Successfully loaded Target VE from Binary!")
                        else:
                            await log(f"ERROR: Dimension mismatch: RPM={len(csl_rpm_axis)}, Rows={len(ve_matrix)}")

                except Exception as e:
                    await log(f"ERROR: Binary read failed: {e}")

            # Fallback to JSON (Digitized Stock Data)
            if target_df is None:
                await log("INFO: Loading Stock CSL Data (Fallback)...")
                target_df = self.load_target_data()
                csl_rpm_axis = target_df['rpm'].tolist()
                csl_load_axis = [i * (100/23) for i in range(24)] 
            
            # 2. Run Sim (Streaming)
            await log("INFO: Launching Flow Simulation...")
            model_name = "test_calib"
            
            # Consume the generator
            async for line in self.run_simulation_async(config, model_name=model_name):
                clean_line = line.rstrip()
                if clean_line:
                    await log(clean_line)
            
            # Check for JSON results first (New Path)
            json_outfile = os.path.join(self.simulator_dir, f"{model_name}_results.json")
            sim_ve_df = None
            
            if os.path.exists(json_outfile):
                await log("INFO: Loading Aggregated Sweep Results...")
                with open(json_outfile, "r") as f:
                    results_data = json.load(f)
                
                # Convert to DataFrame
                # Expected Cols: rpm, ve, etc.
                sim_ve_df = pd.DataFrame(results_data)
                # Rename columns to match parser expectation if needed?
                # Parser output usually has 'RPM' and 'VE_...'
                # Let's standardize on 'rpm' and 've' (lowercase)
                if 've_sim' in sim_ve_df.columns:
                    sim_ve_df = sim_ve_df.rename(columns={'ve_sim': 've'})
                
            else:
                # Fallback to Old DAT Parser
                sim_outfile = os.path.join(self.simulator_dir, f"{model_name}AVG.DAT")
                if not os.path.exists(sim_outfile):
                     legacy = os.path.join(self.simulator_dir, f"{model_name}_AVG.DAT")
                     if os.path.exists(legacy):
                         sim_outfile = legacy
                     else:
                        raise FileNotFoundError(f"Simulation output missing: {sim_outfile}")
                
                await log("INFO: Parsing .DAT Results (Legacy Mode)...")
                sim_full_df = self.parser.parse_avg_dat(sim_outfile)
                sim_ve_df = self.parser.extract_ve_curve(sim_full_df)
            
            # 4. Compare & Construct Sim Matrix
            # Ensure column names
            cols = sim_ve_df.columns
            sim_rpm_col = [c for c in cols if 'rpm' in c.lower()][0]
            sim_ve_col = [c for c in cols if 've' in c.lower()][0]
            sim_ve_df = sim_ve_df.sort_values(by=sim_rpm_col)
            
            interp_ve_curve = np.interp(
                target_df['rpm'], 
                sim_ve_df[sim_rpm_col], 
                sim_ve_df[sim_ve_col]
            )
            
            sim_matrix = []
            if not target_matrix:
                target_matrix = []
                for r in range(24):
                    load_factor = (r + 1) / 24.0
                    row_data = []
                    for c in range(20):
                         val = target_df['ve'].iloc[c] * load_factor
                         row_data.append(val)
                    target_matrix.append(row_data)

            # Generate Sim Matrix
            for r in range(24):
                row_data = []
                for c in range(20):
                     t_val = target_matrix[r][c]
                     sim_wot = interp_ve_curve[c]
                     target_wot = target_matrix[-1][c] if target_matrix[-1][c] != 0 else 1.0
                     ratio = sim_wot / target_wot
                     s_val = t_val * ratio
                     row_data.append(s_val)
                sim_matrix.append(row_data)

            # Correction Matrix
            correction_matrix = []
            for r in range(24):
                row_c = []
                for c in range(20):
                    t_val = target_matrix[r][c]
                    s_val = sim_matrix[r][c]
                    if s_val == 0: s_val = 0.001
                    row_c.append(s_val / (t_val if t_val != 0 else 0.001))
                correction_matrix.append(row_c)

            results_df = target_df.copy()
            results_df['sim_ve'] = interp_ve_curve
            
            result_dict = {
                "curve": results_df.to_dict(orient='records'),
                "matrix": {
                    "rpm": csl_rpm_axis,
                    "load": csl_load_axis,
                    "target": target_matrix,
                    "sim": sim_matrix,
                    "correction": correction_matrix
                }
            }
            
            # Save State
            self.save_calibration_state(config, correction_matrix)
            await log(f"INFO: Calibration Sync Saved (Hash: {self._generate_config_hash(config)[:8]}...)")
            
            await log("INFO: Calibration Logic Complete.")
            return result_dict

        except Exception as e:
            import traceback
            err_msg = f"Calibrate Exception: {e}\n{traceback.format_exc()}"
            self.log_error(err_msg)
            # Try to log to callback if possible
            if log_callback:
                try:
                    await log_callback(f"ERROR: {e}")
                except:
                    pass
            raise


if __name__ == "__main__":
    # Test run
    service = CalibrationService(data_dir=r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\app\data")
    results = service.calibrate()
    print("Calibration Results:")
    print(results)

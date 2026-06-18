import os
import asyncio
import math
import re
import json

class SimulationService:
    def __init__(self, data_dir, simulator_dir):
        self.data_dir = data_dir
        self.simulator_dir = simulator_dir
        
    async def run_ve_map_generation(self, config, model_name="ve_map_sim"):
        """
        Runs a Full VE Map Simulation (20 RPMs x 24 Loads = 480 Points).
        Uses RPM and Load breakpoints from CSL Binary (kf_rf_soll).
        Uses VANOS lookup from CSL Binary (kf_evan1_soll).
        Parallelized execution.
        """
        from .wam_generator import WAMGenerator
        
        # 1. Load CSL Maps
        maps_file = os.path.join(self.data_dir, "csl_ecu_maps.json")
        rpm_axis = []
        load_axis = [] # TPS %
        maps = {}
        
        try:
            with open(maps_file, "r") as f:
                maps = json.load(f)
                # Use VE Target Table (kf_rf_soll)
                rpm_axis = maps.get("kf_rf_soll", {}).get("x_axis", [])
                load_axis = maps.get("kf_rf_soll", {}).get("y_axis", [])
        except Exception as e:
            print(f"WARN: Could not load maps: {e}")
            
        if not rpm_axis: rpm_axis = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
        if not load_axis: load_axis = [100.0]

        rpms = [float(r) for r in rpm_axis]
        loads = [float(l) for l in load_axis]
        
        results = []
        full_logs = ""
        
        # Semaphore for concurrency
        sem = asyncio.Semaphore(12) # Limit to 12 parallel Sims
        
        async def run_point(rpm, load_tps):
            async with sem:
                # Local Config Copy (Not deep copy needed if we just set attrs, but safer to copy if mutable)
                # Since Pydantic models are mutable, we should be careful. 
                # But here we generate WAM immediately. WAMGenerator takes config in init.
                # We need to set the values on the config passed to WAMGenerator.
                # To avoid race conditions on the specific 'config' object if reused, we must copy it.
                point_config = config.model_copy(deep=True)
                point_config.engine.rpm = float(rpm)
                point_config.engine.throttle_position = float(load_tps / 100.0)
                
                # VANOS Lookup (Intake)
                try:
                     van_in_map = maps.get("kf_evan1_soll", {})
                     v_x = van_in_map.get("x_axis", [])
                     v_vals = van_in_map.get("values", [])
                     
                     if v_x:
                         # Nearest RPM
                         v_idx = min(range(len(v_x)), key=lambda i: abs(v_x[i] - rpm))
                         # Nearest Load (Row index in map usually?)
                         # Map structure: values[rpm_index][load_index] ? 
                         # Check JSON: values is array of arrays. 
                         # Usually values[ROW][COL] where Row=Y-Axis, Col=X-Axis ??
                         # kf_evan1_soll: x_axis (RPM) len 16. y_axis (Load) len 16.
                         # values len 16 (Rows). Each row len 16 (Cols).
                         # Standard convention: values[y_index][x_index] (Row=Y, Col=X).
                         # Let's verify JSON snippet structure earlier...
                         # Line 43: "values": [ [130, 130...], [130...]]
                         # There are 16 rows. Y-Axis has 16 items. X-Axis has 16 items.
                         # So values[y_idx][x_idx].
                         
                         v_y = van_in_map.get("y_axis", [])
                         if v_y:
                             v_y_idx = min(range(len(v_y)), key=lambda i: abs(v_y[i] - load_tps))
                             
                             # Lookup: values[v_y_idx][v_idx]
                             val = v_vals[v_y_idx][v_idx]
                             
                             # Bias Calc (Base 130 - Val)
                             bias = 130.0 - val
                             point_config.engine.vanos_intake_bias = float(bias)

                     # EXHAUST VANOS -- coordinate the exhaust cam too. Setting ONLY the
                     # intake advance (and leaving the exhaust at base) leaves an
                     # excessive, mis-phased valve overlap that over-scavenges and
                     # over-rams VE (the Stage-44/45 "VANOS over-response", which is NOT
                     # the bistable intake resonance it first looked like -- Stage 47).
                     # Advancing the exhaust in step pulls EVC back, cuts the overlap and
                     # brings VE smoothly down to stock. The base/scale below is a FIRST
                     # calibration and needs tuning against kf_rf_soll across the map
                     # (OPENWAM_EXVANOS_BASE / _SCALE for studies).
                     av_map = maps.get("kf_avan1_soll", {})
                     a_x, a_y, a_vals = av_map.get("x_axis", []), av_map.get("y_axis", []), av_map.get("values", [])
                     if a_x and a_y and a_vals:
                         import os as _os
                         ax_i = min(range(len(a_x)), key=lambda i: abs(a_x[i] - rpm))
                         ay_i = min(range(len(a_y)), key=lambda i: abs(a_y[i] - load_tps))
                         aval = a_vals[ay_i][ax_i]
                         ex_base = float(_os.environ.get("OPENWAM_EXVANOS_BASE", "150.0"))
                         ex_scale = float(_os.environ.get("OPENWAM_EXVANOS_SCALE", "1.0"))
                         point_config.engine.vanos_exhaust_bias = float((ex_base - aval) * ex_scale)
                except:
                    pass

                # Generate
                sub_name = f"{model_name}_{int(rpm)}_{int(load_tps)}"
                wam_filename = f"{sub_name}.wam"
                wam_path = os.path.join(self.simulator_dir, wam_filename)
                
                gen = WAMGenerator(point_config, self.simulator_dir)
                content = gen.generate()
                with open(wam_path, "w") as f: f.write(content)
                
                # Execute
                exe_path = os.path.join(self.simulator_dir, "backend", "OpenWAM.exe")
                if not os.path.exists(exe_path): exe_path = r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\OpenWAM.exe"

                # Default the compressible/choked-orifice throttle BC on the CSL
                # production path (Stage 49/50). The C++ default stays OFF (the BC is
                # shared by all decks and reads getenv at runtime); we opt-in here so
                # the VE map uses the validated compressible metering without changing
                # global solver behaviour. Inherit the rest of the environment.
                sim_env = {**os.environ, "OPENWAM_THR_CHOKE": "1"}
                proc = await asyncio.create_subprocess_exec(
                    exe_path, wam_filename,
                    cwd=self.simulator_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=sim_env
                )
                
                stdout, _ = await proc.communicate()
                output = stdout.decode('utf-8', errors='replace')
                
                # Parse
                mass_g = 0.0
                re_mass = re.findall(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", output)
                if re_mass: mass_g = float(re_mass[-1])
                
                # Calc VE
                bore_cm = point_config.engine.geometry.bore / 10.0
                stroke_cm = point_config.engine.geometry.stroke / 10.0
                cyl_vol_cc = math.pi * ((bore_cm/2.0)**2) * stroke_cm
                
                p_pa = point_config.environment.ambient_pressure
                t_k = point_config.environment.ambient_temp
                rho = p_pa / (287.058 * t_k)
                theo_mass_mg = cyl_vol_cc * rho
                mass_mg = mass_g * 1000.0
                
                ve = (mass_mg / theo_mass_mg) * 100.0 if theo_mass_mg > 0 else 0.0
                
                # Cleanup
                try: os.remove(wam_path)
                except: pass
                
                return {
                    "rpm": rpm,
                    "tps": load_tps,
                    "ve_sim": ve,
                    "mass_mg": mass_mg,
                    "power_kw": (mass_mg * rpm / 10000.0) * 1.5 
                }

        # Create Tasks
        tasks = []
        for r in rpms:
            for l in loads:
                tasks.append(run_point(r, l))
                
        # Run
        results_list = await asyncio.gather(*tasks)
        
        # Sort results (by TPS then RPM for easier matrix view)
        results = sorted(results_list, key=lambda x: (x['tps'], x['rpm']))
        
        return {
            "results": results, 
            "logs": f"Simulated {len(results)} points (20x24 Grid).",
            "status": "success"
        }

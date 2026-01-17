
import os
import math
import numpy as np
from ..models import SimConfig, ExhaustLayoutType

from dataclasses import dataclass, field
from typing import List, Dict, Optional

@dataclass
class SweepSchedule:
    duration: float
    time_points: List[float]
    rpm_points: List[float]
    intake_bias_points: List[float]
    exhaust_bias_points: List[float]

class WAMGenerator:
    def __init__(self, config: SimConfig, output_dir: str):
        self.config = config
        self.output_dir = output_dir
        self.wam_lines = []
        
        # Dynamic ID Managers
        self.pipe_counter = 1
        self.plenum_counter = 1
        self.valve_counter = 1
        self.connection_counter = 0
        
        # Buffer Lists
        self.wam_lines_pipes = []
        self.wam_lines_plenums = []
        self.wam_lines_valves = [] 
        self.wam_lines_cons = []
        
        # ID Registries to track topology
        self.ids = {
            "plenum_intake": None,
            "runners": [], # List of pipe IDs
            "itbs": [], # List of Throttle IDs (if objects) or Pipe IDs
            "cylinders": [], # standard 1-6
            "headers": [],
            "exhaust_nodes": {} # section names to pipe IDs
        }
        
        # Throttle Valve Tracking
        self.throttle_valves = [] # List of {'vid': int, 'cd': float}
        self.valves_intake = []
        self.valves_exhaust = []
        
        # Pipe Buffer for deferred topology resolution
        # Dict[pid, Dict]
        self.pipes = {}
        self.plenum_ids = set() # Track Plenum IDs for robust connectivity
        
        # CONSTANTS
        self.species_number = 10
        self.there_is_egr = 0
        # 10 Species: O2, N2, CO2, H2O, CO, H2, CH2O, C14H28, soot, Extra
        # Air: O2=0.233, N2=0.767
        # 10 Species: O2, N2, CO2, H2O, CO, H2, CH2O, C14H28, soot, Extra
        # Air: O2=0.233, N2=0.767
        # 10 Species: O2, N2, CO2, H2O, CO, H2, CH2O, C14H28, soot, Extra
        # Air: O2=0.233, N2=0.767, Rest=0.0
        # self.species_names order: O2, N2, CO2, H2O, CO, H2, HC, NO, PM, Soot
        # We need 10 values.
        # self.species_names order: O2, N2, CO2, H2O, CO, H2, HC, NO, PM, Soot
        # We need 10 values in the list, but if NoEGR, OpenWAM expects 11 values in composition lines?
        # Actually, if n_species=11, we MUST provide 11 fractions.
        self.species_names = ["O2", "N2", "CO2", "H2O", "CO", "H2", "HC", "NO", "PM", "Soot"]
        # FIXED: Removed 11th value (0.0). NoEGR mode reads (SpeciesNumber - 1) = 10 values.
        self.air_comp = "0.233 0.767 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0"
        self.air_comp_flag = 1
        self.there_is_egr = 0
        self.egr = self.there_is_egr
        
        # DEBUG KEYS
        print(f"DEBUG: Init Complete. Keys: {list(self.ids.keys())}")

    def _add(self, val, comment=""):
        # DEBUG: Suppress comments to isolate parsing issues
        self.wam_lines.append(f"{val}")

    def _add_pressure_loss(self, cid, type_loss, K_factor):
        # Type 9 (Linear) or 10 (Quadratic)
        # K_factor is the loss coefficient
        self.wam_lines_cons.append(f"{type_loss}")
        # Data: No extra data for simple K? 
        # Check TCCPerdidadePresion::ReadBoundaryData -> fscanf(fich, "%lf ", &FK);
        # So yes, just K.
        self.wam_lines_cons.append(f"{K_factor}")
        self.connection_counter += 1

    def _get_dynamic_cd(self, lift_mm, valve_dia_mm, is_intake=True):
        # F1-Grade Dynamic Discharge Coefficient
        if lift_mm <= 0.05: return 0.0
        ld_ratio = lift_mm / valve_dia_mm
        
        # Base Curve
        if ld_ratio < 0.1: base_cd = 0.4 * (ld_ratio / 0.1)
        elif ld_ratio < 0.25: base_cd = 0.4 + (0.25 * ((ld_ratio-0.1)/0.15))
        else: base_cd = 0.65 - 0.03 * min(1.0, (ld_ratio - 0.25)/0.2)
        
        # Apply head flow scalar
        return base_cd * self.config.engine.head.port_flow_coeff

    def generate_valve_curve(self, duration: float, lift: float, filename: str, dia: float):
        path = os.path.join(self.output_dir, filename)
        is_intake = "intake" in filename
        points = []
        half_dur = duration / 2.0
        
        with open(path, "w") as f:
            f.write(f"361\n") # 1 degree steps
            for ang in np.arange(-360, 361, 2.0):
                current_lift = 0.0
                if abs(ang) < half_dur:
                    rad = (ang / half_dur) * (math.pi / 2.0)
                    current_lift = lift * math.cos(rad)
                    if current_lift < 0: current_lift = 0
                
                cd = self._get_dynamic_cd(current_lift, dia, is_intake)
                f.write(f"{ang:.2f} {current_lift:.4f} {cd:.4f}\n")

    def generate_sensors(self):
        # Generate TSensor Block
        # We need at least one sensor for Time (Execution Time)
        self.wam_lines.append("1") # Num Sensors
        # Type 0 (Execution) Param 0 (Time)
        # CRITICAL: Do NOT output Delay/Gain for Time Sensor (Type 0, Param 0)
        self.wam_lines.append("0 0")
        

    def _generate_controllers(self, schedule: Optional[SweepSchedule]):
        if not schedule:
             self.wam_lines.append("0")
             return

        # 4 Controllers Total: 1(RPM), 2(Intake), 3(Exhaust), 4(LiftFix)
        self.wam_lines.append("4")
        
        def add_function_controller(cid, time_arr, val_arr):
            # Output Type 2 (Table1D)
            # Format: Type(2) FromFile(0) NumPoints X Y ... Period(0) Interp(0) SensorID(1)
            self.wam_lines.append("2") 
            self.wam_lines.append("0") # fromfile=0
            
            n = len(time_arr)
            self.wam_lines.append(f"{n}")
            for t, v in zip(time_arr, val_arr):
                self.wam_lines.append(f"{t:.4f} {v:.4f}")
            
            self.wam_lines.append("0") # Period=0
            self.wam_lines.append("0") # Interp=Linear
            self.wam_lines.append("1") # SensorID=1 (Time)
        
        # 1. RPM Controller (ID 1)
        add_function_controller(1, schedule.time_points, schedule.rpm_points)
        
        # 2. Intake Phase (ID 2)
        # OpenWAM: Angle = Angle0 + Gap.
        # Our Logic: Angle = Base - Bias.
        # So Gap = -Bias.
        neg_intake = [-x for x in schedule.intake_bias_points]
        add_function_controller(2, schedule.time_points, neg_intake)
        
        # 3. Exhaust Phase (ID 3)
        neg_exhaust = [-x for x in schedule.exhaust_bias_points]
        add_function_controller(3, schedule.time_points, neg_exhaust)
        
        # 4. Lift Fix (ID 4) - Constant 1.0
        # Just 2 points spanning duration
        dur = schedule.duration if schedule.duration > 0 else 10.0
        add_function_controller(4, [0.0, dur], [1.0, 1.0])

    def _generate_output_block(self):
        print("DEBUG: Generating OUTPUT Block")
        # OUTPUT BLOCK STRUCTURE (TOutputResults compatibility)
        # 1. Output Mode: 
        # 2 = All Cycles Concatenated (Single file)
        self.wam_lines.append("2")
        
        # 2. Average Results
        self.wam_lines.append("0") # Cylinders
        
        # Engine (ENABLE for simplified Dyno Data)
        # 1 means Enabled. Then it reads Params.
        self.wam_lines.append("0") 
        # TBloqueMotor::ReadAverageResultsBloqueMotor
        # Count = 5 vars
        # IDs: 17=RPM, 0=Torque(Net), 12=Power, 18=VE, 24=AFR
        # self.wam_lines.append("5 17 0 12 18 24")
        
        self.wam_lines.append("0") # Plenums
        self.wam_lines.append("0 0") # Pipes + param (wamer)
        self.wam_lines.append("0") # Axis
        self.wam_lines.append("0") # Compressors
        self.wam_lines.append("0") # Turbines
        self.wam_lines.append("0") # Valves
        self.wam_lines.append("0") # Roots
        self.wam_lines.append("0") # Venturis
        self.wam_lines.append("0") # Connections
        # DPF is skipped (ifdef)
        self.wam_lines.append("0") # Sensors
        self.wam_lines.append("0") # Controllers
        
        # 3. Instantaneous Results
        self.wam_lines.append("0") # Cylinders
        self.wam_lines.append("0") # Plenums
        self.wam_lines.append("0 0") # Pipes
        self.wam_lines.append("0") # Venturis
        self.wam_lines.append("0") # Valves
        self.wam_lines.append("0") # Turbochargers
        self.wam_lines.append("0") # Compressors
        self.wam_lines.append("0") # Turbines
        self.wam_lines.append("0") # Roots
        self.wam_lines.append("0") # Connections
        self.wam_lines.append("0") # WasteGates
        self.wam_lines.append("0") # ReedValves
        # self.wam_lines.append("0") # DPF Inst REMOVED
        self.wam_lines.append("0") # Sensors
        self.wam_lines.append("0") # Controllers
        
        # 4. SpaceTime Results
        self.wam_lines.append("0")

        
    def _generate_engine_block(self, schedule: Optional[SweepSchedule]):
        # Matches TBloqueMotor::LeeMotor Order (OpenWAM v2.2)
        c = self.config
        
        # 1. ACT Usage (0=No, 1=Yes)
        self._add("0", "ACT=No")
        
        # 2. Cylinders
        self._add(f"{c.engine.cylinders}", "Num Cylinders")
        
        # 3. Initial Conditions
        # WARNING: OpenWAM Engine Initialization likely expects Bar for Pressure!
        p_init = 1.01325 
        m_init = 0.0006
        self._add(f"{c.engine.rpm} {p_init} {m_init}", "Initial: RPM Press Mass")
        
        # ImponerComposicionAE (0=False)
        self._add("0", "Impose Comp AE=0")
        
        # FComposicionInicial (Loop N-1)
        # Split air_comp, take N-1
        ac_list = self.air_comp.strip().split()
        to_write = len(ac_list) - 1
        self._add(" ".join(ac_list[:to_write]), "Initial Composition")
        
        # TipoPresionAAE (0=Calc)
        self._add("0", "Calc AAE Pressure")
        
        # 4. Combustion Type (1=MEP)
        self._add("1", "Combustion=MEP")
        
        # 5. Fuel / Dosado
        self._add("1.0", "Dosado")
        
        # 6. Efficiency & Fuel Props
        self._add("0.98 44000000 750", "Eff LHV Rho")
        
        # 7. Ref Pipe
        self._add("1", "Ref Pipe")
        
        # 8. Thermal Params
        self._add("##VE_PIPE_ID## 450 400", "Temps")
        
        # Areas
        bore = c.engine.geometry.bore / 1000.0
        area = math.pi * (bore/2.0)**2
        self._add(f"{area:.6f} {area*1.1:.6f}", "Areas")
        
        # Wall Props
        self._add("0.01 150 2700 900", "Wall Piston")
        self._add("0.01 150 2700 900", "Wall Head")
        self._add("0.005 50 7800 500", "Wall Cyl")
        
        # Adjustments
        self._add("1.0 1.0 1000.0 350.0", "Heat Transfer Adj")
        # Wall Temp Calc
        self._add("2", "Wall Temp Calc")
        
        # 9. Woschni
        self._add("2.28 0.00324 0.0", "Woschni Params")
        
        # 10. Geometry
        rod = c.engine.geometry.rod_length / 1000.0
        stroke = c.engine.geometry.stroke / 1000.0
        cr = c.engine.geometry.compression_ratio
        geom_line = f"{rod:.4f} {stroke:.4f} {bore:.4f} {cr:.2f} 0.0 0.0 0.0 0.0001 0.8 0.0 0.0 0.0 0.5 0.4 2.1e11 0.0"
        self._add(geom_line, "Geometry")
        
        # 11. Mechanical Losses
        self._add("0.1 0.0 0.0 0.0", "Mech Losses")
        
        # 13. Injection / Heat Release
        self._add("1", "Num Heat Laws")
        self._add("1.0 1.0 2000.0", "Heat Law logic")
        self._add("1", "Num Wiebes")
        self._add("2.0 6.9 0.0 60.0 -15.0", "Wiebe Params")
        
        # 14. Injections Logic
        self._add("0", "Injection Data Type")
        
        # 15. Desfase
        if c.engine.cylinders > 1:
            self._add("1", "Firing Order Type")
            self._add("1 5 3 6 2 4", "Firing Order")
            
        # 16. Controllers (Engine Speed)
        if schedule:
            self._add(1, "Num Engine Controllers")
            self._add("0 1", "RPM Control (Type 0) using Controller ID 1")
        else:
            self._add(0, "Num Engine Controllers")
            
        # 17. Mass Fuel Controller Loop
        # For each cylinder: NumControllers(int).
        # We output 0.
        for i in range(c.engine.cylinders):
            self._add("0", f"FuelMassCtrl Cyl {i+1}")

    def generate(self, schedule: Optional[SweepSchedule] = None):
        simplify_exhaust = False
        c = self.config
        
        # 1. Generate Valve Files (using explicit Engine Config)
        self.generate_valve_curve(c.engine.head.intake_valve.duration, c.engine.head.intake_valve.max_lift, "intake.vlv", c.engine.head.intake_valve.diameter)
        self.generate_valve_curve(c.engine.head.exhaust_valve.duration, c.engine.head.exhaust_valve.max_lift, "exhaust.vlv", c.engine.head.exhaust_valve.diameter)

        # 2. Header
        # Fixed Version to 2200 (Binary Expectation)
        self._add("2200", "OpenWAM Version") 
        self._add(0, "Independent Simulation")
        # FORCE 1.0 deg Step Size for stability
        self._add(f"0.5 {c.simulation.duration_cycles}", "dTheta Duration") 
        # OpenWAM expects BAR for P_amb
        p_amb_bar = c.environment.ambient_pressure / 100000.0
        self._add(f"{p_amb_bar:.5f} {c.environment.ambient_temp}", "P_amb T_amb")
        
        # General Data
        self._add("1 2", "Species=Complete, Gamma=Comp+Temp")
        
        # 1. Engine Exists (hayBQ)
        self._add("1", "Engine Exists")
        
        # 2. Cycle Mode (If EngineExists) (4T, Mode, EGR)
        # Mode: 0=Steady, 1=TransientLoad, 2=TransientRPM
        if schedule:
             # Transient Mode is currently unstable (Supersonic).
             # Falling back to Steady State. Runner must manage Quasi-Steady sweep.
             self._add("0 0 0", "Cycle Mode (Steady)")
        else:
             self._add("0 0 0", "Cycle Mode (Steady)") 
        
        # 3. Fuel (haycombustible, tipocombustible)
        # 1 1 = Yes Fuel, Gasoline
        self._add("1 1", "Fuel=Yes Type=Gasoline")
        
        # 4. Species Number
        n_species = len(self.species_names)
        if self.egr == 0: n_species += 1 # OpenWAM logic: n_species_to_read = SpeciesNumber - IntEGR
        self._add(f"{n_species}", "Num Species")
        
        # 5. Species Names (Consumed by OpenWAM)
        for s in self.species_names:
            print(f"DEBUG: Adding Species: {s}")
            self.wam_lines.append(s)
        
        # 6. Atmospheric Composition Data
        self.wam_lines.append(f"{self.air_comp_flag}")
        self._add(self.air_comp, "Initial Cyl Composition") # Note: This is read as CompAtmosfera loop
        
        # NOTE: Inertia (CyclesWithoutThemalInertia) and Interval (IntCA/IntStep)
        # Are NOT Read in Steady State Mode (0).
        # And IntStep seems missing from code entirely?
        # So we skip them.

        
        # --- ENGINE BLOCK ---
        
        # --- ENGINE BLOCK ---
        self._generate_engine_block(schedule)

        # --- RESET STATE (For reuse) ---
        self.pipe_counter = 1
        self.plenum_counter = 1
        self.valve_counter = 1
        self.connection_counter = 0
        self.wam_lines_pipes = []
        self.wam_lines_plenums = []
        self.wam_lines_cons = []
        self.pipes = {}
        self.plenum_ids = set()
        self.valves_intake = []
        self.valves_exhaust = []
        self.throttle_valves = []
        
        # Reset IDs with CORRECT KEYS
        self.ids = {
            "plenum_intake": None,
            "runners": [],
            "itbs": [],
            "cylinders": [],
            "headers": [],
            "exhaust_nodes": {}
        }
        
        # --- TOPOLOGY ---
        print(f"DEBUG: Checkpoint 2 - Topology Start")
        # Verify Headers
        if c.engine.cylinders == 6:
            # Assume S54 Split Header (3-into-1 x2)
            self._generate_intake(c)
            # Fallback to full exhaust if split logic missing
            self._generate_full_exhaust(c) 
        else:
            self._generate_intake(c) # Assume Intake is standard
            self._generate_full_exhaust(c)
            
        # --- FOOTER ---
        self._generate_footer(c, schedule)
        
        if 'plenum_intake' not in self.ids: self.ids['plenum_intake'] = None
        
        # --- RESOLVE PLACEHOLDERS ---
        # Resolve ##VE_PIPE_ID##
        # Use first runner pipe. If unavailable, use intake plenum pipe (if exists).
        ve_pipe = 1
        if self.ids['runners'] and len(self.ids['runners']) > 0:
            ve_pipe = self.ids['runners'][0]
        elif self.ids['plenum_intake']:
            ve_pipe = self.ids['plenum_intake'] # Use plenum index? No, must be pipe? 
            # wam_generator does not treat plenums as pipes unless it's a pipe-plenum?
            # Actually runners are pipes.
            pass
            
        final_wam = "\n".join(self.wam_lines)
        if "##VE_PIPE_ID##" in final_wam:
             print(f"DEBUG: Resolving ##VE_PIPE_ID## to {ve_pipe}")
             final_wam = final_wam.replace("##VE_PIPE_ID##", str(ve_pipe))
             
        print(f"DEBUG: generate() returning. Lines: {len(self.wam_lines)}")
        return final_wam

    def _generate_intake(self, c):
        print(f"DEBUG: Generate Intake. Keys: {list(self.ids.keys())}")
        if 'itbs' not in self.ids: 
            print("WARNING: 'itbs' key missing. Re-initializing.")
            self.ids['itbs'] = []
        if 'plenum_intake' not in self.ids: self.ids['plenum_intake'] = None
        # 1. Ambient Plenum
        amb_in_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(amb_in_id, "Ambient_Intake", 1000.0, 300, ptype=0) # Type 0 = Constant Volume
        
        # 2. Filter Element Pipe (Air Filter)
        filter_pipe_id = self.pipe_counter; self.pipe_counter += 1
        
        # Connect Ambient to Filter Pipe Start
        cid_amb = self.connection_counter 
        self._add_con_plenum_pipe_v2(amb_in_id, filter_pipe_id, 0)
        
        # Create Pressure Loss Node (Air Filter Loss)
        cid_filter = self.connection_counter
        self._add_pressure_loss(cid_filter, 10, 5.0) # Type 10 (Quad), K=5.0
        
        # Adjusted to 0.15m for stability/speed (50mm mesh x 3 nodes)
        self._add_pipe(filter_pipe_id, "Air_Filter_Elem", 0.15, 0.15, 0.15, 300, cid_amb, cid_filter)
        
        # 3. Intake Duct
        duct_id = self.pipe_counter; self.pipe_counter += 1
        node_duct_start = cid_filter # Connect to Filter Output
        
        # Plenum
        plenum_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(plenum_id, "Plenum_Main", c.intake.plenum_vol/1000.0, 313)
        self.ids['plenum_intake'] = plenum_id
        
        cid_plenum_in = self.connection_counter
        self._add_con_plenum_pipe_v2(plenum_id, duct_id, 1) # Duct End -> Plenum
        node_duct_end = cid_plenum_in
        
        self._add_pipe(duct_id, "Intake_Duct", c.intake.inlet.duct_length/1000.0,
                       c.intake.inlet.duct_diameter/1000.0, c.intake.inlet.duct_diameter/1000.0, 313,
                       node_duct_start, node_duct_end)

        # 4. Runners (Dynamic Count based on Cylinders)
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            
            # Runner Pipe
            runner_id = self.pipe_counter; self.pipe_counter += 1
            self.ids['runners'].append(runner_id)
            
            # Valve ID for Throttle (ITB) - starts from 26 (after fixed CD valve 25)
            vid_throttle = 26 + i
            self.throttle_valves.append(vid_throttle)
            
            # Connect Plenum -> [ThrottleValve] -> Runner Start
            cid_run_start = self.connection_counter
            self._add_con_plenum_valve_pipe_v2(plenum_id, runner_id, 0, vid_throttle)
            
            # Port Split (Small Plenum)
            split_plenum_id = self.plenum_counter; self.plenum_counter += 1
            self._add_plenum(split_plenum_id, f"Split_Plenum_{cyl_idx}", 0.002, 313)
            
            # Connection Runner END -> Split Plenum
            cid_split = self.connection_counter
            self._add_con_plenum_pipe_v2(split_plenum_id, runner_id, 1)
            
            # Define Runner Pipe
            r_dia_max_start = c.intake.bellmouth.diameter/1000.0
            r_dia_max_end = c.engine.head.intake_port.diameter / 1000.0
            total_len = c.intake.bellmouth.length/1000.0
            
            self._add_pipe(runner_id, f"Runner_{cyl_idx}", total_len,
                           r_dia_max_start, r_dia_max_end, 313,
                           cid_run_start, cid_split) 
            self.ids['itbs'].append(vid_throttle)
                           
            # Port Pipes (2 per cyl)
            port_len_in = c.engine.head.intake_port.length / 1000.0
            port_dia_in = c.engine.head.intake_port.diameter / 1000.0
            
            for v in range(2): 
                pid_port = self.pipe_counter; self.pipe_counter += 1
                
                vid_global = (i * 2) + v + 1
                self.valves_intake.append(vid_global)
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_port, 1, cyl_idx, True, vid_global) 
                
                # Connect Port Start to Split Plenum
                cid_port_start = self.connection_counter
                self._add_con_plenum_pipe_v2(split_plenum_id, pid_port, 0)
                
                self._add_pipe(pid_port, f"Port_In_{cyl_idx}_{v+1}", port_len_in,
                               port_dia_in, port_dia_in, 400,
                               cid_port_start, cid_valve)

    def _generate_simplified_exhaust(self, c):
        print("DEBUG: Generating SIMPLIFIED Exhaust")
        # Define Port Geometry
        port_len_ex = c.engine.head.exhaust_port.length / 1000.0
        port_dia_ex = c.engine.head.exhaust_port.diameter / 1000.0
        
        # Create one Ambient Exhaust Plenum
        amb_ex_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(amb_ex_id, "Ambient_Exhaust", 1000.0, 300, ptype=0) # Type 0 = Constant Volume
        
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            for v in range(2):
                pid_port = self.pipe_counter; self.pipe_counter += 1
                vid_global = 12 + (i * 2) + v + 1
                self.valves_exhaust.append(vid_global)
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_port, 0, cyl_idx, False, vid_global) # End 0 to Cyl
                
                # Connect End 1 to Ambient Plenum
                cid_amb = self.connection_counter
                self._add_con_plenum_pipe_v2(amb_ex_id, pid_port, 1) # End 1 to Plenum
                
                self._add_pipe(pid_port, f"Port_Ex_{cyl_idx}_{v+1}", port_len_ex,
                               port_dia_ex, port_dia_ex, 800,
                               cid_valve, cid_amb)

    def _generate_full_exhaust(self, c):
        print("DEBUG: Generating FULL Exhaust (Junction Logic)")
        port_len_ex = c.engine.head.exhaust_port.length / 1000.0
        port_dia_ex = c.engine.head.exhaust_port.diameter / 1000.0
        
        col1_id = self.plenum_counter; self.plenum_counter += 1
        col2_id = self.plenum_counter; self.plenum_counter += 1
        col_map = {0: col1_id, 1: col1_id, 2: col1_id, 3: col2_id, 4: col2_id, 5: col2_id} 
        
        # 1. Collectors as Small Junctions (2.0L)
        # Replaces massive tank with flow-oriented junction node
        # Increased to damp Mach 4 spikes.
        self._add_plenum(col1_id, "Collector_1_Junct", 0.002, 800)
        self._add_plenum(col2_id, "Collector_2_Junct", 0.002, 800)
        
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            target_col_id = col_map.get(i, col1_id)
            
            # A. Port Junction (Matches 2 ports to 1 header)
            # Volume: 1.0L (Increased from 0.2L to check damping)
            # Stable junction volume is key for 1D codes.
            merge_plenum_id = self.plenum_counter; self.plenum_counter += 1
            self._add_plenum(merge_plenum_id, f"Port_Junct_{cyl_idx}", 0.001, 800)

            # B. Exhaust Ports
            for v in range(2):
                pid_port = self.pipe_counter; self.pipe_counter += 1
                vid_global = 12 + (i * 2) + v + 1
                self.valves_exhaust.append(vid_global)
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_port, 0, cyl_idx, False, vid_global) 
                
                cid_port_end = self.connection_counter
                self._add_con_plenum_pipe_v2(merge_plenum_id, pid_port, 1)
                
                self._add_pipe(pid_port, f"Port_Ex_{cyl_idx}_{v+1}", port_len_ex,
                               port_dia_ex, port_dia_ex, 800,
                               cid_valve, cid_port_end)

            # C. Primary Header Pipe
            pid_prim = self.pipe_counter; self.pipe_counter += 1
            self.ids['headers'].append(pid_prim)
            
            cid_header_start = self.connection_counter
            self._add_con_plenum_pipe_v2(merge_plenum_id, pid_prim, 0)
            
            cid_col = self.connection_counter
            self._add_con_plenum_pipe_v2(target_col_id, pid_prim, 1) 
            
            self._add_pipe(pid_prim, f"Header_{cyl_idx}", c.exhaust.headers.primary_length/1000.0,
                           c.exhaust.headers.primary_diameter/1000.0, c.exhaust.headers.collector_dia/1000.0, 1073,
                           cid_header_start, cid_col)
        
        node_left = col1_id
        node_right = col2_id
        
        if c.exhaust.catalyst.installed and c.exhaust.catalyst.location == "header_collector":
            node_left, node_right = self._add_catalyst_section(node_left, node_right, c.exhaust.catalyst, "FrontCat")
            
        # --- SECTION 1 ---
        s1 = c.exhaust.section1_1
        s2 = c.exhaust.section1_2
        len1 = s1.length / 1000.0
        len2 = s2.length / 1000.0
        dia1 = s1.diameter / 1000.0 if hasattr(s1, 'diameter') and s1.diameter > 0 else 0.075
        dia2 = s2.diameter / 1000.0 if hasattr(s2, 'diameter') and s2.diameter > 0 else 0.075
        
        p1_id = self.pipe_counter; self.pipe_counter += 1
        p2_id = self.pipe_counter; self.pipe_counter += 1
        
        c1_start = self._connect_from_prev(node_left, p1_id)
        c2_start = self._connect_from_prev(node_right, p2_id)
        
        c1_end = self.connection_counter
        self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
        c2_end = self.connection_counter
        self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
        
        self._add_pipe(p1_id, "Sec1_Bank1", len1, dia1, dia1, 1073, c1_start, c1_end)
        self._add_pipe(p2_id, "Sec1_Bank2", len2, dia2, dia2, 1073, c2_start, c2_end)
        
        # Handle X/H
        if s1.layout == "X-Pipe" or s2.layout == "X-Pipe":
            offset_val = s1.crossover_offset if s1.layout == "X-Pipe" else (s2.crossover_offset if s2.layout == "X-Pipe" else 400)
            offset = offset_val / 1000.0
            # Enforce minimum segment length of 0.15m (150mm) to prevent tiny pipes
            # Ensure off1 is between 0.15 and len1-0.15
            off1 = max(0.15, min(offset, len1 - 0.15))
            off2 = max(0.15, min(offset, len2 - 0.15))
            
            self.pipes[p1_id]['length'] = off1; self.pipes[p2_id]['length'] = off2
            self.pipes[p1_id]['label'] = "Sec1_Front1"; self.pipes[p2_id]['label'] = "Sec1_Front2"

            x_union_id = self.connection_counter
            self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
            
            self.pipes[p1_id]['right_node'] = x_union_id
            self.pipes[p2_id]['right_node'] = x_union_id
            
            p1_rear = self.pipe_counter; self.pipe_counter += 1
            p2_rear = self.pipe_counter; self.pipe_counter += 1
            c1_rear_end = self.connection_counter
            self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
            c2_rear_end = self.connection_counter
            self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
            
            self._add_pipe(p1_rear, "Sec1_Rear1", len1 - off1, dia1, dia1, 1073, x_union_id, c1_rear_end)
            self._add_pipe(p2_rear, "Sec1_Rear2", len2 - off2, dia2, dia2, 1073, x_union_id, c2_rear_end)
            node_left, node_right = c1_rear_end, c2_rear_end
        else:
            node_left, node_right = c1_end, c2_end
            
        if c.exhaust.catalyst.installed and c.exhaust.catalyst.location == "section1_end":
            node_left, node_right = self._add_catalyst_section(node_left, node_right, c.exhaust.catalyst, "RearCat")

        # --- SECTION 2 ---
        sec2_len = c.exhaust.section2.length / 1000.0
        sec2_len = c.exhaust.section2.length / 1000.0
        sec2_dia = (c.exhaust.section2.diameter / 1000.0) if c.exhaust.section2.diameter > 0 else 0.075
        
        if c.exhaust.section2.layout == "Single":
            merge_plenum = self.plenum_counter; self.plenum_counter += 1
            self._add_plenum(merge_plenum, "Y_Merge", 0.005, 500)
            
            p_adp1 = self.pipe_counter; self.pipe_counter += 1
            p_adp2 = self.pipe_counter; self.pipe_counter += 1
            
            c_adp1_start = self._connect_from_prev(node_left, p_adp1)
            c_adp2_start = self._connect_from_prev(node_right, p_adp2)
            
            c_m1_end = self.connection_counter; self._add_con_plenum_pipe_v2(merge_plenum, p_adp1, 1)
            c_m2_end = self.connection_counter; self._add_con_plenum_pipe_v2(merge_plenum, p_adp2, 1)
            
            self._add_pipe(p_adp1, "Adp_Merge_L", 0.15, dia1, dia1, 500, c_adp1_start, c_m1_end)
            self._add_pipe(p_adp2, "Adp_Merge_R", 0.15, dia1, dia1, 500, c_adp2_start, c_m2_end)
            
            # Resonator
            res_fitted = getattr(c.exhaust.section2, 'resonator_fitted', False)
            res_len = (getattr(c.exhaust.section2, 'resonator_length', 300.0)/1000.0) if res_fitted else 0.0
            main_len = max(0.1, sec2_len - res_len)
            base_dia = sec2_dia * 1.414 
            res_dia = (getattr(c.exhaust.section2, 'resonator_diameter', 0.0)/1000.0) or (base_dia * 1.3)
            
            curr_node = merge_plenum
            if res_fitted:
                p_res = self.pipe_counter; self.pipe_counter += 1
                c_res_start = self.connection_counter; self._add_con_plenum_pipe_v2(curr_node, p_res, 0)
                c_res_end = self.connection_counter 
                self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
                self._add_pipe(p_res, "Sec2_Resonator", res_len, res_dia, res_dia, 450, c_res_start, c_res_end)
                curr_node = c_res_end
                
            p_main = self.pipe_counter; self.pipe_counter += 1
            c_main_start = self._connect_from_prev(curr_node, p_main)
            split_plenum = self.plenum_counter; self.plenum_counter += 1
            self._add_plenum(split_plenum, "Y_Split", 0.005, 400)
            c_main_end = self.connection_counter; self._add_con_plenum_pipe_v2(split_plenum, p_main, 1)
            
            self._add_pipe(p_main, "Sec2_Main", main_len, base_dia, base_dia, 450, c_main_start, c_main_end)
            node_left, node_right = split_plenum, split_plenum
            last_pipe_L = p_main # Treat as Single
            last_pipe_R = p_main
            
        else:
            # Independent/H
            res_fitted = getattr(c.exhaust.section2, 'resonator_fitted', False)
            res_loc = getattr(c.exhaust.section2, 'resonator_location', 'before_h')
            layout = c.exhaust.section2.layout
            
            res_len = (getattr(c.exhaust.section2, 'resonator_length', 300.0)/1000.0) if res_fitted else 0.0
            main_len = max(0.1, sec2_len - res_len)
            res_dia = (getattr(c.exhaust.section2, 'resonator_diameter', 0.0)/1000.0) or (sec2_dia * 1.5)
            
            # Simplified for refactor: Assume 1 segment for now if no Res
            p1_L = self.pipe_counter; self.pipe_counter += 1
            p1_R = self.pipe_counter; self.pipe_counter += 1
            c1_L_start = self._connect_from_prev(node_left, p1_L)
            c1_R_start = self._connect_from_prev(node_right, p1_R)
            c1_L_end = self.connection_counter; self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
            c1_R_end = self.connection_counter; self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
            
            self._add_pipe(p1_L, "Sec2_L", sec2_len, sec2_dia, sec2_dia, 400, c1_L_start, c1_L_end)
            self._add_pipe(p1_R, "Sec2_R", sec2_len, sec2_dia, sec2_dia, 400, c1_R_start, c1_R_end)
            
            node_left, node_right = c1_L_end, c1_R_end
            last_pipe_L, last_pipe_R = p1_L, p1_R

        # --- MUFFLER & TAILPIPES ---
        muffler_id = self.plenum_counter; self.plenum_counter += 1
        muff_vol_m3 = max(c.exhaust.section3.volume / 1000.0, 0.030)
        self._add_plenum(muffler_id, "Muffler_Dual", muff_vol_m3, 400)
        
        # Connect to Muffler
        if c.exhaust.section2.layout == "Single":
             p_in1 = self.pipe_counter; self.pipe_counter += 1
             p_in2 = self.pipe_counter; self.pipe_counter += 1
             c_s1 = self.connection_counter; self._add_con_plenum_pipe_v2(node_left, p_in1, 0)
             c_s2 = self.connection_counter; self._add_con_plenum_pipe_v2(node_right, p_in2, 0)
             c_m1 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_in1, 1)
             c_m2 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_in2, 1)
             self._add_pipe(p_in1, "Muf_In1", 0.15, sec2_dia, sec2_dia, 400, c_s1, c_m1, friction=0.5)
             self.pipes[p_in1]['mesh_dx'] = 0.02 # Force finer mesh for stability
             self._add_pipe(p_in2, "Muf_In2", 0.15, sec2_dia, sec2_dia, 400, c_s2, c_m2, friction=0.5)
             self.pipes[p_in2]['mesh_dx'] = 0.02
        else:
             p_adp_m1 = self.pipe_counter; self.pipe_counter += 1
             p_adp_m2 = self.pipe_counter; self.pipe_counter += 1
             c_s1 = self._connect_from_prev(node_left, p_adp_m1)
             c_s2 = self._connect_from_prev(node_right, p_adp_m2)
             c_m1 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_adp_m1, 1)
             c_m2 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_adp_m2, 1)
             self._add_pipe(p_adp_m1, "Muf_Adapter_L", 0.15, sec2_dia, sec2_dia, 700, c_s1, c_m1)
             self._add_pipe(p_adp_m2, "Muf_Adapter_R", 0.15, sec2_dia, sec2_dia, 700, c_s2, c_m2)

        # Tailpipes
        amb_out_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(amb_out_id, "Ambient_Exhaust", 1000.0, 300)
        tail_len = c.exhaust.section3.tailpipe_length / 1000.0
        tail_dia = c.exhaust.section3.diameter / 1000.0
        
        for i in range(2):
            pid_tail = self.pipe_counter; self.pipe_counter += 1
            cid_muf_out = self.connection_counter
            self._add_con_plenum_pipe_v2(muffler_id, pid_tail, 0) 
            cid_amb_out = self.connection_counter
            self._add_con_plenum_pipe_v2(amb_out_id, pid_tail, 1)
            self._add_pipe(pid_tail, f"Tail_{i+1}", tail_len, tail_dia, tail_dia, 350, cid_muf_out, cid_amb_out)

    def _generate_footer(self, c, schedule):
        # Finalization
        self._finalize_pipes()
        self.wam_lines.append(f"{len(self.pipes)}")
        self.wam_lines.extend(self.wam_lines_pipes)
        
        # Valves
        control_ids = None
        if schedule:
            # Checkpoint: Disable VVT to debug crash
            # Define IDs: RPM=1 (Engine), Intake=2, Exhaust=3, LiftFix=4
            # control_ids = {'intake': 2, 'exhaust': 3, 'lift_fix': 4}
            pass
            
        total_valves = 25 + len(self.throttle_valves)
        self.wam_lines.append(f"{total_valves}")
        for i in range(12): self._add_valve_def(i+1, "intake.vlv", c.engine.head.intake_valve.diameter/1000.0, control_ids)
        for i in range(12): self._add_valve_def(i+13, "exhaust.vlv", c.engine.head.exhaust_valve.diameter/1000.0, control_ids)
        self._add_valve_fixed_cd(25, 1.0, 1.0)
        
        for vid in self.throttle_valves:
            dia = c.intake.bellmouth.diameter/1000.0
            self._add_valve_throttle_mariposa(vid, dia, 2)
            
        # Append Buffered Valves
        self.wam_lines.extend(self.wam_lines_valves)
            
        # Plenums
        # After NumberOfPlenums, C++ expects 3 WAMer params: numeroturbinas, numeroventuris, numerounionesdireccionales
        self.wam_lines.append(f"{len(self.plenum_ids)}")
        self.wam_lines.append("0 0 0")  # No turbines, venturis, or directional junctions
        self.wam_lines.extend(self.wam_lines_plenums)
        
        # Compressors (Not implemented yet)
        self.wam_lines.append("0")
        
        # Connections
        # After NumberOfConnections, C++ expects 9 WAMer params:
        # numnodosimples, numpulsos, numnododep, numperdpresion,
        # numcomprtornillo, numextremosinyeccion, numnodoentredepositos,
        # numentradacompresor, numentradapresionestatica
        self.wam_lines.append(f"{self.connection_counter}")
        self.wam_lines.append("0 0 0 0 0 0 0 0 0")  # WAMer params
        self.wam_lines.extend(self.wam_lines_cons)
        
        # TurboAxis (Not implemented yet)
        self.wam_lines.append("0")
        # Sensors: Num=1. Type=0(Time) Param=0. Delay=0.0 Gain=1.0
        self.wam_lines.append("1") 
        self.wam_lines.append("0 0 0.0 1.0")
        # Call controller Generation
        self._generate_controllers(schedule)
        # Output block is generated separately

    # --- HELPERS (Same as before) ---
    def _connect_from_prev(self, prev_node, next_pid):
        if prev_node in self.plenum_ids: 
            cid = self.connection_counter
            self._add_con_plenum_pipe_v2(prev_node, next_pid, 0)
            return cid
        else:
            return prev_node

    def _add_h_pipe_junction(self, p1, p2, location_ratio):
        pass

    def _add_pipe(self, pid, label, length, d_start, d_end, wall_temp, left_node=0, right_node=0, friction=0.01):
        # Global Stability Clamp: Enforce min 50mm length
        if length < 0.05: 
            length = 0.05 
        self.pipes[pid] = {
            "pid": pid, "label": label, "length": length, "d_start": d_start, "d_end": d_end,
            "wall_temp": wall_temp, "left_node": left_node, "right_node": right_node, "friction": friction
        }

    def _finalize_pipes(self):
        # Explicitly rebuild pipe lines to prevent corruption
        sorted_pids = sorted(self.pipes.keys())
        for pid in sorted_pids:
            p = self.pipes[pid]
            # OpenWAM requires 1-based Node IDs (it matches FNumeroCC = Index + 1)
            # Line 1: Connectivity (N1 N2 NCells NumDucts)
            self.wam_lines_pipes.append(f"{p['left_node'] + 1} {p['right_node'] + 1} 1 1")
            # Line 2: Friction
            self.wam_lines_pipes.append(f"{p['friction']}") 
            # Line 3: Wall Temp, Pressure, Velocity
            # Change P from 1.01325 (Bar) to 101325.0 (Pa) (Correct: Pipes need Pa, Plenums need Bar)
            # wall_temp is already Kelvin (e.g. 300)
            self.wam_lines_pipes.append(f"{p['wall_temp']} {p['wall_temp']} 101325.0 0.0")
            # Line 4: Multipliers
            self.wam_lines_pipes.append(f"1 1.0 1.0") 
            # Line 5: Composition
            self.wam_lines_pipes.append(f"{self.air_comp}")
            # Line 6: Mesh & Thermal Model
            # Optimized Mesh Size: Target 50mm globally. 
            # For short pipes (50mm), use 2 nodes (dx=Length/2) for stability (1-node caused supersonic).
            if 'mesh_dx' in p:
                dx = p['mesh_dx']
            else:
                dx = min(0.05, p['length'] / 2.0)
            self.wam_lines_pipes.append(f"{dx:.5f} 2") 
            # Line 7: Method (TVD=2, Courant=0.8)
            self.wam_lines_pipes.append(f"2 0.8") 
            # Line 8: Start Diameter
            self.wam_lines_pipes.append(f"{p['d_start']}")
            # Line 9: Length & End Diameter
            self.wam_lines_pipes.append(f"{p['length']} {p['d_end']}")
            
    def _validate_valve_config(self, valve_conf, bias=0.0):
        if abs(bias) > 40.0: pass 
        if valve_conf.max_lift > 14.5: print(f"WARNING: Max Lift {valve_conf.max_lift} mm exceeds typical S54 limits.")

    def _calculate_lift_polynomial(self, progress, max_lift):
        if progress < 0.0 or progress > 1.0: return 0.0
        p = progress
        if p <= 0.5:
            t = p * 2.0
            val = (3 * t**2) - (2 * t**3)
        else:
            t = (p - 0.5) * 2.0
            val = 1.0 - ((3 * t**2) - (2 * t**3))
        return max_lift * val

    def _add_valve_def(self, vid, file, dia, control_ids: Optional[Dict[str, int]] = None):
        is_intake = "intake" in file
        head_conf = self.config.engine.head
        valve_conf = head_conf.intake_valve if is_intake else head_conf.exhaust_valve
        base_open_intake = 350.0 
        base_open_exhaust = 130.0
        vanos_bias = 0.0
        
        # If controlled, we don't apply static bias here (Controller handles it dynamically)
        # BUT, standard OpenWAM logic adds "Angle0" + Gap.
        # Angle0 usually comes from 'open_angle' in file.
        # So we should probably set Angle0 to Base?
        # If static (no control):
        if not control_ids:
            if is_intake:
                vanos_bias = self.config.engine.vanos_intake_bias
                self._validate_valve_config(valve_conf, vanos_bias)
                open_angle = base_open_intake - vanos_bias
            else:
                vanos_bias = self.config.engine.vanos_exhaust_bias
                self._validate_valve_config(valve_conf, vanos_bias)
                open_angle = base_open_exhaust - vanos_bias
        else:
             # Simulation with control: Set Base Angle. Controller outputs Bias (Gap).
             # open_angle = Angle0
             open_angle = base_open_intake if is_intake else base_open_exhaust
            
        self.wam_lines_valves.append("1") 
        # Dynamic Duration Logic
        step = 5.0
        duration = valve_conf.duration
        num_lev = int(duration / step) + 1
        
        # Ensure we cover the full duration
        actual_duration = (num_lev - 1) * step
        
        self.wam_lines_valves.append(f"{dia} {num_lev} {step} {open_angle:.2f} {dia} 0.0")
        
        lifts = []
        max_lift_m = valve_conf.max_lift / 1000.0
        for i in range(num_lev):
            progress = i / (num_lev - 1)
            l = self._calculate_lift_polynomial(progress, max_lift_m)
            lifts.append(f"{l:.5f}")
        self.wam_lines_valves.append(" ".join(lifts))
        self.wam_lines_valves.append("10 0.0011") 
        flow_scalar = head_conf.port_flow_coeff
        base_cd = 0.6 * flow_scalar
        cd_vals = [f"{base_cd:.3f}"] * 10
        self.wam_lines_valves.append(" ".join(cd_vals))
        self.wam_lines_valves.append(" ".join(cd_vals))
        swirl_vals = ["0.0"] * 10
        self.wam_lines_valves.append(" ".join(swirl_vals))
        self.wam_lines_valves.append("1") 
        self.wam_lines_valves.append("1.0") 
        
        # CONTROLLERS (Swapped Flag Workaround)
        if control_ids:
            # Check if this valve type has a controller assigned
            ctrl_id = control_ids.get('intake' if is_intake else 'exhaust')
            lift_fix_id = control_ids.get('lift_fix')
            
            if ctrl_id and lift_fix_id:
                # 2 Controllers:
                # 0 -> Phase (Timing) Controller ID (Sets Lift=True)
                # 1 -> Lift (Multiplier) Controller ID (Sets Timing=True)
                self.wam_lines_valves.append("2")
                self.wam_lines_valves.append(f"0 {ctrl_id}")
                self.wam_lines_valves.append(f"1 {lift_fix_id}")
            else:
                self.wam_lines_valves.append("0")
        else:
            self.wam_lines_valves.append("0")

    def _add_valve_fixed_cd(self, vid, cd_in, cd_out):
        # Type 0: TCDFijo (Fixed Discharge Coefficient)
        # Format: CDEntrada CDSalida ActivaDiamRef(0/1) [DiamRef if 1]
        self.wam_lines_valves.append("0")
        self.wam_lines_valves.append(f"{cd_in} {cd_out} 0")  # CD_in, CD_out, no ref diameter

    def _add_valve_throttle_mariposa(self, vid, dia, ctrl_id):
        # Type 10: TMariposa
        self.wam_lines_valves.append("10") 
        # Header: NumPoints RefDiameter
        self.wam_lines_valves.append(f"10 {dia:.5f}")
        
        # Points: Angle(deg) CdIn CdOut
        for i in range(10):
            ang = i * 10.0 
            cd = 0.65 * (ang / 90.0)
            if cd < 0.01: cd = 0.0 
            self.wam_lines_valves.append(f"{ang:.1f} {cd:.3f} {cd:.3f}")
            
        # Initial State: Lift(Angle) - Fixed 90.0 (WOT)
        self.wam_lines_valves.append("90.0")
        
        # Controlled: 0 = No
        self.wam_lines_valves.append("0")
        # Params: Skipped if Controlled=0

    def _add_plenum(self, plid, label, vol, wall_temp, ptype=0):
        # Type 0: Constant Volume
        
        # BRUTE FORCE STABILITY: Minimum 1 Liters (0.001 m3) - Reduced from 100L as Pa fix should solve it.
        # OpenWAM stability usually fine with >0.1L if invalid pressures are fixed.
        vol = max(vol, 0.001)
        
        self.wam_lines_plenums.append(f"{ptype}")
        self.wam_lines_plenums.append(self.air_comp)
        
        # Original format: Vol P T
        # Change 1: P from 1.01325 (Bar) to 101325.0 (Pa) -> CORRECT: OpenWAM Deposito needs Pa
        # Change 2: T from Celsius to Kelvin (Remove -273.15)
        # wall_temp is passed in Kelvin (e.g. 313)
        self.wam_lines_plenums.append(f"{vol:.5f} 101325.0 {wall_temp:.2f}")
        
        self.plenum_ids.add(plid)

    def _add_con_plenum_valve_pipe_v2(self, plenum_id, pipe_id, pipe_end, valve_id):
        # Type 11 (TCCDeposito) reads: numid, plenum_id. 
        # THEN TOpenWAM::ReadConnections reads 'quevalv' (Valve Index).
        self.wam_lines_cons.append("11")
        self.wam_lines_cons.append(f"0 {plenum_id}")
        self.wam_lines_cons.append(f"{valve_id}")  # Valve index (1-based)
        self.connection_counter += 1

    def _add_con_valve_v2(self, pid, end_idx, cyl_id, is_intake, vid_global):
        ctype = "7" if is_intake else "8"
        self.wam_lines_cons.append(ctype)
        # Type 7/8 (TCCCilindro) reads: numid, cyl_id, then quevalv (valve index)
        self.wam_lines_cons.append(f"0 {cyl_id}")
        self.wam_lines_cons.append(f"{vid_global}")  # Valve index (1-based)
        self.connection_counter += 1

    def _add_con_plenum_pipe_v2(self, plid, pid, end_idx):
        # Type 11 (TCCDeposito) reads: numid, plenum_id.
        # THEN TOpenWAM::ReadConnections reads 'quevalv' (Valve Index).
        self.wam_lines_cons.append("11")
        self.wam_lines_cons.append(f"0 {plid}")
        self.wam_lines_cons.append("25")  # Fixed CD valve index (valve #25)
        self.connection_counter += 1

    def _add_catalyst_section(self, node_left, node_right, cat_conf, label_prefix):
        curr_l = node_left
        curr_r = node_right
        cat_len = cat_conf.length / 1000.0
        cat_dia = cat_conf.diameter / 1000.0
        friction = 0.01 + (cat_conf.cpsi / 10000.0) 
        p_cat1 = self.pipe_counter; self.pipe_counter += 1
        p_cat2 = self.pipe_counter; self.pipe_counter += 1
        c1_s = self._connect_from_prev(curr_l, p_cat1)
        c2_s = self._connect_from_prev(curr_r, p_cat2)
        c1_e = self.connection_counter
        self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
        c2_e = self.connection_counter
        self.wam_lines_cons.append("6"); self.wam_lines_cons.append("0.0 0.0"); self.connection_counter += 1
        self._add_pipe(p_cat1, f"{label_prefix}_L", cat_len, cat_dia, cat_dia, 600, c1_s, c1_e, friction=friction)
        self._add_pipe(p_cat2, f"{label_prefix}_R", cat_len, cat_dia, cat_dia, 600, c2_s, c2_e, friction=friction)
        return c1_e, c2_e


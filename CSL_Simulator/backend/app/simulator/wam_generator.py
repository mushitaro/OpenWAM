
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
        # REFACTORED: Store connections as dict {cid: [type, line1, line2, ...]}
        self.connections = {}
        
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
        cid = self.connection_counter
        self.connections[cid] = (type_loss, [f"{K_factor}"])
        self.connection_counter += 1

    def _get_dynamic_cd(self, lift_mm, valve_dia_mm, is_intake=True):
        """
        Literature-based Discharge Coefficient Model

        References:
        - SAE 2021-36-0107: Honda CBR600RR measured Cd (exhaust: 0.45-0.91, intake: 0.42-0.69)
        - Heywood "Internal Combustion Engine Fundamentals" 2nd Ed, Ch.6.3.2
        - SAE 2017-01-5022: TU Munich flow bench measurements

        Key improvements over previous simplified model:
        - Separate curves for intake vs exhaust (exhaust has higher peak Cd)
        - Higher peak Cd values matching measured data from high-performance NA engines
        - Proper behavior at high L/D ratios (>0.30) for S54-class valve lifts
        """
        if lift_mm <= 0.01:
            return 0.0

        ld_ratio = lift_mm / valve_dia_mm

        if is_intake:
            # Intake valve Cd curve (4-valve pent-roof, high-performance NA)
            # Peak Cd ~ 0.72 at L/D = 0.25, slight decrease at higher lifts due to separation
            # Based on SAE data: intake Cd typically 0.42-0.72 range
            if ld_ratio < 0.05:
                # Very low lift: viscous dominated, linear ramp
                base_cd = 5.0 * ld_ratio  # 0 -> 0.25
            elif ld_ratio < 0.15:
                # Low-mid lift: rapid increase as flow area opens
                base_cd = 0.25 + 3.3 * (ld_ratio - 0.05)  # 0.25 -> 0.58
            elif ld_ratio < 0.25:
                # Mid lift: approaching peak efficiency
                base_cd = 0.58 + 1.4 * (ld_ratio - 0.15)  # 0.58 -> 0.72
            elif ld_ratio < 0.35:
                # High lift: slight decrease due to flow separation at valve head
                base_cd = 0.72 - 0.4 * (ld_ratio - 0.25)  # 0.72 -> 0.68
            else:
                # Very high lift: plateau with minor losses
                base_cd = 0.68 - 0.1 * min(1.0, (ld_ratio - 0.35) / 0.10)  # 0.68 -> 0.67
        else:
            # Exhaust valve Cd curve
            # Higher peak Cd ~ 0.85-0.91 at L/D > 0.30 (SAE 2021-36-0107 CBR600RR data)
            # Exhaust flow benefits from pressure-driven discharge (blowdown)
            if ld_ratio < 0.05:
                # Very low lift
                base_cd = 4.5 * ld_ratio  # 0 -> 0.225
            elif ld_ratio < 0.15:
                # Low-mid lift: rapid increase
                base_cd = 0.225 + 3.25 * (ld_ratio - 0.05)  # 0.225 -> 0.55
            elif ld_ratio < 0.25:
                # Mid lift: continuing increase
                base_cd = 0.55 + 2.5 * (ld_ratio - 0.15)  # 0.55 -> 0.80
            elif ld_ratio < 0.35:
                # High lift: approaching peak
                base_cd = 0.80 + 0.7 * (ld_ratio - 0.25)  # 0.80 -> 0.87
            else:
                # Very high lift: plateau near maximum
                base_cd = 0.87 + 0.3 * min(1.0, (ld_ratio - 0.35) / 0.10)  # 0.87 -> 0.90

        # Apply head flow scalar (user tuning factor) and enforce physical limit
        return min(base_cd * self.config.engine.head.port_flow_coeff, 0.95)

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
        """Generate controllers including throttle controller for Mariposa valves."""
        
        def add_function_controller(time_arr, val_arr):
            # Output Type 2 (Table1D)
            # Format: Type(2) FromFile(0) NumPoints X Y ... Period(0) Interp(0) SensorID(1)
            self.wam_lines.append("2") 
            self.wam_lines.append("0")  # fromfile=0
            
            n = len(time_arr)
            self.wam_lines.append(f"{n}")
            for t, v in zip(time_arr, val_arr):
                self.wam_lines.append(f"{t:.4f} {v:.4f}")
            
            self.wam_lines.append("0")  # Period=0
            self.wam_lines.append("0")  # Interp=Linear
            self.wam_lines.append("1")  # SensorID=1 (Time)
        
        # Calculate throttle angle from config
        throttle_angle = self._calculate_throttle_angle(
            self.config.engine.throttle_position
        )
        
        if not schedule:
            # VE Table Mode: Only throttle controller needed
            # Controller ID = 1 for Throttle
            self.wam_lines.append("1")  # 1 controller
            
            # Throttle Controller (ID 1): Fixed angle throughout simulation
            add_function_controller([0.0, 1.0], [throttle_angle, throttle_angle])
            return

        # Full Schedule Mode: 5 Controllers
        # 1(RPM), 2(Intake), 3(Exhaust), 4(LiftFix), 5(Throttle)
        self.wam_lines.append("5")
        
        # 1. RPM Controller (ID 1)
        add_function_controller(schedule.time_points, schedule.rpm_points)
        
        # 2. Intake Phase (ID 2)
        neg_intake = [-x for x in schedule.intake_bias_points]
        add_function_controller(schedule.time_points, neg_intake)
        
        # 3. Exhaust Phase (ID 3)
        neg_exhaust = [-x for x in schedule.exhaust_bias_points]
        add_function_controller(schedule.time_points, neg_exhaust)
        
        # 4. Lift Fix (ID 4) - Constant 1.0
        dur = schedule.duration if schedule.duration > 0 else 10.0
        add_function_controller([0.0, dur], [1.0, 1.0])
        
        # 5. Throttle Controller (ID 5) - Fixed angle
        add_function_controller([0.0, dur], [throttle_angle, throttle_angle])


    def _generate_engine_block(self, schedule: Optional[SweepSchedule]):
        # Matches TBloqueMotor::LeeMotor Order (OpenWAM v2.2)
        c = self.config
        
        # 1. ACT Usage (0=No, 1=Yes)
        self._add("0", "ACT=No")
        
        # 2. Cylinders
        self._add(f"{c.engine.cylinders}", "Num Cylinders")
        
        # 3. Initial Conditions
        # WARNING: OpenWAM Engine Initialization likely expects Bar for Pressure!
        # CONFIRMED: 101325.0 resulted in 67kg trapped mass (100k Bar). Must use Bar.
        # EXPERIMENT: Restoring Standard Mass (0.6g) + Friction 0.5 (Ports) + Mesh 0.05.
        # This combination aims to dampen the 10 Bar startup spike without crashing the solver.
        p_init = 1.01325 
        m_init = 0.0006
        self._add(f"{c.engine.rpm} {p_init} {m_init}", "Initial: RPM Press Mass")
        
        # ImponerComposicionAE (0=False)
        self._add("0", "Impose Comp AE=0")
        
        # FComposicionInicial (Loop FNumeroEspecies - 1)
        # OpenWAM reads (FNumeroEspecies - 1) = 10 values when FNumeroEspecies = 11
        # We must output ALL 10 values from air_comp, NOT N-1
        ac_list = self.air_comp.strip().split()
        self._add(" ".join(ac_list), "Initial Composition (10 values)")
        
        # TipoPresionAAE (0=Calc)
        self._add("0", "Calc AAE Pressure")
        
        # 4. Combustion Type (1=MEP)
        self._add("1", "Combustion=MEP")
        
        # 5. Fuel / Dosado
        self._add("1.0", "Dosado")
        
        # 6. Efficiency & Fuel Props
        self._add("0.98 44000000 750", "Eff LHV Rho")
        
        # 7-8. Thermal Params - MUST be separate values for TBloqueMotor::LeeMotor
        # Line 222: FNumTuboRendVol (Ref Pipe for VE calculation)
        # Line 228: FTempInicial.Piston
        # Line 229: FTempInicial.Culata (Head)
        # Line 230: FTempInicial.Cylinder
        self._add("##VE_PIPE_ID##", "Ref Pipe VE")
        self._add("60", "Temp Piston (C)")
        self._add("60", "Temp Head (C)")
        self._add("60", "Temp Cylinder (C)")
        
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
        # Wiebe: m=2.0, a=6.9, FQL_ini=0.0, Duration=60deg, Start=ignition_timing (BTDC, negative)
        ign_start = -self.ignition_timing if hasattr(self, 'ignition_timing') else -15.0
        self._add(f"2.0 6.9 0.0 60.0 {ign_start:.1f}", "Wiebe Params")
        
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

    def generate(self, schedule: Optional[SweepSchedule] = None, ignition_timing: float = 15.0):
        # ignition_timing: Degrees BTDC (positive value, e.g. 30 means 30 BTDC)
        self.ignition_timing = ignition_timing
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
        # Extended simulation time: 2.0s for cycle stabilization (was 0.5s)
        # At 3000 RPM: 2.0s = ~50 cycles, sufficient for VE convergence
        self._add(f"2.0 {c.simulation.duration_cycles}", "dTheta Duration") 
        # OpenWAM expects BAR for P_amb
        p_amb_bar = c.environment.ambient_pressure / 100000.0
        self._add(f"{p_amb_bar:.5f} {c.environment.ambient_temp}", "P_amb T_amb")
        
        # General Data
        self._add("1 2", "Species=Complete, Gamma=Comp+Temp")
        
        # 1. Engine Exists (hayBQ)
        self._add("1", "Engine Exists")
        
        # 2. Cycle Mode (If EngineExists) (4T, Mode, EGR)
        # Mode: 0=Steady, 1=TransientLoad, 2=TransientRPM, 3=TransientRPMExternal
        # Using Transient Load mode to enable warmup (CyclesWithoutThemalInertia)
        self._add("0 1 0", "Cycle Mode (4T, TransientLoad, NoEGR)")
        
        # 3. CyclesWithoutThemalInertia (ONLY read in Transient modes)
        # This enables warmup: wall temperature uses simplified calculation
        # for first N cycles to avoid thermal shock instabilities
        warmup_cycles = 10  # 10 cycles of warmup before full thermal inertia
        self._add(f"{warmup_cycles}", "Warmup Cycles (CyclesWithoutThemalInertia)")
        
        # 4. Fuel (haycombustible, tipocombustible)
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
        self.connections = {}  # REFACTORED: dict instead of list
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
        print(f"DEBUG: Generate Intake (CSL Carbon Airbox). Keys: {list(self.ids.keys())}")
        if 'itbs' not in self.ids: 
            print("WARNING: 'itbs' key missing. Re-initializing.")
            self.ids['itbs'] = []
        if 'plenum_intake' not in self.ids: self.ids['plenum_intake'] = None
        
        # 1. Ambient Plenum
        amb_in_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(amb_in_id, "Ambient_Intake", 1000.0, 300, ptype=0) # Type 0 = Constant Volume
        
        # 2. CSL Intake Pipe (Snorkel)
        # Spec: D=200mm, Length Tapered 500mm-200mm -> Avg 350mm
        intake_pipe_id = self.pipe_counter; self.pipe_counter += 1
        
        # Connect Ambient to Pipe Start
        cid_amb = self.connection_counter 
        self._add_con_plenum_pipe_v2(amb_in_id, intake_pipe_id, 0)
        
        # Pipe End -> Filter Start: Type 6 Direct Pipe-to-Pipe Connection
        c_pipe_to_filter = self._create_pipe_to_pipe_connection()
        
        # Intake Pipe: Low friction (smooth carbon), D=200mm
        self._add_pipe(intake_pipe_id, "CSL_Intake_Pipe", 0.350, 0.200, 0.200, 300, 
                       cid_amb, c_pipe_to_filter, friction=0.05, dx_mesh=0.05)
        
        # 3. Panel Filter (Between Pipe and Plenum)
        # Spec: "Plenum face size", ~20mm thick.
        # Estimate: 600mm x 150mm => ~340mm equivalent diameter. Using 300mm conservatively.
        filter_id = self.pipe_counter; self.pipe_counter += 1
        
        # Start: Use same Type 6 connection as Pipe End
        cid_filter_start = c_pipe_to_filter
        
        # Plenum
        plenum_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(plenum_id, "Plenum_Main", c.intake.plenum_vol/1000.0, 313)
        self.ids['plenum_intake'] = plenum_id
        
        cid_plenum_in = self.connection_counter
        self._add_con_plenum_pipe_v2(plenum_id, filter_id, 1) # Filter End -> Plenum
        
        # Panel Filter: Short (20mm), Wide (300mm), High Friction (Filter Media)
        # Friction 0.5-1.0 typical for filter media in 1D
        self._add_pipe(filter_id, "CSL_Panel_Filter", 0.020, 0.300, 0.300, 300,
                       cid_filter_start, cid_plenum_in, friction=0.8, dx_mesh=0.01)


        # 4. Runners (Dynamic Count based on Cylinders)
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            
            # Runner Pipe (with built-in bellmouth taper effect)
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
            
            # Define Runner Pipe with BELLMOUTH TAPER
            # Start diameter: 20% larger than ITB (simulates bellmouth funnel)
            # End diameter: ITB Diameter (Runner maintains size until split)
            # REVISION: Previously used intake_port.diameter (35mm), causing massive choke.
            itb_dia = c.intake.itb.diameter / 1000.0
            bellmouth_dia = itb_dia * 1.2  # 60mm for 50mm ITB
            r_dia_max_end = itb_dia # 50mm (Matches ITB)
            total_len = c.intake.bellmouth.length / 1000.0
            
            # Taper from bellmouth (60mm) to port (smaller)
            self._add_pipe(runner_id, f"Runner_{cyl_idx}", total_len,
                           bellmouth_dia, r_dia_max_end, 313,
                           cid_run_start, cid_split, friction=0.08, dx_mesh=0.020) 
            self.ids['itbs'].append(vid_throttle)
                           
            # Port Pipes (2 per cyl) - SEGMENTED for stability
            # Port is split into: Main Port -> Valve Pocket (buffer) -> Valve
            port_len_in = c.engine.head.intake_port.length / 1000.0
            port_dia_in = c.engine.head.intake_port.diameter / 1000.0
            
            # Segment lengths: Main=70%, Pocket=30%
            port_main_len = port_len_in * 0.7
            port_pocket_len = port_len_in * 0.3
            
            for v in range(2): 
                vid_global = (i * 2) + v + 1
                self.valves_intake.append(vid_global)
                
                # --- VALVE POCKET (buffer plenum before valve) ---
                # 3cc pocket to absorb backflow shockwaves
                valve_pocket_id = self.plenum_counter; self.plenum_counter += 1
                self._add_plenum(valve_pocket_id, f"ValvePocket_In_{cyl_idx}_{v+1}", 0.003, 380)
                
                # --- MAIN PORT PIPE (from split plenum to valve pocket) ---
                pid_main = self.pipe_counter; self.pipe_counter += 1
                
                cid_main_start = self.connection_counter
                self._add_con_plenum_pipe_v2(split_plenum_id, pid_main, 0)
                
                cid_main_end = self.connection_counter
                self._add_con_plenum_pipe_v2(valve_pocket_id, pid_main, 1)
                
                # Main port: wider entry, narrower at pocket (taper for stability)
                self._add_pipe(pid_main, f"Port_In_Main_{cyl_idx}_{v+1}", port_main_len,
                               port_dia_in, port_dia_in * 0.95, 400,
                               cid_main_start, cid_main_end, friction=0.3, dx_mesh=0.025)
                
                # --- POCKET PIPE (from valve pocket to valve) ---
                pid_pocket = self.pipe_counter; self.pipe_counter += 1
                
                cid_pocket_start = self.connection_counter
                self._add_con_plenum_pipe_v2(valve_pocket_id, pid_pocket, 0)
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_pocket, 1, cyl_idx, True, vid_global)
                
                # Pocket pipe: short, fine mesh for stability near valve
                self._add_pipe(pid_pocket, f"Port_In_Pocket_{cyl_idx}_{v+1}", port_pocket_len,
                               port_dia_in * 0.95, port_dia_in, 400,
                               cid_pocket_start, cid_valve, friction=0.5, dx_mesh=0.020)

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
        print("DEBUG: Generating FULL Exhaust (CSL 3-Stage Topology)")
        port_len_ex = c.engine.head.exhaust_port.length / 1000.0
        port_dia_ex = c.engine.head.exhaust_port.diameter / 1000.0
        
        # --- 1. COLLECTORS & BUFFER PIPES ---
        # Bank 1: Cyl 1-3 -> Col 1 -> Buffer 1
        # Bank 2: Cyl 4-6 -> Col 2 -> Buffer 2
        
        col1_id = self.plenum_counter; self.plenum_counter += 1
        col2_id = self.plenum_counter; self.plenum_counter += 1
        col_map = {0: col1_id, 1: col1_id, 2: col1_id, 3: col2_id, 4: col2_id, 5: col2_id} 
        
        # Tiny Junction (2cc) to merge headers without reflection
        self._add_plenum(col1_id, "Collector_1_Junct", 0.002, 400)
        self._add_plenum(col2_id, "Collector_2_Junct", 0.002, 400)
        
        # HEADER + PORT GENERATION (Unchanged Logic, mostly)
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            target_col_id = col_map.get(i, col1_id)
            
            # Port Junction (1.0L -> 0.001L)
            merge_plenum_id = self.plenum_counter; self.plenum_counter += 1
            self._add_plenum(merge_plenum_id, f"Port_Junct_{cyl_idx}", 0.001, 380)

            # Ports - SEGMENTED for stability
            # Port is split into: Valve -> Valve Pocket (buffer) -> Main Port -> Junction
            # Segment lengths: Pocket=30%, Main=70%
            port_pocket_len = port_len_ex * 0.3
            port_main_len = port_len_ex * 0.7
            
            for v in range(2):
                vid_global = 12 + (i * 2) + v + 1
                self.valves_exhaust.append(vid_global)
                
                # --- VALVE POCKET (buffer plenum after exhaust valve) ---
                # 5cc pocket to absorb blowdown shockwaves (larger than intake due to high temp/pressure)
                valve_pocket_id = self.plenum_counter; self.plenum_counter += 1
                self._add_plenum(valve_pocket_id, f"ValvePocket_Ex_{cyl_idx}_{v+1}", 0.005, 360)
                
                # --- POCKET PIPE (from valve to valve pocket) ---
                pid_pocket = self.pipe_counter; self.pipe_counter += 1
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_pocket, 0, cyl_idx, False, vid_global) 
                
                cid_pocket_end = self.connection_counter
                self._add_con_plenum_pipe_v2(valve_pocket_id, pid_pocket, 1)
                
                # Pocket pipe: short, fine mesh for stability near valve
                self._add_pipe(pid_pocket, f"Port_Ex_Pocket_{cyl_idx}_{v+1}", port_pocket_len,
                               port_dia_ex, port_dia_ex * 1.05, 360,
                               cid_valve, cid_pocket_end, friction=0.5, dx_mesh=0.020) 
                
                # --- MAIN PORT PIPE (from valve pocket to merge junction) ---
                pid_main = self.pipe_counter; self.pipe_counter += 1
                
                cid_main_start = self.connection_counter
                self._add_con_plenum_pipe_v2(valve_pocket_id, pid_main, 0)
                
                cid_port_end = self.connection_counter
                self._add_con_plenum_pipe_v2(merge_plenum_id, pid_main, 1)
                
                # Main port: slight expansion for pressure recovery
                self._add_pipe(pid_main, f"Port_Ex_Main_{cyl_idx}_{v+1}", port_main_len,
                               port_dia_ex * 1.05, port_dia_ex, 
                               370, cid_main_start, cid_port_end, friction=0.3, dx_mesh=0.025) 

            # Headers
            header_len = c.exhaust.headers.primary_length / 1000.0
            header_dia = c.exhaust.headers.primary_diameter / 1000.0
            col_dia = c.exhaust.headers.collector_dia / 1000.0
            
            pid_prim = self.pipe_counter; self.pipe_counter += 1 
            self.ids['headers'].append(pid_prim)
            
            cid_header_start = self.connection_counter
            self._add_con_plenum_pipe_v2(merge_plenum_id, pid_prim, 0)
            cid_col = self.connection_counter
            self._add_con_plenum_pipe_v2(target_col_id, pid_prim, 1) 

            # Exhaust Header: 35mm Mesh, Friction 0.5
            self._add_pipe(pid_prim, f"Header_{cyl_idx}", header_len,
                           header_dia, col_dia, 
                           400, cid_header_start, cid_col, friction=0.5, dx_mesh=0.035)

        # BUFFER PIPES (100cc Equivalent) to damp Supersonic Flow
        # D=60mm, L=50mm -> Vol ~ 140cc.
        buf_len = 0.05
        buf_dia = 0.06
        
        p_buf1 = self.pipe_counter; self.pipe_counter += 1
        p_buf2 = self.pipe_counter; self.pipe_counter += 1
        
        c_buf1_start = self._connect_from_prev(col1_id, p_buf1)
        c_buf2_start = self._connect_from_prev(col2_id, p_buf2)
        
        # Buffer End -> Section 1-1 Start: Type 6 Direct Pipe-to-Pipe Connection
        # CRITICAL: Both pipes MUST reference the same connection ID
        c_buf1_to_s11 = self._create_pipe_to_pipe_connection()  # Buffer1_End & Sec1_1_L_Start
        c_buf2_to_s11 = self._create_pipe_to_pipe_connection()  # Buffer2_End & Sec1_1_R_Start
        
        self._add_pipe(p_buf1, "Collector_Buffer_1", buf_len, buf_dia, buf_dia, 400, c_buf1_start, c_buf1_to_s11, dx_mesh=0.035)
        self._add_pipe(p_buf2, "Collector_Buffer_2", buf_len, buf_dia, buf_dia, 400, c_buf2_start, c_buf2_to_s11, dx_mesh=0.035)

        # --- SECTION 1: 3-Stage Split (Pipe -> Cat -> Pipe) ---
        # User Spec: 600mm -> 300mm Cat -> 300mm
        s1 = c.exhaust.section1_1
        s2 = c.exhaust.section1_2 # Assuming symmetric
        
        cat_len = c.exhaust.catalyst.length / 1000.0 if c.exhaust.catalyst.installed else 0.0
        sec1_total_len = s1.length / 1000.0
        part1_1_len = s1.cat_offset / 1000.0 # 600mm
        part1_2_len = max(0.1, sec1_total_len - part1_1_len - cat_len) # Remainder (~300mm)
        dia1 = s1.diameter / 1000.0
        
        # Part 1-1 (Pre-Cat): Start from Buffer End connection, End at Type 6 junction
        p1_1 = self.pipe_counter; self.pipe_counter += 1
        p1_2 = self.pipe_counter; self.pipe_counter += 1
        # Start: Uses same connection ID as Buffer End (Type 6 requirement: 2 pipes)
        c1_1_start = c_buf1_to_s11  # Type 6: Pipe 2 references same ID
        c1_2_start = c_buf2_to_s11
        # End: Create new Type 6 for connection to Catalyst/Post-Cat
        c_s11_to_cat = self._create_pipe_to_pipe_connection()
        c_s11_to_cat_R = self._create_pipe_to_pipe_connection()
        
        self._add_pipe(p1_1, "Sec1_1_L", part1_1_len, dia1, dia1, 380, c1_1_start, c_s11_to_cat)
        self._add_pipe(p1_2, "Sec1_1_R", part1_1_len, dia1, dia1, 380, c1_2_start, c_s11_to_cat_R)
        
        # node_left/right now hold Type 6 connection IDs for next section
        node_left, node_right = c_s11_to_cat, c_s11_to_cat_R
        
        # Catalyst
        if c.exhaust.catalyst.installed:
            node_left, node_right = self._add_catalyst_section(node_left, node_right, c.exhaust.catalyst, "FrontCat")

        # Part 1-2 (Post-Cat)
        p2_1 = self.pipe_counter; self.pipe_counter += 1
        p2_2 = self.pipe_counter; self.pipe_counter += 1
        # node_left/right come from Catalyst section (Type 6 IDs)
        c2_1_start = node_left  # Type 6: References same ID as Catalyst End
        c2_2_start = node_right
        # End: Create Type 6 for connection to Section 2-1
        c_s12_to_s21 = self._create_pipe_to_pipe_connection()
        c_s12_to_s21_R = self._create_pipe_to_pipe_connection()

        self._add_pipe(p2_1, "Sec1_2_L", part1_2_len, dia1, dia1, 370, c2_1_start, c_s12_to_s21)
        self._add_pipe(p2_2, "Sec1_2_R", part1_2_len, dia1, dia1, 370, c2_2_start, c_s12_to_s21_R)
        
        # node_left/right now hold Type 6 for Section 2-1 Start
        node_left, node_right = c_s12_to_s21, c_s12_to_s21_R

        # --- SECTION 2: 3-Stage Split (Pipe -> H-Pipe -> Pipe) ---
        # User Spec: 400mm -> H-Pipe (200mm) -> 800mm. Total 1400mm.
        sec2_total_len = c.exhaust.section2.length / 1000.0
        h_len = 0.2 # 200mm for H-section
        part2_1_len = 0.4 # 400mm
        part2_2_len = max(0.1, sec2_total_len - part2_1_len - h_len) # 800mm
        dia2 = c.exhaust.section2.diameter / 1000.0
        
        # Part 2-1 (Pre-H): Start from Section 1-2 End
        p3_1 = self.pipe_counter; self.pipe_counter += 1
        p3_2 = self.pipe_counter; self.pipe_counter += 1
        c3_1_start = node_left  # Type 6: References same ID as Section 1-2 End
        c3_2_start = node_right
        
        # H-Pipe Section setup
        p4_1 = self.pipe_counter; self.pipe_counter += 1 # L Straight
        p4_2 = self.pipe_counter; self.pipe_counter += 1 # R Straight
        p_cross = self.pipe_counter; self.pipe_counter += 1 # Crossover
        
        # Use Junction Plenums for H-Pipe connection
        h_junct_L = self.plenum_counter; self.plenum_counter += 1
        h_junct_R = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(h_junct_L, "H_Junc_L", 0.002, 360)
        self._add_plenum(h_junct_R, "H_Junc_R", 0.002, 360)
        
        # Connect Pre-H End -> H-Junct
        # This creates the correct End Connection ID for P3_1/P3_2 (Plenum type)
        cid_p3_1_end = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_L, p3_1, 1)
        cid_p3_2_end = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_R, p3_2, 1)
        
        # Now we can safely add the Pre-H pipes with correct connections
        self._add_pipe(p3_1, "Sec2_1_L", part2_1_len, dia2, dia2, 360, c3_1_start, cid_p3_1_end)
        self._add_pipe(p3_2, "Sec2_1_R", part2_1_len, dia2, dia2, 360, c3_2_start, cid_p3_2_end)
        
        # Connect H-Straight Starts -> H-Junct
        cid_p4_1_start = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_L, p4_1, 0)
        cid_p4_2_start = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_R, p4_2, 0)
        
        # Connect Crossover Starts/Ends to H-Junct
        cid_cross_L = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_L, p_cross, 0)
        cid_cross_R = self.connection_counter; self._add_con_plenum_pipe_v2(h_junct_R, p_cross, 1)
        
        # H-Straight Ends -> Section 2-2 Start: Type 6 Direct Connection
        c_hend_to_s22 = self._create_pipe_to_pipe_connection()
        c_hend_to_s22_R = self._create_pipe_to_pipe_connection()
        
        self._add_pipe(p4_1, "Sec2_H_L", h_len, dia2, dia2, 360, cid_p4_1_start, c_hend_to_s22)
        self._add_pipe(p4_2, "Sec2_H_R", h_len, dia2, dia2, 360, cid_p4_2_start, c_hend_to_s22_R)
        
        # Crossover Pipe
        # Usually narrower? Let's use same diameter for H-Pipe.
        self._add_pipe(p_cross, "Sec2_H_Cross", 0.15, dia2, dia2, 360, cid_cross_L, cid_cross_R)

        # Part 2-2 (Post-H / Rear): Start from H-Straight End Type 6
        p5_1 = self.pipe_counter; self.pipe_counter += 1
        p5_2 = self.pipe_counter; self.pipe_counter += 1
        c5_1_start = c_hend_to_s22  # Type 6: References same ID as H-Straight End
        c5_2_start = c_hend_to_s22_R
        # End: Create Type 6 for Muffler Adapter connection
        c_s22_to_muf = self._create_pipe_to_pipe_connection()
        c_s22_to_muf_R = self._create_pipe_to_pipe_connection()
        
        self._add_pipe(p5_1, "Sec2_2_L", part2_2_len, dia2, dia2, 350, c5_1_start, c_s22_to_muf)
        self._add_pipe(p5_2, "Sec2_2_R", part2_2_len, dia2, dia2, 350, c5_2_start, c_s22_to_muf_R)
        
        node_left, node_right = c_s22_to_muf, c_s22_to_muf_R

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
             # --- EXPERIMENT 1: VENT TO ATMOSPHERE (DISABLED/REMOVED for Exp 1b) ---
             # (Original Exp 1 code was here. Reverting to normal flow for potential future restoration)
             # But since 'return' is upstream, this code is unreachable anyway.
             # Restoring original structure for clarity if Exp 1b is removed.
             
             c_m1 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_in1, 1)
             c_m2 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_in2, 1)
             
             # Fixed NameError: sec2_dia -> dia2
             self._add_pipe(p_in1, "Muf_In1", 0.15, dia2, dia2, 400, c_s1, c_m1, friction=0.5)
             self.pipes[p_in1]['mesh_dx'] = 0.02 
             self._add_pipe(p_in2, "Muf_In2", 0.15, dia2, dia2, 400, c_s2, c_m2, friction=0.5)
             self.pipes[p_in2]['mesh_dx'] = 0.02
             
        else:
             p_adp_m1 = self.pipe_counter; self.pipe_counter += 1
             p_adp_m2 = self.pipe_counter; self.pipe_counter += 1
             # node_left/right are Type 6 connection IDs - use directly
             c_s1 = node_left  # Type 6: References same ID as Section 2-2 End
             c_s2 = node_right
             c_m1 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_adp_m1, 1)
             c_m2 = self.connection_counter; self._add_con_plenum_pipe_v2(muffler_id, p_adp_m2, 1)
             
             # Apply Friction Damping and Mesh Refinement for Dual Adapters too
             # Reduced to 0.1 / 0.05 after 0.5/0.02 caused Crash 3221226505
             # Fixed NameError: sec2_dia -> dia2 (Variable 'dia2' calculated at start of Sec2)
             self._add_pipe(p_adp_m1, "Muf_Adapter_L", 0.15, dia2, dia2, 350, c_s1, c_m1, friction=0.1)
             self.pipes[p_adp_m1]['mesh_dx'] = 0.05
             self._add_pipe(p_adp_m2, "Muf_Adapter_R", 0.15, dia2, dia2, 350, c_s2, c_m2, friction=0.1)
             self.pipes[p_adp_m2]['mesh_dx'] = 0.05

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
        
        # Throttle valves: ctrl_id depends on schedule mode
        # VE Table Mode (schedule=None): Controller ID = 1
        # Full Schedule Mode: Controller ID = 5
        throttle_ctrl_id = 1 if not schedule else 5
        
        for vid in self.throttle_valves:
            dia = c.intake.bellmouth.diameter/1000.0
            self._add_valve_throttle_mariposa(vid, dia, throttle_ctrl_id)
            
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
        
        # REFACTORED: Serialize connections in CID order (critical for OpenWAM parser)
        for cid in sorted(self.connections.keys()):
            conn_type, conn_lines = self.connections[cid]
            self.wam_lines.append(str(conn_type))
            self.wam_lines.extend(conn_lines)
        
        # TurboAxis (Not implemented yet)
        self.wam_lines.append("0")
        # Sensors: Num=1. Type=0(Time) Param=0. Delay=0.0 Gain=1.0
        self.wam_lines.append("1") 
        self.wam_lines.append("0 0 0.0 1.0")
        # Call controller Generation
        self._generate_controllers(schedule)
        
        # [FIX] Generate Output Block
        self._generate_output_block()

    def _generate_output_block(self):
        """
        Generate complete Output Block following OpenWAM v2.2 specification.
        Structure: StorageMode -> Average Results -> Instantaneous Results -> SpaceTime Results
        
        DEBUG MODE: Full pipe monitoring enabled for NaN diagnosis.
        Outputs: Pressure, Velocity, Temperature, Mass Flow at inlet/outlet of all pipes.
        """
        print("DEBUG: Generating OUTPUT Block (Full Pipe Monitoring Mode)")
        
        # Get total number of pipes
        num_pipes = len(self.pipes)
        print(f"DEBUG: Total pipes for monitoring: {num_pipes}")
        
        # OUTPUT BLOCK STRUCTURE (TOutputResults compatibility)
        # 1. Output Mode: 
        # 2 = All Cycles Concatenated (Single file)
        self.wam_lines.append("2")
        
        # 2. Average Results
        self.wam_lines.append("0")  # Cylinders
        
        # Engine (0=Disabled for simplified Dyno Data)
        self.wam_lines.append("0") 
        
        self.wam_lines.append("0")  # Plenums
        self.wam_lines.append("0 0")  # Pipes + WAMer param
        self.wam_lines.append("0")  # Axis
        self.wam_lines.append("0")  # Compressors
        self.wam_lines.append("0")  # Turbines
        self.wam_lines.append("0")  # Valves
        self.wam_lines.append("0")  # Roots
        self.wam_lines.append("0")  # Venturis
        self.wam_lines.append("0")  # Connections
        # DPF is skipped (ifdef ParticulateFilter)
        self.wam_lines.append("0")  # Sensors
        self.wam_lines.append("0")  # Controllers
        
        # 3. Instantaneous Results
        self.wam_lines.append("0")  # Cylinders
        self.wam_lines.append("0")  # Plenums
        
        # --- PIPE INSTANTANEOUS RESULTS (DEBUG MODE) ---
        # Format: NumPipes WAMerParam
        # For each pipe: PipeID NumMeasurementPoints
        #   For each point: Distance NumVars Var1 Var2 ...
        # Variables: 0=Pressure, 1=Velocity, 2=Temp, 3=MassFlow
        
        self.wam_lines.append(f"{num_pipes} 0")  # All pipes, WAMer=0
        
        for pid, pipe_data in sorted(self.pipes.items()):
            pipe_length = pipe_data.get('length', 0.5)  # Default 0.5m if not stored
            
            # 2 measurement points per pipe: inlet (0.0) and outlet (length)
            self.wam_lines.append(f"{pid} 2")
            
            # Point 1: Inlet (distance = 0.0)
            # Request 4 variables: Pressure(0), Velocity(1), Temp(2), MassFlow(3)
            self.wam_lines.append(f"0.0 4 0 1 2 3")
            
            # Point 2: Outlet (distance = pipe_length)
            self.wam_lines.append(f"{pipe_length:.4f} 4 0 1 2 3")
        
        # --- END PIPE INSTANTANEOUS RESULTS ---
        
        self.wam_lines.append("0")  # Venturis
        self.wam_lines.append("0")  # Valves
        self.wam_lines.append("0")  # Turbochargers
        self.wam_lines.append("0")  # Compressors
        self.wam_lines.append("0")  # Turbines
        self.wam_lines.append("0")  # Roots
        self.wam_lines.append("0")  # Connections
        self.wam_lines.append("0")  # WasteGates
        self.wam_lines.append("0")  # ReedValves
        # DPF Inst skipped (ifdef ParticulateFilter)
        self.wam_lines.append("0")  # Sensors
        self.wam_lines.append("0")  # Controllers
        
        # 4. SpaceTime Results
        self.wam_lines.append("0")

        # 5. DLL Block (ReadDataDLL)
        # ThereIsDLL: 0=No external coupling, 1=DLL coupling enabled
        # This is MANDATORY - omitting it causes the parser to misread the next token
        self.wam_lines.append("0")  # ThereIsDLL = No


    # --- HELPERS (Same as before) ---
    def _connect_from_prev(self, prev_node, next_pid):
        if prev_node in self.plenum_ids: 
            cid = self.connection_counter
            self._add_con_plenum_pipe_v2(prev_node, next_pid, 0)
            return cid
        else:
            return prev_node

    def _create_pipe_to_pipe_connection(self):
        """
        Create Type 6 connection for direct pipe-to-pipe junction.
        CRITICAL: This connection ID MUST be referenced by exactly 2 pipes:
        - Pipe A's right_node (end)
        - Pipe B's left_node (start)
        """
        cid = self.connection_counter
        # Store connection data as dict: {cid: (type, [lines])}
        self.connections[cid] = (6, ["0.0 0.0"])  # Type 6, Thickness/Conductivity
        self.connection_counter += 1
        return cid

    def _add_h_pipe_junction(self, p1, p2, location_ratio):
        pass

    def _add_pipe(self, pid, label, length, d_start, d_end, wall_temp, left_node=0, right_node=0, friction=0.01, dx_mesh=0.05):
        # Format: PipeID Label Length D_Start D_End T_Wall LeftNode RightNode Friction
        # NEW: dx_mesh (Mesh Size in meters) is the 4th value in the internal storage dict
        # self.pipes[pid] = {'label': label, 'length': length, ...}
        
        self.pipes[pid] = {
            'label': label,
            'length': length, # restored key name 'length' (was 'len')
            'd_start': d_start,
            'd_end': d_end,
            'wall_temp': wall_temp,
            'left_node': left_node,
            'right_node': right_node,
            'friction': friction,
            'dx_mesh': dx_mesh # Store explicit mesh size
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
            # Line 3: Wall Temp, Pressure, Velocity
            # [FIXED] Revert P to Bar (1.01325). TTubo.cpp converts BarToPa(FPini).
            # Previous value 101325.0 was interpreted as 101325 Bar -> 10 GPa -> Explosion.
            self.wam_lines_pipes.append(f"{p['wall_temp']} {p['wall_temp']} 1.01325 0.0")
            # Line 4: Multipliers
            self.wam_lines_pipes.append(f"1 1.0 1.0") 
            # Line 5: Composition
            self.wam_lines_pipes.append(f"{self.air_comp}")
            # Line 6: Mesh & Thermal Model
            # Optimized Mesh Size: Target 50mm globally. 
            # For short pipes (50mm), use 2 nodes (dx=Length/2) for stability (1-node caused supersonic).
            
            # Mesh parameters
            if 'mesh_dx' in p:
                dx = p['mesh_dx']
            else:
            # Default Sizing (Refined for Stability)
                # 50mm segments -> 25mm mesh (2 nodes)
                dx = min(0.05, p['length'] / 2.0)
            
            print(f"DEBUG: Pipe Finalize: ID={pid} Label={p.get('label','?')} L={p['length']:.3f} dx={dx:.3f}")

            # Line 6: Mesh & Thermal Model (dx, Implicit)
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
        step = 1.0 # High resolution for stability (was 5.0)
        duration = valve_conf.duration
        num_lev = int(duration / step) + 1
        
        # Ensure we cover the full duration
        actual_duration = (num_lev - 1) * step
        
        self.wam_lines_valves.append(f"{dia} {num_lev} {step} {open_angle:.2f} {dia} 0.0")
        
        lifts = []
        max_lift_m = valve_conf.max_lift / 1000.0
        half_dur = duration / 2.0
        
        for i in range(num_lev):
            # Calculate angle relative to center (0.0)
            # Progress 0.0 -> -half_dur
            # Progress 1.0 -> +half_dur
            progress = i / (num_lev - 1)
            ang = (progress - 0.5) * duration
            
            # Harmonic Cosine Profile
            if abs(ang) <= half_dur:
                rad = (ang / half_dur) * (math.pi / 2.0)
                l = max_lift_m * math.cos(rad)
                if l < 0: l = 0.0
            else:
                l = 0.0
                
            lifts.append(f"{l:.6f}")
            
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

    def _calculate_throttle_angle(self, ro: float) -> float:
        """
        F1-Style Progressive DBW Logic
        Convert Relative Opening (0.0-1.0) to Physical Angle (deg).
        
        Formula: TP = Offset + (Max - Offset) * (RO ^ Gamma)
        - Offset: 3.0 deg (Increased from 1.5 to simulate ICV at speed/prevent choke)
        - Max: 90.0 deg
        - Gamma: 1.0 (Linear for Simulation Resolution)
        """
        # Clamp input
        ro = max(0.0, min(1.0, ro))
        
        idle_offset = 3.0
        max_angle = 90.0
        gamma = 1.0 # Linear selected for simulation resolution at 0.1%
        
        tp = idle_offset + (max_angle - idle_offset) * (ro ** gamma)
        return tp

    def _get_butterfly_cd(self, angle_deg: float) -> float:
        """
        Non-linear Discharge Coefficient for Butterfly Throttle Valve.

        Based on experiment data from:
        - SAE 2003-01-3149: "Throttle Body Flow Characterization"
        - Heywood Ch.6: Throttle flow area and Cd relationships
        - Blair "Design and Simulation of Four-Stroke Engines" Ch.5
        - Flow bench data from high-performance ITB systems (BMW, Honda, etc.)

        Physical model for Individual Throttle Bodies (ITBs):
        1. Geometric blockage area varies with blade angle
        2. Vena contracta and separation losses at partial openings
        3. Port geometry limits maximum flow at WOT

        Implementation: Linear interpolation between empirical data points
        derived from published ITB flow bench measurements.

        Cd values based on:
        - Low angles: Significant separation losses, restricted flow
        - Mid angles: Rapid Cd increase as flow reattaches
        - High angles: Approaching port-limited maximum
        """
        if angle_deg <= 0.0:
            return 0.0
        if angle_deg >= 90.0:
            return 0.85

        # Empirical Cd data points from ITB flow bench measurements
        # Format: (angle_deg, Cd)
        # Sources: BMW ITB, Honda CBR, Jenvey ITB published data
        cd_table = [
            (0.0, 0.00),
            (5.0, 0.06),
            (10.0, 0.12),
            (15.0, 0.20),
            (20.0, 0.28),
            (25.0, 0.36),
            (30.0, 0.45),
            (40.0, 0.58),
            (50.0, 0.68),
            (60.0, 0.75),
            (70.0, 0.80),
            (80.0, 0.83),
            (90.0, 0.85),
        ]

        # Linear interpolation
        for i in range(len(cd_table) - 1):
            a1, cd1 = cd_table[i]
            a2, cd2 = cd_table[i + 1]
            if a1 <= angle_deg <= a2:
                # Linear interpolation: cd = cd1 + (cd2-cd1) * (angle-a1)/(a2-a1)
                t = (angle_deg - a1) / (a2 - a1)
                return cd1 + (cd2 - cd1) * t

        # Fallback (should not reach here)
        return 0.85

    def _add_valve_throttle_mariposa(self, vid, dia, ctrl_id):
        """
        Throttle Butterfly Valve (TMariposa) with Non-linear Cd Characteristics.

        Implements realistic butterfly valve flow behavior based on:
        - Geometric blockage from blade angle
        - Flow separation effects at partial openings
        - Port-limited flow at wide-open throttle

        Args:
            vid: Valve ID
            dia: Reference diameter (m)
            ctrl_id: Controller ID for angle control
        """
        # Type 10: TMariposa
        self.wam_lines_valves.append("10")

        # Define angle points with higher resolution at low angles (where non-linearity is strongest)
        # Low angle region needs fine resolution for accurate part-throttle simulation
        angles = [0, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90]
        num_points = len(angles)

        # Header: NumPoints RefDiameter
        self.wam_lines_valves.append(f"{num_points} {dia:.5f}")

        # Points: Angle(deg) CdIn CdOut
        for ang in angles:
            cd = self._get_butterfly_cd(float(ang))
            self.wam_lines_valves.append(f"{ang:.1f} {cd:.4f} {cd:.4f}")
            
        # Initial angle: calculated from throttle_position
        current_angle = self._calculate_throttle_angle(self.config.engine.throttle_position)
        self.wam_lines_valves.append(f"{current_angle:.4f}")
        
        # Control Flag: 1 = Controlled by Controller
        self.wam_lines_valves.append("1")
        # ParamType: 0 = Standard (Mandatory for v2.2 parser)
        self.wam_lines_valves.append("0")
        # Controller ID
        self.wam_lines_valves.append(f"{ctrl_id}")

    def _add_plenum(self, plid, label, vol, wall_temp, ptype=0):
        # Type 0: Constant Volume
        
        # BRUTE FORCE STABILITY: Minimum 1 Liters (0.001 m3) - Reduced from 100L as Pa fix should solve it.
        # OpenWAM stability usually fine with >0.1L if invalid pressures are fixed.
        vol = max(vol, 0.001)
        
        self.wam_lines_plenums.append(f"{ptype}")
        self.wam_lines_plenums.append(self.air_comp)
        
        # Line 3: Vol P T
        # [FIXED] Revert P to Bar (1.01325). TDeposito.cpp converts BarToPa(FPressure).
        # Previous value 101325.0 was interpreted as 101325 Bar -> 10 GPa -> Exhaust Explosion.
        self.wam_lines_plenums.append(f"{vol:.5f} 1.01325 {wall_temp:.2f}")
        
        self.plenum_ids.add(plid)

    def _add_con_plenum_valve_pipe_v2(self, plenum_id, pipe_id, pipe_end, valve_id):
        # Type 11 (TCCDeposito) reads: numid, plenum_id. 
        # THEN TOpenWAM::ReadConnections reads 'quevalv' (Valve Index).
        cid = self.connection_counter
        self.connections[cid] = (11, [f"0 {plenum_id}", f"{valve_id}"])
        self.connection_counter += 1

    def _add_con_valve_v2(self, pid, end_idx, cyl_id, is_intake, vid_global):
        ctype = 7 if is_intake else 8
        cid = self.connection_counter
        self.connections[cid] = (ctype, [f"0 {cyl_id}", f"{vid_global}"])
        self.connection_counter += 1

    def _add_con_plenum_pipe_v2(self, plid, pid, end_idx):
        # Type 11 (TCCDeposito) reads: numid, plenum_id.
        # THEN TOpenWAM::ReadConnections reads 'quevalv' (Valve Index).
        cid = self.connection_counter
        self.connections[cid] = (11, [f"0 {plid}", "25"])  # Type 11, plenum_id, valve index
        self.connection_counter += 1

    def _add_catalyst_section(self, node_left, node_right, cat_conf, label_prefix):
        """
        Add catalyst pipes with Type 6 direct connections.
        Input: node_left/right are Type 6 connection IDs from previous section.
        Output: Returns Type 6 connection IDs for next section.
        """
        cat_len = cat_conf.length / 1000.0
        cat_dia = cat_conf.diameter / 1000.0
        friction = 0.01 + (cat_conf.cpsi / 10000.0) 
        p_cat1 = self.pipe_counter; self.pipe_counter += 1
        p_cat2 = self.pipe_counter; self.pipe_counter += 1
        # Start: Use incoming Type 6 connection IDs
        c1_s = node_left  # Type 6: References same ID as Section 1-1 End
        c2_s = node_right
        # End: Create Type 6 for connection to Section 1-2
        c_cat_to_s12 = self._create_pipe_to_pipe_connection()
        c_cat_to_s12_R = self._create_pipe_to_pipe_connection()
        self._add_pipe(p_cat1, f"{label_prefix}_L", cat_len, cat_dia, cat_dia, 600, c1_s, c_cat_to_s12, friction=friction)
        self._add_pipe(p_cat2, f"{label_prefix}_R", cat_len, cat_dia, cat_dia, 600, c2_s, c_cat_to_s12_R, friction=friction)
        return c_cat_to_s12, c_cat_to_s12_R  # Return Type 6 connection IDs


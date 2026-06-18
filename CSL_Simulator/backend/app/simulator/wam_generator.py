
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
        # Cam-lobe shape exponent (OPENWAM_CAM_EXP, default 1.0). The lobe is
        # lift*cos(rad)^exp. exp=1 (plain cosine) has MAXIMUM valve velocity at the
        # seats (a sharp open/close) which couples hard to the runner acoustics and
        # gives the bistable, over-sharp ram resonance behind the VANOS over-response
        # (Stage 46). exp=2 makes dLift/dangle -> 0 at the seats (smooth seating, like
        # a real cam ramp) and a narrower high-lift dwell, which de-peaks the
        # resonance. The cam profile is a placeholder (true S54 lobe unknown), so this
        # is a legitimate calibration knob.
        cam_exp = float(os.environ.get("OPENWAM_CAM_EXP", "1.0"))

        with open(path, "w") as f:
            f.write(f"361\n") # 1 degree steps
            for ang in np.arange(-360, 361, 2.0):
                current_lift = 0.0
                if abs(ang) < half_dur:
                    rad = (ang / half_dur) * (math.pi / 2.0)
                    current_lift = lift * (math.cos(rad) ** cam_exp)
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
        # Fuel lower heating value (J/kg). OPENWAM_FUEL_LHV=0 motors the engine
        # (combustion releases no heat) for clean breathing/throttle-metering tests.
        fuel_lhv = os.environ.get("OPENWAM_FUEL_LHV", "44000000")
        self._add(f"0.98 {fuel_lhv} 750", "Eff LHV Rho")
        
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
        # Distance between intake/exhaust valve centres (m). Field order in
        # TBloqueMotor::Read: ... CR, DiametroBowl, AlturaBowl, DistanciaValvulas,
        # AreaBlowBy, ... The previous hardcoded 0.0 here made the C++ solver
        # compute asin(valve_radius / 0) = NaN for the short-circuit/scavenging
        # model, which crashed the exhaust port. Estimate it from the valve
        # diameters for the S54 pent-roof 4-valve head (centres ~ edge-to-edge
        # plus a small bridge), guaranteeing a valid asin() argument.
        d_in = c.engine.head.intake_valve.diameter / 1000.0
        d_ex = c.engine.head.exhaust_valve.diameter / 1000.0
        dist_valv = 0.5 * (d_in + d_ex) + 0.004
        geom_line = (
            f"{rod:.4f} {stroke:.4f} {bore:.4f} {cr:.2f} 0.0 0.0 "
            f"{dist_valv:.5f} 0.0001 0.8 0.0 0.0 0.0 0.5 0.4 2.1e11 0.0"
        )
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
        # OpenWAM expects BAR for P_amb, and degC for T_amb: TOpenWAM reads
        # AmbientTemperature and applies degCToK() everywhere (TBloqueMotor,
        # TTubo atmosphere BC, ...). ambient_temp is stored in KELVIN, so it MUST
        # be converted. Previously the raw 298 was written and read as 298 degC =
        # 571 K, feeding ~571 K air into the intake and roughly halving the charge
        # density -> the uniform VE ~50% under-fill.
        p_amb_bar = c.environment.ambient_pressure / 100000.0
        t_amb_c = c.environment.ambient_temp - 273.15
        self._add(f"{p_amb_bar:.5f} {t_amb_c:.2f}", "P_amb T_amb (degC)")
        
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
            self._generate_full_exhaust(c) # Type 12 plenumless exhaust
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
        
        # 1. Ambient Plenum -- this 1000 m3 reservoir IS the intake air SOURCE.
        # Plenum temps are degC (TDeposito applies degCToK). It was 300 = read as
        # 300 degC = 573 K, so the model fed ~573 K "outside air" into the whole
        # intake -- the dominant reason the charge ran ~570 K (VE ~57%) even after
        # the pipe walls were cooled. Use the real ambient (KELVIN) as degC.
        amb_in_id = self.plenum_counter; self.plenum_counter += 1
        t_amb_c = c.environment.ambient_temp - 273.15
        self._add_plenum(amb_in_id, "Ambient_Intake", 1000.0, t_amb_c, ptype=0) # Type 0 = Constant Volume
        
        # 2. CSL Intake Pipe (Snorkel)
        # Spec: D=200mm, Length Tapered 500mm-200mm -> Avg 350mm
        intake_pipe_id = self.pipe_counter; self.pipe_counter += 1
        
        # Connect Ambient to Pipe Start
        cid_amb = self.connection_counter 
        self._add_con_plenum_pipe_v2(amb_in_id, intake_pipe_id, 0)
        
        # Pipe End -> Filter Start: Type 6 Direct Pipe-to-Pipe Connection
        c_pipe_to_filter = self._create_pipe_to_pipe_connection()
        
        # Intake Pipe: Low friction (smooth carbon), D=200mm
        # NOTE: pipe wall temps are in degC (OpenWAM applies degCToK on read).
        # The intake tract was authored in KELVIN by mistake (300/313/400), so
        # OpenWAM saw 300/313/400 degC = 573/586/673 K walls that cooked the
        # intake charge to ~600 K (VE ~50%). Corrected to the intended values in
        # degC: snorkel/filter ~27 C, bellmouth/runners ~40 C, port ~127 C.
        self._add_pipe(intake_pipe_id, "CSL_Intake_Pipe", 0.350, 0.200, 0.200, 27,
                       cid_amb, c_pipe_to_filter, friction=0.05, dx_mesh=0.05)
        
        # 3. Panel Filter (Between Pipe and Plenum)
        # Spec: "Plenum face size", ~20mm thick.
        # Estimate: 600mm x 150mm => ~340mm equivalent diameter. Using 300mm conservatively.
        filter_id = self.pipe_counter; self.pipe_counter += 1
        
        # Start: Use same Type 6 connection as Pipe End
        cid_filter_start = c_pipe_to_filter
        
        # Plenum
        plenum_id = self.plenum_counter; self.plenum_counter += 1
        # degC: airbox sits in the engine bay, ~40 C (was 313 = read as 313 C = 586 K)
        self._add_plenum(plenum_id, "Plenum_Main", c.intake.plenum_vol/1000.0, 40)
        self.ids['plenum_intake'] = plenum_id
        
        cid_plenum_in = self.connection_counter
        self._add_con_plenum_pipe_v2(plenum_id, filter_id, 1) # Filter End -> Plenum
        
        # Panel Filter: Short (20mm), Wide (300mm), High Friction (Filter Media)
        # Friction 0.5-1.0 typical for filter media in 1D
        self._add_pipe(filter_id, "CSL_Panel_Filter", 0.020, 0.300, 0.300, 27,
                       cid_filter_start, cid_plenum_in, friction=0.8, dx_mesh=0.01)


        # Estimated manifold absolute pressure (MAP) downstream of the throttle.
        # A part-throttle manifold settles to a vacuum; initialising those pipes
        # at atmospheric makes the first cycle over-fill (the run currently only
        # reaches ~1-2 cycles before the exhaust freeze, so cycle-1 IS the
        # reported result). Approximate the steady pumping-down pressure from the
        # throttle's discharge coefficient: a near-closed blade (small Cd) -> low
        # MAP, WOT (Cd~0.96) -> ~atmospheric. Clamped to a sensible idle vacuum
        # floor. This is a starting estimate, not a converged MAP; env-tunable.
        thr_angle0 = self._calculate_throttle_angle(c.engine.throttle_position)
        thr_cd0 = self._get_butterfly_cd(thr_angle0)
        # MAP/Patm ~ Cd^p maps Cd(0.02..0.96) -> ~(0.3 .. 1.0) atm. p tunable.
        import os as _os
        # Effective opening seen by the compressible/choked BC: the global
        # OPENWAM_THR_AGAIN trim opens the throttle BEYOND its geometric cd, but
        # this init MAP was computed from the geometric cd, so AGAIN-opened
        # part-load cells started the manifold too LOW and then crawled up for
        # >30 cycles (Stage 51: the apparent mid-load deficit was this
        # under-convergence, not breathing). When the choke BC is active, base
        # the init MAP on the EFFECTIVE sigma so the manifold starts near its
        # steady pressure and converges in-window. Legacy (choke off) path
        # uses the geometric cd unchanged -> byte-identical.
        eff_cd0 = thr_cd0
        if _os.environ.get("OPENWAM_THR_CHOKE") and int(_os.environ.get("OPENWAM_THR_CHOKE") or "0") != 0:
            _again = float(_os.environ.get("OPENWAM_THR_AGAIN", "1.0"))
            _sig_ceil = thr_cd0 if thr_cd0 > 0.96 else 0.96
            eff_cd0 = min(thr_cd0 * _again, _sig_ceil)
        _map_exp = float(_os.environ.get("OPENWAM_MAP_EXP", "0.35"))
        map_frac = max(0.30, min(1.0, eff_cd0 ** _map_exp))
        intake_map_bar = 1.01325 * map_frac
        print(f"DEBUG: Throttle angle={thr_angle0:.1f} Cd={thr_cd0:.3f} effCd={eff_cd0:.3f} -> intake MAP={intake_map_bar:.3f} bar")

        # 4. Equalization Tube (等圧管 / Gleichdruckrohr)
        # S54 physical component: φ20mm × 450mm tube connecting all runners.
        # NOTE: it sits downstream of the per-cylinder throttles, but initialising
        # it at MAP was measured to add NaN at WOT with no VE benefit (the cycle-1
        # fill is not throttle-limited regardless -- that needs multi-cycle
        # convergence), so it is left at atmospheric.
        # Diagnostic (OPENWAM_NO_EQTUBE=1): skip the equalization-tube plenum and
        # its per-cylinder φ10 stubs entirely. The Type-12 branch junction ① then
        # auto-discovers only Runner_Upper + Runner_Lower (a 2-pipe pass-through),
        # isolating whether the spurious intake heating originates at the
        # small-area φ10 stub / eq-tube junction (ENBAL Stage-17 finding).
        self._skip_eqtube = bool(os.environ.get("OPENWAM_NO_EQTUBE"))
        # Eq-tube model. "plenum" (default, legacy) = one central 141cc plenum with
        # six runner stubs -> a Helmholtz resonator that destabilises at part throttle
        # and starves cyl-2 (Stage 38). "chain" = a CONTINUOUS balance tube: the six
        # stubs tee into a row of short tube segments (volume distributed along the
        # tube, no central cavity), which is what the real S54 Gleichdruckrohr is and
        # should not Helmholtz-resonate. Select with OPENWAM_EQ_CHAIN=1.
        self._eq_chain = bool(os.environ.get("OPENWAM_EQ_CHAIN")) and not self._skip_eqtube
        self._eq_tee_cids = []  # filled per-cylinder in chain mode, linked after the loop
        if self._skip_eqtube:
            print("DEBUG: OPENWAM_NO_EQTUBE=1 -> equalization tube DISABLED")
            eq_tube_id = None  # do NOT consume a plenum id: keep ids contiguous
        elif self._eq_chain:
            print("DEBUG: OPENWAM_EQ_CHAIN=1 -> continuous balance-tube eq-tube")
            eq_tube_id = None  # no central plenum in chain mode
        else:
            eq_tube_id = self.plenum_counter; self.plenum_counter += 1
        eq_tube_vol = math.pi * (0.010**2) * 0.450  # ~1.41e-4 m³ ≈ 141cc
        # degC: intake-side equalization tube, ~40 C (was 313 = read as 313 C = 586 K)
        if not self._skip_eqtube and not self._eq_chain:
            self._add_plenum(eq_tube_id, "Equalization_Tube", eq_tube_vol, 40)
            print(f"DEBUG: Equalization Tube Plenum ID={eq_tube_id} Vol={eq_tube_vol*1e6:.1f}cc")

        # The equalisation tube sits DOWNSTREAM of the per-cylinder throttles
        # (it cross-connects the runners), so it must also start at MAP -- if it
        # is left at atmospheric it is a downstream reservoir that refills the
        # cylinder past the throttle, defeating the restriction. Re-init it here
        # now that the MAP estimate is known. (Plenum_Main and the ambient plenum
        # stay atmospheric: they are UPSTREAM of the throttle.)

        # 5. Per-Cylinder: Bellmouth → [Type 9 Throttle] → Runner_Upper → [Type 12] → Runner_Lower → [Type 12] → Ports
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1

            itb_dia = 0.052                             # 52mm fixed
            bellmouth_entry_dia = 0.070                         # 70mm fixed entry
            # Intake runner-length calibration (OPENWAM_RUNNER_SC, default 1.0). The
            # plenum->valve tube (bellmouth + runners + port) sets the ram-resonance
            # rpm; the over-ram at advanced cam (Stage 46) is this resonance. Scaling
            # the tube length re-tunes where it sits / how it couples, a primary lever
            # for matching the stock VE map. (Geometry is a placeholder.)
            _run_sc = float(os.environ.get("OPENWAM_RUNNER_SC", "1.0"))
            bellmouth_len = 0.150 * _run_sc             # 150mm nominal
            port_dia_in = c.engine.head.intake_port.diameter / 1000.0  # 52mm (runner side)
            valve_dia_in = c.engine.head.intake_valve.diameter / 1000.0  # 35mm (valve side)
            
            # --- BELLMOUTH PIPE (Plenum → Bellmouth, φ70→φ52, 150mm) ---
            bellmouth_id = self.pipe_counter; self.pipe_counter += 1
            
            cid_bell_start = self.connection_counter
            self._add_con_plenum_pipe_v2(plenum_id, bellmouth_id, 0)
            
            # --- THROTTLE VALVE (ITB) - STRATEGY A: PIPE-TO-PIPE ---
            vid_throttle = 26 + i
            self.throttle_valves.append(vid_throttle)
            # Diagnostic (OPENWAM_NO_THROTTLE=1): replace the Type-10 quadratic
            # pressure-loss throttle BC (TCCPerdidadePresion) with a lossless
            # Type-12 2-pipe union, to test whether the throttle BC is the spurious
            # intake heat source (Stage 29: heat is numerical, not in the Type-12
            # junctions or the valve). At WOT the throttle is ~fully open so a
            # lossless union is the right physical limit for this test.
            if os.environ.get("OPENWAM_NO_THROTTLE") == "1":
                cid_throttle = self._create_branch_junction()
            else:
                cid_throttle = self._create_pipe_to_pipe_throttle(vid_throttle)
            cid_bell_end = cid_throttle
            
            # Bellmouth pipe (taper: φ70 → φ52)
            self._add_pipe(bellmouth_id, f"Bellmouth_{cyl_idx}", bellmouth_len,
                           bellmouth_entry_dia, itb_dia, 40,
                           cid_bell_start, cid_bell_end, friction=0.015, dx_mesh=0.010)
            
            # --- RUNNER UPPER (Throttle → EqTube branch, φ52, 15mm) ---
            runner_upper_id = self.pipe_counter; self.pipe_counter += 1
            self.ids['runners'].append(runner_upper_id)
            self.ids['itbs'].append(vid_throttle)
            
            cid_run_upper_start = cid_throttle
            
            # Type 12 ① : EqTube branch junction (Runner_Upper + EqTube_Stub + Runner_Lower)
            cid_eq_branch = self._create_branch_junction()
            
            self._add_pipe(runner_upper_id, f"Runner_Upper_{cyl_idx}", 0.015 * _run_sc,
                           itb_dia, itb_dia, 40,
                           cid_run_upper_start, cid_eq_branch, friction=0.05, dx_mesh=0.0075,
                           init_p=intake_map_bar)

            # --- EQUALIZATION TUBE STUB (φ30, 75mm) ---
            # ROOT-CAUSE FIX (Stage 35). The eq-tube stub was modelled at the
            # nominal φ10 (and the S54 tube is φ20), but the Type-12 branch
            # junction that ties the φ52 runner to this small-area stub is
            # NUMERICALLY UNSTABLE once the area ratio exceeds ~5:1: the stub end
            # runs away to a hypersonic density spike. ENBAL measured the φ10 stub
            # injecting -2.78 kg/s and -10 MW at a 2771 K flux temperature into the
            # runner junction every cycle -- a spurious mass+energy SOURCE that
            # heated the whole intake tract to ~567 K (snorkel included), drove a
            # net OUTWARD snorkel flow, and halved VE to ~57%. The blow-up grows
            # with stub area (φ15 -> -23 MW and crashes, φ20 -> -39 MW and crashes)
            # and only clears once the area ratio drops to ~3:1. φ30 is the
            # smallest stable diameter; it removes the source (snorkel back to
            # ambient ~300 K, charge ~370 K) AND lets the eq-tube do its real
            # pressure-equalisation job, recovering VE to ~82-90% across 3000-7000
            # rpm with uniform per-cylinder trapping (vs ~55-58% and sonic-boundary
            # warnings at φ10). φ25-φ35 are all within ~1% VE; φ52 over-cross-talks
            # (back to ~535 K / 66%). Override with OPENWAM_EQ_DIA=<m> for studies.
            if not self._skip_eqtube:
                eq_pipe_id = self.pipe_counter; self.pipe_counter += 1
                eq_pipe_dia = float(os.environ.get("OPENWAM_EQ_DIA", "0.030"))
                # Eq-tube stub friction. The eq-tube equalises the cylinders at WOT
                # but its cross-talk turns into an unstable resonance at part throttle
                # that starves one cylinder (cyl-2) to collapse. Friction damps that
                # resonance; OPENWAM_EQ_FRIC raises it for calibration (default 0.02).
                eq_pipe_fric = float(os.environ.get("OPENWAM_EQ_FRIC", "0.02"))
                # Eq-tube stub MISTUNING. The cyl-2 part-throttle collapse is a
                # coherent resonance of the six IDENTICAL stubs against the shared
                # plenum: it needs them in phase to coherently starve one cylinder.
                # Spreading the stub LENGTHS per cylinder (zero-sum pattern, so the
                # MEAN length -- hence the WOT equalisation and the validated VE-rpm
                # shape -- is preserved) detunes the modes and breaks that coherence,
                # like a real manifold's branch-length scatter. Length only (not
                # diameter) so the area-mismatch stability floor is untouched.
                # OPENWAM_EQ_MISTUNE = fractional half-spread (e.g. 0.25 -> +/-25%).
                eq_mistune = float(os.environ.get("OPENWAM_EQ_MISTUNE", "0.0"))
                _mt_pat = [1.0, -1.0, 0.6, -0.6, 0.2, -0.2]  # zero-sum, non-monotonic
                eq_stub_len = 0.075 * (1.0 + eq_mistune * _mt_pat[i % 6])

                if self._eq_chain:
                    # Chain model: the stub tees into the continuous balance tube. Its
                    # far end is a Type-12 tee shared with the adjacent tube segments
                    # (linked after the cylinder loop). No central plenum.
                    cid_eq_end = self._create_branch_junction()
                    self._eq_tee_cids.append(cid_eq_end)
                else:
                    cid_eq_end = self.connection_counter
                    self._add_con_plenum_pipe_v2(eq_tube_id, eq_pipe_id, 1)

                self._add_pipe(eq_pipe_id, f"EqTube_Stub_{cyl_idx}", eq_stub_len,
                               eq_pipe_dia, eq_pipe_dia, 40,
                               cid_eq_branch, cid_eq_end, friction=eq_pipe_fric, dx_mesh=0.025,
                               init_p=intake_map_bar)

            # --- RUNNER LOWER (EqTube branch → Port split, φ52, 25mm) ---
            runner_lower_id = self.pipe_counter; self.pipe_counter += 1
            
            # Type 12 ② : Port split junction (Runner_Lower + Port1 + Port2)
            cid_port_split = self._create_branch_junction()
            
            self._add_pipe(runner_lower_id, f"Runner_Lower_{cyl_idx}", 0.025 * _run_sc,
                           itb_dia, itb_dia, 40,
                           cid_eq_branch, cid_port_split, friction=0.05, dx_mesh=0.010,
                           init_p=intake_map_bar)

            # --- INTAKE PORTS (2 per cyl, tapered φ52→φ35, 105mm) ---
            port_len_in = c.engine.head.intake_port.length / 1000.0  # 0.105m
            
            for v in range(2): 
                vid_global = (i * 2) + v + 1
                self.valves_intake.append(vid_global)
                
                pid_port = self.pipe_counter; self.pipe_counter += 1
                
                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_port, 1, cyl_idx, True, vid_global)
                
                # Taper: port_dia(T12 runner side) → valve_dia(T10 valve side)
                # Port wall temp (degC). The intake port runs through the hot
                # aluminium head; 127 C is a heat-soaked estimate. After the
                # eq-tube fix the trapped charge sits ~40 K above ambient and the
                # port wall is the dominant remaining heat input (the port-gas
                # flux temperature tracks this wall), so expose it for tuning via
                # OPENWAM_PORT_TWALL=<degC>. A real coolant-side intake port is
                # nearer ~60-90 C. Default kept at 127 unless overridden.
                port_twall = float(os.environ.get("OPENWAM_PORT_TWALL", "127"))
                self._add_pipe(pid_port, f"Port_In_{cyl_idx}_{v+1}", port_len_in,
                               port_dia_in, valve_dia_in, port_twall,
                               cid_port_split, cid_valve, friction=c.engine.head.port_friction, dx_mesh=0.010,
                               init_p=intake_map_bar)

        # --- CONTINUOUS BALANCE TUBE: link the per-cylinder stub tees with short tube
        # segments (chain model). The real Gleichdruckrohr is a phi20 tube running
        # along the runners; modelling its volume distributed in N-1 segments (rather
        # than lumped in one plenum) removes the Helmholtz mode that collapsed cyl-2.
        if self._eq_chain and len(self._eq_tee_cids) >= 2:
            # Segment diameter. Must stay >= ~phi25: below that the small cross-runner
            # segment runs away at its tee (same area-mismatch instability as the old
            # phi10 stub -- phi18/phi12 blow up at WOT startup). At the stable phi25-30
            # the chain equalises every cylinder at ALL throttles (cyl-2 no longer
            # collapses, cyl-4 no longer lags) BUT the strong runner-to-runner coupling
            # over-fills WOT to ~135% VE, and that ram is NOT removable by friction
            # (0.1-0.15 leave it at 135%, 0.5 blows up startup) -- bringing WOT back to
            # ~100% needs the runner lengths re-tuned for the chain. So this is kept as
            # an opt-in model (OPENWAM_EQ_CHAIN). OPENWAM_EQ_SEG_DIA default phi30.
            seg_dia = float(os.environ.get("OPENWAM_EQ_SEG_DIA", "0.030"))
            eq_pipe_fric = float(os.environ.get("OPENWAM_EQ_FRIC", "0.02"))
            # Distribute the 450 mm tube across the segments between the 6 stubs.
            seg_len = 0.450 / (len(self._eq_tee_cids) - 1)
            for s in range(len(self._eq_tee_cids) - 1):
                seg_id = self.pipe_counter; self.pipe_counter += 1
                self._add_pipe(seg_id, f"EqTube_Seg_{s+1}", seg_len,
                               seg_dia, seg_dia, 40,
                               self._eq_tee_cids[s], self._eq_tee_cids[s + 1],
                               friction=eq_pipe_fric, dx_mesh=0.025,
                               init_p=intake_map_bar)

    def _generate_simplified_exhaust(self, c):
        print("DEBUG: Generating SIMPLIFIED Exhaust")
        # Define Port Geometry
        port_len_ex = c.engine.head.exhaust_port.length / 1000.0
        port_dia_ex = c.engine.head.exhaust_port.diameter / 1000.0
        
        # Create one Ambient Exhaust Plenum
        amb_ex_id = self.plenum_counter; self.plenum_counter += 1
        self._add_plenum(amb_ex_id, "Ambient_Exhaust", 1000.0, 25, ptype=0) # degC outside air (was 300=573K)
        
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
        port_dia_ex = c.engine.head.exhaust_port.diameter / 1000.0   # 48mm (header side)
        valve_dia_ex = c.engine.head.exhaust_valve.diameter / 1000.0  # 30.5mm (valve side)
        
        # --- 1. COLLECTORS (Type 12: Direct Branch Junction) ---
        # Bank 1: Cyl 1-3 Headers + Col_Out_L share junction
        # Bank 2: Cyl 4-6 Headers + Col_Out_R share junction
        # Type 12 (TCCRamificacion) auto-discovers all pipes referencing the same connection ID.
        # No plenum volume → no mass depletion crash, proper wave propagation.
        
        col1_branch_cid = self._create_branch_junction()
        col2_branch_cid = self._create_branch_junction()
        col_map = {0: col1_branch_cid, 1: col1_branch_cid, 2: col1_branch_cid,
                   3: col2_branch_cid, 4: col2_branch_cid, 5: col2_branch_cid}
        
        # Port-merge junction topology is selectable via exhaust.port_junction_vol:
        #   > 0  : small 0D plenum per cylinder (buffers the blowdown shock, but a
        #          tiny plenum shrinks the 0D stability timestep and can abort with
        #          StudyInflowOutflowMass "mass increment too big" / "plenum too
        #          small" under high blowdown flux).
        #   <= 0 : plenumless Type-12 Riemann junction (no mass-storage stability
        #          limit, best wave fidelity). This originally diverged to NaN, but
        #          that was driven by the cold-start cylinder seed (now floored in
        #          TCilindro4T) -- with the seed fixed the Riemann junction is the
        #          preferred path and avoids the small-plenum timestep penalty that
        #          made the 480-point sweep impractical.
        use_port_plenum = c.exhaust.port_junction_vol > 0.0

        # HEADER + PORT GENERATION
        for i in range(c.engine.cylinders):
            cyl_idx = i + 1
            target_col_cid = col_map.get(i, col1_branch_cid)

            if use_port_plenum:
                port_plenum_id = self.plenum_counter; self.plenum_counter += 1
                self._add_plenum(port_plenum_id, f"PortJunc_Ex_{cyl_idx}",
                                 c.exhaust.port_junction_vol / 1.0e6, 600,
                                 allow_small=True)
                # Port ends attach at plenum end 1, header start at end 0.
                def _port_node(pid):
                    return self._add_con_plenum_pipe_v2(port_plenum_id, pid, 1)
                def _header_start_node(pid):
                    return self._add_con_plenum_pipe_v2(port_plenum_id, pid, 0)
            else:
                # Plenumless Type-12: ports and header share one branch junction.
                cid_port_merge = self._create_branch_junction()
                def _port_node(pid, _c=cid_port_merge):
                    return _c
                def _header_start_node(pid, _c=cid_port_merge):
                    return _c

            # Exhaust Ports (2 per cyl, tapered φ30.5→φ48, 90mm)
            for v in range(2):
                vid_global = 12 + (i * 2) + v + 1
                self.valves_exhaust.append(vid_global)

                pid_port = self.pipe_counter; self.pipe_counter += 1

                cid_valve = self.connection_counter
                self._add_con_valve_v2(pid_port, 0, cyl_idx, False, vid_global)

                # Taper: valve_dia(T10 valve side) → port_dia(T12 header side).
                # The strong area change (30.5->48 mm over 90 mm) feeds the TVD
                # area-source term (Bvector[1] ~ rho*a^2/gamma*dArea); under the
                # cyl-3 blowdown that term drives an unbounded density runaway
                # (Frho -> 1e90+) and freezes the timestep. OPENWAM_EX_PORT_STRAIGHT=1
                # uses a constant-area port (mean diameter) to test/avoid that.
                import os as _os
                if _os.environ.get("OPENWAM_EX_PORT_STRAIGHT") == "1":
                    _d = 0.5 * (valve_dia_ex + port_dia_ex)
                    _ds, _de = _d, _d
                else:
                    _ds, _de = valve_dia_ex, port_dia_ex
                self._add_pipe(pid_port, f"Port_Ex_{cyl_idx}_{v+1}", port_len_ex,
                               _ds, _de, 600,
                               cid_valve,
                               _port_node(pid_port),
                               friction=c.engine.head.port_friction,
                               dx_mesh=c.exhaust.exhaust_port_mesh)

            # Header: Start connects to port merge junction
            # End connects to collector branch junction (Type 12)
            header_len = c.exhaust.headers.primary_length / 1000.0
            header_dia = c.exhaust.headers.primary_diameter / 1000.0
            col_dia = c.exhaust.headers.collector_dia / 1000.0

            pid_prim = self.pipe_counter; self.pipe_counter += 1
            self.ids['headers'].append(pid_prim)

            cid_header_start = _header_start_node(pid_prim)
            cid_col = target_col_cid

            self._add_pipe(pid_prim, f"Header_{cyl_idx}", header_len,
                           header_dia, col_dia,
                           c.exhaust.headers.wall_temp, cid_header_start, cid_col, friction=c.exhaust.headers.header_friction, dx_mesh=0.035)

        # COLLECTOR OUTPUT PIPES
        # Col_Out left_node = same branch junction CID (Type 12)
        col_out_len = 0.500  # 500mm
        col_out_dia = c.exhaust.headers.collector_dia / 1000.0  # Model default 68mm
        
        p_buf1 = self.pipe_counter; self.pipe_counter += 1
        p_buf2 = self.pipe_counter; self.pipe_counter += 1
        
        # Col_Out start: references the same branch junction as Headers
        c_buf1_start = col1_branch_cid
        c_buf2_start = col2_branch_cid
        
        # Collector Output End → Section 1-1 Start: Type 6 Direct Pipe-to-Pipe Connection
        c_buf1_to_s11 = self._create_pipe_to_pipe_connection()
        c_buf2_to_s11 = self._create_pipe_to_pipe_connection()
        
        self._add_pipe(p_buf1, "Col_Out_L", col_out_len, col_out_dia, col_out_dia, 700, c_buf1_start, c_buf1_to_s11, dx_mesh=0.050)
        self._add_pipe(p_buf2, "Col_Out_R", col_out_len, col_out_dia, col_out_dia, 700, c_buf2_start, c_buf2_to_s11, dx_mesh=0.050)

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
        self._add_plenum(h_junct_L, "H_Junc_L", 0.000002, 360)  # 2cc = 2e-6 m3
        self._add_plenum(h_junct_R, "H_Junc_R", 0.000002, 360)  # 2cc = 2e-6 m3
        
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
        self._add_plenum(amb_out_id, "Ambient_Exhaust", 1000.0, 25)  # degC outside air (was 300=573K)
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
        # --- CYLINDER INSTANTANEOUS RESULTS ---
        # Variables: 1=Pressure, 2=Temperature, 5=GastoEsc, 6=GastoAdm, 11=Masa
        num_cylinders = self.config.engine.cylinders
        self.wam_lines.append(f"{num_cylinders}")  # All 6 cylinders
        for cyl_id in range(1, num_cylinders + 1):
            self.wam_lines.append(f"{cyl_id}")      # Cylinder ID (1-indexed)
            self.wam_lines.append("5 1 2 5 6 11")   # 5 vars: P, T, ExhFlow, IntFlow, Mass

        # --- PLENUM INSTANTANEOUS RESULTS ---
        # Variables: 0=Pressure, 1=Temperature, 3=Masa
        num_plenums = len(self.plenum_ids)
        self.wam_lines.append(f"{num_plenums}")
        for plid in sorted(self.plenum_ids):
            self.wam_lines.append(f"{plid}")         # Plenum ID (1-indexed)
            self.wam_lines.append("2 0 1")           # 2 vars: Pressure, Temperature
        
        # --- PIPE INSTANTANEOUS RESULTS ---
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

    def _create_pipe_to_pipe_throttle(self, valve_id):
        """
        Create Type 9 (Linear Pressure Loss) connection linking to a dynamic Valve.
        Key for Strategy A: Enables pipe-to-pipe throttle without plenum volume.
        """
        cid = self.connection_counter
        # Store connection data as dict: {cid: (type, [lines])}
        # Type 9 format: K_factor
        # Use negative K to indicate Valve ID linkage (e.g. -27 for Valve 27)
        # Check if valve_id is valid (positive integer)
        if valve_id <= 0:
            print(f"WARNING: Invalid Valve ID {valve_id} for Type 9 Throttle")
            
        k_val = -float(valve_id)
        # Use Type 10 (Quadratic Pressure Loss) for Throttles
        self.connections[cid] = (10, [f"{k_val:.1f}"]) 
        self.connection_counter += 1
        return cid

    def _create_branch_junction(self):
        """
        Create Type 12 connection (TCCRamificacion) for multi-pipe branch/merge.
        All pipes whose left_node or right_node reference this CID are
        auto-discovered by AsignaTubos. No additional input data needed.
        Supports N-pipe junctions (e.g. 3 headers + 1 collector output = 4 pipes).
        """
        cid = self.connection_counter
        self.connections[cid] = (12, [])  # Type 12, no additional data lines
        self.connection_counter += 1
        return cid

    def _add_h_pipe_junction(self, p1, p2, location_ratio):
        pass

    def _add_pipe(self, pid, label, length, d_start, d_end, wall_temp, left_node=0, right_node=0, friction=0.01, dx_mesh=0.05, init_p=None):
        # Format: PipeID Label Length D_Start D_End T_Wall LeftNode RightNode Friction
        # NEW: dx_mesh (Mesh Size in meters) is the 4th value in the internal storage dict
        # init_p: initial static pressure (bar). None -> atmospheric. For pipes
        # downstream of the throttle this is set to the estimated manifold vacuum
        # (MAP) so a part-throttle run starts near its steady operating pressure
        # instead of atmospheric (which would over-fill the first cycle).
        self.pipes[pid] = {
            'label': label,
            'length': length, # restored key name 'length' (was 'len')
            'd_start': d_start,
            'd_end': d_end,
            'wall_temp': wall_temp,
            'left_node': left_node,
            'right_node': right_node,
            'friction': friction,
            'dx_mesh': dx_mesh, # Store explicit mesh size
            'init_p': init_p,
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
            # Diagnostic (OPENWAM_IN_FRIC=<x>): multiply the INTAKE-pipe friction
            # (ids < 39; exhaust starts at the port pipes >=39) to test whether
            # damping the over-resonant intake oscillation suppresses the spurious
            # junction-entropy heating (Stage 16 cont.). Default 1.0 (no change).
            fric = p['friction']
            if pid < 39:
                fric *= float(os.environ.get("OPENWAM_IN_FRIC", "1.0"))
            self.wam_lines_pipes.append(f"{fric}")
            # Line 3: Wall Temp, Pressure, Velocity
            # P in bar (TTubo.cpp converts BarToPa(FPini)). Default atmospheric;
            # throttle-downstream pipes carry an estimated MAP so part-throttle
            # starts near its steady manifold vacuum.
            p_init = p.get('init_p') or 1.01325
            # Startup-shock fix (Stage 25): the intake pipes start at rest (v=0),
            # so the first valve openings hit a quiescent column and set up a
            # network-wide supersonic transient that over-fills cyls 4-6 of cycle 1
            # (Stage 24). Seed the INTAKE pipes (id<39) with a small FORWARD mean
            # velocity (toward the cylinders) consistent with the steady induction
            # draw, so the first induction is a perturbation rather than a step.
            # OPENWAM_IN_VINIT = mean port velocity (m/s) at the 35 mm valve throat;
            # each pipe is scaled by area (A_ref/A_pipe) for rough continuity, and
            # signed +/- so the flow points from the airbox toward the cylinders.
            v_init = 0.0
            if pid < 39:
                v_ref = float(os.environ.get("OPENWAM_IN_VINIT", "0.0"))
                if v_ref != 0.0:
                    import math as _m
                    A_throat = _m.pi * (0.035 / 2.0) ** 2          # 35 mm valve
                    A_pipe = _m.pi * ((p['d_start'] + p['d_end']) / 4.0) ** 2
                    v_init = v_ref * (A_throat / A_pipe) if A_pipe > 0 else 0.0
                    v_init *= p.get('flow_sign', 1.0)               # +toward cylinder
            # Initial GAS temperature (Line 3, field 2). TTubo reads this as FTini
            # and seeds FTemperature[i]=degCToK(FTini) in every cell. Historically
            # we wrote the WALL temperature here, so the EXHAUST pipes start full of
            # 600-800 C gas while the cylinders are at ~60 C. At the first exhaust-
            # valve opening that ~540 K thermal step (plus the high sound speed of
            # the hot gas, ~590 m/s) makes the port column ring supersonic and seeds
            # the startup shock / over-fill (Stage 25). At a genuine cold start the
            # exhaust gas is at ambient, not glowing; the WALL boundary then heats it
            # to its steady value over the first cycles, so seeding ambient gas
            # converges to the same limit cycle without the startup shock.
            # OPENWAM_EXH_TGAS = cold-start gas temp (C) for exhaust pipes (id>=39).
            # Default "wall" = legacy behaviour (gas seeded at the hot wall temp).
            # A decisive A/B (Stage 25) showed cold-seeding the exhaust gas reduces
            # the sonic-event COUNT but does NOT remove the startup over-fill (it
            # actually deepens it: denser cold exhaust backflows harder), and the
            # CONVERGED limit cycle is identical either way (~0.33 g trapped). So
            # this stays an opt-in diagnostic, not a behaviour change.
            t_wall = p['wall_temp']
            t_gas = t_wall
            if pid >= 39:
                tg = os.environ.get("OPENWAM_EXH_TGAS", "wall")
                t_gas = t_wall if tg == "wall" else float(tg)
            self.wam_lines_pipes.append(f"{t_wall} {t_gas} {p_init:.5f} {v_init:.4f}")
            # Line 4: Multipliers  (TipTC  FCoefAjusTC  FCoefAjusFric)
            # FCoefAjusTC scales the gas<->wall heat flux (TTubo CalculaFuente2).
            # Diagnostic (OPENWAM_IN_HMULT=<x>): boost the INTAKE-pipe (id<39)
            # wall heat rejection -- the walls are held at a fixed 40 C (constant-T
            # mode), i.e. an ideal aluminium-to-ambient sink, but at the default
            # x1 the Reynolds-based film coefficient removes heat too slowly to
            # overcome the hot recirculation. Cranking this tests whether stronger
            # (more realistic, pulsating-flow) intake heat rejection cools the
            # charge and recovers VE. Default 1.0 (unchanged).
            htc = 1.0
            if pid < 39:
                htc = float(os.environ.get("OPENWAM_IN_HMULT", "1.0"))
            self.wam_lines_pipes.append(f"1 {htc} 1.0")
            # Line 5: Composition
            self.wam_lines_pipes.append(f"{self.air_comp}")
            # Line 6: Mesh & Thermal Model
            # Optimized Mesh Size: Target 50mm globally. 
            # For short pipes (50mm), use 2 nodes (dx=Length/2) for stability (1-node caused supersonic).
            
            # Mesh parameters
            if 'dx_mesh' in p:
                dx = p['dx_mesh']
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

    def _read_vlv_cd_profile(self, vlv_filename, valve_diameter_mm):
        """Read VLV file and build Cd vs lift(m) lookup table.
        
        VLV format: N rows of [angle(deg)  lift(mm)  Cd(-)]
        Returns (num_cd_points, lift_m_increment, cd_table[])
        suitable for OpenWAM TValvula4T input format.
        
        OpenWAM uses FIncrLev as lift increment in METERS.
        CalculaCD looks up Cd by FApertura (lift in meters).
        """
        # Resolve VLV file path
        data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        vlv_path = os.path.join(data_dir, vlv_filename)
        
        if not os.path.exists(vlv_path):
            print(f"WARNING: VLV file not found: {vlv_path}, falling back to flat Cd=0.6")
            return None
        
        # Read VLV file
        lifts_mm = []
        cds = []
        with open(vlv_path, 'r') as f:
            n_rows = int(f.readline().strip())
            for _ in range(n_rows):
                parts = f.readline().split()
                if len(parts) >= 3:
                    lift = float(parts[1])
                    cd = float(parts[2])
                    if lift > 0.001:  # Only non-zero lift points
                        lifts_mm.append(lift)
                        cds.append(cd)
        
        if not lifts_mm:
            print(f"WARNING: No valid lift/Cd data in {vlv_filename}")
            return None
        
        # Convert to lift in meters (OpenWAM uses meters internally)
        lifts_m = [l / 1000.0 for l in lifts_mm]
        
        # Build evenly-spaced lift(m) → Cd table for OpenWAM
        max_lift_m = max(lifts_m)
        num_cd = 20  # Good resolution
        lift_step_m = max_lift_m / (num_cd - 1)
        
        # Sort by lift for proper interpolation
        pairs = sorted(zip(lifts_m, cds))
        lift_sorted = [p[0] for p in pairs]
        cd_sorted = [p[1] for p in pairs]
        
        cd_table = []
        for i in range(num_cd):
            target_lift = i * lift_step_m
            # Linear interpolation
            if target_lift <= lift_sorted[0]:
                cd_val = cd_sorted[0] * (target_lift / lift_sorted[0]) if lift_sorted[0] > 0 else 0.0
            elif target_lift >= lift_sorted[-1]:
                cd_val = cd_sorted[-1]
            else:
                # Find bracketing indices
                for j in range(len(lift_sorted) - 1):
                    if lift_sorted[j] <= target_lift <= lift_sorted[j+1]:
                        frac = (target_lift - lift_sorted[j]) / (lift_sorted[j+1] - lift_sorted[j])
                        cd_val = cd_sorted[j] + frac * (cd_sorted[j+1] - cd_sorted[j])
                        break
                else:
                    cd_val = cd_sorted[-1]
            cd_table.append(max(0.0, cd_val))
        
        return (num_cd, lift_step_m, cd_table)
    
    def _add_valve_def(self, vid, file, dia, control_ids: Optional[Dict[str, int]] = None):
        is_intake = "intake" in file
        head_conf = self.config.engine.head
        valve_conf = head_conf.intake_valve if is_intake else head_conf.exhaust_valve
        # BMW Spread → OpenWAM IVO/EVO conversion:
        #   IVO = 360 + spread_inlet - half_duration = 230 + spread_inlet
        #   EVO = 360 - spread_exhaust - half_duration = 230 - spread_exhaust
        # With bias system: open_angle = base_open - bias
        #   intake_bias = 130 - raw → open = 360 - (130 - raw) = 230 + raw ✓
        #   exhaust_bias = raw - 128 → open = 102 - (raw - 128) = 230 - raw ✓
        # Intake valve open angle (crank deg, gas-exchange TDC = 360). With the
        # cosine lift over `duration`, IVC = base_open + duration. The previous
        # base_open_intake=360 + duration 260 gave IVC=620 (80 deg after BDC),
        # which kept the intake valve open far into compression: VLVWIN showed
        # the cylinder pushing hot charge BACK into the runner (SAL) for ~90 deg,
        # contaminating the intake with 600-870 K gas and giving a uniform ~0.4x
        # VE.
        #
        # CALIBRATION (CSL 268 deg intake cam, scripts/ivo_sweep.py): with the
        # corrected CSL duration, the old base=360 (IVC 90 deg ABDC) is the WORST
        # static choice (avg first-cycle VE 67% over 3000-7000). A clean 5-RPM x
        # 5-IVO sweep shows a sharp inverted-U vs IVC at every RPM; the per-RPM
        # optimum moves EARLIER with RPM (IVC ~70 ABDC @3000 -> 60 @4000 -> 50
        # @5000-7000). Best SINGLE static base is knob 330 (IVC ~60 ABDC): top
        # average VE (84%) and best worst-case (min 62% vs knob 320's 39% collapse
        # at 3000). It wins 4000 outright and is 2nd at 5000-7000. The
        # RPM-dependent optimum belongs in the VANOS schedule (kf_evan1_soll).
        # Env-tunable via OPENWAM_IVO.
        import os as _os
        base_open_intake = float(_os.environ.get("OPENWAM_IVO", "330.0"))
        base_open_exhaust = 102.0  # 102° ATDC-combustion (was 130: 28° too late)
        vanos_bias = 0.0

        # MSS54 VANOS mechanical reference offset (K_EVAN1/K_AVAN1_OFFSET, °KW).
        # This is a FIXED reference trim, present in both static and controlled
        # modes (it is not the dynamic map target). Same sign as vanos_bias:
        # positive = advance (earlier opening, smaller open_angle).
        vanos_offset = (self.config.engine.vanos_intake_offset if is_intake
                        else self.config.engine.vanos_exhaust_offset)

        # If controlled, we don't apply static bias here (Controller handles it dynamically)
        # BUT, standard OpenWAM logic adds "Angle0" + Gap.
        # Angle0 usually comes from 'open_angle' in file.
        # So we should probably set Angle0 to Base?
        # If static (no control):
        if not control_ids:
            if is_intake:
                # VANOS authority calibration (OPENWAM_VANOS_SCALE, default 1.0). The
                # sim over-responds to intake cam advance: at the stock VANOS the
                # advanced IVO (up to ~88 deg BTDC at bias 60) makes an excessive
                # overlap and over-rams VE (Stage 44/45). Scaling the applied bias
                # pulls the cam back toward a physical IVO range so the VE map matches
                # stock; tuned empirically against kf_rf_soll.
                _vscale = float(os.environ.get("OPENWAM_VANOS_SCALE", "1.0"))
                vanos_bias = self.config.engine.vanos_intake_bias * _vscale
                self._validate_valve_config(valve_conf, vanos_bias)
                open_angle = base_open_intake - (vanos_bias + vanos_offset)
            else:
                vanos_bias = self.config.engine.vanos_exhaust_bias
                self._validate_valve_config(valve_conf, vanos_bias)
                open_angle = base_open_exhaust - (vanos_bias + vanos_offset)
        else:
             # Simulation with control: Set Base Angle (trimmed by the fixed
             # mechanical offset). Controller outputs the dynamic Bias (Gap).
             # open_angle = Angle0
             base_open = base_open_intake if is_intake else base_open_exhaust
             open_angle = base_open - vanos_offset
            
        self.wam_lines_valves.append("1")
        # Dynamic Duration Logic
        step = 1.0 # High resolution for stability (was 5.0)
        duration = valve_conf.duration
        if is_intake and _os.environ.get("OPENWAM_IN_DUR"):
            duration = float(_os.environ["OPENWAM_IN_DUR"])
        # Exhaust duration override (OPENWAM_EX_DUR): EVO stays at open_angle (102),
        # so increasing the duration pushes EVC later (= keeps exhaust-valve lift up
        # through gas-exchange TDC). Tests hypothesis (3): vent the compressed hot
        # clearance-gas residual at TDC so it cannot revert into the intake.
        if (not is_intake) and _os.environ.get("OPENWAM_EX_DUR"):
            duration = float(_os.environ["OPENWAM_EX_DUR"])
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
        
        # --- Cd Profile: Read from VLV file ---
        flow_scalar = head_conf.port_flow_coeff
        vlv_cd = self._read_vlv_cd_profile(file, valve_conf.diameter)
        
        if vlv_cd:
            num_cd, ld_step, cd_table = vlv_cd
            # Apply flow scalar
            cd_scaled = [cd * flow_scalar for cd in cd_table]
            self.wam_lines_valves.append(f"{num_cd} {ld_step:.6f}")
            self.wam_lines_valves.append(" ".join(f"{c:.4f}" for c in cd_scaled))  # CDEntrada (forward)
            self.wam_lines_valves.append(" ".join(f"{c:.4f}" for c in cd_scaled))  # CDSalida (reverse)
        else:
            # Fallback: flat Cd (legacy behavior)
            base_cd = 0.6 * flow_scalar
            cd_vals = [f"{base_cd:.3f}"] * 10
            self.wam_lines_valves.append("10 0.0011")
            self.wam_lines_valves.append(" ".join(cd_vals))
            self.wam_lines_valves.append(" ".join(cd_vals))
        
        swirl_vals = ["0.0"] * (vlv_cd[0] if vlv_cd else 10)
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
        Map relative pedal/throttle opening (0..1) to physical butterfly blade
        angle (deg), measured from fully closed.

        Formula: TP = offset + (max - offset) * RO^gamma

        gamma controls the progression:
          - gamma < 1 opens the blade FAST at low pedal (the old gamma=0.4 sent
            5% pedal to ~29 deg, Cd~0.55 -- a half-open throttle. The throttle
            then could not meter air: measured VE was ~105% flat from 5% to 100%
            throttle, i.e. the load axis did not bite at all);
          - gamma > 1 is progressive: low pedal -> small angle -> small area,
            which is how a real butterfly meters air. gamma=1.4 gives
            10% pedal -> ~5.5 deg, 39% -> ~25 deg, 100% -> 90 deg, so the
            flow tracks pedal instead of saturating.

        idle_offset is the small always-open angle (idle bypass / blade-gap
        leakage) so a "closed" throttle still flows the ~10-15% an ITB idles on.
        Both gamma and the idle offset are env-tunable for calibration.
        """
        import os
        ro = max(0.0, min(1.0, ro))

        idle_offset = float(os.environ.get("OPENWAM_THR_OFFSET", "2.0"))
        max_angle = 90.0
        gamma = float(os.environ.get("OPENWAM_THR_GAMMA", "1.4"))

        tp = idle_offset + (max_angle - idle_offset) * (ro ** gamma)

        # Calibrated sigma(pedal) override (Stage 49/50). The geometric 1-cos law
        # throttles the low/mid pedals too hard (sim's per-rpm load profile is too
        # steep at clean rpms). When a calibrated pedal->sigma breakpoint table is
        # configured, override the OPERATING angle with the one whose (geometric,
        # monotonic) Cd equals the target sigma at this pedal. Only the operating
        # angle moves -- the emitted Cd table stays geometric -- so every consumer
        # (initial angle + controller) stays consistent and WOT (sigma 0.96 -> 90
        # deg) is preserved. No table configured -> geometric path, byte-identical
        # to legacy. Pairs with the compressible/choked BC (OPENWAM_THR_CHOKE).
        sigma_t = self._calibrated_sigma(ro)
        if sigma_t is not None:
            tp = self._invert_cd_to_angle(sigma_t)
        return tp

    def _calibrated_sigma(self, ro: float):
        """Target effective open-area ratio sigma at pedal ro (0..1), read from a
        breakpoint table; None when no calibrated curve is configured (-> the
        geometric default path, legacy behaviour preserved byte-for-byte).

        Source: OPENWAM_THR_SIGMA_BP = "p0:s0,p1:s1,..." (pedal->sigma, ascending),
        e.g. "0.0:0.001,0.2:0.11,0.45:0.30,0.65:0.55,1.0:0.96". Linear interpolation
        between breakpoints, clamped to the table ends. Anchor pedal 1.0 -> 0.96 to
        keep the validated WOT termination unchanged.
        """
        import os
        spec = os.environ.get("OPENWAM_THR_SIGMA_BP")
        if not spec:
            return None
        try:
            pts = sorted((float(p), float(s))
                         for p, s in (tok.split(":") for tok in spec.split(",")))
        except Exception:
            return None
        if not pts:
            return None
        ro = max(0.0, min(1.0, ro))
        if ro <= pts[0][0]:
            return pts[0][1]
        if ro >= pts[-1][0]:
            return pts[-1][1]
        for (p0, s0), (p1, s1) in zip(pts, pts[1:]):
            if p0 <= ro <= p1:
                return s0 if p1 == p0 else s0 + (s1 - s0) * (ro - p0) / (p1 - p0)
        return pts[-1][1]

    def _invert_cd_to_angle(self, sigma_target: float) -> float:
        """Blade angle (deg, 0..90) whose geometric _get_butterfly_cd == sigma_target.
        _get_butterfly_cd is monotonic in angle, so bisect. Used only when a
        calibrated sigma(pedal) curve is active."""
        lo, hi = 0.0, 90.0
        if sigma_target <= self._get_butterfly_cd(lo):
            return lo
        if sigma_target >= self._get_butterfly_cd(hi):
            return hi
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            if self._get_butterfly_cd(mid) < sigma_target:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def _get_butterfly_cd(self, angle_deg: float) -> float:
        """
        EFFECTIVE FLOW-AREA RATIO A_eff/A_bore for a butterfly throttle blade at the
        given blade angle (deg from fully closed; 90 deg = fully open).

        The C++ throttle BC (TCCPerdidadePresion) consumes this value as
            K = 1/ratio^2 - 1
        and applies that loss to the FULL-BORE dynamic head. For the loss to be
        physical, the value returned here must therefore be the fraction of the bore
        the blade actually leaves open -- NOT a bare discharge coefficient.

        The previous table returned a discharge-coefficient-like curve (0.33 at 15
        deg, 0.50 at 25 deg). Referenced to the full bore that implied the blade
        still passed ~30-50% of the bore area at a near-shut angle, so K stayed tiny
        (~9 at 25% pedal) and, against the low full-bore velocity through the phi52
        ITB (~7 m/s), produced a negligible ~0.002 bar loss: the manifold refilled to
        ~atmospheric at ANY pedal and VE was flat vs throttle (the long-standing bug).

        Correct geometry (Heywood Ch.7, Blair Ch.5): a thin butterfly's open area is
            A_open/A_bore ~= 1 - cos(theta),
        and a true discharge coefficient Cd_disc ~0.65..0.95 multiplies it. So a
        near-shut blade leaves only a few percent of the bore open and K becomes
        large, which is what actually meters the air. Validated empirically: at 25%
        pedal a ratio of ~0.067 (vs the old 0.32) drops trapped mass from ~85% to
        ~53% -- the throttle finally bites.
        """
        import math
        if angle_deg >= 90.0:
            return 0.96   # blade parallel to flow: ~full bore (negligible K)
        if angle_deg <= 0.0:
            return 0.001  # fully shut: blade-gap leakage only

        open_frac = 1.0 - math.cos(math.radians(angle_deg))  # butterfly open area
        cd_disc = 0.65 + 0.25 * (angle_deg / 90.0)           # discharge coef 0.65->0.90
        ratio = cd_disc * open_frac
        return max(0.001, min(0.96, ratio))

    def _get_butterfly_cd_OLD_discharge_table(self, angle_deg: float) -> float:
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
            return 0.96  # ITB at WOT: blade parallel to flow (Jenvey/Keihin data)

        # Physical Butterfly Cd from ITB flow bench data
        # Low angle regime (0-10 deg): Near-closed blade, only leakage flow
        # References:
        #   Heywood Ch.6 Fig.6-15: Butterfly Cd at small angles
        #   SAE 2003-01-3149: ITB flow characterization
        #   Blair Ch.5: Throttle flow area = pi/4 * D^2 * (1 - cos(theta))
        # Revised Cd table: minimum Cd=0.02 at 0° (blade gap leakage)
        # The C++ solver floors Cd at 0.05 and clamps K at 2.0.
        # Values below 0.05 will hit the C++ floor but are kept for physical accuracy.
        # At operating idle (3° offset), Cd=0.06 ensures K<2.0 (safe for startup).
        cd_table = [
            (0.0, 0.020),   # Near-closed: blade gap leakage (ITB mechanical tolerance)
            (1.0, 0.030),   # Minimal opening
            (2.0, 0.045),   # Just below C++ floor (0.05) — will be floored in solver
            (3.0, 0.060),   # ICV idle angle — above C++ floor, K ≈ 1/0.06²-1 = 277 → clamped to 2.0
            (5.0, 0.100),   # Very low opening — K ≈ 99 → clamped to 2.0
            (8.0, 0.170),   # Low opening — K ≈ 33.6 → clamped to 2.0
            (10.0, 0.220),  # Significant restriction still
            (15.0, 0.330),  # Flow reattachment begins
            (20.0, 0.420),  # Moderate opening
            (25.0, 0.500),  # Half-open
            (30.0, 0.560),  # Past reattachment
            (40.0, 0.660),  # Wide opening
            (50.0, 0.740),  # Near-WOT
            (60.0, 0.800),
            (70.0, 0.860),
            (80.0, 0.920),
            (90.0, 0.960),  # ITB WOT: blade parallel, minimal obstruction
        ]

        # Linear interpolation
        for i in range(len(cd_table) - 1):
            a1, cd1 = cd_table[i]
            a2, cd2 = cd_table[i + 1]
            if a1 <= angle_deg <= a2:
                t = (angle_deg - a1) / (a2 - a1)
                return cd1 + (cd2 - cd1) * t

        # Fallback (should not reach here)
        return 0.96

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
        angles = [0, 1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90]
        num_points = len(angles)

        # Header: NumPoints RefDiameter
        # DiamRef: Effective inner diameter accounting for blade thickness (2mm each side)
        blade_thickness = 0.004  # 4mm total (2mm per side)
        effective_dia = dia - blade_thickness
        self.wam_lines_valves.append(f"{num_points} {effective_dia:.5f}")

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

    def _add_plenum(self, plid, label, vol, wall_temp, ptype=0, allow_small=False, init_p=None):
        # Type 0: Constant Volume. init_p: initial pressure (bar); None -> atm.
        
        # Universal minimum volume clamp for numerical stability.
        # Unit is m3. 0.00005 m3 = 50cc.
        #
        # History of clamp values and crash results:
        #   100cc (original): Stable but destroys wave dynamics (all plenums = reservoirs)
        #   5cc: Collector_Junct crashes at Theta=621° ("no mass in plenum")
        #   5cc intake + 50cc exhaust: ITB_Junction crashes at Theta=600°
        #   → Both exhaust blowdown AND intake backflow kill small plenums.
        #
        # 50cc (0.00005 m3) is the minimum viable 0D plenum volume for:
        #   - Surviving exhaust blowdown shockwaves (4-6 bar → 1 bar)
        #   - Surviving intake pressure reversals during valve overlap
        #   - Still 2x smaller than original 100cc → improved wave dynamics
        #
        # Affected plenums (physical → clamped):
        #   ITB_Junction: 1cc → 50cc | Collector_Junct: 2cc → 50cc
        #   Split_Plenum: 2cc → 50cc | Port_Junct: 1cc → 50cc
        #   ValvePocket_In: 3cc → 50cc | ValvePocket_Ex: 5cc → 50cc
        #   H_Junc: 2cc → 50cc
        # Unaffected: Ambient (1e9), Plenum_Main (10.5L), Muffler (30L)
        
        # Use configurable minimum volume (Strategy B: Low Vacuum Validation).
        # allow_small bypasses the global clamp for purpose-built small junction
        # plenums (e.g. the exhaust port-merge), which need ~tens of cc to keep
        # wave dynamics. A small absolute floor still guards the RK solver.
        if allow_small:
            vol = max(vol, 1.0e-7)  # 0.1 cc absolute floor
        else:
            min_vol = getattr(self.config.intake, 'min_plenum_vol', 0.00005)
            vol = max(vol, min_vol)
        
        self.wam_lines_plenums.append(f"{ptype}")
        self.wam_lines_plenums.append(self.air_comp)
        
        # Line 3: Vol P T. P in bar (TDeposito.cpp converts BarToPa(FPressure)).
        # Default atmospheric; throttle-downstream plenums carry an estimated MAP.
        p_init = init_p if init_p else 1.01325
        self.wam_lines_plenums.append(f"{vol:.5f} {p_init:.5f} {wall_temp:.2f}")
        
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
        return cid

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


import os
from .models import SimulationConfig

class WAMInputGenerator:
    def __init__(self, config: SimulationConfig):
        self.config = config
        self.version = 2200  # Verified from Globales.h
        self.content = []

    def _add(self, value, comment=""):
        if comment:
            self.content.append(f"{value} \t< {comment} >")
        else:
            self.content.append(f"{value}")

    def _generate_engine_block(self):
        eng = self.config.engine
        
        # ACT (0=No)
        self._add(0, "Calculate Combustion with ACT (0=No)") 
        
        # Cylinders
        self._add(eng.cylinders, "Number of Cylinders")
        
        # Initial Conditions
        self._add(eng.rpm, "Initial RPM")
        self._add(eng.initial_pressure, "Initial Pressure (bar)")
        self._add(eng.initial_mass, "Initial Mass (kg)")
        
        # Composition
        self._add(0, "Impose Composition at Exhaust (0=No)")
        # Initial Composition (9 species: O2, CO2, H2O, HC, Soot, NOx, CO, Fuel, N2)
        # Assuming standard air for initial
        self._add("0.233 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.767", "Initial Composition")
        
        # PAAE (Pressure at Exhaust?)
        self._add(0, "Impose PAAE (0=No)")
        
        # Combustion Type
        self._add(eng.fuel_type, "Combustion Type (0=MEC, 1=MEP)")
        
        # Fuel
        if eng.fuel_type == 0: # MEC (Diesel)
            self._add(eng.fuel_mass, "Fuel Mass (kg/cycle)")
        else: # MEP (Petrol)
            self._add(eng.equivalence_ratio, "Equivalence Ratio")
            
        self._add(eng.combustion_efficiency, "Combustion Efficiency")
        self._add(eng.u_lcv, "Lower Calorific Value (J/kg)")
        self._add(eng.fuel_density, "Fuel Density (kg/m3)")
        
        # Pipe Reference for VE
        self._add(0, "Pipe Reference for VE (0=None)")
        
        # Thermal Parameters
        self._add(eng.temp_piston, "Piston Temperature (K)")
        self._add(eng.temp_head, "Cylinder Head Temperature (K)")
        self._add(eng.temp_cylinder, "Cylinder Temperature (K)")
        
        self._add(eng.bore**2 * 3.14159 / 4 * 1e-6, "Piston Area (m2)") 
        self._add(eng.bore**2 * 3.14159 / 4 * 1e-6 * 1.5, "Head Area (m2)") 
        
        # Wall Properties (Thickness, Cond, Dens, SpecHeat)
        # Piston, Head, Cylinder
        wall_props = "0.01 50 7800 500" # Dummy steel
        self._add(f"{wall_props}", "Piston Wall Props")
        self._add(f"{wall_props}", "Head Wall Props")
        self._add(f"{wall_props}", "Cylinder Wall Props")
        
        # Heat Transfer Adjustment
        self._add("1.0 1.0 1.0 300", "Heat Transfer Adjustments (Adm, Esc, Torque, Coolant)")
        
        # Wall Temp Calc
        self._add(1, "Wall Temp Calculation (1=No Inertia)")
        
        # Woschni
        self._add(f"{eng.woschni_c1} {eng.woschni_c2} {eng.woschni_exp}", "Woschni C1, C2, exp")
        
        # Geometry
        self._add(eng.conrod, "Connecting Rod (mm)")
        self._add(eng.stroke, "Stroke (mm)")
        self._add(eng.bore, "Bore (mm)")
        self._add(eng.compression_ratio, "Compression Ratio")
        self._add(0, "Bowl Diameter")
        self._add(0, "Bowl Height")
        self._add(0, "Valve Distance") # Dummy
        self._add(0, "BlowBy Area")
        self._add(0, "BlowBy Coeff")
        self._add(0, "Eccentricity")
        self._add(20, "Pin Diameter")
        self._add(30, "Crown Height")
        self._add(0.5, "Conrod Mass")
        self._add(0.5, "Piston Mass")
        self._add(2.1e11, "Elasticity Modulus")
        self._add(0, "Deformation Coeff")
        
        # Mechanical Losses
        self._add(f"{eng.friction_c0} {eng.friction_c1} {eng.friction_c2} {eng.friction_c3}", "Friction Coeffs")
        
        # Vehicle Model (Skipped if SimulationType != 2)
        # We are using SimulationType=0 (Stationary), so skipped.
        
        # Combustion Laws (since ACT=0)
        self._add(1, "Number of Combustion Laws")
        # Law 1: ma (Start), mf (Pre-mix fraction?), n (Shape Factor)
        # Using dummy Wiebe
        self._add("-10 1.0 1.0", "Combustion Law 1 (Start, Fraction?, Shape?)") 
        self._add(1, "Number of Wiebes")
        # m, C, Beta, IncAlpha?, Alpha0
        self._add("2.0 6.9 0.5 40 -10", "Wiebe Params (m, a, Beta, Duration, Start)")
        
        # Injection Data
        self._add(0, "Injection Data Type (0=None)")
        
        # Cylinder Phasing
        self._add(1, "Phasing Type (1=Uniform)")
        
        # Controllers
        self._add(0, "Number of Controllers")
        
        # Per Cylinder Controllers
        for _ in range(eng.cylinders):
            self._add(0, "Controllers for Cylinder")


    def generate(self) -> str:
        self.content = []
        
        # Header
        self._add(self.version, "OpenWAM Version")
        self._add(0, "Independent (0=Common, 1=Independent)")  # Assuming common for coupled simulation
        
        # General Data
        # agincr, SimulationDuration, AmbientPressure, AmbientTemperature
        self._add(1.0, "Crank Angle Increment (deg)") 
        self._add(0.5, "Simulation Duration (s)")
        self._add(100000, "Ambient Pressure (Pa)")
        self._add(298, "Ambient Temperature (K)")
        
        # Species & Gamma
        self._add(1, "Species Calculation (1=Complete)")
        self._add(2, "Gamma Calculation (2=Composition+Temp)")
        
        # Engine Block
        block_exists = 1 if self.config.engine.block_exists else 0
        self._add(block_exists, "Engine Block Exists (1=Yes)")
        
        # Engine Data (if Exists)
        if self.config.engine.block_exists:
            # tipociclo, tipomod, EGR
            self._add(0, "Cycle Type (0=4T)") 
            self._add(0, "Simulation Type (0=Stationary)") 
            self._add(0, "EGR (0=No)")
            
            # CyclesWithoutThemalInertia (if tipomod != 0)
            # self._add(10, "Cycles without Thermal Inertia") # Skipped for Stationary

        
        # Species/Fuel Data
        # haycombustible
        self._add(1, "Fuel Injection (1=Yes)")
        self._add(1, "Fuel Type (1=Gasoline)")
        
        # Atmospheric Composition
        # Complete Model Fuel=1: 9 species. (O2, CO2, H2O, HC, Soot, NOx, CO, Fuel, N2)
        # Using 1.0 for O2 to avoid float precision errors
        self._add("1.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0", "Atmospheric Composition")
        
        # Engine Details (TBloqueMotor::LeeMotor)
        if self.config.engine.block_exists:
            self._generate_engine_block()
        
        # Remaining Components (Order matches TOpenWAM::ReadInputData)
        
        # 1. Pipes (ReadPipes)
        self._add(0, "Number of Pipes")
        # Concentric? (Ifdef) - Assuming not defined
        # DPF? (Ifdef) using ReadDPF
        # self._add(0, "Number of DPFs") # If verification fails, might need this
        
        # 2. Valves (ReadValves)
        self._add(0, "Number of Valves")
        
        # 3. Plenums (ReadPlenums)
        # Reads: NumPlenums, NumTurbines, NumVenturis, NumDJs
        self._add(0, "Number of Plenums")
        self._add(0, "Number of Turbines")
        self._add(0, "Number of Venturis")
        self._add(0, "Number of Directional Junctions")
        
        # 4. Compressors (ReadCompressors)
        self._add(0, "Number of Compressors")
        
        # 5. Connections (ReadConnections)
        self._add(0, "Number of Connections")
        
        # 6. Turbocharger Axis (ReadTurbochargerAxis)
        self._add(0, "Number of Axis")
        
        # 7. Sensors (ReadSensors)
        self._add(0, "Number of Sensors")
        
        # 8. Controllers (ReadControllers)
        self._add(0, "Number of Global Controllers")
        
        # 9. Output (ReadOutput)
        # ReadOutput in TOpenWAM.cpp calls TOutputResults::ReadAverageResults, ReadInstantaneousResults, ReadSpaceTimeResults
        
        # Output Frequency
        # 0=LastCycle, 1=AllCyclesIndependent, 2=AllCyclesConcatenated, 3=EveryNCycles
        self._add(0, "Output Frequency (0=Last CycleAvg)")
        
        # Average Results
        self._add(0, "Output Cylinders Count")
        self._add(1, "Output Engine Results (1=Yes)")
        self._add(0, "Output Plenums Count")
        self._add(0, "Output Pipes Count")
        self._add(0, "Output Pipes WAMer?") 
        self._add(0, "Output Axis Count")
        self._add(0, "Output Compressors Count")
        self._add(0, "Output Turbines Count")
        self._add(0, "Output Valves Count")
        self._add(0, "Output Roots Count") # Volumetric Compressors
        self._add(0, "Output Connections Count")
        # DPF ifdef
        self._add(0, "Output DPF Count") # Added for safety if build has DPF
        self._add(0, "Output Sensors Count")
        self._add(0, "Output Controllers Count")
        
        # Instantaneous Results
        self._add(0, "Output Instantaneous Cylinders Count")
        self._add(0, "Output Instantaneous Plenums Count")
        self._add(0, "Output Instantaneous Pipes Count")
        self._add(0, "Output Instantaneous Pipes WAMer?")
        self._add(0, "Output Instantaneous Venturis Count")
        self._add(0, "Output Instantaneous Valves Count")
        self._add(0, "Output Instantaneous Turbos Count") # Axis
        self._add(0, "Output Instantaneous Compressors Count")
        self._add(0, "Output Instantaneous Turbines Count")
        self._add(0, "Output Instantaneous Roots Count")
        self._add(0, "Output Instantaneous Connections Count")
        self._add(0, "Output Instantaneous WasteGates Count")
        self._add(0, "Output Instantaneous ReedValves Count")
        self._add(0, "Output Instantaneous DPF Count") # Added for safety
        self._add(0, "Output Instantaneous Sensors Count") # Added
        self._add(0, "Output Instantaneous Controllers Count") # Added
        
        # SpaceTime Results
        self._add(0, "SpaceTime Results Count")
        
        # DLL
        self._add(0, "DLL (0=No)")
        
        return "\n".join(self.content)

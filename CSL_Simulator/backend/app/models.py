
from pydantic import BaseModel
from typing import Optional, List
from enum import Enum

# --- Phase 9: Modular Topology Expansion (F1 Grade) ---

class ExhaustLayoutType(str, Enum):
    STRAIGHT = "Straight"
    X_PIPE = "X-Pipe"
    H_PIPE = "H-Pipe"
    MERGE_2_1 = "Merge 2-into-1"
    SPLIT_1_2 = "Split 1-into-2"
    CUSTOM = "Custom"

# 1. Intake System
class InletConfig(BaseModel):
    duct_length: float = 200.0 # mm
    duct_diameter: float = 100.0 # mm (Airbox Snorkel)

class BellmouthConfig(BaseModel):
    length: float = 150.0 # mm (Bellmouth funnel, Plenum to ITB)
    diameter: float = 52.0 # mm (Opening, tapers from 70mm entry)
    taper_angle: float = 3.5 # degrees (Ram Theory)

class ITBConfig(BaseModel):
    fitted: bool = True
    diameter: float = 52.0 # mm
    plate_thickness: float = 2.0 # mm
    discharge_coeff_map: str = "default_butterfly" # Reference to lookup

class IntakeConfig(BaseModel):
    type: str = "CSL Replica"
    inlet: InletConfig = InletConfig()
    plenum_vol: float = 10.5 # Liters
    bellmouth: BellmouthConfig = BellmouthConfig()
    itb: ITBConfig = ITBConfig() # New ITB Module
    runner_friction: float = 0.015 # F1-Spec Polished (was 0.08)
    min_plenum_vol: float = 0.00005 # Default 50cc (m3). Adjustable for high-vacuum testing.

# 2. Engine Core
class EngineGeometry(BaseModel):
    bore: float = 87.0 # mm
    stroke: float = 91.0 # mm
    compression_ratio: float = 11.5
    rod_length: float = 139.0 # mm

class CombustionConfig(BaseModel):
    ignition_timing: float = -15.0 # BTDC
    duration: float = 65.0 # Degrees (Faster burn for high RPM)
    efficiency_a: float = 6.9
    shape_parameter_m: float = 2.2 # Steeper burn rate
    start_angle: float = -15.0 # Wiebe Model
    mass_burned_b: float = 0.5 # 50% mass burned location roughly

class ValveConfig(BaseModel):
    lift_profile: str = "Stock CSL"
    max_lift: float = 11.8 # mm
    duration: float = 260.0 # deg
    diameter: float = 35.0 # mm
    flow_coeff_map: str = "S54_Stock_Port" # Reference to flowbench data

class PortConfig(BaseModel):
    diameter: float = 45.0 # mm
    length: float = 100.0 # mm

class HeadConfig(BaseModel):
    port_flow_coeff: float = 1.0 # Scalar modifier (Stable Baseline)
    valves_per_cyl: int = 4
    wall_temp: float = 450.0 # K
    intake_valve: ValveConfig = ValveConfig(max_lift=11.8, duration=260.0)
    exhaust_valve: ValveConfig = ValveConfig(max_lift=11.2, duration=260.0)
    intake_port: PortConfig = PortConfig(diameter=52.0, length=105.0) # S54 CSL Spec
    exhaust_port: PortConfig = PortConfig(diameter=48.0, length=90.0)  # S54 CSL Spec
    port_friction: float = 0.05 # F1-Spec Port Job (was 0.3-0.5)

class HeatTransferConfig(BaseModel):
    woschni_coeffs: List[float] = [128.0, 2.28, 0.0]

class FrictionConfig(BaseModel):
    coeffs: List[float] = [0.9, 0.12, 0.0, 0.0] # Standard Chen-Flynn or similar

class EngineConfig(BaseModel):
    cylinders: int = 6
    rpm: float = 2000.0
    throttle_position: float = 1.0 # 0.0-1.0
    
    geometry: EngineGeometry = EngineGeometry(
        bore=87.0,
        stroke=91.0, 
        rod_length=139.0,
        compression_ratio=11.5
    )
    head: HeadConfig = HeadConfig()
    friction: FrictionConfig = FrictionConfig()
    combustion: CombustionConfig = CombustionConfig()
    heat_transfer: HeatTransferConfig = HeatTransferConfig()
    vanos_intake_bias: float = 0.0 # deg
    vanos_exhaust_bias: float = 0.0 # deg

# 3. Exhaust System (Modular Toplogy)
class HeaderConfig(BaseModel):
    type: str = "Stock Euro"
    primary_length: float = 300.0 # mm [KI Master Spec: 300mm Headers]
    primary_diameter: float = 48.0 # mm
    collector_count: int = 2 # 2 for 6-cyl (3-into-1 x 2)
    collector_vol: float = 1.5 # Liters
    collector_dia: float = 68.0 # mm
    wall_temp: float = 800.0 # K
    wall_temp: float = 800.0 # K
    heat_coeff: float = 45.0
    header_friction: float = 0.02 # Stainless Smooth (was 0.5)

class CatalystConfig(BaseModel):
    installed: bool = True
    location: str = "header_collector"
    cpsi: float = 200.0
    length: float = 200.0
    diameter: float = 120.0

class ExhaustSectionConfig(BaseModel):
    name: str = "Section"
    layout: ExhaustLayoutType = ExhaustLayoutType.STRAIGHT
    length: float = 500.0 # mm
    diameter: float = 68.0 # mm
    cat_fitted: bool = False
    cat_offset: float = 200.0 # mm from start
    wall_temp: float = 600.0 # K
    
class Section1Config(ExhaustSectionConfig): # Backward Compat wrap
    name: str = "Section 1"
    layout: ExhaustLayoutType = ExhaustLayoutType.STRAIGHT
    length: float = 1200.0 # Total Length (600 + 300 + 300)
    cat_fitted: bool = True
    cat_offset: float = 600.0 # mm from start (Section 1-1 Length)
    # Cat length is usually defined in CatalystConfig, or we assume implicit? 
    # Let's assume the conversion logic splits this based on `catalyst` config or internal logic.
    # User said: Sec1-1(600) -> Cat(300) -> Sec1-2(300). Total 1200.
    crossover_type: str = "none" # Straight

class Section2Config(ExhaustSectionConfig):
    name: str = "Section 2"
    layout: ExhaustLayoutType = ExhaustLayoutType.H_PIPE # H-Pipe here
    length: float = 1400.0 # Total: 400(2-1) + 200(H) + 800(2-2)
    resonator_fitted: bool = False # User didn't mention resonator, just pipes
    resonator_location: str = "none"
    # Logic needs to split this based on H-Pipe location

class Section3Config(ExhaustSectionConfig):
    name: str = "Muffler"
    muffler_type: str = "Reflection"
    tailpipe_length: float = 150.0
    volume: float = 15.0 # Liters

class ExhaustConfig(BaseModel):
    headers: HeaderConfig = HeaderConfig()
    catalyst: CatalystConfig = CatalystConfig() # Uses length=300 in models?
    section1_1: Section1Config = Section1Config() # Bank 1 Pipeline
    section1_2: Section1Config = Section1Config() # Bank 2 Pipeline (Duplicate config)
    section2: Section2Config = Section2Config()   # Merged Section (or Dual)
    section3: Section3Config = Section3Config()
    muffler_friction: float = 0.05 # Smooth Adapter (was 0.1)

# Root Config
class EnvironmentConfig(BaseModel):
    ambient_temp: float = 298.0
    ambient_pressure: float = 101325.0

class SimulationConfig(BaseModel):
    openwam_version: int = 2200
    step_size: float = 1.0 # degrees
    duration_cycles: int = 10

class SimConfig(BaseModel):
    simulation: SimulationConfig = SimulationConfig()
    environment: EnvironmentConfig = EnvironmentConfig()
    intake: IntakeConfig = IntakeConfig()
    engine: EngineConfig = EngineConfig()
    exhaust: ExhaustConfig = ExhaustConfig()
    
    # Fuel config missing in models.py but used in wam_generator line 128 (c.fuel.lcv)
    # Adding FuelConfig placeholder to avoid next error
    class FuelConfig(BaseModel):
        lcv: float = 44000000.0
        density: float = 750.0
    
    fuel: FuelConfig = FuelConfig()

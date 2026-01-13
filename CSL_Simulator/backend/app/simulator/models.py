from pydantic import BaseModel
from typing import Optional, List, Union

class IntakeConfig(BaseModel):
    type: str
    trumpet_length: float
    plenum_vol: float
    bellmouth_geom: Optional[str] = None

class EngineConfig(BaseModel):
    cams_intake: str
    cams_exhaust: str
    head_port_coeff: Optional[float] = 1.0

    # Simulation & Engine Block defaults
    block_exists: bool = True
    cylinders: int = 6
    rpm: float = 8000.0
    throttle_position: float = 1.0 # 0.0 to 1.0
    initial_pressure: float = 1.0  # bar
    initial_mass: float = 0.001
    fuel_type: int = 1  # 0: Diesel (MEC), 1: Petrol (MEP)
    equivalence_ratio: float = 1.0  # For MEP
    fuel_mass: float = 0.0 # For MEC
    combustion_efficiency: float = 1.0
    u_lcv: float = 44000000.0  # Lower Calorific Value (J/kg)
    fuel_density: float = 750.0 # kg/m3
    
    # Geometry
    bore: float = 87.0 # mm
    stroke: float = 91.0 # mm
    conrod: float = 139.0 # mm
    compression_ratio: float = 11.5
    
    # Heat Transfer (Woschni)
    woschni_c1: float = 2.28
    woschni_c2: float = 0.00324
    woschni_exp: float = 0.8 # xpe
    
    # Wall Temperatures
    temp_piston: float = 550.0
    temp_head: float = 450.0
    temp_cylinder: float = 400.0

    # Friction (Chen-Flynn or similar coefficients)
    friction_c0: float = 0.13
    friction_c1: float = 0.0
    friction_c2: float = 0.0
    friction_c3: float = 0.0

class ValveConfig(BaseModel):
    diameter: float
    lift_max: float

class Section1Config(BaseModel):
    type: str
    cat: bool
    x_location_offset: float

class Section2Config(BaseModel):
    type: str
    resonator: bool = True

class ExhaustConfig(BaseModel):
    header: str
    section1: Section1Config
    section2: Section2Config
    section3_type: str = "Stock"

class SimulationConfig(BaseModel):
    intake: IntakeConfig
    engine: EngineConfig
    exhaust: ExhaustConfig
    rpm_start: int = 1000
    rpm_end: int = 8000
    rpm_step: int = 500

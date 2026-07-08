
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
    # Values the frontend's exhaust layout selectors emit (dual-bank / single pipe);
    # without these the UI's SimConfig fails validation (422). Treated as a straight
    # pipe by the generator (no X/H crossover branch).
    INDEPENDENT = "Independent"
    SINGLE = "Single"

# 1. Intake System
class InletConfig(BaseModel):
    # MEASURED car defaults (2026-07, PLAN_PARTLOAD_CALIBRATION.md Phase 3.5):
    # 400mm duct, phi190 inlet, opening into the plenum through a 550x190 slot.
    # The legacy 350xphi200 straight duct is pinned in golden_deck_check.py.
    duct_length: float = 400.0 # mm
    duct_diameter: float = 190.0 # mm (inlet-side inner diameter)
    # Plenum-side slot opening (measured car: 550x190 mm). None -> circular
    # (= duct_diameter). The 1D solver's D is an AREA schedule, so a slot maps
    # to its area-equivalent diameter Deq = sqrt(4*W*H/pi), NOT hydraulic dia.
    exit_width: Optional[float] = 550.0  # mm
    exit_height: Optional[float] = 190.0 # mm
    filter_diameter: float = 300.0       # mm (slot Deq used when exit_* given)
    filter_thickness: float = 20.0       # mm

class BellmouthConfig(BaseModel):
    # MEASURED trumpet length (owner's car, 2026-07): 170mm. Adopted as the
    # production default (Stage 62/63): re-scored vs the owner's real kf_rf_soll,
    # 170mm gives WOT mean|err| 9.1pp vs 150mm's 13.9pp (owner 2700 WOT 74.8 ==
    # sim170 76.2). The legacy 150mm placeholder is pinned in golden_deck_check.
    length: float = 170.0 # mm (Bellmouth funnel, Plenum to ITB) — measured owner trumpet
    diameter: float = 52.0 # mm (Opening, tapers from 70mm entry)
    taper_angle: float = 3.5 # degrees (Ram Theory)

class ITBConfig(BaseModel):
    fitted: bool = True
    diameter: float = 52.0 # mm
    plate_thickness: float = 2.0 # mm
    discharge_coeff_map: str = "default_butterfly" # Reference to lookup

class ThrottleConfig(BaseModel):
    # Butterfly pedal->angle mapping (TP = idle_offset + (90-idle_offset)*pedal^gamma).
    # Promoted from OPENWAM_THR_OFFSET / OPENWAM_THR_GAMMA. Defaults reproduce legacy.
    idle_offset_deg: float = 2.0   # always-open blade angle (idle bypass / blade gap)
    pedal_gamma: float = 1.4       # >1 = progressive metering; was env OPENWAM_THR_GAMMA

class RunnerConfig(BaseModel):
    # Intake runner geometry (promoted from hardcoded constants + OPENWAM_RUNNER_SC /
    # OPENWAM_RUNNER_FRIC_MULT). The runner bore = ITB diameter (intake.itb.diameter).
    # MEASURED car (2026-07): 10mm throttle->EQ tap, 60mm tap->port split.
    upper_length: float = 10.0      # mm (throttle -> eq-tube branch)
    lower_length: float = 60.0      # mm (eq-tube branch -> port split)
    entry_diameter: float = 70.0    # mm (velocity-stack mouth, tapers to ITB bore)
    length_scale: float = 1.0       # global ram-length scalar (was OPENWAM_RUNNER_SC)
    friction_multiplier: float = 1.0  # intake-tract friction scale (was OPENWAM_RUNNER_FRIC_MULT)

class EqTubeConfig(BaseModel):
    # Equalization tube (Gleichdruckrohr). Promoted from OPENWAM_EQ_* / OPENWAM_NO_EQTUBE
    # / OPENWAM_EQ_CHAIN. Defaults reproduce the validated Stage-35/56 plenum model.
    enabled: bool = True
    model: str = "rail"             # "rail" (measured car: ICV-vented common rail; DEFAULT
                                    # since Phase 3.5) | "plenum" (legacy) | "chain"
    stub_diameter: float = 30.0     # mm (phi30 is the smallest stable area ratio; phi10 NaN'd)
    stub_length: float = 75.0       # mm (per-cylinder stub base length)
    stub_friction: float = 0.02     # part-throttle resonance damping
    volume_scale: float = 1.0       # central-plenum (141cc) acoustic-coupling scale
    mistune_spread: float = 0.0     # per-cyl stub-length half-spread (detunes cyl-2 collapse)
    # --- "rail" model (measured 2026-07): a phi21x570mm common rail taps all six
    # runners and returns to the MAIN PLENUM via a phi21x250mm hose through the
    # ICV (idle valve) -- a throttle-bypass path, i.e. the physical low-load
    # effective-area lever (Stage 49 gap). Tap diameter defaults to the phi30
    # NUMERICAL floor (phi52:phi21 = 6.1:1 area ratio exceeds the ~3:1 Type-12
    # stability limit, Stage 35); the physical phi21 stays available for A/B.
    rail_diameter: float = 21.0        # mm common-rail inner diameter
    rail_length: float = 570.0         # mm tap-1..tap-6 span (5 segments)
    rail_tap_diameter: float = 30.0    # mm numerical stability floor (physical: 21)
    rail_tap_length: float = 30.0      # mm runner-tee -> rail-tee stub (10mm re-collapses
                                       # 2700/6300 WOT -- keep 30, Phase-3 A/B)
    return_pipe_diameter: float = 21.0 # mm rubber return hose
    return_pipe_length: float = 250.0  # mm
    return_tap: str = "center"         # "center" | "cyl1_end" | "cyl6_end"
    icv_sigma: float = 0.15            # ICV effective open-area ratio (of the return
                                       # pipe bore); FIT parameter (Phase 4A), not measured
    # Rail-mode damping (Phase 3.2/3.3): 0.02-0.03 lets a runner-to-runner
    # cross-feed mode collapse one END cylinder at 2700 WOT (converged collapse,
    # spread ~1.0). 0.1 on both the taps and the rail/return kills it (0.2
    # equivalent -> insensitive/robust); physically defensible for drilled tap
    # ports + a corrugated rubber rail. Legacy plenum/chain stubs keep
    # stub_friction 0.02.
    rail_friction: float = 0.1         # rail segments + return hose
    rail_tap_friction: float = 0.1     # tap stubs

class PlenumBoxConfig(BaseModel):
    # Stage 64 — multi-cell airbox (intake acoustic remodel). The real 22.9L box
    # carries internal standing waves: the S54 firing order 1-5-3-6-2-4 draws
    # from the box's two halves (cyl 1-3 / 4-6) perfectly alternately, forcing
    # an ANTI-SYMMETRIC (bank-differential) mode at engine orders 1.5/4.5/7.5.
    # The box's first longitudinal mode (~550mm trumpet row -> ~318 Hz) driven
    # at order 4.5 resonates ~4240 rpm = the owner car's real ~4400 VE peak.
    # A 0D perfect-mixing plenum cannot carry that mode (bank-differential
    # pressure is identically zero) -> the sim's 3900 hole. "cells" splits the
    # box into N 0D cells joined by fat 1D connector pipes (Type-11 both ends,
    # the muffler->tail->ambient precedent): the connector gas column between
    # two compliances is a Helmholtz mode f = (a/2pi)*sqrt((A/L_eff)(1/V1+1/V2))
    # tunable onto 3900-4400. Every trumpet mouth stays a Type-11 boundary, so
    # the MOUTH_RAD alpha damping (the only proven WOT monostability mechanism)
    # still applies at every mouth. Default "single" = legacy 0D (byte-identical,
    # pinned in golden_deck_check).
    model: str = "single"              # "single" (legacy 0D) | "cells"
    n_cells: int = 2                   # 2 | 3 | 6 (6 = quasi-1D box)
    connector_diameter: float = 230.0  # mm (box Deq = open box; small = baffled)
    connector_length: float = 70.0     # mm (cell-center pitch, lumping-corrected)
    connector_friction: float = 0.02
    connector_dx: float = 0.025        # m mesh
    duct_cell: int = 1                 # 1-based cell fed by the duct/filter
    duct_split: bool = False           # duct tees into 2 half-area filters -> cells 1&2
    icv_return_cell: int = 1           # 1-based cell the EQ-rail ICV return vents to
    # Cell volume fractions (len == n_cells). None = equal split of
    # (plenum_vol - connector volumes): total box gas volume is CONSERVED so the
    # low-frequency (duct-Helmholtz / mean-flow) behaviour the 5 matched WOT
    # columns depend on is untouched.
    volume_split: Optional[List[float]] = None


class IntakeConfig(BaseModel):
    type: str = "CSL Replica"
    inlet: InletConfig = InletConfig()
    plenum_vol: float = 22.9 # Liters (measured 2026-07; legacy model was 10.5)
    plenum_box: PlenumBoxConfig = PlenumBoxConfig()  # Stage 64 multi-cell airbox
    bellmouth: BellmouthConfig = BellmouthConfig()
    itb: ITBConfig = ITBConfig() # New ITB Module
    throttle: ThrottleConfig = ThrottleConfig()
    runner: RunnerConfig = RunnerConfig()
    eq_tube: EqTubeConfig = EqTubeConfig()
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
    lift_profile: str = "S54 CSL"
    max_lift: float = 11.8 # mm
    # Geometric cosine-lift window (deg). This build runs the STANDARD S54B32
    # 260°/260° cams (set per-side in HeadConfig below); the CSL's wider 268/264
    # cams are NOT fitted.
    duration: float = 260.0 # deg (standard S54)
    diameter: float = 35.0 # mm
    flow_coeff_map: str = "S54_Stock_Port" # Reference to flowbench data

class PortConfig(BaseModel):
    diameter: float = 45.0 # mm
    length: float = 100.0 # mm

class HeadConfig(BaseModel):
    port_flow_coeff: float = 1.0 # Scalar modifier (Stable Baseline)
    valves_per_cyl: int = 4
    wall_temp: float = 450.0 # K
    # This engine is a STANDARD E46 M3 (S54B32) with STOCK cams = 260° intake /
    # 260° exhaust (the CSL's wider 268/264 cams were NOT fitted). The only CSL
    # conversion is the intake plenum (and its 50φ×700mm flap-pipe is REMOVED, so
    # the modelled short-snorkel intake matches the real hardware). Cam offsets use
    # the CSL stock DME VANOS schedule.
    intake_valve: ValveConfig = ValveConfig(max_lift=11.8, duration=260.0)
    exhaust_valve: ValveConfig = ValveConfig(max_lift=11.2, duration=260.0, diameter=30.5)
    intake_port: PortConfig = PortConfig(diameter=52.0, length=105.0) # S54 CSL Spec
    exhaust_port: PortConfig = PortConfig(diameter=48.0, length=90.0)  # S54 CSL Spec
    port_friction: float = 0.05 # F1-Spec Port Job (was 0.3-0.5)
    intake_port_wall_temp: float = 127.0 # degC, dominant intake charge-heat input (was env OPENWAM_PORT_TWALL)

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
    vanos_intake_bias: float = 0.0 # deg (dynamic target from kf_evan1_soll map)
    vanos_exhaust_bias: float = 0.0 # deg (dynamic target from kf_avan1_soll map)

    # MSS54 DME VANOS reference offsets — K_EVAN1_OFFSET / K_AVAN1_OFFSET.
    # Unit on the DME is "W" = Winkel (German "angle") = °KW (degrees crankshaft).
    # These are the fixed mechanical VANOS *zero-reference* trims read from the
    # CSL DME: they shift where the cam actually sits for a given commanded map
    # target, correcting cam-vs-crank sensor mounting error. The effective cam
    # phase is therefore (map target ± offset). Applied on top of vanos_*_bias
    # using the same sign convention (positive = advance) in WAMGenerator.
    # Values below are the CSL-spec settings read from the uploaded MSS54 binary.
    vanos_intake_offset: float = -2.0  # K_EVAN1_OFFSET (CSL): -2° KW
    vanos_exhaust_offset: float = 1.0  # K_AVAN1_OFFSET (CSL): +1° KW

# 3. Exhaust System (Modular Toplogy)
class HeaderConfig(BaseModel):
    type: str = "Stock Euro"
    primary_length: float = 300.0 # mm [KI Master Spec: 300mm Headers]
    primary_diameter: float = 48.0 # mm
    collector_count: int = 2 # 2 for 6-cyl (3-into-1 x 2)
    collector_vol: float = 1.5 # Liters
    collector_dia: float = 68.0 # mm
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
    # Owner's car = EQUAL-LENGTH CROSSPIPE on the front pipe (pre-cat). Adopted
    # as the production default (Stage 63) to make the sim topologically faithful
    # to the real car (the crossover is wired in wam_generator._generate_full_exhaust;
    # stock M3 = STRAIGHT independent banks). The legacy STRAIGHT deck is pinned in
    # golden_deck_check. NOTE: the WOT base points + part-load hybrid were fit at
    # STRAIGHT and are being re-fit under X (X shifts the exhaust dynamics: e.g.
    # 4600 drops with the straight-fit base until re-fit).
    layout: ExhaustLayoutType = ExhaustLayoutType.X_PIPE
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
    # Exhaust port-merge junction (2 ports + 1 header) topology selector, in cc:
    #   > 0  : small 0D plenum of this volume per cylinder.
    #   <= 0 : plenumless Type-12 Riemann junction (DEFAULT).
    # A small plenum was tried first because the plenumless junction diverged to
    # NaN under blowdown, but that divergence was driven by the cold-start
    # cylinder seed (now floored in TCilindro4T). With the seed fixed, the
    # plenumless Type-12 is stable with zero NaN and zero aborts, whereas every
    # plenum volume either aborts (StudyInflowOutflowMass, cociente>=2) or
    # collapses the timestep (projected 133 h for the 480-point sweep). See
    # docs/EXHAUST_STABILIZATION_NOTES.md for the A/B data.
    port_junction_vol: float = 0.0
    # Exhaust-port pipe mesh size (m). Configurable for stability experiments.
    # NOTE: a mesh sweep (10/20/30/45 mm) showed the cyl-3 blowdown NaN is
    # mesh-INDEPENDENT (NaN ~92-102 at every size), so the port mesh is not the
    # root cause; 20 mm only "finished" because the whole gas mass had gone to
    # ~1e-77 g (a dead system that integrates instantly, not a valid solution).
    # Kept at the original 10 mm. See docs/EXHAUST_STABILIZATION_NOTES.md.
    exhaust_port_mesh: float = 0.010

# Root Config
class EnvironmentConfig(BaseModel):
    ambient_temp: float = 298.0
    ambient_pressure: float = 101325.0

class SimulationConfig(BaseModel):
    openwam_version: int = 2200
    step_size: float = 1.0 # degrees
    # Engine cycles to run (the deck's HARD CAP -- convergence is judged by the
    # VE slope and the runner early-stops well before this when settled). The
    # legacy geometry converged in ~25-30 cycles; the MEASURED geometry (22.9L
    # plenum + rail) needs up to ~45-50 at WOT (2700 b130: cyc43, 3900 b130:
    # cyc45), so 30 truncated every WOT cell un-converged. 60 is the safe cap;
    # thanks to the slope early-stop, converged cells cost the same as before.
    # (The transient runner overrides this from duration_sec; this default only
    # applies to steady, direct-SimConfig use.) Stage 36 -> Stage 57.
    duration_cycles: int = 60

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

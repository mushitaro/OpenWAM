# Handoff — VE under-fill root cause (for the next session)

**Branch:** `claude/serene-hamilton-1qUlf` (PR #10) → continued on
`claude/admiring-carson-slqOr` (stacked draft PR, base `serene-hamilton`).
**Date:** 2026-05-31

This is a continuation note so a fresh session can pick up immediately. Read this
first, then `docs/EXHAUST_STABILIZATION_NOTES.md` Stage 15-16 for the detail.

---

## ⟶ UPDATE (Stage 16 cont.): the A-vs-B question is ANSWERED — it's (A) energy gain

The Stage-16 "next step" (instrument the intake energy/mass balance) is **done**.
A per-pipe energy/mass-flux balance probe (`OPENWAM_ENBAL`) was added and run on
the combustion-OFF deck. Conclusions (full detail in EXHAUST notes "Stage 16
(cont.)"):

1. **It is energy GAIN (A), not a pipe mass-leak (B).** Every intake *pipe*
   conserves mass and energy to a few %. The heat **localises to the airbox
   plenum** (`Plenum_Main`): the temperature jumps from ~290–450 K at the
   filter to ~570–700 K at the bellmouth, i.e. across the plenum. The plenum
   energy equation is the correct well-mixed Benson form — it is simply *fed*
   hot gas **backflowing from the cylinders** through the WOT-open throttle.
   With combustion OFF a motoring cycle must return its compression work, so
   the steady positive enthalpy deposited in the airbox each cycle is the
   spurious energy → ≈570 K trapped charge → low density → the ~57–67 % VE
   ceiling. **It is energy non-conservation at the cylinder↔intake-valve gas
   exchange**, not the pipes or the plenum.

2. **Separate concrete defect found:** the φ10 `EqTube_Stub` blows up at its
   Type-12 junction (2.76 kg/s, 2771 K, 10 MW, gross non-conservation) — a
   small-area-at-junction density runaway (`TCCRamificacion` area-weights the
   common sound speed; the φ52 runners are 27× the stub). Enlarging the stub
   (`OPENWAM_EQ_DIA=0.052`) kills the runaway; **removing the eq-tube entirely**
   (`OPENWAM_NO_EQTUBE=1`) does **not** cool the intake, so the stub is a
   *symptom amplifier*, not the root.

**NEXT SESSION revised target (supersedes §3 below):**
- **Primary:** instrument the **per-cycle net enthalpy** the intake valve
  (`TCCCilindro::FlujoSalienteCilindro`/`FlujoEntranteCilindro`) exchanges with
  the cylinder (`TCilindro4T`). Motoring should integrate to ≈ the wall heat
  loss, not a positive deposit; a positive per-cycle deposit is the bug. It
  should NOT be HLLC-specific (the valve BC is the Benson characteristic method).
- **Secondary:** make `TCCRamificacion` mass/energy-consistent at large area
  ratios, or at minimum fix the stub geometry φ10 → φ20 (the comment and the
  eq-tube volume both say φ20).

New diagnostic assets: `OPENWAM_ENBAL[/_MAX/_WIN]`, `OPENWAM_NO_EQTUBE`,
`OPENWAM_EQ_DIA`, and `scripts/intake_energy_balance.py`.

---

## 1. What this project is

OpenWAM is a 1-D gas-dynamics engine simulator (C++). A Python layer in
`CSL_Simulator/backend/` generates an OpenWAM `.wam` input deck
(`app/simulator/wam_generator.py` -> `WAMGenerator`) for an **E46 M3 CSL (S54
3.2L NA I6)** and runs the solver. **Goal: make the simulated volumetric
efficiency (VE) match the measured stock CSL VE curve (~95-109% across RPM).**

Stock VE target: `app/data/stock_csl_ve.json`. ECU maps (kf_evan1_soll etc.):
`app/data/csl_ecu_maps.json`. Uploaded DME binary: `app/data/uploaded_mss54.bin`.

## 2. THE headline conclusion (proven this session)

**The remaining VE shortfall is a NUMERICAL ARTIFACT in the solver's intake gas
handling — NOT physics, calibration, valve timing, exhaust back-pressure, or the
exhaust freeze.**

- Converged VE (HLLC, 10-20 cycles, 4000 RPM WOT) is **~57-67%** vs stock ~102%.
- The trapped charge is **~570 K** when it should be ~300-330 K. That hot charge
  alone explains the low density / low VE (`if T were 298 K, VE would be ~130%`).
- It is hot because the **intake gas itself runs ~570 K everywhere — including the
  bellmouth, which is upstream of the throttle and surrounded by a 25 degC air
  source, 40 degC walls and a 40 degC plenum. That is thermodynamically
  impossible without a heat source -> the solver is adding spurious energy (or
  losing intake mass, which drives T = P/(rho*R) high at fixed P).**

### How it was proven (two decisive tests — reproduce these to re-anchor)
1. **Overlap/IVC sweep:** trapped T and VE are FLAT (~570 K, ~67%) across overlap
   0-64 deg and IVC 30-110 deg ABDC. Zero overlap (IVO knob 380) still = 590 K.
   => not overlap back-flow, not late-IVC back-flow, not valve timing at all.
2. **Combustion OFF** (zero the fuel LHV in the .wam): intake STILL ~550-595 K,
   VE still ~57%. No heat source anywhere, yet the intake is 570 K => artifact.

### What was RULED OUT (with data, this session)
- Exhaust back-pressure: measured **normal ~1.0 bar** (exhaust-stroke cylinder
  mean 1.02 bar; manifold profile flat ~1.01 bar, every component drop <0.005
  bar). **NB: an earlier Stage-15 claim of "1.4-1.8 bar high back-pressure" was
  WRONG — it read an instantaneous VLVWIN sample, not the stroke mean. Corrected.**
- Intake delivery restriction: port mean P 0.99 bar, ~0.02 bar drop from plenum.
  Delivery is fine.
- Boundary/wall/source temperatures: two real Kelvin-as-degC bugs were found and
  FIXED (see below) but **fixing them did not change VE** -> the heat is gas-borne.
- The exhaust NaN/freeze: solved by `OPENWAM_HLLC=1` (NaN=0, completes). The VE
  ceiling persists with the freeze gone, so the freeze was only hiding it.

## 3. NEXT STEP (start here)

> **SUPERSEDED by the UPDATE banner at the top.** This step (instrument the
> energy/mass balance) is DONE: the answer is (A) energy gain, localised to the
> cylinder↔intake-valve gas exchange (suspect #3 below), with the Type-12 eq-tube
> junction (#2) a separate symptom amplifier. The HLLC suspect (#1) is unlikely
> (the valve BC is the Benson characteristic method, scheme-independent). Kept
> below for the original reasoning.

Instrument the **intake energy/mass balance** in the C++ solver and decide:
**(A) energy is gained with no heat input** (energy-equation / flux source-term
bug) **or (B) intake mass is lost** (density driven low -> high T at fixed P).

Suspects, in order:
1. **HLLC flux energy term** — all converged runs use `OPENWAM_HLLC=1`. The
   non-HLLC scheme freezes before converging so the artifact could not be
   isolated to HLLC vs general. First question: is the artifact HLLC-specific?
2. **Type-12 intake junctions** (`TCCRamificacion`) — the eq-tube branch and the
   port split. Check energy/enthalpy conservation across them.
3. **Intake-valve BC** (`Source/Boundaries/TCCCilindro.cpp`) — the filling path
   `FlujoEntranteCilindro` / entropy-corrected characteristics.

Concrete probes to add/use:
- Sum intake-pipe mass over a cycle (is mass conserved cell-to-cell / across
  junctions?). If mass leaks -> (B).
- Track internal energy / total enthalpy through the intake with no combustion.
  If `e` rises with no heat flux -> (A).
- Check `TTubo::CalculoPropiedadesGas` (`Source/1DPipes/TTubo.cpp` ~line 1278:
  `Frho[i] = BarToPa(FPresion0[i]) / FRMezcla[i] / FTemperature[i];`) and the
  flux update for where T/rho diverge from the inflow state.

## 4. How to run things (exact recipes)

Binary: `/home/user/OpenWAM/build/bin/release/OpenWAM` (Linux, prebuilt).
Always run single-thread and with HLLC:
```
env OMP_NUM_THREADS=1 OPENWAM_HLLC=1 OPENWAM_IVO=330 <BIN> model.wam
```
Generate a deck from Python (cwd = `CSL_Simulator/backend`):
```python
import os; os.environ["OPENWAM_HLLC"]="1"; os.environ["OPENWAM_IVO"]="330.0"
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator
cfg = SimConfig(); cfg.engine.rpm=4000.0; cfg.engine.throttle_position=1.0
cfg.simulation.duration_cycles=10; cfg.exhaust.port_junction_vol=0.0
content = WAMGenerator(cfg, "/tmp").generate(ignition_timing=20.0)
open("/tmp/m.wam","w").write(content)
```
A WOT 4000-RPM, 10-cycle run is ~35-60 s. Output: `<model>INS.DAT` (per-step,
~10-14 MB, columns `Pressure_Cyl_1(bar)`, `Temperature_Cyl_1(degC)`,
`Mass_Cyl_1(kg)`, `P_duct_<id>_at_0_m(bar)`, ...) and `<model>AVG.DAT`.

**VE math:** `M_REF = rho_amb * V_cyl = 0.6408 g/cyl` (298 K, 1 bar, bore 87 /
stroke 91 mm). `VE% = trapped_g / 0.6408 * 100`. Trapped mass = peak
`Mass_Cyl_1` in the 480-650 deg (gas-exchange) window, or the last
`INFO: Trapped mass: X (g)` lines on stdout (take the converged-cycle value, not
the start-up overshoot).

**Decisive repro — numerical artifact:** zero the fuel LHV in the generated deck
and confirm the intake stays hot:
```python
content = content.replace("0.98 44000000 750", "0.98 1 750")  # combustion ~off
```
then run with `OPENWAM_INTEMP=1` and read the `INTEMP pipe3:`/`pipe7:` lines.

## 5. Diagnostic env flags (all default OFF, env-gated)

| flag | what it prints / does | source |
|---|---|---|
| `OPENWAM_HLLC=1` | HLLC approx-Riemann flux (kills the cyl-3 freeze) | TTubo.cpp/.h |
| `OPENWAM_INTEMP=1` | intake gas T at pipes 3 (bellmouth) & 7 (port) | TTubo.cpp:1284 |
| `OPENWAM_VLVWIN=1` | intake valve open-window: Theta, Vcyl, p_cyl, T_port, dir (ENT fill / SAL back) | TCCCilindro.cpp:251 |
| `OPENWAM_FILLDIAG=1` | intake valve fill: port P/rho vs cyl, mass flow | TCCCilindro.cpp:284 |
| `OPENWAM_VOLDIAG=1` | cyl-1 volume/P/mass trace | TCilindro4T.cpp:697 |
| `OPENWAM_IVO=<deg>` | intake-valve-open base angle (gas-exch TDC=360); default 330 | wam_generator.py:1364 |
| `OPENWAM_IN_DUR=<deg>` | override intake cam duration | wam_generator.py |
| `OPENWAM_ENBAL=1` | per-pipe mass+enthalpy flux balance at both ends, per crank window (the A-vs-B probe) | TTubo.cpp (CalculaResultadosMedios) |
| `OPENWAM_ENBAL_MAX=<id>` | highest pipe id ENBAL prints (default 16) | TTubo.cpp |
| `OPENWAM_ENBAL_WIN=<deg>` | ENBAL averaging window (default 720) | TTubo.cpp |
| `OPENWAM_NO_EQTUBE=1` | generate deck WITHOUT the equalization tube (isolates it) | wam_generator.py |
| `OPENWAM_EQ_DIA=<m>` | override eq-tube stub diameter (area-mismatch test; default 0.010) | wam_generator.py |

Reusable scripts in `CSL_Simulator/backend/scripts/`:
- `intake_energy_balance.py` — runs the combustion-OFF ENBAL case (baseline /
  noeq / bigstub) and prints the per-pipe balance + localisation table. **Start here.**
- `ivo_sweep.py` — IVO sweep (first-cycle; NOTE converged VE is flat vs IVO).
- `exhaust_backpressure_diag.py` — exhaust pressure profile (proves back-pressure normal).
- `ve_first_cycle_sweep.py` — first-cycle VE vs RPM (interim; inflated by overshoot).

## 6. What changed this session (commits, newest first)

- `c841b96` docs: Stage 16 RESOLVED — VE ceiling is a numerical artifact.
- `28e33ce` fix: cool the intake air-source plenums (Ambient_Intake / Plenum_Main
  / Equalization_Tube were 300/313 = read as 573/586 K). Correct but VE-neutral.
- `47a088b` fix: intake pipe walls + engine ambient were Kelvin-as-degC
  (300/313/400 / 298 -> 573/586/673 / 571 K). Fixed to 27/40/127 degC / ambient.
  VE 50% -> ~57%. (Exhaust 700/800 and block "60" were already correct degC.)
- `4e11c60` calib: IVO base 330 (best single static). **Now known moot** —
  converged VE is insensitive to IVO; keep 330 but it is not the lever.
- `45aa460` feat: CSL cam **268 intake / 264 exhaust** (was standard-S54 260/260)
  + MSS54 VANOS reference offsets `vanos_intake_offset=-2`, `vanos_exhaust_offset=+1`
  (K_EVAN1/K_AVAN1_OFFSET, deg KW; applied in `_add_valve_def`, same sign as bias).

### Unit convention landmine (important)
OpenWAM reads ALL pipe/plenum wall temps, the atmosphere temp, and block wall
temps as **degC** and applies `degCToK()` (`TTubo.cpp:1152/2518`,
`TOpenWAM.cpp:623`, `TBloqueMotor.cpp:67`, `TDeposito`). When editing
`wam_generator.py`, write temperatures in **Celsius**. Exhaust values (700/800)
are intentionally degC (800 degC = 1073 K is a correct WOT header temp).

## 7. Key files / line anchors (may drift a few lines)

- `app/simulator/wam_generator.py`
  - `_add_valve_def` ~1335: IVO base + VANOS offset + valve lift/Cd curves.
  - `_generate_intake` ~484: intake topology; plenum temps (Ambient_Intake ~499,
    Plenum_Main ~531, Equalization_Tube ~568); pipe walls (bellmouth/runner/port).
  - `_add_pipe` ~1187 / `_finalize_pipes` ~1207: pipe line 3 = `"{Twall} {Twall} {P} 0.0"` (degC).
  - `_add_plenum` ~1635: plenum line 3 = `"{vol} {P} {Twall}"` (degC).
  - engine block `_generate_engine_block` ~235: P_amb/T_amb (~375, now degC),
    block wall temps "60" degC, Woschni, Wiebe.
- `app/models.py`: `SimConfig` (cam 268/264, vanos offsets -2/+1, geometry, etc.).
- `docs/EXHAUST_STABILIZATION_NOTES.md`: Stage 1-16 log. **Stage 16 = current truth.**
- `docs/MODEL_SPEC.md`: topology + spec tables + change history.

C++ (next-step targets):
- `Source/1DPipes/TTubo.cpp` / `TTubo.h` — pipe gas dynamics, HLLC flux,
  `CalculoPropiedadesGas` (T/rho), `Transforma1`.
- `Source/Boundaries/TCCCilindro.cpp` — valve BCs, VLVWIN/FILLDIAG.
- Type-12 junction class `TCCRamificacion`.

## 8. Status / housekeeping

- Working tree clean, branch pushed, PR #10 up to date.
- Calibration values that ARE believed correct and should stay: CSL cam 268/264,
  VANOS offsets -2/+1, IVO base 330, the degC temp fixes.
- The one open problem is the intake numerical artifact (Section 3). Everything
  else (freeze, back-pressure, timing, boundaries) is resolved or ruled out.

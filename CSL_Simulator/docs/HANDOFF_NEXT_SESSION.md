# HANDOFF — CSL_Simulator VE calibration (continue here)

Branch: `claude/admiring-carson-slqOr`  ·  PR #11  ·  full log: `CSL_Simulator/docs/EXHAUST_STABILIZATION_NOTES.md` (Stages 16–49)

## ⚡ Stage 49 happened — read it before the Stage-48 plan below
The Stage-48 (B) item is DONE and its premise INVERTED (notes Stage 49):
- `OPENWAM_THR_CHOKE=1` = exact compressible/CHOKED-orifice throttle BC (default OFF =
  byte-identical legacy). Verified to machine precision against the analytic orifice;
  steady flow = `rho1·a1·A_t·Psi(max(r,r*))/sqrt(1-sigma^2)`, b1=r fixed point (no
  singularity, K_CEIL obsolete under the gate). `OPENWAM_THR_AGAIN` = effective-area gain.
- A choked orifice flows LESS than the legacy quadratic loss at equal area (chi>=1) — the
  low-load×high-rpm under-fill is an effective-AREA calibration gap (~3.2x the floored cd
  at pedal 0.20-0.25), NOT missing choke physics. `kf_rf_soll` is PEDAL->target-fill:
  stock(5300, pedal25)=89.1%, so the old "0.25 pedal -> 63%" anchor was never a stock match.
- NEXT: recalibrate sigma(pedal) in the generator (fill-demand semantics; data points
  sigma_eff(0.20)~0.0635, (0.25)~0.069, WOT~0.96; single AGAIN~3.2 fixes the <=0.25 band
  but over-fills the 0.3-0.45 band ~+5-10% -> curve, not gain), THEN the Stage-48 (A)
  base(rpm,load) fit on top, with `OPENWAM_THR_CHOKE=1` as the production metering law.

## What this is
`CSL_Simulator/` wraps OpenWAM to simulate a BMW S54 (CSL). GOAL: use it as a **VANOS /
front-pipe optimiser** — Sim VE must FOLLOW the **stock VE map** across **throttle × rpm**
(absolute offset is removed by a correction; SHAPE/trend is what matters). Stock data:
`backend/app/data/csl_ecu_maps.json` — `kf_rf_soll` (VE target, 20 rpm × 24 load),
`kf_evan1_soll` (intake VANOS target), `kf_avan1_soll` (exhaust VANOS target);
`backend/app/data/stock_csl_ve.json` is the WOT row. The full map = **480 points** (20×24).

## SOLVED (defaults already fixed in the generator/services)
1. **rpm-flat ~2x VE deficit** = a φ10 equalization-tube stub that ran away at its Type-12
   junction (−10 MW spurious source). Fix: stub **φ10→φ30** (`OPENWAM_EQ_DIA` default 0.030).
   Stage 35. Converged VE 57%→~91-100% across rpm.
2. **Convergence**: intake needs ~25-30 cycles. `SimulationConfig.duration_cycles` 10→30 +
   runner floor `max(30,…)`. Stage 36.
3. **Throttle metering**: butterfly Cd was a discharge coef, not an open-AREA ratio →
   throttle never bit (VE flat vs throttle). Fix: `_get_butterfly_cd` returns
   `Cd_disc·(1−cosθ)`, `K_CEIL` 50→2000. Stage 37. WOT 1.0→97%, 0.25→63%.
4. **cyl-2 collapse** (narrow part-throttle island) — NOT fixable in the deck without
   distorting the VE-rpm shape (friction/chain/mistune all tried, Stages 38-42,46). Instead:
   `OpenWAMOutputParser.cylinder_balance(stdout)` gates it — run with `OPENWAM_VEDIAG=1`, drop
   points where `valid=False` (a cylinder far from the fleet median). Stage 42.
5. **"VANOS over-response"** (WOT over-rammed 150% vs stock 110%): the production
   `run_ve_map_generation` advanced ONLY the intake cam, leaving the exhaust at base → ~76°
   overlap → over-scavenge. Fix: **coordinate the exhaust cam** —
   `vanos_exhaust_bias = OPENWAM_EXVANOS_BASE(150) − kf_avan1_soll`. Stage 47. WOT row now
   tracks stock (3900 torque peak EXACT: 116/116; ratios 0.91-1.17).

## REMAINING WORK (this is where to start) — UPDATED by Stage 48 (read it)
**Part-load tracking, but the Stage-47 premise was WRONG and is now corrected.** Stage 48
re-ran the part-load cells to CONVERGENCE (the old `OMP=1`+`timeout` data was truncated
mid-fill, cyc 12-17, NOT converged) and found:
- The "sim under-predicts everywhere" claim was a **convergence artifact**. The converged
  picture is an **rpm-dependent SHAPE error**: e.g. load-65 healthy VE goes 2700→76% /
  3900→114% / 5300→129% (stock 102/112/107) — sim rises with rpm while stock peaks at 3900.
- The **load-65 gate rejects are the real cyl-2 collapse** (Mtrap ~0.0025 g, identical at
  OMP=1/4), NOT under-convergence. They stay gated; the usable part-load cells are at 5300/6900.
- Converged high-rpm part-load block at base 150 (`backend/ve_highrpm_partload_base150.csv`):
  5 of 6 cells UNDER-fill (5300/65 is the only over-fill, ~the 5300 eq-tube resonance).
- **The EXVANOS_BASE lever is strong, monotonic, nonlinear** (lower base = more overlap =
  HIGHER VE). At 5300 the stock-crossing base is a clean LOAD law: load20→~95, 45→~135,
  65→~162 (WOT~150-157). Data: `backend/ve_sweep5300_65_exvanos_base.csv` + `_lowbase` runs.

**Next — the part-load map needs THREE coordinated fixes (Stage 48 ⑦), not just a base tweak:**
- (A) `base(rpm,load)` where the EXVANOS lever bites: all of 5300 (crossings 20/45/65 ~95/135/162)
  and 6900/65 (~120-130). Fit ANCHORED at base≈150 for WOT so the validated WOT row does NOT
  regress; wire into `run_ve_map_generation`. Re-run **6900/65 base150 LONGER** first (was cyc24).
- (B) the Stage-37 **choked-orifice throttle BC** for the lowest-load high-rpm cells where the
  base lever is DEAD (6900/20 sits 0.67x stock at any base) — they are throttle-saturation limited.
- (C) the gated **cyl-2 collapse** cells stay excluded (Stage-39 balance-tube remodel). NB base
  and the collapse are coupled — a low base can *induce* the collapse (6900/45 valid@150, REJ@110),
  so (A) must be re-checked against the `cylinder_balance` gate.

## HOW TO RUN (important — environment is hostile)
- Build: `cd /home/user/OpenWAM/build && cmake --build . --config Release -j"$(nproc)"`.
  Binary: `/home/user/OpenWAM/build/bin/release/OpenWAM`.
- Generate a deck in Python (sys.path = backend): `from app.models import SimConfig; from
  app.simulator.wam_generator import WAMGenerator`. Set `cfg.engine.rpm`,
  `.throttle_position`, `.vanos_intake_bias`, `.vanos_exhaust_bias`,
  `cfg.simulation.duration_cycles=30`, `cfg.exhaust.port_junction_vol=0.0`; `WAMGenerator(cfg,
  outdir).generate(ignition_timing=20.0)` returns the deck string (write to `m.wam`) and
  writes `intake.vlv`/`exhaust.vlv` into outdir.
- Run: `env OPENWAM_HLLC=1 OMP_NUM_THREADS=4 OPENWAM_VEDIAG=1 <BIN> m.wam`.
- VE: mean of the last 6 `VEDIAG ... Mtrap:X g` / `M_REF`, where
  `M_REF = π(0.087/2)²·0.091·(101325/(287.05·298))·1000 ≈ 0.6408 g` = 100% VE.
- ⚠ **CONVERGENCE/THROUGHPUT is the binding constraint (Stage 48).** A part-load run is
  ~11-26 s/cycle (SLOWER at lower load: deeper vacuum → smaller CFL step), so 30 cycles is
  ~6-15 min. Part-load VE keeps climbing the fill transient until ~cyc 28-30, so anything
  with `cyc < 28` in the CSV is **suspect/under-converged** — do NOT trust truncated cells
  (this is exactly how the Stage-47 map was wrong). `OMP_NUM_THREADS=4` is ~2x and verified
  FAITHFUL to OMP=1 (per-cyl Mtrap within ~1%, incl. the cyl-2 collapse), so run cells
  **SERIALLY with OMP=4** (each finishes inside a reboot window) rather than 3×OMP=1 parallel.
- ⚠ **The container reboots every ~7-15 min** (but can stay up ~30+ min); `/tmp` survives a
  reboot, so the resumable CSVs persist. Use `backend/scripts/exvanos_base_sweep.py`
  (env: `SWEEP_GRID=custom SWEEP_RPMS=.. SWEEP_LOADS=.. SWEEP_BASES=.. SWEEP_CYCLES=30
  SWEEP_OMP=4 SWEEP_CSV=..`; serial OMP=4, appends after EVERY cell, skips done) — re-invoke
  after each reboot. The older `ve_map_resumable.py` uses the truncating OMP=1+timeout pattern.
- ⚠ pip deps (`pydantic`, `numpy`) are NOT preinstalled — `pip install pydantic numpy` first.
- ⚠ Don't copy a fixed `.vlv` over the generator's when testing `OPENWAM_CAM_EXP` (the .vlv IS
  the cam lift profile). For non-cam tests, copying `/tmp/vediag_5300/*.vlv` is fine.
- pandas is NOT installed in the test python; `cylinder_balance` uses only re/statistics.

## ENV LEVERS (default = the SOLVED behaviour unless noted)
`OPENWAM_VEDIAG`(gate data), `OPENWAM_HLLC`, `OPENWAM_EQ_DIA`(=0.030 fix),
`OPENWAM_THR_GAMMA`(=1.4), `OPENWAM_K_CEIL`(=2000), `OPENWAM_PORT_TWALL`(=127),
**`OPENWAM_EXVANOS_BASE`(=150)/`_SCALE`(=1) ← part-load knob; STRONG+monotonic+nonlinear,
lower base = more overlap = higher VE; at 5300 the stock-crossing base by load is ~95/135/162
for 20/45/65% (Stage 48). The production calibration target is a `base(rpm,load)` surface.**,
`OPENWAM_VANOS_SCALE`(no-op, ineffective), `OPENWAM_CAM_EXP`(=1)/`OPENWAM_RUNNER_SC`(=1)
(geometry levers, NOT the over-ram cause), `OPENWAM_EQ_CHAIN/_FRIC/_MISTUNE/NO_EQTUBE`
(eq-tube studies — all distort the VE-rpm shape, keep plenum default),
`OPENWAM_INTAKE_HSINK/IN_HMULT/INTEMP/ENBAL` (diagnostics).

## KEY FILES
- `backend/app/simulator/wam_generator.py` — deck generator (geometry/VANOS/cam levers).
- `backend/app/simulator/simulation_service.py` — `run_ve_map_generation` (480-pt map; now sets
  both intake & exhaust VANOS).
- `backend/app/simulator/output_parser.py` — `cylinder_balance` gate.
- `backend/scripts/exvanos_base_sweep.py` ← **use this** (Stage 48: serial OMP=4, resumable,
  env-configurable grid). Older: `ve_map_resumable.py` (OMP=1+timeout = truncating, avoid),
  `ve_map_compare.py`, `ve_model_shape_compare.py`, `ve_converged_highrpm.py`.
- `backend/ve_highrpm_partload_base150.csv` (converged high-rpm part-load @150),
  `backend/ve_sweep5300_65_exvanos_base.csv` (the EXVANOS_BASE lever) — Stage 48 data.
- `backend/app/data/csl_ecu_maps.json` (stock VE + VANOS), `stock_csl_ve.json` (WOT row).
- `docs/EXHAUST_STABILIZATION_NOTES.md` — Stages 16-48 (read Stage 35,37,42,47,**48** first).

## COMMIT/PUSH
Branch `claude/admiring-carson-slqOr`, draft PR #11. Commit + push each step (the container is
ephemeral): `git push -u origin claude/admiring-carson-slqOr` with retries.

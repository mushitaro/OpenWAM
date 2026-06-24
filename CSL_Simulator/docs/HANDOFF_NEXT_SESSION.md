# HANDOFF — CSL_Simulator VE calibration (continue here)

Branch: `claude/admiring-carson-slqOr`  ·  PR #11  ·  full log: `CSL_Simulator/docs/EXHAUST_STABILIZATION_NOTES.md` (Stages 16–56)

## ⚡⚡⚡ Stage 56 (local MSVC build) — THE INTAKE Q PROBLEM IS SOLVED (C++ radiation damping). Read EXHAUST_STABILIZATION_NOTES Stage 56 first.
- **Built locally with MSVC** (no MinGW): `cmake --build build --config Release` after the RC guard
  in root CMakeLists.txt. Binary at `build/bin/release/OpenWAM.exe`. Diagnostic scripts ported off
  the cloud paths via `CSL_Simulator/backend/scripts/_local.py` (auto BIN/HERE + a portable
  `run_capped`). **Run all calibration sweeps at OMP_NUM_THREADS=1** (see below).
- **ROOT CAUSE fully nailed**: the intake resonance Q was unphysically high → the WOT cycle had
  MULTIPLE co-existing attractors → the converged VE was a CHAOTIC/multistable function of EVERY
  deck parameter (length, eq-vol, mouth-Cd, exhaust base). Three confirmations: cross-compiler shift,
  OMP run-to-run flips (the OpenMP build is NON-DETERMINISTIC at WOT — same deck → 128 vs 71 VE;
  USE omp1 for any calibration), and parametric chaos vs every lever. Deck-only calibration was
  therefore ILL-POSED (Step 3b).
- **THE FIX (works)**: a gated C++ **mouth acoustic-radiation damping** in `TCCDeposito`
  (`OPENWAM_MOUTH_RAD` alpha, `_W` EMA weight; default OFF = byte-identical, verified). It damps only
  the AC (oscillating) end velocity about a per-boundary running mean → lowers Q WITHOUT choking the
  mean flow. Result (omp1): at alpha≈0.4 the WOT cycle is MONOSTABLE across all rpm and VE(base) is
  smooth (jag 34→1.8), AND the WOT curve is now BROAD (range 10.6 ≈ stock 12) — the Step-2 goal no
  deck lever could reach. Calibration is now WELL-POSED.
- **REMAINING (now tractable, this is where to continue)**:
  1. Pick alpha/w (smallest alpha that holds full monostability; check VANOS dVE/d-advance ~10-20pp).
  2. Fit `EXVANOS_BASE(rpm)` with damping ON (now smooth) to lift the 3900 dip / trim the 5300 peak
     toward stock's 3900-peak shape; put it at `simulation_service.py:107` (replaces the const 150).
  3. Re-validate the gates with damping ON: WOT-row regression (the 3900/100 attractor is now a
     SINGLE smooth value, not bistable), cyl-balance gate, NaN-free, choke-OFF byte-identity.
  4. sigma(pedal) low-pedal lock-in (part-load) + the `calibration_service.py:486` WOT-ratio
     correction (now physically valid since the WOT row is monostable/smooth).
  Tooling: `scripts/par_exvanos.py` (deterministic parallel base × rpm × mouth-rad sweep),
  `par_sweep_cfg.py`/`par_sweep_wot.py`/`par_sweep_mouth.py`. Data CSVs `backend/step2_*`, `step3_*`.

---
(historical context below — superseded by Stage 56 for the intake model)

## ⚡⚡ Stages 49–54 — read EXHAUST_STABILIZATION_NOTES Stage 49-54 first. Headline:
The throttle/part-load work is DONE; the binding problem is now the INTAKE ACOUSTIC MODEL.
- **Stage 49**: choked-orifice throttle BC `OPENWAM_THR_CHOKE` (gated, default OFF=legacy).
- **Stage 50**: 32-cell shape map. LOAD-20 row follows stock (r=0.89). Mid/high-load looked off.
- **Stage 51**: that "mid-load deficit" was a CONVERGENCE/init-MAP ARTIFACT. Fixed:
  `intake_map_bar` now from the EFFECTIVE (choke/AGAIN) sigma. Converged 6900 col tracks.
  ⚠ Judge convergence by SLOPE (|dVE/dcyc|<~0.3), never cycle count.
- **Stage 52**: VEDIAG `fresh%`/`Mair` fields are BROKEN (negative; contradict the cool ~375K
  trapped temp). USE Mtrap for VE. The real target = WOT-row over-fill rising with rpm.
- **Stage 53 (ROOT CAUSE)**: the "VANOS over-response" IS the intake-runner RAM RESONANCE.
  At 3900 WOT, over-response d=VE(b60)-VE(b40) = -8/+41/+5 pp at RUNNER_SC 0.8/1.0/1.2 — a
  20% length change flips its SIGN. The resonance is a sharp ridge; stock cam phasing sits on
  the peak.
- **Stage 54**: scalar knobs (RUNNER_SC length, new OPENWAM_RUNNER_FRIC_MULT damping) SHIFT/
  modulate the sharp resonance but CANNOT broaden it to stock's gentle WOT curve (104-116,
  peak 3900). Damping d oscillates +40/-30/+51 (phase shift + flow-choke), not broadening.
  **CONCLUSION: the placeholder intake topology (uniform φ52 runners + central-plenum eq-tube)
  has too-high Q. The fix is an intake GEOMETRY REMODEL to realistic S54 acoustics, NOT scalar
  tuning** (which only moves the error around = the Stage-44 false-optimum trap).

## NEXT PHASE (the fix) — intake geometry remodel (needs FAST compute; do off-box, validate here)
⚠ Stage 55 update: the sharp ram resonance is ROBUST to every available intake scalar/topology
knob (RUNNER_SC length, RUNNER_FRIC_MULT damping, EQ_CHAIN, NO_EQTUBE) — each only RELOCATES
the peak (|d|~40pp persists at 3900 WOT), none BROADEN it. So the fix is NOT reachable by the
existing knobs; it needs deeper, physically-grounded intake acoustics. Also: the intake-only
over-response metric is OVERLAP-contaminated (exhaust held fixed while intake swept overlap
through ~0) — use the COORDINATED WOT VE-shape as the clean target instead.

Clean calibration target (artifact-free): the COORDINATED WOT VE-shape vs rpm. Sim peaks ~4600
with a 6300 notch (range 92-139); stock is broad, peak 3900 (range 104-116). Reproduce stock's
BROAD curve. Candidate deeper levers (need fast iteration): realistic short trumpet + physical
runner L/D; a proper airbox/plenum termination with acoustic radiation loss; and a model-level
look at the plenum-reflection / valve-flow coupling that sets Q (geometry scalars proven
insufficient). Geometry lives in `wam_generator.py` (~634-790 per-cyl loop) + `models.py`.
1. Re-run `runner_tune_wot.py` (COORDINATED cams, WOT, vary RUNNER_SC) TO CONVERGENCE across
   rpm; compare VE-SHAPE (not the intake-only d) to stock. (Longer runners converge slower —
   use cyc>=45 / slope<0.3.)
2. If length alone can't broaden it, add a trumpet/plenum termination-loss model (the Q lever
   the scalars lack), then re-check.
3. ONLY THEN: base(rpm,load) for residual rpm offset + sigma(pedal) low-pedal lock-in (infra
   already in place, Stage 49/50), and the WOT-ratio correction (calibration_service) becomes
   physically valid.
⚠ This env is 10-15 min/WOT-cell and reboots; the geometry remodel needs many iterations →
do the iteration where runs are cheap, port the geometry here to validate.

---
## (older) Stage 49 detail — kept for reference

## ⚡ Stage 49 happened — read it before the Stage-48 plan below
The Stage-48 (B) item is DONE and its premise INVERTED (notes Stage 49, ①-⑦):
- `OPENWAM_THR_CHOKE=1` = compressible/CHOKED-orifice throttle BC as a pure CORRECTION on
  the legacy loss: `K = (1/sigma^2-1)·chi_eff(r)`, chi ramped out above r~0.92 (default
  OFF = byte-identical legacy). Steady flow verified: legacy at r->1, frozen choke plateau
  below r*~0.54; b1=r fixed point (no singularity; K_CEIL obsolete under the gate).
  `OPENWAM_THR_AGAIN` = effective-area gain (cannot touch WOT: sigma ceiling = valve cd).
- A choked orifice flows LESS than the legacy quadratic at equal area (chi>=1): the
  low-load×high-rpm under-fill is an effective-AREA calibration gap, NOT missing choke
  physics (6900/20 choke-at-geometry = 49.8 == legacy 47, stock 70.3). `kf_rf_soll` is
  PEDAL->target-fill: stock(5300, pedal25)=89.1%, so the Stage-37 "0.25 pedal -> 63%"
  anchor was never a stock match — the whole low-pedal region is throttled ~3-5x too shut.
- Measured anchors (CHOKE=1, AGAIN=3.2, base150): 6900/20 -> 65.5 AND 5300/20 -> 78.0,
  BOTH exactly 0.93x their stock — the needed-area rpm-dependence (K_CEIL era: 250 vs
  2000) has COLLAPSED under the choke BC. One sigma(pedal) curve serves all rpm
  (AGAIN_stock(p0.20) ~3.5-3.7); rpm shape stays with the (A) base lever.
- ⚠ NEW LANDMINE (Stage 49 ⑥): the 3900 WOT ram resonance BIFURCATES on the throttle
  termination K — a ~100 Pa loss change flips VE by 30 pts (attractor flip). Unrealistic
  ram Q; remember when calibrating VANOS sensitivity. AND: the recorded WOT row was
  cyc-17 UNCONVERGED (3900/100 converged is ~122, not 116) — the EXVANOS_BASE=150 anchor
  was tuned against a truncated row. Re-record the WOT row at cyc>=28-30 BEFORE fitting
  base(rpm,load).
- NEXT: (i) re-record the converged WOT row (gate-off and CHOKE=1 should now agree);
  (ii) AGAIN sweep 2-3 points per anchor cell (pedal 0.20/0.25/0.39 × 5300/6900) under
  `OPENWAM_THR_CHOKE=1` -> fit sigma(pedal) into the generator (fill-demand semantics);
  (iii) THEN the Stage-48 (A) base(rpm,load) fit on top, re-anchored to the CONVERGED row.

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

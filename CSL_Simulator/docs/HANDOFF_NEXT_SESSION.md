# HANDOFF — CSL_Simulator VE calibration (continue here)

Branch: `claude/admiring-carson-slqOr`  ·  PR #11  ·  full log: `CSL_Simulator/docs/EXHAUST_STABILIZATION_NOTES.md` (Stages 16–47)

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

## REMAINING WORK (this is where to start)
**Part-load tracking.** With coordinated VANOS the **WOT row is great** but at **load 45/20%
the sim UNDER-predicts** (sim/stock ~0.5-0.8) and several **load-65 cells gate-reject**.
Coordinated-VANOS 16-cell map (≈18-cyc, see `backend/ve_map_coordinated_vanos.csv`):
```
load\rpm   2700      3900      5300      6900
 100%    104/95    116/116   110/122   106/124   (WOT: good, peak exact)
  65%    102/67X   112/95X   107/109   101/69X   (3/4 gate-rejected)
  45%     97/70    105/76    102/81     92/75    (sim under ~0.7)
  20%     92/64     86/67     84/60     70/39    (sim under ~0.5-0.8)
```
Two coupled causes to calibrate:
- (a) **Exhaust-VANOS base is WOT-tuned** and over-corrects at low load → make
  `OPENWAM_EXVANOS_BASE/_SCALE` load-dependent (calibrate per row against `kf_rf_soll`).
- (b) **Throttle saturates** (Stage 37): the K-loss model floors MAP ~0.72 bar, so the sim
  can't reach the low-load cells; idle-level vacuum needs a choked-ORIFICE throttle BC (flow
  set by effective area), not a K-loss. The `cylinder_balance` rejections at load-65 may be
  under-convergence (cyc 12-15) — re-check at 30 cycles before treating as real.
Then: run the **full 480-pt** map (`run_ve_map_generation`, 12-way) on a stable machine and
compare to `kf_rf_soll` cell-by-cell; the resumable script gives the methodology.

## HOW TO RUN (important — environment is hostile)
- Build: `cd /home/user/OpenWAM/build && cmake --build . --config Release -j"$(nproc)"`.
  Binary: `/home/user/OpenWAM/build/bin/release/OpenWAM`.
- Generate a deck in Python (sys.path = backend): `from app.models import SimConfig; from
  app.simulator.wam_generator import WAMGenerator`. Set `cfg.engine.rpm`,
  `.throttle_position`, `.vanos_intake_bias`, `.vanos_exhaust_bias`,
  `cfg.simulation.duration_cycles=30`, `cfg.exhaust.port_junction_vol=0.0`; `WAMGenerator(cfg,
  outdir).generate(ignition_timing=20.0)` returns the deck string (write to `m.wam`) and
  writes `intake.vlv`/`exhaust.vlv` into outdir.
- Run: `env OPENWAM_HLLC=1 OMP_NUM_THREADS=1 OPENWAM_VEDIAG=1 <BIN> m.wam`.
- VE: mean of the last 6 `VEDIAG ... Mtrap:X g` / `M_REF`, where
  `M_REF = π(0.087/2)²·0.091·(101325/(287.05·298))·1000 ≈ 0.6408 g` = 100% VE.
- ⚠ **The container reboots every ~7-15 min**, killing long runs. Use the **resumable** driver
  `backend/scripts/ve_map_resumable.py` (appends `/tmp/map_results.csv`, skips done cells, 3
  cells/invocation) — just re-invoke after each reboot. ~4 cores; keep ≤3 parallel.
- ⚠ Don't copy a fixed `.vlv` over the generator's when testing `OPENWAM_CAM_EXP` (the .vlv IS
  the cam lift profile). For non-cam tests, copying `/tmp/vediag_5300/*.vlv` is fine.
- pandas is NOT installed in the test python; `cylinder_balance` uses only re/statistics.

## ENV LEVERS (default = the SOLVED behaviour unless noted)
`OPENWAM_VEDIAG`(gate data), `OPENWAM_HLLC`, `OPENWAM_EQ_DIA`(=0.030 fix),
`OPENWAM_THR_GAMMA`(=1.4), `OPENWAM_K_CEIL`(=2000), `OPENWAM_PORT_TWALL`(=127),
**`OPENWAM_EXVANOS_BASE`(=150)/`_SCALE`(=1) ← part-load calibration knob**,
`OPENWAM_VANOS_SCALE`(no-op, ineffective), `OPENWAM_CAM_EXP`(=1)/`OPENWAM_RUNNER_SC`(=1)
(geometry levers, NOT the over-ram cause), `OPENWAM_EQ_CHAIN/_FRIC/_MISTUNE/NO_EQTUBE`
(eq-tube studies — all distort the VE-rpm shape, keep plenum default),
`OPENWAM_INTAKE_HSINK/IN_HMULT/INTEMP/ENBAL` (diagnostics).

## KEY FILES
- `backend/app/simulator/wam_generator.py` — deck generator (geometry/VANOS/cam levers).
- `backend/app/simulator/simulation_service.py` — `run_ve_map_generation` (480-pt map; now sets
  both intake & exhaust VANOS).
- `backend/app/simulator/output_parser.py` — `cylinder_balance` gate.
- `backend/scripts/ve_map_resumable.py` (reboot-safe map vs stock), `ve_map_compare.py`,
  `ve_model_shape_compare.py`, `ve_converged_highrpm.py`.
- `backend/app/data/csl_ecu_maps.json` (stock VE + VANOS), `stock_csl_ve.json` (WOT row).
- `docs/EXHAUST_STABILIZATION_NOTES.md` — Stages 16-47 (read Stage 35,37,42,47 first).

## COMMIT/PUSH
Branch `claude/admiring-carson-slqOr`, draft PR #11. Commit + push each step (the container is
ephemeral): `git push -u origin claude/admiring-carson-slqOr` with retries.

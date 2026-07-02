# CSL UX App — Handoff (M1–M5 done → calibration / surrogate next)

Continuation doc for `UX_APP_DEV_SPEC.md` §8. **All five build-order milestones (M1–M5)
are implemented and verified** on `claude/csl-ux-app`. This doc is the resume point for
the calibration re-fit / surrogate work that comes AFTER the app scaffold.

## Where we are
- **Branch:** `claude/csl-ux-app` (cut from `master` after PR #12 / Stage-56 merged). **Not pushed** (owner's call).
- **Done (§8 build order, all verified):**
  - **M1** Run → VE table + sim-vs-stock overlay + §5 validity panel + Phase-A RunStore.
  - **M2** eq-tube / runner / throttle / intake-port-wall-temp promoted into SimConfig; ~25 params in the form.
  - **M3** 3D VE surface (Plotly, sim/stock/Δ) + crank-angle waveform view (`POST /simulate/waveform`, INS.DAT parse).
  - **M4** WOT VANOS optimizer (`POST /simulate/optimization`, per-rpm cam coordinate descent, MAX_VE/SMOOTH) + Tuning UI + ECU-table export (TSV/CSV).
  - **M5** cancellable/resumable runs (`POST /simulate/cancel`), project save/load, ETA polish, provenance-aware copy.
- **State of the model:** stable & sweepable (16/20 WOT cells converge), but the VE **shape does not yet match stock** (r≈0.4) because the intake geometry is the owner's by-feel estimate (§10). The app **correctly reports "Not valid"** and every tuning proposal is flagged **low-confidence** until the geometry re-fit. Folding real measured dimensions in via the M2 form + re-fitting EXVANOS is the calibration path — that is the real next work, not more app scaffold.

## Run it (test in your OWN browser, not the embedded preview)
The embedded/preview browser is sandboxed and cannot reach `localhost:8000`, so the app shows but "Run" gives `Failed to fetch`. Use a real browser on the host.
```
# backend
cd CSL_Simulator/backend && python -m uvicorn app.main:app --port 8000
# frontend (separate terminal)
cd CSL_Simulator/frontend && npm run dev
# then open http://localhost:3000 in Chrome/Edge → Simulation tab → "Run WOT Quick"
```
- WOT-quick = the 20 WOT rpm cells. The **default config is pre-warmed in `.sim_cache`** → ~2.5 s. Editing any dimension → a fresh run (~150 s/cell at omp1; cells run cores-1 in parallel). Full-map (480) is very slow — avoid for iteration.

## Non-negotiables (UX_SPEC §3) — already centralized
`simulation_service._build_sim_env()` sets every app sim's env: `OMP_NUM_THREADS=1` (determinism), **`OPENWAM_HLLC=1`** (REQUIRED — spec §3 omits it but the plenumless Type-12 junction diverges without it), `OPENWAM_THR_CHOKE=1`, `OPENWAM_VEDIAG=1`, `OPENWAM_FAST_OUTPUT=1` (drops 75-pipe monitoring; turn OFF only for M3 waveforms), and at WOT `OPENWAM_MOUTH_RAD=0.4/_W=0.005`. See memory `csl-app-sim-env-recipe`.

## Solver exe
`build_ux/bin/release/OpenWAM.exe` (rebuilt from this branch's source; honors the env gates). The committed `bin/release` exe is STALE. If `build_ux` is gone, rebuild:
```
cmake -S . -B build_ux -G "Visual Studio 17 2022" -A x64
cmake --build build_ux --config Release
```
`simulation_service._resolve_exe()` prefers `build_ux/bin/release` → `build/bin/release` → `bin/release` (or `OPENWAM_EXE`). See memory `csl-solver-rebuild-build-ux`.

## Architecture map
**Backend** (`CSL_Simulator/backend/app/`)
- `main.py` — FastAPI routes: `GET /maps`; `POST /simulate/run?mode=wot_quick|full_map`; `POST /simulate/waveform?rpm&load` (M3); `POST /simulate/optimization?preference&rpms&budget` (M4); `POST /simulate/cancel` (M5); `GET /simulate/last?mode=wot_quick|full_map|optimization` (recover a run whose fetch died); `/ws/logs`. `/simulate/calibration` stays **501** (legacy orphaning loop).
- `simulator/simulation_service.py` — the Run path: `_build_sim_env` (FAST_OUTPUT etc.), `_resolve_exe`, `_run_solver(early_stop, no_cache)` (slope early-stop + atomic deck cache, orphan-safe kill + bounded wait, timed-out runs excluded from cache), `run_ve_map_generation` (per-cell health, structured response, RunStore, WS progress+ETA, **persist on completion**), `run_waveform_trace` (M3 single-cell full-monitoring → INS.DAT, subset pipe monitoring, parsed-result `.wave.json` cache). Cancellation: `_active_tasks` registry + monotonic `_cancel_epoch` (NOT a shared boolean — no cross-run race); every long path registers its `create_task`s. `_RESULT_ENV` = the cache-key env list.
- `simulator/optimization_service.py` — M4 optimizer (rewritten): `optimize_wot` per-rpm coordinate descent over PHYSICAL cams, baseline eval = byte-identical map-cell (cache hit), nearest-image ECU-table export, persist + cancel-aware. See memory `csl-vanos-optimizer-m4`.
- `simulator/metrics.py` — §5 validity (Pearson shape r, max-norm shape err, peak match, range/tilt, traffic-light `overall.verdict/status`).
- `simulator/output_parser.py` — `convergence()` + `cylinder_balance()` (parse VEDIAG `Mtrap`).
- `simulator/calibration_constants.py` + `data/calibration.json` — provisional EXVANOS/alpha scaffold (§4.C "foldable"). `use_stale_shape_fit=false` → folded to stable datum 150 (3900 diverged on the stale 268-cam fit).
- `store/run_store.py` — Phase-A (§11): abstract `RunStore` + local SQLite (`data/runs.db`), one record/cell `{sim_binary_sig, calib, geometry, op, vanos, sim, measured, meta}`. Swap point for cloud DB. **Keep logging — it seeds the surrogate (SURROGATE_DESIGN.md).**
- `simulator/wam_generator.py` — deck generator (1300+ lines). Now **config-driven** via `_ce(env > config > default)`. **GOTCHA: never make `simulation_service` set an env var that is now a SimConfig field — it shadows the config** (that's why RUNNER_SC/THR_GAMMA were removed from the service + `_RESULT_ENV`).
- `models.py` — `SimConfig`. M2 added `IntakeConfig.{throttle, runner, eq_tube}` and `HeadConfig.intake_port_wall_temp`.

**Frontend** (`CSL_Simulator/frontend/`)
- `app/api.ts` — `SimConfig` + `RunResponse` types; `runSimulation(config, mode)`.
- `components/VehicleBuilder.tsx` — THE app. Builder tab (InteractiveTopology + per-part param panels in `renderSelectionParams`) and Simulation tab (run buttons, progress+ETA, results). M2 added ~25 InputRows across the Plenum/Runner/Cylinder/Header/Collector panels.
- `components/VeOverlayChart.tsx` (Recharts sim-vs-stock, in-band only), `ValidityPanel.tsx` (traffic lights), `VETableComparison.tsx` (adapted via `runToCalibration`).
- Response schema: `{axes:{rpm,load}, cells:[loadRow][rpmCol]{ve_sim,ve_stock,health}, rows:[per-load §5 metrics], overall:{verdict,status,...}, stock_curve, run_id, sim_binary_sig}`.

## Verification recipe (use for ANY backend change)
1. Generate the **default** deck (`WAMGenerator(SimConfig()).generate(ignition_timing=20.0)`); confirm 0 zero-length pipes and that `POST {}` **cache-hits (~2.5 s, 16/20 converged)** — i.e. byte-identical.
2. Confirm a changed field changes the deck hash (param is live), e.g. `intake.runner.length_scale 1.0→1.1` moves 3900 VE 77.25→83.59.
3. E2E in your own browser.
Console-encoding note: the verdict string has an em-dash; read JSON with `io.open(..., encoding='utf-8')` and set `PYTHONIOENCODING=utf-8` when printing on Windows cp932.

## DONE — M3 / M4 / M5 (§8)
All implemented, adversarially reviewed (per-milestone workflow: find → verify → fix), and verified.
New frontend: `VeSurfaceChart.tsx`, `WaveformChart.tsx`, `TuningResults.tsx`. Deps: `react-plotly.js` + `plotly.js`.
- **M3** — Results-header view toggle **Charts / 3D Surface / Waveform**. 3D VE surface (x=rpm, y=load, z=VE; sim/stock/Δ; health-masked; wot_quick → 3D ridge). Waveform = one full-monitoring cell to natural end (INS.DAT only flushes then), curated **subset** pipe monitoring (intake runners + exhaust ports + collectors) so it isn't hours; parse by header NAME (cyl block is 9 cols). See memory `openwam-ins-dat-waveform`.
- **M4** — sidebar **Tuning (VANOS · WOT)**: MAX_VE / SMOOTH → per-rpm cam coordinate descent on the omp1 surface; every eval is a REAL sim (surrogate n/a yet), health-gated; optimizes physical cams (never the EXVANOS scaffold); far-from-stock → low-confidence. Export: TSV clipboard + CSV in the KF_EVAN1/AVAN1 16×16 layout (WOT row only, **nearest-image** so it round-trips). See memory `csl-vanos-optimizer-m4`.
- **M5** — red **Cancel run** button → `POST /simulate/cancel` (kills solver children, no orphans, finished cells stay cached → **re-run resumes**); config **Load** (merge over pristine defaults, proto-pollution-guarded); waveform elapsed timer; §5 provenance copy in `ValidityPanel` + `VETableComparison` (Base = measured WOT only; part-load 0).

## NEXT (post-scaffold — the real work now)
1. **Part-load Base VE wiring (small):** the ECU base VE map `kf_rf_soll` (24×20, extracted from the CSL BIN) is ALREADY in `data/csl_ecu_maps.json`; the VE table's part-load "Base" shows 0 only because the sim compares against the WOT-only *measured* curve (`stock_csl_ve.json`). Decide: wire `kf_rf_soll` as a part-load reference (ECU target, not measured) vs. load measured part-load (narrowband+log) — see `csl-ve-data-provenance`.
2. **Calibration re-fit (§10):** fold real measured intake geometry in via the M2 form, re-fit EXVANOS_BASE off the stable datum, drive the ram peak to the measured 3900. Until then the shape r≈0.4 and tuning is low-confidence *by design*.
3. **BIN pipeline (deferred M4-ish):** `/binary/upload` currently only saves the file; `/binary/patch` is 501. `BinaryService` can already read/write KF tables (big-endian). Wire patch = write the M4-optimized WOT row into the BIN → real ECU export.
4. **Surrogate Phase-B** (`SURROGATE_DESIGN.md`): the RunStore + `.sim_cache` + every optimizer eval are already logging the feature rows; train the fast emulator to replace real sims in the tuner's inner loop (then the "surrogate proposes / sim disposes" split becomes non-trivial).
- Optional remaining form params: `engine.friction.coeffs`, `engine.heat_transfer.woschni_coeffs`, `intake.min_plenum_vol`.

## Memory (written)
`csl-app-sim-env-recipe`, `csl-solver-rebuild-build-ux`, `csl-ve-data-provenance`, `openwam-omp-nondeterministic-wot`, `csl-config-env-shadowing`, `openwam-ins-dat-waveform` (M3), `csl-vanos-optimizer-m4` (M4). Read MEMORY.md.

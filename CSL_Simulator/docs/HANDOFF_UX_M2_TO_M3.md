# CSL UX App — Handoff (M1+M2 done → start M3)

Continuation doc for resuming `UX_APP_DEV_SPEC.md` §8 in a fresh session. M1 (Run +
validity MVP) and M2 (full editable parameter set) are committed and verified.

## Where we are
- **Branch:** `claude/csl-ux-app` (cut from `master` after PR #12 / Stage-56 merged). Commit `16715e9`. **Not pushed** (owner's call).
- **Done:** M1 (Run → VE table + sim-vs-stock overlay + §5 validity panel + Phase-A RunStore) and M2 (promote eq-tube / runner / throttle / intake-port-wall-temp into SimConfig; expose ~25 params in the form).
- **State of the model:** stable & sweepable (16/20 WOT cells converge), but the VE **shape does not yet match stock** (r≈0.4) because the intake geometry is the owner's by-feel estimate (§10). The app **correctly reports "Not valid — needs re-calibration"**. Folding real measured dimensions in via the M2 form + re-fitting EXVANOS is the calibration path.

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
- `main.py` — FastAPI: `GET /maps`, `POST /simulate/run?mode=wot_quick|full_map`, `/ws/logs`. `/simulate/calibration` + `/simulate/optimization` are **501-guarded** (legacy M4 code orphaned solvers — re-enable in M4 with the orphan-safe runner).
- `simulator/simulation_service.py` — the Run path: `_build_sim_env`, `_resolve_exe`, `_run_solver` (slope early-stop + deck cache, kills child on cancel), `run_ve_map_generation` (per-cell health, structured response, RunStore append, WS progress+ETA). `_RESULT_ENV` = the cache-key env list.
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

## NEXT — M3, then M4/M5 (§8)
**M3 — 3D waveform view**
- Add `react-plotly.js` + `plotly.js` to the frontend.
- (a) **VE surface**: x=rpm, y=load, z=VE; toggle sim / stock / Δ. Drive from a `full_map` run (or the cached cells). Reuse `RunResponse.cells`.
- (b) **Crank-angle traces** (in-cyl pressure / pipe pressure-velocity): add a backend endpoint that runs a SINGLE cell with **`OPENWAM_FAST_OUTPUT` unset** (full 75-pipe monitoring → writes `<deck>AVG.DAT` / `<deck>INS.DAT`), then parse the `INS.DAT` traces. `output_parser.parse_avg_dat()` exists; add INS parsing. Clean the DAT files after (the Run path already does).

**M4 — Tuning (VANOS search) + export** (UX_SPEC §7)
- Preference MAX_VE / SMOOTH → internal objective (don't show raw objective). Per-rpm coordinate/Nelder-Mead search on the deterministic (omp1) surface; cache + resumable.
- SAFETY (non-negotiable): **surrogate/search PROPOSES, real omp1 OpenWAM DISPOSES** — verify top-K candidates with real sims before display/export. Optimize **physical cam angle / overlap**, NOT the EXVANOS scaffold. Far-from-stock recommendations → low-confidence flag.
- Export: ECU-table-layout CSV + clipboard. Re-enable `/simulate/optimization` with the orphan-safe `_run_solver` (current legacy code is 501-guarded because it orphaned subprocesses).
- Note: VANOS biases in the form are currently OVERWRITTEN per operating point by the kf_evan1/kf_avan1 map lookup in the Run path — wire a single-point/manual mode if exposing them for tuning.

**M5 — polish:** cancellable/resumable runs, project save/load, ETA everywhere, provenance-aware tolerance copy.

**Optional remaining form params:** `engine.friction.coeffs`, `engine.heat_transfer.woschni_coeffs`, `intake.min_plenum_vol`, `eq_tube` chain seg diameter.

## Memory (already written)
`csl-app-sim-env-recipe`, `csl-solver-rebuild-build-ux`, `csl-ve-data-provenance`, `openwam-omp-nondeterministic-wot`. Read MEMORY.md.

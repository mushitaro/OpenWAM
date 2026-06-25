# CSL_Simulator — UX / App Development Spec (build in a fresh session)

> This is a **self-contained build instruction**. It was authored in the Stage-56 session that made
> the simulator stable and calibratable. A fresh session (without that context) should be able to
> build the app from this doc alone. Read `docs/HANDOFF_NEXT_SESSION.md` (Stage 56 header) and
> `docs/EXHAUST_STABILIZATION_NOTES.md` (Stage 56) for the physics background; this doc tells you
> what to BUILD and, crucially, **how to embed the calibration** so the app's results are physically
> meaningful.

---

## 0. One-paragraph context (why this app is now possible)

OpenWAM is a 1D engine gas-dynamics solver. `CSL_Simulator` wraps it to model a specific car
(standard E46 M3 / S54B32 with a CSL intake plenum, the CSL flap-pipe REMOVED, stock 260/260 cams,
CSL stock DME VANOS schedule). Until Stage 56 the simulated wide-open-throttle (WOT) cycle was
**chaotic/multistable** — tiny parameter changes flipped the predicted VE between attractors, and the
OpenMP build even gave different answers run-to-run — so it was un-tunable. Stage 56 added a gated
C++ **mouth acoustic-radiation damping** that **monostabilizes** the cycle: the simulator now responds
**smoothly, monotonically, and reproducibly** to parameter changes. THAT is what makes a tuning UI
viable. The app's whole value depends on preserving that stability (see §3 non-negotiables).

---

## 1. What the user wants (the UX vision)

1. **Input** measured engine dimensions in the UI.
2. Press **Run** (placeholder name) → the simulator runs → results shown **graphically**:
   - a **VE map table** (rpm × load),
   - a **3D graph** for waveform inspection,
   - the **difference between stock (measured target) and simulation**.
3. The app shows a **validity assessment** (is the sim a faithful representation?) — metrics proposed
   in §5. If valid,
4. the user picks a **preference** (maximize VE, or a smooth/linear curve) and presses **Tuning**
   (placeholder) → the app **searches VANOS table values** → shows results graphically →
   lets the user **copy-paste or download CSV** of the table.
5. The internal numeric targets/objective math are held by the system (the user only picks the
   high-level preference).

The end state: **model calibration and VANOS tuning are done inside the production app**, not in
ad-hoc scripts.

---

## 2. Existing architecture (EXTEND this — do not rebuild)

**Backend** — FastAPI, `CSL_Simulator/backend/app/main.py`:
- `POST /simulate/run` → `simulation_service.run_ve_map_generation(config)` — full 20×24 VE map (480
  cells) using the CSL breakpoints + per-cell VANOS lookup. **This is the "Run" button's backend.**
- `POST /simulate/calibration` → `calibration_service.calibrate(...)` — calibration loop (stub; see §4).
- `POST /simulate/optimization` → `optimization_service.optimize_full_map(config)` — the VANOS search.
  **This is the "Tuning" button's backend.**
- `WS /ws/logs` (log stream), `WS /ws/debug/run` (stream one run).
- Data model: `app/models.py` `SimConfig` (engine/intake/exhaust/simulation/environment). The
  geometry the user measures lives here (see §4.A).
- The solver binary is built locally with **MSVC** at `build/bin/release/OpenWAM.exe` (see HANDOFF).

**Frontend** — Next.js 16 + React 19 + TypeScript + Tailwind v4 + **Recharts** + lucide-react,
`CSL_Simulator/frontend/`. Existing components to build on: `MapVisualizer`, `VETableComparison`,
`PhysicalParamTuner`, `SimulationController`, `SimulationDebugPanel`, `VehicleBuilder`,
`TopologyView`, `InteractiveTopology`, `SchematicView`, `BinaryPatchManager`. API client:
`frontend/app/api.ts`. Recharts covers 2D; for the **3D waveform** add a 3D lib (see §6.C).

---

## 3. NON-NEGOTIABLES (break these and the app silently lies)

1. **Run every calibration/optimization simulation at `OMP_NUM_THREADS=1`.** The OpenMP build is
   non-deterministic near the intake resonance (same deck → up to 57 VE-pp run-to-run). A
   non-deterministic objective BREAKS the optimizer and makes "stock vs sim diff" untrustworthy.
   omp1 is single-thread = bitwise reproducible. It is CPU-bound, so run cells **in parallel**
   (process pool, ~16 at once) to keep throughput; do NOT raise threads-per-cell.
   (Backend: set `OMP_NUM_THREADS=1` in the subprocess env for these paths.)
2. **The mouth radiation damping must be ON at WOT** (it is what makes the surface smooth/optimizable).
   The production path already opts WOT cells into `OPENWAM_MOUTH_RAD=0.4`, `OPENWAM_MOUTH_RAD_W=0.005`
   (`simulation_service.py`). Keep it. Expose `alpha` as a calibration constant, not a user knob.
3. **Always run with `OPENWAM_THR_CHOKE=1`** (compressible throttle BC; already set in the production
   sim_env).
4. **Evaluate by SHAPE, not absolute level** — the per-rpm WOT level is divided out by the WOT-ratio
   correction; the calibration target is the SHAPE/trend (see §5). This matches the data provenance
   (WOT = wideband, level trustworthy; part-load = narrowband+log, shape trustworthy / level less so).
5. **Cylinder-balance gate**: a run can collapse one cylinder at part-load. Use the gate (the diag
   scripts compute it: a cylinder whose last-cycle mean trapped mass < 0.5× the fleet median is
   "collapsed"). Drop/flag collapsed cells; don't silently average them in.
6. **Convergence by slope, not cycle count**: a cell is converged when |dVE/dcycle| over the last ~5
   cycles < ~0.3. Longer intake tracts converge slower. The runner must report per-cell
   `converged`/`slope`/`cyc` so the UI can flag un-converged cells.

---

## 4. The calibration to EMBED (the most important part)

The model→real-VE calibration developed in Stage 56 is the heart of the app. It has THREE layers;
ship all three.

### 4.A — Geometry input (what the user measures → SimConfig)
The simulated VE shape is set by the intake/exhaust GEOMETRY, which is currently the owner's
by-feel estimate (the main reason the ram peaks ~5300 not the measured 3900). The UI's dimension
form writes these `SimConfig` fields (units as in `models.py`):
- **Intake**: `intake.plenum_vol` (L), `intake.bellmouth.length`/`.diameter` (mm), runner upper/lower
  lengths (currently hard-coded 15/25 mm in `wam_generator.py` per-cyl loop — promote to config),
  `intake.duct_length`/`.duct_diameter` (snorkel), `head.intake_port.diameter`/`.length`.
- **Exhaust**: primary/header/mid/tailpipe lengths & diameters (see `models.py` exhaust configs).
- **Valvetrain**: `head.intake_valve`/`exhaust_valve` `max_lift`, `duration` (now correctly 260/260),
  `diameter`.
- **Engine**: bore/stroke/rod/compression (mostly fixed for this engine).
Build on the existing `PhysicalParamTuner` / `VehicleBuilder` components. Group fields as Intake /
Exhaust / Valvetrain / Engine, with the modelled defaults pre-filled and units shown.

### 4.B — The fixed physics calibration (constants, not user knobs)
These are baked into the production path (`simulation_service.py`) and must stay:
- `OPENWAM_MOUTH_RAD = 0.4`, `OPENWAM_MOUTH_RAD_W = 0.005` at WOT (≥85% tps). This is the
  Q-lowering radiation damping; it is a PHYSICAL property of the intake mouth, independent of cam
  settings. (If a future real-geometry calibration needs a different alpha to hold monostability,
  change this ONE constant; the smallest alpha that keeps the VE-vs-parameter surface single-valued.)
- `OPENWAM_THR_CHOKE = 1` (throttle BC). `OMP_NUM_THREADS = 1` (determinism).

### 4.C — EXVANOS_BASE(rpm): a CALIBRATION SCAFFOLD that must be foldable away
Today the WOT exhaust-cam coordination uses `vanos_exhaust_bias = EXVANOS_BASE(rpm) - kf_avan1_soll`,
with a fitted per-rpm `EXVANOS_BASE` (`simulation_service.py`, currently
{2700:150,3900:115,4600:155,5300:160,6300:160,6900:160}) that makes the WOT VE-shape match the
measured stock shape (max shape err 0.02). **This is partly a FUDGE** — a ~45°/rpm swing with no
real-ECU counterpart that papers over the intake ram peaking at the wrong rpm. CONSEQUENCE FOR THE
TUNER (critical): EXVANOS_BASE lives in the SAME equation as the exhaust cam the tuner optimizes, so
**auto-tuned VANOS far from the stock cam point is low-confidence while the fudge is in play.** The
clean sequence (do as real geometry lands): (1) fix the intake geometry so the ram peaks at the
measured 3900 WITHOUT the swing → (2) fold `EXVANOS_BASE` to a fixed datum → (3) the tuner then
optimizes ACTUAL cam angles against a clean physical model. **Design the app so EXVANOS_BASE is a
single, clearly-labelled calibration parameter that can be set to a constant** (so it can be retired
without code surgery), and **the optimizer's variable is the cam angle / overlap, not the fudge.**

---

## 5. Validity / evaluation metrics (PROPOSED — wire these into the UI)

Goal: after **Run**, tell the user whether the sim is a faithful representation, per the data
provenance (WOT wideband = tight; part-load narrowband+log = shape-based). Compute these per
rpm-row AND overall, and show traffic-light status.

**Primary (shape — this is the calibration target):**
1. **Shape correlation r** — Pearson r between sim VE and stock VE across the row (or column).
   GREEN r ≥ 0.95, YELLOW 0.85–0.95, RED < 0.85. (Reference: the solved part-load LOAD-20 row hit
   r = 0.89; the calibrated WOT row reaches ~0.99.)
2. **Max normalized shape error** — normalize each curve to its own mean; `max |sim_norm −
   stock_norm|` across the row. GREEN ≤ 0.05, YELLOW 0.05–0.12, RED > 0.12. (Stage-3f WOT achieved
   0.02; >0.12 historically meant an acoustic/structural problem.)
3. **Peak-rpm match** — does the sim peak at the same rpm as stock (WOT: 3900)? Show both; flag if
   the peak is off by more than one breakpoint.
4. **Range & tilt** — curve range (max−min, pp) and tilt (mean(high-rpm) − mean(low-rpm)); compare to
   stock. (Stock WOT: range ≈ 12 pp, tilt ≈ −0.7. These caught the "too peaky / over-rammed" errors.)

**Secondary (trust/health — gate the above):**
5. **Converged?** per cell (|dVE/dcyc| < 0.3 over last 5 cycles). RED any non-converged cell in a row.
6. **Cylinder-balance OK?** per cell (no collapsed cylinder). Flag/drop collapsed cells.
7. **NaN-free / no solver blow-up** (VE in a sane band, e.g. 30–160%; >300 = numerical blow-up → RED).
8. **WOT-ratio-corrected load profile** (part-load): for each rpm, normalize VE to that rpm's WOT
   value → `p(load)=VE/VE_WOT`; report `max|p_sim − p_stock|` across loads. GREEN ≤ 0.05 ("throttle
   calibrated"), RED > 0.12 ("acoustic/structural").

**Composite "validity score"** (suggested): a 0–100 per-row score = weighted blend of (1)(2)(4)
gated by (5)(6)(7); overall = min/median of rows. Show a row-by-row colored table + an overall
verdict ("Valid — proceed to Tuning" only when overall is GREEN/YELLOW with no RED health flags).
**Tolerances are provenance-aware**: hold WOT to the tight thresholds; for part-load, judge by shape
(1)(2)(8) and relax the absolute-level checks.

---

## 6. The UX flows (concrete)

### 6.A — Input → Run
- Dimensions form (§4.A) → builds a `SimConfig` JSON → `POST /simulate/run`.
- Stream progress over `WS /ws/logs` (480 cells; show a progress bar + live cell count).
- Backend returns the VE map + per-cell {ve_sim, converged, slope, cyc, cyl_ok, valid}.
- IMPORTANT: expose a "WOT row only" quick-run (20 cells) for fast iteration during geometry
  calibration, plus the full 480-cell run. (Full map at omp1 is minutes×480/parallelism — show ETA.)

### 6.B — Graphical results (3 views)
1. **VE map table** (rpm × load): build on `VETableComparison` / `MapVisualizer`. Cell color = sim
   value or sim−stock delta (diverging colormap); hover shows sim/stock/Δ/health flags.
2. **3D waveform**: two useful 3D surfaces — (i) the **VE map as a surface** (x=rpm, y=load, z=VE),
   sim vs stock overlaid or as a Δ-surface; (ii) **in-cylinder/port pressure traces** (x=crank angle,
   y=rpm, z=pressure) for "波形確認". OpenWAM already runs in full-pipe-monitoring mode (75 pipes) so
   the backend can emit pressure/flow traces per cell — add an endpoint to return them. Use
   **react-three-fiber/three.js** or **plotly.js** (`react-plotly.js`) for 3D surfaces (Recharts is
   2D-only). Keep it toggle-able and downsample for performance.
3. **Stock-vs-sim difference**: a 2D overlay (sim & stock VE vs rpm per load row) + the Δ table +
   the §5 metrics panel (row-by-row traffic lights + overall verdict).

### 6.C — Tuning (VANOS search) → export
- Enabled only when validity is acceptable (§5).
- User picks a **preference**: `MAX_VE` or `SMOOTH` (linear/monotonic rise). (Optional: a blend
  slider.) Internally this selects the **objective** (§7); the user does NOT see the raw objective.
- `POST /simulate/optimization` (`optimize_full_map`) runs the search; stream progress on `/ws/logs`.
- Results: the optimized VANOS table(s) shown graphically (the resulting VE/torque curve vs the
  baseline) + the new intake/exhaust VANOS table values.
- **Export**: copy-to-clipboard (tab/CSV block, paste-into-tuning-software friendly) AND a CSV
  download. Match the ECU table layout (rpm × load breakpoints) so it round-trips.

---

## 7. The VANOS optimizer (objective + algorithm)

**Variables**: the intake & exhaust cam targets per (rpm, load) breakpoint — i.e. the VANOS tables
the user will export. (Long-term: optimize the ACTUAL cam angle/overlap once EXVANOS_BASE is folded
away — see §4.C — so recommendations are physical.) Constrain to the monostable window and to
mechanically valid VANOS ranges (hard min/max overlap).

**Objective (user preference → math, held internally):**
- `MAX_VE`: maximize a VE aggregate (e.g. Σ VE or torque-weighted VE across the chosen rpm band),
  subject to convergence + cyl-balance + no-blow-up constraints.
- `SMOOTH`: minimize the deviation of the VE-(or torque-)vs-rpm curve from a monotonic/linear rise
  (penalize curvature, dips, and peakiness), i.e. maximize smoothness while keeping VE reasonable.
- A blend = weighted sum of the two normalized objectives.

**Algorithm** (each evaluation is an expensive deterministic sim — choose sample-efficient,
gradient-free): the VANOS effect is largely separable per rpm-row, so **per-row local search**
(coordinate descent or Nelder–Mead over intake/exhaust bias) is a good default; for the full map use
**Bayesian optimization / surrogate** to limit sim calls. CRITICAL: the objective MUST be
deterministic — run at omp1 (§3) so the optimizer sees a smooth single-valued surface (the whole
point of the Stage-56 damping). Cache evaluated points (deck hash → result) to avoid recomputation.
Report progress + best-so-far over `/ws/logs`. Make the search resumable (append results; skip
done points) — calibration/optimization runs are long.

---

## 8. Suggested build order (milestones)

1. **Run + results MVP**: dimensions form → `/simulate/run` (WOT-row quick-run first) → VE table +
   2D sim-vs-stock overlay + the §5 metrics panel. (Validates the whole loop end-to-end.)
2. **Geometry calibration loop in-app**: let the user adjust dimensions and re-run, watching the
   metrics improve (this is how the owner will dial the real measured dimensions to the measured VE —
   the "calibration embedded in the app" the owner asked for). Add a "lock calibration" action that
   snapshots the validated `SimConfig` + the EXVANOS_BASE/alpha constants.
3. **3D waveform view** (VE surface first, then pressure traces).
4. **Tuning**: preference selector → `/simulate/optimization` → optimized-curve view → CSV/clipboard
   export. Start with `MAX_VE` per-rpm-row, then add `SMOOTH` and the blend.
5. **Polish**: ETA/progress, resumable runs, save/load projects, provenance-aware tolerances in the
   UI copy.

## 9. Gotchas the fresh session WILL hit (read before coding)
- `/tmp` resolves differently for Git-Bash vs Windows-Python; the diagnostic scripts use a portable
  `scripts/_local.py`. The backend writes decks to its sim dir — keep paths absolute.
- The solver is **MSVC-built** (`build/bin/release/OpenWAM.exe`); the committed `bin/release` exe is
  stale. Rebuild instructions in HANDOFF.
- VE in the production path is from `Trapped mass:` parse (`simulation_service.py`); the diagnostic
  scripts use per-cylinder `VEDIAG Mtrap` (set `OPENWAM_VEDIAG=1`). Keep the metric consistent within
  a view and document which one each number is.
- Full-map runs are long even at peak parallelism; always show ETA and make them cancellable/resumable.
- Do NOT "fix" the chaos by removing the damping or raising threads — that reintroduces the
  non-determinism the whole app is built to avoid.

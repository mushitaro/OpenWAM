# LOCAL CONTINUATION PROMPT — CSL_Simulator VE calibration (run on the local PC)

Copy everything below the line into your local Claude Code session (CLI/IDE/desktop), opened
in the OpenWAM repo. It assumes you are running on the user's own machine (Intel Core Ultra 9,
32 GB) — i.e. FAST, MANY CORES, and NO container reboots (unlike the cloud session that
produced Stages 49–55).

---

You are continuing the OpenWAM **CSL_Simulator** project (a Python wrapper that generates
OpenWAM 1D gas-dynamic decks to simulate a BMW S54 / E46 M3 CSL, used as a VE / VANOS /
front-pipe tuning platform). All prior work (Stages 16–55) is on the `master` branch.

## 0. Setup (do this first)
1. `git pull origin master` (HEAD should be `0b7493e` or later).
2. **REBUILD OpenWAM — the committed `bin/release/OpenWAM.exe` is STALE** (it predates this
   session's C++ changes: the choked-orifice throttle BC in
   `Source/Boundaries/TCCPerdidadePresion.cpp` and the BoundaryFunctions changes). Build from
   `Source/`:
   ```
   cmake -B build -DCMAKE_BUILD_TYPE=Release
   cmake --build build --config Release
   ```
   On Windows use MinGW-w64 (gcc, most reliable for this codebase) or MSVC; the code built
   cleanly with gcc + OpenMP on Linux. Confirm a fresh binary at `build/bin/release/OpenWAM`
   (or `OpenWAM.exe`).
3. `pip install pydantic numpy matplotlib` (the backend + report tools need them).
4. **⚠ FIX THE HARDCODED PATHS in the diagnostic scripts.** `CSL_Simulator/backend/scripts/*.py`
   have `BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"` and
   `HERE = "/home/user/OpenWAM/CSL_Simulator/backend"` hardcoded (from the cloud box). Update
   `BIN` to your local build path and `HERE` to your local backend path (or make them relative /
   env-driven). Affected: `exvanos_base_sweep.py`, `vanos_sensitivity_sweep.py`,
   `ram_overresponse_test.py`, `runner_tune_wot.py`, `fric_overresponse_test.py`,
   `topology_probe.py`, `ve_shape_report.py`.

## 1. Read before acting (don't re-derive — it's all documented)
- `CSL_Simulator/docs/EXHAUST_STABILIZATION_NOTES.md` — **Stages 49–55** (the recent arc).
- `CSL_Simulator/docs/HANDOFF_NEXT_SESSION.md` — the top section (Stages 49–55 summary + NEXT
  PHASE).

## 2. Where the project stands (established, do not relitigate)
- **Throttle/part-load is solved**: choked-orifice BC (`OPENWAM_THR_CHOKE`, gated, default
  OFF=legacy); sigma(pedal) calibration infra (`OPENWAM_THR_SIGMA_BP`); init-MAP-from-effective-
  sigma convergence fix; damping knob `OPENWAM_RUNNER_FRIC_MULT`. All default byte-identical.
  The LOAD-20 row already follows stock (r=0.89).
- **ROOT CAUSE of the "VANOS over-response" = the intake-runner RAM RESONANCE is intrinsically
  too SHARP (high Q)** and mis-tuned vs the real S54. PROVEN robust: RUNNER_SC (length),
  RUNNER_FRIC_MULT (damping), and eq-tube topology (EQ_CHAIN / NO_EQTUBE) each only RELOCATE the
  sharp peak — none BROADEN it (|d|~40pp at 3900 WOT persists). Scalar/topology knobs cannot fix
  it. (Stages 53–55.)
- **Metric rules (important):**
  - Use **VE = Mtrap/M_REF** (M_REF = π(0.087/2)²·0.091·(101325/(287.05·298))·1000 ≈ 0.6408 g).
    The VEDIAG `fresh%`/`Mair` fields are BROKEN (negative values; contradicted by the cool
    ~375 K trapped temp = fresh charge). Ignore them.
  - Judge convergence by **slope** (|dVE/dcyc| < ~0.3 over the last 5 cycles), NEVER by cycle
    count. (The cloud box's "mid-load deficit" was an under-convergence artifact — Stage 51.)
  - The **intake-only over-response metric is OVERLAP-contaminated** (those sweeps held the
    exhaust fixed and swept overlap through ~0). Use the **COORDINATED WOT VE-shape** as the
    clean target instead.

## 3. YOUR TASK — the intake geometry remodel (the foundation fix)
Goal: make the simulated **coordinated WOT VE-shape** match stock's BROAD curve, which fixes
both the VANOS-response fidelity and the rpm VE-shape. Stock WOT VE (the target, from
`kf_rf_soll`): **2700=104, 3900=116(peak), 4600=111, 5300=110, 6300=109, 6900=106, 7300=107**
— broad, peak 3900, only ~10% range. Sim (RUNNER_SC=1.0) is peaky: 3900=126, 4600=139(peak),
5300=127, **6300=92(notch)**, 6900=128, 7300=129. Reproduce the broad stock curve.

Use the local PC's advantages: run MANY cells in parallel (e.g. OMP_NUM_THREADS=2–4 with
several cells at once across your 16–24 cores) and LONG batches (no reboots). Drive convergence
properly (cyc≥45, slope<0.3 — longer runners have longer fill transients).

**Step 1 — clean coordinated-cam baseline + length sweep.** Re-run
`runner_tune_wot.py` (it sweeps RUNNER_SC × rpm at WOT with COORDINATED stock VANOS) TO
CONVERGENCE across rpm for SC ∈ {1.0, 1.2, 1.4, 1.7, 2.0}. Compare the VE-SHAPE (each curve
normalised to its own peak) to stock via `ve_shape_report.py`. Find whether any length moves
the sim peak to 3900 AND fills the 6300 notch. (Cloud data hinted the peak shifts sharply with
length but stays peaky — confirm with converged data and a finer SC grid.)

**Step 2 — if length alone can't BROADEN the resonance (likely, per Stage 55), add the Q lever
the scalars lack: a physically-correct intake termination.** Candidate changes in
`wam_generator.py` (per-cyl loop ~634–790) + `models.py`:
   - Replace the unrealistically long 150 mm "bellmouth" with a realistic short velocity-stack
     trumpet (~50–80 mm) opening into the airbox, plus a physical runner length/diameter (S54
     ITBs sit close to the head → short runners; the port necks φ52→φ35 to the 35 mm valve).
   - Model acoustic RADIATION LOSS at the trumpet mouth / a realistic airbox-plenum coupling to
     the snorkel (this is the damping that broadens a real intake's resonance and is missing
     from the clean φ52 organ pipe). Consider the plenum volume + snorkel as a Helmholtz/loss
     element, not a perfect pressure-node reflector.
   - Gate any new topology behind an env flag (e.g. `OPENWAM_INTAKE_V2`) so the legacy deck
     stays byte-identical and regressions are easy to bisect.
   Validate after each change with the coordinated WOT shape (Step 1) and the VANOS-sensitivity
   sweep (`vanos_sensitivity_sweep.py`) — target dVE/d-advance ~10–20 pp across rpm and a broad
   WOT curve matching stock.

**Step 3 — only after the intake acoustics are physical:** fit `EXVANOS_BASE(rpm,load)` for the
residual rpm offset (replace the constant 150 at `simulation_service.py:107`, re-anchored to
the CONVERGED WOT row), lock in the sigma(pedal) low-pedal curve (`OPENWAM_THR_SIGMA_BP`, infra
ready), and the WOT-ratio correction in `calibration_service.py:486` becomes physically valid.

## 4. Tooling (already in the repo, `CSL_Simulator/backend/scripts/`)
`runner_tune_wot.py` (WOT shape × runner length), `vanos_sensitivity_sweep.py` (dVE/d-cam at
WOT), `ram_overresponse_test.py` / `fric_overresponse_test.py` / `topology_probe.py`
(over-response levers), `exvanos_base_sweep.py` (general resumable rpm/load/base sweep, honours
OPENWAM_THR_CHOKE/AGAIN/RUNNER_SC/_FRIC_MULT), `ve_shape_report.py` (per-load-row r + shape-err
AND per-rpm-column load-profile, slope-aware). All are resumable (CSV append + done-cell skip),
which matters less locally but is harmless.

## 5. Validation / regression gates (run before declaring a change good)
- WOT row regression: 3900/100 must stay on its converged attractor (~122–126 cyc≥28), not
  collapse. Diff a choke-OFF run to confirm the legacy path is byte-identical when gates are off.
- No NaN; cylinder-balance gate (`output_parser.cylinder_balance`) unchanged.
- Coordinated WOT VE-shape: shape error vs stock should shrink (the deliverable).
- Commit each validated step with a clear message; push to master (or a feature branch + PR as
  the user prefers).

## 6. The bigger picture (keep design decisions aligned to it)
VE shape-following is the FOUNDATION. The end goals are: (mid) auto-tune VANOS / front-pipe /
center-pipe / intake to a user's desired driveability; (then) a great UI; (final) sensual
exhaust/intake SOUND tuning. So keep the intake/throttle/VANOS/pipe models physically correct
and parameter-sweepable — that's what makes the eventual tuning + sound work possible.

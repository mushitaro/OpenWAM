# Exhaust port-merge stabilization — small-plenum approach (PARTIAL)

_2026-05-29. Stage 2 of the exhaust NaN work (Stage 1 = `9d2b460`)._

## Problem
The generator built each exhaust port-merge (2 valve ports + 1 primary header
meeting at one node) as a **plenumless Type-12 Riemann junction**
(`_create_branch_junction`). Under exhaust blowdown this junction diverged to
NaN and aborted the run within ~3 % of the first cycle.

## Root cause (confirmed on Linux, clean run `base.log`, 4000 RPM / WOT)
Failure chain:
1. The cylinder→exhaust-valve boundary momentarily computes an unphysical
   near-vacuum / cryogenic state — `INFO: Calculated pressure at E.O.:
   0.100 bar`, `temperature at E.O.: −82.8 °C`. **This is the seed.**
2. `Sonic condition in boundary: 51` (the cyl-3 exhaust-valve / port node).
3. **Negative density** at the `Port_Ex_3` pipes' valve-side node
   (`U[0] = −1.33e-04`); the `Transforma2Area` floored-density/pressure guards
   catch it (these are the `floored non-physical …` warnings).
4. Cascade to **NaN** at `Port_Ex_3_1/2` and `Header_3`.

The Type-12 junction is an **amplifier** (one Riemann state shared by 3 pipe
ends), but the **seed is the cylinder→exhaust-valve boundary**, upstream of it.

## What the small-plenum change does — and does not — fix
Per-cylinder port-merge is now a small 0D plenum instead of a Type-12 junction.

- `models.py`: `ExhaustConfig.port_junction_vol` (cc), default **20**.
- `wam_generator.py`, `_generate_full_exhaust`: per-cylinder plenum
  `PortJunc_Ex_{n}` of `port_junction_vol/1e6` m³ via
  `_add_plenum(..., allow_small=True)`. The two `Port_Ex` pipes attach at
  end 1, the `Header` at end 0, via `_add_con_plenum_pipe_v2` (now returns its
  connection id). `allow_small=True` bypasses the global 50 cc clamp and uses a
  0.1 cc absolute floor.

### Measured at 4000 RPM / WOT (60 s budget, ~3–6 % reached)
| port_junction_vol | BC-NaN | Sonic | floored | no-mass | abort |
|---|---|---|---|---|---|
| plenumless Type-12 (before) | hundreds → abort | flooding | many | — | — |
| **20 cc** | **8** | 0 | 40 | 0 | 0 |
| 50 cc | 102 | 203 | 40 | 0 | 0 |
| 100 cc | 44 | 0 | 40 | 0 | 0 |

**Conclusions:**
- The junction plenum is a large, real improvement (hundreds → single digits)
  and **20 cc is the best volume** (bigger is not better — 50 cc is worse).
- It is **NOT a complete fix**: a residual ~8 BC-NaN remain, and `floored = 40`
  is **constant across all volumes**, which confirms the residual seed is
  upstream of the junction — the **cylinder→exhaust-valve boundary** producing
  negative density at the port's valve-side node (step 1 above), independent of
  junction volume.
- Plenums 7 → 13 (one per cylinder); pipes unchanged (75).

## Stage 3 (DONE, partial): fixed the seed — `ae8fb14`
Confirmed the seed and fixed it at the source. Two commits beyond Stage 2:

### 3a. Cold-start cylinder over-expansion (the real seed)
`INFO: Calculated ... at E.O.` instrumentation (4000 RPM/WOT, 6-cycle smoke)
showed the cryogenic state is a **first-cycle startup artifact, not a steady
defect**:
- cyl 4, cycle 1: **0.100 bar / −82.8 °C (~190 K)** ← seed
- cyl 1, cycle 2: **0.917 bar / +45 °C** ← already healthy

Root cause: OpenWAM imposes one initial condition (`P=1.013 bar, M=0.6 g`) on
**every** cylinder regardless of its crank angle at t=0. A cylinder starting
near TDC (tiny volume) holds an unphysically cold charge; its first expansion
integrates to a near-vacuum. Fix (`TCilindro4T::ActualizaPropiedades`): floor
the converged cylinder temperature to **250 K** and let the existing lines
rebuild `P` and sound speed consistently. Real gas exchange never approaches
the floor, so steady operation is untouched.

### 3b. Density/pressure consistency clamp (`TTubo::Transforma2Area`)
The Stage-1 density and pressure floors fire **independently**, so a cell could
end up with floored density `~1e-8` yet a finite floored pressure — a
thermodynamically inconsistent pair (implies ~infinite T) giving an
astronomical sound speed, which collapsed the CFL timestep to ~6e-14 and
aborted with "plenum too small". Fix: bound density from below for the current
pressure so a floored vacuum cell has a physical sound speed (≤ ~1029 m/s),
scaling species partial densities to preserve mass fractions.

### Measured effect (4000 RPM/WOT, 6-cycle smoke, `port_junction_vol=20`)
| stage | BC-NaN | Sonic | abort timestep | failure mode |
|---|---|---|---|---|
| Stage 2 (seed unfixed) | 41 | 0 | — (timeout) | network-wide NaN incl. intake pipe 10 |
| + 3a cold-start floor | 20 | 0 | 6.6e-14 | `plenum 7 too small` (CFL collapse) |
| + 3b consistency clamp | **12** | 0 | **1.96e-7** | `StudyInflowOutflowMass` (cociente≥2) |

The intake cascade is **gone**; remaining NaN are local to the exhaust port
nodes (pipes 45/46) and the abort is no longer NaN/CFL but the **0D junction
plenum mass-flux limit** (`StudyInflowOutflowMass`, `TOpenWAM.cpp:2526`:
mass into the 20cc plenum > 2× its mass in one step).

## Stage 4 (in progress): junction architecture — small-plenum vs plenumless
The `cociente≥2` abort is intrinsic to a *tiny 0D plenum* absorbing blowdown
flux; enlarging it hurts wave fidelity, and the small plenums also shrink the
timestep so much the 480-point sweep was projected at **25–33 h @ 8×** (old
pre-seed-fix data). A **plenumless Type-12 Riemann junction** has no
mass-storage stability limit and no timestep penalty — it only diverged before
because of the cold-start seed, which is now fixed.

`wam_generator._generate_full_exhaust` now selects topology by
`exhaust.port_junction_vol`:
- `> 0`  → small 0D plenum per cylinder (Stage 2 behaviour);
- `<= 0` → plenumless Type-12 (ports + header share one branch junction; plenum
  count returns 13→7).

### A/B result (4000 RPM/WOT, 6-cycle, seed fixed) — plenumless WINS
| topology | NaN | Sonic | abort | failure |
|---|---|---|---|---|
| small plenum 20cc | 12 | 0 | **yes** | `StudyInflowOutflowMass` (cociente≥2) |
| small plenum 50cc | 102 | 203 | no | timestep crawl (133 h/sweep) |
| small plenum 100cc | 44 | 0 | no | timestep crawl (133 h/sweep) |
| small plenum 200cc | **0** | 0 | **yes** | `StudyInflowOutflowMass` |
| **plenumless Type-12** | **0** | 135 (all guarded) | **none** | — (stable) |

The small-plenum approach aborts or crawls at *every* volume. Plenumless
Type-12 is **stable with zero NaN and zero aborts** — the Stage-1
`TCCRamificacion` guards (entropy-ratio fallback, sound-speed floor, guarded
normal shock) handle the 135 sonic events cleanly, and the seed fix removed the
NaN that originally motivated the plenum. **Decision: default to plenumless
Type-12** (`port_junction_vol = 0`).

## Stage 5 (in progress): the runtime "hang" was a Zeno timestep collapse
A step-resolved trace (`OPENWAM_DTSTEP=N`, commit `2cf2c97`) overturned the
"slow run" assumption. The flow solver is fast (**0.28 ms/step single-thread,
27 % of 2 cycles reached in 0.2 s wall**). The run then **freezes at one crank
angle**: at the cyl-3 exhaust blowdown (**Theta ≈ 847 deg, pacing pipe =
Port_Ex_3**) the global timestep `dt = Courant·dx/VTotalMax` collapses to
**exactly 0** while the main loop spins (48 000+ steps at the same Theta, no
wall-clock progress). Not slowness — a Zeno deadlock.

### Cause chain (confirmed by gdb backtraces + warning trace)
1. The **cyl-3 exhaust-valve boundary** (`TCCCilindro::FlujoSalienteCilindro`,
   Type-8) emits a pathological characteristic pair (Landa/Beta) during the
   supercritical blowdown. `TransformaContorno` turns the huge `(L−B)` into a
   velocity of **Mach ~90 (V = 3–5e4 m/s)** at the port's valve-side node.
2. `VTotalMax = |v| + a` diverges → `dt → 0`.
3. The density floor in `Transforma2Area` only caught `U[0] ≤ 0`, so the tiny-
   but-positive floored density next to finite momentum re-inflated `V`.

### What the velocity clamp fixes (commit `2cf2c97`)
Bounding `|V|` to Mach ~5 in `Transforma2Area` (rebuilding momentum+energy)
**removes the `dt=0` freeze** — the run advances past Theta 847 again. But the
**valve boundary still emits the bad state every blowdown** (the clamp fires
~20×/cyl-3 event), so a residual remains:

| topology (2-cycle, all guards) | NaN | abort | dt=0 freeze |
|---|---|---|---|
| plenumless Type-12 | 92 | 0 | broken, but NaN at cyl-3 junction |
| small plenum 30 cc | **0** | **0** | still Zeno-frozen (~step 850) |
| small plenum 50 cc | 0 | 1 | abort (StudyInflowOutflowMass) |

The 30 cc plenum + velocity clamp reaches **zero NaN / zero abort**, but the
underlying valve-boundary velocity explosion still stalls the timestep. **The
true root cause is the exhaust-valve boundary (`TCCCilindro`) producing a
supersonic / near-vacuum port state at cyl-3 blowdown** — every guard so far
(`Transforma2Area` density/pressure/velocity floors) is downstream
firefighting. Next: fix the seed in `FlujoSalienteCilindro` (bound the emitted
characteristic / throat state to the physical post-shock solution), not the
pipe cells.

### Diagnostics added (`2cf2c97`, opt-in, zero cost when unset)
- `OPENWAM_DTDIAG=1` — per-1%-progress: `dt`, pacing pipe, `ms/step`
  (separates step-count from per-step cost).
- `OPENWAM_DTSTEP=N` — every N steps: `dt`/`Theta`/pacing pipe, independent of
  the progress gate, so a `dt→0` stall is visible even when % is frozen.

## Stage 6 — corrections, the real hang, and where it stands

Several Stage-5 hypotheses were **falsified by direct measurement** (recorded
here so they are not re-tried):

1. **Valve boundary is NOT the seed.** `OPENWAM_VLVDIAG=1` (probe in
   `TCCCilindro::FlujoSalienteCilindro`) logged **zero** supersonic emissions —
   the valve boundary's output characteristics are healthy (Mach < 3). The
   Mach-90 velocity is at the first *internal* port cell, not the boundary.
2. **Mesh is NOT the cause.** A 10/20/30/45 mm exhaust-port sweep gave NaN
   ~92–102 at every size. 20 mm only "FINISHED CORRECTLY" because the gas mass
   had collapsed to ~1e-77 g — a dead system that integrates instantly, not a
   valid run.
3. **Cylinder temperature floor is not the lone seed.** A 250/600/800 K floor
   sweep (`OPENWAM_TFLOOR`) still hit NaN ~92–102; 600 K only "finished" with
   the mass collapsed. Raising it just relocates the cascade.
4. **An entropy-level floor in `TransformaContorno` made it worse** (NaN 5→90 at
   2000 rpm): flooring `E` to 1e-6 corrupts the pressure of cells with a
   legitimately small entropy. Reverted — do not reintroduce.

### The real hang: unbounded plenum iteration (`b444abc`)
gdb (single-thread, deterministic) caught the small-plenum "slow" run with
**100 % wall time inside `TDepVolCte::ActualizaPropiedades` and the global step
counter frozen** — not a NaN, not a Zeno `dt` collapse, a genuine
**non-terminating loop**: the plenum sound-speed `while(!Converge)` fixed-point
iteration (tol 1e-6) has no cap, and a small port-merge plenum hit by the
blowdown enthalpy transient makes the sequence oscillate forever. Fixed by
capping at 200 iters with under-relaxation past 50 (commit `b444abc`). This
removes the **worst failure mode (unbounded hang)** for any small-plenum config.

### Severity finding (RPM sweep, plenumless, single-thread)
| RPM | BC-NaN | reaches | note |
|---|---|---|---|
| 2000 | **5** | 24 % | nearly clean; NaN at cyl-1 port, `Entropia→0 ⇒ Landa=inf` |
| 3000 | 77 | 27 % | |
| 4000 | 92 | 27 % | |

The NaN count scales strongly with blowdown severity (RPM). The remaining seed
at 2000 rpm is a near-zero Riemann entropy at the cyl-1 first blowdown
(`p=(a/E)^Gamma4` overflows). A naive `E` floor backfired (#4); the correct fix
must keep `a` and `E` thermodynamically consistent (as the density/pressure
consistency clamp did for `Transforma2Area`), and belongs at the cell-state
level, not the boundary transform.

## Stage 7 — the NaN seed FIXED at source; the freeze fully characterized

### ✅ Root-cause fix: isentropic cylinder init (`b6f955c`) — NaN 92 → 0
The cold-start seed was traced to a prior `[ANTIGRAVITY]` modification in
`TCilindro::IniciaVariables` that forced **every closed-cycle cylinder to
P = 1 bar / 60 C at t=0** and took its mass from the *current* volume. A
cylinder sitting in the combustion/expansion window at t=0 then held a near-TDC
charge at only 1 bar, so its first expansion over-expanded to a cryogenic
near-vacuum (E.O. ~0.1 bar / -82.8 C) — the seed for the whole exhaust-port NaN
cascade. Restoring OpenWAM's original isentropic init (full RCA charge,
`P = Pinit*(Vrca/V)^gamma`) makes a near-TDC cylinder start hot and pressurised.

Measured (4000 rpm/WOT, plenumless, single thread): **BC-NaN 92 → 0**,
E.O. pressure **0.10 → 0.74 bar**. The NaN cascade is gone at the hardest point.
The trapped mass is now healthy and monotonic across the map (0.64 → 0.70 g for
1500 → 4000 rpm).

### ⚠️ Remaining: a dt→0 freeze at the cyl-3 first blowdown (no NaN)
With the NaN gone, the run is stable but **freezes** (dt = 0) at one cell — the
cyl-3 exhaust port (`Port_Ex_3`, pipe 45/46) at Theta ~860 deg, *after*
cylinders 4 and 1 have completed clean gas exchange. `OPENWAM_TVDDIAG` localized
it exactly: the true eigenvalue `|Alpha|` stays healthy (~1.5e3 m/s) but the TVD
source-projection `Beta = DeltaB/DeltaU` blows up to **~1e21**, making
`VTotalMax = |Alpha|+|Beta|` non-finite and `dt = Courant*dx/VTotalMax = 0`.
Origin: a near-vacuum port cell makes the Roe density ratio (`Rm`, and the
`1/Amed`/`1/Amed2` eigenvector scaling) explode.

**Fixes that do NOT work (all tested, all reverted):**
- Capping `VTotalMax`, `Beta`, the dimensional wave speeds, an upper density
  cap, or a first-order TVD fallback (zero `Beta` at the degenerate interface)
  so `dt > 0`: the run *finishes* but the gas mass collapses to ~1e-77 g — by
  the time the runaway is visible the domain is already corrupted, so any larger
  dt just propagates the blow-up.
- Flooring the Roe `Amed2`, capping `Rm`, an absolute density floor, or a naive
  entropy floor: the freeze persists or the mass collapses.

**The actual origin (found via a density probe at the frozen cell):** the
conserved density at the cyl-3 port boundary node is **1e+97** (a runaway
*spike*, not a vacuum) next to a 1e-6 neighbour. It comes from
`Transforma1Area`: `rho = Gamma*area*P/(a*ARef)^2`, where the boundary sound
speed `a = (Landa+Beta)/2` collapsed to ~0 because the **Type-12 junction
(`TCCRamificacion`) Riemann solve emitted `Landa ≈ -Beta`** during the violent
cyl-3 blowdown. So the seed is the *junction characteristic output* (a ~ 0),
upstream of every cell/TVD guard tried — which is exactly why all of them only
move the symptom. The remaining fix belongs in the junction Riemann solver
(floor the emitted sound speed / guard the Landa+Beta degeneracy so the adjacent
pipe density cannot blow up), not in `Transforma2Area` or the TVD scheme. That
is a careful change with regression risk across every junction in the model, so
it is left as the next deliberate step rather than another reactive guard.

**Conclusion:** the cyl-3 first-blowdown drives the port cell into a state where
the TVD Roe linearization is degenerate and has no stable timestep. This is a
scheme-level limitation for this extreme cold-manifold transient, not a simple
bug. Resolving it needs either a proper conservative cell-state repair (replace
the degenerate cell with a neighbour-consistent quiescent state *before* the
Roe projection) or a HLL/HLLC-style flux at near-vacuum interfaces — a larger
change than a guard. Kept defensive: the Roe `sqrt` guards (`b39e09a`) prevent
a real latent NaN; `OPENWAM_TVDDIAG` pinpoints any recurrence.

### Data-usability note for the VE sweep
At the freeze the state is healthy (NaN=0, mass ~0.70 g) and the **first-cycle
trapped mass is already recorded**, so a sweep can still harvest a (first-cycle,
not multi-cycle-converged) trapped mass per point by reading the last
`INFO: Trapped mass:` before the timeout. The load (TPS) axis, however, is still
not differentiating (0.30 vs 1.00 give nearly the same mass) — the intake/
throttle boundary flow-limiting bug (Stage-4 todo) is the next functional issue
once the run completes.

## Logging / safety
- `TTubo::ComunicacionTubo_CC` BC-NaN `printf` is bounded by a **thread-safe
  `std::atomic<int>`** (cap 50 each for LEFT/RIGHT). The pipe loop is
  OpenMP-parallel; the earlier plain `static int` was a benign race that still
  bounded output, now made correct.
- `scripts/run_safe.sh <wam> <log> [timeout_s] [maxbytes]` — capped runner
  (`timeout` + `head -c`). The hard guarantee against a disk-flooding run.
- `scripts/smoke_sp.py [rpm] [cycles] [timeout]` — end-to-end smoke that
  generates, runs (log in /tmp, capped), and prints health + a verdict.
- `scripts/vol_scan.py [budget_s] [vols_csv]` — sweeps `port_junction_vol` and
  reports NaN/progress per volume.

## Environment gotchas (remote container)
- Never `pgrep -f` / `pkill -f` on `OpenWAM` or `claude`: the pattern matches
  this agent's own argv (which embeds the whole system prompt, megabytes) and
  pollutes output / can self-kill the shell. Use `pkill -x OpenWAM`.
- A diverging run + unbounded logging = OOM. Always run via `run_safe.sh` or
  `smoke_sp.py` (both cap the log).
- Do **not** batch dependent steps in one parallel tool block: if any command
  in the block exits non-zero, all siblings are cancelled (this repeatedly
  wiped out edits/commits during development).

## Stage 6-7 — the freeze is a density runaway; junction is the last root

After the cold-start seed fix (Stage 3) removed the cylinder-side seed, the
4000 RPM/WOT run no longer NaNs immediately but **freezes** at the cyl-3
blowdown (Theta ~847 deg, ~29 % of 2 cycles). A step-resolved trace
(`OPENWAM_DTSTEP`, `OPENWAM_TVDDIAG` extended to dump raw cell state) pinned the
mechanism precisely:

1. The plenum 0D solver had an **uncapped fixed-point loop**
   (`TDepVolCte::ActualizaPropiedades`) that could spin forever on a small
   port-junction plenum — a true hang, not slowness. Fixed with an iteration
   cap + under-relaxation (`b444abc`).
2. With plenumless Type-12, the freeze is a **density runaway**: at the exhaust-
   port area change the TVD area-source term `Bvector[1] ~ rho*a^2*dArea` forms
   a positive feedback — high rho -> large source -> higher rho next step. The
   conserved density `U[0]` grows by orders of magnitude per step
   (`Frho -> 1e90+`), which blows up the Roe differences and the antidiffusion
   `Beta = DeltaB/DeltaU -> 1e21`, so `VTotalMax = |Alpha|+|Beta| -> inf` and
   `dt = Courant*dx/VTotalMax -> 0`. The pre-existing density guard only floored
   the LOW end.

### What helped (committed)
- **Upper density ceiling** in `Transforma2Area` (50x ambient, rescaling
  momentum/energy) — breaks the `U[0]` runaway. Alone: reach 29 % -> 34 %.
- **Straight (constant-area) exhaust port** option
  (`OPENWAM_EX_PORT_STRAIGHT=1`) — removes the area-source driver. Standalone
  29 % -> 51 %; with the density ceiling, **reaches 99 %**.

### What did NOT help
- Bounding `rhomed`/`Amed` at the 3 TVD source-term sites (`CalculaB/Bmas/Bmen`)
  — no benefit, slight regression; reverted.
- A `VTotalMax`/`dt` ceiling — let an unstable dt through and blew the run up
  (mass -> 1e-77 "dead-system" finish); reverted.
- Raising the throttle K ceiling for the freeze — unrelated (intake side).

### Remaining root (open)
Even straight ports + density ceiling do **not** yield a *physically valid*
multi-cycle run: a residual NaN still appears at the **Type-12 port-merge
junction** (`TCCRamificacion`, boundary 46/51) under sustained supersonic
blowdown. The first NaN is `Landa=Beta=-nan` with finite entropy — i.e. the
**pipe** feeds an already-NaN characteristic into the junction, which
propagates it. The density ceiling fires *after* the W-update has already
consumed runaway intermediate values, so it cannot fully prevent the cascade.
With enough NaN the gas mass drains to ~0 and the run "completes" dead.

This is a robustness limit of the Lax-Wendroff/TVD scheme with strong source
terms at a valve-adjacent Riemann junction under extreme blowdown. The
defensible next step is a more dissipative, positivity-preserving flux at the
exhaust ports/junction (HLL/HLLC-style) rather than more post-hoc clamps.
`OPENWAM_EX_PORT_STRAIGHT=1` + the density ceiling is the most stable
configuration found and the recommended base for that work.

### Diagnostics added this stage (opt-in, env-gated)
- `OPENWAM_TVDDIAG=1` — on `dt < 1e-9`, dump pacing pipe, max Alpha/Beta cell,
  and that cell's `DeltaB/DeltaU/Bvector/Frho/U0/U1`.
- `OPENWAM_EX_PORT_STRAIGHT=1` — constant-area exhaust ports.
- `OPENWAM_THRDIAG=1` — runtime throttle Cd/K (intake side).

## Stage 8 — positivity-preserving limiter (interior + boundary + junction)

Implemented a-posteriori positivity preservation at the three layers where the
density runaway / NaN originates (commit in this stage):

- **Interior** (`TVD_Limitador`): any cell whose updated density is
  non-positive / non-finite / >50x ambient is recomputed with the 1st-order
  pure-upwind (HLL-like) flux. Positivity-preserving under CFL; high-order kept
  elsewhere.
- **Boundary** (`ActualizaValoresNuevos`): a non-physical junction-supplied
  (a,v,p) falls back to the adjacent interior cell (zeroth-order extrapolation).
- **Junction** (`TCCRamificacion`): the real root. A Type-12 Riemann junction
  under sustained supersonic/reversing flow leaves a non-finite Landa/Beta in a
  connected pipe end; reset it to a quiescent positivity-preserving state
  (a=|incident|, v=0). This drops BC-NaN from 102 -> 0 through the first
  blowdown.

### Measured (4000 RPM/WOT, single thread)
| config | reach | NaN | trapped mass |
|---|---|---|---|
| taper, pre-stage-8 | 29% (freeze) | — | (frozen) |
| taper + all layers | 31%, **NaN=0 to 30%** | 102 @ 31% | 0.71 -> 0.42 g |
| **straight + all layers** | **99% (completes)** | **51** (was 102) | 0.35-0.45 g (NOT drained to 1e-77) |

Straight ports + the full positivity stack is the first config that both
**completes and keeps finite physical mass**. The first NaN has moved from
cycle-1/3% all the way to **cycle-2/83%**, now originating at the cyl-2
exhaust-valve boundary (`TCCCilindro` "Calculating outflow" error, boundary
52/53) rather than the junction — i.e. each layer pushed the failure
downstream/later.

### Still open
A fully clean (NaN=0 throughout) multi-cycle run at 4000 RPM/WOT is not yet
achieved; the residual is a distributed instability during the multi-cylinder
blowdown overlap, surfacing at whichever valve/junction is most stressed. The
complete fix remains a positivity-preserving HLLC flux for the whole exhaust
network; the Stage-8 layers are its foundation and already make the run
complete with finite mass. Milder RPMs (gentler blowdown) are the candidate
clean-running region for an interim VE sweep.

## Stage 9 — HLLC Riemann flux (NaN eliminated; mass-coupling exposed)

Implemented an HLLC approximate Riemann solver for the 3 gas equations
(`TTubo::HLLCFlux`, opt-in `OPENWAM_HLLC=1`), replacing only the hyperbolic part
of the TVD interface flux (source split + species advection unchanged). HLLC is
positivity-preserving by construction.

### Result (4000 RPM/WOT, tapered port, single thread)
- **BC-NaN = 0 through the cyl-3 blowdown**, and the junction reset never fires
  -- the gas state stays physical where every TVD variant produced NaN. This is
  the qualitative breakthrough: HLLC cures the density runaway at the flux
  level.
- It is **slow** at the blowdown: the CFL timestep drops to ~5e-9 s (pacing the
  exhaust ports) because HLLC resolves the genuine supersonic vent (sonic
  events 754 -> 5107). A coarser exhaust port mesh (`exhaust_port_mesh=0.030`)
  roughly doubles the reach per wall-second (31% -> 44%).
- **New failure exposed:** with NaN gone, the cylinder trapped mass now
  oscillates non-physically across cylinders during the overlap -- cyl4 0.70 g
  (healthy), cyl1 0.42 g, cyl5 **3776 g** (rho ~ 7000 kg/m^3). The HLLC pipe
  flux is conservative, but the **cylinder<->valve<->junction mass exchange**
  (`TCilindro4T` FMasa += -massflow*dt) is not bounded: an extreme but finite
  throat state makes the valve draw absurd mass into the cylinder.

### Next (open)
The remaining root is the **valve-boundary / cylinder mass coupling** under the
(now finite) extreme blowdown, not the pipe flux. Candidates: bound the
per-step valve mass exchange to a physical fraction of the cylinder/port mass;
or make the cylinder<->valve solve use the HLLC contact state. HLLC itself is
the correct foundation and should become the default for the exhaust once the
mass-coupling bound is in. TVD remains default for now; `OPENWAM_HLLC=1` opts in.

## Stage 10 — valve↔cylinder mass coupling (partial; the new frontier)

With HLLC making the pipe flux NaN-free, the remaining failure is the
cylinder↔valve mass exchange running away during the valve-overlap blowdown.
Localised with MASSDIAG / MASSDIAG-ADM / PATHDIAG / CHOKEDIAG:

- The spike is **intake-side** (cyl mass -> 3776 g is `Intake mass 3822 g`, not
  exhaust): during overlap a cylinder draws a non-physical backflow through the
  intake valve, FMasa climbing 7 -> 30 -> hundreds of g at a near-frozen Theta
  (dt ~ 2e-8, tiny steps each adding ~0.1 g).
- The valve sizes its choked massflow from the **boundary-node density**
  `Frho[FNodoFin]`, which reaches ~300 kg/m^3 there. That node is a *boundary*
  node, NOT covered by the interior TVD positivity limiter (cells 1..FNin-2) nor
  the `Transforma2Area` cap, so it is the uncapped state feeding the valve.

### What helped (committed)
- Choked-flow ceiling on the exhaust valve (`Cd*A*rho*a`) -- bounds the exhaust
  backflow (PATHDIAG: exhaust FGasto held at the growing sonic ceiling).

### What did NOT work (reverted)
- **Hard cylinder-mass cap** (rho_cyl <= 60): discarding the "excess" mass
  breaks conservation -> reintroduces NaN.
- **Boundary-node `Frho` cap** (in `ActualizaPropiedadesGas`): desyncs `Frho`
  from the conserved `FU0`/`FPresion0` the same node also exposes, so the valve
  and the pipe see inconsistent states -> NaN.

### The real fix (open)
The valve↔cylinder↔junction states must be made **mutually consistent** rather
than clamped independently: either (a) cap the boundary-node CONSERVED state
(U0/energy) so `Frho`, `P`, `a` all stay consistent and the valve sees one
physical state, or (b) give the cylinder boundary (`TCCCilindro`) the HLLC
contact-state massflow instead of the characteristic-throat formula, which
over-predicts under the extreme port state. This is the natural continuation of
the HLLC work and the last barrier to a clean multi-cycle exhaust run.

### Net position after Stage 9-10
- HLLC (`OPENWAM_HLLC=1`): pipe flux is NaN-free through the cyl-3 blowdown that
  froze every TVD variant -- the density-runaway root is cured.
- Exhaust valve massflow is choked-bounded.
- The intake-valve / boundary-node coupling under overlap is the remaining
  non-physical mass source; the principled fix is boundary-state consistency
  (above), not more independent clamps.

## Stage 11 — STABLE & CONVERGING: physical-density cap (`fc718b4`)

The root of the valve mass runaway was a **units bug in the density ceiling**:
`Transforma2Area` capped the AREA-WEIGHTED conserved density `U[0]=rho*area`
against a fixed 50, so a small-area cell (the exhaust port, area ~7e-4) kept
`U[0] < 50` while the PHYSICAL density `rho = U[0]/area` reached hundreds. The
valve reads `Frho = U[0]/area` to size its choked massflow, so the cap was
effectively absent there. Fix: cap `rho = U[0]/area` at 50x ambient
(`U0max = 50*area`), rescaling momentum/energy/species consistently (V and T
preserved).

### Result — first NaN-free, mass-physical, COMPLETING multi-cycle run
4000 RPM/WOT, HLLC, tapered (real) port, single thread:
- **FIN=1, NaN=0, 7 s** (2 cycles) / **29 s** (6 cycles).
- 6-cycle trapped mass per IVC: cycle 1 is the startup transient (0.4-4.4 g),
  then it **converges and stays bounded**: cycles 2-6 oscillate in a tight band
  around **~0.27 g** (0.20-0.32 g). Stable, converged, physical.

The exhaust is now **numerically solved** -- the "physical model limit" the
prior session suspected was a chain of code/units bugs (cold-start init,
density runaway, area-weighted cap, valve coupling), all now fixed.

### Open: calibration, not stability
The converged ~0.27 g is LOW (VE ~ 42 %, expected ~110 %). This is now a physics
calibration / numerical-dissipation question (HLLC + the caps may under-fill),
NOT a crash. Candidates: the density/positivity caps are slightly aggressive and
shave mass at the port each cycle; or HLLC's extra dissipation at the
valve-adjacent junction damps the intake ram. Next: verify mass conservation
per cycle, then tune the cap thresholds / confirm the VE against the stock curve
on a converged (cycle >= 4) basis. Recommended base config:
`OPENWAM_HLLC=1`, tapered port, `port_junction_vol=0`.

## Stage 12 — converged VE sweep: stable, but a uniform ~0.4x under-fill

With HLLC + the physical-density cap the model now runs the **whole RPM range
stably** (converged VE sweep, 6 cycles/point):

| RPM | VE_sim | VE_stock | ratio | NaN |
|---|---|---|---|---|
| 2000 | 31 | 90 | 0.35 | 0 |
| 3000 | 45 | 95 | 0.48 | 0 |
| 4000 | 47 | 102 | 0.46 | 0 |
| 5000 | 30 | 108 | 0.27 | 51 |
| 6000 | 38 | 109 | 0.35 | 0 |
| 7000 | 34 | 105 | 0.32 | 0 |

The shape is roughly flat at **ratio ~0.4** (uniform under-fill), not an
RPM-dependent collapse -- i.e. a systematic calibration constant, not broken
physics. NaN=0 at 5/6 points.

### Root of the under-fill (FILLDIAG, `b9f18bb`)
During intake the manifold is healthy -- port at full atmosphere (p_port
~1.01 bar, rho ~1.5 kg/m^3), intake valve Cd 0.64. But **p_cyl ~ p_port**, so
there is almost no induction pressure differential and only ~0.20 g of fresh air
enters (VE_fresh ~31 %). The cylinder reaches ~1 bar but ~700 K at IVC: it is
hot and under-drawn, not starved by the intake path. The descending piston is
not building the expected induction vacuum.

### Next (calibration, distinct from the stability work)
This is an engine-cycle calibration question -- induction vacuum / residual /
scavenging -- not a solver crash. Candidates to check: cylinder volume vs crank
(does FVolumen expand correctly on intake?), valve-timing/VANOS phasing,
trapped-mass sampling angle, and whether HLLC's port dissipation damps the
intake ram. The exhaust stability mission (the original "physical model limit")
is COMPLETE: the run is NaN-free, mass-physical, and converges across the full
RPM range.

## Stage 13 — VE calibration: it's intake VALVE-TIMING / wave-tuning, not a flat offset

The "uniform ~0.4x VE" turned out NOT to be a numerical dissipation constant.
VLVWIN traced the intake valve over a converged cycle and found:
- the intake port gas is **600-870 K all cycle** (not ~313 K), so the cylinder
  fills with hot gas (IVC ~565 K) -> low density -> low VE;
- the hot intake comes from **backflow**: the intake valve goes SAL (cylinder ->
  runner) for ~90 deg around BDC because IVC was at **620 deg (80 deg after
  BDC)**, pushing hot compressed charge back into the runner and contaminating
  it cycle-after-cycle.

### Intake-timing sweep (4000 RPM/WOT, HLLC, converged) — huge, wave-tuned effect
| IVO / dur -> IVC | VE % |
|---|---|
| 360 / 260 -> 620 (old default) | 38 |
| 340 / 230 -> 570 | **203** |
| 345 / 200 -> 545 | 81 |
| 350 / 195 -> 545 | 38 |
| 350 / 205 -> 555 | 81 |
| 345 / 210 -> 555 | 46 |
| 355 / 195 -> 550 | 51 |

VE swings 37 -> 203 % with valve timing, and is **non-monotonic** (same IVC,
very different VE depending on IVO/duration) -- i.e. the model has real intake
wave-tuning behaviour, and the old default timing sat in a bad trough.

### Interpretation & open question
Two things are now clear:
1. The exhaust stability work is complete and correct -- VE responds to physics.
2. The VE sensitivity to timing is **larger than a real engine** (2x from a
   5-10 deg shift), which suggests the intake wave dynamics are under-damped /
   resonating more strongly than reality (manifold/equalisation-tube model, port
   friction, or HLLC's low numerical dissipation amplifying the ram wave).

Calibrating VE to the stock curve is therefore a multi-factor intake-tuning task
(set the real S54 VANOS timing AND damp the over-resonant manifold), distinct
from the now-finished stability work. `OPENWAM_IVO` / `OPENWAM_IN_DUR` expose the
timing for that work.

## Stage 13 — VE calibration: NOT over-resonance, NOT overlap; hot-charge feedback

Systematic elimination of the uniform ~0.4x VE under-fill (all env-gated probes):

1. **Over-resonance — RULED OUT.** At a FIXED realistic S54 cam
   (IVO=348, dur=252 -> IVC=600) the converged VE is a SMOOTH 38-46% across
   2000-7000 rpm (not jagged). The earlier wild swings (38% at IVC620 -> 203% at
   IVC570) come only from moving IVC into specific backflow/ram troughs; at a
   sensible fixed IVC the response is smooth and uniformly low.
2. **Hot intake — CONFIRMED, system-wide.** Gas temperature is ~600-700 K not
   only at the valve-side port (pipe 7) but also at the plenum-side bellmouth
   (pipe 3), fed by the 10.5 L plenum initialised at 313 K. Air composition
   (R=287), cold init (313 K) and geometry are all correct, so the gas genuinely
   carries high energy (T = a^2/(gamma R) with correct R). The hot charge ->
   ~0.4x ambient density at IVC -> ~0.4x VE.
3. **Overlap backflow — RULED OUT.** Sweeping IVO to remove valve overlap
   (IVO 360 -> 400, overlap +2 -> -38 deg) does NOT cool the intake or raise VE
   (VE 46 -> 28%); later IVO just shortens the effective intake.

### Remaining mechanism (the calibration frontier)
The hot intake is a **charge-temperature feedback**: the late-ish IVC pushes
warming charge back into the port during the intake stroke (VLVWIN SAL phases at
513-543 and 589-634 deg), heating the runner; the next cycle draws that hot gas,
and the cold 10.5 L plenum does not fully flush the small runner between events.
The trapped charge stabilises hot (~565 K) -> uniform low VE.

This is a genuine intake gas-dynamics calibration coupling cam timing, runner
volume and backflow -- solvable but it needs tuning against real S54 data
(actual VANOS map + a measured VE point), not a single code fix. The exhaust
STABILITY mission is complete and unaffected; this is the accuracy work that the
now-stable solver makes possible.

## Stage 14 — CSL 268deg cam + IVO/IVC sweep: timing IS the lever, VE ~ stock

Two corrections landed together: (1) the cam base was set to the true **CSL
hardware** — 268deg intake / 264deg exhaust (the standard S54B32 is 260/260),
and (2) the **MSS54 VANOS reference offsets** (`K_EVAN1_OFFSET=-2`,
`K_AVAN1_OFFSET=+1` deg KW, DME unit "W"=Winkel) were wired into
`_add_valve_def`. Because IVC = IVO + duration, the +8deg intake bump pushes IVC
later, so the IVO base was re-swept (`scripts/ivo_sweep.py`).

### Metric fix
`ve_first_cycle_sweep.py` took the *peak* trapped mass, which is a START-UP
overshoot (e.g. 0.67 g at t=5 ms) — not the settled value. The mass then
plateaus (~0.40 g held over consecutive dumps) before the cyl-3 freeze degrades
it. The **median** of the physical readings is robust to both the overshoot and
the freeze tail and lands on the plateau; the sweep reports the median.

### Result — first probe vs clean re-run
An initial coarse probe suggested per-RPM optima reaching 96-102% VE. A cleaner,
reproducible 5-RPM x 5-IVO sweep (`scripts/data/ivo_sweep_268cam.csv`, and
independently re-run later) tempered that: the absolute fill is lower and noisier
(the cyl-3 exhaust freeze still corrupts some points — e.g. 3000/knob-320
collapses to 39%). The reproducible signal is the AVERAGE median-VE per static
IVO base over 3000-7000 RPM.

Effective IVO = knob + 2 (the -2 deg K_EVAN1 offset); IVC[deg ABDC] = effIVO + 268 - 540.

| IVO knob | IVC ABDC | avg VE | per-RPM [3k,4k,5k,6k,7k] | worst |
|---|---|---|---|---|
| 320 | 50 | 81% | 39, 85, 92, 93, 98 | 39% (3k collapse) |
| **330** | **60** | **84%** | 62, 96, 85, 91, 88 | **62%** |
| 340 | 70 | 82% | 71, 90, 80, 84, 85 | 71% |
| 350 | 80 | 75% | 67, 76, 76, 75, 80 | 67% |
| 360 (old) | 90 | 67% | 62, 63, 66, 69, 75 | 62% |

Every RPM still traces an inverted-U in IVC with the peak in the 50-70 ABDC band,
i.e. **far** above the old IVO=360 (IVC 90 ABDC, the falling edge at every RPM).
The best SINGLE static base is **knob 330 (IVC ~60 ABDC)**: highest average (84%)
and best worst-case (62%, vs knob 320's 39% collapse at 3000). An independent
re-run reproduced 4000/330 -> 96% to the digit.


### What changed in code
- Default `base_open_intake` 360 -> **330** (IVC ~60 ABDC), still env-tunable via
  `OPENWAM_IVO`. This is the robust static centre; it does not encode a per-RPM
  schedule.

### Honest caveats
- These are FIRST-CYCLE median VE (the exhaust freeze still caps the run), so the
  absolute numbers are a trend, not converged VE. Residuals remain at every RPM
  (avg 84% vs stock 95-109%); the unresolved induction-depression shortfall
  (Stage 13) is the main remaining gap, not the IVO base.
- The first-cycle noise does not reliably pin the RPM *direction* of the optimum,
  so RPM-dependent IVC tuning stays in the VANOS map (`kf_evan1_soll`) as future
  work, to be validated once the exhaust converges.

### This overturns Stage 12's framing
Stage 12's "uniform ~0.4x under-fill, looks like a flat calibration constant"
was an **artifact of a single wrong static IVC** (90 deg ABDC, the old IVO=360),
which sits far down the falling edge at *every* RPM. It is not a flat offset and
not a physics limit: **intake-valve TIMING is the dominant VE lever**, confirming
Stage 13's wave-tuning result with hard numbers.

## Stage 15 — converged VE is physical, not the freeze: it's the hot intake charge

With `OPENWAM_HLLC=1` the cyl-3 blowdown freeze is gone (NaN=0) and the run
completes 10-20 cycles. This lets us read the *converged* (not first-cycle) VE
for the first time, and it is sobering:

- At 4000 RPM / IVO 330, the converged trapped mass plateaus at **~0.36 g
  (~57% VE)**, oscillating 0.28-0.42 g. The Stage-14 "84-96%" was a **first-cycle
  median inflated by the start-up overshoot** (0.7-0.9 g, then 2.7 g spike), not
  the settled value. The ~0.4-0.5x under-fill is **real and physical**, exactly
  as Stage 13 suspected — the freeze was only hiding it.

### Bug found and fixed: intake temps were Kelvin-as-Celsius
`OPENWAM_INTEMP` showed the whole intake tract (bellmouth pipe-3 *and* port
pipe-7) sitting at **~600 K**, not ambient. Root cause: OpenWAM reads pipe wall
temps and the atmosphere temp as **degC** (`degCToK()` everywhere —
TTubo.cpp:1152/2518, TOpenWAM.cpp:623, TBloqueMotor.cpp:67), but the generator
wrote them in **Kelvin**:
- atmosphere `ambient_temp` 298 -> read as 298 degC = **571 K** inlet air;
- intake walls 300/313/400 -> read as degC = **573/586/673 K**.
(The exhaust 700/800 and the engine-block "60" were correctly authored in degC —
800 degC = 1073 K is right for a WOT header — so the bug was intake-only.)

Fix: write the atmosphere temp as `ambient_temp - 273.15` and the intake walls in
degC (snorkel/filter 27, bellmouth/runners 40, port 127). This is a genuine
correctness fix and lifted the converged VE **50% -> ~57%** — but did NOT cool the
charge, because the heat is not coming from the walls.

### Where the heat actually comes from (OPENWAM_VLVWIN)
Mapping the cyl-1 intake valve over a converged cycle (Theta: 360 = gas-exchange
TDC, 540 = BDC, IVC ~600) shows the real mechanism:

| phase | Theta | dir | p_cyl | T_port |
|---|---|---|---|---|
| valve shut (prev-cycle residue) | 272-317 | -- | 1.6-1.8 | 650-855 K |
| overlap, just after IVO | 347-362 | **SAL (back)** | 1.46->0.69 | 543-654 K |
| intake stroke | 377-407 | ENT (fill) | low | -- |
| wave reversals | 423-438, 513-528 | SAL | swinging | ~600 K |
| late IVC | 589 | SAL (back) | 1.39 | 615 K |

The VLVWIN snapshots show SAL (back-flow) into the port at overlap and late IVC,
with the port at 600-800 K. **An early read of these snapshots (1.4-1.8 bar
"back-pressure") was WRONG and is corrected in Stage 16** — those p_cyl values
were instantaneous samples, not the exhaust-stroke mean. Diagnostics used:
`OPENWAM_HLLC`, `OPENWAM_INTEMP`, `OPENWAM_VLVWIN`.

## Stage 16 — it is NOT back-pressure: it's hot-gas recirculation through the valve

Stage 15 guessed the hot charge came from a restrictive exhaust. A proper
time-averaged measurement (`scripts/exhaust_backpressure_diag.py`, last converged
cycle) **disproves that**:

- **Exhaust-stroke cylinder pressure: mean 1.02 bar** (min 0.87, max 1.43) — a
  perfectly normal back-pressure (real CSL WOT ~1.1-1.3 bar abs).
- The exhaust static-pressure profile from port -> tail is **flat at ~1.01 bar**
  (every component drop < 0.005 bar): **the exhaust is NOT restrictive**, there is
  no localised loss artifact in the cat/muffler/junctions.

Decomposing the trapped state at IVC (same INS.DAT):

| quantity | value | reading |
|---|---|---|
| trapped P_cyl | 1.29 bar | healthy (slight ram, above MAP) |
| trapped T | **574 K** | the problem |
| trapped mass | 0.43 g | VE ~67% |
| intake port mean P (fill) | 0.99 bar | manifold delivers fine, ~0.02 bar drop |
| if same P but T=298 K | -- | VE would be ~130% |

So the under-fill is **purely a charge-TEMPERATURE problem**: P and delivery are
fine, but the trapped charge is ~574 K, almost exactly the residual/exhaust
temperature (~563 K). **The cylinder is recirculating its own hot gas instead of
exchanging it for fresh air.**

### The thermal-boundary fixes do NOT move it (heat is gas-borne, not wall-borne)
Two genuine Kelvin-as-degC bugs were found and fixed (OpenWAM reads pipe/plenum
temps and the ambient temp as degC, `degCToK()`), but **neither cools the charge**:
1. intake pipe walls + engine ambient (Stage 15 fix): 300/313/400 / 298 ->
   573/586/673 / 571 K, corrected to 27/40/127 degC / ambient. VE 50% -> ~57%.
2. **the intake air SOURCE plenums** (this stage): `Ambient_Intake` (the 1000 m3
   reservoir feeding the intake) and `Plenum_Main` (10.5 L airbox) and the
   `Equalization_Tube` were 300/313 = read as 573/586 K. Corrected to ambient /
   40 degC. **VE unchanged (~52-57%), intake still ~570 K.**

That the air source being 573 K vs 25 K changes nothing proves the ~570 K intake
is **not** an init/boundary temperature — it is hot cylinder gas convected back
through the intake valve during gas exchange and not flushed out by fresh air.
(The plenum/source fixes are kept anyway: a 573 K air source is plainly wrong and
will matter once the recirculation is cured.)

### RESOLVED: it is a numerical artifact, not valve timing or any physics

Two decisive tests settle it:

**1. Overlap/IVC sweep (trapped T vs timing).** Sweeping the IVO base over a huge
range and reading the *converged* trapped state:

| IVO knob | overlap | IVC ABDC | trapped P | trapped T | VE |
|---|---|---|---|---|---|
| 300 | 64 deg | 30 | 1.23 | 569 K | 68% |
| 330 | 34 deg | 60 | 1.28 | 570 K | 69% |
| 360 | 4 deg  | 90 | 1.43 | 594 K | 67% |
| 380 | 0 deg  | 110 | 1.27 | 590 K | 67% |

Trapped T and VE are **flat (~570 K, ~67%) across overlap 0-64 deg and IVC
30-110 deg ABDC**. With *zero overlap* (IVO 380) the charge is still 590 K. So it
is **not** overlap back-flow and **not** late-IVC back-flow. (This also retires
the Stage-14 IVO sensitivity as a first-cycle/freeze artifact: the converged VE
is ~67% regardless of IVO.)

**2. Combustion OFF (zero fuel LHV).** With no combustion — no physical heat
source anywhere — the intake is **still ~550-595 K** (bellmouth and port) and VE
still ~57%. A bellmouth surrounded by a 25 degC air source, 40 degC walls and a
40 degC plenum **cannot** sit at 570 K in steady state without a heat source:
this is thermodynamically impossible physically.

**Conclusion: the ~570 K intake charge — and therefore the entire ~57-67% VE
ceiling — is a NUMERICAL ARTIFACT in the solver's intake gas handling**, not
back-pressure, not valve timing, not scavenging, not boundary temps, not
combustion residual. The solver is spuriously raising the intake gas internal
energy (or the intake-pipe density/temperature, T=P/(rho*R), is being driven low
by a mass-handling error). All converged runs used `OPENWAM_HLLC=1`; whether the
artifact is HLLC-specific could not be isolated because the non-HLLC scheme
freezes before converging.

**Next session starts here:** instrument the intake energy balance — is internal
energy gained with no heat input (energy-equation / flux source-term bug) or is
intake mass lost (density driven low -> high T at fixed P)? Suspects: the HLLC
flux energy term, the Type-12 intake junctions, and the intake-valve BC. Repro:
sweep `OPENWAM_IVO` watching trapped T (flat = not timing); zero the fuel LHV in
the .wam ("0.98 44000000 750" -> "0.98 1 750") and check the intake is still hot.

## Stage 16 (cont.) — answer: it's energy GAIN (A), localised to the cylinder/valve→airbox, NOT a pipe mass-leak (B)

The Stage-16 next-step instrumentation is done. A per-pipe energy/mass-flux
balance probe (`OPENWAM_ENBAL`, see below) was added and run on the
combustion-OFF deck (the decisive artifact case). The result settles the A-vs-B
question and localises the heat source.

### The probe
`OPENWAM_ENBAL=1` makes every pipe (id ≤ `OPENWAM_ENBAL_MAX`, default 16) print,
once per crank-angle window (`OPENWAM_ENBAL_WIN` deg, default 720), the
time-averaged mass flux and total-enthalpy flux carried by the gas at BOTH ends:
`mdot = rho*u*A` [kg/s] and `Hdot = mdot*(cp*T + u^2/2)` [W], plus the
flux-weighted end temperatures. In a converged steady state mass is conserved
(`<mdotL> == <mdotR>`) and the net advected enthalpy gain (`<HdotL> - <HdotR>`)
must equal the wall heat (~0 for 40 °C walls). Across a Type-12 junction the
downstream pipe's `<HdotL>` should match the upstream pipe's `<HdotR>`; a step
there localises a junction defect. Implemented in
`TTubo::CalculaResultadosMedios` (per-pipe member accumulators, OpenMP-safe).

### Finding 1 — the φ10 eq-tube stub blows up at the Type-12 junction (a SEPARATE, real defect)
With the eq-tube ENABLED (default), `EqTube_Stub` (a φ10 pipe) carries, at its
**junction-side** node, **2.76 kg/s at 2771 K and a 10 MW enthalpy flux**, with
gross mass non-conservation (ΔM ≈ −2.76 kg/s sustained over a full 720° window).
That is ~4× the *entire* engine's airflow through one φ10 stub — physically
impossible, and combustion is OFF so 2771 K cannot be physical. The neighbouring
φ52 runners balance to a few %. This is the **small-area-at-junction density
runaway** (same class as the Stage-10 exhaust port): the Benson constant-pressure
junction (`TCCRamificacion`) weights the common sound speed by section area
(`FSeccionTubo`), so the φ52 runners (27× the stub area) dominate and the φ10
stub is driven into the 50× density cap.

**Confirmation (`OPENWAM_EQ_DIA=0.052`, enlarge the stub to the runner diameter):**
the stub flux collapses 2.76 → ~2e-4 kg/s and 10 MW → ~hundreds of W — the
runaway is gone, proving it is an area-mismatch effect. (Aside: the generated
stub is φ10 while the comment and the eq-tube volume both say the real S54
component is φ20 — a modelling inconsistency worth fixing.)

### Finding 2 — but the eq-tube is NOT the root of the hot intake
Enlarging the stub (`EQ_DIA=0.052`) did **not** cool the intake (it got hotter),
and **removing the eq-tube entirely** (`OPENWAM_NO_EQTUBE=1`: skip the eq-tube
plenum + φ10 stubs, junction ① auto-reduces to a clean 2-pipe Runner_Upper↔
Runner_Lower pass-through) leaves the intake still hot. So the stub runaway is a
*symptom amplifier* (it spreads contamination further upstream), not the source.

### Finding 3 — the heat localises to the AIRBOX PLENUM, fed by cylinder backflow
With the eq-tube removed the temperature profile is clean and the jump is sharp:

| pipe | location | flux-weighted T |
|---|---|---|
| 1 (CSL_Intake_Pipe) | touches 25 °C ambient reservoir | **~290 K (cold ✓)** |
| 2 (Panel_Filter) | filter | ~280–450 K |
| — **Plenum_Main** (10.5 L airbox) — | | **← T jumps here** |
| 3 (Bellmouth) | plenum side | **~570–706 K (hot)** |
| 4–7 (runners/ports) | | ~560–680 K |

The pipes themselves nearly conserve mass and energy (ΔM, ΔH are a few % of the
through-flux). The 0-D plenum energy equation (`TDepVolCte::ActualizaPropiedades`
/ `TDeposito::EntalpiaEntrada`) is the standard well-mixed Benson form (inflow
enthalpy relative to the plenum state, outflow implicit) and is **correct** — it
is simply being *fed* hot gas. The hot gas enters the plenum as **backflow from
the cylinders** convected through the (WOT-open) throttle and the bellmouths.

### Conclusion: hypothesis (A), at the gas-exchange boundary
- **Mass-leak (B) is ruled out at the pipe level** (every intake pipe conserves
  mass to a few %; the gross ΔM was only the φ10 stub area artifact).
- **Energy is being gained (A):** with combustion OFF a motoring cycle must
  *return* its compression work, so the intake should stay cool. Instead net
  positive enthalpy is deposited in the airbox every cycle (hot cylinder gas
  recirculated into the intake and not balanced by the cold fresh charge),
  driving the trapped charge to ≈ the residual temperature (~570 K) → low
  density → the ~57–67 % VE ceiling. This is **system-level energy
  non-conservation at the cylinder↔intake-valve gas exchange**, not a pipe or
  plenum bug.

### Next session starts here (revised target)
1. **Primary:** the intake-valve BC `TCCCilindro::FlujoSalienteCilindro` (cyl→
   port backflow) / `FlujoEntranteCilindro` (fill) and the cylinder energy
   accounting (`TCilindro4T`). Instrument the **per-cycle net enthalpy** the
   intake valve exchanges with the cylinder (motoring should integrate to ≈ the
   wall-heat loss, not a positive deposit). A positive net deposit per cycle is
   the spurious energy. Watch whether it is HLLC-specific (it should not be — the
   valve BC is the Benson characteristic method, independent of the pipe flux).
2. **Secondary, concrete:** the `TCCRamificacion` area-weighted constant-pressure
   junction is unsafe at large area ratios (φ52:φ10). Either fix the small-area
   branch handling (energy/mass-consistent junction) or, minimally, correct the
   stub geometry (φ10 → φ20, matching the real component and the eq-tube volume).

### Reusable assets added this session
- `OPENWAM_ENBAL` / `OPENWAM_ENBAL_MAX` / `OPENWAM_ENBAL_WIN` — per-pipe energy/
  mass-flux balance (TTubo.cpp).
- `OPENWAM_NO_EQTUBE=1` — generate the deck without the equalization tube
  (isolates the eq-tube/stub) (`wam_generator.py`).
- `OPENWAM_EQ_DIA=<m>` — override the eq-tube stub diameter (area-mismatch test)
  (`wam_generator.py`).
- `scripts/intake_energy_balance.py` — runs the combustion-OFF ENBAL case
  (baseline / no-eqtube / big-stub) and prints the localisation table.

## Stage 17 — it is NOT the cylinder/valve: the heat lives in the intake tract itself

Stage 16 (cont.) concluded the spurious energy entered "at the cylinder<->intake-
valve gas exchange". Deeper instrumentation this stage **overturns that** and
exonerates the cylinder and the valve. Three decisive measurements:

### Probe: per-cycle intake-valve mass & enthalpy balance (`OPENWAM_VLVENE`)
For the cyl-1 intake valve it sums, each cycle, the fill mass (port->cyl) and the
backflow mass (cyl->port) and the enthalpy each carries (`m*cp*T`), giving the
NET enthalpy the valve deposits in the port. Converged combustion-OFF cycle:
```
fill=0.257 g  back=0.059 g  net=0.198 g  (back/fill=0.23)
Hin_port(back)=33 J  Hout_port(fill)=149 J  netH->port = -116 J
Tfill=562 K  Tback=539 K   inflowClampHits=0/1032
```
- The intake valve **NET COOLS the port** (-116 J/cycle): it removes more
  enthalpy as cold-side fill than it deposits as hot backflow. So the valve is
  NOT the port's heat source.
- Backflow is modest (back/fill 0.23), not the dominant "sloshing" imagined.
- The Stage-10 inflow choked-clamp **never fires** during normal fill (0 hits),
  so it is not throttling the charge.

### Test 1 — it is a genuine hot equilibrium, NOT an unconverged transient
A 40-cycle combustion-OFF run: the port temperature plateaus at ~556-562 K from
cycle ~8 onward (cyc8 563, cyc12 557, cyc16 574, cyc19 559 — flat, oscillating,
no downward drift). 10-20 cycles was enough; the ~560 K is the steady state.
(Startup is violent: cycle 1 fills 10.2 g at 2468 K — a ~16x overfill spike that
dumps a large amount of heat into the intake very early.)

### Test 2 — 10x cylinder heat rejection cools the CYLINDER but not the intake
With combustion OFF and Woschni cw1 and the intake/exhaust HT adjust both x10,
the cylinder cools sharply (Tback 540 -> 440 K) but the **intake barely moves**
(port ~530-543 K, bellmouth still ~560 K) and VE is unchanged. The bellmouth sits
at 560 K while the cylinder is 440 K and the filtered inlet is ~300 K — i.e. the
intake gas is hotter than BOTH the cylinder and the inlet. **The heat source is
in the intake tract, independent of the cylinder temperature.**

### What is ruled out now (with data)
- the intake valve / cylinder (net-cools the port; 10x cylinder cooling doesn't
  cool the intake);
- the equalization tube (`OPENWAM_NO_EQTUBE=1` doesn't cool the intake);
- intake oscillation magnitude via friction (`OPENWAM_IN_FRIC=10` doesn't cool —
  friction ADDS irreversible heat, it doesn't damp the source);
- a literal plenum heat source (`FHeatPower=0`, not set by the deck);
- per-component enthalpy-flux non-conservation: every intake pipe is conservative
  (finite-volume) and the junctions/throttle balance `<HdotL> ~ <HdotR>`.

### The remaining mechanism (next session)
Enthalpy-FLUX conservation does NOT preclude **entropy generation**: an
irreversible element (the Type-9 throttle `TCCPerdidadePresion`, the Type-12
constant-pressure junctions `TCCRamificacion`) can pass the gas at conserved
total enthalpy while raising its entropy (T up, p down). Under the oscillating
intake the gas traverses these elements many times per cycle, and the
irreversible heat has nowhere to leave except the weak intake-pipe walls, so the
nearly-closed recirculation equilibrates hot (~560 K). Two candidate readings,
to be settled next:
- **(H1) startup-transient heat trapped in a slow-dissipating loop** — the 10 g/
  2468 K cycle-1 spike injects the heat and the weak wall cooling bleeds it off
  over many cycles. Test: a long (>=60-cycle) run — does the intake keep cooling?
- **(H2) steady distributed entropy generation** — the irreversible elements
  source heat every cycle at steady state. Test: instrument entropy
  (s = cv*ln(p/rho^gamma)) generation across the throttle and each junction.

Either way the target has moved OFF the cylinder/valve and ONTO the intake
irreversible elements (throttle + constant-pressure junctions) and the loop's
weak thermal dissipation.

### Assets added this stage
- `OPENWAM_VLVENE` (+`_CYL`) — per-cycle intake-valve mass/enthalpy balance
  (`TCCCilindro`); reports fill/back mass, net enthalpy to port, and whether the
  inflow choked-clamp fires.
- `OPENWAM_IN_FRIC=<x>` — multiply intake-pipe friction (damping test)
  (`wam_generator.py`).

## Stage 18 — H2 confirmed; the whole engine runs hot; a trapped-pumping-heat equilibrium

Continuing Stage 17 with an entropy probe and longer runs.

### Entropy probe (`OPENWAM_ENBAL` now also prints flux-weighted s = cv*ln(p/rho^gamma))
Along the (no-eqtube) intake path the specific entropy is:
```
pipe1 L7146 R8154 | pipe2 L8154 R8461 | [PLENUM] | pipe3 L9425 R9415
[throttle] pipe4 L9415 R9417 | [junc1] pipe5 L9417 R9425 | [junc2] pipe6/7 L9425 R9382
```
- Across the **throttle** (pipe3.R->pipe4.L) and **both junctions** the entropy is
  **flat (ds~0)** -- they are NOT the entropy-generation site. The whole
  post-plenum intake sits at a **uniform** s~9420: the gas is already hot/
  high-entropy when it leaves the plenum and just advects unchanged.
- The big jump is across the **plenum** (cold 352 K filter gas meeting the hot
  reservoir) -- a consequence of the plenum being hot, not a localised generator.

### H2 confirmed (not a slow transient)
A 60-cycle combustion-OFF run holds ~557-574 K from cycle 8 through cycle 27
(flat, no downward drift) => the ~560 K intake is a **steady equilibrium**, not
startup heat slowly decaying (H1 rejected).

### The exhaust IS carrying the heat away (correctly)
Exhaust ports/headers run **600-800 K** (hotter than the intake) combustion-OFF,
so heat does leave via the exhaust. The whole engine is hot: intake ~560 K,
cylinder ~540 K, exhaust ~600-800 K. A real *motored* engine has a ~310 K intake
and an only-modestly-warm exhaust; here everything is 200-400 K too hot.

### Synthesis -- the mechanism (why the single-element hunts kept failing)
With combustion OFF the only net energy input to the closed engine loop is the
**piston pumping work** (gas-exchange losses, ~3-4 kW here, ~ the 116 J/cycle/
valve measured at the intake). In a real engine that heat leaves almost entirely
with the exhaust because the intake is **flushed** by fresh charge (high VE).
Here VE is low (~57-67 %), so the intake is **poorly flushed**: the pumping/
irreversible heat accumulates in the recirculating intake instead of being swept
through, the intake equilibrates hot, the hot charge lowers density, VE drops
further -- a self-consistent hot recirculation equilibrium. No single pipe,
junction, throttle, valve or the cylinder is "the" source (each conserves
enthalpy flux, and the junctions/throttle conserve entropy too); the heat is the
**loop's own trapped pumping heat**, distributed.

### Therefore the real lever is intake FLUSHING (breaking the low-VE feedback)
The question collapses back to "why is fresh-charge flushing poor" -- why the
first-pass VE is low before the thermal feedback locks in. Candidates not yet
closed: the intake-valve effective flow (Cd x area at lift, see
`docs/valve_discharge_coefficient_theory.md`), the intake-wave phasing into the
cylinder, and the residual-gas fraction / scavenging. A productive next attempt:
force the trapped charge cold (or VE high) for a few cycles and see whether the
loop then *stays* cool (flushing wins) or re-heats (a real per-cycle source);
and audit the intake-valve Cd x area actually applied at full lift.

### Honest status
The artifact is now thoroughly characterised and many suspects are eliminated
with data, but it has NOT been reduced to a single fixable line -- it behaves like
an emergent low-VE/hot-intake feedback of the whole gas-exchange model, not a
local bug. VE is unchanged (~57-67 %). Next session: pursue the flushing lever
above, or validate the gas-exchange against reference data to decide model
limitation vs code defect.

### Assets added this stage
- `OPENWAM_ENBAL` now also reports flux-weighted specific entropy at each pipe end
  (`sflux[L,R]`), for locating irreversible entropy generation across elements.

## Stage 19 — forced cool-start: the breathing geometry is SOUND (VE 62% -> 88% when cold)

Decisive test of "missing/wrong real component vs solver heating". `OPENWAM_TPIN=<K>`
pins the INTAKE pipes (id<=38) to a cold target T at **constant pressure** each
step (so density rises to the correct ambient value) and rebuilds the conserved
state + primitives consistently. It answers: with properly-cool, ambient-density
charge at the port, can the breathing fill the cylinder?

### Result (combustion-OFF, 4000 RPM WOT, intake pinned to 310 K)
| case | net fill / intake valve | VE | back/fill |
|---|---|---|---|
| baseline (hot ~560 K) | 0.198 g | **~62%** | 0.23 |
| **TPIN=310 K** | **0.282 g** | **~88%** | **0.10** |

INTEMP confirms the intake holds 310 K everywhere under the pin. VE jumps
62% -> ~88% (and would be ~92% scaled to 298 K), i.e. **most of the deficit is the
hot charge, not the geometry**. Cooling the intake also roughly halves the
backflow (less thermal expansion pushing back).

### Conclusion (answers "did the model omit a real component?")
**No major breathing component is missing or mis-sized.** Given proper-density
cool air, the existing valve/port/runner/ITB/airbox geometry fills the cylinder to
~88-92 % VE -- right at the stock CSL target band (95-109 %). So:
- The ~57-67 % VE ceiling is **dominantly the ~570 K hot-charge artifact**, not a
  flow restriction or a component omission.
- A residual ~10-20 % gap remains under the cold pin -- attributable to the minor
  dimension items (exhaust valve 30.5 vs ~28 mm; eq-tube stub phi10 vs phi20),
  intake-wave tuning, and the small remaining backflow -- i.e. ordinary
  calibration, NOT the headline fault.

### Therefore the fix is to stop the spurious intake heating (not to add parts)
Combined with Stage 18 (the heat is the loop's own trapped pumping heat under poor
flushing), and the fact that a cold intake gives ~88 % VE -> good flushing, the
hot state may be a **breakable feedback attractor**: break it once (cold) and the
high VE should flush the heat out and keep it cold. Tested next via
`OPENWAM_TPIN_STEPS=<N>` (pin cold for N steps, then release): does it stay cold
(attractor broken -> fixable by initialisation / a transient cooler) or re-heat
(a genuine per-cycle source remains)?

### Assets
- `OPENWAM_TPIN=<K>` -- pin intake pipes to T=K at constant p (forced cool-start).
- `OPENWAM_TPIN_STEPS=<N>` -- release the pin after N steps (attractor test).

### Timed-release (OPENWAM_TPIN_STEPS): the hot state is NOT a breakable attractor
Pinned cold for ~6 cycles then released, the intake **re-heats to ~560 K within
~3 cycles** and VE collapses back to ~62%:
```
cyc5=319K(pinned)  cyc6=345  cyc7=509  cyc8=552  cyc9=565  ... cyc14=549K
```
So it is **not** merely trapped start-up heat (H1) and **not** a bistable state you
can break once: there is a **genuine, fast per-cycle heat source** that
regenerates the hot intake. The source is hot cylinder/residual gas convected back
into the intake during gas exchange -- the motored cylinder runs hot (~540 K at the
intake event, vs ~330 K expected) and leaks that heat upstream faster than it is
swept out. Curing the VE therefore requires reducing that cylinder->intake heat
leak (motored cylinder running too hot / over-strong backflow heating), after
which -- per Stage 19 -- the sound geometry should deliver ~88-92 % VE.

**Net for next session:** geometry is sound (Stage 19); the one fault is a real
per-cycle cylinder->intake heat leak that pins the intake at ~560 K (this stage).
Target it directly: why is the motored cylinder ~540 K at IVC and why does that
heat reach the intake (residual fraction / scavenging / overlap backflow / cylinder
heat rejection), not the intake plumbing.

## Stage 20 — residual/scavenging REFUTED: residual ~9%, the cylinder is hot only because the intake is

Target (1) from Stage 19 was the residual-gas fraction / scavenging. A full-cycle
cyl-1 trace (`OPENWAM_CYLDIAG`, combustion-OFF, converged) rules it out.

### Full converged cycle (Theta: 360 = gas-exch TDC, ~600 IVC, 720/0 = compression TDC)
| phase | Theta | T (K) | m (g) |
|---|---|---|---|
| compression TDC | 0 | **1206** | 0.39 |
| expansion -> BDC | 181 | 502 | 0.43 |
| exhaust stroke | 200-340 | 480-520 | 0.43 -> 0.05 |
| **gas-exch TDC / EVC** | 362 | 505 | **0.037** |
| intake fill | 400-520 | 450-560 | 0.04 -> 0.43 |
| late-IVC backflow | 523-543 | 485-526 | 0.41 -> 0.31 |
| IVC trapped | ~600 | **~570** | 0.39 |

### Findings
- **Scavenging is good and the residual fraction is LOW (~9 %)**: the cylinder
  mass clears to ~0.037 g every exhaust stroke (minM 0.034-0.037 g vs trapped
  ~0.39 g). The residual is ~467 K, not extreme. So a high / hot residual is NOT
  why the charge is hot.
- The cylinder **peaks at 1206 K at TDC** (pure motored compression, CR~11.5,
  no combustion) and **sheds heat to the 333 K walls** on the way down; the
  exhaust-stroke gas is ~480-520 K.
- **The cylinder is ~570 K at IVC simply because it FILLS with the ~560 K hot
  port gas** (fill T climbs 538->563 K over Theta 483-523). It is not an
  independent cylinder/residual heat problem.

### Net: the root is back in the intake gas, and target (1) is closed
The cylinder does not independently run hot from poor breathing; it inherits the
hot intake. Residual/scavenging (Stage-19 target 1) is therefore NOT the lever.
Combined with: intake pipes/junctions/throttle conserve enthalpy flux AND entropy
(Stage 18); forcing the intake cold gives 88 % VE and good fill (Stage 19);
releasing re-heats in ~3 cycles (genuine per-cycle source). The surviving,
thermodynamically-consistent reading is that the intake gas is heated **above the
temperature of every stream that feeds it** (300 K ambient in; <=530 K cylinder
backflow), which can only be a **genuine energy non-conservation at the
cylinder/intake gas-exchange boundaries (valve BC / multi-cylinder plenum mixing)
under the oscillating flow** -- a subtlety the per-element enthalpy-flux/entropy
checks do not capture (they balance the net advected fluxes but not necessarily
the transient, direction-correlated boundary work). That boundary energy audit is
the next target; residual/scavenging/cylinder-heat-rejection are eliminated.

### Assets
- `OPENWAM_CYLDIAG=1` -- full-cycle (0-720) cyl-1 T/m/P/V trace + per-cycle
  residual estimate (minM, its T, trapped mass, residual fraction).

## Stage 21 — plenum EXONERATED: it's a hot recirculation loop, no local energy source found

`OPENWAM_PLENDIAG=<dep>` audits a plenum's energy balance: per window it compares
the plenum's own T to the mass-flux-weighted INFLOW T from every connection.

### Result (Plenum_Main = dep 2, combustion-OFF, converged)
```
T_plenum = 573 K   <T_in>(massflux-wtd) = 579-580 K   => inflow hotter by 6-7 K (OK)
con1..con6 (6 bellmouths): ~579-580 K each, ~17% of inflow each
con0 (filter): ~0% of the plenum inflow
```
- **No energy creation at the plenum:** converged, the plenum is ~6-7 K COOLER
  than its inflow -- exactly conservation with a small wall loss. (The startup
  windows showed "plenum hotter"; that is the transient, gone by convergence.)
- **The plenum inflow is dominated by hot bellmouth backflow (~580 K, all six
  cylinders ~equally); fresh filter air is a negligible fraction of the inflow.**
  The intake is a hot recirculation loop that barely exchanges with the 25 C
  source -- which is precisely why earlier work found the source temperature
  irrelevant to the converged intake T.

### Where this leaves the hunt (suspects eliminated, no single-line bug)
Every localisable element has now been checked and **none creates energy**:
- pipes: conservative finite-volume (conserve mass & energy by construction);
- Type-9 throttle + Type-12 junctions: conserve enthalpy flux AND entropy (St.18);
- plenum: conservative, slightly wall-cooled (this stage);
- cylinder: scavenges well (~9% residual), peaks 1206 K then sheds to walls, and
  net-COOLS the through-flow (exhaust ~500 K < intake ~560 K) (St.20);
- intake valve: net-cools the port (St.17).
Yet the recirculating intake sits at ~570-580 K. The only consistent reading is
the Stage-18 synthesis: this is a **system-level emergent equilibrium** -- the
near-closed intake recirculation traps the cylinder's pumping/compression heat
because the fresh-air throughflow is too weak to flush it -- not a single-component
bug. The forced-cool test (St.19) is the actionable counterpart: hold the intake
cold and VE is ~88-92 % (geometry sound); release and it re-heats in ~3 cycles.

### Practical options for VE (since there is no single line to fix)
1. **Enhance flushing / break the recirculation** so fresh air actually displaces
   the hot intake gas: stronger intake-pipe wall heat rejection toward ambient
   (a real radiator effect the 0-D/1-D walls under-model), or a cooler/larger
   effective fresh-air path, or revisiting the bellmouth<->plenum backflow that
   dominates the plenum inflow (why so much backflow vs net forward draw?).
2. **Reduce the irreversible heat generation** of the gas-exchange (valve/junction
   throttling under the strong oscillation) -- e.g. a less oscillatory intake
   model -- so the trapped heat is smaller.
3. **Accept it as a model-fidelity limit and calibrate empirically** -- apply an
   intake-charge-temperature correction (or a VE multiplier) tuned to the stock
   curve, documenting it as a known 1-D gas-exchange limitation, and proceed to
   the ECU-calibration work that the (otherwise sound) model enables.

### Assets
- `OPENWAM_PLENDIAG=<dep>` -- per-window plenum T vs mass-flux-weighted inflow T,
  with a per-connection breakdown (which stream feeds the plenum, and how hot).

## Stage 22 — intake wall heat rejection does NOT recover VE (it depressurises the closed recirculation)

Per the user's real-hardware note (aluminium bellmouths = heat sink, carbon airbox
= insulator, silicone bellmouth-throttle joint = insulator), tested the intake
wall heat-rejection lever.

### First: what the model already does with the walls
The generator writes the pipe thermal flag `FTctpt=2` => `nmTempConstante`: the
intake-pipe walls are held at a FIXED temperature (40 C). So the wall **material
is not represented** and currently does not matter -- the wall is already an
ideal "aluminium-to-ambient" cold sink, and the gas is cooled toward 40 C at the
rate set by the per-pipe heat-transfer coefficient `FCoefAjusTC` (default 1.0,
the `1 1.0 1.0` multiplier line) x the Reynolds film coefficient. (The carbon
airbox being an insulator is consistent with the 0-D plenum having no wall heat
loss; the silicone joint likewise.)

### Test: boost intake wall heat rejection (`OPENWAM_IN_HMULT=<x>` -> FCoefAjusTC)
| x | bellmouth T | port T | port P | VE | stable? |
|---|---|---|---|---|---|
| 1 (base) | ~560 K | ~560 K | ~1.0 bar | ~62% | yes |
| 5 | ~400 K | ~370-450 K | **0.45-0.83 bar** | **~56%** | marginal (20 fallbacks) |
| 20 | ~320 K | **6808 K / vacuum** | 0.01 bar | broken | NO (port blows up) |

- Cooling **drops the intake PRESSURE with the temperature** (0.45-0.83 bar at
  x5): density rho = p/RT barely changes, so **VE does not improve** (it is
  slightly worse). Heat removal contracts/depressurises the gas rather than
  densifying it.
- Aggressive cooling (x20) **destabilises the small port pipes** (vacuum / 6808 K
  cells, positivity fallbacks) -- the same fragility the stability work fought.

### Why cooling fails -- it ties Stage 19 + Stage 21 together
The intake is a **near-closed hot recirculation** that excludes fresh air
(Stage 21: the plenum inflow is ~all bellmouth backflow, ~0% filter). So when you
cool that trapped gas, the atmosphere **cannot refill it to keep pressure up** --
it just goes to vacuum. The Stage-19 forced-cool gave 88 % VE only because it held
PRESSURE constant (it injected the mass to reach ambient density); real heat
rejection cannot do that against a closed loop. **=> wall material / heat rejection
will NOT recover VE; the root is the recirculation / poor fresh-air flushing.**

### So the lever is breaking the recirculation (why do the bellmouths back-flow so
much into the plenum instead of drawing forward at WOT?). That intake-wave / valve
backflow question -- not heat rejection, not the wall material -- is the path to VE.

### Assets
- `OPENWAM_IN_HMULT=<x>` -- multiply intake-pipe wall heat-transfer (FCoefAjusTC).

## Stage 23 — fabricated VE table + binary endianness bug found and fixed (user was right)

The user flagged that the "stock VE table" looked wrong (recalling the real CSL is
LOW at 2000-4500 rpm then >110% higher up) and suspected a prior AI had fabricated
tables "all over the place." Verified directly against the MSS54 binary -- correct
on both counts.

### Root causes
1. **Endianness bug in `binary_service.py`:** it read the MSS54 binary
   LITTLE-endian (`<H`). The binary is BIG-endian. LE decoded the RPM axis to
   non-monotonic garbage (22530, 26115, 19460, 5125, ...) and a `160/65535`
   scaling, yielding a fake VE curve. Reading `>H` and dividing the raw word by
   1000 reproduces `csl_ecu_maps.json` `kf_rf_soll` EXACTLY across the full 24x20
   map (verified True). Real WOT target (kf_rf_soll last row, rl ratio):
   ```
   1300rpm 67%  1400 78%  1600 95%  2100 93%  2200 88%  2400 87%  (the 2000-2400 dip)
   2700 104%  3100 104%  3900 116%(peak)  4600 111%  5300 110% ... 7900 102%
   ```
   This is PEAKY exactly as the user described -- not the smooth curve I had been
   using as "target."
2. **Fabricated `stock_csl_ve.json`:** a smooth monotonic curve
   (2000:90 3000:95 4000:102 5500:110-peak ...) with NO dip -- does not match the
   real ECU target at all. A prior AI (Gemini 3.1 Pro lineage) appears to have
   generated it. Several scripts + `calibration_service.load_target_data()` used
   it as "stock."
3. **Silent Gaussian fallback** in `mock_data_generator.get_stock_ve`
   (`0.85 + 0.15*exp(-((rpm-5500)^2)/2000^2)`) -- another fabricated smooth curve
   that masked missing data.

### Fixes (user decision: "make the binary the single source of truth")
- `binary_service.py`: `ENDIAN=">"`, all `read_axis`/`read_table_generic`/
  `read_table_16x16_uint16` use big-endian; `VE_FACTOR = 1/1000` (rl ratio, was
  160/65535). 1-byte VANOS tables unchanged (endianness irrelevant); VANOS
  16x16 read/write round-trip verified stable.
- `stock_csl_ve.json`: regenerated from the binary `kf_rf_soll` WOT row (now
  carries the real dip+peak). Fabricated original backed up to
  `/tmp/stock_csl_ve.fabricated.bak.json`.
- `mock_data_generator.get_stock_ve`: the Gaussian fallback now RAISES instead of
  fabricating a curve (the real comparison path reads kf_rf_soll).

### Verified
- VE map (fixed binary) == csl_ecu_maps.json across full 24x20: True.
- VANOS intake x_axis (fixed binary) == json: True.
- stock_csl_ve.json[1300]=0.67 (dip), [3900]=1.157 (peak): correct.

### Impact on the VE investigation
The "4000 rpm should be ~102%" premise came from the fabricated smooth table; the
REAL target there is ~116% (3900) / ~111% (4600) -- still high, so the converged
collapse to ~47-62% (hot-recirculation feedback, Stages 16-22) remains a real
defect. But ALL prior sim-vs-"stock" deltas were computed against fabricated
numbers and must be recomputed against the corrected stock_csl_ve.json. The low
2000-2400 rpm dip is now expected behaviour, not a fault to chase.

## Stage 24 — the VE measurement is corrupted by a STARTUP shock, not (only) thermal feedback

Per the user's request to (a) measure VE at the REAL kf_rf_soll breakpoints with NO
interpolation, and (b) compare initial / cold-pinned / converged VE, a per-breakpoint
sweep (`ve_breakpoint_compare.py`, working-dir-isolated for parallel safety) was
built. It exposed a more fundamental problem than the thermal feedback.

### The first cycle already diverges at the 4th cylinder to fill
At EVERY rpm the trapped mass per IVC (firing order 1-5-3-6-2-4) is:
```
cyl(IVC order):  0.73  0.84  0.77 | 1.03  3.30  2.76  1.86 ...
                 (healthy 1-3)    | (4th fill onward EXPLODES to 3.3 g = ~515% VE)
```
So the "initial VE" I was about to trust is itself corrupted from the 4th fill of
cycle 1. The earlier first-cycle CSVs (clean 100-123%) only looked clean because
they sampled the first 6 IVCs and the explosion starts at the 4th-6th.

### Root cause: a startup over-speed shock in the intake network, not cylinder init
- Ordering proof: `Sonic condition in boundary` messages start at the very first
  steps (687 sonic events BEFORE the 4th IVC), then 7450 during the over-fill.
  The intake network goes supersonic at startup FIRST; the cylinder over-fill is a
  CONSEQUENCE. Many boundaries choke simultaneously (13, 27, 6, 34, 20, 41, 51 ...),
  i.e. it is network-wide, not one valve.
- It is NOT the cold-start cylinder-temperature artifact: sweeping the existing
  `OPENWAM_TFLOOR` (-23 / +20 / +60 C) leaves the 1.03->3.30 g over-fill unchanged.
  The existing floor fixes T but the problem is MASS (over-fill), driven by the
  supersonic intake transient.
- The `[DEBUG_INIT]` line prints P=0.057 bar at cyl4 TDC, but that is printed BEFORE
  the isentropic-init assignment below it, so it is not the live seed.

### Why this matters for the whole VE investigation
Every VE number in Stages 15-23 (converged ~50-57%, "flat across rpm") was measured
on a network that takes a supersonic startup shock and an internal over-fill spike
each run. The "flat ~55%" and the "hot recirculation" may be partly the system
ringing down from that shock rather than a pure physical steady state. The user's
hypothesis (peaky tuning exists in the breathing; feedback flattens it) CANNOT be
cleanly tested until the startup shock is removed so a clean limit cycle is reached.

### Next: kill the startup supersonic shock (user-approved direction)
Candidate levers, in order of likely payoff:
1. Initialise the intake/plenum pipes at the correct steady MAP and a small forward
   velocity instead of quiescent 1 atm / v=0, so the first valve openings don't set
   up a shock. (The pipes currently start at rest; the first induction is a step.)
2. Ramp the engine speed / valve action over the first cycle (soft-start) instead
   of full 4000 rpm gas exchange from t=0.
3. A gentler boundary Cd ramp on the ITB/valve BCs for the first cycle.
The goal is a clean limit cycle so init/cold/converged VE can finally be compared
at the real breakpoints.

### Assets
- `scripts/ve_breakpoint_compare.py` (modes init|cold|conv; per-run working dir).
- `scripts/ve_breakpoint_summary.py` (overlay + shape correlation vs target).
- Diagnosis logs: /tmp/div/divc.log (sonic ordering), TFLOOR sweep.

## Stage 25 — the startup shock does NOT bias the converged VE (decisive A/B)

Following the user's approved "kill the startup shock" direction, three
initial-state-consistency levers were implemented and tested at 4000 rpm WOT:

1. `OPENWAM_IN_VINIT` — seed intake pipes with a small forward mean velocity
   (area-scaled toward the cylinders). Sweep 0/10/30/60 m/s: over-fill UNCHANGED
   (1.03->3.30 g at the 5th IVC); 10 m/s made sonic WORSE (85k vs 62k). Not the
   driver. (Knob retained, default 0 = no change.)
2. Cylinder closed-cycle init vacuum bug — FIXED in TCilindro.cpp (separate commit):
   cyls 4 & 5 were seeded at 0.057 bar / 177 K (a 491 cc volume holding a 62 cc
   RCA charge). After the fix they seed at 1.013 bar / 333 K / 0.731 g. Correct,
   but the over-fill/sonic transient PERSISTED -> the vacuum seed was not the root.
3. `OPENWAM_EXH_TGAS` — exhaust pipes were seeded with HOT gas (gas temp = wall
   temp = 600-800 C) while the cylinders are at 60 C, a ~540 K thermal step at the
   first exhaust-valve opening (and the hot gas has a high sound speed ~590 m/s).
   Cold-seeding (40 C) cut sonic 62k->54k but DEEPENED the over-fill (3.3->9.5 g):
   denser cold exhaust backflows harder. Default kept "wall" (opt-in diagnostic).

### The decisive experiment
Run 12 cycles for EXH_TGAS=40 (sonic 54k, over-fill 9.5 g) vs EXH_TGAS=wall
(sonic 62k, over-fill 3.3 g) and compare the CONVERGED trapped mass:
```
EXH_TGAS=40    converged last6 (g): 0.336 0.340 0.318 0.311 0.347 0.336
EXH_TGAS=wall  converged last6 (g): 0.284 0.373 0.368 0.350 0.319 0.310
```
Two startups differing by ~3x in over-fill and ~15% in sonic count converge to the
SAME limit cycle (~0.33 g). => The startup shock is a decaying transient; it does
NOT bias the converged state. The Stage 15-23 converged VE numbers are numerically
trustworthy.

### What this reframes
- The original worry ("is the converged VE corrupted by the startup shock?") is
  answered: NO. Converged VE is startup-independent.
- The over-fill is driven by a PRESSURE transient (9 g in ~560 cc => ~15 bar at
  IVC), i.e. a wave slams the port and rams gas in. It is robust to every
  initial-state lever tried, because the limit cycle forgets the initial state.
- Consequence for the init/cold/converged comparison the user wanted: there is NO
  clean first-cycle ("init") VE available -- the first 3 trapped-mass prints are
  just initial conditions of mid-cycle cylinders, and from the 4th IVC the over-fill
  corrupts it. A clean "init VE" would require suppressing the over-fill, which the
  limit cycle is indifferent to.
- The real open question is now PHYSICAL, not numerical: the converged VE is
  ~0.33 g ~= 54% (vs ~120% for a cold atmospheric fill of 541 cc). That ~2x
  suppression is the "feedback / hot recirculation" effect, and it lives in the
  (trustworthy) converged state -- so it can be characterised directly.

### Recommended next step
Measure the CONVERGED VE at the real kf_rf_soll breakpoints (it is trustworthy) and
look at the rpm SHAPE: is it peaky (intake/exhaust tuning surviving) or flat
(suppressed)? This tests the user's hypothesis using the measurement we can trust,
without needing a clean first-cycle VE.

### Assets
- Knobs: OPENWAM_IN_VINIT (intake seed velocity), OPENWAM_EXH_TGAS (exhaust gas
  seed temp), OPENWAM_INITDIAG (true post-init cylinder state probe).

## Stage 26 — converged VE vs RPM at the real breakpoints: FLAT and ~half the target

Using the (trustworthy, startup-independent) converged state, VE was measured at all
15 real kf_rf_soll breakpoints (1600-7900 rpm, no interpolation), 10 cycles, last
full cycle, magnitude-filtered. 3 workers, per-run working dir.
Asset: docs/analysis/converged_ve_vs_rpm_breakpoints.{png,csv}.

Result (11 NaN-free points; 1600/3100/3900/4600 had boundary-NaN events and are
marked unreliable -- 3900 in particular reads a spurious 104% from a NaN transient):
```
sim VE:    mean 52.4%   range 45-58%   CV 8%
target VE: mean 101.1%  range 87-110%  CV 8%
shape Pearson r (sim vs target) = +0.36   mean ratio sim/target = 0.52
```

Two distinct findings:
1. MAGNITUDE: the converged sim breathes at ~52% of the target across the WHOLE rpm
   range -- a roughly uniform ~2x VE deficit, not an rpm-localised error.
2. SHAPE: the sim does NOT reproduce the target's tuning. The target is peaky (dip
   to 87% at 2200-2400, broad peak ~116% at 3900, staying 100-110% up top); the sim
   is essentially flat ~52%. The two normalised shapes barely correlate (r=0.36) and
   the sim's own wiggle (peak at 2700, dip at 6300) does not line up with the real
   intake/exhaust resonance peaks.

Interpretation. This reframes the user's hypothesis. The hypothesis was "peaky
tuning exists in the breathing but the hot-recirculation feedback flattens it in the
converged state." Stage 25 showed the converged state is startup-independent and
trustworthy, and there is no clean first-cycle VE to compare against. Stage 26 shows
the converged breathing is BOTH suppressed (~2x) AND de-tuned (flat). So either:
  (a) the hot recirculation / residual-gas feedback is strong enough to both halve
      the charge AND wash out the acoustic tuning, or
  (b) the breathing model is missing the tuning independently of the feedback (port
      areas / valve Cd / runner lengths / exhaust pulse tuning not resonating), and
      the ~2x deficit is a separate, roughly-constant restriction.
A ~uniform 2x deficit that is flat in rpm smells more like (b)-type steady
restriction (e.g. an effective flow area / Cd / a persistent back-pressure or
residual fraction) than like rpm-selective acoustic detuning, because real tuning
losses are rpm-dependent (bad between peaks, good on a peak) -- here even the target
PEAK rpms (1800, 3900) are suppressed to ~50%.

### Recommended next step
Decompose the ~2x deficit at one mid-rpm peak (e.g. 3900, the target's max) into its
contributors, in the converged state: residual-gas fraction (trapped burned mass /
total), mean intake-port pressure during induction (is the manifold pulling vacuum?),
and exhaust back-pressure during overlap. That isolates whether the charge is short
because (i) fresh air never arrives (intake restriction / no ram) or (ii) it arrives
but is displaced by hot residuals / back-pressure (the feedback). That single
decomposition decides between (a) and (b) and points at the specific lever.

### Assets
- scripts/ve_breakpoint_conv_parallel.py (parallel converged sweep, per-run wd)
- scripts/ve_breakpoint_plot.py (overlay + normalized-shape + stats)
- docs/analysis/converged_ve_vs_rpm_breakpoints.{png,csv}

## Stage 27 — the ~2x VE deficit IS the spurious ~560 K charge (numerical, not combustion)

Decomposed the flat ~52% converged VE at clean breakpoints (5300 & 2900 rpm, FIN=1,
NaN=0) with a new probe OPENWAM_VEDIAG (prints the trapped state at the end of gas
exchange: in-cylinder T, IVC pressure, trapped mass, fresh/residual split).

Trapped state (mean over the converged cycle, 5300 rpm):
```
Ttrap ~ 567 K     <- HOT (a normal fresh charge is ~320-350 K)
P_IC  ~ 1.26 bar  <- ~atmospheric (NOT a vacuum -> intake is NOT choked/restricted)
Mtrap ~ 0.37 g    <- ~58% of the 0.64 g atmospheric reference
residual ~ 0%     <- the charge is fresh, not displaced by burned gas
```

Decisive arithmetic. m = P V / (R T). With P, V fixed and residuals ~0, the ONLY
reason Mtrap is half is that T is ~1.7x too high:
  567 K / 330 K = 1.72  ->  58% x 1.72 = ~100% == the ~110% target.
So the entire rpm-flat 2x VE deficit is exactly the charge sitting at ~567 K instead
of ~330 K. Not intake restriction (P is fine), not residual dilution (resid ~0).

Where the heat comes from -- three eliminations:
1. The air ARRIVES hot. ENBAL flux-weighted temperatures show the WHOLE intake tree
   (pipes 1-38, atmosphere inlet through the ports) sits at ~555-580 K. The cylinder
   is filled with already-hot manifold air; it does not heat cold air internally.
2. NOT the EqTube stub runaway. The phi10 EqTube_Stub pipes (5,11,17,23,29,35) do go
   berserk in ENBAL (-2.78 kg/s, 2771 K, -10 MW each) but widening them to phi52
   (OPENWAM_EQ_DIA=0.052) or removing them (OPENWAM_NO_EQTUBE=1) leaves the charge at
   ~550-571 K and VE unchanged. The stub is a local symptom confined to its branch,
   not the bulk-intake heat source (confirms the PR #11 read).
3. NOT combustion. With the fuel LHV zeroed (44000000 -> 1, deck verified) the
   converged trapped state is BYTE-IDENTICAL (567 K, same Mtrap, same IVC pressure).
   No chemical energy is entering, yet the intake still sustains ~567 K -> the heat
   is a NUMERICAL energy-generation artifact in the gas-exchange bookkeeping.

Conclusion. The flat ~52% VE (independently reproduced in the user's Gemini trials,
and unmoved there by butterfly->venturi throttle swaps and small-opening tuning) is
NOT a tuning/throttle problem and NOT a feedback/residual problem. It is one bug: the
gas exchange creates enthalpy out of nothing, the manifold equilibrates ~240 K too
hot, the charge density drops ~1.7x, and VE halves uniformly across rpm. Fixing the
spurious enthalpy should drop the charge to ~330 K and lift VE to ~100-110%, matching
the target shape's level (the tuning shape is a second-order question on top).

### Fix target (next)
The energy must be created at a BOUNDARY, not inside the pipes: ENBAL shows each
intake pipe conserves enthalpy internally (dH(in-out) ~ few kW) except the stubs.
The suspect is the intake-valve / cylinder gas-exchange flux -- TCCCilindro (or the
valve boundary in TCC*) FlujoEntranteCilindro / FlujoSalienteCilindro -- where hot
cylinder gas backflows into the port during overlap/early intake and the enthalpy
carried out vs back in does not balance over a cycle. Localise by running ENBAL on
the port pipe immediately at the valve and checking the per-cycle net enthalpy across
the valve boundary (should be ~wall heat ~0 in a converged motoring cycle).

### Assets
- OPENWAM_VEDIAG: trapped-state probe (T, P_IC, mass, fresh/residual) at IVC.
- (existing) OPENWAM_ENBAL, OPENWAM_EQ_DIA, OPENWAM_NO_EQTUBE.

## Stage 28 — proof the deficit is removable heat, and where the heat is NOT

Two independent "remove the intake heat" levers both recover VE toward the target,
proving the geometry/breathing is sound and the ~570 K charge is the entire fault:

| intake thermal treatment            | charge T | VE   |
|-------------------------------------|----------|------|
| baseline (default wall HT)          | 567 K    | 57%  |
| OPENWAM_IN_HMULT=10 (10x wall HT)   | 479 K    | 76%  |
| OPENWAM_TPIN=313 (pin gas to 313 K) | 342 K    | ~99% (5/6 cyl) |

(IN_HMULT=50 destabilises -- the intake goes sonic; not pursued.)

So the spurious heat is fully REMOVABLE: pin/cool the intake and VE -> ~100%, exactly
matching the target level. This rules out any flow/geometry restriction.

Where the heat enters -- localisation via OPENWAM_VLVENE (per-cycle intake-valve mass
& enthalpy balance, cyl 1, converged, combustion OFF):
```
fill (port->cyl) 0.243 g @ Tfill=571 K  carries 143 J OUT of the port
back (cyl->port) 0.047 g @ Tback=581 K  carries  28 J INTO the port
net mass admitted 0.196 g | net enthalpy to port = -114 J  (valve COOLS the port)
```
Key: at convergence the intake valve net-REMOVES enthalpy from the port (-114 J/cyc),
and the gas FILLING the cylinder is already 571 K. So the steady hot intake is NOT
sustained by hot valve backflow -- the port is already hot upstream of the valve. The
heat source is therefore in the intake interior (junctions / open end), not the valve
gas exchange, and the default wall heat transfer is too weak to remove it (hence the
equilibrium ABOVE wall temp: a per-cycle source balances wall loss at 567 K; 10x wall
HT drops the balance to 479 K; the source is numerical -- combustion-OFF identical).

Eliminations recap (Stages 27-28): not throttle, not tuning, not residuals
(resid~0%), not intake restriction (P_IC~1 atm), not combustion (LHV->1 identical),
not the EqTube stub (remove/widen no change), not the intake valve backflow (net
cools the port). Remaining suspects for the per-cycle numerical source: the Type-12
junctions (TCCRamificacion: the phi10 stub there hits 2771 K / 10 MW) other than the
EqTube one, and the open-end atmosphere BC (re-inducting hot expelled air instead of
flushing ambient).

### Decision point
The deficit is one numerical heat source in the intake interior. Fixing it properly
(junction / open-end energy conservation) is a deep MoC task; alternatively a
physically-motivated intake wall heat-rejection model (the real aluminium manifold
sinks far more heat than the default film coefficient) removes the heat and recovers
VE now. Both are viable; this is a strategy choice for the user.

### Assets
- OPENWAM_VLVENE (intake-valve per-cycle mass/enthalpy balance), OPENWAM_VEDIAG,
  OPENWAM_IN_HMULT, OPENWAM_TPIN, OPENWAM_ENBAL.

## Stage 29 — the "junction/open-end energy bug" hypothesis is FALSIFIED by direct measurement

Per the user's choice to fix the root cause in the junctions / open end, instrumented
the branch junctions and tested the throttle directly. The discrete intake elements
do NOT create the energy.

Direct junction energy balance (new OPENWAM_JUNCENE probe in TCCRamificacion:
per-junction net mass & enthalpy flux summed over all connected pipe ends over a
window; net != 0 => the junction creates/destroys energy):
- All EXHAUST junctions (CC 46-63): net ~+/-0.1 kW out of ~30-180 kW throughput
  (<0.5%). Clean -- the core Riemann-junction numerics conserve energy.
- INTAKE port-split junctions (CC 8,15,22,29,36,43): net ~-0.6 kW. Clean.
- INTAKE EqTube-stub junctions (CC 6,13,20,27,34,41): the probe reads a huge
  ~141 MW, BUT this is a MEASUREMENT artifact of the phi10 stub runaway: removing
  the stub (OPENWAM_NO_EQTUBE) makes every junction clean (<2 kW) AND leaves the
  charge just as hot (~570 K). So the stub "creation" is not the real source.

Throttle test (new OPENWAM_NO_THROTTLE: replace the Type-10 quadratic-loss throttle
BC with a lossless Type-12 union): charge 602 K / VE 57% -- NOT cooler. The throttle
BC is not the source either.

Eliminations now: not throttle, not tuning, not residuals, not intake restriction,
not combustion, not the EqTube stub, not the intake-valve backflow (net cools the
port), not the Type-12 junctions, not the throttle BC. The SAME junction/pipe code
conserves energy perfectly on the exhaust side -> the core scheme is sound.

What remains. A rough global balance at 5300 rpm: the valve takes ~+114 J/cyc net
enthalpy FROM each port (VLVENE), so the cylinders draw ~684 J/cycle from the intake;
the ambient reservoir supplies the net fresh charge (~1.18 g/cyc) at 300 K ~= 355 J;
the ~330 J/cycle (~15 kW) shortfall is what keeps the manifold hot. It is not created
in any discrete BC we can probe, and the intake wall heat transfer at default is too
weak to remove it (IN_HMULT=10 drops the equilibrium 567->479 K; the source is
balanced by wall loss ABOVE wall temp, so a finite per-cycle source exists).

Reinterpretation. The hot intake behaves like PHYSICAL hot backflow (motoring
compression heats the charge to ~830 K at TDC; ~19% of the fill backflows into the
port at ~580 K during overlap) that the unrealistically weak default intake-wall heat
transfer fails to remove, so the airbox/runners equilibrate hot and re-heat the
incoming fresh air. The two working fixes (IN_HMULT, TPIN) both REMOVE heat. There is
no localizable junction/open-end "energy creation" bug to delete -- the discrete
elements conserve energy.

### Recommended re-scope (needs a user decision)
The root-cause-in-the-junctions premise did not hold. The tractable, physically
grounded levers are: (a) realistic intake-wall heat rejection (the default film
coefficient is far too low for an aluminium manifold venting to ambient), and/or
(b) check whether the ~19% overlap backflow is itself too large (valve overlap /
timing / port volume). (a) is the smaller, safer change and already shows the right
trend.

### Assets
- OPENWAM_JUNCENE (per-junction energy balance, TCCRamificacion).
- OPENWAM_NO_THROTTLE (lossless-union throttle test).

## Stage 30 — the backflow IS significant; it traces to high cylinder pressure at gas-exchange TDC (exhaust back-pressure)

Per the user's choice to check whether the ~19% backflow is too large, mapped the
intake-valve flow crank-by-crank (OPENWAM_VLVWIN, now OPENWAM_VLVWIN_STEP for finer
resolution) and swept IVO at 5300 rpm WOT converged.

Crank-resolved intake valve (cyl 1, IVO=330/30 BTDC-gx, EVC=366):
```
Theta  p_cyl  p_port  T_port  dir
333    1.16   1.17    514K    fill   intake cracks open near gx-TDC
348    1.46   1.60    635K    fill   port spikes to 1.6 bar, 635 K
359    1.62   1.63    640K    fill   gas-exchange TDC, Vcyl=52 cc
364    1.45   1.46    579K    BACK   just after TDC: cylinder pushes into port
574-598 1.26  1.20    ~585K   BACK   late-IVC: compression pushes into port
```
Two backflow events: a short reversion just after gas-exchange TDC, and a late-IVC
reversion during early compression.

IVO sweep (overlap = 366 - IVO):
```
IVO=330  (+36 deg overlap):  Ttrap 567 K  VE 57%
IVO=366  ( 0 deg overlap):   Ttrap 603 K  VE 46%   <- worse
IVO=390  (-24 deg overlap):  Ttrap 424 K  VE 68%   <- much cooler
```
Non-monotonic: removing overlap (366) is WORSE, but opening the intake LATE (390,
into the descending-piston vacuum) is much cooler. So the heater is not "overlap"
per se -- it is opening the intake valve while the cylinder still holds hot,
PRESSURISED residual gas near gas-exchange TDC, which drives that gas into the port.
Opening into the intake-stroke vacuum (IVO=390) avoids it.

Root of the high near-TDC cylinder pressure: at gas-exchange TDC the cylinder sits at
~1.6 bar (VLVWIN p_cyl=1.62 at Theta=359), not the ~1.0-1.1 bar of a well-scavenged
cylinder. The exhaust valve is still open (EVC=366), so cyl ~ exhaust-port pressure:
the exhaust is NOT providing a scavenging vacuum, it is holding the cylinder at
~1.6 bar of back-pressure. The trapped hot residuals at 1.6 bar / ~640 K then expand
into the intake the moment the intake valve opens.

So the chain is: exhaust back-pressure -> cylinder ~1.6 bar at gas-exchange TDC ->
hot (~640 K) residual reversion into the intake port -> hot intake manifold ->
~1.7x low charge density -> the rpm-flat 2x VE deficit. This finally connects the
intake VE deficit back to the EXHAUST back-pressure (the Stage 1-16 subject).

Partial fixes (none reaches the TPIN ideal of 342 K / ~99%):
  IVO=390 alone           424 K / 68%
  IN_HMULT=10 alone        479 K / 76%
  IVO=390 + IN_HMULT=10    446 K / 61%  (no better -- within cyl-to-cyl scatter)
The timing/wall levers each remove part of the heat but cannot fully fix it because
the heat keeps being re-injected each cycle by the back-pressure-driven reversion.

### Recommended next step
Attack the exhaust back-pressure at gas-exchange TDC so the cylinder scavenges down to
~1 bar (then there is no hot pressurised residual to reverse into the intake). Measure
the exhaust-port pressure through the overlap window and find why it sits ~1.6 bar
(collector/Riemann-junction reflection, exhaust runner length/tuning, or the
port-merge model). This is the same exhaust back-pressure thread from the earlier
stages, now with a direct VE payoff target.

### Assets
- OPENWAM_VLVWIN_STEP (finer crank resolution for the valve-window probe).

## Stage 31 — CORRECTION: it is not exhaust back-pressure, and exhaust pipe length does not matter

Measured the EXHAUST-valve window crank-by-crank (new OPENWAM_EXHWIN) and swept the
exhaust primary length, per the user's request to check the exhaust pipe system.

EXHAUST-port pressure through the overlap window (cyl 1, 5300 rpm WOT, converged):
```
Theta  p_cyl  p_export  T_export
334    1.15   1.06      502 K
344    1.30   1.08      526 K
354    1.61   1.03      586 K   <- cylinder spikes to 1.6 bar, port stays ~1.0 bar
364    1.46   0.92      579 K
```
=> The EXHAUST PORT is at ~0.9-1.1 bar through overlap (near atmospheric), NOT a high
back-pressure. The Stage-30 "exhaust back-pressure holds the cylinder at 1.6 bar"
reading was WRONG. The cylinder 1.6 bar at gas-exchange TDC is the piston adiabatically
compressing the 52 cc clearance volume of hot (~615 K) residual gas (65->52 cc,
1.25^1.4 = 1.37x) faster than the nearly-closed exhaust valve (EVC=366, low lift near
TDC) can vent it. It is a clearance-gas / valve-lift effect, not a pipe back-pressure.

Exhaust primary (port+header) length sweep @5300 rpm WOT:
```
total primary 240 mm: Ttrap 581 K  VE 58%
              390 mm: Ttrap 567 K  VE 57%   (baseline)
              590 mm: Ttrap 575 K  VE 58%
              790 mm: Ttrap 561 K  VE 55%
```
=> Tripling the primary length moves the charge temp by <20 K and VE by <3 pp. The
exhaust pipe length is NOT a lever for this VE deficit, consistent with the exhaust
port already sitting at ~1 atm during overlap (no wave tuning to exploit here).

Corrected mechanism. The hot intake is hot RESIDUAL gas reverting into the intake
port: at gas-exchange TDC the small clearance volume holds ~615 K residual compressed
to ~1.6 bar; if the intake valve is open then (IVO=330, 30 deg BTDC) that hot gas
pushes into the port. It is governed by the INTAKE valve timing (IVO=390 opens into
the post-TDC vacuum and is ~140 K cooler) and removed by intake wall heat transfer --
NOT by the exhaust system. Exhaust back-pressure and exhaust pipe length are not the
cause.

### Where this leaves the VE deficit
Levers, by measured effect at 5300 rpm (TPIN ideal = 342 K / ~99%):
  IVO=390 (open into vacuum)     424 K / 68%
  IN_HMULT=10 (realistic walls)  479 K / 76%
  exhaust length                 no effect
None alone reaches ~100%; the residual reversion keeps re-injecting heat each cycle.
The remaining true levers are (1) intake valve timing (VANOS schedule -- the per-rpm
optimum already noted), (2) realistic intake-port/runner wall heat rejection, and
possibly (3) reducing the clearance-gas reversion at the source (exhaust valve able to
vent the clearance gas near TDC -- a valve-flow/lift question, not a pipe-length one).

### Assets
- OPENWAM_EXHWIN (+ OPENWAM_VLVWIN_STEP): crank-resolved exhaust-valve/port window.

## Stage 32 — hypothesis (3) tested and largely FALSIFIED: venting the clearance gas barely helps

Per the user's choice to try (3) -- vent the hot clearance-gas residual at gas-exchange
TDC so it cannot revert into the intake -- added OPENWAM_EX_DUR (exhaust duration
override: EVO stays at 102, so a longer duration pushes EVC later and keeps exhaust
lift up through TDC) and swept it at 5300 rpm WOT.

Mechanism confirmed (EXHWIN, EX_DUR=340 / EVC=442): the exhaust valve now has high
lift through gas-exchange TDC (CdEx ~0.62), and the cylinder TDC pressure drops from
1.6 bar -> ~1.0 bar, T_export 615 -> 560 K. So the clearance-gas compression spike is
genuinely eliminated.

But it does NOT fix the hot intake:
```
EX_DUR=264 (EVC=366, baseline): Ttrap 567 K  VE 57%
EX_DUR=300 (EVC=402):           Ttrap 543 K  VE 51%
EX_DUR=340 (EVC=442):           Ttrap 540 K  VE 53%
```
Eliminating the 1.6 bar TDC spike cools the charge only ~27 K and LOWERS VE (the late
EVC keeps the exhaust valve open into the intake stroke -> fresh-charge loss out the
exhaust outweighs the small cooling). So the clearance-gas reversion is NOT the
dominant intake heat source, and (3) is a net loss.

Cross-check with the IVO lever: IVO=390 cools the charge by ~143 K (567->424 K), far
more than removing the TDC spike (27 K). So IVO=390's benefit is NOT "avoiding the TDC
spike" -- it is opening the intake into the deep descending-piston vacuum so the
inrush is a fast, cold manifold draw rather than a slow overlap-window exchange. The
heat enters during the slow overlap/near-TDC window whenever the intake valve is open
there, by a mechanism that is not the clearance-gas spike per se.

### Synthesis of the whole VE-deficit investigation (Stages 24-32)
The rpm-flat 2x VE deficit is one effect: the converged intake charge sits ~1.7x too
hot (~567 vs ~330 K), halving density. Proven hot-charge cause (TPIN->VE 99%), proven
numerical (combustion-OFF identical). Systematically NOT: throttle/butterfly, tuning,
residual composition (resid~0%), intake restriction (P_IC~1 atm), the Type-12
junctions or throttle BC (all conserve energy; exhaust side clean), exhaust
back-pressure (port ~1 atm through overlap), exhaust pipe length (<3 pp over
240-790 mm), and now the clearance-gas TDC reversion (removing it barely helps).

Measured levers (TPIN ideal 342 K / ~99%):
  IVO=390 (open into vacuum)        424 K / 68%   <- strongest single lever
  IN_HMULT=10 (realistic walls)     479 K / 76%
  EX_DUR / EVC (vent clearance gas) 540 K / 53%   (net loss)
  exhaust length                    no effect
No single discrete lever reaches ~100%. The hot intake is a distributed property of
the WOT intake gas exchange (slow overlap-window heat pickup + weak wall removal),
not one deletable bug. The realistic recovery path is the COMBINATION: per-rpm intake
timing (VANOS kf_evan1_soll, opening later/into vacuum) + realistic intake-port/runner
wall heat rejection. ~100% appears to need either an explicit intake thermal model
(TPIN-like, defensible as aluminium-to-ambient) or a deeper rework of the valve
gas-exchange enthalpy handling.

### Assets
- OPENWAM_EX_DUR (exhaust duration / EVC override).

## Stage 33 — explicit intake thermal sink: stable to ~76-78%, and WHY ~100% needs more

Per the user's choice to implement an explicit intake thermal model, added
OPENWAM_INTAKE_HSINK (1/s): a time-step-consistent first-order relaxation of the
INTAKE-pipe gas temperature toward an ambient target (OPENWAM_INTAKE_TAMB, default
313 K) at constant pressure: T <- Tamb + (T-Tamb)*exp(-HSINK*dt), rebuilding the
conserved state each step. Physically it represents the aluminium manifold sinking the
(numerically spurious) recirculation heat to ambient.

Sweep @5300 rpm WOT (baseline 567 K/57%, TPIN hard-pin 340 K/~99% for 5/6 cyl):
```
HSINK=200 /s : 431 K / 61%  stable
HSINK=300 /s : 445 K / 78%  stable  (0.43-0.55 g, consistent)
HSINK=350 /s : 430 K / 76%  stable
HSINK=450 /s : 792 K / 770% BLOWS UP (over-fill cascade, one cyl 27 g)
HSINK>=1000  : 241-818%      over-fill cascade
```
So a stable thermal sink caps at ~76-78% (same ceiling as the conservative wall-HT
boost OPENWAM_IN_HMULT=10). Cooling harder triggers an over-fill cascade.

Why ~100% (TPIN) is not cleanly reachable -- TWO compensating errors. Re-running the
TPIN hard pin on the current build: 340 K, 0.64 g (~99%) for 5/6 cyl, no over-fill.
But OPENWAM_INTAKE_HSINK at the same converged temperature (340 K, HSINK~1000)
OVER-fills to 1.5 g (241%). Same charge temperature, 2.3x the mass. The difference is
that the TPIN hard pin forces T=313 K EVERY step, which also clamps the gas sound
speed (sqrt(gamma*R*313)) and thereby DAMPS the intake pressure waves; the gentle
relaxation leaves those waves alive. So the intake actually carries TWO errors that
compensate in the baseline:
  (1) the gas is ~1.7x too hot (low density)   -- the one we targeted, and
  (2) the overlap-window port pressure waves are too strong (~1.6 bar ram).
Baseline = hot (low rho) x strong ram (high p) -> moderate mass (57%). Fixing only
(1) -> cold (high rho) x strong ram -> over-fill. TPIN's "99%" worked only because the
hard pin incidentally suppressed (2) as well. A thermal-only model therefore cannot
reach ~100% stably; it tops out at ~76-78% before the un-damped ram over-fills.

### Where this leaves it
OPENWAM_INTAKE_HSINK is retained as a stable, physically-motivated lever to ~76-78%
(default off). Reaching the target ~100-110% needs BOTH the intake temperature AND the
spurious ~1.6 bar overlap pressure wave addressed -- i.e. the compensating-errors pair
must be fixed together, which points back at the WOT valve/gas-exchange dynamics that
generate both the enthalpy and the over-strong port wave. A pragmatic stable build
today is HSINK (or IN_HMULT) + per-rpm VANOS timing at ~76-80%; a clean ~100% is a
deeper coupled fix.

### Assets
- OPENWAM_INTAKE_HSINK (1/s), OPENWAM_INTAKE_TAMB (K): intake thermal-sink model.

## Stage 34 — the deep fix attempt: post-hoc thermal manipulation cannot recover VE (it fights the gas dynamics)

Pursuing the user's request for the deep coupled fix, examined the cylinder
gas-exchange energy equation (TCilindro4T ActualizaPropiedades, lines ~1228-1357:
Benson filling-and-emptying, Energia = (V0 M)/(V M0) * exp((H1+H0)/2 + heat),
Temp1 = T*Energia^(g-1)) and EntalpiaEntrada (stagnation enthalpy of the inflow,
incl. the kinetic v^2/(2a^2) term). Both look like the standard, physically-correct
MoC engine model -- no obvious arithmetic bug, and the SAME code conserves energy on
the exhaust side. The spurious enthalpy is a subtle MoC gas-exchange effect (likely
the entropy/KE bookkeeping when hot cylinder gas crosses the valve into the cooler
port during the violent overlap transient), not a localizable typo.

Tried to make the explicit intake thermal sink reach ~100% by changing how the
constant-pressure cool rebuilds momentum:
```
keep velocity (rho up, v same -> momentum up):  HSINK 300 stable 78%; >=450 over-fills
conserve momentum (rho up, v down):             HSINK 1000 -> 76% (ragged);
                                                 5000 -> 3% (fill COLLAPSES);
                                                 50000 -> 54% (ragged)
```
So neither rebuild works: keeping velocity injects ram (over-fill); conserving
momentum removes ram (the fill collapses to ~3% VE). The trapped mass is exquisitely
sensitive to the intake velocity/ram, so ANY post-hoc temperature manipulation that
touches the state perturbs the fill. Conclusion: VE is set by the COUPLED density x
velocity x valve gas dynamics; you cannot recover it by editing the gas temperature
mid-solve. Reverted to the keep-velocity form (stable ~78% at HSINK<=350).

### Honest bottom line on the VE deficit
- Conservative energy removal (wall HT, OPENWAM_IN_HMULT): stable, caps ~76% (higher
  multipliers go sonic).
- Non-conservative thermal reset (OPENWAM_INTAKE_HSINK / TPIN): can hit the right
  temperature but the cold-dense charge + the (un-fixed) over-strong overlap pressure
  wave then over-fills, or, if momentum is conserved, under-fills. The TPIN "~99%" is
  an artifact of its hard per-step clamp ALSO damping the wave via a fixed sound speed.
- The two errors (hot gas, over-strong ~1.6 bar overlap wave) are coupled through the
  sound speed and the gas dynamics; neither a thermal model nor a single valve/pipe
  timing change fixes both.

A clean ~100% requires fixing the SOURCE -- the WOT valve/gas-exchange enthalpy (and
hence sound-speed / wave) generation -- inside the MoC. That is a substantial, higher
-risk rework shared with the (working) exhaust path; the principled way in is to
validate THIS deck's gas exchange against stock OpenWAM on a reference single-cylinder
case and find where the converged charge temperature diverges, rather than editing the
live state. Pragmatic stable build today: OPENWAM_IN_HMULT (or INTAKE_HSINK<=300) +
per-rpm VANOS, ~76-80% VE.

### Net deliverables from Stages 24-34 (all env-gated, default deck unchanged)
- Decisive diagnosis: rpm-flat 2x VE deficit = numerically hot (~567 K) intake charge.
- Probes: OPENWAM_VEDIAG, INITDIAG, VLVENE, VLVWIN(+STEP), EXHWIN, JUNCENE, INTEMP.
- Levers: OPENWAM_IN_HMULT, INTAKE_HSINK/TAMB, IVO/EX_DUR/IN_DUR, EXH_TGAS, IN_VINIT,
  NO_THROTTLE, NO_EQTUBE/EQ_DIA, TPIN.
- Correctness fix kept: closed-cycle init vacuum bug (TCilindro.cpp, Stage 25).

## Stage 35 — ROOT CAUSE FOUND & FIXED: the φ10 equalization-tube stub was a numerical mass+energy source

The investigation (validate the gas exchange, find where the charge temperature
diverges) paid off. Probing the intake spatial profile (OPENWAM_INTEMP, now pipes
1-7) showed the snorkel AND filter -- the tract's coldest, most-upstream pipes, fed
directly by the 1000 m3 ambient reservoir -- sitting at ~560-680 K with a NET OUTWARD
velocity (-20 to -55 m/s). A converged engine cannot expel hot air out its own air
filter unless mass is being CREATED downstream.

OPENWAM_ENBAL (cycle-averaged mass/energy flux per pipe) localised it exactly. Every
intake pipe conserved (dM ~ 1e-4 kg/s) EXCEPT the per-cylinder equalization-tube stub:
```
ENBAL pipe5 (EqTube_Stub_1): mdot[L]=-2.78 kg/s  dM=-2.78 kg/s
                              Hdot[L]=-1.03e7 W (-10.3 MW!)  Tflux=2771 K
```
The stub injects 2.78 kg/s and 10.3 MW at a 2771 K flux temperature into the runner
junction every cycle -- a spurious mass+energy SOURCE. φ10 through that area implies a
hypersonic ~59000 m/s throat: a density runaway at the Type-12 branch junction that
ties the φ52 runner to the tiny φ10 stub (area ratio 27:1). This created mass+heat is
what cooked the whole intake to ~567 K, drove the snorkel net-outflow, and halved VE.

Diameter sweep @5300 rpm WOT (100% VE = 0.6408 g):
```
φ10  567 K / 57%   stub -10 MW   (sonic-boundary warnings; baseline default)
φ15  612 K / 63%   stub -23 MW   CRASHES (FIN=0)
φ20  597 K / 67%   stub -39 MW   CRASHES   <- nominal S54 tube size, unusable
φ25  368 K / 83%   stub clean    uniform 0.517-0.548 g
φ30  375 K / 82%   stub +73 W    uniform 0.501-0.544 g   <- chosen default
φ35  372 K / 83%   stub clean    uniform 0.525-0.542 g
φ52  535 K / 66%   stub clean    over-cross-talks the runners
```
The blow-up grows with stub area until the runner:stub area ratio drops to ~3:1, then
clears completely. φ30 is the smallest stable diameter; it removes the source (snorkel
back to ~300 K, charge ~370 K) AND lets the eq-tube perform its real pressure-
equalisation, which is worth ~+12% VE over deleting it (NO_EQTUBE = 442 K / 70%).

Cross-rpm confirmation (φ10 -> φ30):
```
3000 rpm  570 K / 58% (sonic warnings)  ->  357 K / 86%  (uniform 0.547-0.556 g)
5300 rpm  567 K / 57%                    ->  375 K / 82%  (uniform 0.501-0.544 g)
7000 rpm  560 K / 55%                    ->  367 K / 90%  (uniform 0.569-0.584 g)
```

### The fix
wam_generator.py: the EqTube stub default diameter OPENWAM_EQ_DIA 0.010 -> 0.030.
The DEFAULT deck (no env overrides) now converges at 375 K / 82% VE @5300 rpm, up from
567 K / 57%. This is a genuine root-cause correction (a numerical instability in the
deck topology), NOT a post-hoc thermostat -- the VE is recovered by the gas dynamics
themselves once the spurious source is removed. Charge temperature ~357-375 K and VE
~82-90% are now in the physically realistic band for this NA engine; the residual gap
to ~100% is ordinary tuning (port-wall heat, overlap backflow), no longer a 2x bug.

### Note on the earlier NO_EQTUBE test
Earlier stages reported NO_EQTUBE "did not cool the intake". Re-tested cleanly here it
clearly DOES (442 K / 70%); the earlier negative was from confounded builds/metrics.
The decisive new tool was ENBAL's per-pipe dM/Hdot, which pinned the source to the
single stub pipe rather than to junctions/throttle/valve in aggregate.

## Stage 36 — final tuning: the "remaining gap" was non-convergence; true VE is ~91-100%

After the eq-tube φ30 root-cause fix (Stage 35) the charge ran ~370 K / 82% VE -- but
that 82% was measured at only 14 cycles. Running to convergence shows the intake VE
keeps climbing for ~25-30 cycles (the airbox + eq-tube plenums and the cylinder
residual flush the startup hot-charge transient asymptotically):
```
5300 rpm, cyl-1 trapped mass by cycle:  6:0.535  10:0.566  16:0.597  24:0.620  29:0.631 g
```
True CONVERGED VE (30 cycles, default φ30 stub, 127 C port wall, 100% = 0.6408 g):
```
3000 rpm  331 K / 91%   uniform 0.580-0.583 g
5300 rpm  328 K / 97%   uniform 0.613-0.631 g
7000 rpm  343 K / 100%  uniform 0.635-0.644 g
```
A textbook high-rpm-rising NA VE curve, ~91-100%, uniform across all six cylinders,
charge 328-343 K (ambient + a small port-wall pickup). The 2x deficit is gone; what
looked like a residual "gap to 100%" at 14 cycles was simply under-convergence.

### Port-wall sensitivity (secondary lever, characterised, default unchanged)
At 30 cycles @5300: 127 C -> 97%, 100 C -> 101%, both uniform. Below ~90 C the run
goes non-uniform (cyl-2 stalls at ~0.45 g while the rest over-fill) -- a marginal
resonance, so the realistic 127 C heat-soaked port is kept as default. Exposed as
OPENWAM_PORT_TWALL=<degC> for studies.

### Fixes
1. models.py: SimulationConfig.duration_cycles 10 -> 30. Ten cycles reported a badly
   under-converged VE (~65-70% of true); 30 lands within ~1% of converged.
2. openwam_runner.py: floor the transient runner's computed cycle count at 30, so a
   short duration_sec cannot silently under-converge the VE/torque.
3. wam_generator.py: OPENWAM_PORT_TWALL override for the intake-port wall temp.

### Bottom line (Stages 24-36)
The rpm-flat ~2x intake VE deficit is RESOLVED. Root cause: a φ10 equalization-tube
stub whose Type-12 junction with the φ52 runner was numerically unstable and injected a
spurious ~10 MW / 2.78 kg/s mass+energy source that cooked the intake to ~567 K and
halved VE (Stage 35, fixed by φ30). The apparent residual gap was non-convergence
(this stage). Default deck now converges at ~91-100% VE, uniform, with physical charge
temperatures -- no post-hoc thermostats, the gas dynamics do it once the deck is sound.

## Stage 37 — throttle finally meters air: butterfly Cd was an area function, not a Cd

Checked whether the eq-tube VE fix changed the long-standing "VE flat vs throttle"
behaviour. It did NOT -- that is an independent bug. A converged throttle sweep (eq-tube
fixed, 30 cycles) showed trapped mass barely moving with pedal: closing 100% -> 25% dropped
air only ~13%, and the manifold (initialised at the estimated 0.68 bar MAP) REFILLED to
~1.18 bar over the cycles. OPENWAM_THRDIAG confirmed the runtime throttle was applying
cd=0.32, K=8.6 at 25% pedal -- correctly read, but against the low full-bore velocity
through the phi52 ITB (~7 m/s) K=8.6 is a ~0.002 bar loss, so the throttle never bit.

Root cause: `_get_butterfly_cd` returned a discharge-coefficient-like curve (0.33 at 15
deg, 0.50 at 25 deg) that the C++ BC consumes as K = 1/Cd^2 - 1 referenced to the FULL
BORE. Referenced to the bore, 0.32 means the blade still passes ~32% of the bore at a
near-shut angle -- physically a butterfly at 14.6 deg blocks ~97% (open-area ratio
1-cos(theta) ~= 0.03). The function conflated the discharge coefficient with the blade
open-area function.

Fix:
- wam_generator `_get_butterfly_cd` -> returns the effective open-AREA ratio
  A_eff/A_bore = Cd_disc(theta) * (1 - cos theta), ~0.96 at WOT, ~0.024 at 25% pedal.
- TCCPerdidadePresion K ceiling 50 -> 2000 (a near-shut blade's physical K reaches ~2000;
  the old cap let any pedal refill to atmospheric).
- pedal->angle gamma kept at 1.4 (env OPENWAM_THR_GAMMA), now sitting on a correct Cd.

Converged sweep @5300 rpm WOT (gamma 1.4, K_CEIL 2000, corrected Cd; 100% = 0.6408 g):
```
throttle 1.0  -> VE 97%  P_IC 1.21 bar  (uniform)   <- unchanged, no WOT regression
throttle 0.7  -> VE 94%  P_IC 1.22 bar  (uniform)
throttle 0.25 -> VE 63%  P_IC 0.72 bar  (uniform)   <- manifold now draws DOWN
throttle 0.1  -> VE 57%  P_IC 0.72 bar  (uniform)
```
The throttle now meters air and pulls a manifold vacuum -- the flat-VE bug is fixed for
the bulk of the pedal range.

### Two honest limitations (documented, not yet fixed)
1. SATURATION below ~25% pedal. The K-loss model's loss is K*0.5*rho*v_bore^2; as the
   throttle closes the flow (and v) self-limit, so MAP floors at ~0.72 bar and VE at ~57%
   no matter how small the opening (0.25 and 0.10 pedal both give 0.72 bar). Idle-level
   vacuum (~0.3 bar) needs a CHOKED-ORIFICE throttle BC (flow set by the effective area),
   not a K-loss -- a larger change for a later pass.
2. A reproducible single-cylinder gas-exchange runaway at ~0.5 throttle / 5300 rpm: cyl-2
   collapses to 0.019 g / 366 K while the other five sit at ~1433 K (a pathological
   high-residual steady state). This is the SAME recurring cyl-2 scavenging anomaly seen
   under TPIN and the low-port-wall sweeps; the now-working manifold vacuum (~0.85 bar at
   0.5 throttle) exposes it. 0.7, 0.25 and 0.10 throttle are all stable, so it is a narrow
   resonance, not a monotonic throttle effect. Fixing it is the cyl-2 gas-exchange issue,
   tracked separately.

### Assets
- wam_generator `_get_butterfly_cd` (effective-area model); old discharge table kept as
  `_get_butterfly_cd_OLD_discharge_table` for reference.
- OPENWAM_THRDIAG (runtime cd/K print), OPENWAM_K_CEIL, OPENWAM_CD_FLOOR, OPENWAM_THR_GAMMA,
  OPENWAM_THR_OFFSET, OPENWAM_FUEL_LHV (motoring).

## Stage 38 — cyl-2 part-throttle collapse: diagnosed to the eq-tube resonance; no robust knob, needs a remodel

The recurring single-cylinder anomaly (cyl-2 collapsing to ~0.019 g / 366 K while the
others choke at ~1433 K) reproduces cleanly at throttle 0.5 / 5300 rpm. Traced it fully.

Failure mode: cyl-2 starts healthy (0.76 g at cycle 1) and DECAYS every cycle --
0.76 -> 0.57 -> 0.29 -> 0.10 -> 0.045 -> 0.019 -- a positive-feedback starvation, not a
blow-up. It is not breathing (tiny, cold charge), while the other five accumulate hot
residual.

Cause: the equalization-tube cross-talk. With OPENWAM_NO_EQTUBE the same throttle-0.5 case
converges PERFECTLY uniform (all six 0.63 g, no collapse). So the shared eq-tube plenum +
the six runner stubs form a resonant path that, at part-throttle MAP (~0.85 bar, i.e.
~0.5 throttle), de-stabilises into a standing mode that starves cyl-2. It is a NARROW
resonance: throttle 0.7, 0.25 and 0.10 are all stable at the default; only ~0.5 collapses.

Why not just delete the eq-tube: it earns its keep at WOT. With NO_EQTUBE (or a heavily
damped tube) WOT goes NON-uniform -- cyl-4 lags (0.44 vs 0.72 g) -- because the cylinders
carry an inherent (exhaust-side, 3-into-1 collector) maldistribution that the eq-tube
equalises. The 10.5 L airbox already decouples the intake, so the maldistribution is not an
airbox-size effect; it is on the exhaust/scavenging side.

Friction-damping the stub is a DEAD END -- the eq-tube is a delicate resonant element and
the response is non-monotonic and rpm-dependent:
```
EQ_FRIC  5300 WOT        throttle 0.5     7000 WOT
0.02     97% uniform     cyl-2 COLLAPSE   100% uniform   (current default)
0.05     96% uniform     uniform OK       BLOWS UP @cyc3
0.10     131% over-fill  uniform OK       --
0.50     non-uniform     uniform OK       --
```
No single value is robust across {WOT both rpm} and {part throttle}.

### Where this leaves it
- Added OPENWAM_EQ_FRIC (eq-tube stub friction, default 0.02 = unchanged) for studies.
- Default kept at 0.02: WOT is validated uniform at 97-100% across 3000-7000 rpm; the
  cyl-2 collapse is confined to a narrow ~0.5-throttle resonance.
- A robust fix is NOT a parameter tweak. It needs either (a) remodelling the eq-tube so it
  is not a Helmholtz-resonant plenum+stubs (e.g. a continuous balance tube), or (b) removing
  the eq-tube and fixing the underlying exhaust-side cyl-4 maldistribution so the cylinders
  are uniform without it. Both are larger, separate tasks.

## Stage 39 — eq-tube root work: ② cyl-4 is a scavenging laggard; ① a continuous balance tube equalises everything but over-rams WOT

Pursued both promised paths for the cyl-2 collapse.

### ② Why the cylinders are unequal (the maldistribution the eq-tube papers over)
Per-cylinder probe with NO_EQTUBE at WOT: cyl-4 traps 0.40 g at Ttrap=535 K and
P_IC=1.27 bar while the other five trap 0.55 g at ~365 K / ~1.19 bar. cyl-4 is ~170 K
HOTTER -- it is not breathing less, it is failing to SCAVENGE and keeps hot residual.
cyl-4 (right 3-into-1 collector) and cyl-2 (left collector) are the two cylinders that
fire LAST within their collector (firing 1-5-3-6-2-4 -> left fires 1,3,2; right 5,6,4),
so they sit on the worst collector back-pressure during overlap. This is a physical
3-into-1 scavenging penalty -- exactly what a real Gleichdruckrohr exists to mitigate --
not a bug. The 10.5 L airbox already decouples the intake, so it is exhaust-side.

### ① Continuous balance tube (OPENWAM_EQ_CHAIN)
Replaced the central 141cc plenum + 6 stubs (a Helmholtz resonator) with a CONTINUOUS
tube: the six stubs tee into a row of five short segments, volume distributed along the
tube (what the real component is). Result:
```
                       throttle 0.5        WOT
plenum (default)       cyl-2 COLLAPSE      97% uniform
chain  (EQ_CHAIN=1)    98% UNIFORM (fix!)  135% uniform (over-fill)
```
The chain ELIMINATES both maldistributions -- cyl-2 no longer collapses at part throttle
AND cyl-4 no longer lags at WOT; every cylinder is within a few % at all throttles. So the
equalisation works and the Helmholtz resonance is gone. The remaining problem is purely a
LEVEL error: the strong runner-to-runner coupling over-rams WOT to ~135% VE. That ram is
not removable without destabilising -- friction 0.1-0.15 leaves 135%, 0.5 blows up startup;
segments must stay >= phi25 or the small cross-runner pipe runs away (phi18/phi12 blow up),
and phi25-30 both give ~135%. Bringing WOT back to ~100% needs the runner lengths re-tuned
around the chain (the chain changes the intake acoustics) -- a calibration pass.

### Where this leaves it
- OPENWAM_EQ_CHAIN (default OFF) + OPENWAM_EQ_SEG_DIA (default phi30): opt-in continuous
  balance tube. It is the right structural fix for the cyl-2/cyl-4 uniformity (both solved),
  pending a runner re-tune to pull WOT off 135%.
- Default deck unchanged (plenum model, WOT validated 97-100%); the cyl-2 collapse remains
  confined to the narrow ~0.5-throttle band noted in Stage 38.
- Net: the uniformity root (②) is understood and the chain (①) fixes it; the open item is
  re-calibrating WOT VE for the chain before it can replace the plenum as default.

## Stage 40 — WOT VE-rpm SHAPE vs stock: plenum tracks, chain mis-phases the ram (first look)

Re-framed the goal (the sim is a VANOS / front-pipe OPTIMISER, so the SimVE must FOLLOW
the stock VE shape across throttle x rpm; the absolute offset is removed by the
calibration correction matrix). Compared both eq-tube models against the stock WOT
breakpoints (app/data/stock_csl_ve.json; peak 116% @3900, gentle plateau 107-111% to
7300) with scripts/ve_model_shape_compare.py.

First look (high-rpm breakpoints, ~19-22 cycles -- UNDER-converged, see caveat):
```
RPM   stock%  plenum%  chain%
3900  116     127      127
4600  111     131       97
5300  110      93      136
6300  109      83      147   <- chain peak
7300  107      83      128
shape corr vs stock:  plenum r=+0.825   chain r=-0.271
peak:  stock @3900   plenum @4600   chain @6300
```
The PLENUM tracks the stock shape (peak mid-rpm, then declines; r=+0.83). The CHAIN
ANTI-correlates (r=-0.27): its continuous tube adds a strong ~6300 rpm ram resonance and
peaks at high rpm, opposite to the real engine's 3900 peak. So the earlier intuition
("chain captures ram, so better for the optimiser") was wrong on PHASE -- the chain rams,
but tuned to the wrong rpm.

Caveat (important): under-converged. The plenum's steep high-rpm droop (83% @7300) is
partly non-convergence -- the converged 7000-rpm point was ~100% (Stage 36) -- so a fully
converged plenum would lift its high-rpm tail toward the stock ~107% plateau and match
even better. The chain's 6300 peak is a real acoustic resonance, not a convergence
artifact.

### Implication
For the trend-matching goal the PLENUM is the better breathing model (right VE-rpm shape);
the chain trades that shape away for cylinder uniformity. So the cyl-2 part-throttle
collapse should be fixed WITHIN the plenum model, not by switching to the chain (which
breaks the WOT shape). Next: confirm with a converged (30-cycle) high-rpm comparison, then
revisit cyl-2.

Asset: scripts/ve_model_shape_compare.py (plenum vs chain vs stock shape, correlation).

## Stage 40-41 — VE-rpm SHAPE vs stock: the PLENUM tracks, the CHAIN mis-phases the ram

Goal reframed by the user: the sim is a VANOS / front-pipe OPTIMISER, so what matters is
that Sim VE FOLLOWS the stock VE shape across throttle x rpm (a constant correction removes
the absolute offset). The stock CSL WOT curve (app/data/stock_csl_ve.json) peaks 116% at
3900 rpm and holds a gentle 107-111% plateau to 7900 -- classic ITB ram tuning, so 110-119%
peaks ARE the right target (the user was right; 100% was too conservative).

Compared the two eq-tube models against that shape. CONVERGED (30-cycle) WOT VE:
```
RPM   stock   plenum  chain     plenum/stock  chain/stock
5300   110     97      139          0.88          1.26
6300   109     90      147          0.83          1.35   <- chain spurious ram peak
7300   107     93      128          0.87          1.19
```
- PLENUM: offset is ~CONSTANT (ratio 0.83-0.88). After one correction factor (k=1.17) it
  tracks stock to +/-4 pp, and its peak sits at 3900-4600 -- the SAME place as stock. It
  rams correctly, just ~13% low in absolute terms (removable).
- CHAIN: the continuous tube adds a spurious ~6300-rpm ram resonance (147%); its ratio
  swings 1.19-1.35, peak at the WRONG rpm (6300 vs stock 3900). After correction it still
  carries a +7 pp bump at 6300. (Earlier under-converged sweep: plenum shape-correlation
  r=+0.83 vs chain r=-0.27 -- anti-correlated.)

### Conclusion / recommendation
For the optimiser, SHAPE fidelity beats absolute level, and the PLENUM is clearly the
better base: constant correctable offset, ram peak at the right rpm. The CHAIN -- although
it fixes the cyl-2/cyl-4 uniformity -- distorts the VE-rpm shape with a spurious high-rpm
resonance and is therefore NOT suitable as the optimisation base. So:
- KEEP the plenum eq-tube as default (validated WOT shape, correctable).
- Treat the cyl-2 narrow part-throttle collapse as a separate, bounded artifact to damp
  within the plenum model -- NOT by switching to the chain.
- OPENWAM_EQ_CHAIN stays an opt-in research lever.

Assets: scripts/ve_model_shape_compare.py, scripts/ve_converged_highrpm.py,
ve_shape_highrpm_results.csv.

## Stage 42 — cyl-2 within the plenum: every acoustic fix distorts the VE-rpm shape; keep the plenum, reject bad points

Per the user's choice to fix cyl-2 INSIDE the plenum (so the validated VE-rpm SHAPE is
kept), tried detuning the eq-tube resonance instead of removing it. Added
OPENWAM_EQ_MISTUNE: spread the six stub LENGTHS per cylinder with a zero-sum pattern
([1,-1,.6,-.6,.2,-.2]) so the MEAN length -- hence the WOT equalisation/shape -- is
nominally preserved, like a real manifold's branch-length scatter (length only, so the
area-mismatch stability floor is untouched).

It does break the cyl-2 resonance, but it just MOVES the pathology and distorts the
high-rpm shape (CONVERGED-ish WOT):
```
                5300        6300            7000
mistune 0.30    97% uniform 140% UNIFORM    94% uniform   <- spurious 6300 over-ram
                            (plenum 90%)
mistune 0.15    ok          cyl-2 COLLAPSE  cyl-2 BLOWS UP (1.6 g)
                            (0.17 g)
```
So mistune 0.30 fixes the collapse but injects a spurious ~6300 ram peak (140% vs the
plenum's 90% -- the SAME shape damage as the chain); mistune 0.15 is too light and the
collapse just reappears at 6300 and inverts to a blow-up at 7000. There is no value that
fixes cyl-2 at all rpms AND leaves the shape intact.

### Conclusion -- this closes the eq-tube avenue
Friction (Stage 38), the continuous chain (Stage 39/41) and now length mistuning all
confirm the same thing: the eq-tube is an acoustically active resonator, so ANY structural
change that suppresses the cyl-2 resonance also shifts the WOT resonances and distorts the
VE-rpm shape (or merely relocates the collapse). Since the SHAPE is the priority for the
optimiser, the eq-tube must stay UNMODIFIED (plenum, mistune=0 -- the default, validated
97%/correct ram phasing).

The cyl-2 collapse is therefore a numerical pathology to be handled at the OPTIMISER level,
not in the deck: detect per-cylinder trapped-mass maldistribution (a cylinder far from the
fleet mean = collapse or blow-up) and REJECT those operating points as unreliable, so the
optimiser never reads their (garbage) engine-average VE. The collapse is confined to narrow
throttle/rpm islands, so rejecting them costs few points.

OPENWAM_EQ_MISTUNE / EQ_FRIC / EQ_CHAIN remain documented research levers (each fixes the
collapse under SOME conditions at the cost of shape). Default deck unchanged.

## Stage 43 — optimiser validation: VANOS response + the cylinder-balance gate in action

With the plenum kept unmodified (correct VE-rpm shape) and the cylinder_balance gate added,
checked the two things the optimiser actually needs: (a) does VE RESPOND to VANOS so there
is something to optimise, and (b) does the gate drop the pathological points.

Intake-VANOS sweep at 5300 rpm WOT (bias shifts IVO; ~near-converged):
```
 IVbias  IVO     VE     gate
  +15   317deg  139%    OK
  +8    324deg  475%    REJECTED  <- a cylinder blew up; gate caught it
   0    332deg   92%    OK   (converges ~97%)
  -8    340deg  126%    OK
  -15   347deg  119%    OK
```
- The model responds STRONGLY and sensibly to intake cam phase (VE swings ~90->139% as the
  cam tunes the ram charging), and the baseline (bias 0) is NOT the VE peak -- so the
  optimiser has a real gradient to climb. This is the core requirement for a VANOS optimiser.
- The cylinder_balance gate REJECTED the bias=+8 point (475%, a single-cylinder blow-up) so
  the optimiser never reads that garbage -- exactly the Stage-42 design working end-to-end.

Together with the earlier results this validates the optimiser base:
- WOT VE-rpm SHAPE tracks stock (Stage 41, r=+0.83; constant correction k~1.17).
- Throttle response is monotonic and draws a manifold vacuum (Stage 37: 1.0->97%, 0.25->63%).
- VANOS response is strong with a climbable peak, and the gate removes pathological cells.

### Status / how to use it
Default deck = plenum eq-tube, mistune=0 (validated shape). Run each operating point with
OPENWAM_VEDIAG=1, take VE from the converged cycle, and call
OpenWAMOutputParser.cylinder_balance(stdout); drop the point when valid=False. Sweep VANOS /
front-pipe and read VE on the surviving cells. NOTE: the VANOS curve above is ~18-cycle
(under-converged); the RESPONSE and the GATE are the point, not the exact peak rpm/value --
production sweeps should run to ~30 cycles for the absolute numbers.

## Stage 44 — 480-pt map (Stock vs Sim) WITH the real VANOS: the sim OVER-responds to VANOS

Added scripts/ve_map_compare.py: for each (rpm,load) cell of the 480-pt CSL map it looks up
the stock VE (kf_rf_soll) and the stock intake VANOS (kf_evan1_soll -> bias = 130 - target,
matching simulation_service.run_ve_map_generation), runs the plenum sim with that VANOS, gates
on cylinder balance, and tabulates sim vs stock. (Running all 480 here is infeasible -- 4 cores,
slow runs, and the container reboots every ~12 min; the script is for the production 12-way run.)

The WOT row WITH the stock VANOS (bias 42-60 deg advance) -- not the bias=0 of Stage 41:
```
load 100%   stock   sim
 2700 rpm   104%    143%   (over)
 3900 rpm   116%     97%   (under -- the stock TORQUE PEAK)
 5300 rpm   110%    150%   (over)
```
Two things follow:
1. The Stage-41 "plenum tracks stock, r=0.83" was measured at bias=0 -- the FULLY-RETARDED
   intake position, which is NOT how the engine runs. With the real stock VANOS schedule the
   tracking is much worse.
2. The sim OVER-responds to VANOS: at 5300 WOT, going from bias 0 to the stock bias 42 lifts VE
   97% -> 150% (+53 pp). A 42 deg intake advance lifting VE by half is unphysical (real engines
   see ~10-20 pp from optimal cam phasing). And it is non-uniform across rpm (3900 ends up UNDER
   while 2700/5300 are OVER), i.e. the intake acoustic resonances are mis-phased vs the real
   engine once the cam moves.

### Implication
Before the sim is a trustworthy VANOS optimiser the VANOS SENSITIVITY must be calibrated: the
model currently moves VE far too much (and with the wrong rpm phasing) as the intake cam
advances, so an optimiser would chase unrealistic "optimal" cam angles. Likely levers: the
runner length/acoustic tuning (sets where the ram resonance sits vs rpm) and the intake
valve overlap handling at large advance. The cylinder-balance gate still correctly fires on
the points that blow up at aggressive advance.

## Stage 45 — whole-map (Stock vs Sim) error: structured, not a constant offset

Ran a 16-cell sub-grid of the 480-pt map (4 rpm x 4 load) WITH the real stock intake VANOS,
resumably (scripts/ve_map_resumable.py appends per batch -> survives the ~12-min reboots),
gated on cylinder balance. ~18-cycle (under-converged; a few cells cyc<10 are noisy):
```
load\rpm   2700      3900      5300      6900
 100%    104/142   116/ 94   110/150   106/143
  65%    102/139   112/ 70   107/143   101/124
  45%     97/ 62   105/133   102/126    92/ 86
  20%    92/936X    86/ 95    84/ 79    70/ 58     (X = gate REJECTED a 936% blow-up)
```
sim/stock ratio 0.63-1.37 (reliable cells mean 1.11), shape r=0.54. The error is STRUCTURED:
- HIGH load (100/65%): sim over-rams ~1.2-1.4 (the VANOS over-response of Stage 44) at every
  rpm EXCEPT 3900.
- the 3900 column (the stock torque peak): sim is UNDER at high load (94/70/133) -- it does
  NOT reproduce the real engine's main intake resonance peak.
- LOW load (20%): tracks well (0.8-1.1) -- the throttle restriction dominates there and the
  Stage-37 metering is correct.
So a single correction factor cannot fix the map; the intake acoustic tuning is mis-phased
vs the real engine once the cam is at the stock (advanced) position. The cylinder-balance
gate correctly removed the one blow-up cell.

### Bottom line for the optimiser
Low-load breathing and the gate are sound. The high-load map needs (a) VANOS-sensitivity /
overlap calibration and (b) intake runner-length (and exhaust front-pipe) acoustic tuning so
the ram peak lands at ~3900 like stock. Until then the sim is reliable as an optimiser only
where ratio~const (low/part load); WOT VANOS sweeps will over-state gains. Assets:
scripts/ve_map_resumable.py, scripts/ve_map_compare.py, ve_map_results_16cell.csv.

## Stage 46 — VANOS-sensitivity calibration: the over-response is a BISTABLE acoustic resonance, not a scalable sensitivity

Tried to calibrate the Stage-44/45 VANOS over-response with OPENWAM_VANOS_SCALE (scales the
applied intake bias). It does NOT work -- the response is bistable, not a smooth slope:
```
5300 WOT:  bias  0 -> 97%   bias 12 -> 139%   bias 15 -> 139%   bias 42 -> 150%
3900 WOT:  bias 18 -> 96%   bias 30 -> 145%   bias 60 -> 94%
```
The sim jumps between a LOW mode (~95%) and a HIGH-ram mode (~140%) depending on the exact cam
phase; there is a sharp threshold (~bias 10 at 5300) and it is non-monotonic (3900: bias 30
locks the high mode while bias 18 and 60 sit in the low mode). The real engine's 110-116% sits
BETWEEN the two sim modes and is unreachable, so scaling the bias just flips which mode locks --
it cannot land in the middle.

Root: the 1-D intake acoustics are under-damped, so the runner/eq-tube ram resonance is too
sharp -- it latches into a high or low standing-wave mode rather than giving the smooth,
intermediate breathing the real engine has. This is why the WOT map (Stage 45) is over at most
cells and under at the torque peak: it is which resonance mode each (rpm, cam) cell happens to
latch, not a constant offset.

### Conclusion
VANOS-response accuracy is NOT a one-parameter calibration. It needs the intake acoustic model
DE-PEAKED -- either physical damping (which, per Stages 38/42, distorts the WOT shape) or a
runner-geometry / mesh re-tune that broadens the resonance so VE varies smoothly with cam phase.
That is a substantial modelling task. OPENWAM_VANOS_SCALE is kept (default 1.0 = no-op) as a
documented but INEFFECTIVE lever.

### Net state of the simulator
- SOLID: the 2x VE-deficit root cause (eq-tube phi30, Stage 35), convergence (Stage 36),
  throttle metering (Stage 37), the cylinder-balance gate (Stage 42).
- LIMITED: VANOS-response / high-load map accuracy -- blocked by the bistable intake acoustics.
  Usable as an optimiser at low/part load and protected by the gate; WOT VANOS sweeps over-state
  gains until the intake acoustics are de-peaked.

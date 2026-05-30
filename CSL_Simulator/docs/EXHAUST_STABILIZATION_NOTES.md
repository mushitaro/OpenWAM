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

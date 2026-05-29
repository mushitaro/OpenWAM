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

## Next step (Stage 3): fix the seed, not the amplifier
The remaining work is at the **cylinder→exhaust-valve boundary** (Type-8
connection / `TCCCilindro` + the valve-side node of the `Port_Ex` pipe):
1. Instrument `INFO: Calculated pressure/temperature at E.O.` — find why E.O.
   yields 0.1 bar / −82 °C (likely an over-expansion in the cylinder blowdown
   model or a bad initial port state).
2. Check the exhaust-valve `Cd`/effective-area at very low lift just off the
   seat during blowdown (a near-zero area with a large Δp can over-draw the
   port node to negative density).
3. Consider a small positivity/relaxation guard at the valve-side port node,
   mirroring the existing `Transforma2Area` floors.

## Runtime caveat for the 480-point VE sweep
The extra small plenums shrink the 0D stability timestep, so the run is slow
(reached only ~3–6 % within the test budget). Before the sweep:
- decide the minimum `duration_cycles` that reaches quasi-steady;
- confirm OpenMP threads are engaged for the 1-D solver;
- keep `port_junction_vol = 20`.
The wall-clock-per-point still needs measuring on an uncontended core (the scan
above ran several sims concurrently, so its timings are not trustworthy — only
the NaN/health counts are).

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

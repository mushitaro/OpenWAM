# CSL_Simulator — Surrogate (fast emulator) Design

> Goal: make VANOS / geometry tuning near-INSTANT by replacing the slow OpenWAM solver in the
> optimizer's inner loop with a fast learned model, and make its predictions match REALITY (not just
> the sim) by folding in users' measured VE. Authored in the Stage-56 session (which made the sim
> stable/deterministic — a prerequisite for a learnable surrogate). Read alongside `UX_APP_DEV_SPEC.md`
> and the Stage-56 `EXHAUST_STABILIZATION_NOTES.md` / `HANDOFF_NEXT_SESSION.md`.

---

## 0. The key reframe: TWO models, not one

| layer | learns | trained on | makes... |
|---|---|---|---|
| **(A) Sim-emulator** | `inputs → SIM VE/health` (mimics OpenWAM) | sim runs (bootstrap + every app Run/Tune) | tuning FAST |
| **(B) Sim→Real correction** | `(SIM VE) → MEASURED VE` residual | users' measured VE (wideband WOT / narrowband-log part-load) | predictions REAL |

(A) makes the optimizer fast; (B) debiases the sim toward each engine's measured truth. This is the
"digital twin" pattern: the simulator supplies physically-consistent structure, real data corrects the
residual. The user's instinct — collect physical-model values AND sim results, across many users — is
exactly the data that feeds BOTH layers. (Originally I only described (A) from sim-only bootstrap data;
(B) + the user/calibration/optimization sources below are the richer, correct picture.)

---

## 1. What the surrogate predicts (I/O)

**Input `x`** (one vector per operating point):
- **Geometry** (~20-30 dims, = the measured `SimConfig` the user tunes): runner upper/lower length &
  diameter, plenum volume, bellmouth/trumpet length & diameter, snorkel L/D, intake & exhaust port
  L/D, exhaust primary/header/mid lengths & diameters, valve max-lift & duration & diameter, bore/
  stroke/rod/CR.
- **Operating point**: rpm, load (tps).
- **VANOS**: intake & exhaust cam angle (or, equivalently, the overlap). NOTE: optimize on the PHYSICAL
  cam angle / overlap, NOT the `EXVANOS_BASE` fudge (see UX spec §4.C) so recommendations are real.
- **Calibration constants**: the damping `alpha`/`w` (so the model is conditioned on the physics regime).

**Output `y`**:
- `VE` (primary, regression).
- `health` (classification: converged? cylinder-collapsed? blew-up?) — so the surrogate also predicts
  WHERE the sim is unreliable.
- (optional) torque, converged-cycle-count.
- (advanced, separate model) the **pressure/flow waveform** vs crank angle — a functional output; defer
  to a later phase (1D-CNN / Fourier-feature net).

For a SINGLE engine (fixed geometry) the surrogate over (rpm, load, VANOS) is low-dim and easy. For
MULTI-USER it must take geometry as input too → higher-dim but generalizes across builds (the
network-effect the user wants). Build the geometry-conditioned model from the start.

---

## 2. Data sources (this is the user's main question)

| source | when collected | yields | quality | feeds |
|---|---|---|---|---|
| **Sim bootstrap** | offline (cloud fan-out) | `(x, sim_VE, health)` over a designed sample | uniform coverage | (A) cold-start |
| **User Run / calibration** | every app "Run" | `(x, sim_VE)` + the user's `measured_VE` for that cell | measured = wideband (WOT) / narrowband-log (part-load) | (A) + (B) |
| **User optimization** | every "Tuning" run | `(x, sim_VE)` clustered near high-VE/optimal regions | dense where it matters | (A) refinement |
| **User dyno / log upload** | user-supplied | `measured_VE` (± torque) | varies — weight by provenance | (B) reality anchor |

Two important points:
- **Calibration runs are double-valuable**: they give a sim result AND a measured-VE label for the same
  `x`. Harvest both.
- **Provenance weighting** (the Stage-56 rule): label every measured point with its sensor source and
  weight it — wideband WOT = high confidence (shape AND level), narrowband-log part-load = shape-only.
  Layer (B) must respect this (don't fit absolute part-load level hard).

**Bootstrap sampling**: cover the input space with a space-filling design — **Sobol / Latin Hypercube**
over the plausible geometry × VANOS ranges (constrained to the monostable / mechanically-valid region),
at the standard rpm/load breakpoints. Start a few thousand points; grow by active learning (§5).

---

## 3. Data format, schema, and storage

**One record (JSON/Parquet row):**
```jsonc
{
  "schema_version": 1,
  "sim_binary_sig": "<size:mtime or hash>",   // CRITICAL: which solver produced this
  "sim_code_commit": "<git sha>",
  "calib": { "alpha": 0.4, "w": 0.005, "thr_choke": 1 },
  "geometry": { "runner_upper_len_mm": 15, "runner_lower_len_mm": 25, "runner_dia_mm": 52,
                "plenum_vol_l": 10.5, "bellmouth_len_mm": 150, "port_len_mm": 105,
                "intake_dur_deg": 260, "exhaust_dur_deg": 260, /* ...full SimConfig geometry... */ },
  "op": { "rpm": 3900, "load_tps": 100 },
  "vanos": { "intake_cam_deg": 60, "exhaust_cam_deg": 63, "overlap_deg": -1 },
  "sim": { "ve": 78.9, "ve_healthy": 79.0, "cyl_collapsed_n": 0, "converged": true,
           "slope": 0.08, "cyc": 33, "blew_up": false },
  "measured": { "ve": 116.0, "source": "wideband", "confidence": 1.0 },   // or null
  "meta": { "user_hash": "...", "engine_hash": "...", "ts": "...", "app_version": "...", "run_id": "..." }
}
```

**Storage (data lake):**
- **Hot / training table**: **Parquet** (columnar) in object storage (S3/GCS/Azure Blob), **partitioned
  by `sim_binary_sig`** (so a solver rebuild's data is cleanly separable) and by `schema_version`.
  Query with DuckDB / a warehouse (BigQuery/Snowflake) — no DB server needed at small scale.
- **Cold / raw**: the full `run.log` + the `m.wam` deck per `run_id` in the object store (for
  re-featurization and the waveform model). Keyed by `run_id`.
- **Index / provenance**: a small **Postgres** (or SQLite at first) table of run metadata for lookup,
  consent flags, and dedup.
- **Model registry**: trained artifacts + the exact training-data snapshot id + eval metrics (MLflow or
  a simple versioned bucket). Each model records which `sim_binary_sig`(s) it is valid for.

**The local deck-cache built this session** (`.sim_cache`, keyed by deck+binary-sig+env) is the
embryonic version of this lake — it already stores deterministic sim results keyed by content. The
production lake generalizes it: same keying, durable storage, + the measured-VE labels + user metadata.

---

## 4. Versioning discipline (the #1 way this goes wrong)

The sim-emulator (A) is only valid for a fixed (solver binary + calibration constants + deck schema). If
the simulator physics changes (new damping, new geometry model, a bug fix), **old sim rows are a
DIFFERENT function** and will poison the model. Rules:
- Tag every row with `sim_binary_sig` + `sim_code_commit` + `calib`. Partition by it.
- When the solver changes: either retrain (A) on data from the new version, or treat the old data as a
  separate fidelity (multi-fidelity modelling). Never silently mix.
- Layer (B) (sim→real) is more stable (anchored to physical reality) but still records which sim it
  corrects.
- The model registry refuses to serve a surrogate against a solver `sig` it wasn't trained for (fail
  loud, fall back to the real sim).

---

## 5. Model architecture & the dev workflow

**Model path (start simple, scale with data):**
1. **v0 — LightGBM** regressor (VE) + classifier (health). CPU-only, robust on tabular, fast to train,
   validates the whole pipeline. Use quantile/NGBoost for a cheap uncertainty estimate.
2. **v1 — MLP (PyTorch)** multi-output (VE + health + torque). Scales to crowd data & ~30 dims;
   **GPU-accelerated** — this is where the **Intel Arc 140T** earns its keep (PyTorch XPU / IPEX or
   OpenVINO inference). Uncertainty via MC-dropout or a deep ensemble.
3. **GP (Gaussian Process)** per-engine / small-data, for **active-learning uncertainty** when choosing
   new sim points (sample-efficient, well-calibrated uncertainty; doesn't scale past ~10k pts).
4. **Layer (B)** — a residual model `measured_VE − sim_VE ≈ f(geometry, op)` (small NN/GP), OR
   fine-tune the MLP's last layers on measured data (transfer learning). Provenance-weighted loss.

**The development / continuous workflow:**
1. **Instrument first** (do this NOW, before any model): log every app Run/Tune `(x, sim result)` —
   and the user's measured VE when given — to the lake. Data accrues from day one. (Cheap, highest
   leverage; the deck-cache already proves the keying.)
2. **Bootstrap**: cloud fan-out a Sobol/LHS sim dataset over the input space (the speed levers +
   horizontal scaling make this cheap — see the cost note in chat).
3. **Train (A)** on bootstrap + accumulated app data (filtered to the current `sim_binary_sig`).
   Validate on a held-out set + on a few fresh real-sim points.
4. **Deploy (A)**: the VANOS optimizer searches on the surrogate (millions of evals/sec) instead of the
   solver. **SAFETY PATTERN (non-negotiable): surrogate PROPOSES, simulator DISPOSES** — the top-K
   candidate optima are VERIFIED with REAL deterministic OpenWAM runs (omp1) before being shown/exported.
   A surrogate error therefore can't ship a bad tune, and each verification becomes new training data.
5. **Active learning**: use the surrogate's uncertainty (or expected-improvement) to pick where to run
   more REAL sims (cloud) — focus expensive runs where the surrogate is weak / near likely optima.
   Add → retrain. This is far cheaper than uniform sampling.
6. **Train (B)** from users' measured VE (consented) to debias toward reality; provenance-weighted.
7. **Retrain cadence**: triggered by (a) enough new rows, (b) a solver version change (mandatory), (c)
   drift detected (surrogate-vs-verified error rising). Promote via the registry with eval gates.

---

## 6. Multi-user / crowd-sourcing specifics

- **Global model**: train (A) on POOLED, consented, anonymized, geometry-conditioned data across all
  users/builds → generalizes; more users ⇒ better (network effect). This is the value of the cloud
  multi-user collection the user envisions.
- **Personalization**: per-engine fine-tuning + layer (B) on that user's measured VE personalize the
  global model to their exact build.
- **Cold start** (new user/geometry): the global surrogate gives a geometry-based prior immediately;
  refine with their first few real sim runs + measured VE.
- **Privacy / consent**: data sharing is OPT-IN. Anonymize (hash user/engine ids). Measured VE is the
  user's tuning IP — explicit consent, and offer a "private model" tier (their data not pooled). Store
  only what's needed.
- **Quality control**: weight by provenance; detect/clip outliers; reject rows whose `sim` blew up or
  failed the health gate.

---

## 7. Honest caveats

- **Garbage in**: (A) emulates the SIM. If the sim's geometry is wrong (currently by-feel), the
  emulator faithfully reproduces a wrong sim. Mitigations: get real geometry (in progress), and layer
  (B) + the real-sim verification anchor results to measured reality.
- **The sim must stay stable/deterministic** (Stage-56 damping + omp1) — a chaotic/non-deterministic
  teacher can't be learned. This is already true; don't regress it.
- **Versioning is a real MLOps burden** (§4) — budget for it.
- **Waveform surrogate is hard** (functional output) — keep it out of v0/v1; the scalar VE+health
  surrogate already unlocks instant tuning.

---

## 8. Phased build plan

- **Phase A — instrument** (smallest, highest leverage): log every Run/Tune `(x, sim, measured?)` to a
  lake (start with Parquet-on-object-store + the existing cache keying). Begin accumulating data.
- **Phase B — bootstrap + v0**: cloud LHS sim dataset → LightGBM (A) → wire the optimizer to search on
  it + verify optima with real sims. Measure the tuning speedup.
- **Phase C — scale**: MLP + GPU (Arc 140T) + active learning + layer (B) sim→real correction as
  data/users grow; multi-user pooling + personalization.
- **Phase D — advanced**: waveform surrogate; multi-fidelity (mix coarse/fine sims); per-tenant private
  models.

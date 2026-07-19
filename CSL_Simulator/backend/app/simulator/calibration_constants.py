"""Model-calibration constants loader (UX_APP_DEV_SPEC.md §4.C / §10; schema v2
per PLAN_PARTLOAD_CALIBRATION.md Phase 4.0).

The mouth radiation damping (alpha/w), the EXVANOS_BASE datum/surface, the
sigma(pedal) throttle table and the ICV effective area are MODEL-CALIBRATION
values, not final physics. They live in ``data/calibration.json`` (NOT hardcoded
in UI/sim logic) so the fit CLI (scripts/fit_partload.py) can update them -- or
fold them to a flat datum -- without code surgery. Every Run record logs the
active ``calib`` block for traceability.

Schema v2 adds (all ``null``/absent = LEGACY behaviour, so the schema can land
before any fit exists):
  mouth_rad.part_load_alpha   damping alpha for NON-WOT cells (Phase 4D A/B)
  thr_sigma                   {enabled, points [[pedal,sigma],...], fit_meta}
                              -> injected into WAMGenerator._sigma_bp
  icv                         {sigma, fit_meta} -> intake.eq_tube.icv_sigma
  exvanos_base.surface        {rpms, loads, values[load][rpm]} bilinear base
                              for part load; the load=100 row is ANCHORED to
                              the WOT fit and the is_wot short-circuit is
                              unchanged -> the WOT row cannot regress.

Runtime env vars still win for one-off studies:
  OPENWAM_MOUTH_RAD / OPENWAM_MOUTH_RAD_W / OPENWAM_MOUTH_RAD_OFF
  OPENWAM_THR_SIGMA_BP / OPENWAM_ICV_SIGMA
(Stage 69: OPENWAM_EXVANOS_BASE/_SCALE died with the scaffold.)

The cache is mtime-checked (risk R4): a fitter writing calibration.json is
picked up by the running server on the next load() without a restart.
"""
import json
import os
import threading

_CACHE = {}          # path -> (mtime, cal)
_LOCK = threading.Lock()


def _default():
    # schema v3 (Stage 69): GLOBAL solver constants + component flow
    # characterizations ONLY. No cam-phase keys — ever.
    return {
        "schema_version": 3,
        "mouth_rad": {"alpha": 0.4, "w": 0.005, "wot_tps_threshold": 85.0,
                      "part_load_alpha": None},
        "thr_choke": 1,
        "thr_sigma": {"enabled": False, "points": None, "fit_meta": None},
        "icv": {"sigma": None, "fit_meta": None},
        "global_solver": {},
    }


def load(data_dir):
    """Load (and mtime-cache) the calibration constants for ``data_dir``.

    Env CSL_CALIBRATION_PATH overrides the file location. Falls back to the
    in-code default if the file is missing/unreadable. The mtime check means a
    fit written by scripts/fit_partload.py is visible to a running server on
    the next request (risk R4: the old cache was never invalidated).
    """
    path = os.environ.get("CSL_CALIBRATION_PATH") or os.path.join(data_dir, "calibration.json")
    try:
        mtime = os.stat(path).st_mtime_ns
    except OSError:
        mtime = None
    with _LOCK:
        hit = _CACHE.get(path)
        if hit is not None and hit[0] == mtime:
            return hit[1]
        try:
            # encoding pinned: on Windows the default is cp932/cp1252, and a
            # single non-ASCII byte in the file made this silently fall back
            # to _default() — every knob (thr_sigma, icv, alpha...) reverted
            # to in-code defaults while all gates stayed green (2026-07-19).
            with open(path, "r", encoding="utf-8") as f:
                cal = json.load(f)
        except FileNotFoundError:
            cal = _default()
        except Exception as e:
            # a PRESENT-but-unreadable calibration is a data error, not a
            # "run with defaults" request — fail loudly, never silently.
            raise RuntimeError(
                f"calibration.json exists but failed to load ({e}); refusing "
                f"to silently run with default calibration") from e
        # Stage 69: v2 files carried the deleted cam-phase scaffold — warn
        # loudly and IGNORE those keys (the accessors no longer exist).
        if cal.get("schema_version", 0) < 3 and (
                "exvanos_base" in cal or "intake_vanos_base" in cal):
            print("WARNING: calibration.json is schema v2 (EXVANOS scaffold) — "
                  "scaffold keys are DELETED/IGNORED (Stage 69). Migrate to v3.")
        _CACHE[path] = (mtime, cal)
    return cal


def reload(data_dir=None):
    """Drop the cache (tests / explicit refresh)."""
    with _LOCK:
        _CACHE.clear()


def mouth_rad(cal):
    """Return (alpha, w, wot_tps_threshold) for the WOT radiation damping."""
    mr = cal.get("mouth_rad", {}) if cal else {}
    return (float(mr.get("alpha", 0.4)),
            float(mr.get("w", 0.005)),
            float(mr.get("wot_tps_threshold", 85.0)))


def part_load_alpha(cal, load=None):
    """Damping alpha for NON-WOT cells; None = legacy (no part-load damping).

    Optional LOAD SCHEDULE (Stage 60): if mouth_rad.part_load_alpha_load_min is
    set, the damping applies ONLY at load(%TPS) >= that threshold. alpha-0.4
    monostabilizes the mid/high-load attractor-gap cells (6900/65 0.265->0.024,
    3900/65 0.137->0.041, all load-45) but OVER-damps the low-load ram
    (regressing load 20/30 broadly), so it is scheduled to load>=45 only. The
    load breakpoints 30 and 45 are adjacent with no cell between them, so the
    threshold falls in a clean gap. load=None (caller unaware) returns the
    UNSCHEDULED value for backward compatibility.
    """
    mr = ((cal or {}).get("mouth_rad", {}) or {})
    v = mr.get("part_load_alpha")
    if v is None:
        return None
    lmin = mr.get("part_load_alpha_load_min")
    if lmin is not None and load is not None and float(load) < float(lmin):
        return None
    return float(v)


def thr_sigma_points(cal):
    """Calibrated sigma(pedal) breakpoints [[pedal, sigma], ...] or None.

    Only returned when thr_sigma.enabled is true AND every sigma is non-null
    (the schema ships with null placeholders before the Phase-4B fit).
    """
    ts = (cal or {}).get("thr_sigma") or {}
    if not ts.get("enabled"):
        return None
    pts = ts.get("points") or []
    clean = [[float(p), float(s)] for p, s in pts if s is not None]
    return clean if len(clean) >= 2 else None


def icv_sigma(cal):
    """Fitted ICV effective open-area ratio, or None (-> SimConfig default)."""
    v = ((cal or {}).get("icv") or {}).get("sigma")
    return None if v is None else float(v)


# ---------------------------------------------------------------------------
# Stage 69: the EXVANOS base scaffold (intake_vanos_base / exvanos_scale /
# exvanos_base_for / _interp1) is DELETED. Cam phase is a TUNING variable
# (duration/profile will be too) and must never absorb model error; valve
# timing is now a PURE fixed conversion from the ECU spread maps inside
# WAMGenerator (engine.intake_cam_spread / exhaust_cam_spread). Calibration
# holds ONLY global solver-characteristic constants (owner directive
# 2026-07-11; the deleted scaffold had also sign-inverted the exhaust cam
# response since Stage 47 — see EXHAUST_STABILIZATION_NOTES Stage 69).
# ---------------------------------------------------------------------------


def global_solver(cal, key, default):
    """Fitted GLOBAL solver-characteristic constant (schema v3 block
    ``global_solver``): e.g. mesh_scale, in_fric_mult, in_hmult, cam_exp.
    These are the ONLY legitimate fitted VE-matching knobs besides mouth_rad."""
    v = ((cal or {}).get("global_solver") or {}).get(key)
    return default if v is None else float(v)

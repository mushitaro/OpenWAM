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
  OPENWAM_EXVANOS_BASE (scalar override) / OPENWAM_EXVANOS_SCALE
  OPENWAM_THR_SIGMA_BP / OPENWAM_ICV_SIGMA

The cache is mtime-checked (risk R4): a fitter writing calibration.json is
picked up by the running server on the next load() without a restart.
"""
import json
import os
import threading

_CACHE = {}          # path -> (mtime, cal)
_LOCK = threading.Lock()


def _default():
    return {
        "schema_version": 2,
        "mouth_rad": {"alpha": 0.4, "w": 0.005, "wot_tps_threshold": 85.0,
                      "part_load_alpha": None},
        "thr_choke": 1,
        "intake_vanos_base": 130.0,
        "thr_sigma": {"enabled": False, "points": None, "fit_meta": None},
        "icv": {"sigma": None, "fit_meta": None},
        "exvanos_base": {
            "fit_cam_deg": 268,
            "stale": True,
            "use_stale_shape_fit": False,
            "wot_base_stable": 150.0,
            "part_load_const": 150.0,
            "scale": 1.0,
            "points": [[2700, 150.0], [3900, 115.0], [4600, 155.0],
                       [5300, 160.0], [6300, 160.0], [6900, 160.0]],
            "surface": None,
        },
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
            with open(path, "r") as f:
                cal = json.load(f)
        except Exception:
            cal = _default()
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


def part_load_alpha(cal):
    """Damping alpha for NON-WOT cells; None = legacy (no part-load damping)."""
    v = ((cal or {}).get("mouth_rad", {}) or {}).get("part_load_alpha")
    return None if v is None else float(v)


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


def intake_vanos_base(cal):
    return float((cal or {}).get("intake_vanos_base", 130.0))


def exvanos_scale(cal):
    return float((cal or {}).get("exvanos_base", {}).get("scale", 1.0))


def _interp1(pts, x):
    pts = sorted((float(a), float(b)) for a, b in pts)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            t = 0.0 if x1 == x0 else (x - x0) / (x1 - x0)
            return y0 * (1 - t) + y1 * t
    return pts[-1][1]


def exvanos_base_for(cal, rpm, is_wot, load=None):
    """EXVANOS_BASE for a cell -- the foldable calibration scaffold (§4.C).

    WOT (is_wot=True): unchanged from v1 -- the folded stable datum
    ``wot_base_stable`` unless the (stale) per-rpm shape fit is re-enabled.
    The WOT row therefore CANNOT regress from part-load fitting.

    Part load: if a fitted ``surface`` exists, bilinear-interpolate base(rpm,
    load) with clamping (the surface's load=100 row is anchored to the WOT
    fit); else the legacy constant ``part_load_const``.
    """
    ex = (cal or {}).get("exvanos_base", {})
    part_const = float(ex.get("part_load_const", 150.0))
    if is_wot:
        # "use_shape_fit" = the current per-rpm points table (Phase-3 measured-
        # geometry fit); legacy key "use_stale_shape_fit" still honored.
        use_points = ex.get("use_shape_fit", ex.get("use_stale_shape_fit", False))
        if not use_points:
            return float(ex.get("wot_base_stable", 150.0))
        pts = ex.get("points") or [[2700, 150.0], [3900, 115.0], [4600, 155.0],
                                   [5300, 160.0], [6300, 160.0], [6900, 160.0]]
        return _interp1(pts, rpm)

    surf = ex.get("surface")
    if not surf or load is None:
        return part_const
    try:
        rpms = [float(r) for r in surf["rpms"]]
        loads = [float(l) for l in surf["loads"]]
        vals = surf["values"]          # vals[load_idx][rpm_idx]
    except (KeyError, TypeError, ValueError):
        return part_const
    if not rpms or not loads or not vals:
        return part_const

    def _bracket(ax, x):
        if x <= ax[0]:
            return 0, 0, 0.0
        if x >= ax[-1]:
            return len(ax) - 1, len(ax) - 1, 0.0
        for i in range(len(ax) - 1):
            if ax[i] <= x <= ax[i + 1]:
                t = 0.0 if ax[i + 1] == ax[i] else (x - ax[i]) / (ax[i + 1] - ax[i])
                return i, i + 1, t
        return len(ax) - 1, len(ax) - 1, 0.0

    i0, i1, ti = _bracket(rpms, float(rpm))
    j0, j1, tj = _bracket(loads, float(load))
    try:
        v00, v01 = float(vals[j0][i0]), float(vals[j0][i1])
        v10, v11 = float(vals[j1][i0]), float(vals[j1][i1])
    except (IndexError, TypeError, ValueError):
        return part_const
    v0 = v00 * (1 - ti) + v01 * ti
    v1 = v10 * (1 - ti) + v11 * ti
    return v0 * (1 - tj) + v1 * tj

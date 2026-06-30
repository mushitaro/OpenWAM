"""Provisional model-calibration scaffold loader (UX_APP_DEV_SPEC.md §4.C / §10).

The mouth radiation damping (alpha/w) and the per-rpm EXVANOS_BASE table are
MODEL-CALIBRATION SCAFFOLDING, not final physics. They were fitted on the
(now-corrected) 268/264 cams and the owner's by-feel intake geometry; they WILL
be re-fitted once real measured dimensions land. We therefore keep them as named
config constants in ``data/calibration.json`` (NOT hardcoded in the UI / sim
logic), so the scaffold can be re-fitted -- or folded to a flat datum -- without
code surgery. Every Run record logs the active ``calib`` block for traceability.

Runtime env vars still win for one-off studies:
  OPENWAM_MOUTH_RAD / OPENWAM_MOUTH_RAD_W / OPENWAM_MOUTH_RAD_OFF
  OPENWAM_EXVANOS_BASE (scalar override) / OPENWAM_EXVANOS_SCALE
"""
import json
import os
import threading

_CACHE = {}
_LOCK = threading.Lock()


def _default():
    return {
        "schema_version": 1,
        "mouth_rad": {"alpha": 0.4, "w": 0.005, "wot_tps_threshold": 85.0},
        "thr_choke": 1,
        "intake_vanos_base": 130.0,
        "exvanos_base": {
            "fit_cam_deg": 268,
            "stale": True,
            "part_load_const": 150.0,
            "scale": 1.0,
            "points": [[2700, 150.0], [3900, 115.0], [4600, 155.0],
                       [5300, 160.0], [6300, 160.0], [6900, 160.0]],
        },
    }


def load(data_dir):
    """Load (and cache) the calibration scaffold for ``data_dir``.

    Env CSL_CALIBRATION_PATH overrides the file location. Falls back to the
    in-code default if the file is missing/unreadable.
    """
    path = os.environ.get("CSL_CALIBRATION_PATH") or os.path.join(data_dir, "calibration.json")
    with _LOCK:
        cal = _CACHE.get(path)
        if cal is None:
            try:
                with open(path, "r") as f:
                    cal = json.load(f)
            except Exception:
                cal = _default()
            _CACHE[path] = cal
    return cal


def mouth_rad(cal):
    """Return (alpha, w, wot_tps_threshold) for the WOT radiation damping."""
    mr = cal.get("mouth_rad", {}) if cal else {}
    return (float(mr.get("alpha", 0.4)),
            float(mr.get("w", 0.005)),
            float(mr.get("wot_tps_threshold", 85.0)))


def intake_vanos_base(cal):
    return float((cal or {}).get("intake_vanos_base", 130.0))


def exvanos_scale(cal):
    return float((cal or {}).get("exvanos_base", {}).get("scale", 1.0))


def exvanos_base_for(cal, rpm, is_wot):
    """EXVANOS_BASE(rpm) -- the foldable WOT calibration scaffold (§4.C).

    Part-load keeps the legacy constant. At WOT: if the per-rpm shape-fit is
    FOLDED (use_stale_shape_fit=false, the M1 default), return the stable datum
    ``wot_base_stable`` (so the model is stable/sweepable); otherwise interpolate
    the fitted per-rpm table. Returns the number the caller plugs into
    ``vanos_exhaust_bias = (base - kf_avan1_soll) * scale``.
    """
    ex = (cal or {}).get("exvanos_base", {})
    part_const = float(ex.get("part_load_const", 150.0))
    if not is_wot:
        return part_const
    if not ex.get("use_stale_shape_fit", False):
        return float(ex.get("wot_base_stable", 150.0))   # folded to the stable datum
    pts = ex.get("points") or [[2700, 150.0], [3900, 115.0], [4600, 155.0],
                               [5300, 160.0], [6300, 160.0], [6900, 160.0]]
    pts = sorted((float(r), float(b)) for r, b in pts)
    if rpm <= pts[0][0]:
        return pts[0][1]
    if rpm >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        (r0, b0), (r1, b1) = pts[i], pts[i + 1]
        if r0 <= rpm <= r1:
            t = (rpm - r0) / (r1 - r0)
            return b0 * (1 - t) + b1 * t
    return part_const

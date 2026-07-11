"""Pure fit functions for the part-load calibration (PLAN_PARTLOAD_CALIBRATION.md
Phase 4.1). No I/O, no solver calls -- unit-testable on canned rows; the sweep
driver is scripts/fit_partload.py.

Conventions:
  p (fill ratio) = VE / VE_WOT at the same rpm.
    sim side  : VE_WOT = the Phase-3 calibrated WOT row (measured geometry).
    stock side: kf_rf_soll[load_row] / kf_rf_soll[100_row] (ECU-internal ratio;
                provenance-consistent -- never mix wideband into part load).
  A "row" here is a dict; fitters take lists of such dicts.
"""
import copy
import math
import statistics


# ---------------------------------------------------------------- primitives
def secant_step(evals, target, lo=None, hi=None):
    """Next abscissa for solving f(x) = target from noisy scalar evals.

    evals: [(x, y)] so far (>=1). Returns (next_x, converged, best_x):
      * picks the two evals BRACKETING the target when available (regula falsi),
        else the two nearest-in-y (secant), else nudges off the single point;
      * next_x is clamped to [lo, hi] when given;
      * converged=True when the best eval's |y - target| <= 0.015 (p units)
        or the bracket has collapsed (|x1-x0| tiny).
    """
    pts = sorted(evals, key=lambda e: e[0])
    best_x, best_y = min(pts, key=lambda e: abs(e[1] - target))
    if abs(best_y - target) <= 0.015:
        return best_x, True, best_x

    lo_pt = None
    hi_pt = None
    for x, y in pts:
        if y <= target and (lo_pt is None or x > lo_pt[0]):
            lo_pt = (x, y)
        if y >= target and (hi_pt is None or x < hi_pt[0]):
            hi_pt = (x, y)
    if lo_pt and hi_pt and lo_pt[0] != hi_pt[0]:
        (x0, y0), (x1, y1) = lo_pt, hi_pt
        if abs(x1 - x0) < 1e-3 * max(1.0, abs(x0)):
            return best_x, True, best_x
    elif len(pts) >= 2:
        (x0, y0), (x1, y1) = sorted(pts, key=lambda e: abs(e[1] - target))[:2]
        if y1 == y0:
            return best_x, True, best_x
    else:
        (x0, y0) = pts[0]
        step = 0.1 * (abs(x0) or 1.0)
        nx = x0 + (step if y0 < target else -step)
        if lo is not None:
            nx = max(lo, nx)
        if hi is not None:
            nx = min(hi, nx)
        return nx, False, best_x

    if y1 == y0:
        return best_x, True, best_x
    nx = x0 + (target - y0) * (x1 - x0) / (y1 - y0)
    if lo is not None:
        nx = max(lo, nx)
    if hi is not None:
        nx = min(hi, nx)
    # degenerate step -> call it converged at the best point
    if any(abs(nx - x) < 1e-3 * max(1.0, abs(nx)) for x, _ in pts):
        return best_x, True, best_x
    return nx, False, best_x


# ---------------------------------------------------------------- Step A: ICV
def fit_icv(rows, sigma_spread_tol=0.15):
    """Fit ONE ICV effective-area constant from the Step-A grid.

    rows: [{rpm, load, sigma, p_sim, p_stock, valid}] (invalid rows ignored).
    Objective: mean |p_sim - p_stock| per candidate sigma (the swept grid).
    Returns {sigma, cost, per_rpm, rpm_spread, note}: per_rpm = each rpm's own
    argmin; if their spread exceeds sigma_spread_tol the global choice is the
    MEDIAN of the per-rpm bests (risk R3: the real ICV is duty-controlled; we
    truncate to a constant and record the residual, never table it).
    """
    ok = [r for r in rows if r.get("valid", True)
          and r.get("p_sim") is not None and r.get("p_stock") is not None]
    if not ok:
        return {"sigma": None, "cost": None, "per_rpm": {}, "rpm_spread": None,
                "note": "no valid rows"}
    sigmas = sorted({float(r["sigma"]) for r in ok})
    def cost_of(rs):
        return statistics.mean(abs(r["p_sim"] - r["p_stock"]) for r in rs)
    global_cost = {s: cost_of([r for r in ok if float(r["sigma"]) == s])
                   for s in sigmas}
    best_global = min(global_cost, key=global_cost.get)

    per_rpm = {}
    for rpm in sorted({r["rpm"] for r in ok}):
        sub = [r for r in ok if r["rpm"] == rpm]
        ss = sorted({float(r["sigma"]) for r in sub})
        cc = {s: cost_of([r for r in sub if float(r["sigma"]) == s]) for s in ss}
        per_rpm[rpm] = min(cc, key=cc.get)
    spread = (max(per_rpm.values()) - min(per_rpm.values())) if per_rpm else None

    if spread is not None and spread > sigma_spread_tol and len(per_rpm) >= 3:
        sigma = statistics.median(per_rpm.values())
        note = (f"strong rpm dependence (spread {spread:.3f} > {sigma_spread_tol}); "
                f"truncated to median of per-rpm bests (R3)")
    else:
        sigma = best_global
        note = "global argmin"
    return {"sigma": float(sigma), "cost": global_cost.get(sigma, cost_of(ok)),
            "per_rpm": {int(k): float(v) for k, v in per_rpm.items()},
            "rpm_spread": (float(spread) if spread is not None else None),
            "note": note}


# ------------------------------------------------------ Step B: sigma(pedal)
def fit_sigma_bp(evals_by_pedal, anchors=((0.0, 0.001), (1.0, 0.96))):
    """Assemble the monotonic sigma(pedal) table from per-pedal solve results.

    evals_by_pedal: {pedal: [(sigma, p_err)]} where p_err = mean_rpm(p_sim) -
    mean_rpm(p_stock) at that sigma. Each pedal's sigma* = root of p_err
    (interpolated between the bracketing evals; else nearest). Monotonicity in
    pedal is enforced by clipping from below. Returns [[pedal, sigma], ...]
    including the fixed anchors.
    """
    fitted = {}
    for pedal, evals in evals_by_pedal.items():
        if not evals:
            continue
        pts = sorted(evals, key=lambda e: e[0])
        root = None
        for (s0, e0), (s1, e1) in zip(pts, pts[1:]):
            if e0 == e1:
                continue
            if (e0 <= 0.0 <= e1) or (e1 <= 0.0 <= e0):
                root = s0 + (0.0 - e0) * (s1 - s0) / (e1 - e0)
                break
        if root is None:
            root = min(pts, key=lambda e: abs(e[1]))[0]
        fitted[float(pedal)] = float(root)

    lo_anchor, hi_anchor = anchors
    table = [list(lo_anchor)]
    prev = lo_anchor[1]
    for pedal in sorted(fitted):
        s = max(fitted[pedal], prev + 1e-4)          # monotone non-decreasing
        s = min(s, hi_anchor[1])
        table.append([pedal, round(s, 5)])
        prev = s
    table.append(list(hi_anchor))
    return table


# ---------------------------------------------------------------------------
# Stage 69: fit_base_surface (the per-cell EXVANOS base surface fitter) is
# DELETED — cam phase is a tuning variable and never absorbs model error.
# Legitimate fitters remaining: sigma(pedal) + ICV (component flow
# characterization) and, per Stage-69 R2, GLOBAL solver constants only.
# ---------------------------------------------------------------------------


# ----------------------------------------------------------------- residuals
def residual_report(rows):
    """rows: [{rpm, load, p_sim, p_stock, valid}] -> summary dict."""
    ok = [r for r in rows if r.get("valid", True)
          and r.get("p_sim") is not None and r.get("p_stock") is not None]
    if not ok:
        return {"n": 0}
    errs = [abs(r["p_sim"] - r["p_stock"]) for r in ok]
    return {"n": len(ok),
            "mean_abs_p_err": round(statistics.mean(errs), 4),
            "max_abs_p_err": round(max(errs), 4),
            "worst_cell": max(ok, key=lambda r: abs(r["p_sim"] - r["p_stock"]))}


# --------------------------------------------------------------- apply_fits
def apply_fits(cal, icv_sigma=None, icv_meta=None, sigma_points=None,
               sigma_meta=None, part_load_alpha="keep", fit_meta=None):
    """Return a NEW calibration dict (schema v3) with the given fits applied.

    Stage 69: the ``surface`` (EXVANOS base) writer is DELETED. Only component
    characterization (sigma/ICV) and mouth_rad remain writable here; GLOBAL
    solver constants go into the ``global_solver`` block by the R2 campaign.
    """
    out = copy.deepcopy(cal)
    out["schema_version"] = 3
    if icv_sigma is not None:
        out.setdefault("icv", {})
        out["icv"]["sigma"] = round(float(icv_sigma), 4)
        out["icv"]["fit_meta"] = icv_meta or fit_meta
    if sigma_points is not None:
        out.setdefault("thr_sigma", {})
        out["thr_sigma"]["points"] = sigma_points
        out["thr_sigma"]["enabled"] = True
        out["thr_sigma"]["fit_meta"] = sigma_meta or fit_meta
    if part_load_alpha != "keep":
        out.setdefault("mouth_rad", {})
        out["mouth_rad"]["part_load_alpha"] = part_load_alpha
    return out

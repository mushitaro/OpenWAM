"""Validity / evaluation metrics (UX_APP_DEV_SPEC.md §5).

Pure, dependency-free functions (ported from the validated diagnostic scripts:
ve_shape_report.py, ve_breakpoint_summary.py, ve_converged_robust.py). All operate
on VE in PERCENT. Evaluation is SHAPE-based: the absolute per-rpm level is divided
out (WOT-ratio correction); tolerances are provenance-aware (WOT = wideband = tight,
part-load = narrowband-log = shape-only -- relax the level checks). The composite
score is HARD-GATED to red if any cell in the row fails the health gates
(converged / cylinder-balance / VE-in-band).
"""
import json
import math
import os
import re

# ---- traffic-light thresholds (verbatim from §5) ---------------------------
R_GREEN, R_YELLOW = 0.95, 0.85               # shape correlation
ERR_GREEN, ERR_YELLOW = 0.05, 0.12           # max normalized shape error
DP_GREEN, DP_YELLOW = 0.05, 0.12             # wot_ratio_maxdp (§5 metric #8)
VE_BAND = (30.0, 160.0)                       # sane VE band; >300 = blow-up
VE_BLOWUP = 300.0
SLOPE_TOL = 0.3                               # |dVE/dcycle| convergence
WOT_TPS = 85.0

_SEVERITY = {"green": 0, "yellow": 1, "red": 2}


# ---- NaN gate (shared by run_point / run_cells_local / optimizer) -----------
def nan_persistent(output, startup_cycles=5, tail_cycles=5):
    """True iff the solver stdout shows NaN with NO recovery evidence.

    "Persistent NaN only" (Stage 57): the measured geometry throws a
    recoverable junction/valve BC NaN burst near startup (junction guard +
    TTubo BC reports), which self-resets and converges balanced. Stage 58
    refinement: that burst can straddle a fixed cycle cut (3900/45 alpha 0.4:
    last report at cycle 5.83, then 28 clean cycles, converged + balanced), so
    a fixed "any NaN after cycle N" boundary misclassifies recovered cells.

    Rule: persistent iff the LAST NaN text sits inside the final
    ``tail_cycles`` recorded cycles (the converged tail is contaminated or the
    run died mid-burst). Anything that goes quiet >= tail_cycles before the
    end has demonstrably recovered. Runs too short to prove recovery
    (< startup_cycles + tail_cycles cycles) keep the strict semantics: any
    NaN after ``startup_cycles`` is persistent.

    Caveat (by construction): the solver throttles NaN reports globally
    (TCCRamificacion junction guard: 20/run; TTubo BC: 50/side/run), so text
    position is only meaningful EARLY in a run. Late silent divergence is the
    job of the physical gates (VE band / slope convergence / cyl balance /
    blow-up), not this one.
    """
    low = output.lower()
    nan_pos = low.rfind("nan")
    if nan_pos < 0:
        return False
    ends = [m.end() for m in re.finditer(r"Mtrap:[0-9.]+ g", output)]
    if not ends:
        return True
    ncyc = len(ends) // 6
    cut_cyc = max(startup_cycles, ncyc - tail_cycles)
    cut = ends[cut_cyc * 6 - 1] if len(ends) >= cut_cyc * 6 else ends[-1]
    return nan_pos >= cut


def status_worst(*statuses):
    worst = "green"
    for s in statuses:
        if _SEVERITY.get(s, 2) > _SEVERITY[worst]:
            worst = s
    return worst


def _r_status(r):
    if r is None or math.isnan(r):
        return "red"
    if r >= R_GREEN:
        return "green"
    if r >= R_YELLOW:
        return "yellow"
    return "red"


def _err_status(e):
    if e is None or math.isnan(e):
        return "red"
    if e <= ERR_GREEN:
        return "green"
    if e <= ERR_YELLOW:
        return "yellow"
    return "red"


# ---- primitive shape metrics ------------------------------------------------
def pearson(xs, ys):
    """Pearson correlation; nan if degenerate (ve_shape_report.py:54-60)."""
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 2:
        return float("nan")
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sx = math.sqrt(sum((p[0] - mx) ** 2 for p in pairs))
    sy = math.sqrt(sum((p[1] - my) ** 2 for p in pairs))
    if sx == 0 or sy == 0:
        return float("nan")
    return sum((p[0] - mx) * (p[1] - my) for p in pairs) / (sx * sy)


def max_norm_shape_err(sim, stock):
    """Normalize each curve to its OWN mean; return max |sim_norm - stock_norm|
    (ve_shape_report.py:83)."""
    pairs = [(s, k) for s, k in zip(sim, stock) if s is not None and k is not None]
    if len(pairs) < 2:
        return float("nan")
    ms = sum(p[0] for p in pairs) / len(pairs)
    mk = sum(p[1] for p in pairs) / len(pairs)
    if ms == 0 or mk == 0:
        return float("nan")
    return max(abs(p[0] / ms - p[1] / mk) for p in pairs)


def peak_rpm(curve, rpm_axis):
    """RPM at which the curve peaks (ignoring None cells)."""
    best_v, best_r = None, None
    for v, r in zip(curve, rpm_axis):
        if v is None:
            continue
        if best_v is None or v > best_v:
            best_v, best_r = v, r
    return best_r


def range_pp(curve):
    vals = [v for v in curve if v is not None]
    if len(vals) < 2:
        return float("nan")
    return max(vals) - min(vals)


def tilt(curve, rpm_axis):
    """mean(high-rpm half) - mean(low-rpm half), normalized by overall mean
    (ve_breakpoint_summary.py:39-40). Sign: negative = falls off at high rpm."""
    pairs = sorted(((r, v) for r, v in zip(rpm_axis, curve) if v is not None),
                   key=lambda p: p[0])
    if len(pairs) < 2:
        return float("nan")
    half = len(pairs) // 2
    lo = [v for _, v in pairs[:half]]
    hi = [v for _, v in pairs[half:]]
    if not lo or not hi:
        return float("nan")
    overall = sum(v for _, v in pairs) / len(pairs)
    if overall == 0:
        return float("nan")
    return (sum(hi) / len(hi) - sum(lo) / len(lo)) / overall


# ---- cross-row load-profile metric (§5 metric #8) ---------------------------
def _health_ok(h):
    return bool(h.get("converged") and h.get("cyl_ok") and h.get("ve_in_band"))


def wot_ratio_maxdp_row(cells_row, wot_cells_row):
    """max over rpm of |sim/sim_WOT - stock/stock_WOT| for one part-load row.

    The WOT-ratio removes the absolute per-rpm level (provenance: the part-load
    target kf_rf_soll is narrowband+log = shape-only), leaving the LOAD-PROFILE
    error. Uses only rpms where BOTH the part-load and the WOT cell pass the
    health gates and both stock targets exist. None when no rpm qualifies (the
    health gate already reddens such a row).
    """
    worst = None
    for c, w in zip(cells_row, wot_cells_row):
        if not c or not w:
            continue
        if not (_health_ok(c.get("health", {})) and _health_ok(w.get("health", {}))):
            continue
        s, k = c.get("ve_sim"), c.get("ve_stock")
        sw, kw = w.get("ve_sim"), w.get("ve_stock")
        if s is None or k is None or not sw or not kw:
            continue
        d = abs(s / sw - k / kw)
        worst = d if worst is None else max(worst, d)
    return worst


def dp_status(dp):
    if dp is None or (isinstance(dp, float) and math.isnan(dp)):
        return "green"          # no qualifying rpm -> health gate carries it
    if dp <= DP_GREEN:
        return "green"
    if dp <= DP_YELLOW:
        return "yellow"
    return "red"


# ---- stock (measured) target ------------------------------------------------
def load_stock_wot(data_dir):
    """stock_csl_ve.json -> {rpm: ve_percent}. The file stores fractional VE
    (1.157 = 115.7 %), so multiply by 100. This is the owner's MEASURED wideband
    WOT data -- the calibration target."""
    path = os.path.join(data_dir, "stock_csl_ve.json")
    try:
        with open(path, "r") as f:
            rows = json.load(f)
    except Exception:
        return {}
    return {float(r["rpm"]): float(r["ve"]) * 100.0 for r in rows}


def stock_on_axis(rpm_axis, stock):
    """Align the stock dict onto the sim rpm axis. Exact key match where possible
    (the axes are identical for this engine), linear-interp fallback."""
    if not stock:
        return [None] * len(rpm_axis)
    keys = sorted(stock.keys())
    out = []
    for rpm in rpm_axis:
        if rpm in stock:
            out.append(stock[rpm])
        elif rpm <= keys[0]:
            out.append(stock[keys[0]])
        elif rpm >= keys[-1]:
            out.append(stock[keys[-1]])
        else:
            lo = max(k for k in keys if k <= rpm)
            hi = min(k for k in keys if k >= rpm)
            t = 0 if hi == lo else (rpm - lo) / (hi - lo)
            out.append(stock[lo] * (1 - t) + stock[hi] * t)
    return out


# ---- row & overall ----------------------------------------------------------
def row_metrics(load, sim_row, stock_row, rpm_axis, healths):
    """Compute the §5 per-rpm-row metrics + traffic-light status.

    sim_row / stock_row: VE% lists aligned to rpm_axis (stock entries may be None
    off the WOT row in M1). healths: list of per-cell health dicts (with keys
    converged / cyl_ok / ve_in_band).
    """
    n_cells = len(sim_row)
    n_gated = sum(1 for h in healths if not (h.get("converged") and h.get("cyl_ok")
                                             and h.get("ve_in_band")))
    health_status = "red" if n_gated > 0 else "green"

    # only compare where BOTH curves exist AND the cell passed the health gate
    trusted_sim, trusted_stock, trusted_rpm = [], [], []
    for s, k, r, h in zip(sim_row, stock_row, rpm_axis, healths):
        if s is None or k is None:
            continue
        if not (h.get("converged") and h.get("cyl_ok") and h.get("ve_in_band")):
            continue
        trusted_sim.append(s); trusted_stock.append(k); trusted_rpm.append(r)
    n_trusted = len(trusted_sim)

    has_stock = n_trusted >= 2
    r = pearson(trusted_sim, trusted_stock) if has_stock else None
    err = max_norm_shape_err(trusted_sim, trusted_stock) if has_stock else None
    peak_sim = peak_rpm(sim_row, rpm_axis)
    peak_stock = peak_rpm(stock_row, rpm_axis) if has_stock else None

    # peak match within one breakpoint
    peak_match = None
    peak_status = "green"
    if peak_sim is not None and peak_stock is not None:
        axis_sorted = sorted(rpm_axis)
        try:
            i_sim = axis_sorted.index(min(axis_sorted, key=lambda a: abs(a - peak_sim)))
            i_stk = axis_sorted.index(min(axis_sorted, key=lambda a: abs(a - peak_stock)))
            peak_match = abs(i_sim - i_stk) <= 1
        except ValueError:
            peak_match = peak_sim == peak_stock
        peak_status = "green" if peak_match else "red"

    statuses = [health_status]
    if has_stock:
        statuses += [_r_status(r), _err_status(err), peak_status]
    status = status_worst(*statuses)

    # composite 0-100 (gated to red band if health failed)
    if has_stock:
        r_score = max(0.0, min(1.0, (r - R_YELLOW) / (0.99 - R_YELLOW))) if r is not None and not math.isnan(r) else 0.0
        err_score = max(0.0, min(1.0, (ERR_YELLOW - err) / ERR_YELLOW)) if err is not None and not math.isnan(err) else 0.0
        peak_score = 1.0 if peak_match else 0.3
        base = 100.0 * (0.5 * r_score + 0.4 * err_score + 0.1 * peak_score)
    else:
        base = 60.0 if health_status == "green" else 0.0
    if health_status == "red":
        base = min(base, 35.0)
    score = round(base)

    def _round(x, nd=4):
        return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, nd)

    return {
        "load": load,
        "r": _round(r),
        "max_shape_err": _round(err),
        "peak_rpm_sim": peak_sim,
        "peak_rpm_stock": peak_stock,
        "peak_match": peak_match,
        "range_sim_pp": _round(range_pp(sim_row), 2),
        "range_stock_pp": _round(range_pp(stock_row), 2) if has_stock else None,
        "tilt_sim": _round(tilt(sim_row, rpm_axis), 3),
        "tilt_stock": _round(tilt(stock_row, rpm_axis), 3) if has_stock else None,
        "wot_ratio_maxdp": None,   # part-load load-profile metric -> M2
        "score": score,
        "status": status,
        "n_trusted": n_trusted,
        "n_gated": n_gated,
    }


def overall(rows, cells_flat):
    """Aggregate rows + all cells into the overall verdict."""
    n_cells = len(cells_flat)
    n_converged = sum(1 for c in cells_flat if c.get("health", {}).get("converged"))
    n_cyl_ok = sum(1 for c in cells_flat if c.get("health", {}).get("cyl_ok"))
    any_red_health = any(not c.get("health", {}).get("valid") for c in cells_flat)

    rs = [row["r"] for row in rows if row.get("r") is not None]
    errs = [row["max_shape_err"] for row in rows if row.get("max_shape_err") is not None]
    scores = sorted(row["score"] for row in rows) if rows else [0]
    status = status_worst(*[row["status"] for row in rows]) if rows else "red"

    median_score = scores[len(scores) // 2] if scores else 0
    verdict = ("Valid — proceed to Tuning"
               if status in ("green", "yellow") and not any_red_health
               else "Not valid — resolve health/shape flags before tuning")

    def _avg(xs):
        return round(sum(xs) / len(xs), 4) if xs else None

    return {
        "r": _avg(rs),
        "max_shape_err": round(max(errs), 4) if errs else None,
        "score": median_score,
        "status": status,
        "verdict": verdict,
        "any_red_health": any_red_health,
        "n_cells": n_cells,
        "n_converged": n_converged,
        "n_cyl_ok": n_cyl_ok,
    }

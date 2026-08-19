#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage 121 - offline analysis of a live VANOS sweep datalog.

Reads a wide CSV datalog from the DS2 tool (see docs/LIVE_VANOS_SWEEP_PROTOCOL.md
section 8) and turns it into the cam->air transfer function: per rpm bin, how the
lambda integrator (la_f_regler = the real-air signal, since rf/ml are Alpha-N and do
not move) changes with commanded cam angle, drift-corrected against the bracketed
baseline (A/B/A), with a parabola fit per rpm bin to locate the max-VE cam.

The output shares the axis of the Stage-120 sim prediction (delta signal per deg of
LIVE cam), so ``--compare stage120`` overlays the two: agreement validates the sim on
a differential it can produce even though its absolute valley depth is imperfect.

No real log exists yet; ``--selftest`` synthesises a sweep with a known vertex and
confirms the analyzer recovers it, so the pipeline is proven before the drive.

Interpretation: la_f_regler (STFT) ~ 1.0 (raw/32768). A cam that breathes better goes
lean -> closed loop adds fuel -> la rises. So d(la) > 0 vs baseline = more real air.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
from typing import Dict, List, Optional, Tuple

# column aliases -> canonical name
ALIASES = {
    "t_ms": ["t_ms", "elapsedmilliseconds", "elapsed_ms", "t", "time_ms"],
    "rpm": ["rpm", "n"],
    "evan1_ist": ["evan1_ist", "evanist", "evan_ist"],
    "avan1_ist": ["avan1_ist", "avanist", "avan_ist"],
    "evan1_soll": ["evan1_soll", "evansoll", "evan_soll"],
    "avan1_soll": ["avan1_soll", "avansoll", "avan_soll"],
    "la1": ["la_f_regler1", "la1", "stft1", "lambda1"],
    "la2": ["la_f_regler2", "la2", "stft2", "lambda2"],
    "pedal": ["pedal"],
    "cmd_intake": ["cmd_intake", "cmd_in"],
    "cmd_exhaust": ["cmd_exhaust", "cmd_ex"],
    "tz1": ["tz1"], "tabg": ["tabg"],
}
RPM_BIN = 300
ANALYSIS_MIN_RPM = 2700
IST_SOLL_TOL = 2.0     # deg, both banks
PEDAL_MIN = 99


def _canon(headers: List[str]) -> Dict[str, str]:
    low = {h.lower().strip(): h for h in headers}
    out = {}
    for canon, alts in ALIASES.items():
        for a in alts:
            if a in low:
                out[canon] = low[a]
                break
    return out


def _f(row, col) -> Optional[float]:
    if not col or col not in row:
        return None
    v = row[col]
    if v is None or v == "" or str(v).lower() in ("nan", "null", "none"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load_samples(path: str) -> List[dict]:
    with open(path, "r", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        cmap = _canon(rd.fieldnames or [])
        rows = []
        for r in rd:
            s = {k: _f(r, cmap.get(k)) for k in ALIASES}
            # setting label: prefer explicit cmd, else the soll angles
            ci = r.get(cmap.get("cmd_intake", ""), "")
            ce = r.get(cmap.get("cmd_exhaust", ""), "")
            s["_cmd_in_raw"] = (ci or "").strip()
            s["_cmd_ex_raw"] = (ce or "").strip()
            rows.append(s)
    return rows


def _is_baseline(s: dict) -> bool:
    ci, ce = s["_cmd_in_raw"].lower(), s["_cmd_ex_raw"].lower()
    return (ci in ("", "base", "baseline") and ce in ("", "base", "baseline"))


def _la(s: dict) -> Optional[float]:
    a, b = s.get("la1"), s.get("la2")
    vals = [v for v in (a, b) if v is not None]
    return statistics.mean(vals) if vals else None


def _valid(s: dict) -> bool:
    if s.get("rpm") is None or s["rpm"] < ANALYSIS_MIN_RPM:
        return False
    if s.get("pedal") is not None and s["pedal"] < PEDAL_MIN:
        return False
    for ist, soll in (("evan1_ist", "evan1_soll"), ("avan1_ist", "avan1_soll")):
        vi, vs = s.get(ist), s.get(soll)
        if vi is not None and vs is not None and abs(vi - vs) > IST_SOLL_TOL:
            return False
    return _la(s) is not None


def _rpm_bin(rpm: float) -> int:
    return int(round(rpm / RPM_BIN) * RPM_BIN)


def _setting_key(s: dict) -> Tuple[str, float, float]:
    """(axis, intake_live, exhaust_live). Live angle = the ist we actually held."""
    il = s.get("evan1_ist")
    el = s.get("avan1_ist")
    il = round(il) if il is not None else None
    el = round(el) if el is not None else None
    if _is_baseline(s):
        return ("base", il if il is not None else 0, el if el is not None else 0)
    # which axis is being swept is inferred later; store both live angles
    return ("set", il if il is not None else 0, el if el is not None else 0)


def _interp_baseline(base_by_bin: Dict[int, List[Tuple[float, float]]],
                     rb: int, t: float) -> Optional[float]:
    pts = base_by_bin.get(rb)
    if not pts:
        # fall back to any baseline mean if this bin has none
        allpts = [p for v in base_by_bin.values() for p in v]
        return statistics.mean(y for _, y in allpts) if allpts else None
    pts = sorted(pts)
    if t <= pts[0][0]:
        return pts[0][1]
    if t >= pts[-1][0]:
        return pts[-1][1]
    for i in range(1, len(pts)):
        if t <= pts[i][0]:
            (t0, y0), (t1, y1) = pts[i - 1], pts[i]
            return y0 + (y1 - y0) * (t - t0) / (t1 - t0) if t1 != t0 else y0
    return pts[-1][1]


def _parabola_vertex(xs: List[float], ys: List[float]) -> Optional[dict]:
    """Least-squares quadratic y = a x^2 + b x + c; return vertex if a<0 (a max)."""
    n = len(xs)
    if n < 3:
        return None
    sx = sum(xs); sx2 = sum(x * x for x in xs); sx3 = sum(x ** 3 for x in xs)
    sx4 = sum(x ** 4 for x in xs)
    sy = sum(ys); sxy = sum(x * y for x, y in zip(xs, ys))
    sx2y = sum(x * x * y for x, y in zip(xs, ys))
    # normal equations for [a,b,c]
    A = [[sx4, sx3, sx2], [sx3, sx2, sx], [sx2, sx, n]]
    B = [sx2y, sxy, sy]
    det = (A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
           - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
           + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]))
    if abs(det) < 1e-12:
        return None

    def solve(col):
        M = [row[:] for row in A]
        for i in range(3):
            M[i][col] = B[i]
        return (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
                - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) / det
    a, b, c = solve(0), solve(1), solve(2)
    if a >= 0:
        return {"a": a, "b": b, "c": c, "vertex": None, "concave": False}
    return {"a": a, "b": b, "c": c, "vertex": -b / (2 * a), "concave": True}


def analyze(path: str, axis: str = "intake") -> dict:
    rows = load_samples(path)
    valid = [s for s in rows if _valid(s)]
    base = [s for s in valid if _is_baseline(s)]
    sett = [s for s in valid if not _is_baseline(s)]

    base_by_bin: Dict[int, List[Tuple[float, float]]] = {}
    for s in base:
        rb = _rpm_bin(s["rpm"])
        t = s.get("t_ms") or 0.0
        base_by_bin.setdefault(rb, []).append((t, _la(s)))

    live_key = "evan1_ist" if axis == "intake" else "avan1_ist"
    # group settings by (rpm_bin, swept-live-angle), delta vs time-local baseline
    groups: Dict[Tuple[int, float], List[float]] = {}
    for s in sett:
        rb = _rpm_bin(s["rpm"])
        cam = s.get(live_key)
        if cam is None:
            continue
        b = _interp_baseline(base_by_bin, rb, s.get("t_ms") or 0.0)
        if b is None:
            continue
        groups.setdefault((rb, round(cam)), []).append(_la(s) - b)

    out = {"axis": axis, "n_valid": len(valid), "n_base": len(base),
           "n_setting": len(sett), "bins": {}}
    for (rb, cam), deltas in sorted(groups.items()):
        d = out["bins"].setdefault(str(rb), {"points": []})
        m = statistics.mean(deltas)
        sem = (statistics.pstdev(deltas) / math.sqrt(len(deltas))) if len(deltas) > 1 else 0.0
        d["points"].append({"cam_live": cam, "dla_mean": round(m, 5),
                            "dla_sem": round(sem, 5), "n": len(deltas)})
    for rb, d in out["bins"].items():
        pts = sorted(d["points"], key=lambda p: p["cam_live"])
        d["points"] = pts
        vx = _parabola_vertex([p["cam_live"] for p in pts], [p["dla_mean"] for p in pts])
        d["vertex"] = vx
        if len(pts) >= 2:
            xs = [p["cam_live"] for p in pts]
            ys = [p["dla_mean"] for p in pts]
            mx, my = statistics.mean(xs), statistics.mean(ys)
            den = sum((x - mx) ** 2 for x in xs)
            d["slope_dla_per_deg"] = round(sum((x - mx) * (y - my)
                                          for x, y in zip(xs, ys)) / den, 6) if den else None
    return out


def _print(rep: dict) -> None:
    print(f"\n=== live VANOS sweep: {rep['axis']} axis "
          f"(valid {rep['n_valid']}, base {rep['n_base']}, set {rep['n_setting']}) ===")
    for rb in sorted(rep["bins"], key=lambda x: int(x)):
        d = rep["bins"][rb]
        print(f"\n {rb} rpm:")
        print("   cam_live   d(la)    sem     n")
        for p in d["points"]:
            print(f"   {p['cam_live']:+6}   {p['dla_mean']:+.4f}  {p['dla_sem']:.4f}  {p['n']:>3}")
        vx = d.get("vertex")
        if vx and vx.get("concave") and vx.get("vertex") is not None:
            print(f"   -> max-VE cam ~ {vx['vertex']:+.1f} deg live  "
                  f"(slope near stock {d.get('slope_dla_per_deg')})")
        else:
            print(f"   -> no interior max in range (slope {d.get('slope_dla_per_deg')} d(la)/deg)")


def _selftest() -> None:
    """Synthesize a sweep with a KNOWN vertex at intake live +12 deg and confirm recovery."""
    import io
    true_vertex = 12.0
    rng_state = [12345]

    def rnd():  # deterministic LCG (Math.random is banned in some envs; keep it local)
        rng_state[0] = (1103515245 * rng_state[0] + 12345) & 0x7FFFFFFF
        return rng_state[0] / 0x7FFFFFFF - 0.5

    hdr = ["t_ms", "rpm", "evan1_ist", "evan1_soll", "avan1_ist", "avan1_soll",
           "la_f_regler1", "la_f_regler2", "pedal", "cmd_intake", "cmd_exhaust"]
    lines = [",".join(hdr)]
    t = 0
    # A/B/A brackets: baseline (cmd=base) interleaved with settings at several cams
    settings = [0, 5, 10, 12, 15, 20]
    exh = 41
    for rep in range(3):
        # baseline block (intake at stock 0)
        for _ in range(8):
            drift = 0.0008 * t / 1000.0                      # slow drift
            la = 1.00 + drift + 0.004 * rnd()
            lines.append(f"{t},3100,0,0,{exh},{exh},{la:.5f},{la:.5f},100,base,base")
            t += 330
        for cam in settings:
            for _ in range(7):
                drift = 0.0008 * t / 1000.0
                # parabolic air gain peaking at true_vertex, scaled into la (lean->+la)
                gain = -0.00020 * (cam - true_vertex) ** 2 + 0.030
                la = 1.00 + drift + gain + 0.004 * rnd()
                lines.append(f"{t},3100,{cam},{cam},{exh},{exh},{la:.5f},{la:.5f},100,{cam},base")
                t += 330
    tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "calib_data", "stage121_vanos_sweep", "_selftest.csv")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    rep = analyze(tmp, axis="intake")
    _print(rep)
    # 3100 rpm bins to 3000 (round(3100/300)*300); take whichever bin has a vertex
    got = None
    for _rb, _d in rep["bins"].items():
        vx = _d.get("vertex")
        if vx and vx.get("vertex") is not None:
            got = vx["vertex"]
            break
    ok = got is not None and abs(got - true_vertex) < 2.5
    print(f"\n[selftest] true vertex {true_vertex:+.1f}, recovered "
          f"{got:+.1f} -> {'PASS' if ok else 'FAIL'}" if got is not None
          else "[selftest] FAIL (no vertex)")
    os.remove(tmp)


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 121 live VANOS sweep analyzer")
    ap.add_argument("csv", nargs="?", help="wide datalog CSV (see protocol section 8)")
    ap.add_argument("--axis", choices=["intake", "exhaust"], default="intake")
    ap.add_argument("--out", default=None)
    ap.add_argument("--compare", default=None,
                    help="stage120 cam_sensitivity.json to overlay dVE/d(cam)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        _selftest()
        return
    if not args.csv:
        ap.error("provide a datalog CSV or --selftest")
    rep = analyze(args.csv, axis=args.axis)
    _print(rep)
    if args.compare and os.path.isfile(args.compare):
        with open(args.compare, encoding="utf-8") as f:
            s120 = json.load(f)
        print("\n=== overlay vs Stage-120 sim prediction (dVE/d cam, VE% per deg) ===")
        for rb, d in rep["bins"].items():
            simrec = s120.get(rb)
            sim = simrec.get(f"dVE_d{args.axis}_live") if simrec else None
            print(f" {rb} rpm: measured d(la)/deg = {d.get('slope_dla_per_deg')} | "
                  f"sim dVE/deg = {sim}")
    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2)
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()

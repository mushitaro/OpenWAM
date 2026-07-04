#!/usr/bin/env python3
"""Part-load calibration sweep + fit CLI (PLAN_PARTLOAD_CALIBRATION.md Phase 4).

Runs AFTER Phase 3.5 (defaults = measured geometry + rail): jobs use the
DEFAULT SimConfig, composing with calibration.json exactly like the app
(run_cells_local mirrors the service's icv/sigma injection). Every sweep
appends to a resumable CSV under backend/calib_data/; every fit writes a JSON
artifact next to it; `apply` folds artifacts into data/calibration.json
ATOMICALLY (tmp+replace) with fit_meta provenance.

Fit order (§4.2): icv -> sigma -> base -> alpha (A/B) -> recheck. Each step
assumes the previous step's `apply` has been run.

  python fit_partload.py icv     [--sigmas 0.05,0.1,0.2,0.4]
  python fit_partload.py apply --icv calib_data/fit_icv.json
  python fit_partload.py sigma   [--max-evals 3]
  python fit_partload.py apply --sigma calib_data/fit_sigma.json
  python fit_partload.py base
  python fit_partload.py apply --surface calib_data/fit_base.json
  python fit_partload.py alpha
  python fit_partload.py apply --alpha 0.2        (or: --alpha off)
  python fit_partload.py recheck

p (fill ratio) = VE/VE_WOT: sim side needs the Phase-3 WOT row -->
--wot-json calib_data/phase3_wot_row.json  {"ve_by_rpm": {...}, "base": ...}.
"""
import argparse
import asyncio
import datetime
import json
import math
import os
import statistics
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402
import run_cells_local as R  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import calibration_fit as F  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
OUT = os.path.join(HERE, "calib_data")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))
KF = MAPS["kf_rf_soll"]

ICV_RPMS = [3100, 3900, 5300, 6900]
ICV_LOADS = [10.01, 14.99, 20.0]
SIGMA_PEDALS = [0.20, 0.30, 0.45, 0.65, 0.85]
BASE_RPMS = [2700, 3900, 4600, 5300, 6300, 6900]
BASE_LOADS = [20.0, 30.0, 45.0, 64.99]
ALPHA_LOADS = [20.0, 45.0]


def kf_lut(rpm, load):
    rx, ly, v = KF["x_axis"], KF["y_axis"], KF["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def p_stock(rpm, load):
    """ECU-internal fill ratio: kf(load)/kf(100) at this rpm."""
    k100 = kf_lut(rpm, 100.0)
    return kf_lut(rpm, load) / k100 if k100 else None


def load_wot_row(path):
    with open(path) as f:
        d = json.load(f)
    return {float(k): float(v) for k, v in d["ve_by_rpm"].items()}, d


def p_sim_of(row, wot_ve):
    try:
        ve = float(row["ve"])
        w = wot_ve[float(row["rpm"])]
        return ve / w if w else None
    except (KeyError, TypeError, ValueError):
        return None


def fit_meta(csv_path, residual=None):
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE,
                                         stderr=subprocess.DEVNULL).decode().strip()[:12]
    except Exception:
        commit = "unknown"
    exe = os.path.join(os.path.dirname(os.path.dirname(HERE)),
                       "build_ux", "bin", "release", "OpenWAM.exe")
    try:
        st = os.stat(exe)
        exe_sig = f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        exe_sig = "unknown"
    return {"date": datetime.date.today().isoformat(), "commit": commit,
            "exe_sig": exe_sig, "csv": os.path.basename(csv_path),
            "residual": residual}


def run_jobs(jobs, csv_name, cycles=30, conc=None):
    csv_path = os.path.join(OUT, csv_name)
    os.makedirs(OUT, exist_ok=True)
    return asyncio.run(R.run_all(jobs, csv_path, cycles=cycles, conc=conc)), csv_path


def rows_to_pfit(rows, wot_ve, load_of=None):
    out = []
    for r in rows:
        load = float(r["load"])
        ps = p_sim_of(r, wot_ve)
        pk = p_stock(float(r["rpm"]), load_of(r) if load_of else load)
        out.append({"rpm": int(float(r["rpm"])), "load": load,
                    "sigma": (json.loads(r["sets"]).get("intake.eq_tube.icv_sigma")
                              if r.get("sets") else None),
                    "p_sim": ps, "p_stock": pk,
                    "valid": r.get("valid") == "1"})
    return out


# ------------------------------------------------------------------- Step A
def cmd_icv(args):
    wot_ve, _ = load_wot_row(args.wot_json)
    sigmas = [float(s) for s in args.sigmas.split(",")]
    jobs = [{"rpm": r, "load": l, "base": args.base,
             "set": {"intake.eq_tube.icv_sigma": s}, "tag": f"icvA"}
            for r in ICV_RPMS for l in ICV_LOADS for s in sigmas]
    rows, csv_path = run_jobs(jobs, "fit_icv_sweep.csv", cycles=args.cycles)
    pf = rows_to_pfit(rows, wot_ve)
    res = F.fit_icv(pf)
    res["residual"] = F.residual_report(
        [r for r in pf if r["sigma"] == res["sigma"]])
    res["fit_meta"] = fit_meta(csv_path, res["residual"].get("mean_abs_p_err"))
    out = os.path.join(OUT, "fit_icv.json")
    json.dump(res, open(out, "w"), indent=2, default=str)
    print(json.dumps({k: v for k, v in res.items() if k != "residual"},
                     indent=2, default=str))
    print("wrote", out)


# ------------------------------------------------------------------- Step B
def cmd_sigma(args):
    wot_ve, _ = load_wot_row(args.wot_json)
    cal = calib.load(DATA_DIR)
    icv = calib.icv_sigma(cal)
    if icv is None:
        print("WARN: icv.sigma not applied yet -- run `apply --icv` first")

    # geometric sigma at each pedal (probe 1) via the generator's own curve
    from app.models import SimConfig
    from app.simulator.wam_generator import WAMGenerator
    gen = WAMGenerator(SimConfig(), OUT)
    import contextlib, io
    def sigma_geo(pedal):
        with contextlib.redirect_stdout(io.StringIO()):
            ang = gen._calculate_throttle_angle(pedal)
            return gen._get_butterfly_cd(ang)

    evals_by_pedal = {p: [] for p in SIGMA_PEDALS}
    all_rows = []

    def _fold():
        for pedal in SIGMA_PEDALS:
            pr = [r for r in all_rows if abs(float(r["load"]) - pedal * 100.0) < 0.5
                  and r.get("sigma_bp")]
            by_sigma = {}
            for r in pr:
                s = json.loads(r["sigma_bp"])[0][1]
                by_sigma.setdefault(s, []).append(r)
            evs = []
            for s, rs in sorted(by_sigma.items()):
                ps = [p_sim_of(r, wot_ve) for r in rs if r.get("valid") == "1"]
                ps = [p for p in ps if p is not None]
                pk = [p_stock(float(r["rpm"]), pedal * 100.0) for r in rs]
                if not ps:
                    continue
                err = statistics.mean(ps) - statistics.mean(pk)
                evs.append((s, err, len(ps)))
            evals_by_pedal[pedal] = evs

    for it in range(args.max_evals):
        jobs = []
        for pedal in SIGMA_PEDALS:
            evs = evals_by_pedal[pedal]
            if it == 0:
                probes = [sigma_geo(pedal)]
            elif not evs:
                probes = [sigma_geo(pedal)]      # first probe was all-gated; retry
            elif it == 1:
                probes = [min(0.96, max(0.002, evs[0][0] * args.probe2_mult))]
            else:
                nx, done, _ = F.secant_step([(s, e) for s, e, _ in evs], 0.0,
                                            lo=0.002, hi=0.96)
                if done:
                    continue
                probes = [nx]
            for s in probes:
                for rpm in ICV_RPMS:
                    jobs.append({"rpm": rpm, "load": pedal * 100.0,
                                 "sigma_bp": [[0.0, round(s, 5)], [1.0, round(s, 5)]],
                                 "tag": f"sigB-p{int(pedal*100)}"})
        if not jobs:
            break
        rows, csv_path = run_jobs(jobs, "fit_sigma_sweep.csv", cycles=args.cycles)
        all_rows.extend(rows)
        _fold()

    table = F.fit_sigma_bp({p: [(s, e) for s, e, _ in v]
                            for p, v in evals_by_pedal.items()})
    res = {"points": table,
           "evals": {str(p): v for p, v in evals_by_pedal.items()},
           "fit_meta": fit_meta(os.path.join(OUT, "fit_sigma_sweep.csv"))}
    out = os.path.join(OUT, "fit_sigma.json")
    json.dump(res, open(out, "w"), indent=2, default=str)
    print(json.dumps(table, indent=1))
    print("wrote", out)


# ------------------------------------------------------------------- Step C
def cmd_base(args):
    wot_ve, wot_doc = load_wot_row(args.wot_json)
    wot_base = wot_doc.get("base_by_rpm") or {
        str(r): wot_doc.get("base", 150.0) for r in BASE_RPMS}
    wot_base = {float(k): float(v) for k, v in wot_base.items()}
    b0 = statistics.mean(wot_base.values())
    brackets = [round(b0 - 40), round(b0), round(b0 + 40)]

    # pass 1: bracket
    jobs = [{"rpm": r, "load": l, "base": b, "tag": "baseC"}
            for r in BASE_RPMS for l in BASE_LOADS for b in brackets]
    rows, csv_path = run_jobs(jobs, "fit_base_sweep.csv", cycles=args.cycles)

    # pass 2: one secant per cell
    evals = {}
    for r in rows:
        if r.get("valid") != "1":
            continue
        key = (float(r["rpm"]), float(r["load"]))
        ps = p_sim_of(r, wot_ve)
        if ps is None:
            continue
        evals.setdefault(key, []).append((float(r["base"]), ps))
    jobs2 = []
    for (rpm, load), evs in evals.items():
        target = p_stock(rpm, load)
        nx, done, _ = F.secant_step(evs, target, lo=60.0, hi=220.0)
        if not done:
            jobs2.append({"rpm": rpm, "load": load, "base": round(nx, 1),
                          "tag": "baseC2"})
    if jobs2:
        rows2, _ = run_jobs(jobs2, "fit_base_sweep.csv", cycles=args.cycles)
        for r in rows2:
            if r.get("valid") != "1":
                continue
            key = (float(r["rpm"]), float(r["load"]))
            ps = p_sim_of(r, wot_ve)
            if ps is not None:
                evals.setdefault(key, []).append((float(r["base"]), ps))

    solutions = {}
    for (rpm, load), evs in evals.items():
        target = p_stock(rpm, load)
        _, _, best = F.secant_step(evs, target, lo=60.0, hi=220.0)
        solutions[(rpm, load)] = best
    surface = F.fit_base_surface(solutions, BASE_RPMS, BASE_LOADS, wot_base)

    # post-fit re-gate: run every solved cell AT its fitted base; a cell that
    # now collapses (low base can induce it) is dropped and refilled
    regate = [{"rpm": int(r), "load": l,
               "base": surface["values"][surface["loads"].index(l)][surface["rpms"].index(float(r))],
               "tag": "baseC-regate"}
              for l in BASE_LOADS for r in BASE_RPMS]
    rows3, _ = run_jobs(regate, "fit_base_sweep.csv", cycles=args.cycles)
    dropped = []
    for r in rows3:
        if r.get("valid") == "1":
            continue
        key = (float(r["rpm"]), float(r["load"]))
        if key in solutions:
            solutions[key] = None
            dropped.append(key)
    if dropped:
        surface = F.fit_base_surface(solutions, BASE_RPMS, BASE_LOADS, wot_base)

    res = {"surface": surface,
           "solutions": {f"{int(k[0])}/{k[1]}": v for k, v in solutions.items()},
           "regate_dropped": [f"{int(a)}/{b}" for a, b in dropped],
           "fit_meta": fit_meta(csv_path)}
    out = os.path.join(OUT, "fit_base.json")
    json.dump(res, open(out, "w"), indent=2, default=str)
    print(json.dumps(surface, indent=1))
    print("dropped by re-gate:", dropped or "none")
    print("wrote", out)


# ------------------------------------------------------------------- Step D
def cmd_alpha(args):
    wot_ve, _ = load_wot_row(args.wot_json)
    variants = [("off", None), ("a02", 0.2), ("a04", 0.4)]
    jobs = []
    for tag, alpha in variants:
        for l in ALPHA_LOADS:
            for r in BASE_RPMS:
                j = {"rpm": r, "load": l, "tag": f"alphaD-{tag}"}
                if alpha is not None:
                    j["alpha"] = alpha
                jobs.append(j)
    # +/-5 base smoothness probes at 3900/5300 x load 20, per variant
    cal = calib.load(DATA_DIR)
    for tag, alpha in variants:
        for r in (3900, 5300):
            b = calib.exvanos_base_for(cal, r, False, load=20.0)
            for db in (-5.0, 5.0):
                j = {"rpm": r, "load": 20.0, "base": b + db,
                     "tag": f"alphaD-{tag}-perturb"}
                if alpha is not None:
                    j["alpha"] = alpha
                jobs.append(j)
    rows, csv_path = run_jobs(jobs, "fit_alpha_sweep.csv", cycles=args.cycles)

    report = {}
    for tag, alpha in variants:
        vr = [r for r in rows if r["tag"].startswith(f"alphaD-{tag}")
              and "perturb" not in r["tag"]]
        collapses = sum(1 for r in vr if r.get("valid") != "1")
        # LOAD-20 row r vs stock (kf row shape)
        r20 = sorted((float(r["rpm"]), float(r["ve"])) for r in vr
                     if abs(float(r["load"]) - 20.0) < 0.5 and r.get("valid") == "1")
        k20 = [(rpm, kf_lut(rpm, 20.0) * 100.0) for rpm, _ in r20]
        rho = float("nan")
        if len(r20) >= 3:
            xs = [v for _, v in r20]; ys = [v for _, v in k20]
            mx, my = statistics.mean(xs), statistics.mean(ys)
            sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
            sy = math.sqrt(sum((y - my) ** 2 for y in ys))
            if sx and sy:
                rho = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sx / sy
        pert = [r for r in rows if r["tag"] == f"alphaD-{tag}-perturb"
                and r.get("valid") == "1"]
        pv = {}
        for r in pert:
            pv.setdefault(float(r["rpm"]), []).append(float(r["ve"]))
        max_swing = max((abs(max(v) - min(v)) for v in pv.values() if len(v) >= 2),
                        default=float("nan"))
        report[tag] = {"alpha": alpha, "collapses": collapses,
                       "load20_r": (None if math.isnan(rho) else round(rho, 3)),
                       "perturb_max_swing_pp": (None if math.isnan(max_swing)
                                                else round(max_swing, 1))}
    res = {"report": report, "fit_meta": fit_meta(csv_path)}
    out = os.path.join(OUT, "fit_alpha.json")
    json.dump(res, open(out, "w"), indent=2, default=str)
    print(json.dumps(report, indent=2))
    print("wrote", out)
    print("Adoption rule: collapses <= off-variant AND load20_r >= 0.89 AND "
          "smooth perturbation; else keep null (legacy).")


# ------------------------------------------------------------------- Step E
def cmd_recheck(args):
    wot_ve, _ = load_wot_row(args.wot_json)
    jobs = [{"rpm": r, "load": l, "tag": "recheckE"}
            for r in ICV_RPMS for l in ICV_LOADS]
    rows, csv_path = run_jobs(jobs, "fit_recheck.csv", cycles=args.cycles)
    pf = rows_to_pfit(rows, wot_ve)
    rep = F.residual_report(pf)
    out = os.path.join(OUT, "fit_recheck.json")
    json.dump({"residual": rep, "rows": pf, "fit_meta": fit_meta(csv_path)},
              open(out, "w"), indent=2, default=str)
    print(json.dumps(rep, indent=2, default=str))
    thr = 0.05
    bad = [r for r in pf if r["valid"] and r["p_sim"] is not None
           and abs(r["p_sim"] - r["p_stock"]) > thr]
    print(f"{len(bad)} cells with |p err| > {thr} -> "
          f"{'re-adjust ICV ONCE (rerun icv with current calibration), then stop' if bad else 'done; no ICV re-adjust needed'}")


# -------------------------------------------------------------------- apply
def cmd_apply(args):
    cal_path = os.environ.get("CSL_CALIBRATION_PATH") or os.path.join(DATA_DIR, "calibration.json")
    cal = calib.load(DATA_DIR)
    kw = {}
    meta = None
    if args.icv:
        d = json.load(open(args.icv))
        kw["icv_sigma"] = d["sigma"]
        kw["icv_meta"] = d.get("fit_meta")
        meta = d.get("fit_meta")
    if args.sigma:
        d = json.load(open(args.sigma))
        kw["sigma_points"] = d["points"]
        kw["sigma_meta"] = d.get("fit_meta")
        meta = d.get("fit_meta")
    if args.surface:
        d = json.load(open(args.surface))
        kw["surface"] = d["surface"]
        meta = d.get("fit_meta")
    if args.alpha is not None:
        kw["part_load_alpha"] = None if args.alpha == "off" else float(args.alpha)
    new = F.apply_fits(cal, fit_meta=meta, **kw)
    tmp = cal_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(new, f, indent=2)
    os.replace(tmp, cal_path)
    calib.reload()
    print("applied ->", cal_path, "changes:", sorted(kw.keys()))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    common = dict(cycles=30)

    p = sub.add_parser("icv")
    p.add_argument("--wot-json", default=os.path.join(OUT, "phase3_wot_row.json"))
    p.add_argument("--sigmas", default="0.05,0.10,0.20,0.40")
    p.add_argument("--base", type=float, default=150.0)
    p.add_argument("--cycles", type=int, default=60)
    p.set_defaults(fn=cmd_icv)

    p = sub.add_parser("sigma")
    p.add_argument("--wot-json", default=os.path.join(OUT, "phase3_wot_row.json"))
    p.add_argument("--max-evals", type=int, default=3)
    p.add_argument("--probe2-mult", type=float, default=3.0)
    p.add_argument("--cycles", type=int, default=60)
    p.set_defaults(fn=cmd_sigma)

    p = sub.add_parser("base")
    p.add_argument("--wot-json", default=os.path.join(OUT, "phase3_wot_row.json"))
    p.add_argument("--cycles", type=int, default=60)
    p.set_defaults(fn=cmd_base)

    p = sub.add_parser("alpha")
    p.add_argument("--wot-json", default=os.path.join(OUT, "phase3_wot_row.json"))
    p.add_argument("--cycles", type=int, default=60)
    p.set_defaults(fn=cmd_alpha)

    p = sub.add_parser("recheck")
    p.add_argument("--wot-json", default=os.path.join(OUT, "phase3_wot_row.json"))
    p.add_argument("--cycles", type=int, default=60)
    p.set_defaults(fn=cmd_recheck)

    p = sub.add_parser("apply")
    p.add_argument("--icv")
    p.add_argument("--sigma")
    p.add_argument("--surface")
    p.add_argument("--alpha", default=None, help="value or 'off'")
    p.set_defaults(fn=cmd_apply)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

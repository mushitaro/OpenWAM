#!/usr/bin/env python3
"""Local cell runner for the partial-load calibration plan (Phases 0/2/3/4).

Runs arbitrary (rpm, load) cells through the SAME path as the app's
run_ve_map_generation.run_point: identical SimConfig -> WAMGenerator deck,
identical solver env (SimulationService._build_sim_env: omp1 + HLLC + THR_CHOKE
+ VEDIAG + FAST_OUTPUT + WOT mouth-rad), identical slope early-stop and the
SAME deck cache keys -- cells run here are instant cache hits for the app
later (and vice versa).

Cells are cell-parallel at omp1 (Stage 56: omp>1 is non-deterministic at WOT).
Results append to a CSV after every cell; finished job-ids are skipped, so the
sweep is resumable.

Examples:
  python run_cells_local.py --csv out.csv --rpms 5300 --loads 20,45,65
  python run_cells_local.py --csv out.csv --rpms 2700,6900 --loads 20,100 \
      --set intake.eq_tube.model=rail --tag rail
  python run_cells_local.py --csv out.csv --jobs-json jobs.json
      # jobs.json: [{"rpm":5300,"load":20,"base":135,"alpha":0.2,
      #              "set":{"intake.eq_tube.icv_sigma":0.1},"tag":"icv0.1"}]
"""
import argparse
import asyncio
import contextlib
import csv
import hashlib
import io
import json
import math
import os
import re
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.models import SimConfig  # noqa: E402
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.output_parser import OpenWAMOutputParser  # noqa: E402
from app.simulator.simulation_service import SimulationService  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)  # CSL_Simulator (deck cwd; cache = repo/.sim_cache)

MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))


def _lut(m, rpm, load):
    rx, ly, v = m["x_axis"], m["y_axis"], m["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def stock_target(rpm, load):
    """Stock VE%: WOT row = measured wideband (stock_csl_ve.json), part load =
    the ECU fill-target map kf_rf_soll (CSL VE data provenance)."""
    if load >= M.WOT_TPS:
        stock = M.load_stock_wot(DATA_DIR)
        return M.stock_on_axis([rpm], stock)[0]
    return _lut(MAPS["kf_rf_soll"], rpm, load) * 100.0


def _apply_set(cfg, dotted, value):
    obj = cfg
    keys = dotted.split(".")
    for k in keys[:-1]:
        obj = getattr(obj, k)
    cur = getattr(obj, keys[-1])
    if isinstance(value, str):
        if isinstance(cur, bool):
            value = value.lower() in ("1", "true", "yes")
        elif isinstance(cur, (int, float)) and cur is not None:
            value = type(cur)(float(value))
    setattr(obj, keys[-1], value)


def build_config(job, cycles):
    cfg = SimConfig()
    cfg.engine.rpm = float(job["rpm"])
    cfg.engine.throttle_position = float(job["load"]) / 100.0
    cfg.simulation.duration_cycles = cycles
    cfg.exhaust.port_junction_vol = 0.0
    for dotted, val in (job.get("set") or {}).items():
        _apply_set(cfg, dotted, val)
    return cfg


def job_id(job):
    """Stable resume key over the semantically-relevant job fields."""
    key = {k: job.get(k) for k in
           ("rpm", "load", "base", "alpha", "again", "sigma_bp", "tag")}
    key["set"] = dict(sorted((job.get("set") or {}).items()))
    return hashlib.sha1(json.dumps(key, sort_keys=True).encode()).hexdigest()[:12]


CSV_COLS = ["id", "tag", "rpm", "load", "base", "alpha", "again", "sigma_bp",
            "sets", "ve", "stock", "ratio", "cyc", "slope", "converged",
            "cyl_ok", "spread", "collapsed_n", "nan_free", "blew_up", "valid",
            "elapsed_s"]


def done_ids(path):
    d = set()
    if os.path.exists(path):
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                d.add(row.get("id"))
    return d


async def run_job(svc, cal, sem, job, args, writer_lock, csv_path):
    async with sem:
        t0 = time.time()
        rpm, load = float(job["rpm"]), float(job["load"])
        is_wot = load >= M.WOT_TPS
        cycles = int(job.get("cycles", args.cycles))
        cfg = build_config(job, cycles)

        # --- VANOS coordination (identical to run_ve_map_generation) --------
        intake_base = calib.intake_vanos_base(cal)
        ex_scale = calib.exvanos_scale(cal)
        intake_cam = _lut(MAPS["kf_evan1_soll"], rpm, load)
        exhaust_cam = _lut(MAPS["kf_avan1_soll"], rpm, load)
        cfg.engine.vanos_intake_bias = float(intake_base - intake_cam)
        base = job.get("base")
        if base is None:
            base = calib.exvanos_base_for(cal, rpm, is_wot)
        cfg.engine.vanos_exhaust_bias = float((float(base) - exhaust_cam) * ex_scale)

        # --- deck ------------------------------------------------------------
        sub = f"cells_{job_id(job)}_{int(rpm)}_{int(load)}"
        wam_path = os.path.join(SIM_DIR, sub + ".wam")
        log_path = os.path.join(SIM_DIR, sub + ".log")
        gen = WAMGenerator(cfg, SIM_DIR)
        if job.get("sigma_bp"):
            # post-Phase-1 instance attribute (calibrated sigma(pedal) table)
            gen._sigma_bp = job["sigma_bp"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            content = gen.generate(ignition_timing=20.0) if is_wot else gen.generate()
        with open(wam_path, "w") as f:
            f.write(content)

        env = svc._build_sim_env(cal, is_wot, fast=True)
        if job.get("alpha") is not None:
            env["OPENWAM_MOUTH_RAD"] = str(job["alpha"])
            env["OPENWAM_MOUTH_RAD_W"] = env.get("OPENWAM_MOUTH_RAD_W", "0.005")
        if job.get("alpha") == "off":
            env.pop("OPENWAM_MOUTH_RAD", None)
            env.pop("OPENWAM_MOUTH_RAD_W", None)
        if job.get("again") is not None:
            env["OPENWAM_THR_AGAIN"] = str(job["again"])

        m_ref = (math.pi * ((cfg.engine.geometry.bore / 20.0) ** 2)
                 * (cfg.engine.geometry.stroke / 10.0)
                 * (cfg.environment.ambient_pressure
                    / (287.058 * cfg.environment.ambient_temp)))
        svc._m_ref_mg = m_ref

        output = ""
        try:
            output = await svc._run_solver(
                svc._resolve_exe(), sub + ".wam", SIM_DIR, env, log_path, content,
                timeout=args.timeout)
        finally:
            base_p = os.path.join(SIM_DIR, sub)
            for p in (wam_path, log_path, base_p + "AVG.DAT", base_p + "INS.DAT"):
                try:
                    os.remove(p)
                except OSError:
                    pass

        # --- VE + health (identical to run_point) ----------------------------
        mtrap = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", output)]
        ncyc = len(mtrap) // 6
        cyc_ve = [sum(mtrap[c * 6:(c + 1) * 6]) / 6.0 * 1000.0 / m_ref * 100.0
                  for c in range(ncyc)]
        ve = cyc_ve[-1] if cyc_ve else 0.0
        mass_g = (sum(mtrap[(ncyc - 1) * 6:ncyc * 6]) / 6.0) if ncyc else 0.0
        if ncyc >= 5:
            slope = (cyc_ve[-1] - cyc_ve[-5]) / 4.0
            converged = abs(slope) < M.SLOPE_TOL
        else:
            slope, converged = None, False
        blew_up = bool(cyc_ve and max(cyc_ve[-3:]) > M.VE_BLOWUP) or ve > M.VE_BLOWUP
        cb = OpenWAMOutputParser.cylinder_balance(output, tol=0.20, n_cyl=6)
        cyl_spread, ve_cyl = cb.get("spread"), cb.get("ve_cyl")
        collapsed_n, cyl_ok = None, True
        if ve_cyl:
            med = statistics.median(ve_cyl)
            collapsed_n = sum(1 for x in ve_cyl if med > 0 and x < 0.5 * med)
            cyl_ok = collapsed_n == 0
        nan_free = ("nan" not in output.lower()) and math.isfinite(mass_g) and mass_g > 0
        ve_in_band = M.VE_BAND[0] <= ve <= M.VE_BAND[1]
        valid = bool(converged and cyl_ok and ve_in_band and nan_free and not blew_up)

        stock = stock_target(rpm, load)
        ratio = (ve / stock) if stock else float("nan")
        row = {
            "id": job_id(job), "tag": job.get("tag", ""),
            "rpm": int(rpm), "load": load, "base": round(float(base), 2),
            "alpha": job.get("alpha", ""), "again": job.get("again", ""),
            "sigma_bp": json.dumps(job["sigma_bp"]) if job.get("sigma_bp") else "",
            "sets": json.dumps(job.get("set") or {}, sort_keys=True),
            "ve": round(ve, 2), "stock": round(stock, 2) if stock else "",
            "ratio": round(ratio, 4) if stock else "",
            "cyc": ncyc, "slope": (round(slope, 4) if slope is not None else ""),
            "converged": int(converged), "cyl_ok": int(cyl_ok),
            "spread": (round(cyl_spread, 4) if isinstance(cyl_spread, float)
                       and not math.isnan(cyl_spread) else ""),
            "collapsed_n": (collapsed_n if collapsed_n is not None else ""),
            "nan_free": int(nan_free), "blew_up": int(blew_up), "valid": int(valid),
            "elapsed_s": round(time.time() - t0, 1),
        }
        async with writer_lock:
            new = not os.path.exists(csv_path)
            with open(csv_path, "a", newline="") as f:
                w = csv.DictWriter(f, fieldnames=CSV_COLS)
                if new:
                    w.writeheader()
                w.writerow(row)
        print(f"  {job.get('tag','')} {int(rpm)}/{int(load)} base{base} "
              f"-> ve {ve:.1f} (stock {stock:.1f}, p {ratio:.3f}) "
              f"{'OK' if valid else 'FLAG'} cyc{ncyc} {row['elapsed_s']}s", flush=True)
        return row


def parse_jobs(args):
    jobs = []
    if args.jobs_json:
        with open(args.jobs_json) as f:
            jobs = json.load(f)
    else:
        rpms = [float(x) for x in args.rpms.split(",") if x.strip()]
        loads = [float(x) for x in args.loads.split(",") if x.strip()]
        bases = ([float(x) for x in args.bases.split(",")] if args.bases else [None])
        for r in rpms:
            for l in loads:
                for b in bases:
                    jobs.append({"rpm": r, "load": l, "base": b})
    g_set = {}
    for s in args.set or []:
        k, _, v = s.partition("=")
        g_set[k] = v
    for j in jobs:
        if g_set:
            j["set"] = {**g_set, **(j.get("set") or {})}
        if args.tag and not j.get("tag"):
            j["tag"] = args.tag
        if args.alpha is not None and j.get("alpha") is None:
            j["alpha"] = args.alpha
        if args.again is not None and j.get("again") is None:
            j["again"] = args.again
    return jobs


async def amain(args):
    os.environ["OPENWAM_FAST_OUTPUT"] = "1"   # deck-side (matches the app Run path)
    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    cal = calib.load(DATA_DIR)
    jobs = parse_jobs(args)
    done = done_ids(args.csv)
    todo = [j for j in jobs if job_id(j) not in done]
    print(f"# {len(jobs)} jobs, {len(jobs)-len(todo)} done, {len(todo)} to run "
          f"(conc={args.conc}, cycles={args.cycles})", flush=True)
    sem = asyncio.Semaphore(args.conc)
    lock = asyncio.Lock()
    tasks = [asyncio.create_task(run_job(svc, cal, sem, j, args, lock, args.csv))
             for j in todo]
    for t in asyncio.as_completed(tasks):
        await t
    print("# sweep complete")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--rpms", default="5300")
    ap.add_argument("--loads", default="100")
    ap.add_argument("--bases", default=None, help="comma list; default=calibration")
    ap.add_argument("--jobs-json", default=None)
    ap.add_argument("--set", action="append", default=[],
                    help="dotted SimConfig override, e.g. intake.eq_tube.model=rail")
    ap.add_argument("--alpha", default=None,
                    help="OPENWAM_MOUTH_RAD for ALL cells ('off' disables)")
    ap.add_argument("--again", type=float, default=None)
    ap.add_argument("--tag", default="")
    ap.add_argument("--cycles", type=int, default=30)
    ap.add_argument("--conc", type=int, default=max(1, min(12, (os.cpu_count() or 8) - 1)))
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()

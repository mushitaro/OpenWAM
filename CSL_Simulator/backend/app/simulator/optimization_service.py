"""M4 VANOS optimizer (UX_APP_DEV_SPEC §7).

Optimizes the PHYSICAL cam targets (the KF_EVAN1_SOLL / KF_AVAN1_SOLL table
values, in degrees) per WOT rpm cell -- NOT the EXVANOS_BASE scaffold (§4.C):
the calibration mapping cam -> bias is held fixed and the search moves the cam
value the ECU would command, so the export round-trips into the ECU tables.

Non-negotiables honoured (§3):
- every evaluation is a REAL omp1 sim through SimulationService._run_solver
  (deterministic, deck-cached, slope early-stop, orphan-safe kill);
- objective is HEALTH-GATED: a candidate only counts if converged, cylinder-
  balanced, NaN-free, in-band and not blown up;
- "surrogate proposes, sim disposes" is trivially satisfied in M4 v1 because
  there is no surrogate yet -- every point IS a sim;
- the deck cache makes re-runs RESUMABLE: a killed/repeated optimization
  replays finished evaluations instantly.

Preferences (§6.C/§7):
- MAX_VE  : per-rpm coordinate descent maximizing gated VE.
- SMOOTH  : selection pass over the SAME evaluated set -- fit a linear
  VE-vs-rpm target through the per-rpm achievable maxima, then pick per rpm the
  valid candidate closest to that line (v1: selection-based smooth; no extra sims).

Far-from-stock recommendations are flagged low-confidence while the EXVANOS
scaffold is in play (§4.C): |opt - stock| > LOW_CONF_DELTA_DEG on either cam.
"""
import os
import re
import json
import math
import time
import uuid
import asyncio
import datetime
import hashlib
import statistics

from . import calibration_constants as calib
from . import metrics as M
from .output_parser import OpenWAMOutputParser
from ..store import get_run_store, extract_geometry

APP_VERSION = "csl-ux-app/m4"
LOW_CONF_DELTA_DEG = 15.0     # §4.C: far-from-stock => low confidence
VE_IMPROVE_EPS = 0.05         # pp; smaller gains than this don't count as "better"


class OptimizationService:
    def __init__(self, data_dir, simulator_dir, sim_service=None):
        self.data_dir = data_dir
        self.simulator_dir = simulator_dir
        if sim_service is None:                 # standalone fallback (tests)
            from .simulation_service import SimulationService
            sim_service = SimulationService(data_dir, simulator_dir)
        self.svc = sim_service

    # ------------------------------------------------------------------ maps
    def _load_maps(self):
        with open(os.path.join(self.data_dir, "csl_ecu_maps.json"), "r") as f:
            return json.load(f)

    @staticmethod
    def _wot_row_index(y_axis):
        return min(range(len(y_axis)), key=lambda i: abs(y_axis[i] - 100.0))

    @staticmethod
    def _stock_cam(table, rpm, load_tps=100.0):
        """Nearest-breakpoint lookup -- EXACTLY the Run path's lookup so the
        stock-cam baseline deck is byte-identical to the map run's WOT cell
        (=> baseline evaluations are deck-cache HITS, not new sims)."""
        xs, ys, vals = table["x_axis"], table["y_axis"], table["values"]
        xi = min(range(len(xs)), key=lambda i: abs(xs[i] - rpm))
        yi = min(range(len(ys)), key=lambda i: abs(ys[i] - load_tps))
        return float(vals[yi][xi])

    # ------------------------------------------------------------- evaluation
    async def _eval_cell(self, config, cal, exe, maps, run_id, store, meta,
                         rpm, cam_in, cam_ex, sem, counters):
        """One health-gated WOT evaluation at explicit cam targets.

        Mirrors run_ve_map_generation.run_point (deck, env, VE parse, gates)
        but with EXPLICIT cams instead of the table lookup."""
        async with sem:
            point_config = config.model_copy(deep=True)
            point_config.engine.rpm = float(rpm)
            point_config.engine.throttle_position = 1.0          # WOT
            intake_base = calib.intake_vanos_base(cal)
            ex_scale = calib.exvanos_scale(cal)
            env_b = os.environ.get("OPENWAM_EXVANOS_BASE")
            ex_base = float(env_b) if env_b else calib.exvanos_base_for(cal, rpm, True)
            scale = float(os.environ.get("OPENWAM_EXVANOS_SCALE", str(ex_scale)))
            point_config.engine.vanos_intake_bias = float(intake_base - cam_in)
            point_config.engine.vanos_exhaust_bias = float((ex_base - cam_ex) * scale)

            from .wam_generator import WAMGenerator
            gen = WAMGenerator(point_config, self.simulator_dir)
            # deck-side FAST_OUTPUT via the instance override -- deterministic,
            # independent of os.environ state, and byte-identical to the map
            # run's deck (which sets the env var before generating).
            gen._fast_output_override = True
            content = gen.generate(ignition_timing=20.0)          # WOT recipe

            sub = f"ve_opt_{run_id}_{int(rpm)}_{int(cam_in)}_{int(cam_ex)}"
            wam_path = os.path.join(self.simulator_dir, sub + ".wam")
            log_path = os.path.join(self.simulator_dir, sub + ".log")
            with open(wam_path, "w") as f:
                f.write(content)
            sim_env = self.svc._build_sim_env(cal, is_wot=True, fast=True)

            output = ""
            try:
                output = await self.svc._run_solver(
                    exe, sub + ".wam", self.simulator_dir, sim_env, log_path, content)
            finally:
                _base = os.path.join(self.simulator_dir, sub)
                for p in (wam_path, log_path, _base + "AVG.DAT", _base + "INS.DAT"):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

            # --- VE + gates (verbatim logic from run_point) -----------------
            m_ref_mg = meta["m_ref_mg"]
            mtrap = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", output)]
            ncyc = len(mtrap) // 6
            cyc_ve = [sum(mtrap[c * 6:(c + 1) * 6]) / 6.0 * 1000.0 / m_ref_mg * 100.0
                      for c in range(ncyc)]
            if cyc_ve:
                ve = cyc_ve[-1]
                mass_g = sum(mtrap[(ncyc - 1) * 6:ncyc * 6]) / 6.0
            else:
                tm = re.findall(r"Trapped mass:\s+([0-9.]+)\s+\(g\)", output)
                mass_g = float(tm[-1]) if tm else 0.0
                ve = (mass_g * 1000.0 / m_ref_mg) * 100.0 if m_ref_mg > 0 else 0.0

            if ncyc >= 5:
                slope = (cyc_ve[-1] - cyc_ve[-5]) / 4.0
                converged = abs(slope) < M.SLOPE_TOL
            else:
                slope, converged = None, False
            blew_up = bool(cyc_ve and max(cyc_ve[-3:]) > M.VE_BLOWUP) or ve > M.VE_BLOWUP

            cylinders = getattr(point_config.engine, "cylinders", 6)
            cb = OpenWAMOutputParser.cylinder_balance(output, tol=0.20, n_cyl=cylinders)
            cyl_ok = True
            ve_cyl = cb.get("ve_cyl")
            if ve_cyl:
                med = statistics.median(ve_cyl)
                cyl_ok = sum(1 for x in ve_cyl if med > 0 and x < 0.5 * med) == 0

            # Stage 58: was the strict "any NaN anywhere" test, which the
            # measured geometry's recoverable startup BC-NaN burst fails on
            # EVERY cell -- use the shared persistent-only gate instead.
            nan_free = (not M.nan_persistent(output)) and math.isfinite(mass_g) and mass_g > 0
            ve_in_band = M.VE_BAND[0] <= ve <= M.VE_BAND[1]
            valid = bool(converged and cyl_ok and ve_in_band and nan_free and not blew_up)

            rec = {
                "rpm": rpm, "intake_cam": float(cam_in), "exhaust_cam": float(cam_ex),
                "ve": round(ve, 2), "valid": valid,
                "health": {"converged": bool(converged),
                           "slope": (None if slope is None else round(slope, 4)),
                           "cyc": ncyc, "cyl_ok": bool(cyl_ok),
                           "nan_free": bool(nan_free), "ve_in_band": bool(ve_in_band),
                           "blew_up": bool(blew_up)},
            }

            # --- Phase-A instrumentation (§11): every optimizer eval --------
            try:
                store.append({
                    "schema_version": 1,
                    "sim_binary_sig": meta["sim_sig"],
                    "sim_code_commit": meta["code_commit"],
                    "calib": {"alpha": calib.mouth_rad(cal)[0],
                              "w": calib.mouth_rad(cal)[1],
                              "thr_choke": cal.get("thr_choke", 1)},
                    "geometry": meta["geometry"],
                    "op": {"rpm": rpm, "load_tps": 100.0},
                    "vanos": {"intake_cam_deg": float(cam_in),
                              "exhaust_cam_deg": float(cam_ex),
                              "intake_bias_deg": point_config.engine.vanos_intake_bias,
                              "exhaust_bias_deg": point_config.engine.vanos_exhaust_bias,
                              "overlap_deg": None},
                    "sim": {"ve": round(ve, 3),
                            "ve_healthy": (round(ve, 3) if valid else None),
                            "cyl_collapsed_n": None,
                            "converged": bool(converged),
                            "slope": rec["health"]["slope"], "cyc": ncyc,
                            "blew_up": bool(blew_up)},
                    "measured": None,
                    "meta": {"user_hash": "local", "engine_hash": meta["engine_hash"],
                             "ts": datetime.datetime.now().isoformat(timespec="seconds"),
                             "app_version": APP_VERSION, "run_id": run_id,
                             "kind": "optimizer_eval"},
                })
            except Exception as e:
                print(f"WARN: RunStore append failed: {e}")

            # --- progress ----------------------------------------------------
            counters["done"] += 1
            elapsed = time.time() - counters["t0"]
            est_total = counters["est_total"]
            eta = int((elapsed / counters["done"]) * max(0, est_total - counters["done"]))
            try:
                from ..log_manager import log_manager
                await log_manager.broadcast(
                    f"OPT {counters['done']}/{est_total} rpm={int(rpm)} "
                    f"cam={int(cam_in)}/{int(cam_ex)} ve={ve:.1f} "
                    f"{'OK' if valid else 'FLAG'} eta={eta}s")
            except Exception:
                pass
            return rec

    # ---------------------------------------------------------------- search
    async def _optimize_rpm(self, config, cal, exe, maps, run_id, store, meta,
                            rpm, stock_in, stock_ex, bounds_in, bounds_ex,
                            budget, sem, counters):
        """Per-rpm coordinate descent over (intake_cam, exhaust_cam), int steps."""
        evals = {}

        async def ev(ci, ce):
            ci = int(max(bounds_in[0], min(bounds_in[1], ci)))
            ce = int(max(bounds_ex[0], min(bounds_ex[1], ce)))
            key = (ci, ce)
            if key in evals:
                return evals[key]
            rec = await self._eval_cell(config, cal, exe, maps, run_id, store, meta,
                                        rpm, ci, ce, sem, counters)
            evals[key] = rec
            return rec

        baseline = await ev(int(stock_in), int(stock_ex))
        best = baseline if baseline["valid"] else None
        cur = (int(stock_in), int(stock_ex))

        for step in (8, 4, 2):
            improved = True
            while improved and len(evals) < budget:
                improved = False
                for di, de in ((step, 0), (-step, 0), (0, step), (0, -step)):
                    if len(evals) >= budget:
                        break
                    rec = await ev(cur[0] + di, cur[1] + de)
                    if rec["valid"] and (best is None or rec["ve"] > best["ve"] + VE_IMPROVE_EPS):
                        best = rec
                        cur = (int(rec["intake_cam"]), int(rec["exhaust_cam"]))
                        improved = True

        return {"rpm": rpm, "baseline": baseline, "best": best,
                "evals": list(evals.values())}

    # ------------------------------------------------------------------- run
    async def optimize_wot(self, config, preference="max_ve", rpms=None, budget=16):
        """WOT-row VANOS optimization -> per-rpm cams + exportable ECU tables."""
        t0 = time.time()
        cal = calib.load(self.data_dir)
        maps = self._load_maps()
        store = get_run_store(self.data_dir)
        run_id = uuid.uuid4().hex[:12]
        exe = self.svc._resolve_exe()

        van_in = maps["kf_evan1_soll"]
        van_ex = maps["kf_avan1_soll"]
        # mechanical envelope = the range the stock ECU commands anywhere in the
        # table (never propose outside what the VANOS hardware is mapped for).
        flat_in = [v for row in van_in["values"] for v in row]
        flat_ex = [v for row in van_ex["values"] for v in row]
        bounds_in = (min(flat_in), max(flat_in))
        bounds_ex = (min(flat_ex), max(flat_ex))

        rpm_axis = [float(r) for r in maps.get("kf_rf_soll", {}).get("x_axis", [])]
        if not rpm_axis:
            rpm_axis = [float(x) for x in van_in["x_axis"]]
        wanted = rpm_axis
        if rpms:
            # STRICT subset matching: an explicit-but-unmatched rpm must be a
            # 400, never a silent fallback to the full 20-rpm (hour-long) run.
            if not all(math.isfinite(float(x)) for x in rpms):
                raise ValueError("rpms must be finite numbers")
            want = {int(float(x)) for x in rpms}
            wanted = [r for r in rpm_axis if int(r) in want]
            missed = sorted(want - {int(r) for r in wanted})
            if missed:
                raise ValueError(
                    f"rpms {missed} are not on the sim rpm axis; valid values: "
                    f"{[int(r) for r in rpm_axis]}")

        # per-cylinder VE=100% reference mass (same formula as the Run path)
        geo0 = config.engine.geometry
        rho0 = config.environment.ambient_pressure / (287.058 * config.environment.ambient_temp)
        m_ref_mg = math.pi * ((geo0.bore / 20.0) ** 2) * (geo0.stroke / 10.0) * rho0
        # keep _run_solver's slope early-stop on the right VE scale for this
        # geometry (same assignment the map Run makes).
        self.svc._m_ref_mg = m_ref_mg

        geometry = extract_geometry(config)
        meta = {
            "m_ref_mg": m_ref_mg,
            "sim_sig": self.svc._sim_binary_sig(),
            "code_commit": self.svc._sim_code_commit(),
            "geometry": geometry,
            "engine_hash": hashlib.sha1(
                json.dumps(geometry, sort_keys=True, default=str).encode()).hexdigest()[:12],
        }

        conc = max(1, min(12, (os.cpu_count() or 8) - 1))
        sem = asyncio.Semaphore(conc)
        counters = {"done": 0, "t0": t0, "est_total": budget * len(wanted)}

        epoch = self.svc._cancel_epoch      # user-cancel classification datum
        tasks = []
        for rpm in wanted:
            s_in = self._stock_cam(van_in, rpm)
            s_ex = self._stock_cam(van_ex, rpm)
            tasks.append(asyncio.create_task(
                self._optimize_rpm(config, cal, exe, maps, run_id, store,
                                   meta, rpm, s_in, s_ex,
                                   bounds_in, bounds_ex, budget, sem, counters)))
        # register for /simulate/cancel; with return_exceptions=True a cancel
        # surfaces as per-rpm CancelledError entries -> the finished rows are
        # KEPT and persisted (cancellation = partial result, not data loss).
        self.svc._register_tasks(tasks)
        try:
            # one sick rpm must not throw away every other row's hours of sims
            raw = await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            self.svc._unregister_tasks(tasks)
        rows, failed_rpms = [], []
        for rpm, r in zip(wanted, raw):
            if isinstance(r, BaseException):
                print(f"WARN: optimization at rpm {rpm} failed: {r}")
                failed_rpms.append(rpm)
            else:
                rows.append(r)
        if not rows:
            if self.svc._cancel_epoch != epoch:
                raise RuntimeError(
                    "tuning cancelled — completed evaluations are cached; re-run to resume")
            raise RuntimeError(f"all rpm cells failed (first error: {raw[0]!r})")
        rows.sort(key=lambda r: r["rpm"])

        # ---- SMOOTH selection over the evaluated set (v1) -------------------
        pts = [(r["rpm"], r["best"]["ve"]) for r in rows if r["best"]]
        a = b = None
        if len(pts) >= 2:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            den = sum((x - mx) ** 2 for x in xs)
            b = (sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den) if den else 0.0
            a = my - b * mx

        cells = []
        for r in rows:
            rpm = r["rpm"]
            baseline, best = r["baseline"], r["best"]
            smooth = None
            if a is not None:
                target = a + b * rpm
                valid_evals = [e for e in r["evals"] if e["valid"]]
                if valid_evals:
                    smooth = min(valid_evals,
                                 key=lambda e: (abs(e["ve"] - target), -e["ve"]))
            chosen = (smooth if preference == "smooth" and smooth else best) or baseline
            far = (abs(chosen["intake_cam"] - baseline["intake_cam"]) > LOW_CONF_DELTA_DEG
                   or abs(chosen["exhaust_cam"] - baseline["exhaust_cam"]) > LOW_CONF_DELTA_DEG)
            confidence = "low" if (far or not baseline["valid"]) else "ok"
            cells.append({
                "rpm": rpm,
                "stock": baseline,
                "best": best,
                "smooth": smooth,
                "chosen": chosen,
                "delta_ve": (round(chosen["ve"] - baseline["ve"], 2)
                             if baseline.get("ve") is not None else None),
                "n_evals": len(r["evals"]),
                "confidence": confidence,
            })

        # ---- export tables: stock tables with the WOT row replaced ---------
        opt_rpms = [c["rpm"] for c in cells]
        opt_in = [c["chosen"]["intake_cam"] for c in cells]
        opt_ex = [c["chosen"]["exhaust_cam"] for c in cells]

        def build_table(src, opt_vals, bounds):
            """Write the optimized cams into the WOT row by NEAREST-IMAGE
            assignment (mirrors the ECU/sim nearest-breakpoint READ):

            column j is replaced ONLY if it is the nearest breakpoint to some
            optimized rpm, and it receives that rpm's chosen cam VERBATIM.
            Columns not backed by a nearby simulated cell keep stock -- no
            interpolation, so a sparse subset run can never smear unsimulated
            columns, and a single-rpm run lands exactly on the column the
            ECU's nearest-lookup reads at that rpm."""
            t = {"x_axis": list(src["x_axis"]), "y_axis": list(src["y_axis"]),
                 "values": [list(row) for row in src["values"]]}
            wi = self._wot_row_index(t["y_axis"])
            xs = [float(x) for x in t["x_axis"]]
            assign = {}                       # column j -> (|x_j - rpm|, cam)
            for r, cam in zip(opt_rpms, opt_vals):
                j = min(range(len(xs)), key=lambda k: abs(xs[k] - r))
                d = abs(xs[j] - r)
                if j not in assign or d < assign[j][0]:
                    assign[j] = (d, cam)
            row = list(t["values"][wi])
            for j, (_d, cam) in assign.items():
                row[j] = int(round(max(bounds[0], min(bounds[1], cam))))
            t["values"][wi] = row
            t["wot_row_index"] = wi
            return t

        tables = {
            "intake": {"name": "KF_EVAN1_SOLL", "unit": "deg",
                       **build_table(van_in, opt_in, bounds_in)},
            "exhaust": {"name": "KF_AVAN1_SOLL", "unit": "deg",
                        **build_table(van_ex, opt_ex, bounds_ex)},
        }

        stock = M.load_stock_wot(self.data_dir)
        stock_curve = [{"rpm": r, "ve": round(v, 2)}
                       for r, v in zip(opt_rpms, M.stock_on_axis(opt_rpms, stock))
                       if v is not None]

        result = {
            "schema_version": 1,
            "mode": "optimization",
            "run_id": run_id,
            "sim_binary_sig": meta["sim_sig"],
            "preference": preference,
            "budget": budget,
            "bounds": {"intake": bounds_in, "exhaust": bounds_ex},
            "cells": cells,
            "tables": tables,
            "stock_curve": stock_curve,
            "n_evals_total": counters["done"],
            "failed_rpms": failed_rpms,
            "low_confidence_note": (
                "EXVANOS_BASE scaffold is in play (§4.C, calibration in flux §10): "
                "recommendations far from the stock cam point are low-confidence "
                "until the real-geometry re-fit."),
            "status": ("cancelled_partial" if (failed_rpms and self.svc._cancel_epoch != epoch)
                       else "partial" if failed_rpms else "success"),
            "elapsed_sec": round(time.time() - t0, 1),
        }
        # persist -- an optimization is long; survive a lost HTTP response.
        # tmp + os.replace so a concurrent GET /simulate/last never reads a
        # truncated file.
        try:
            path = os.path.join(self.data_dir, "last_run_optimization.json")
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(result, f)
            os.replace(tmp, path)
        except OSError:
            pass
        return result

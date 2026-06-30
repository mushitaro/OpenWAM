import os
import asyncio
import math
import re
import json
import time
import uuid
import shutil
import hashlib
import datetime
import subprocess
import statistics

from . import calibration_constants as calib
from . import metrics as M
from .output_parser import OpenWAMOutputParser
from ..store import get_run_store, extract_geometry

APP_VERSION = "csl-ux-app/m1"

# Env vars that change the SOLVER result -> part of the deck-cache key. THR_GAMMA
# and RUNNER_SC are deliberately EXCLUDED: they are now SimConfig fields baked into
# the deck (throttle angle / runner lengths), so the deck content already captures
# them -- keeping them here (env-driven) would both shadow the config and double-key.
_RESULT_ENV = ["OPENWAM_HLLC", "OPENWAM_THR_CHOKE", "OPENWAM_THR_AGAIN",
               "OPENWAM_MOUTH_RAD", "OPENWAM_MOUTH_RAD_W", "OPENWAM_VEDIAG", "OPENWAM_K_CEIL",
               "OPENWAM_FAST_OUTPUT"]


class SimulationService:
    def __init__(self, data_dir, simulator_dir):
        self.data_dir = data_dir
        self.simulator_dir = simulator_dir
        # repo root = one level above CSL_Simulator (the worktree root)
        self.repo_root = os.path.dirname(simulator_dir)
        self._cache_dir = os.environ.get("OPENWAM_CACHE_DIR") or os.path.join(self.repo_root, ".sim_cache")
        self._exe_path = None
        self._m_ref_mg = 640.4   # per-cylinder trapped mass at VE=100% (recomputed per run)

    # ------------------------------------------------------------------ infra
    def _resolve_exe(self):
        """Locate the solver. Prefer the freshly-built, damping-capable exe.

        NON-NEGOTIABLE: the exe MUST honor OPENWAM_MOUTH_RAD/THR_CHOKE/VEDIAG/HLLC
        (built from the Stage-56 source). The committed bin/release exe is stale.
        """
        if self._exe_path and os.path.exists(self._exe_path):
            return self._exe_path
        candidates = [
            os.environ.get("OPENWAM_EXE"),
            os.path.join(self.repo_root, "build_ux", "bin", "release", "OpenWAM.exe"),
            os.path.join(self.repo_root, "build", "bin", "release", "OpenWAM.exe"),
            os.path.join(self.simulator_dir, "backend", "OpenWAM.exe"),
            os.path.join(self.repo_root, "bin", "release", "OpenWAM.exe"),
        ]
        for c in candidates:
            if c and os.path.exists(c):
                self._exe_path = c
                return c
        raise FileNotFoundError(
            "OpenWAM.exe not found. Build it (cmake --build build_ux --config Release) "
            "or set OPENWAM_EXE. Searched: " + "; ".join(c for c in candidates if c)
        )

    def _sim_binary_sig(self):
        try:
            st = os.stat(self._resolve_exe())
            return f"{st.st_size}:{int(st.st_mtime)}"
        except Exception:
            return "unknown"

    def _sim_code_commit(self):
        try:
            return subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=self.simulator_dir,
                stderr=subprocess.DEVNULL).decode().strip()
        except Exception:
            return "unknown"

    def _build_sim_env(self, cal, is_wot, fast=True):
        """The §3 NON-NEGOTIABLE solver environment for every app-run sim.

        omp1 (determinism) + HLLC flux (the plenumless Type-12 junction diverges
        without it) + choked throttle BC + (WOT) mouth radiation damping + VEDIAG
        (cyl-balance) + FAST_OUTPUT (kept in os.environ too; see run). Env overrides
        still win for studies. THR_GAMMA matches the validated WOT sweep recipe.
        """
        env = {**os.environ}
        env["OMP_NUM_THREADS"] = "1"            # §3.1 determinism (cell-parallel, not thread)
        env["OPENWAM_HLLC"] = "1"               # Riemann flux — required for stability
        env["OPENWAM_THR_CHOKE"] = "1"          # §3.3 compressible throttle BC
        env["OPENWAM_VEDIAG"] = "1"             # per-cylinder Mtrap -> cyl-balance gate
        env.setdefault("OPENWAM_THR_GAMMA", "1.4")
        if fast:
            env["OPENWAM_FAST_OUTPUT"] = "1"    # §3 speed lever (3D waveform turns this OFF)

        alpha, w, _thr = calib.mouth_rad(cal)
        rad_off = os.environ.get("OPENWAM_MOUTH_RAD_OFF")
        rad_explicit = os.environ.get("OPENWAM_MOUTH_RAD")
        if rad_explicit is not None:
            env["OPENWAM_MOUTH_RAD"] = rad_explicit
            env["OPENWAM_MOUTH_RAD_W"] = os.environ.get("OPENWAM_MOUTH_RAD_W", str(w))
        elif is_wot and not rad_off:
            env["OPENWAM_MOUTH_RAD"] = str(alpha)      # §3.2 monostabilize WOT
            env["OPENWAM_MOUTH_RAD_W"] = str(w)
        return env

    def _cycle_ve(self, log_path):
        """Per-cycle all-cylinder mean VE% from the VEDIAG Mtrap stream so far."""
        try:
            t = open(log_path, encoding="utf-8", errors="ignore").read()
        except OSError:
            return []
        ms = re.findall(r"Mtrap:([0-9.]+) g", t)
        n = len(ms) // 6
        mref = self._m_ref_mg or 640.4
        return [sum(float(x) for x in ms[c * 6:(c + 1) * 6]) / 6.0 * 1000.0 / mref * 100.0
                for c in range(n)]

    async def _run_solver(self, exe, wam_filename, cwd, env, log_path, deck_text,
                          timeout=900, min_cyc=25, slope_thresh=0.3, patience=2, poll=4.0):
        """Run the solver with the Stage-56 speed levers: slope-based EARLY STOP
        (kill once |dVE/dcyc| over the last 5 cycles < slope_thresh for `patience`
        polls, after >= min_cyc cycles) + a deterministic deck CACHE (a re-evaluated
        deck returns instantly). Returns the full stdout text.
        """
        # cache (deterministic omp1 runs only)
        key = None
        if str(env.get("OMP_NUM_THREADS", "1")) == "1" and not os.environ.get("OPENWAM_NO_CACHE"):
            h = hashlib.sha256()
            h.update(deck_text.encode("utf-8", "replace"))
            h.update(self._sim_binary_sig().encode())
            h.update(json.dumps({k: env.get(k) for k in _RESULT_ENV}, sort_keys=True).encode())
            key = h.hexdigest()
            cpath = os.path.join(self._cache_dir, key + ".log")
            if os.path.exists(cpath):
                try:
                    return open(cpath, encoding="utf-8", errors="replace").read()
                except OSError:
                    pass

        t0 = time.monotonic()
        ok = 0
        proc = None
        logf = open(log_path, "wb")
        try:
            proc = await asyncio.create_subprocess_exec(
                exe, wam_filename, cwd=cwd, stdout=logf,
                stderr=asyncio.subprocess.STDOUT, env=env)
            while True:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=poll)
                    break                                   # ended on its own
                except asyncio.TimeoutError:
                    pass
                if time.monotonic() - t0 > timeout:
                    proc.kill(); await proc.wait(); break
                ve = self._cycle_ve(log_path)
                if len(ve) >= max(min_cyc, 5):
                    if abs((ve[-1] - ve[-5]) / 4.0) < slope_thresh:
                        ok += 1
                        if ok >= patience:
                            proc.kill(); await proc.wait(); break
                    else:
                        ok = 0
        finally:
            # NEVER orphan the solver: if the coroutine is cancelled (client
            # disconnect / run cancelled) while the solver is mid-run, kill the
            # child so it can't keep burning a core in the background.
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except (ProcessLookupError, OSError):
                    pass
            try:
                logf.close()
            except OSError:
                pass
        try:
            text = open(log_path, encoding="utf-8", errors="replace").read()
        except OSError:
            text = ""
        if key:
            try:
                os.makedirs(self._cache_dir, exist_ok=True)
                shutil.copyfile(log_path, os.path.join(self._cache_dir, key + ".log"))
            except OSError:
                pass
        return text

    # ---------------------------------------------------------------- the Run
    async def run_ve_map_generation(self, config, model_name="ve_map_sim",
                                    mode="wot_quick"):
        """Run the VE map and assemble the structured + instrumented response.

        mode="wot_quick" -> the 20 WOT cells (fast iteration); "full_map" -> 480.
        """
        from .wam_generator import WAMGenerator

        # Deck-side levers must be in os.environ BEFORE WAMGenerator.generate()
        # reads them (FAST_OUTPUT drops the 75-pipe monitoring; the others match the
        # validated WOT sweep recipe). These are process-global for the run.
        os.environ["OPENWAM_FAST_OUTPUT"] = "1"
        # NOTE: THR_GAMMA / RUNNER_SC are NOT set here anymore -- they are SimConfig
        # fields (intake.throttle.pedal_gamma / intake.runner.length_scale) that the
        # generator reads via _ce(). Setting the env would shadow the config.

        cal = calib.load(self.data_dir)
        store = get_run_store(self.data_dir)
        run_id = uuid.uuid4().hex[:12]
        sim_sig = self._sim_binary_sig()
        code_commit = self._sim_code_commit()
        geometry = extract_geometry(config)
        engine_hash = hashlib.sha1(json.dumps(geometry, sort_keys=True, default=str)
                                   .encode()).hexdigest()[:12]
        wot_thr = M.WOT_TPS

        # per-cylinder reference trapped mass at VE=100% (constant across cells)
        geo0 = config.engine.geometry
        rho0 = config.environment.ambient_pressure / (287.058 * config.environment.ambient_temp)
        self._m_ref_mg = math.pi * ((geo0.bore / 20.0) ** 2) * (geo0.stroke / 10.0) * rho0

        # axes from the CSL ECU maps (kf_rf_soll)
        maps_file = os.path.join(self.data_dir, "csl_ecu_maps.json")
        maps, rpm_axis, load_axis = {}, [], []
        try:
            with open(maps_file, "r") as f:
                maps = json.load(f)
                rpm_axis = maps.get("kf_rf_soll", {}).get("x_axis", [])
                load_axis = maps.get("kf_rf_soll", {}).get("y_axis", [])
        except Exception as e:
            print(f"WARN: Could not load maps: {e}")
        if not rpm_axis:
            rpm_axis = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
        if not load_axis:
            load_axis = [100.0]

        rpms = [float(r) for r in rpm_axis]
        # debug/test hook: CSL_RPM_SUBSET="3900,4600" restricts the rpm sweep
        _sub = os.environ.get("CSL_RPM_SUBSET")
        if _sub:
            want = {int(float(x)) for x in _sub.split(",") if x.strip()}
            rpms = [r for r in rpms if int(r) in want] or rpms
        loads_all = [float(l) for l in load_axis]
        loads = [100.0] if mode == "wot_quick" else loads_all
        loads = [l for l in loads if l in loads_all] or loads

        stock = M.load_stock_wot(self.data_dir)
        stock_axis = M.stock_on_axis(rpms, stock)

        total = len(rpms) * len(loads)
        done = {"n": 0}
        t0 = time.time()
        # cell-parallel at omp1; size to cores-1 to avoid thread oversubscription
        conc = max(1, min(12, (os.cpu_count() or 8) - 1))
        sem = asyncio.Semaphore(conc)

        exe_path = self._resolve_exe()
        intake_base = calib.intake_vanos_base(cal)
        ex_scale = calib.exvanos_scale(cal)
        m_ref_mg = self._m_ref_mg

        async def run_point(rpm, load_tps):
            async with sem:
                point_config = config.model_copy(deep=True)
                point_config.engine.rpm = float(rpm)
                point_config.engine.throttle_position = float(load_tps / 100.0)
                is_wot = load_tps >= wot_thr

                intake_cam = exhaust_cam = None
                # --- VANOS lookup ----------------------------------------
                try:
                    van_in = maps.get("kf_evan1_soll", {})
                    v_x, v_y, v_vals = van_in.get("x_axis", []), van_in.get("y_axis", []), van_in.get("values", [])
                    if v_x and v_y and v_vals:
                        vi = min(range(len(v_x)), key=lambda i: abs(v_x[i] - rpm))
                        vyi = min(range(len(v_y)), key=lambda i: abs(v_y[i] - load_tps))
                        intake_cam = v_vals[vyi][vi]
                        point_config.engine.vanos_intake_bias = float(intake_base - intake_cam)
                    av = maps.get("kf_avan1_soll", {})
                    a_x, a_y, a_vals = av.get("x_axis", []), av.get("y_axis", []), av.get("values", [])
                    if a_x and a_y and a_vals:
                        ai = min(range(len(a_x)), key=lambda i: abs(a_x[i] - rpm))
                        ayi = min(range(len(a_y)), key=lambda i: abs(a_y[i] - load_tps))
                        exhaust_cam = a_vals[ayi][ai]
                        env_b = os.environ.get("OPENWAM_EXVANOS_BASE")
                        ex_base = float(env_b) if env_b else calib.exvanos_base_for(cal, rpm, is_wot)
                        scale = float(os.environ.get("OPENWAM_EXVANOS_SCALE", str(ex_scale)))
                        point_config.engine.vanos_exhaust_bias = float((ex_base - exhaust_cam) * scale)
                except Exception:
                    pass

                # --- generate deck (WOT uses the validated 20deg BTDC) & run ---
                sub = f"{model_name}_{run_id}_{int(rpm)}_{int(load_tps)}"
                wam_filename = f"{sub}.wam"
                wam_path = os.path.join(self.simulator_dir, wam_filename)
                log_path = os.path.join(self.simulator_dir, sub + ".log")
                gen = WAMGenerator(point_config, self.simulator_dir)
                content = gen.generate(ignition_timing=20.0) if is_wot else gen.generate()
                with open(wam_path, "w") as f:
                    f.write(content)
                sim_env = self._build_sim_env(cal, is_wot, fast=True)

                output = ""
                try:
                    output = await self._run_solver(exe_path, wam_filename, self.simulator_dir,
                                                    sim_env, log_path, content)
                finally:
                    # clean the deck, log, AND the solver's DAT outputs (the solver
                    # writes <sub>AVG.DAT / <sub>INS.DAT next to the deck).
                    _base = os.path.join(self.simulator_dir, sub)
                    for p in (wam_path, log_path, _base + "AVG.DAT", _base + "INS.DAT"):
                        try:
                            os.remove(p)
                        except OSError:
                            pass

                # --- VE + convergence from the VEDIAG per-cycle stream ----
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
                mass_mg = mass_g * 1000.0

                if ncyc >= 5:
                    slope = (cyc_ve[-1] - cyc_ve[-5]) / 4.0
                    converged = abs(slope) < M.SLOPE_TOL
                else:
                    slope, converged = None, False
                blew_up = bool(cyc_ve and max(cyc_ve[-3:]) > M.VE_BLOWUP) or ve > M.VE_BLOWUP

                # --- cylinder-balance gate -------------------------------
                cylinders = getattr(point_config.engine, "cylinders", 6)
                cb = OpenWAMOutputParser.cylinder_balance(output, tol=0.20, n_cyl=cylinders)
                cyl_collapsed_n, cyl_ok = None, True
                cyl_spread = cb.get("spread")
                ve_cyl = cb.get("ve_cyl")
                if ve_cyl:
                    med = statistics.median(ve_cyl)
                    cyl_collapsed_n = sum(1 for x in ve_cyl if med > 0 and x < 0.5 * med)
                    cyl_ok = cyl_collapsed_n == 0

                nan_free = ("nan" not in output.lower()) and math.isfinite(mass_g) and mass_g > 0
                ve_in_band = M.VE_BAND[0] <= ve <= M.VE_BAND[1]
                valid = bool(converged and cyl_ok and ve_in_band and nan_free and not blew_up)
                ve_stock = stock_axis[rpms.index(rpm)] if abs(load_tps - 100.0) < 0.5 else None

                health = {
                    "converged": bool(converged),
                    "slope": (None if slope is None else round(slope, 4)),
                    "cyc": ncyc,
                    "cyl_ok": bool(cyl_ok),
                    "cyl_spread": (None if cyl_spread is None or (isinstance(cyl_spread, float)
                                   and math.isnan(cyl_spread)) else round(cyl_spread, 4)),
                    "nan_free": bool(nan_free),
                    "ve_in_band": bool(ve_in_band),
                    "valid": valid,
                }
                cell = {
                    "rpm": rpm, "tps": load_tps,
                    "ve_sim": round(ve, 2),
                    "ve_stock": (round(ve_stock, 2) if ve_stock is not None else None),
                    "mass_mg": round(mass_mg, 4),
                    "power_kw": round((mass_mg * rpm / 10000.0) * 1.5, 2),
                    "health": health,
                }

                # --- Phase-A instrumentation (§11) -----------------------
                try:
                    store.append({
                        "schema_version": 1,
                        "sim_binary_sig": sim_sig,
                        "sim_code_commit": code_commit,
                        "calib": {"alpha": calib.mouth_rad(cal)[0], "w": calib.mouth_rad(cal)[1],
                                  "thr_choke": cal.get("thr_choke", 1)},
                        "geometry": geometry,
                        "op": {"rpm": rpm, "load_tps": load_tps},
                        "vanos": {
                            "intake_cam_deg": intake_cam, "exhaust_cam_deg": exhaust_cam,
                            "intake_bias_deg": point_config.engine.vanos_intake_bias,
                            "exhaust_bias_deg": point_config.engine.vanos_exhaust_bias,
                            "overlap_deg": None,
                        },
                        "sim": {
                            "ve": round(ve, 3), "ve_healthy": (round(ve, 3) if valid else None),
                            "cyl_collapsed_n": cyl_collapsed_n,
                            "converged": bool(converged),
                            "slope": health["slope"], "cyc": ncyc, "blew_up": bool(blew_up),
                        },
                        "measured": ({"ve": round(ve_stock, 3), "source": "wideband",
                                      "confidence": 1.0} if ve_stock is not None else None),
                        "meta": {"user_hash": "local", "engine_hash": engine_hash,
                                 "ts": datetime.datetime.now().isoformat(timespec="seconds"),
                                 "app_version": APP_VERSION, "run_id": run_id},
                    })
                except Exception as e:
                    print(f"WARN: RunStore append failed: {e}")

                # --- progress (+ETA) -------------------------------------
                done["n"] += 1
                elapsed = time.time() - t0
                eta = int((elapsed / done["n"]) * (total - done["n"])) if done["n"] else 0
                try:
                    from ..log_manager import log_manager
                    await log_manager.broadcast(
                        f"CELL {done['n']}/{total} rpm={int(rpm)} tps={load_tps} "
                        f"ve={ve:.1f} cyc={ncyc} {'OK' if valid else 'FLAG'} eta={eta}s")
                except Exception:
                    pass
                return cell

        # ---- fan out cells ----------------------------------------------
        tasks = [run_point(r, l) for l in loads for r in rpms]
        flat = await asyncio.gather(*tasks)

        # ---- assemble cells[load][rpm] ----------------------------------
        by_key = {(c["tps"], c["rpm"]): c for c in flat}
        cells = [[by_key[(l, r)] for r in rpms] for l in loads]

        rows = []
        for li, l in enumerate(loads):
            sim_row = [cells[li][ri]["ve_sim"] for ri in range(len(rpms))]
            stock_row = [cells[li][ri]["ve_stock"] for ri in range(len(rpms))]
            healths = [cells[li][ri]["health"] for ri in range(len(rpms))]
            rows.append(M.row_metrics(l, sim_row, stock_row, rpms, healths))

        overall = M.overall(rows, flat)
        stock_curve = [{"rpm": r, "ve": round(v, 2)}
                       for r, v in zip(rpms, stock_axis) if v is not None]

        return {
            "schema_version": 1,
            "mode": mode,
            "run_id": run_id,
            "sim_binary_sig": sim_sig,
            "calib": {"alpha": calib.mouth_rad(cal)[0], "w": calib.mouth_rad(cal)[1]},
            "axes": {"rpm": rpms, "load": loads},
            "cells": cells,
            "rows": rows,
            "overall": overall,
            "stock_curve": stock_curve,
            "logs": f"Simulated {len(flat)} cells ({mode}).",
            "status": "success",
            "elapsed_sec": round(time.time() - t0, 1),
            "results": sorted(
                [{"rpm": c["rpm"], "tps": c["tps"], "ve_sim": c["ve_sim"],
                  "mass_mg": c["mass_mg"], "power_kw": c["power_kw"]} for c in flat],
                key=lambda x: (x["tps"], x["rpm"])),
        }

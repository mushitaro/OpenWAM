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
               "OPENWAM_FAST_OUTPUT", "OPENWAM_MOUTH_RAD_SKIP_CC",
               "OPENWAM_MOUTH_RAD_T12_CC"]


class SimulationService:
    def __init__(self, data_dir, simulator_dir):
        self.data_dir = data_dir
        self.simulator_dir = simulator_dir
        # repo root = one level above CSL_Simulator (the worktree root)
        self.repo_root = os.path.dirname(simulator_dir)
        self._cache_dir = os.environ.get("OPENWAM_CACHE_DIR") or os.path.join(self.repo_root, ".sim_cache")
        self._exe_path = None
        self._m_ref_mg = 640.4   # per-cylinder trapped mass at VE=100% (recomputed per run)
        # M5 cancellable runs: every long path (map cells, optimizer evals,
        # waveform) registers its asyncio Tasks here; POST /simulate/cancel
        # cancels them (task cancellation reaches _run_solver's finally, which
        # kills the solver child -> no orphans, CPU freed immediately).
        # Finished cells stay in the deck cache, so a re-run RESUMES.
        # _cancel_epoch is a monotonic counter, NOT a boolean: each run captures
        # the epoch at its start and treats a CancelledError as user-initiated
        # iff the epoch has advanced. No run ever resets shared state, so
        # concurrent runs cannot race each other's cancel classification.
        self._active_tasks = set()
        self._cancel_epoch = 0

    # -------------------------------------------------------------- cancel
    def _register_tasks(self, tasks):
        self._active_tasks.update(tasks)

    def _unregister_tasks(self, tasks):
        self._active_tasks.difference_update(tasks)

    def cancel_active(self):
        """Cancel every in-flight sim task. Returns how many were cancelled."""
        self._cancel_epoch += 1
        n = 0
        for t in list(self._active_tasks):
            if not t.done():
                t.cancel()
                n += 1
        return n

    @staticmethod
    async def _reap(tasks):
        """Cancel any not-done tasks and await them all, so no sibling keeps
        running unreferenced and no 'exception was never retrieved' fires."""
        for t in tasks:
            if not t.done():
                t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

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

    def _build_sim_env(self, cal, is_wot, fast=True, load=None):
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
        pl_alpha = calib.part_load_alpha(cal, load=load)
        if rad_explicit is not None:
            env["OPENWAM_MOUTH_RAD"] = rad_explicit
            env["OPENWAM_MOUTH_RAD_W"] = os.environ.get("OPENWAM_MOUTH_RAD_W", str(w))
        elif is_wot and not rad_off:
            env["OPENWAM_MOUTH_RAD"] = str(alpha)      # §3.2 monostabilize WOT
            env["OPENWAM_MOUTH_RAD_W"] = str(w)
        elif not is_wot and pl_alpha is not None and not rad_off:
            # Phase 4D: opt-in part-load damping (calibration.json
            # mouth_rad.part_load_alpha; null = legacy no-damping). MOUTH_RAD is
            # in _RESULT_ENV, so the deck-cache key stays correct.
            env["OPENWAM_MOUTH_RAD"] = str(pl_alpha)
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
                          timeout=1800, min_cyc=25, slope_thresh=0.3, patience=2, poll=4.0,
                          early_stop=True, no_cache=False):
        """Run the solver with the Stage-56 speed levers: slope-based EARLY STOP
        (kill once |dVE/dcyc| over the last 5 cycles < slope_thresh for `patience`
        polls, after >= min_cyc cycles) + a deterministic deck CACHE (a re-evaluated
        deck returns instantly). Returns the full stdout text.

        early_stop=False lets the solver run to its NATURAL end -- required by the
        M3b waveform path, because OpenWAM only flushes <deck>INS.DAT at clean
        termination (GeneralOutput); a killed run loses it. no_cache=True bypasses
        the stdout cache so a repeat waveform request actually re-runs the solver
        (the cache stores only stdout, never the DAT files).
        """
        # cache (deterministic omp1 runs only)
        key = None
        if str(env.get("OMP_NUM_THREADS", "1")) == "1" and not no_cache and not os.environ.get("OPENWAM_NO_CACHE"):
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
        timed_out = False
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
                    # a timed-out run is NOT a converged result -- flag it so
                    # its partial log never poisons the deck cache below.
                    timed_out = True
                    proc.kill(); await proc.wait(); break
                if early_stop:
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
                # bounded wait for the kill to land: on Windows the dying child
                # still holds its output-file handles, and the caller's cleanup
                # (deck/log/DAT delete) would silently fail and leak files.
                try:
                    await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=5.0)
                except BaseException:
                    pass
            try:
                logf.close()
            except OSError:
                pass
        try:
            text = open(log_path, encoding="utf-8", errors="replace").read()
        except OSError:
            text = ""
        if key and not timed_out:
            # atomic (tmp + replace): a reader never sees a torn cache entry.
            # timed_out runs are excluded -- their partial log is not a result.
            try:
                os.makedirs(self._cache_dir, exist_ok=True)
                cpath = os.path.join(self._cache_dir, key + ".log")
                tmp = cpath + ".tmp"
                shutil.copyfile(log_path, tmp)
                os.replace(tmp, cpath)
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
        # CSL_LOAD_SUBSET: value list ("20,45,100") or ">=10" (the calibration
        # target rows: ICV duty control makes <10% un-fittable, plan §0.3-6).
        _lsub = os.environ.get("CSL_LOAD_SUBSET")
        if _lsub and mode != "wot_quick":
            _l = _lsub.strip()
            if _l.startswith(">="):
                thr = float(_l[2:])
                loads = [l for l in loads if l >= thr] or loads
            else:
                lwant = {float(x) for x in _l.split(",") if x.strip()}
                loads = [l for l in loads if l in lwant] or loads
        loads = [l for l in loads if l in loads_all] or loads

        stock = M.load_stock_wot(self.data_dir)
        stock_axis = M.stock_on_axis(rpms, stock)

        _kf = maps.get("kf_rf_soll", {})

        def _kf_stock(rpm, load):
            """Part-load stock VE% from the ECU fill-target map (nearest cell)."""
            kx, ky, kv = _kf.get("x_axis"), _kf.get("y_axis"), _kf.get("values")
            if not (kx and ky and kv):
                return None
            xi = min(range(len(kx)), key=lambda i: abs(kx[i] - rpm))
            yi = min(range(len(ky)), key=lambda i: abs(ky[i] - load))
            try:
                return float(kv[yi][xi]) * 100.0
            except (IndexError, TypeError, ValueError):
                return None

        def _sha1(x):
            return (hashlib.sha1(json.dumps(x, sort_keys=True).encode())
                    .hexdigest()[:10] if x else None)

        _alpha, _w, _ = calib.mouth_rad(cal)
        _calib_log = {
            "schema_version": cal.get("schema_version", 1),
            "alpha": _alpha, "w": _w,
            "thr_choke": cal.get("thr_choke", 1),
            "part_load_alpha": calib.part_load_alpha(cal),
            "part_load_alpha_load_min": (cal.get("mouth_rad", {}) or {}).get("part_load_alpha_load_min"),
            "icv_sigma": calib.icv_sigma(cal),
            "thr_sigma_sha1": _sha1(calib.thr_sigma_points(cal)),
            # Stage 69: pure BMW-spread timing + KF_TZ_GRUND ignition input;
            # the v2 EXVANOS scaffold (exvanos_surface_sha1) is deleted.
            "timing_mode": "pure_v3",
            "ignition_map": bool(maps.get("kf_tz_grund")),
        }

        total = len(rpms) * len(loads)
        done = {"n": 0}
        t0 = time.time()
        # cell-parallel at omp1; size to cores-1 to avoid thread oversubscription
        conc = max(1, min(12, (os.cpu_count() or 8) - 1))
        sem = asyncio.Semaphore(conc)

        exe_path = self._resolve_exe()
        m_ref_mg = self._m_ref_mg

        async def run_point(rpm, load_tps):
            async with sem:
                point_config = config.model_copy(deep=True)
                point_config.engine.rpm = float(rpm)
                point_config.engine.throttle_position = float(load_tps / 100.0)
                is_wot = load_tps >= wot_thr

                intake_cam = exhaust_cam = None
                # --- VANOS lookup (Stage 69: PURE spread inputs) ----------
                # kf_evan1/avan1_soll values go into the spread fields VERBATIM
                # -- WAMGenerator applies the fixed BMW-spread conversion. The
                # bias fields stay 0 (pure stock); tuning shifts them only.
                try:
                    van_in = maps.get("kf_evan1_soll", {})
                    v_x, v_y, v_vals = van_in.get("x_axis", []), van_in.get("y_axis", []), van_in.get("values", [])
                    if v_x and v_y and v_vals:
                        vi = min(range(len(v_x)), key=lambda i: abs(v_x[i] - rpm))
                        vyi = min(range(len(v_y)), key=lambda i: abs(v_y[i] - load_tps))
                        intake_cam = v_vals[vyi][vi]
                        point_config.engine.intake_cam_spread = float(intake_cam)
                    av = maps.get("kf_avan1_soll", {})
                    a_x, a_y, a_vals = av.get("x_axis", []), av.get("y_axis", []), av.get("values", [])
                    if a_x and a_y and a_vals:
                        ai = min(range(len(a_x)), key=lambda i: abs(a_x[i] - rpm))
                        ayi = min(range(len(a_y)), key=lambda i: abs(a_y[i] - load_tps))
                        exhaust_cam = a_vals[ayi][ai]
                        point_config.engine.exhaust_cam_spread = float(exhaust_cam)
                except Exception:
                    pass

                # fitted ICV effective area (env > calibration.json > SimConfig;
                # deck-baked, so the deck cache keys stay correct by content)
                _icv = calib.icv_sigma(cal)
                if _icv is not None:
                    point_config.intake.eq_tube.icv_sigma = _icv

                # --- generate deck (WOT uses the validated 20deg BTDC) & run ---
                sub = f"{model_name}_{run_id}_{int(rpm)}_{int(load_tps)}"
                wam_filename = f"{sub}.wam"
                wam_path = os.path.join(self.simulator_dir, wam_filename)
                log_path = os.path.join(self.simulator_dir, sub + ".log")
                gen = WAMGenerator(point_config, self.simulator_dir)
                # calibrated sigma(pedal) table (deck-baked operating angle)
                gen._sigma_bp = calib.thr_sigma_points(cal)
                # Stage 69: physical ignition from KF_TZ_GRUND (two-stage
                # rf lookup); falls back to the legacy 20/15 recipe if absent
                _ign = M.ignition_for(maps, rpm, load_tps)
                content = gen.generate(ignition_timing=_ign)
                with open(wam_path, "w") as f:
                    f.write(content)
                sim_env = self._build_sim_env(cal, is_wot, fast=True, load=load_tps)

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

                # NaN gate: PERSISTENT NaN only -- recovery-window rule shared
                # via M.nan_persistent (Stage 58; startup bursts that straddle
                # a fixed cycle cut are recovered, not persistent).
                nan_free = (not M.nan_persistent(output)) and math.isfinite(mass_g) and mass_g > 0
                ve_in_band = M.VE_BAND[0] <= ve <= M.VE_BAND[1]
                valid = bool(converged and cyl_ok and ve_in_band and nan_free and not blew_up)
                # stock target: WOT row = measured wideband; part load = the ECU
                # fill-target map kf_rf_soll (narrowband+log provenance) -- this
                # activates the per-row shape metrics on every part-load row.
                if abs(load_tps - 100.0) < 0.5:
                    ve_stock = stock_axis[rpms.index(rpm)]
                    stock_source = "wideband"
                else:
                    ve_stock = _kf_stock(rpm, load_tps)
                    stock_source = "ecu_map" if ve_stock is not None else None

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
                    "stock_source": stock_source,
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
                        "calib": _calib_log,
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
                        "measured": ({"ve": round(ve_stock, 3), "source": stock_source,
                                      "confidence": (1.0 if stock_source == "wideband" else 0.7)}
                                     if ve_stock is not None else None),
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

        # ---- fan out cells (cancellable via /simulate/cancel) ------------
        epoch = self._cancel_epoch
        tasks = [asyncio.create_task(run_point(r, l)) for l in loads for r in rpms]
        self._register_tasks(tasks)
        try:
            flat = await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            await self._reap(tasks)
            if self._cancel_epoch != epoch:
                # user-initiated cancel (the handler task itself is alive):
                # solver children are killed by _run_solver's finally; finished
                # cells are already in the deck cache.
                raise RuntimeError(
                    "run cancelled — finished cells are cached; re-run to resume")
            raise                                   # real cancellation (disconnect)
        except BaseException:
            # one cell's ORDINARY exception must not leave the sibling cells
            # running unreferenced (they'd be unregistered below and thus
            # uncancellable) — cancel and reap them before propagating.
            await self._reap(tasks)
            raise
        finally:
            self._unregister_tasks(tasks)

        # ---- assemble cells[load][rpm] ----------------------------------
        by_key = {(c["tps"], c["rpm"]): c for c in flat}
        cells = [[by_key[(l, r)] for r in rpms] for l in loads]

        rows = []
        for li, l in enumerate(loads):
            sim_row = [cells[li][ri]["ve_sim"] for ri in range(len(rpms))]
            stock_row = [cells[li][ri]["ve_stock"] for ri in range(len(rpms))]
            healths = [cells[li][ri]["health"] for ri in range(len(rpms))]
            rows.append(M.row_metrics(l, sim_row, stock_row, rpms, healths))

        # cross-row load-profile metric (§5 #8): needs the load=100 row of THIS
        # run; injected into each part-load row and folded into its status.
        if len(loads) > 1 and 100.0 in loads:
            wi = loads.index(100.0)
            for li, l in enumerate(loads):
                if li == wi or l >= wot_thr:
                    continue
                dp = M.wot_ratio_maxdp_row(cells[li], cells[wi])
                rows[li]["wot_ratio_maxdp"] = None if dp is None else round(dp, 4)
                if dp is not None:
                    rows[li]["status"] = M.status_worst(rows[li]["status"],
                                                        M.dp_status(dp))

        overall = M.overall(rows, flat)
        stock_curve = [{"rpm": r, "ve": round(v, 2)}
                       for r, v in zip(rpms, stock_axis) if v is not None]

        result = {
            "schema_version": 1,
            "mode": mode,
            "run_id": run_id,
            "sim_binary_sig": sim_sig,
            "calib": _calib_log,
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
        # Persist the assembled result so a long full_map survives a lost HTTP
        # response (browser 'Failed to fetch' on an hours-long request): the
        # frontend can reload it via GET /simulate/last without re-running.
        # tmp + os.replace = atomic; a concurrent GET never sees a torn file.
        try:
            path = os.path.join(self.data_dir, f"last_run_{mode}.json")
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(result, f)
            os.replace(tmp, path)
        except OSError:
            pass
        return result

    # ------------------------------------------------------ M3b: waveforms
    # Crank-angle traces for ONE operating point (UX_APP_DEV_SPEC §6.B-2(ii)).
    # FAST_OUTPUT is forced OFF (generator override) so the deck monitors every
    # pipe; the run goes to its NATURAL end (early_stop=False) because OpenWAM
    # only flushes <deck>INS.DAT at clean termination -- a killed run loses it;
    # the duration is bounded to ~N cycles so a full-monitoring sim stays
    # responsive. This uses a DISTINCT (FAST_OUTPUT-off) cache key, so it never
    # perturbs the map Run path or its byte-identical default-deck cache.
    _WAVE_N_CYC = 12          # cycles to run (enough for a representative, settled wave)

    async def run_waveform_trace(self, config, rpm, load, model_name="ve_wave"):
        from .wam_generator import WAMGenerator

        t0 = time.time()
        epoch = self._cancel_epoch          # user-cancel classification datum
        rpm = float(rpm); load = float(load)
        is_wot = load >= M.WOT_TPS
        cal = calib.load(self.data_dir)
        run_id = uuid.uuid4().hex[:12]

        maps = {}
        try:
            with open(os.path.join(self.data_dir, "csl_ecu_maps.json")) as f:
                maps = json.load(f)
        except Exception:
            maps = {}
        point_config = config.model_copy(deep=True)
        point_config.engine.rpm = rpm
        point_config.engine.throttle_position = load / 100.0
        # VANOS coordination (Stage 69: PURE spread inputs) -- identical to
        # run_ve_map_generation.run_point so the waveform matches the cell.
        try:
            van_in = maps.get("kf_evan1_soll", {})
            v_x, v_y, v_vals = van_in.get("x_axis", []), van_in.get("y_axis", []), van_in.get("values", [])
            if v_x and v_y and v_vals:
                vi = min(range(len(v_x)), key=lambda i: abs(v_x[i] - rpm))
                vyi = min(range(len(v_y)), key=lambda i: abs(v_y[i] - load))
                point_config.engine.intake_cam_spread = float(v_vals[vyi][vi])
            av = maps.get("kf_avan1_soll", {})
            a_x, a_y, a_vals = av.get("x_axis", []), av.get("y_axis", []), av.get("values", [])
            if a_x and a_y and a_vals:
                ai = min(range(len(a_x)), key=lambda i: abs(a_x[i] - rpm))
                ayi = min(range(len(a_y)), key=lambda i: abs(a_y[i] - load))
                point_config.engine.exhaust_cam_spread = float(a_vals[ayi][ai])
        except Exception:
            pass

        # fitted ICV area / sigma(pedal) -- identical to the map path so the
        # waveform reflects the same calibrated deck as the cell it explains
        _icv = calib.icv_sigma(cal)
        if _icv is not None:
            point_config.intake.eq_tube.icv_sigma = _icv
        _sigma_bp = calib.thr_sigma_points(cal)

        n_cyc = self._WAVE_N_CYC

        # Discover the pipe topology (built during generate) to pick the curated
        # MONITOR SUBSET. Monitoring all ~75 pipes x 8 vars every step balloons
        # the in-memory INS buffer super-linearly and stalls the sim, so we
        # monitor only the pipes we actually return: intake runners + exhaust
        # ports + collector outlets (one wave per cylinder + collector).
        _ign = M.ignition_for(maps, rpm, load)   # Stage 69: KF_TZ_GRUND input
        _disc = WAMGenerator(point_config, self.simulator_dir)
        _disc._sigma_bp = _sigma_bp
        _disc.generate(ignition_timing=_ign)
        pipe_labels = {pid: _disc.pipes[pid].get("label", f"pipe{pid}") for pid in _disc.pipes}
        # Stage 64: intake-acoustics stations added (bellmouth mouths, duct,
        # filter, and the multi-cell box connectors) so the waveform view /
        # wave_box_fft.py can place the intake resonances empirically.
        # ~13 -> ~21 monitored pipes; the INS buffer handles this fine.
        _keep = re.compile(r"^(Runner_Lower_\d+|Port_Ex_\d+_1|Col_Out_"
                           r"|Bellmouth_\d+|CSL_Intake_Pipe|CSL_Panel_Filter"
                           r"|PlenumConn_\d+|PlenumBox_\w+)")
        mon_pids = sorted(pid for pid, lab in pipe_labels.items() if _keep.match(lab))

        gen = WAMGenerator(point_config, self.simulator_dir)
        gen._sigma_bp = _sigma_bp
        gen._fast_output_override = False                  # pipe monitoring ON
        # duration line = "<INS angular period, deg> <run length, cycles>". Token1
        # is the instantaneous SAMPLING STEP in degrees (fixed 1.0 -> rpm-independent
        # trace resolution), token2 is the number of cycles (natural end at N full
        # cycles -> INS.DAT is flushed and the last cycle is complete).
        gen._run_duration_override = f"1.0 {n_cyc}"
        gen._monitor_pipe_ids = set(mon_pids)              # curated subset only
        content = gen.generate(ignition_timing=_ign)

        env = self._build_sim_env(cal, is_wot, fast=False, load=load)
        env.pop("OPENWAM_FAST_OUTPUT", None)               # belt+braces: pipe monitoring ON
        exe = self._resolve_exe()

        # parsed-waveform cache: first view of a cell is a real sim (~2-3 min),
        # repeats are instant. Key on deck text + exe sig + the SOLVER-side env
        # (_RESULT_ENV) -- MOUTH_RAD/HLLC/K_CEIL are read by the solver but NOT
        # baked into the deck, so a study override of them must change the key
        # (mirrors the map cache). The .wave.json suffix keeps it in a distinct
        # namespace from the map deck cache.
        wkey = hashlib.sha256(
            (content + "|" + self._sim_binary_sig() + "|wave_v3|"
             + json.dumps({k: env.get(k) for k in _RESULT_ENV}, sort_keys=True)
             ).encode("utf-8", "replace")
        ).hexdigest()
        wpath = os.path.join(self._cache_dir, wkey + ".wave.json")
        if not os.environ.get("OPENWAM_NO_CACHE") and os.path.exists(wpath):
            try:
                with open(wpath, encoding="utf-8") as f:
                    cached = json.load(f)
                cached["elapsed_sec"] = round(time.time() - t0, 1)
                cached["cached"] = True
                return cached
            except (OSError, ValueError):
                pass

        ncyl = int(getattr(point_config.engine, "cylinders", 6))

        sub = f"{model_name}_{run_id}_{int(rpm)}_{int(load)}"
        wam_filename = f"{sub}.wam"
        wam_path = os.path.join(self.simulator_dir, wam_filename)
        log_path = os.path.join(self.simulator_dir, sub + ".log")
        ins_path = os.path.join(self.simulator_dir, sub + "INS.DAT")
        with open(wam_path, "w") as f:
            f.write(content)

        df = None
        try:
            solver_task = asyncio.create_task(
                self._run_solver(exe, wam_filename, self.simulator_dir, env, log_path,
                                 content, timeout=600, early_stop=False, no_cache=True))
            self._register_tasks([solver_task])
            try:
                await solver_task
            except asyncio.CancelledError:
                await self._reap([solver_task])
                if self._cancel_epoch != epoch:
                    raise RuntimeError("waveform run cancelled")
                raise
            finally:
                self._unregister_tasks([solver_task])
            if os.path.exists(ins_path):
                df = OpenWAMOutputParser.parse_ins_dat(ins_path)
        finally:
            for p in (wam_path, log_path,
                      os.path.join(self.simulator_dir, sub + "AVG.DAT"), ins_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

        if df is None or len(df) == 0 or df.shape[1] < 2:
            return {
                "run_id": run_id, "sim_binary_sig": self._sim_binary_sig(),
                "rpm": rpm, "load": load, "is_wot": is_wot, "n_cycles": 0,
                "crank_deg": [], "cylinders": [], "pipes": [],
                "elapsed_sec": round(time.time() - t0, 1), "status": "error",
                "note": "No INS.DAT produced (solver did not reach its natural end).",
            }

        cols = [str(c) for c in df.columns]
        ang_j = next((j for j, c in enumerate(cols) if c.startswith("Angle")), 1)

        ang_full = df.iloc[:, ang_j].to_numpy()
        n_cycles = 1 + sum(1 for i in range(1, len(ang_full))
                           if ang_full[i] == ang_full[i] and ang_full[i] < ang_full[i - 1] - 1.0)
        cyc = OpenWAMOutputParser.last_complete_cycle(df, angle_col=ang_j)

        def col(j):
            return [None if (v != v) else round(float(v), 4) for v in cyc.iloc[:, j].tolist()]

        # Map channels by HEADER NAME (robust to per-cylinder var counts -- each
        # cylinder block is P,T + per-valve/total mass flows + mass, not a fixed 5):
        #   cylinders -> "Pressure_Cyl_<n>(bar)"
        #   pipes     -> "P_duct_<pid>_at_<dist>_m(bar)" / "V_duct_...(m/s)"
        # distance 0 = inlet, >0 = outlet (we return the outlet trace).
        re_cyl = re.compile(r"^Pressure_Cyl_(\d+)\(")
        re_pp = re.compile(r"^P_duct_(\d+)_at_([0-9.]+)_m\(")
        re_pv = re.compile(r"^V_duct_(\d+)_at_([0-9.]+)_m\(")
        cyl_p, pipe_p, pipe_v = {}, {}, {}
        for j, c in enumerate(cols):
            m = re_cyl.match(c)
            if m:
                cyl_p[int(m.group(1))] = j; continue
            m = re_pp.match(c)
            if m:
                pipe_p.setdefault(int(m.group(1)), []).append((float(m.group(2)), j)); continue
            m = re_pv.match(c)
            if m:
                pipe_v.setdefault(int(m.group(1)), []).append((float(m.group(2)), j))

        crank = col(ang_j)                                 # Angle(deg), 0..720
        cylinders = [
            {"id": i, "label": f"Cyl {i}", "group": "cylinder",
             "pressure_bar": col(cyl_p[i]), "velocity_ms": None}
            for i in range(1, ncyl + 1) if i in cyl_p
        ]
        # group from the LABEL, not a magic pid threshold (pid boundaries shift if
        # the eq-tube is disabled / chained -> pid<39 would mislabel exhaust pipes).
        intake_re = re.compile(r"^(Runner|Bellmouth|Port_In|EqTube|CSL_Intake|CSL_Panel|Inlet|Plenum)")
        pipes = []
        for pid in mon_pids:
            ps, vs = pipe_p.get(pid), pipe_v.get(pid)
            if not ps or not vs:
                continue
            label = pipe_labels[pid]
            pipes.append({
                "id": pid, "label": label,
                "group": "intake" if intake_re.match(label) else "exhaust",
                "pressure_bar": col(max(ps)[1]),           # outlet = largest distance
                "velocity_ms": col(max(vs)[1]),
            })
        _missing = [i for i in range(1, ncyl + 1) if i not in cyl_p]
        note = f"missing cylinder pressure columns for cyl {_missing}" if _missing else None

        result = {
            "run_id": run_id, "sim_binary_sig": self._sim_binary_sig(),
            "rpm": rpm, "load": load, "is_wot": is_wot, "n_cycles": n_cycles,
            "crank_deg": crank, "cylinders": cylinders, "pipes": pipes,
            "elapsed_sec": round(time.time() - t0, 1), "status": "success", "note": note,
        }
        try:
            os.makedirs(self._cache_dir, exist_ok=True)
            with open(wpath, "w", encoding="utf-8") as f:
                json.dump(result, f)
        except OSError:
            pass
        return result

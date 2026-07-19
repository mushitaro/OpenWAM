"""Local-machine path + run helpers for the diagnostic scripts.

Replaces the cloud-box hardcoded absolute paths (``/home/user/OpenWAM/...``) with
portable, env-overridable resolution, and provides a Windows-safe wall-clock cap
to replace the Unix ``timeout`` command the scripts used to shell out to (Windows'
``timeout.exe`` is an interactive countdown, not a command wrapper).

Env overrides:
  OPENWAM_BIN   explicit OpenWAM binary path (else auto-detected under the repo)

``HERE`` is derived from this file's location: ``CSL_Simulator/backend``.
"""
import os
import re
import json
import time
import math
import shutil
import hashlib
import subprocess

# this file lives in CSL_Simulator/backend/scripts/  ->  HERE = CSL_Simulator/backend
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# backend/ -> CSL_Simulator/ -> repo root
_REPO = os.path.dirname(os.path.dirname(HERE))


def _find_bin():
    env = os.environ.get("OPENWAM_BIN")
    if env:
        return env
    cands = []
    for d in (os.path.join(_REPO, "build", "bin", "release"),
              os.path.join(_REPO, "bin", "release")):
        cands += [os.path.join(d, "OpenWAM.exe"), os.path.join(d, "OpenWAM")]
    for p in cands:
        if os.path.exists(p):
            return p
    # fall back to the conventional build path (a clear "not found" error on run)
    return cands[0]


BIN = _find_bin()


def run_capped(args, cwd, log_path, timeout, env):
    """Run ``args`` with stdout+stderr redirected to ``log_path``, killed after
    ``timeout`` seconds. Portable replacement for the Unix ``timeout`` command.
    (Fixed-cycle; no early-stop / cache -- use for byte-identity & full-run needs.)"""
    try:
        timeout = int(float(timeout))
    except (TypeError, ValueError):
        timeout = None
    with open(log_path, "wb") as f:
        p = subprocess.Popen(args, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, env=env)
        try:
            p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    return p.returncode


# ---------------------------------------------------------------------------
# Speed levers (Stage 56): slope-based EARLY STOP + a deck/result CACHE. Both cut
# calibration/optimization cost dramatically without changing the physics.
# ---------------------------------------------------------------------------
# Stage 74 (owner-approved): default = the ECU rf reference (BIN
# K_RF_LUFTDICHTE x K_RF_HUBVOLUMEN/6 = 0.6061 g); CSL_MREF_LEGACY=1
# restores the old standard-air 0.6408 g for stage<=73 CSV comparisons.
import os as _os
_M_REF = (math.pi * (0.087 / 2) ** 2 * 0.091 * (101325 / (287.05 * 298.0)) * 1000
          if _os.environ.get("CSL_MREF_LEGACY") == "1"
          else 1.136 * (3.201 / 6.0))
_CACHE_DIR = os.environ.get("OPENWAM_CACHE_DIR") or os.path.join(_REPO, ".sim_cache")
# env vars that change the SOLVER result -> part of the cache key
_RESULT_ENV = ["OPENWAM_HLLC", "OPENWAM_THR_CHOKE", "OPENWAM_THR_AGAIN", "OPENWAM_THR_GAMMA",
               "OPENWAM_MOUTH_RAD", "OPENWAM_MOUTH_RAD_W", "OPENWAM_VEDIAG", "OPENWAM_K_CEIL",
               "OPENWAM_FAST_OUTPUT", "OPENWAM_MOUTH_RAD_SKIP_CC",
               "OPENWAM_MOUTH_RAD_T12_CC",
               "OPENWAM_CAM_EXP",
               "OPENWAM_BOX_MODE", "OPENWAM_BOX_MODE_CC1", "OPENWAM_BOX_MODE_CC2",
               "OPENWAM_MEP_FUEL_V2"]


def _bin_sig():
    """Binary identity (size:mtime) so a rebuild auto-invalidates the cache."""
    try:
        st = os.stat(BIN)
        return f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return "nobin"


def _deck_key(cwd, env):
    deck_path = os.path.join(cwd, "m.wam")
    try:
        deck = open(deck_path, "rb").read()
    except OSError:
        return None
    h = hashlib.sha256()
    h.update(deck)
    h.update(_bin_sig().encode())
    h.update(json.dumps({k: env.get(k) for k in _RESULT_ENV}, sort_keys=True).encode())
    return h.hexdigest()


def _cacheable(env):
    # Only cache DETERMINISTIC runs: omp>1 is non-deterministic at the WOT resonance.
    return str(env.get("OMP_NUM_THREADS", "1")) == "1" and not os.environ.get("OPENWAM_NO_CACHE")


def _cycle_ve(log_path):
    """Per-cycle all-cyl mean VE% from the VEDIAG Mtrap stream so far."""
    try:
        t = open(log_path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return []
    ms = re.findall(r"Mtrap:([0-9.]+) g", t)
    n = len(ms) // 6
    return [sum(float(x) for x in ms[c * 6:(c + 1) * 6]) / 6 / _M_REF * 100 for c in range(n)]


def run_until_converged(args, cwd, log_path, timeout, env,
                        min_cyc=25, slope_thresh=0.3, patience=2, poll=4.0):
    """Run the solver but KILL it early once the per-cycle VE slope has converged
    (|dVE/dcyc| over the last 5 cycles < ``slope_thresh`` for ``patience`` consecutive
    polls, after >= ``min_cyc`` cycles), saving the tail cycles. Deck-CACHED for
    deterministic (omp1) runs -- a re-evaluated deck returns instantly. Falls back to
    the deck's own max cycles / ``timeout``. Drop-in for run_capped in calibration
    sweeps. Returns the return code (0 on a clean / early / cached stop)."""
    key = _deck_key(cwd, env) if _cacheable(env) else None
    if key:
        cpath = os.path.join(_CACHE_DIR, key + ".log")
        if os.path.exists(cpath):
            shutil.copyfile(cpath, log_path)
            return 0
    try:
        tmo = int(float(timeout))
    except (TypeError, ValueError):
        tmo = None
    t0 = time.monotonic()
    ok_streak = 0
    with open(log_path, "wb") as f:
        p = subprocess.Popen(args, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, env=env)
        while True:
            try:
                p.wait(timeout=poll)
                break  # process ended on its own (hit the deck's max cycles)
            except subprocess.TimeoutExpired:
                pass
            if tmo is not None and (time.monotonic() - t0) > tmo:
                p.kill(); p.wait(); break
            ve = _cycle_ve(log_path)
            if len(ve) >= max(min_cyc, 5):
                if abs((ve[-1] - ve[-5]) / 4) < slope_thresh:
                    ok_streak += 1
                    if ok_streak >= patience:
                        p.kill(); p.wait(); break
                else:
                    ok_streak = 0
    if key:
        try:
            os.makedirs(_CACHE_DIR, exist_ok=True)
            shutil.copyfile(log_path, os.path.join(_CACHE_DIR, key + ".log"))
        except OSError:
            pass
    return p.returncode

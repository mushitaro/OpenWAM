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
    ``timeout`` seconds. Portable replacement for the Unix ``timeout`` command."""
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

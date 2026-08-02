#!/usr/bin/env python3
"""Stage 80 - intake mass-balance / thermal / acoustic census.

WHY THIS EXISTS (read before using it)
--------------------------------------
Stage 79 concluded "the model has NO coherent, phase-locked ~197 Hz intake
resonator". That conclusion rests on ``wave_box_fft.py``, whose measurement
basis has three defects found at the start of Stage 80:

  1. ``mouth_cols()`` reads ``sorted(...)[0]`` = the distance-0 column ONLY.
     At a trumpet mouth that is the plenum-side PRESSURE NODE. The valve-side
     station was never read by committed code.
  2. The census runs a FIXED 14 cycles while the VE sweep runs the v2
     convergence protocol (40 fixed cycles, tail-10 mean). Re-analysis of the
     archived Stage-79 runs shows the mouth temperature at 3900 still falling
     ~12 degC/cycle at the LAST measured cycle -> the speed of sound (and hence
     any quarter-wave frequency) was still moving while "no fixed-Hz ridge"
     was being declared.
  3. Those runs were produced by the build/ binary (Jul 10); the current tree
     is build_ux (Jul 19). See commit 85aeb52.

And the archived runs show something the acoustic framing missed entirely:
the DC (mean) flow field is pathological. In every archived run exactly two of
the six trumpets run permanently REVERSED, 71-93% of what cylinder 1 draws
through its bellmouth leaves through the phi30 eq-rail tap 10 mm below the
throttle plate, and the snorkel is net OUTWARD (the airbox vents to
atmosphere at WOT). So this script measures the mean-flow budget FIRST and the
acoustics SECOND.

WHAT IT MEASURES
----------------
  M1  mass-balance census  - per-station mean flow, tee continuity, pipe
                             accumulation, tap diversion, mouth reversals,
                             snorkel net, and CLOSURE (sum of mouth flows vs
                             the engine's own trapped-mass rate from VEDIAG).
  M2  thermal / sound speed - per-station mean T, a = sqrt(gamma*R*T), the
                             tract travel time and the quarter-wave frequency
                             it implies, plus the per-cycle T trend
                             (= the convergence check Stage 79 lacked).
  M3  characteristic decomposition - rightward/leftward wave amplitudes
                             X+ = p_der^G5 - 1, X- = p_izq^G5 - 1 from P/V/T.
  M4  phase / coherence    - per-cycle complex spectra on a UNIFORM angle grid;
                             coherence = |sum_c F_c| / sum_c |F_c|. A resonance
                             is judged by COHERENCE, not amplitude.
  M5  reflection coefficient at the trumpet mouth, least-squares form
                             R = <X+ X-*> / <|X-|^2>.

Modes:
  python intake_acoustics.py --analyze <run_dir> [--rpm N]   # no solver
  python intake_acoustics.py --rpm 3900 --cycles 40 --tag s80_base
  python intake_acoustics.py --print-mouth-cc                # SKIP_CC numbers
  python intake_acoustics.py --self-test                     # PC-3, no solver

Results: calib_data/stage80_acoustics/<tag>_<rpm>.json (+ a printed report).
Existing JSONs are skipped (resume). The run directory and its cellINS.DAT are
retained, so re-analysis of any past run is free.
"""
import argparse
import contextlib
import io
import json
import math
import os
import re
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wave_box_fft as W  # noqa: E402  (pure helpers only -- see gen_deck below)
from _local import BIN, HERE, run_capped  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.output_parser import OpenWAMOutputParser  # noqa: E402
from app.simulator.simulation_service import SimulationService, _RESULT_ENV  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "calib_data", "stage80_acoustics")

# The FULL intake acoustic path, both ends of every pipe. Port_In is included
# (parasite_census.py omits it) because the tract that must ring at ~197 Hz is
# mouth -> bellmouth -> throttle -> runner upper -> tap tee -> runner lower ->
# port split -> port -> valve, and the port is 105 of its 345 mm.
# Port_In_i_1 only (the two ports per cylinder are geometrically identical): 46
# pipes x 2 points x 4 vars x 720 deg x 40 cycles is already ~165 MB of INS.
MON_RE = re.compile(
    r"^(Bellmouth_\d+|Runner_Upper_\d+|Runner_Lower_\d+|Port_In_\d+_1"
    r"|EqRail_Tap_\d+|EqRail_Seg_\w+|EqRail_Return|EqTube_Stub_\d+"
    r"|Head_Return|CSL_Intake_Pipe|Duct_Core|Duct_Exit|Duct_Seg_\d+|CSL_Panel_Filter"
    r"|PlenumConn_\d+|PlenumBox_\w+"
    # Stage 106 (IA_MON_EXTRA): opt-in extra labels, e.g. the exhaust side for
    # the scavenging question. Unset -> unchanged monitor set.
    + (("|" + os.environ["IA_MON_EXTRA"]) if os.environ.get("IA_MON_EXTRA") else "")
    + r")$")

# The runner tract, in acoustic order from the plenum mouth to the valve.
# Used for the travel-time / quarter-wave estimate (M2).
TRACT = ["Bellmouth_{i}", "Runner_Upper_{i}", "Runner_Lower_{i}", "Port_In_{i}_1"]

GAMMA = 1.4
R_AIR = 287.05

# ---------------------------------------------------------------------------
# ⚡ Stage 93: the sound speed MUST come from the composition the run actually
# used, not from hardcoded air. The deck's species vector feeds the solver's
# property routine (Globales.h:1785)
#   R = R_O2*Y0 + R_CO2*Y1 + R_H2O*Y2 + R_Fuel*Yf
#       + R_N2*(1 - Y0 - Y1 - Y2 - Yf - 0.012) + R_Ar*0.012
# with the canonical index order 0=O2 1=CO2 2=H2O ... 8=N2 9=Fuel
# (TOpenWAM.cpp:722-765). The production deck writes "0.233 0.767 0 ..." which
# puts nitrogen in the CO2 slot and yields R = 204 J/kgK, so every f_quarter
# reported before this fix was inflated by sqrt(287/204) = 1.185 -- that is what
# made Stage 79 read 275-291 Hz when the solver was actually at 232-245 Hz.
# ---------------------------------------------------------------------------
_R_SP = {"O2": 259.825, "CO2": 188.9, "H2O": 461.5, "N2": 296.8, "Ar": 208.13}
# cp at ~300 K, J/kgK. Only used for gamma; the dominant term is R.
_R_RUN, _G_RUN = R_AIR, GAMMA   # per-run values, set by census()
_CP_SP = {"O2": 918.0, "CO2": 844.0, "H2O": 1864.0, "N2": 1040.0, "Ar": 520.3}


def mixture_R_gamma(comp):
    """(R, gamma) for a deck species vector, in the solver's index order."""
    y0, y1, y2 = (float(comp[i]) if i < len(comp) else 0.0 for i in (0, 1, 2))
    yar = 0.012
    yn2 = 1.0 - y0 - y1 - y2 - yar
    R = (_R_SP["O2"] * y0 + _R_SP["CO2"] * y1 + _R_SP["H2O"] * y2
         + _R_SP["N2"] * yn2 + _R_SP["Ar"] * yar)
    cp = (_CP_SP["O2"] * y0 + _CP_SP["CO2"] * y1 + _CP_SP["H2O"] * y2
          + _CP_SP["N2"] * yn2 + _CP_SP["Ar"] * yar)
    return R, cp / (cp - R)


def deck_R_gamma(wd):
    """Read <wd>/cell.wam and return (R, gamma, comp) for its species vector.

    The composition is the first line of >=9 floats that sums to 1.0 -- OpenWAM
    itself refuses to start otherwise (TOpenWAM.cpp:841 throws when the total
    mass fraction is off by more than 1e-4), so that test is unambiguous.
    """
    p = os.path.join(wd, "cell.wam")
    if not os.path.exists(p):
        return R_AIR, GAMMA, None
    for line in open(p, encoding="utf-8", errors="replace"):
        tok = line.split()
        if len(tok) < 9:
            continue
        try:
            v = [float(t) for t in tok]
        except ValueError:
            continue
        if abs(sum(v) - 1.0) < 1e-4:
            R, g = mixture_R_gamma(v)
            return R, g, v
    return R_AIR, GAMMA, None
G1 = GAMMA - 1.0
G4 = 2.0 * GAMMA / (GAMMA - 1.0)
G5 = (GAMMA - 1.0) / (2.0 * GAMMA)

# The car's intake resonance, established Stage 79 from kf_rf_soll's own WOT
# extrema (odd order = peak / even = valley, 5/5 parity, mean error 3.3%).
CAR_F_HZ = 197.0
BAND = (190.0, 210.0)


# ---------------------------------------------------------------------------
# deck generation / geometry
# ---------------------------------------------------------------------------
def gen_deck(cfg, cal, wd, cycles, monitor_vars=None, dense=None):
    """Discovery pass -> monitor pids -> real deck with 1-deg INS monitoring.

    A local copy of wave_box_fft.gen_deck rather than an import: that one reads
    the module-global ``W.MON_RE``, so using it would force the monkey-patch
    idiom parasite_census.py uses (mutating another module's globals), which
    makes it impossible to tell afterwards which script produced a result. The
    pure helpers (build_config / coordinate_vanos / _apply_set) ARE imported.
    """
    os.makedirs(wd, exist_ok=True)
    sigma_bp = calib.thr_sigma_points(cal)
    icv = calib.icv_sigma(cal)
    if icv is not None:
        cfg.intake.eq_tube.icv_sigma = icv
    ign = M.ignition_for(MAPS, cfg.engine.rpm, cfg.engine.throttle_position * 100.0)

    disc = WAMGenerator(cfg, wd)
    disc._sigma_bp = sigma_bp
    with contextlib.redirect_stdout(io.StringIO()):
        disc.generate(ignition_timing=ign)
    labels = {pid: disc.pipes[pid].get("label", f"pipe{pid}") for pid in disc.pipes}
    geom = {pid: dict(disc.pipes[pid]) for pid in disc.pipes}
    mon = sorted(pid for pid, lab in labels.items() if MON_RE.match(lab))

    gen = WAMGenerator(cfg, wd)
    gen._sigma_bp = sigma_bp
    gen._fast_output_override = False              # pipe monitoring ON
    gen._run_duration_override = f"1.0 {cycles}"   # 1-deg INS sampling, N cycles
    gen._monitor_pipe_ids = set(mon)
    if monitor_vars:
        gen._monitor_vars = monitor_vars           # Stage 80: e.g. "0 1 2 3 6 7"
    if dense:
        gen._monitor_dense = dense                 # Stage 81: (label_prefix, n_points)
    with contextlib.redirect_stdout(io.StringIO()):
        deck = gen.generate(ignition_timing=ign)
    with open(os.path.join(wd, "cell.wam"), "w", encoding="utf-8") as f:
        f.write(deck)
    return labels, geom, mon


MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8"))


def discover_geometry(rpm, sets, cycles=40):
    """labels + geometry WITHOUT writing a deck or running anything.

    Used by --analyze to recover the pid -> label mapping for an archived run.
    The mapping is then VERIFIED against the INS column distances (gate G0), so
    a wrong config cannot silently mislabel stations.
    """
    cfg = W.build_config(rpm, sets, cycles)
    cal = calib.load(DATA_DIR)
    icv = calib.icv_sigma(cal)
    if icv is not None:
        cfg.intake.eq_tube.icv_sigma = icv
    W.coordinate_vanos(cfg, cal, rpm)
    gen = WAMGenerator(cfg, os.path.join(OUT_DIR, "_geom_probe"))
    os.makedirs(gen.output_dir, exist_ok=True)
    gen._sigma_bp = calib.thr_sigma_points(cal)
    with contextlib.redirect_stdout(io.StringIO()):
        gen.generate(ignition_timing=M.ignition_for(MAPS, rpm, 100.0))
    labels = {pid: gen.pipes[pid].get("label", f"pipe{pid}") for pid in gen.pipes}
    geom = {pid: dict(gen.pipes[pid]) for pid in gen.pipes}
    return labels, geom, gen


def area_at(g, dist):
    """Cross-sectional area [m^2] at axial distance ``dist`` of a tapered pipe."""
    L = float(g["length"])
    d0, d1 = float(g["d_start"]), float(g["d_end"])
    t = 0.0 if L <= 0 else min(max(dist / L, 0.0), 1.0)
    d = d0 + (d1 - d0) * t
    return math.pi * d * d / 4.0


# ---------------------------------------------------------------------------
# INS parsing / station model
# ---------------------------------------------------------------------------
_RE_COL = re.compile(r"^([A-Za-z_]+)_duct_(\d+)_at_([0-9.]+)_m\(")
# OpenWAM's own characteristic outputs (TipoVar 6/7) land as these prefixes;
# see Source/Labels/labels.cpp. Only present when _monitor_vars requests them.
_VARMAP = {"P": "P", "V": "V", "T": "T", "F": "F",
           "P_to_Rigth": "PD", "P_to_Left": "PI", "Gamma": "GA"}


def parse_stations(df):
    """{pid: {distance: {var: column_index}}} from the INS header.

    ⚡ OpenWAM header bug (Stage 81): the per-station distance string is
    ACCUMULATED across the stations of a pipe instead of being reset, so a pipe
    monitored at 0/0.05/0.1/0.15 emits

        ..._at_0_m  ..._at_00.05_m  ..._at_00.050.1_m  ..._at_00.050.10.15_m

    i.e. label_k == label_{k-1} + str(distance_k) exactly. With the legacy TWO
    stations this is harmless -- "0" and "0"+"0.4" = "00.4", and float("00.4")
    is 0.4 -- which is why every 2-point census in Stage 80/81 was correct. It
    only becomes ambiguous from the third station on. Decoding by stripping the
    previous label is exact, so we do that rather than float() the raw text.
    """
    cols = [str(c) for c in df.columns]
    st, prev = {}, {}
    for j, c in enumerate(cols):
        m = _RE_COL.match(c)
        if not m:
            continue
        var = _VARMAP.get(m.group(1))
        if var is None:
            continue
        pid, raw = int(m.group(2)), m.group(3)
        key = (pid, var)
        pl = prev.get(key)
        frag = raw[len(pl):] if (pl is not None and raw.startswith(pl) and len(raw) > len(pl)) else raw
        prev[key] = raw
        try:
            dist = float(frag)
        except ValueError:
            raise ValueError(f"cannot decode station distance from {c!r} "
                             f"(fragment {frag!r} after previous {pl!r})")
        st.setdefault(pid, {}).setdefault(dist, {})[var] = j
    ang_j = next((j for j, c in enumerate(cols) if c.startswith("Angle")), 1)
    return st, ang_j


def gate_label_mapping(stations, labels, geom):
    """G0 - the pid -> label mapping must agree with the INS column distances.

    Every monitored pipe emits two points: 0.0 and its own length. If the
    regenerated geometry disagrees with the distance baked into the column
    name, the labels belong to a DIFFERENT deck and every station name in the
    report would be a lie. Cheap, and it makes --analyze on archived runs safe.
    """
    bad = []
    for pid, dists in stations.items():
        if pid not in geom:
            bad.append((pid, "unknown pid", None, None))
            continue
        far = max(dists)
        L = float(geom[pid]["length"])
        # the column name carries 2 decimals, so compare at that resolution
        if abs(far - round(L, 2)) > 0.011:
            bad.append((pid, labels.get(pid, "?"), far, L))
    return bad


# ---------------------------------------------------------------------------
# cycle segmentation + uniform-angle resampling
# ---------------------------------------------------------------------------
def cycle_segments(ang, n_use):
    """Indices of the last ``n_use`` COMPLETE engine cycles."""
    starts = [0] + [i for i in range(1, len(ang))
                    if ang[i] == ang[i] and ang[i] < ang[i - 1] - 1.0]
    starts.append(len(ang))
    segs = [(starts[k], starts[k + 1]) for k in range(len(starts) - 1)]
    lens = sorted(e - s for s, e in segs if e > s)
    if not lens:
        return []
    med = lens[len(lens) // 2]
    full = [(s, e) for s, e in segs if (e - s) >= 0.9 * med]
    return full[-n_use:]


def cyclic_spectra(x, ang, segs, n_grid=720):
    """Per-cycle complex spectra on a UNIFORM crank-angle grid.

    The INS writer emits on an absolute angle grid, so dAngle jitters (measured
    std 0.064 deg, range 0.76-1.28) without accumulating. That jitter is
    harmless for amplitudes but not for phase, and Stage 80 lives on phase --
    hence the interpolation onto an exact 720-point grid before the FFT.
    Returns (F[c, k], grid) with F scaled to single-sided amplitude.
    """
    grid = np.linspace(0.0, 720.0, n_grid, endpoint=False)
    out = []
    for s, e in segs:
        a = ang[s:e].astype(float)
        v = x[s:e].astype(float)
        order = np.argsort(a)
        xi = np.interp(grid, a[order], v[order])
        xi = xi - xi.mean()
        out.append(np.fft.rfft(xi) * 2.0 / n_grid)
    return np.asarray(out), grid


def bin_hz(k, rpm):
    """Bin k of a 720-deg window -> Hz. One cycle = 120/rpm s, so f = k*rpm/120."""
    return np.asarray(k) * rpm / 120.0


def coherence(F):
    """|sum_c F_c| / sum_c |F_c| in [0,1]: 1 = perfectly phase-locked cycle to
    cycle, 0 = random phase. THIS is the resonance test -- amplitude alone
    cannot distinguish a resonator from broadband noise (Stage 79's alpha=0 run
    had 3-6x the wave energy and the FLATTEST VE row)."""
    num = np.abs(F.sum(axis=0))
    den = np.abs(F).sum(axis=0)
    return np.divide(num, den, out=np.zeros_like(num), where=den > 1e-30)


def band_mask(hz, lo, hi):
    return (hz >= lo) & (hz <= hi)


# ---------------------------------------------------------------------------
# M3 - characteristic decomposition
# ---------------------------------------------------------------------------
def implied_gamma(P_bar, V, T_degC, PD, lo=1.28, hi=1.44, n=321):
    """The gamma that makes the offline reconstruction match the solver's own
    p_der. Measured at 3900: 1.354 (mouth) / 1.355 (throttle) / 1.360 (valve),
    which drives the residual from 1.0e-3 (at gamma=1.4) down to 1.3e-5.

    ⚡ That number is itself a result: dry air at 290 degC has gamma ~1.375, so
    gamma ~1.355 in the INTAKE tract means burnt gas is present there -- an
    observable completely independent of the mean-flow census that points at
    the same conclusion.
    """
    best = (None, None)
    den = float(np.nanmax(np.abs(PD))) or 1.0
    for G in np.linspace(lo, hi, n):
        pd, _, _ = _pchar(P_bar, V, T_degC, float(G))
        err = float(np.nanmax(np.abs(pd - PD))) / den
        if best[1] is None or err < best[1]:
            best = (float(G), err)
    return best


def _pchar(P_bar, V, T_degC, G):
    g1, g4, g5 = G - 1.0, 2.0 * G / (G - 1.0), (G - 1.0) / (2.0 * G)
    a = np.sqrt(G * _R_RUN * (np.asarray(T_degC, dtype=float) + 273.15))
    Pg = np.power(np.asarray(P_bar, dtype=float), g5)
    e = g1 * np.asarray(V, dtype=float) / (2.0 * a)
    p_der = np.power(np.clip((Pg * (1.0 + e) + 1.0) / 2.0, 1e-12, None), g4)
    p_izq = np.power(np.clip((Pg * (1.0 - e) + 1.0) / 2.0, 1e-12, None), g4)
    return p_der, p_izq, a


def characteristics(P_bar, V, T_degC):
    """Rightward / leftward wave amplitudes from (P, V, T).

    OpenWAM's non-dimensional Riemann variables: A = P^G5, lambda = A + G1/2*U,
    beta = A - G1/2*U. Reconstructed here in dimensional form so the reference
    speed of sound cancels.

    NOTE ON THE "IDENTITY GATE": X+ + X- == P^G5 - 1 holds ALGEBRAICALLY by
    construction, so verifying it to 1e-16 tests floating point and nothing
    else. It is kept as a numerical-sanity check (NaN / negative base), NOT as
    a validity gate. The real gate is G2: compare against the solver's own
    TipoVar 6/7 output (Source/1DPipes/TTubo.cpp:3292-3299).
    """
    a = np.sqrt(GAMMA * _R_RUN * (np.asarray(T_degC, dtype=float) + 273.15))
    Pg = np.power(np.asarray(P_bar, dtype=float), G5)
    e = G1 * np.asarray(V, dtype=float) / (2.0 * a)
    p_der = np.power(np.clip((Pg * (1.0 + e) + 1.0) / 2.0, 1e-12, None), G4)
    p_izq = np.power(np.clip((Pg * (1.0 - e) + 1.0) / 2.0, 1e-12, None), G4)
    Xp = np.power(p_der, G5) - 1.0     # rightward (toward increasing x)
    Xm = np.power(p_izq, G5) - 1.0     # leftward
    resid = float(np.nanmax(np.abs(Pg - (np.power(p_der, G5) + np.power(p_izq, G5) - 1.0))))
    return Xp, Xm, p_der, p_izq, a, resid


# ---------------------------------------------------------------------------
# engine air demand (for the CLOSURE gate)
# ---------------------------------------------------------------------------
def engine_air(df, segs, log_path, rpm):
    """The engine's FRESH-CHARGE rate [kg/s] -- the CLOSURE denominator.

    ⚠ The obvious denominator (VEDIAG's Mtrap) is WRONG for this question.
    Mtrap is the total cylinder mass at IVC and therefore includes the residual
    exhaust gas: at 3900 the archived run gives Mtrap 0.478 g/cyl (= 0.0929
    kg/s) against 0.0600 kg/s actually drawn through the intake valves, i.e. a
    36% residual fraction. Asking "do the trumpets supply the engine" must be
    answered against the fresh charge, so the primary route integrates the
    INTAKE VALVE mass flow straight out of the INS.

    Sign convention, established from the exhaust columns of the same file:
    POSITIVE = cylinder -> pipe. So intake valve flow is negative while filling
    and the fresh-charge rate is -mean(sum of intake valve flows).
    """
    cols = [str(c) for c in df.columns]
    idx = {c: j for j, c in enumerate(cols)}
    sl = np.concatenate([np.arange(s, e) for s, e in segs])
    intake = exhaust = 0.0
    n_in = 0
    for c in range(1, 7):
        for v in (0, 1):
            k = f"Mass_Flow_Int_Valve_{v}_Cyl_{c}(kg/s)"
            if k in idx:
                intake += float(np.nanmean(df.iloc[sl, idx[k]].to_numpy(dtype=float)))
                n_in += 1
        k = f"Total_Exh_Mass_Flow_Cyl_{c}(kg/s)"
        if k in idx:
            exhaust += float(np.nanmean(df.iloc[sl, idx[k]].to_numpy(dtype=float)))
    fresh = -intake if n_in else None

    mtrap = None
    n_cyc = 0
    try:
        t = open(log_path, encoding="utf-8", errors="ignore").read()
        ms = [float(x) for x in re.findall(r"Mtrap:([0-9.]+) g", t)]
        n_cyc = len(ms) // 6
        if n_cyc:
            mtrap = sum(ms[(n_cyc - 1) * 6:n_cyc * 6]) / 1000.0 * (rpm / 120.0)
    except OSError:
        pass
    return {
        "fresh_charge_kgs": fresh,
        "exhaust_out_kgs": exhaust if n_in else None,
        # in a converged cycle intake air + fuel == exhaust out; the gap is a
        # direct, assumption-free non-steadiness indicator
        "in_out_imbalance": (float((fresh - exhaust) / fresh)
                             if fresh and abs(fresh) > 1e-9 else None),
        "mtrap_rate_kgs": mtrap,
        "residual_fraction": (float(1.0 - fresh / mtrap)
                              if fresh and mtrap and mtrap > 1e-9 else None),
        "mtrap_cycles": n_cyc,
    }


# ---------------------------------------------------------------------------
# the census
# ---------------------------------------------------------------------------
def census(wd, rpm, labels, geom, n_cyc_use=8, want_cycles=None):
    ins = os.path.join(wd, "cellINS.DAT")
    if not os.path.exists(ins):
        return {"rpm": rpm, "error": "no INS.DAT (run did not reach natural end)"}
    # Stage 93: pin the gas properties to THIS deck's species vector before any
    # sound speed is computed, so f_quarter reflects the run instead of air.
    global _R_RUN, _G_RUN
    _R_RUN, _G_RUN, _comp = deck_R_gamma(wd)
    df = OpenWAMOutputParser.parse_ins_dat(ins)
    stations, ang_j = parse_stations(df)
    bad = gate_label_mapping(stations, labels, geom)
    ang = df.iloc[:, ang_j].to_numpy(dtype=float)
    segs = cycle_segments(ang, n_cyc_use)
    # ⚡ G9 -- NaN / plausibility. A diverged run still produces an INS file, and
    # nanmean happily averages what is left, so without this gate the
    # instrument reports confident numbers from a destroyed solution. Learned
    # the hard way: the dx/2 and dx/4 intake-refinement runs NaN'd out of pipe
    # 33 (Bellmouth_6) and were reported as "G8 PASS, fresh charge 11.8 kg/s"
    # -- 184x physical -- before this existed.
    nan_cols = []
    if segs:
        sl_all = np.concatenate([np.arange(s, e) for s, e in segs])
        for pid, dists in stations.items():
            for dist, cmap in dists.items():
                for var, j in cmap.items():
                    col = df.iloc[sl_all, j].to_numpy(dtype=float)
                    if not np.all(np.isfinite(col)):
                        nan_cols.append(f"pipe{pid}@{dist}:{var}")
    all_segs = cycle_segments(ang, 10 ** 6)
    if len(segs) < 3:
        return {"rpm": rpm, "error": f"only {len(segs)} complete cycles"}

    res = {
        "rpm": rpm, "run_dir": os.path.basename(wd),
        "cycles_total": len(all_segs), "cycles_used": len(segs),
        "gates": {"G0_label_mapping": {"ok": not bad, "mismatches": bad},
                  "G9_finite": {"ok": not nan_cols, "n_nan_columns": len(nan_cols),
                                "examples": nan_cols[:8]}},
        "stations": {}, "m1": {}, "m2": {}, "m4": {}, "m5": {},
    }

    name = {}     # label -> {dist: {...}}
    resid_max = 0.0
    for pid, dists in sorted(stations.items()):
        lab = labels.get(pid, f"pipe{pid}")
        g = geom.get(pid)
        per = {}
        for dist, cmap in sorted(dists.items()):
            if "P" not in cmap:
                continue
            sl = np.concatenate([np.arange(s, e) for s, e in segs])
            P = df.iloc[sl, cmap["P"]].to_numpy(dtype=float)
            V = df.iloc[sl, cmap["V"]].to_numpy(dtype=float) if "V" in cmap else None
            T = df.iloc[sl, cmap["T"]].to_numpy(dtype=float) if "T" in cmap else None
            F = df.iloc[sl, cmap["F"]].to_numpy(dtype=float) if "F" in cmap else None
            d = {
                "dist_m": dist,
                "mean_P_bar": float(np.nanmean(P)),
                "pp_P_mbar": float((np.nanmax(P) - np.nanmin(P)) * 1000.0),
                "rms_P_mbar": float(np.nanstd(P) * 1000.0),
                "mean_F_kgs": None if F is None else float(np.nanmean(F)),
                "absmean_F_kgs": None if F is None else float(np.nanmean(np.abs(F))),
                "mean_T_degC": None if T is None else float(np.nanmean(T)),
                "mean_V_ms": None if V is None else float(np.nanmean(V)),
                "area_m2": None if g is None else area_at(g, dist),
                "cols": {k: int(v) for k, v in cmap.items()},
            }
            if T is not None:
                d["a_ms"] = float(np.sqrt(_G_RUN * _R_RUN * (d["mean_T_degC"] + 273.15)))
            if V is not None and T is not None:
                Xp, Xm, pd_, pi_, a, resid = characteristics(P, V, T)
                resid_max = max(resid_max, resid)
                d["char"] = {"Xp_rms": float(np.nanstd(Xp)),
                             "Xm_rms": float(np.nanstd(Xm))}
                # G2: solver's own TipoVar 6/7, when the deck requested them
                if "PD" in cmap and "PI" in cmap:
                    PD = df.iloc[sl, cmap["PD"]].to_numpy(dtype=float)
                    PI = df.iloc[sl, cmap["PI"]].to_numpy(dtype=float)
                    def _rel(x, y):
                        den = np.nanmax(np.abs(y))
                        return float(np.nanmax(np.abs(x - y)) / den) if den > 0 else None
                    d["char"]["G2_rel_p_der"] = _rel(pd_, PD)
                    d["char"]["G2_rel_p_izq"] = _rel(pi_, PI)
                    # G2 gate: gamma=1.4 must agree to <1% (measured 0.1-0.8%),
                    # and the gamma that closes it must be a physical gas value
                    gg, ge = implied_gamma(P, V, T, PD)
                    d["char"]["gamma_implied"] = gg
                    d["char"]["G2_rel_at_implied_gamma"] = ge
            per[dist] = d
        if per:
            res["stations"][lab] = per
            name[lab] = per

    res["gates"]["G1_char_identity_resid"] = resid_max
    # G2 is scoped to the TRACT stations -- the ones the reflection/transfer
    # analysis actually uses. On the low-amplitude eq-rail stubs a *relative*
    # error is dominated by noise in a near-zero denominator and the implied
    # gamma is degenerate, so including them would only measure the instrument's
    # own conditioning, not the decomposition.
    _tract_re = re.compile(r"^(Bellmouth_\d+|Runner_(Upper|Lower)_\d+|Port_In_\d+_1)$")
    g2 = [(v.get("char") or {}) for lab, per in name.items() if _tract_re.match(lab)
          for v in per.values()]
    g2 = [c for c in g2 if "G2_rel_p_der" in c]
    if g2:
        worst14 = max(max(c["G2_rel_p_der"], c["G2_rel_p_izq"]) for c in g2)
        gs = [c["gamma_implied"] for c in g2 if c.get("gamma_implied")]
        res["gates"]["G2_reconstruction"] = {
            "scope": "tract stations (bellmouth / runner / port)",
            "n_stations": len(g2),
            "worst_rel_at_gamma_1.4": worst14,
            "worst_rel_at_implied_gamma": max(c.get("G2_rel_at_implied_gamma") or 0 for c in g2),
            "gamma_implied_range": [min(gs), max(gs)] if gs else None,
            # The gate asks: does the offline decomposition reproduce the
            # SOLVER's characteristics? -> residual at the implied gamma. The
            # gamma=1.4 residual is reported separately because it measures the
            # fixed-gamma approximation, not the method. Bounds 1.28-1.42 span
            # hot burnt gas to dry air; anything outside is a fit failure.
            "ok": bool(max(c.get("G2_rel_at_implied_gamma") or 1 for c in g2) < 0.01
                       and gs and all(1.28 < g < 1.42 for g in gs)),
        }
    # G8 is filled in after M1/M2 (needs the flow + thermal numbers)

    # ---------------- M1: mass balance ----------------
    def mean_F(lab, end):
        p = name.get(lab)
        if not p:
            return None
        k = min(p) if end == 0 else max(p)
        return p[k]["mean_F_kgs"]

    mouths = [mean_F(f"Bellmouth_{i}", 0) for i in range(1, 7)]
    mouths_far = [mean_F(f"Bellmouth_{i}", 1) for i in range(1, 7)]
    lowers = [mean_F(f"Runner_Lower_{i}", 0) for i in range(1, 7)]
    taps = [mean_F(f"EqRail_Tap_{i}", 0) for i in range(1, 7)]
    # Stage 81: the snorkel station is the AMBIENT end of whichever duct
    # representation is fitted (taper -> CSL_Intake_Pipe, jet/core -> Duct_Core,
    # stair -> Duct_Seg_1). All three are the pipe whose x=0 sits on the
    # Type-11 to Ambient_Intake, which is what "does the airbox breathe
    # atmosphere?" actually asks.
    snork = next((v for v in (mean_F("CSL_Intake_Pipe", 0),
                              mean_F("Duct_Core", 0),
                              mean_F("Duct_Seg_1", 0)) if v is not None), None)
    rail_ret = mean_F("EqRail_Return", 1)      # far end = the ICV -> plenum tee
    head_ret = mean_F("Head_Return", 0)
    air = engine_air(df, segs, os.path.join(wd, "run.log"), rpm)
    mdot = air["fresh_charge_kgs"]

    def _div(i):
        a, b = mouths_far[i], lowers[i]
        return None if (a is None or b is None or abs(a) < 1e-9) else 1.0 - b / a

    ok = [m for m in mouths if m is not None]
    res["m1"] = {
        "mouth_mean_F_kgs": mouths,
        "mouth_reversal_count": sum(1 for m in ok if m < 0),
        "mouth_sum_kgs": float(sum(ok)) if ok else None,
        "mouth_abssum_kgs": float(sum(abs(m) for m in ok)) if ok else None,
        "circulation_ratio": (float(sum(abs(m) for m in ok) / abs(sum(ok)))
                              if ok and abs(sum(ok)) > 1e-9 else None),
        "tap_diversion": [_div(i) for i in range(6)],
        "tap_mean_F_kgs": taps,
        "snorkel_net_kgs": snork,
        "rail_return_kgs": rail_ret,
        "head_return_kgs": head_ret,
        "engine_air": air,
        "engine_mdot_kgs": mdot,
        # CLOSURE: what fraction of the engine's fresh charge actually comes
        # through the six trumpet mouths. 1.0 = the trumpets ARE the intake.
        "closure": (float(sum(ok) / mdot) if ok and mdot else None),
        # the snorkel is the only path to atmosphere: in a converged cycle it
        # must carry the whole fresh charge
        "snorkel_closure": (float(snork / mdot) if snork is not None and mdot else None),
    }

    # ---- ⚡ CONSERVATION AUDIT (Stage 80's central measurement) ----
    # A pipe's cycle-mean mass flow must be identical at both ends in a steady
    # cycle -- its content is periodic, so nothing can accumulate. Measuring the
    # violation per pipe, against that pipe's cells (L/dx) and area ratio, is
    # what localises the defect. Measured at 2400: every Type-12 tee closes to
    # 0.000000 and every straight pipe to <=0.3%, while CSL_Intake_Pipe (area
    # ratio 3.69 over 8 cells) is out by 132% and EqRail_Tap (phi30->21 over 1.2
    # cells) by 16%. Total leak 0.117 kg/s vs an engine fresh charge of 0.064.
    cons = []
    for lab, per in name.items():
        if len(per) < 2:
            continue
        g = next((geom[pid] for pid in geom if labels.get(pid) == lab), None)
        lo, hi = min(per), max(per)
        m0, m1 = per[lo]["mean_F_kgs"], per[hi]["mean_F_kgs"]
        if m0 is None or m1 is None:
            continue
        sc = max(abs(m0), abs(m1), 1e-12)
        cons.append({
            "pipe": lab, "mean_x0": m0, "mean_xL": m1,
            "err_kgs": abs(m1 - m0), "err_rel": abs(m1 - m0) / sc,
            "length_m": g["length"] if g else None,
            "dx_m": g["dx_mesh"] if g else None,
            "cells": (max(1.0, g["length"] / g["dx_mesh"]) if g and g["dx_mesh"] else None),
            "area_ratio": ((g["d_end"] / g["d_start"]) ** 2 if g and g["d_start"] else None),
        })
    cons.sort(key=lambda c: -c["err_kgs"])
    tot = sum(c["err_kgs"] for c in cons)
    # Stage 81: axial profile for any pipe carrying >2 stations (--dense).
    # This is the measurement that decides boundary-node vs interior-scheme:
    # the conservative update runs i=1..FNin-2 and BOTH end nodes are
    # overwritten by the MOC boundary solve, so if the mass appears between
    # x=0 and the first interior station it is the boundary; if it accrues
    # evenly along x it is the interior scheme.
    prof = {}
    for lab, per in name.items():
        if len(per) <= 2:
            continue
        g = next((geom[pid] for pid in geom if labels.get(pid) == lab), None)
        xs = sorted(per)
        pts = [{"x_m": x, "mean_F_kgs": per[x]["mean_F_kgs"],
                "mean_T_degC": per[x].get("mean_T_degC"),
                "mean_P_bar": per[x].get("mean_P_bar")} for x in xs]
        steps = [(pts[i + 1]["x_m"], (pts[i + 1]["mean_F_kgs"] - pts[i]["mean_F_kgs"]))
                 for i in range(len(pts) - 1)
                 if pts[i]["mean_F_kgs"] is not None and pts[i + 1]["mean_F_kgs"] is not None]
        tot_step = sum(abs(d) for _, d in steps) or 1e-12
        prof[lab] = {
            "length_m": g["length"] if g else None,
            "dx_m": g["dx_mesh"] if g else None,
            "cells": (max(1.0, g["length"] / g["dx_mesh"]) if g and g["dx_mesh"] else None),
            "points": pts,
            "d_mdot_per_interval": [{"x_to_m": x, "d_kgs": d, "share": abs(d) / tot_step}
                                    for x, d in steps],
            "first_interval_share": (abs(steps[0][1]) / tot_step) if steps else None,
        }
    res["m1"]["axial_profile"] = prof
    res["m1"]["conservation"] = {
        "total_err_kgs": tot,
        "total_err_vs_fresh": (float(tot / mdot) if mdot else None),
        "worst": cons[:10],
        "n_pipes": len(cons),
    }

    # ---- the single most direct test of "where does the air go" ----
    # Plenum_Main has exactly four kinds of port: filter outlet (in), the six
    # trumpet mouths (out), the eq-rail ICV return, and the head return. In a
    # steady cycle  filter + rail + head == sum(mouths). Each term's SHARE of
    # the total inflow says which path the engine actually breathes through.
    filt = mean_F("CSL_Panel_Filter", 1)
    terms = {"filter_out": filt, "rail_return": rail_ret, "head_return": head_ret}
    have = {k: v for k, v in terms.items() if v is not None}
    if have and ok:
        inflow = sum(have.values())
        res["m1"]["plenum_balance"] = {
            "terms_kgs": have,
            "inflow_sum_kgs": float(inflow),
            "mouth_sum_kgs": float(sum(ok)),
            "residual_kgs": float(inflow - sum(ok)),
            "residual_rel": (float((inflow - sum(ok)) / abs(inflow))
                             if abs(inflow) > 1e-9 else None),
            "share_of_inflow": {k: (float(v / inflow) if abs(inflow) > 1e-9 else None)
                                for k, v in have.items()},
            "complete": len(have) == 3,
        }

    # ---------------- M2: thermal / sound speed ----------------
    # quarter-wave frequency of the composite tract from the ACTUAL travel time
    # tau = sum(L_i / a_i)  ->  f = 1/(4 tau). Length-weighting the sound speed
    # would be wrong here: the tract spans 170-380 degC.
    #
    # ⚠ A PARTIAL tract must NOT yield a quarter-wave number. The Stage-79 decks
    # monitored only 9 pipes (no Runner_Upper, no Port_In), so a naive sum gives
    # a 230 mm "tract" and a 656 Hz "resonance" that is pure artefact. Only
    # tracts with EVERY segment measured are reported.
    tracts, incomplete = {}, {}
    for i in range(1, 7):
        tau, Ltot, parts, miss = 0.0, 0.0, [], []
        for pat in TRACT:
            lab = pat.format(i=i)
            p = name.get(lab)
            g = next((geom[pid] for pid in geom if labels.get(pid) == lab), None)
            aa = [p[k].get("a_ms") for k in (p or {}) if p[k].get("a_ms")]
            if not p or g is None or not aa:
                miss.append(lab)
                continue
            a_m = float(np.mean(aa))
            L = float(g["length"])
            tau += L / a_m
            Ltot += L
            parts.append({"label": lab, "L_m": L, "a_ms": a_m,
                          "T_degC": float(np.mean([p[k]["mean_T_degC"] for k in p]))})
        if miss:
            incomplete[i] = {"missing": miss, "partial_L_m": Ltot}
        elif tau > 0:
            tracts[i] = {"tract_L_m": Ltot, "tau_s": tau,
                         "a_eff_ms": Ltot / tau, "f_quarter_hz": 1.0 / (4.0 * tau),
                         "parts": parts}
    fq = [t["f_quarter_hz"] for t in tracts.values()]
    res["m2"] = {
        "gas": {"R_JkgK": _R_RUN, "gamma": _G_RUN, "composition": _comp,
                "note": "from this deck's species vector, NOT hardcoded air"},
        "tracts": tracts,
        "tracts_incomplete": incomplete,
        "f_quarter_hz_mean": float(np.mean(fq)) if fq else None,
        "f_quarter_dev_vs_car": (float((np.mean(fq) - CAR_F_HZ) / CAR_F_HZ) if fq else None),
        "T_mouth_degC": (name.get("Bellmouth_1", {}).get(0.0, {}) or {}).get("mean_T_degC"),
        "T_per_cycle_mouth": [],
    }
    # per-cycle mouth temperature = the convergence check Stage 79 lacked
    b1 = name.get("Bellmouth_1", {})
    if b1:
        tj = b1[min(b1)]["cols"].get("T")
        if tj is not None:
            res["m2"]["T_per_cycle_mouth"] = [
                float(df.iloc[s:e, tj].to_numpy(dtype=float).mean()) for s, e in all_segs]
            tt = res["m2"]["T_per_cycle_mouth"]
            res["m2"]["T_slope_last_degC_per_cycle"] = (
                float(tt[-1] - tt[-2]) if len(tt) >= 2 else None)

    # ---------------- G8: is this cycle actually a STEADY state? ----------
    # ⚡ Nothing quantitative may be read out of a transient. The archived
    # Stage-79 runs fail this badly (residual fraction ranged -0.5% to 115.5%
    # across 8 runs, in/out imbalance 6-44%), which is why their closure and
    # tap-diversion numbers are indicative only. Two assumption-free tests:
    #   (a) intake air in == exhaust out over the cycle (+fuel, ~7%)
    #   (b) the mouth temperature has stopped drifting
    imb = air.get("in_out_imbalance")
    slope = res["m2"].get("T_slope_last_degC_per_cycle")
    res["gates"]["G8_steady"] = {
        "in_out_imbalance": imb,
        "T_slope_degC_per_cycle": slope,
        "ok": bool(imb is not None and abs(imb) < 0.12
                   and slope is not None and abs(slope) < 2.0),
        "note": "in/out |imbalance| < 0.12 and |dT/dcycle| < 2 degC. FAIL => "
                "M1/M2/M5 numbers are transient artefacts, not model properties.",
    }

    # ---------------- M4/M5: phase, coherence, reflection ----------------
    hz = bin_hz(np.arange(361), rpm)
    bm = band_mask(hz, *BAND)
    runner_F = {}

    # Spectra are also exported for the VALVE side of the tract, because the
    # excitation-independent observable is the TRANSFER |P(valve)|/|P(mouth)|
    # across the runner: a quarter-wave resonance peaks there at f_res whatever
    # the order content of the drive. Raw amplitude cannot separate the two.
    for i in range(1, 7):
        for lab, end in ((f"Port_In_{i}_1", 1), (f"Runner_Lower_{i}", 1),
                         (f"EqRail_Tap_{i}", 0)):
            p = name.get(lab)
            if not p:
                continue
            k = max(p) if end else min(p)
            Ps = df.iloc[:, p[k]["cols"]["P"]].to_numpy(dtype=float)
            Fx, _ = cyclic_spectra(Ps, ang, segs)
            cx = coherence(Fx)
            ax = np.abs(Fx.mean(axis=0))
            res["stations"][lab][k]["spectrum"] = [
                {"hz": round(float(bin_hz(kk, rpm)), 2),
                 "amp_mbar": round(float(ax[kk] * 1000.0), 3),
                 "coh": round(float(cx[kk]), 4)}
                for kk in range(1, min(len(cx), int(800.0 / (rpm / 120.0)) + 1))]

    for i in range(1, 7):
        p = name.get(f"Bellmouth_{i}")
        if not p:
            continue
        near = min(p)
        cmap = p[near]["cols"]
        Pser = df.iloc[:, cmap["P"]].to_numpy(dtype=float)
        F, _ = cyclic_spectra(Pser, ang, segs)
        runner_F[i] = F
        coh = coherence(F)
        amp = np.abs(F.mean(axis=0))
        st = res["stations"][f"Bellmouth_{i}"][near]
        st["coherence_band"] = _safe_mean(coh[bm[:len(coh)]])
        kmax = int(np.argmax(coh[1:len(coh)] * (np.abs(F).mean(axis=0)[1:] > 1e-6))) + 1
        st["coherence_peak"] = {"hz": float(bin_hz(kmax, rpm)),
                                "coherence": float(coh[kmax]),
                                "amp_mbar": float(amp[kmax] * 1000.0)}
        # ⚡ At ONE rpm the bin spacing is rpm/120 Hz (32.5 Hz at 3900), so the
        # 190-210 Hz band holds AT MOST ONE bin -- a "band mean" there is a
        # single sample, not a statistic. The resonance question can only be
        # answered by POOLING bins across rpm (amp/coherence vs Hz), so the
        # whole spectrum is exported and the envelope is built afterwards.
        st["spectrum"] = [
            {"hz": round(float(bin_hz(k, rpm)), 2), "order": round(k / 2.0, 2),
             "amp_mbar": round(float(amp[k] * 1000.0), 3),
             "coh": round(float(coh[k]), 4)}
            for k in range(1, min(len(coh), int(800.0 / (rpm / 120.0)) + 1))]
        if "V" in cmap and "T" in cmap:
            sl = np.arange(len(ang))
            Xp, Xm, *_ = characteristics(
                Pser, df.iloc[sl, cmap["V"]].to_numpy(dtype=float),
                df.iloc[sl, cmap["T"]].to_numpy(dtype=float))
            Fp, _ = cyclic_spectra(Xp, ang, segs)
            Fm, _ = cyclic_spectra(Xm, ang, segs)
            num = (Fp * np.conj(Fm)).sum(axis=0)
            den = (np.abs(Fm) ** 2).sum(axis=0)
            Rls = np.divide(num, den, out=np.zeros_like(num), where=den > 1e-30)
            Rsimple = np.abs(Fp.mean(axis=0)) / np.maximum(np.abs(Fm.mean(axis=0)), 1e-30)
            cohm = coherence(Fm)
            good = (cohm > 0.5)[:len(Rls)]
            res["m5"][f"Bellmouth_{i}"] = {
                "R_ls_band": _safe_mean(np.abs(Rls)[bm[:len(Rls)] & good[:len(Rls)]]),
                "R_simple_band": _safe_mean(Rsimple[bm[:len(Rsimple)] & good[:len(Rsimple)]]),
                "coherence_Xm_band": _safe_mean(cohm[bm[:len(cohm)]]),
                "n_bins_used": int(np.sum(bm[:len(Rls)] & good[:len(Rls)])),
            }
    if len(runner_F) >= 2:
        keys = sorted(runner_F)
        pairs = {}
        for a_ in keys:
            for b_ in keys:
                if b_ <= a_:
                    continue
                Fa, Fb = runner_F[a_], runner_F[b_]
                cross = (Fa * np.conj(Fb)).sum(axis=0)
                g2 = (np.abs(cross) ** 2 /
                      np.maximum((np.abs(Fa) ** 2).sum(axis=0) *
                                 (np.abs(Fb) ** 2).sum(axis=0), 1e-60))
                ph = np.degrees(np.angle(cross))
                sel = bm[:len(g2)]
                pairs[f"{a_}-{b_}"] = {"gamma2_band": _safe_mean(g2[sel]),
                                       "phase_band_deg": _safe_mean(ph[sel])}
        res["m4"] = {"band_hz": list(BAND), "runner_pairs": pairs,
                     "df_hz": rpm / 120.0,
                     "n_bins_in_band": int(np.sum(bm)),
                     "coherence_band_mean": _safe_mean(
                         [res["stations"][f"Bellmouth_{i}"][min(name[f"Bellmouth_{i}"])]
                          ["coherence_band"] for i in runner_F])}
    return res


def _safe_mean(x):
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    return float(np.mean(x)) if x.size else None


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------
def run_cell(rpm, sets, cycles, tag, timeout, monitor_vars=None, n_cyc_use=8,
             dense=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    outp = os.path.join(OUT_DIR, f"{tag}_{int(rpm)}.json")
    if os.path.exists(outp):
        print(f"  [skip] {outp} exists")
        return json.load(open(outp, encoding="utf-8"))
    cal = calib.load(DATA_DIR)
    cfg = W.build_config(rpm, sets, cycles)
    W.coordinate_vanos(cfg, cal, rpm)
    wd = os.path.join(OUT_DIR, f"_run_{tag}_{int(rpm)}")
    labels, geom, mon = gen_deck(cfg, cal, wd, cycles, monitor_vars, dense)

    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    env = svc._build_sim_env(cal, is_wot=True, fast=False, load=100.0)
    env.pop("OPENWAM_FAST_OUTPUT", None)
    env["OMP_NUM_THREADS"] = "1"
    for k, v in os.environ.items():
        if k.startswith("OPENWAM_MOUTH_RAD") or k.startswith("OPENWAM_EQ_") \
                or k in ("OPENWAM_NO_THROTTLE", "OPENWAM_PORT_TWALL"):
            env[k] = v
    exe = os.environ.get("OPENWAM_EXE") or BIN
    print(f"  [run ] {tag} {rpm} WOT, {cycles} cyc, mon={len(mon)} pipes, "
          f"vars={monitor_vars or '0 1 2 3'}\n         bin={exe}", flush=True)
    run_capped([exe, "cell.wam"], wd, os.path.join(wd, "run.log"), timeout, env)

    res = census(wd, rpm, labels, geom, n_cyc_use=n_cyc_use)
    res["tag"] = tag
    res["sets"] = sets or {}
    res["cycles_requested"] = cycles
    res["binary"] = exe
    res["binary_sig"] = _bin_sig(exe)
    res["env_result"] = {k: env.get(k) for k in _RESULT_ENV}
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    return res


def _bin_sig(p):
    try:
        s = os.stat(p)
        return f"{s.st_size}:{int(s.st_mtime)}"
    except OSError:
        return "nobin"


# ---------------------------------------------------------------------------
# PC-3 self test (no solver)
# ---------------------------------------------------------------------------
def self_test():
    """PC-3: inject a synthetic wave and verify amplitude / phase / coherence.

    Catches sampling, windowing and cycle-segmentation bugs before any physical
    conclusion is drawn from the pipeline.
    """
    rpm = 3900.0
    n_cyc, n = 8, 700          # 700 != 720 on purpose: force the interpolation
    ang = np.concatenate([np.linspace(0, 720, n, endpoint=False) for _ in range(n_cyc)])
    ang += np.random.default_rng(0).normal(0, 0.03, ang.shape)   # sampling jitter
    t = np.arange(len(ang)) * (120.0 / rpm) / n
    f0, amp0, ph0 = 8.0 * rpm / 120.0, 0.05, 37.0                # bin 8, 0.05 bar
    x = amp0 * np.cos(2 * np.pi * f0 * t + np.radians(ph0))
    segs = cycle_segments(ang, n_cyc)
    F, _ = cyclic_spectra(x, ang, segs)
    coh = coherence(F)
    k = 8
    a_meas = float(np.abs(F.mean(axis=0))[k])
    p_meas = float(np.degrees(np.angle(F.mean(axis=0)[k])))
    d_amp = abs(a_meas - amp0) / amp0
    d_ph = abs(((p_meas - ph0 + 180) % 360) - 180)
    ok = (d_amp < 0.02) and (d_ph < 2.0) and (coh[k] > 0.95)
    print("# PC-3 synthetic injection (no solver)")
    print(f"  segments      : {len(segs)} (expected {n_cyc})")
    print(f"  amplitude     : {a_meas:.5f} bar vs {amp0:.5f}  -> err {d_amp*100:.3f}%  (gate <2%)")
    print(f"  phase         : {p_meas:+.2f} deg vs {ph0:+.2f}  -> err {d_ph:.3f} deg (gate <2)")
    print(f"  coherence@bin8: {coh[k]:.4f}  (gate >0.95)")
    print(f"  bin 8 -> {bin_hz(k, rpm):.1f} Hz  (order {k/2:.1f})")
    print(f"  VERDICT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def envelope(tag, bin_hz_width=12.5, f_max=800.0):
    """Pool every (rpm, order) line onto a Hz axis -- the resonance test.

    ⚡ WHY THIS EXISTS. In steady periodic operation the spectrum is, by
    construction, a line spectrum at multiples of the firing frequency: there
    CANNOT be energy at a fixed Hz that is not an engine order, so Stage 79's
    "all peaks stick to orders, no fixed-Hz ridge -> no resonance" does not
    follow. A resonance appears as an ENVELOPE over those lines -- whichever
    order happens to land near f_res gets amplified -- and only becomes visible
    once lines from several rpm are pooled onto a common Hz axis.

    Three pooled quantities per Hz bin:
      amp_norm : mouth amplitude / that rpm's own spectral RMS (removes the
                 overall level so rpms are comparable)
      transfer : |P(valve end of the port)| / |P(mouth)| -- EXCITATION
                 INDEPENDENT. This is the one that decides the question.
      coh      : cycle-to-cycle phase lock
    """
    import glob
    files = sorted(glob.glob(os.path.join(OUT_DIR, f"{tag}_*.json")))
    rows = {}
    used = []
    for fp in files:
        try:
            r = json.load(open(fp, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if r.get("error") or "stations" not in r:
            continue
        rpm = r["rpm"]
        used.append((rpm, (r.get("gates", {}).get("G8_steady") or {}).get("ok")))
        for i in range(1, 7):
            mo = r["stations"].get(f"Bellmouth_{i}") or {}
            po = r["stations"].get(f"Port_In_{i}_1") or {}
            msp = next((v.get("spectrum") for v in mo.values() if v.get("spectrum")), None)
            psp = next((v.get("spectrum") for v in po.values() if v.get("spectrum")), None)
            if not msp:
                continue
            rms = math.sqrt(sum(s["amp_mbar"] ** 2 for s in msp)) or 1.0
            pmap = {s["hz"]: s["amp_mbar"] for s in (psp or [])}
            for s in msp:
                if s["hz"] > f_max:
                    continue
                b = int(s["hz"] // bin_hz_width)
                d = rows.setdefault(b, {"amp_norm": [], "coh": [], "transfer": [], "rpms": set()})
                d["amp_norm"].append(s["amp_mbar"] / rms)
                d["coh"].append(s["coh"])
                d["rpms"].add(rpm)
                pv = pmap.get(s["hz"])
                if pv is not None and s["amp_mbar"] > 1e-6:
                    d["transfer"].append(pv / s["amp_mbar"])
    if not rows:
        print(f"no usable {tag}_*.json in {OUT_DIR}")
        return
    print(f"# Stage 80 pooled envelope -- tag={tag}, {len(used)} runs")
    for rpm, ok in used:
        print(f"    {rpm:>6.0f} rpm  G8_steady={'PASS' if ok else 'FAIL'}")
    print(f"\n  {'Hz band':>12}  {'n':>4} {'rpm':>4}  {'amp_norm':>9} {'transfer':>9} {'coh':>6}")
    best = []
    for b in sorted(rows):
        d = rows[b]
        lo, hi = b * bin_hz_width, (b + 1) * bin_hz_width
        an, tr, ch = _safe_mean(d["amp_norm"]), _safe_mean(d["transfer"]), _safe_mean(d["coh"])
        mark = " <== car 197 Hz" if lo <= CAR_F_HZ < hi else ""
        print(f"  {lo:5.0f}-{hi:5.0f}  {len(d['amp_norm']):>4} {len(d['rpms']):>4}  "
              f"{_f(an, 4):>9} {_f(tr, 3):>9} {_f(ch, 3):>6}{mark}")
        if tr is not None and len(d["rpms"]) >= 2:
            best.append((tr, lo, hi, len(d["rpms"])))
    if best:
        best.sort(reverse=True)
        print("\n  top transfer bands (>=2 rpm, excitation-independent):")
        for tr, lo, hi, n in best[:5]:
            print(f"    {lo:5.0f}-{hi:5.0f} Hz  transfer={tr:.3f}  ({n} rpm)")


def reanalyze_tag(tag, sets, n_cyc_use=8):
    """Re-run census() over every retained _run_<tag>_<rpm> dir and OVERWRITE
    <tag>_<rpm>.json.

    Needed because a long census holds the module version it was launched with:
    instrument fixes landed mid-flight produce JSONs in mixed schemas. The
    INS.DAT is retained, so re-analysis is free and makes the whole set uniform.
    """
    import glob
    dirs = sorted(glob.glob(os.path.join(OUT_DIR, f"_run_{tag}_*")))
    for wd in dirs:
        m = re.search(r"_(\d+)$", os.path.basename(wd))
        if not m:
            continue
        rpm = float(m.group(1))
        outp = os.path.join(OUT_DIR, f"{tag}_{int(rpm)}.json")
        old = {}
        if os.path.exists(outp):
            try:
                old = json.load(open(outp, encoding="utf-8"))
            except ValueError:
                old = {}
        labels, geom, _ = discover_geometry(rpm, sets)
        r = census(wd, rpm, labels, geom, n_cyc_use=n_cyc_use)
        # carry the provenance the analysis pass cannot reconstruct
        for k in ("tag", "sets", "cycles_requested", "binary", "binary_sig", "env_result"):
            if k in old:
                r[k] = old[k]
        r.setdefault("tag", tag)
        r["reanalysed"] = True
        with open(outp, "w", encoding="utf-8") as f:
            json.dump(r, f, indent=1)
        print(f"  [re-analysed] {os.path.basename(outp)}")


def summary(tag):
    """One row per rpm: the Stage-80 verdict table."""
    import glob
    files = sorted(glob.glob(os.path.join(OUT_DIR, f"{tag}_*.json")),
                   key=lambda p: json.load(open(p, encoding="utf-8")).get("rpm", 0))
    print(f"# Stage 80 census summary -- tag={tag}")
    print(f"  {'rpm':>5} {'cyc':>6} {'G8':>5} {'imbal':>7} {'dT/cyc':>7} {'T_mouth':>8} "
          f"{'rev':>4} {'closure':>8} {'snork':>7} {'tapdiv':>7} {'f_q Hz':>7} {'vs197':>7}")
    for fp in files:
        r = json.load(open(fp, encoding="utf-8"))
        if r.get("error"):
            print(f"  {r.get('rpm', 0):>5.0f}  ERROR {r['error']}")
            continue
        g8 = r["gates"].get("G8_steady") or {}
        m1, m2 = r["m1"], r["m2"]
        td = [v for v in m1["tap_diversion"] if v is not None]
        print(f"  {r['rpm']:>5.0f} {r['cycles_used']:>2}/{r['cycles_total']:<3} "
              f"{'PASS' if g8.get('ok') else 'FAIL':>5} "
              f"{_f(g8.get('in_out_imbalance')):>7} {_f(g8.get('T_slope_degC_per_cycle'), 2):>7} "
              f"{_f(m2.get('T_mouth_degC'), 1):>8} {m1['mouth_reversal_count']:>2}/6 "
              f"{_f(m1['closure']):>8} {_f(m1['snorkel_closure']):>7} "
              f"{_f(_safe_mean(td)):>7} {_f(m2.get('f_quarter_hz_mean'), 1):>7} "
              f"{_f((m2.get('f_quarter_dev_vs_car') or 0) * 100, 1):>6}%")
    print("\n  gates: G8 PASS = |in/out imbalance|<0.12 and |dT/dcyc|<2 degC")
    print("  closure = sum(mouth flows) / engine fresh charge  (1.0 = the trumpets ARE the intake)")
    print("  snork   = snorkel net / engine fresh charge       (1.0 = the airbox breathes atmosphere)")


def print_mouth_cc(sets):
    """SKIP_CC numbers for the six trumpet mouths, read from the generator.

    FNumeroCC = deck cid + 1 (Source/Boundaries/TCondicionContorno.cpp:51; the
    comment at TCCRamificacion.cpp:275 says so explicitly). Never hardcode
    these -- read them, then verify at runtime with OPENWAM_MOUTH_RADDIAG=1.
    """
    _, _, gen = discover_geometry(3900, sets)
    mouths = []
    for i in range(1, 7):
        cid = gen._box_cc_map.get(f"Bellmouth_{i}.mouth")
        if cid is not None:
            mouths.append(cid + 1)
    t11 = [cid + 1 for cid in sorted(gen.connections)
           if gen.connections[cid][0] == 11]
    others = [c for c in t11 if c not in mouths]
    print("# Stage 80 -- MOUTH_RAD_SKIP_CC candidates (solver FNumeroCC = deck cid + 1)")
    print(f"  trumpet mouths      : {','.join(map(str, mouths))}")
    print(f"  all Type-11         : {','.join(map(str, t11))}")
    print(f"  non-mouth Type-11   : {','.join(map(str, others))}")
    print("\n# C1 (mouths exempt, parasitic paths still damped):")
    print(f"  OPENWAM_MOUTH_RAD_SKIP_CC={','.join(map(str, mouths))}")
    print("# C2 (complement -- mouths damped, parasitic paths exempt):")
    print(f"  OPENWAM_MOUTH_RAD_SKIP_CC={','.join(map(str, others))}")
    print("\n# verify at runtime: OPENWAM_MOUTH_RADDIAG=1 -> exempted CCs must NOT")
    print("# appear in the 'MOUTHRAD CC<n>' lines of run.log.")


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------
def report(r):
    if r.get("error"):
        print(f"  {r.get('rpm')}: ERROR {r['error']}")
        return
    rpm = r["rpm"]
    g, m1, m2 = r["gates"], r["m1"], r["m2"]
    print(f"\n# ===== {r.get('tag', '?')} @ {rpm} rpm  "
          f"({r['cycles_used']}/{r['cycles_total']} cycles used) =====")
    print(f"  G0 label mapping : {'OK' if g['G0_label_mapping']['ok'] else 'MISMATCH ' + str(g['G0_label_mapping']['mismatches'])}")
    print(f"  G1 char sanity   : {g['G1_char_identity_resid']:.2e} (algebraic; not a validity gate)")
    g2 = g.get("G2_reconstruction")
    if g2:
        print(f"  G2 p+/p- vs solver: {'PASS' if g2['ok'] else '*** FAIL ***'}  worst rel "
              f"{g2['worst_rel_at_gamma_1.4']:.2e} at gamma=1.4, "
              f"{g2['worst_rel_at_implied_gamma']:.2e} at implied gamma "
              f"{g2['gamma_implied_range'][0]:.4f}-{g2['gamma_implied_range'][1]:.4f}")
    g9 = g.get("G9_finite") or {}
    print(f"  G9 finite        : {'PASS' if g9.get('ok') else '*** FAIL ***'}"
          + ("" if g9.get("ok") else
             f"  {g9.get('n_nan_columns')} NaN columns e.g. {g9.get('examples')}"))
    if not g9.get("ok", True):
        print("     -> the run DIVERGED. Every number below is meaningless.")
    g8 = g.get("G8_steady") or {}
    print(f"  G8 STEADY        : {'PASS' if g8.get('ok') else '*** FAIL ***'}  "
          f"in/out imbalance {_f(g8.get('in_out_imbalance'))}, "
          f"dT/dcyc {_f(g8.get('T_slope_degC_per_cycle'), 2)} degC")
    if not g8.get("ok"):
        print("     -> transient: M1/M2/M5 values below are NOT model properties.")

    print("\n  -- M1 mass balance --")
    mm = " ".join(f"{v:+.3f}" if v is not None else "  n/a " for v in m1["mouth_mean_F_kgs"])
    print(f"   mouth mean F  : {mm}  kg/s")
    print(f"   reversals     : {m1['mouth_reversal_count']}/6      "
          f"circulation |sum|/sum = {_f(m1['circulation_ratio'])}")
    td = " ".join(f"{v:.2f}" if v is not None else " n/a" for v in m1["tap_diversion"])
    print(f"   tap diversion : {td}")
    ea = m1["engine_air"]
    print(f"   snorkel net   : {_f(m1['snorkel_net_kgs'], 4)}  rail return {_f(m1['rail_return_kgs'], 4)}"
          f"  head return {_f(m1['head_return_kgs'], 4)}  kg/s")
    print(f"   engine fresh  : {_f(ea['fresh_charge_kgs'], 4)} kg/s   exh out "
          f"{_f(ea['exhaust_out_kgs'], 4)}   in/out imbalance {_f(ea['in_out_imbalance'], 3)}")
    print(f"   (Mtrap rate {_f(ea['mtrap_rate_kgs'], 4)} incl. residual "
          f"{_f((ea['residual_fraction'] or 0)*100, 1)}% -- NOT the closure denominator)")
    print(f"   CLOSURE mouth : {_f(m1['closure'], 3)}   snorkel {_f(m1['snorkel_closure'], 3)}"
          f"   (gate 0.95-1.05)")
    cv = m1.get("conservation")
    if cv:
        print(f"\n  -- ⚡ mass conservation per pipe (cycle-mean must match at both ends) --")
        print(f"   TOTAL leak  : {_f(cv['total_err_kgs'], 5)} kg/s = "
              f"{_f(cv['total_err_vs_fresh'], 2)}x the engine's fresh charge")
        print(f"   {'pipe':<18}{'cells':>6}{'A_L/A_0':>9}{'mean x0':>10}{'mean xL':>10}{'err':>9}{'%':>7}")
        _pf = m1.get("axial_profile") or {}
        for _lab, _p in _pf.items():
            print(f"\n  -- ⚡ axial profile: {_lab} "
                  f"(L={_p['length_m']*1000:.1f}mm, {_p['cells']:.0f} cells, "
                  f"{len(_p['points'])} stations) --")
            print(f"   {'x [mm]':>9}{'mean F':>11}{'dF from prev':>14}{'share':>8}"
                  f"{'T [C]':>8}")
            _prev = None
            _steps = {round(s["x_to_m"], 6): s for s in _p["d_mdot_per_interval"]}
            for _pt in _p["points"]:
                _s = _steps.get(round(_pt["x_m"], 6))
                print(f"   {_pt['x_m']*1000:>9.1f}{_pt['mean_F_kgs']:>11.5f}"
                      + (f"{_s['d_kgs']:>+14.5f}{_s['share']*100:>7.1f}%" if _s else f"{'':>22}")
                      + (f"{_pt['mean_T_degC']:>8.1f}" if _pt.get("mean_T_degC") is not None else ""))
            if _p["first_interval_share"] is not None:
                print(f"   -> first interval carries {_p['first_interval_share']*100:.1f}% of the "
                      f"total |dF|. BOUNDARY NODE if >>1/{len(_p['points'])-1} share, "
                      f"INTERIOR SCHEME if evenly spread.")
        print()
        for c in cv["worst"][:6]:
            print(f"   {c['pipe']:<18}{_f(c['cells'], 1):>6}{_f(c['area_ratio'], 2):>9}"
                  f"{c['mean_x0']:>10.5f}{c['mean_xL']:>10.5f}{c['err_kgs']:>9.5f}"
                  f"{c['err_rel']*100:>7.1f}")
    pb = m1.get("plenum_balance")
    if pb:
        sh = "  ".join(f"{k}={_f(v, 3)}" for k, v in pb["share_of_inflow"].items())
        print(f"   plenum balance: inflow {_f(pb['inflow_sum_kgs'], 4)} vs mouths "
              f"{_f(pb['mouth_sum_kgs'], 4)} kg/s  residual {_f(pb['residual_rel'], 3)}"
              f"{'' if pb['complete'] else '  [INCOMPLETE: unmonitored ports]'}")
        print(f"   inflow shares : {sh}")

    print("\n  -- M2 thermal / sound speed --")
    print(f"   T mouth       : {_f(m2['T_mouth_degC'], 1)} degC   "
          f"last-cycle slope {_f(m2.get('T_slope_last_degC_per_cycle'), 2)} degC/cyc")
    tp = m2.get("T_per_cycle_mouth") or []
    if tp:
        print("   T per cycle   : " + " ".join(f"{v:.0f}" for v in tp))
    if m2.get("tracts_incomplete"):
        miss = sorted({x for v in m2["tracts_incomplete"].values() for x in v["missing"]})
        print(f"   f_quarter     : NOT REPORTABLE -- tract incomplete, unmonitored: "
              f"{', '.join(miss[:6])}{' ...' if len(miss) > 6 else ''}")
    else:
        print(f"   f_quarter     : {_f(m2['f_quarter_hz_mean'], 1)} Hz   "
              f"vs car {CAR_F_HZ:.0f} Hz -> {_f((m2['f_quarter_dev_vs_car'] or 0)*100, 1)}%")
    for i, t in list(m2["tracts"].items())[:1]:
        for p in t["parts"]:
            print(f"     {p['label']:<16s} L={p['L_m']*1000:6.1f}mm  "
                  f"T={p['T_degC']:6.1f}C  a={p['a_ms']:6.1f}m/s")
        print(f"     tract L={t['tract_L_m']*1000:.1f}mm  a_eff={t['a_eff_ms']:.1f}m/s  "
              f"f={t['f_quarter_hz']:.1f}Hz")

    m4 = r.get("m4") or {}
    if m4:
        print(f"\n  -- M4 coherence ({BAND[0]:.0f}-{BAND[1]:.0f} Hz) --")
        print(f"   resolution    : df={_f(m4.get('df_hz'), 1)} Hz -> "
              f"{m4.get('n_bins_in_band')} bin(s) in band "
              f"{'[NOT a band statistic -- pool across rpm]' if (m4.get('n_bins_in_band') or 0) < 3 else ''}")
        print(f"   mouth coherence (mean): {_f(m4.get('coherence_band_mean'), 3)}")
        for k, v in list((m4.get("runner_pairs") or {}).items())[:5]:
            print(f"   runners {k}: gamma^2={_f(v['gamma2_band'], 3)}  "
                  f"phase={_f(v['phase_band_deg'], 1)} deg")
    for lab in sorted(r.get("m5") or {}):
        v = r["m5"][lab]
        print(f"   R({lab}) ls={_f(v['R_ls_band'], 3)} simple={_f(v['R_simple_band'], 3)} "
              f"coh={_f(v['coherence_Xm_band'], 3)} n={v['n_bins_used']}")


def _f(v, nd=3):
    return "n/a" if v is None else f"{v:.{nd}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpm", type=float, default=None)
    ap.add_argument("--rpms", default=None, help="comma list (runs sequentially)")
    ap.add_argument("--cycles", type=int, default=40,
                    help="Stage 80: 40 = the v2 convergence protocol. 14-cycle "
                         "results are NOT comparable with the VE sweep.")
    ap.add_argument("--n-cyc-use", type=int, default=8, help="tail cycles analysed")
    ap.add_argument("--tag", default="s80")
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--monitor-vars", default=None,
                    help='INS TipoVars, e.g. "0 1 2 3 6 7" to add the solver\'s '
                         'own p+/p- (G2 gate). Default "0 1 2 3".')
    ap.add_argument("--dense", default=None,
                    help="LABEL_PREFIX:N -- give those pipes N axial stations "
                         "instead of 2 (Stage 81: boundary node vs interior scheme)")
    ap.add_argument("--analyze", default=None, help="analyse an existing run dir")
    ap.add_argument("--print-mouth-cc", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--envelope", action="store_true",
                    help="pool <tag>_*.json onto a Hz axis (the resonance test)")
    ap.add_argument("--summary", action="store_true",
                    help="one-row-per-rpm verdict table over <tag>_*.json")
    ap.add_argument("--reanalyze-tag", action="store_true",
                    help="re-run census over every retained _run_<tag>_<rpm> dir "
                         "and overwrite <tag>_<rpm>.json (uniform schema)")
    args = ap.parse_args()

    sets = {}
    for s in args.set:
        k, _, v = s.partition("=")
        try:
            sets[k] = float(v)
        except ValueError:
            sets[k] = v

    if args.self_test:
        sys.exit(self_test())
    if args.envelope:
        envelope(args.tag)
        return
    if args.reanalyze_tag:
        reanalyze_tag(args.tag, sets, args.n_cyc_use)
        summary(args.tag)
        return
    if args.summary:
        summary(args.tag)
        return
    if args.print_mouth_cc:
        print_mouth_cc(sets)
        return
    if args.analyze:
        wd = args.analyze
        rpm = args.rpm
        if rpm is None:
            m = re.search(r"_(\d+)$", os.path.basename(os.path.normpath(wd)))
            if not m:
                sys.exit("cannot infer rpm from dir name; pass --rpm")
            rpm = float(m.group(1))
        labels, geom, _ = discover_geometry(rpm, sets)
        r = census(wd, rpm, labels, geom, n_cyc_use=args.n_cyc_use)
        r["tag"] = os.path.basename(os.path.normpath(wd))
        report(r)
        os.makedirs(OUT_DIR, exist_ok=True)
        outp = os.path.join(OUT_DIR, f"reanalysis_{r['tag']}.json")
        with open(outp, "w", encoding="utf-8") as f:
            json.dump(r, f, indent=1)
        print(f"\n  -> {outp}")
        return

    _dense = None
    if args.dense:
        _pfx, _, _n = args.dense.rpartition(":")
        if not _pfx or not _n.isdigit():
            raise SystemExit("--dense wants LABEL_PREFIX:N, e.g. Duct_Core:9")
        _dense = (_pfx, int(_n))

    rpms = ([float(x) for x in args.rpms.split(",") if x.strip()]
            if args.rpms else ([args.rpm] if args.rpm else [3900.0]))
    for rpm in rpms:
        r = run_cell(rpm, sets, args.cycles, args.tag, args.timeout,
                     args.monitor_vars, args.n_cyc_use, _dense)
        report(r)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Stage 64 — intake resonance census (wave_box_fft).

Places the model's intake resonances EMPIRICALLY from crank-angle traces at the
trumpet mouths, before/after the multi-cell airbox remodel. For each WOT cell:

  1. ORDER SPECTRUM of mouth pressure at each of the 6 bellmouth stations
     (engine orders 1.5 / 3 / 4.5 / 6, + Hz equivalents). The 1-deg INS sampling
     makes FFT bins exact engine orders.
  2. BANK-DIFFERENTIAL SPECTRUM: FFT of (mean P mouths 1-3 - mean P mouths 4-6).
     In the current 0D box this must be ~0 at ALL orders (perfect mixing: every
     mouth sees the same box pressure) -- after the cells remodel this is the
     DIRECT observable of the new internal box mode (predicted at order 4.5 for
     the open-box branch / order 1.5 for the baffled branch).
  3. FLOW-WEIGHTED SUPPLY METRIC per mouth: mean(P*V+)/mean(V+) - mean(P) over
     the analysis window (V+ = velocity INTO the runner) = the effective supply
     boost each cylinder's induction actually samples. Prediction: ~0/negative
     at 3900 today (the Helmholtz null), positive once the box mode exists.

Decks are generated through the SAME calibrated path as the app/run_cells_local
(VANOS coordination from calibration.json, sigma injection, ICV) with pipe
monitoring ON (FAST_OUTPUT off) at "1.0 <cycles>" (1-deg sampling). The run MUST
reach its natural end -- INS.DAT only flushes then -- so run_capped (no early
stop), omp1.

Usage:
  python wave_box_fft.py --rpms 2700,3900,4600,5300 [--cycles 16] [--tag base]
  python wave_box_fft.py --print-cc            # dump cid -> pipes/plenum map
  python wave_box_fft.py --print-cc --set intake.plenum_box.model=cells ...

Results: calib_data/stage64_wave/<tag>_<rpm>.json (+ a printed table). Resume:
existing JSONs are skipped.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import BIN, HERE, run_capped  # noqa: E402

sys.path.insert(0, HERE)
from app.models import SimConfig  # noqa: E402
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.output_parser import OpenWAMOutputParser  # noqa: E402
from app.simulator.simulation_service import SimulationService, _RESULT_ENV  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
SIM_DIR = os.path.dirname(HERE)
OUT_DIR = os.path.join(HERE, "calib_data", "stage64_wave")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))

# stations monitored for the census (mouth-side columns read at distance 0)
MON_RE = re.compile(r"^(Bellmouth_\d+|CSL_Intake_Pipe|CSL_Panel_Filter"
                    r"|PlenumConn_\d+|PlenumBox_\w+|Runner_Lower_1$)")
ORDERS = [1.5, 3.0, 4.5, 6.0, 7.5]


def _lut(m, rpm, load):
    rx, ly, v = m["x_axis"], m["y_axis"], m["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


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


def build_config(rpm, sets, cycles):
    cfg = SimConfig()
    cfg.engine.rpm = float(rpm)
    cfg.engine.throttle_position = 1.0     # WOT census
    cfg.simulation.duration_cycles = cycles
    cfg.exhaust.port_junction_vol = 0.0
    for dotted, val in (sets or {}).items():
        _apply_set(cfg, dotted, val)
    return cfg


def coordinate_vanos(cfg, cal, rpm):
    """Identical to run_cells_local: calibrated WOT VANOS + exhaust base."""
    intake_base = calib.intake_vanos_base(cal)
    ex_scale = calib.exvanos_scale(cal)
    intake_cam = _lut(MAPS["kf_evan1_soll"], rpm, 100.0)
    exhaust_cam = _lut(MAPS["kf_avan1_soll"], rpm, 100.0)
    base = calib.exvanos_base_for(cal, rpm, True, load=100.0)
    cfg.engine.vanos_intake_bias = float(intake_base - intake_cam)
    cfg.engine.vanos_exhaust_bias = float((float(base) - exhaust_cam) * ex_scale)


def gen_deck(cfg, cal, wd, cycles):
    """Discovery pass -> monitor pids -> real deck with 1-deg INS monitoring."""
    os.makedirs(wd, exist_ok=True)
    sigma_bp = calib.thr_sigma_points(cal)
    icv = calib.icv_sigma(cal)
    if icv is not None:
        cfg.intake.eq_tube.icv_sigma = icv

    disc = WAMGenerator(cfg, wd)
    disc._sigma_bp = sigma_bp
    with contextlib.redirect_stdout(io.StringIO()):
        disc.generate(ignition_timing=20.0)
    labels = {pid: disc.pipes[pid].get("label", f"pipe{pid}") for pid in disc.pipes}
    mon = sorted(pid for pid, lab in labels.items() if MON_RE.match(lab))

    gen = WAMGenerator(cfg, wd)
    gen._sigma_bp = sigma_bp
    gen._fast_output_override = False          # pipe monitoring ON
    gen._run_duration_override = f"1.0 {cycles}"  # 1-deg INS sampling, N cycles
    gen._monitor_pipe_ids = set(mon)
    with contextlib.redirect_stdout(io.StringIO()):
        deck = gen.generate(ignition_timing=20.0)
    with open(os.path.join(wd, "cell.wam"), "w") as f:
        f.write(deck)
    return labels, mon


def print_cc(sets):
    """Dump connection-id -> (type, attached pipes / plenum) for skip-CC use."""
    cfg = build_config(3900, sets, 16)
    cal = calib.load(DATA_DIR)
    sigma_bp = calib.thr_sigma_points(cal)
    gen = WAMGenerator(cfg, os.path.join(OUT_DIR, "_cc_probe"))
    os.makedirs(gen.output_dir, exist_ok=True)
    gen._sigma_bp = sigma_bp
    with contextlib.redirect_stdout(io.StringIO()):
        gen.generate(ignition_timing=20.0)
    labels = {pid: p.get("label", f"pipe{pid}") for pid, p in gen.pipes.items()}
    refs = {}
    for pid, p in gen.pipes.items():
        for side, key in (("L", "left_node"), ("R", "right_node")):
            refs.setdefault(p[key], []).append(f"{labels[pid]}.{side}")
    print("# cid  type  plenum/valve  attached-pipes   (deck cids are 0-based)")
    for cid in sorted(gen.connections):
        ctype, lines = gen.connections[cid]
        extra = ""
        if ctype == 11:
            extra = f"plenum={lines[0].split()[1]} valve={lines[1]}"
        print(f"  {cid:>3}  T{ctype:<2} {extra:<22} {', '.join(refs.get(cid, []))}")
    print("\n# Type-11 boundaries of interest:")
    for cid in sorted(gen.connections):
        ctype, lines = gen.connections[cid]
        if ctype != 11:
            continue
        att = ", ".join(refs.get(cid, []))
        if any(k in att for k in ("CSL_Panel_Filter", "CSL_Intake_Pipe",
                                  "Bellmouth", "EqRail_Return", "PlenumConn")):
            print(f"  cid {cid}: {att}  ({lines})")
    print("\n# NOTE: verify deck-cid <-> solver FNumeroCC once via OPENWAM_MOUTH_RADDIAG.")


def analyze(df, labels, mon, rpm, n_cyc_use=8):
    """Order spectra + bank differential + flow-weighted supply metric."""
    cols = [str(c) for c in df.columns]
    ang_j = next((j for j, c in enumerate(cols) if c.startswith("Angle")), 1)
    re_pp = re.compile(r"^P_duct_(\d+)_at_([0-9.]+)_m\(")
    re_pv = re.compile(r"^V_duct_(\d+)_at_([0-9.]+)_m\(")
    pipe_p, pipe_v = {}, {}
    for j, c in enumerate(cols):
        m = re_pp.match(c)
        if m:
            pipe_p.setdefault(int(m.group(1)), []).append((float(m.group(2)), j))
        m = re_pv.match(c)
        if m:
            pipe_v.setdefault(int(m.group(1)), []).append((float(m.group(2)), j))

    # last n_cyc_use complete cycles, concatenated (steady rpm -> contiguous)
    ang = df.iloc[:, ang_j].to_numpy()
    starts = [0] + [i for i in range(1, len(ang))
                    if ang[i] == ang[i] and ang[i] < ang[i - 1] - 1.0]
    starts.append(len(ang))
    segs = [(starts[k], starts[k + 1]) for k in range(len(starts) - 1)]
    lens = sorted(e - s for s, e in segs if e > s)
    med = lens[len(lens) // 2]
    full = [(s, e) for s, e in segs if (e - s) >= 0.9 * med]
    use = full[-n_cyc_use:]
    if len(use) < 3:
        return {"error": f"only {len(use)} complete cycles"}
    C = len(use)
    idx = np.concatenate([np.arange(s, e) for s, e in use])

    def mouth_cols(pid):
        """(P_col, V_col) at distance 0 = plenum/mouth side."""
        ps = sorted(pipe_p.get(pid, []))
        vs = sorted(pipe_v.get(pid, []))
        return (ps[0][1] if ps else None), (vs[0][1] if vs else None)

    def orders_of(x):
        x = x - np.mean(x)
        # truncate each cycle to a common length L so FFT bins are exact orders
        L = min(e - s for s, e in use)
        chunks = []
        off = 0
        for s, e in use:
            n = e - s
            chunks.append(x[off:off + L])
            off += n
        xx = np.concatenate(chunks)
        F = np.fft.rfft(xx)
        amp = np.abs(F) * 2.0 / len(xx)
        # bin k = k cycles per C-cycle window; order = k / (2C)
        out = {}
        for o in ORDERS:
            k = o * 2 * C
            if abs(k - round(k)) < 1e-9 and int(round(k)) < len(amp):
                out[str(o)] = float(amp[int(round(k))])
        # dominant order (k>0)
        kmax = int(np.argmax(amp[1:])) + 1
        out["dominant_order"] = kmax / (2.0 * C)
        out["dominant_amp"] = float(amp[kmax])
        return out

    res = {"rpm": rpm, "cycles_used": C, "stations": {}, "hz_per_order": rpm / 60.0}
    mouths = {}
    for pid in mon:
        lab = labels[pid]
        pj, vj = mouth_cols(pid)
        if pj is None:
            continue
        P = df.iloc[idx, pj].to_numpy(dtype=float)
        V = df.iloc[idx, vj].to_numpy(dtype=float) if vj is not None else None
        st = {"orders_P": orders_of(P), "mean_P": float(np.nanmean(P))}
        if V is not None:
            for sgn, name in ((1.0, "supply_metric_Vpos"), (-1.0, "supply_metric_Vneg")):
                Vp = np.clip(sgn * V, 0.0, None)
                den = float(np.nansum(Vp))
                st[name] = (float(np.nansum(P * Vp) / den - np.nanmean(P))
                            if den > 1e-9 else None)
        res["stations"][lab] = st
        mb = re.match(r"^Bellmouth_(\d+)$", lab)
        if mb:
            mouths[int(mb.group(1))] = P

    if all(k in mouths for k in range(1, 7)):
        bankA = np.mean([mouths[k] for k in (1, 2, 3)], axis=0)
        bankB = np.mean([mouths[k] for k in (4, 5, 6)], axis=0)
        res["bank_differential"] = orders_of(bankA - bankB)
        res["bank_differential_rms"] = float(np.std(bankA - bankB))
        res["box_mean_rms"] = float(np.std((bankA + bankB) / 2 - np.mean((bankA + bankB) / 2)))
    return res


def run_cell(rpm, sets, cycles, tag, timeout):
    outp = os.path.join(OUT_DIR, f"{tag}_{int(rpm)}.json")
    if os.path.exists(outp):
        print(f"  [skip] {outp} exists")
        return json.load(open(outp))
    cal = calib.load(DATA_DIR)
    cfg = build_config(rpm, sets, cycles)
    coordinate_vanos(cfg, cal, rpm)
    wd = os.path.join(OUT_DIR, f"_run_{tag}_{int(rpm)}")
    labels, mon = gen_deck(cfg, cal, wd, cycles)

    svc = SimulationService(data_dir=DATA_DIR, simulator_dir=SIM_DIR)
    env = svc._build_sim_env(cal, is_wot=True, fast=False, load=100.0)
    env.pop("OPENWAM_FAST_OUTPUT", None)
    env["OMP_NUM_THREADS"] = "1"
    print(f"  [run ] {tag} {rpm} WOT, {cycles} cyc, mon={len(mon)} pipes ...", flush=True)
    run_capped([BIN, "cell.wam"], wd, os.path.join(wd, "run.log"), timeout, env)

    ins = os.path.join(wd, "cellINS.DAT")
    if not os.path.exists(ins):
        res = {"rpm": rpm, "error": "no INS.DAT (run did not reach natural end)"}
    else:
        df = OpenWAMOutputParser.parse_ins_dat(ins)
        res = analyze(df, labels, mon, rpm)
        res["tag"] = tag
        res["sets"] = sets or {}
        res["env_result"] = {k: env.get(k) for k in _RESULT_ENV}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(outp, "w") as f:
        json.dump(res, f, indent=1)
    return res


def report(results):
    print("\n# ==== intake resonance census ====")
    print("# per-mouth order amplitudes (bar) at engine orders; supply metric = "
          "flow-weighted mouth P boost (bar)")
    for r in results:
        if r.get("error"):
            print(f"  {r.get('rpm')}: ERROR {r['error']}")
            continue
        rpm = r["rpm"]
        hz = r["hz_per_order"]
        bd = r.get("bank_differential", {})
        print(f"\n  -- {rpm} rpm (order 4.5 = {4.5*hz:.0f} Hz, 1.5 = {1.5*hz:.0f} Hz) --")
        b1 = r["stations"].get("Bellmouth_1", {})
        if b1:
            o = b1["orders_P"]
            print(f"   Bellmouth_1 P orders: " +
                  " ".join(f"o{k}={o.get(str(k), 0)*1000:.1f}mbar" for k in ORDERS) +
                  f"  dom=o{o['dominant_order']:.2f}({o['dominant_amp']*1000:.1f}mbar)")
            sm = b1.get("supply_metric_Vpos")
            print(f"   supply metric (V+ into runner): "
                  f"{'None' if sm is None else f'{sm*1000:+.1f} mbar'}")
        if bd:
            print(f"   BANK DIFFERENTIAL: rms={r['bank_differential_rms']*1000:.2f}mbar "
                  f"(box-mean rms={r['box_mean_rms']*1000:.1f}mbar)  orders: " +
                  " ".join(f"o{k}={bd.get(str(k), 0)*1000:.2f}mbar" for k in (1.5, 4.5, 7.5)) +
                  f"  dom=o{bd['dominant_order']:.2f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpms", default="2700,3900,4600,5300")
    ap.add_argument("--cycles", type=int, default=16)
    ap.add_argument("--tag", default="base")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--set", action="append", default=[],
                    help="dotted SimConfig override (e.g. intake.plenum_box.model=cells)")
    ap.add_argument("--print-cc", action="store_true")
    args = ap.parse_args()
    sets = {}
    for s in args.set:
        k, _, v = s.partition("=")
        sets[k] = v
    if args.print_cc:
        print_cc(sets)
        return
    results = []
    for rpm in [int(x) for x in args.rpms.split(",") if x.strip()]:
        results.append(run_cell(rpm, sets, args.cycles, args.tag, args.timeout))
    report(results)


if __name__ == "__main__":
    main()

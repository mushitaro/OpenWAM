#!/usr/bin/env python3
"""Stage 86 -- per-junction mass balance from the C++ MASS_AUDIT trace.

WHY THIS EXISTS
---------------
Every leak number before Stage 85 was measured by sampling pipe-END NODES from
INS.DAT. Those nodes carry MOC boundary *reconstructions*, not the fluxes the
conservative update actually used, so the node-sampled "TOTAL leak" is not a
mass balance at all (retracted in Stage 82/85).

This script uses the only quantity in the solver that IS a mass flux: the TVD
interface flux ``FTVD.gflux[0][i]``, time-integrated in TTubo.cpp under
``OPENWAM_MASS_AUDIT`` and printed as MASSAUDIT FL/FR (left/right END
interfaces) and FM (mid interface). Those are the fluxes that move mass between
interior cells, so a balance built from them is exact by construction for the
interior and exposes exactly what the boundary/junction treatment fabricates.

THE TEST
--------
For a junction (boundary condition) whose members are all pipes and which has
no storage of its own -- Type 6 (union), 9/10 (pressure loss), 12 (branch) --
the mass it hands to the pipe interiors must sum to zero over a whole number of
cycles in a periodic state:

    inflow_to_interior(pipe p at its LEFT  end) = +dFL(p)
    inflow_to_interior(pipe p at its RIGHT end) = -dFR(p)
    imbalance(junction) = sum over members  ->  must be 0

Anything else is mass created (or destroyed) at that junction. Reported in kg/s
and as a fraction of the engine's own fresh-charge rate.

Type 11 (pipe<->plenum) and 7/8 (cylinder valve) DO have storage on the far
side, so they are reported separately as terminals, not as closure failures.

CALIBRATION (Stage 85, same instrument): quiescent = machine-exact,
Sod 2-pipe = 0.014%, engine-driven 2-pipe = 0.01-0.03%, 10:1 mesh mismatch =
0.03-0.11%, T12 tee = 0.23-0.33%. So >~0.5% here is a real signal.

Usage:
    python scripts/junction_audit.py --tag s85_noeq [--rpm 2400] [--tail 10]
    python scripts/junction_audit.py --run-dir <dir> --rpm 2400
"""
import argparse
import contextlib
import io
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wave_box_fft as W  # noqa: E402
from _local import HERE  # noqa: E402

sys.path.insert(0, HERE)
from app.simulator import calibration_constants as calib  # noqa: E402
from app.simulator import metrics as M  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
OUT_DIR = os.path.join(HERE, "calib_data", "stage80_acoustics")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8"))

AUD_RE = re.compile(
    r"^MASSAUDIT pipe=(\d+) t=([-\d.eE+]+) nin=(\d+) M=([-\d.eE+]+) "
    r"dM_L=([-\d.eE+]+) dM_R=([-\d.eE+]+) "
    r"FL=([-\d.eE+]+) FR=([-\d.eE+]+) FM=([-\d.eE+]+)")

# junctions with no storage of their own -> must close exactly
CLOSED_TYPES = {6, 9, 10, 12}
TYPE_NAME = {0: "open", 1: "open", 2: "open", 3: "closed(BROKEN)", 4: "anechoic",
             5: "pulse", 6: "union", 7: "cyl-valve", 8: "cyl-valve",
             9: "dp-linear", 10: "dp-quad", 11: "plenum", 12: "branch"}


def topology(rpm, sets, cycles):
    """Rebuild the deck's topology in-process (no solver run).

    Returns (labels, geom, conn_type) where geom[pid] has left_node/right_node
    = the 0-based CC ids the pipe's two ends attach to.
    """
    cal = calib.load(DATA_DIR)
    cfg = W.build_config(rpm, sets, cycles)
    W.coordinate_vanos(cfg, cal, rpm)
    ign = M.ignition_for(MAPS, cfg.engine.rpm, cfg.engine.throttle_position * 100.0)
    wd = os.path.join(OUT_DIR, "_topo_tmp")
    os.makedirs(wd, exist_ok=True)
    icv = calib.icv_sigma(cal)
    if icv is not None:
        cfg.intake.eq_tube.icv_sigma = icv
    gen = WAMGenerator(cfg, wd)
    gen._sigma_bp = calib.thr_sigma_points(cal)
    with contextlib.redirect_stdout(io.StringIO()):
        gen.generate(ignition_timing=ign)
    labels = {pid: gen.pipes[pid].get("label", f"pipe{pid}") for pid in gen.pipes}
    geom = {pid: dict(gen.pipes[pid]) for pid in gen.pipes}
    cids = sorted(gen.connections.keys())
    assert cids == list(range(len(cids))), f"non-contiguous cids: {cids[:5]}..."
    conn_type = {cid: gen.connections[cid][0] for cid in cids}
    return labels, geom, conn_type


def parse_audit(path):
    """run.log -> {pipe: [(t, M, dM_L, dM_R, FL, FR, FM), ...]} (cumulative)."""
    rows = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("MASSAUDIT"):
                continue
            m = AUD_RE.match(line)
            if not m:
                continue
            pid = int(m.group(1))
            rows.setdefault(pid, []).append(tuple(float(m.group(i))
                                                 for i in range(2, 10)))
    return rows


def window(rows, tail):
    """Difference the cumulative accumulators over the last `tail` reports.

    Returns (dt, {pipe: dict of window integrals}). Only pipes present in every
    report are used, and the window is the SAME wall-clock interval for all of
    them (the reports are emitted on a shared FAuditNextT schedule).
    """
    n = min(len(v) for v in rows.values())
    assert n > tail + 1, f"only {n} audit reports; need > {tail + 1}"
    i0, i1 = n - 1 - tail, n - 1
    t0 = rows[min(rows)][i0][0]
    t1 = rows[min(rows)][i1][0]
    dt = t1 - t0
    out = {}
    # indexed by the printf order: t nin M dM_L dM_R FL FR FM
    for pid, v in rows.items():
        a, b = v[i0], v[i1]
        out[pid] = {
            "nin": int(b[1]),
            "dM": b[2] - a[2],
            "dM_L": b[3] - a[3],
            "dM_R": b[4] - a[4],
            "dFL": b[5] - a[5],
            "dFR": b[6] - a[6],
            "dFM": b[7] - a[7],
            "t0": a[0], "t1": b[0],
        }
    return dt, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=None)
    ap.add_argument("--rpm", type=float, default=2400.0)
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--tail", type=int, default=10, help="audit reports in window")
    ap.add_argument("--top", type=int, default=14)
    ap.add_argument("--json-out", default=None)
    a = ap.parse_args()

    if a.run_dir:
        wd = a.run_dir
        sets, cycles = {}, 40
        if a.tag:
            j = json.load(open(os.path.join(OUT_DIR, f"{a.tag}_{int(a.rpm)}.json"),
                               encoding="utf-8"))
            sets, cycles = j.get("sets") or {}, j.get("cycles_requested", 40)
    else:
        assert a.tag, "--tag or --run-dir required"
        jp = os.path.join(OUT_DIR, f"{a.tag}_{int(a.rpm)}.json")
        j = json.load(open(jp, encoding="utf-8"))
        wd = os.path.join(OUT_DIR, j["run_dir"])
        sets, cycles = j.get("sets") or {}, j.get("cycles_requested", 40)
        a.rpm = j.get("rpm", a.rpm)

    log = os.path.join(wd, "run.log")
    rows = parse_audit(log)
    assert rows, f"no MASSAUDIT lines in {log} (was OPENWAM_MASS_AUDIT set?)"
    labels, geom, conn_type = topology(a.rpm, sets, cycles)
    missing = sorted(set(rows) - set(labels))
    assert not missing, f"audit pipes absent from rebuilt topology: {missing[:6]}"

    dt, win = window(rows, a.tail)
    print(f"\n=== junction audit: {a.tag or wd}  rpm={a.rpm:.0f} ===")
    print(f"  window {win[min(win)]['t0']:.4f} -> {win[min(win)]['t1']:.4f} s "
          f"({dt:.4f} s = {dt * a.rpm / 120.0:.1f} cycles), "
          f"{len(rows)} pipes, {len(conn_type)} connections")

    # ---- scale check: the cylinder-valve terminals must add up to the engine's air
    def ends_of(cid):
        out = []
        for pid, g in geom.items():
            if pid not in win:
                continue
            if g["left_node"] == cid:
                out.append((pid, "L"))
            if g["right_node"] == cid:
                out.append((pid, "R"))
        return out

    def inflow(pid, side):
        """Mass the junction DELIVERED into this pipe end, kg over the window.

        EXACT bookkeeping, no periodicity assumption. The end node is a half
        control volume fed by the junction and drained through the end interface:

            left  end:  J_L - dFL = dM_L   ->   J_L = dFL + dM_L
            right end:  dFR + J_R = dM_R   ->   J_R = dM_R - dFR

        dFL/dFR are the time-integrated TVD interface fluxes and dM_L/dM_R the
        end-node changes imposed by the MOC overwrite, both from MASSAUDIT. So
        J is what the junction actually handed over, and a storage-free junction
        must have sum(J) = 0 exactly -- valid even while the run is still
        cooling, which the flux-only form is not.
        """
        w = win[pid]
        return (w["dFL"] + w["dM_L"]) if side == "L" else (w["dM_R"] - w["dFR"])

    # ---- per-junction closure
    res = []
    for cid, ct in sorted(conn_type.items()):
        mem = ends_of(cid)
        if not mem:
            continue
        imb = sum(inflow(p, s) for p, s in mem)
        thru = sum(abs(inflow(p, s)) for p, s in mem)
        res.append({
            "cid": cid, "type": ct, "type_name": TYPE_NAME.get(ct, str(ct)),
            "n_pipes": len(mem),
            "members": [f"{labels[p]}:{s}" for p, s in mem],
            "imb_kg": imb, "imb_kgs": imb / dt,
            "thru_kg": thru, "rel": (abs(imb) / thru if thru > 0 else 0.0),
        })

    closed = [r for r in res if r["type"] in CLOSED_TYPES]
    term = [r for r in res if r["type"] not in CLOSED_TYPES]

    # ---- normalisation: the engine's own air, measured with the SAME instrument.
    # The intake-port valve CCs are the only path from the pipe network into the
    # cylinders, so their summed outflow IS the fresh charge. Using it as the
    # denominator makes every number below a pure ratio, so the (unpinned) unit
    # constant of gflux cancels exactly. Cross-checks against the INS mean flow
    # on straight, well-resolved pipes put that constant near 98 audit-units per
    # kg/s, but nothing here relies on it.
    def is_intake_valve(r):
        return r["type"] in (7, 8) and any(m.startswith("Port_In")
                                           for m in r["members"])

    eng = sum(-r["imb_kgs"] for r in term if is_intake_valve(r))
    exh = sum(r["imb_kgs"] for r in term
              if r["type"] in (7, 8) and any(m.startswith("Port_Ex")
                                             for m in r["members"]))
    print(f"  engine air (intake-valve terminals) = {eng:.6f} audit-u/s"
          f"   [normaliser = 1.000 x]")
    print(f"  exhaust out (exhaust-valve terminals) = {exh:.6f} "
          f"= {exh / eng if eng else 0:+.3f} x   (physical ~1.08 with fuel)")

    tot = sum(abs(r["imb_kgs"]) for r in closed)
    net = sum(r["imb_kgs"] for r in closed)
    denom = abs(eng) if abs(eng) > 1e-12 else 1.0
    print(f"\n  STORAGE-FREE JUNCTIONS ({len(closed)} of types 6/9/10/12)")
    print(f"    sum |imbalance| = {tot / denom:.4f} x engine air")
    print(f"    net  imbalance  = {net / denom:+.4f} x engine air")

    print(f"\n  worst {a.top} storage-free junctions:")
    print("    cid  type      rel      x_eng     members")
    for r in sorted(closed, key=lambda r: -abs(r["imb_kgs"]))[:a.top]:
        print(f"    {r['cid']:>3}  {r['type_name']:<8} {r['rel'] * 100:>6.2f}%  "
              f"{r['imb_kgs'] / denom:>+8.4f}  {','.join(r['members'])}")

    print(f"\n  terminals (storage on the far side -- NOT a closure failure):")
    for r in sorted(term, key=lambda r: -abs(r["imb_kgs"]))[:a.top]:
        print(f"    {r['cid']:>3}  {r['type_name']:<8}           "
              f"{r['imb_kgs'] / denom:>+8.4f}  {','.join(r['members'])}")

    # ---- per-pipe book closure: dM ~= (dFL - dFR) + dM_L + dM_R
    # A nonzero residual means mass entered the pipe through NEITHER an interface
    # flux NOR a boundary overwrite -- i.e. the positivity fallback / Transforma2Area
    # floor caps (TTubo.cpp:1606/1652/1689, :6450-6485). BUT a pipe that is still
    # filling or cooling has a legitimately nonzero dM, so this column is only
    # interpretable once G8 (steady) passes.
    print(f"\n  per-pipe book residual  dM - [(dFL-dFR) + dM_L + dM_R]  "
          f"(worst {a.top}; x_eng = fraction of the engine's air):")
    pr = []
    for pid, w in win.items():
        r = w["dM"] - ((w["dFL"] - w["dFR"]) + w["dM_L"] + w["dM_R"])
        sc = max(abs(w["dFL"]), abs(w["dFR"]), 1e-30)
        pr.append((abs(r) / sc, r / dt, pid))
    for rel, rate, pid in sorted(pr, reverse=True)[:a.top]:
        print(f"    {labels[pid]:<22} nin={win[pid]['nin']:>3}  "
              f"rel={rel * 100:>8.2f}%  x_eng={rate / denom:>+9.4f}")

    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as f:
            json.dump({"tag": a.tag, "rpm": a.rpm, "dt": dt, "engine_air": eng,
                       "sum_abs_imb_kgs": tot, "net_imb_kgs": net,
                       "junctions": res}, f, indent=1)
        print(f"\n  wrote {a.json_out}")


if __name__ == "__main__":
    main()

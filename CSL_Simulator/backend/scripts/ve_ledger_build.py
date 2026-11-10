#!/usr/bin/env python3
"""Real-car VE ledger from TUNER's archived sessions (2026-11-10).

Reads every process=VE session under the TUNER archive in place (log.json +
session.json + base.bin), verifies the BASE SHA, and bins steady closed-loop
samples onto the KF_RF_SOLL axes. The measured air of one sample is
rf x stft x ltft in ECU rf units (%): the DME fuels RF = kf_rf_soll x
RF_PT_KORR x rf_korr, so the trim says how far the real air was from RF.
That product does not depend on which KF_RF_SOLL the car carried, which is
why sessions on different BINs may be pooled (their VANOS tables are checked
to be identical).

The selection rules are the pre-registered ones in
build/ve_accuracy_20261110/PREREG.md. No identifiers (VIN etc.) are written.

    python ve_ledger_build.py [--archive DIR] [--out DIR]
"""
import argparse
import bisect
import glob
import hashlib
import json
import math
import os
import statistics as st
import struct
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.calibration_maps import extract_vanos  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ARCHIVE = os.path.join(os.path.dirname(REPO), "E46M3CSL_TuningTool", "archive", "d1")
OUT = os.path.join(REPO, "build", "ve_accuracy_20261110")

# TUNER's opening correction (APP_CONFIG.MSS54HP.INTERPOLATION_TABLE): the DME
# looks KF_RF_SOLL up at rawLoad / factor(rpm). Every archived session carries
# this same table in tuneSettings; it is re-read per session and checked.
DEFAULT_FACTOR = [(0, .7), (900, .7), (1100, .7), (1300, .75), (1400, .8), (1600, .85),
                  (1800, .9), (2100, .95), (2400, 1.0), (3000, 1.0), (3900, 1.0),
                  (7000, 1.0), (8000, 1.0), (10000, 1.0)]

HALF = 3            # +-3 samples = 7-sample steadiness window
RPM_TOL = 60.0
RO_REL, RO_ABS = 0.15, 0.2
WIN_MAX_S = 4.0
COOLANT_MIN = 75.0
MIN_ROWS_PER_SESSION = 15
RPM_LO, RPM_HI = 1700, 3500     # rows considered; scored nodes are 1800..3100
RHO_REF = 1.136                  # K_RF_LUFTDICHTE, kg/m3


def sha(b):
    return hashlib.sha256(b).hexdigest()


def rf_table(img):
    return {"rpm": list(struct.unpack_from(">20H", img, 0xD2FE)),
            "ro": [v * 100 / 32768 for v in struct.unpack_from(">24H", img, 0xD326)],
            "z": [v / 10 for v in struct.unpack_from(">480H", img, 0xD356)]}


def _w(axis, v):
    v = min(max(v, axis[0]), axis[-1])
    i = min(len(axis) - 2, max(0, bisect.bisect_right(axis, v) - 1))
    a = (v - axis[i]) / (axis[i + 1] - axis[i])
    return [(i, 1 - a), (i + 1, a)]


def bilinear(t, rpm, ro):
    return sum(wx * wy * t["z"][j * len(t["rpm"]) + i]
               for i, wx in _w(t["rpm"], rpm) for j, wy in _w(t["ro"], ro))


def vanos_at(m, rpm, ro):
    """Display-unit VANOS map, bilinear (DME convention), clamped to the axes."""
    x, y, v = m["x_axis"], m["y_axis"], m["values"]
    return sum(wx * wy * v[j][i] for i, wx in _w(x, rpm) for j, wy in _w(y, ro))


def factor_at(table, rpm):
    xs = [r for r, _ in table]
    return sum(w * table[i][1] for i, w in _w(xs, rpm))


def load_sessions(archive):
    """Dedupe by id; per id keep the folder whose log.json is largest."""
    best = {}
    for sp in glob.glob(os.path.join(archive, "*", "*", "session.json")):
        d = os.path.dirname(sp)
        lp = os.path.join(d, "log.json")
        if not os.path.exists(lp) or not os.path.exists(os.path.join(d, "base.bin")):
            continue
        sid = os.path.basename(d)
        n = os.path.getsize(lp)
        if sid not in best or n > best[sid][1]:
            best[sid] = (d, n)
    return [d for d, _ in best.values()]


def steady_rows(d, factor_tab):
    """Pre-registered steady/closed-loop filter. Returns (rows, exclusion counts)."""
    out, ex = [], Counter()
    for i, p in enumerate(d):
        r, ro = p.get("rpm"), p.get("rawLoad")
        if r is None or ro is None or p.get("rf") is None or p.get("stft1") is None:
            ex["missing"] += 1
            continue
        if not (RPM_LO <= r <= RPM_HI):
            continue
        ex["in_band"] += 1
        if (p.get("coolantTemp") or 0) < COOLANT_MIN:
            ex["cold"] += 1
            continue
        if i < HALF or i + HALF >= len(d):
            ex["edge"] += 1
            continue
        w = d[i - HALF:i + HALF + 1]
        if any(q.get("rpm") is None or q.get("rawLoad") is None for q in w):
            ex["window_gap"] += 1
            continue
        if abs(w[-1]["time"] - w[0]["time"]) > WIN_MAX_S or any(q.get("linkGapS") for q in w):
            ex["window_time"] += 1
            continue
        if max(abs(q["rpm"] - r) for q in w) > RPM_TOL:
            ex["rpm_unsteady"] += 1
            continue
        if max(abs(q["rawLoad"] - ro) for q in w) > max(RO_REL * ro, RO_ABS):
            ex["ro_unsteady"] += 1
            continue
        if p.get("lambdaFreeze"):
            ex["lambda_freeze"] += 1
            continue
        s1, s2 = p["stft1"], p.get("stft2", p["stft1"])
        if s1 == 1 and s2 == 1:
            ex["trim_pinned_1"] += 1
            continue
        l1, l2 = p.get("ltft1", 1) or 1, p.get("ltft2", 1) or 1
        fac = factor_at(factor_tab, r)
        out.append({"i": i, "rpm": r, "ro_raw": ro, "ro": ro / (fac or 1), "rf": p["rf"],
                    "b1": p["rf"] * s1 * l1, "b2": p["rf"] * s2 * l2,
                    "air": p["rf"] * (s1 + s2) / 2 * (l1 + l2) / 2,
                    "pamb": p.get("ambientPressure"), "tamb": p.get("ambientTemp"),
                    "psaug": p.get("pSaug"), "evan": p.get("evan1Ist"), "avan": p.get("avan1Ist"),
                    "lst": (p.get("lambdaState1"), p.get("lambdaState2"))})
        ex["kept"] += 1
    return out, ex


def rho(p_mbar, t_c):
    return p_mbar * 100 / (287.05 * (t_c + 273.15))


def med(v):
    v = [x for x in v if isinstance(x, (int, float)) and math.isfinite(x)]
    return st.median(v) if v else None


def build(archive, out):
    sessions, cells, vanos_hashes, table_hashes = [], defaultdict(lambda: defaultdict(list)), set(), {}
    lstate = Counter()
    ref_vanos = None
    axes = None
    for d in sorted(load_sessions(archive)):
        s = json.load(open(os.path.join(d, "session.json"), encoding="utf-8"))
        if s.get("process") != "VE":
            continue
        img = open(os.path.join(d, "base.bin"), "rb").read()
        h = sha(img)
        rec = {"seq": s.get("seq"), "dir": os.path.relpath(d, archive), "created_ms": s.get("createdAt"),
               "base_sha256": h, "base_sha_matches_record": h == s.get("baseSha256"),
               "base_origin": {k: v for k, v in (s.get("baseOrigin") or {}).items()
                               if k in ("kind", "which")},
               "flashes": [{"at_ms": f.get("at"), "sha256": f.get("sha256"), "tuned": f.get("tuned")}
                           for f in (s.get("flashHistory") or [])]}
        if not rec["base_sha_matches_record"]:
            rec["excluded"] = "base.bin SHA differs from session record"
            sessions.append(rec)
            continue
        vm = extract_vanos(img)
        vh = sha(json.dumps(vm, sort_keys=True).encode())
        vanos_hashes.add(vh)
        ref_vanos = ref_vanos or vm
        t = rf_table(img)
        axes = axes or (t["rpm"], t["ro"])
        if (t["rpm"], t["ro"]) != axes:
            rec["excluded"] = "KF_RF_SOLL axes differ"
            sessions.append(rec)
            continue
        table_hashes[h] = sha(img[0xD2FE:0xD356 + 960])[:12]
        rec["rf_soll_sha12"] = table_hashes[h]
        ftab = [(e["rpm"], e["factor"]) for e in
                ((s.get("tuneSettings") or {}).get("interpolationTable") or [])] or DEFAULT_FACTOR
        rec["factor_table_is_default"] = ftab == DEFAULT_FACTOR
        log = json.load(open(os.path.join(d, "log.json"), encoding="utf-8"))
        if isinstance(log, dict):
            log = log.get("data", [])
        rows, ex = steady_rows(log, ftab)
        rec["log_rows"] = len(log)
        rec["exclusions"] = dict(ex)
        day = None
        if s.get("createdAt"):
            import datetime
            day = datetime.datetime.fromtimestamp(s["createdAt"] / 1000,
                                                  datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d")
        rec["day_jst"] = day
        sessions.append(rec)
        X, Y = t["rpm"], t["ro"]
        for r in rows:
            lstate[r["lst"]] += 1
            xi = min(X, key=lambda x: abs(x - r["rpm"]))
            yi = min(Y, key=lambda y: abs(y - r["ro"]))
            k = bilinear(t, xi, yi) / bilinear(t, r["rpm"], r["ro"])
            r2 = dict(r, node_air=r["air"] * k, node_b1=r["b1"] * k, node_b2=r["b2"] * k, k=k,
                      node_rf=r["rf"] * k, t_node=bilinear(t, xi, yi))
            cells[(xi, yi)][(rec["seq"], day, h)].append(r2)

    if len(vanos_hashes) != 1:
        raise SystemExit(f"VANOS tables differ across BASE images ({len(vanos_hashes)}): pooling is not allowed")

    ledger = []
    for (x, y), by in sorted(cells.items()):
        per = []
        for (seq, day, h), rows in by.items():
            if len(rows) < MIN_ROWS_PER_SESSION:
                continue
            pa, ta = med([r["pamb"] for r in rows]), med([r["tamb"] for r in rows])
            per.append({"seq": seq, "day": day, "base_sha12": h[:12], "n": len(rows),
                        "air": st.mean(r["node_air"] for r in rows),
                        "air_raw_nearest": st.mean(r["air"] for r in rows),
                        "b1": st.mean(r["node_b1"] for r in rows), "b2": st.mean(r["node_b2"] for r in rows),
                        "rf": st.mean(r["rf"] for r in rows),
                        "rf_node": st.mean(r["node_rf"] for r in rows),
                        "table_node": rows[0]["t_node"],
                        "trim": st.mean(r["air"] / r["rf"] for r in rows if r["rf"]),
                        "k_mean": st.mean(r["k"] for r in rows),
                        "pamb": pa, "tamb": ta,
                        "rho": rho(pa, ta) if pa and ta is not None else None,
                        "ro_raw_med": med([r["ro_raw"] for r in rows]),
                        "rpm_med": med([r["rpm"] for r in rows]),
                        "map_ratio": med([r["psaug"] / r["pamb"] for r in rows if r["psaug"] and r["pamb"]]),
                        "evan_ist_live": med([r["evan"] for r in rows]),
                        "avan_ist_live": med([r["avan"] for r in rows])})
        if not per:
            continue
        airs = [p["air"] for p in per]
        mean = st.mean(airs)
        allrows = [r for rows in by.values() for r in rows]
        rec = {"rpm": x, "ro": round(y, 3),
               "n_sessions": len(per), "n_days": len({p["day"] for p in per}),
               "n_bases": len({p["base_sha12"] for p in per}),
               "n_rows": sum(p["n"] for p in per),
               "air": mean,
               "sd_between_sessions": st.stdev(airs) if len(airs) > 1 else None,
               "cv_pct": 100 * st.stdev(airs) / mean if len(airs) > 1 else None,
               "air_raw_nearest": st.mean(p["air_raw_nearest"] for p in per),
               "b1": st.mean(p["b1"] for p in per), "b2": st.mean(p["b2"] for p in per),
               "air_at_rho_ref": st.mean(p["air"] * RHO_REF / p["rho"] for p in per if p["rho"]),
               "pamb_med": med([r["pamb"] for r in allrows]), "tamb_med": med([r["tamb"] for r in allrows]),
               "ro_raw_med": med([r["ro_raw"] for r in allrows]),
               "rpm_med": med([r["rpm"] for r in allrows]),
               "map_ratio": med([r["psaug"] / r["pamb"] for r in allrows if r["psaug"] and r["pamb"]]),
               "evan_map_display": vanos_at(ref_vanos["kf_evan1_soll"], x, y),
               "avan_map_display": vanos_at(ref_vanos["kf_avan1_soll"], x, y),
               "evan_ist_display": (lambda v: None if v is None else 70 + v)(med([r["evan"] for r in allrows])),
               "avan_ist_display": (lambda v: None if v is None else 128 - v)(med([r["avan"] for r in allrows])),
               "sessions": per}
        rec["regime"] = ("throttled" if rec["map_ratio"] is not None and rec["map_ratio"] < 0.90
                         else "wave" if rec["map_ratio"] is not None else
                         ("throttled?" if y < 3 else "wave?"))
        ledger.append(rec)

    # BIN invariance: across sessions of one cell, the DME's rf follows its own
    # table (slope ~1 in log-log) while the real air rf x trim should not
    # (slope ~0). Pooled within-cell (cell means removed) regression.
    xs, yrf, yair = [], [], []
    for c in ledger:
        per = c["sessions"]
        if len(per) < 2:
            continue
        lt = [math.log(p["table_node"]) for p in per]
        lr = [math.log(p["rf_node"]) for p in per]
        la = [math.log(p["air"]) for p in per]
        mt, mr, ma = st.mean(lt), st.mean(lr), st.mean(la)
        xs += [v - mt for v in lt]
        yrf += [v - mr for v in lr]
        yair += [v - ma for v in la]
    sxx = sum(v * v for v in xs)

    def slope(y):
        if sxx <= 0:
            return None
        b = sum(a * c for a, c in zip(xs, y)) / sxx
        res = [c - b * a for a, c in zip(xs, y)]
        se = math.sqrt(sum(r * r for r in res) / max(1, len(xs) - 1) / sxx)
        return {"slope": b, "se": se, "n": len(xs)}

    invariance = {"rf_vs_table": slope(yrf), "air_vs_table": slope(yair),
                  "table_spread_sd_pct": 100 * math.sqrt(sxx / max(1, len(xs)))}

    os.makedirs(out, exist_ok=True)
    meta = {"bin_invariance": invariance,"archive": archive, "vanos_tables_identical": True, "vanos_sha12": sorted(vanos_hashes)[0][:12],
            "filter": {"half_window": HALF, "rpm_tol": RPM_TOL, "ro_rel": RO_REL, "ro_abs": RO_ABS,
                       "win_max_s": WIN_MAX_S, "coolant_min": COOLANT_MIN,
                       "min_rows_per_session": MIN_ROWS_PER_SESSION},
            "lambda_state_of_kept_rows": {str(k): v for k, v in lstate.most_common()},
            "sessions": sessions}
    json.dump({"meta": meta, "cells": ledger}, open(os.path.join(out, "ledger.json"), "w", encoding="ascii"),
              indent=1, ensure_ascii=True)
    cols = ["rpm", "ro", "regime", "n_sessions", "n_days", "n_bases", "n_rows", "air", "cv_pct",
            "air_raw_nearest", "b1", "b2", "air_at_rho_ref", "pamb_med", "tamb_med", "ro_raw_med",
            "map_ratio", "evan_map_display", "avan_map_display", "evan_ist_display", "avan_ist_display"]
    with open(os.path.join(out, "ledger_cells.csv"), "w", encoding="ascii", newline="") as f:
        f.write(",".join(cols) + "\n")
        for c in ledger:
            f.write(",".join("" if c[k] is None else (f"{c[k]:.4f}" if isinstance(c[k], float) else str(c[k]))
                             for k in cols) + "\n")
    return meta, ledger


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    meta, ledger = build(a.archive, a.out)
    ok = [c for c in ledger if c["n_sessions"] >= 2 and c["n_days"] >= 2]
    print(f"sessions {len(meta['sessions'])}, cells {len(ledger)}, cells >=2 sessions & >=2 days: {len(ok)}")
    print("lambda state of kept rows:", meta["lambda_state_of_kept_rows"])
    print("BIN invariance:", json.dumps(meta["bin_invariance"]))
    for c in ok:
        print(f"{c['rpm']:5d} {c['ro']:7.3f} {c['regime']:10s} s{c['n_sessions']:2d} d{c['n_days']} "
              f"b{c['n_bases']} n{c['n_rows']:5d} air {c['air']:6.2f} cv {c['cv_pct'] or 0:4.1f}% "
              f"map {c['map_ratio'] if c['map_ratio'] is None else round(c['map_ratio'], 3)}")


if __name__ == "__main__":
    main()

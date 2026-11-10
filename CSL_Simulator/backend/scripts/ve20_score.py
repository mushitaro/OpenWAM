#!/usr/bin/env python3
"""Score the current model against the real-car VE ledger (2026-11-10).

Table A: absolute error of the uncalibrated model, per frozen scoring cell,
next to the car's own session-to-session repeatability.
Table B: change-only prediction between neighbouring scoring cells,
car(c1) x model(c2)/model(c1), against the no-change baseline car(c1).
Plus: ambient-pressure elasticity (car within-cell vs model +-1%), the two
harness checks (determinism, ambient-T gate), within-session visit noise and
the drive list for what the archive cannot score.

Inputs (build/ve_accuracy_20261110): ledger.json, scored_cells.json,
model_cells.csv. Rules: PREREG.md. Writes score.json + score_tables.md.
"""
import csv
import hashlib
import json
import math
import os
import statistics as st
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ve_ledger_build as V  # noqa: E402

OUT = V.OUT


def load():
    led_raw = open(os.path.join(OUT, "ledger.json"), "rb").read()
    doc = json.load(open(os.path.join(OUT, "scored_cells.json"), encoding="ascii"))
    if hashlib.sha256(led_raw).hexdigest() != doc["ledger_sha256"]:
        raise SystemExit("ledger.json changed after the scoring cells were frozen")
    ledger = json.loads(led_raw)
    rows = list(csv.DictReader(open(os.path.join(OUT, "model_cells.csv"), newline="")))
    # PREREG amendment 2: harness early-NaN kills are replaced by their
    # CSL_NAN_KILL_POLLS=0 re-run, and marked.
    rerun_p = os.path.join(OUT, "model_cells_rerun.csv")
    if os.path.exists(rerun_p):
        rr = {r["tag"]: r for r in csv.DictReader(open(rerun_p, newline=""))}
        for i, r in enumerate(rows):
            if r["tag"] in rr:
                rows[i] = dict(rr[r["tag"]], early_killed="1")
    return ledger, doc, rows


def model_by_cell(rows):
    m = defaultdict(dict)
    for r in rows:
        _, rpm, ro, arm = r["tag"].split("_")
        m[(int(rpm), float(ro))][arm] = r
    return m


def failed(r):
    """PREREG amendment 1: failure = not converged / NaN / blow-up / cylinder
    collapse / timeout. The 30-160 VE band alone is not a failure."""
    if r is None:
        return "missing"
    if r["stop_reason"] == "timeout":
        return "timeout"
    if r["nan_free"] != "1":
        return "nan"
    if r["blew_up"] == "1":
        return "blew_up"
    if r["cyl_ok"] != "1":
        return "cylinder_collapse"
    if r["converged"] != "1":
        return "not_converged"
    return None


def visit_noise(cells):
    """Within-session spread of visit means (a visit = consecutive kept rows,
    a gap of more than 5 samples starts a new one): the noise an A/B drive in
    ONE session would face, against the between-session CV."""
    want = {(c["rpm"], c["ro"]) for c in cells}
    sds = defaultdict(list)
    for d in sorted(V.load_sessions(V.ARCHIVE)):
        s = json.load(open(os.path.join(d, "session.json"), encoding="utf-8"))
        if s.get("process") != "VE":
            continue
        img = open(os.path.join(d, "base.bin"), "rb").read()
        t = V.rf_table(img)
        ftab = [(e["rpm"], e["factor"]) for e in
                ((s.get("tuneSettings") or {}).get("interpolationTable") or [])] or V.DEFAULT_FACTOR
        log = json.load(open(os.path.join(d, "log.json"), encoding="utf-8"))
        rows, _ = V.steady_rows(log, ftab)
        visits = defaultdict(list)
        last = {}
        for r in rows:
            xi = min(t["rpm"], key=lambda x: abs(x - r["rpm"]))
            yi = round(min(t["ro"], key=lambda y: abs(y - r["ro"])), 3)
            if (xi, yi) not in want:
                continue
            k = V.bilinear(t, xi, yi) / V.bilinear(t, r["rpm"], r["ro"])
            if (xi, yi) not in last or r["i"] - last[(xi, yi)] > 5:
                visits[(xi, yi)].append([])
            visits[(xi, yi)][-1].append(r["air"] * k)
            last[(xi, yi)] = r["i"]
        for cell, vs in visits.items():
            means = [st.mean(v) for v in vs if len(v) >= 5]
            if len(means) >= 3:
                sds[cell].append(100 * st.stdev(means) / st.mean(means))
    return {f"{k[0]}/{k[1]}": {"sessions": len(v), "median_visit_cv_pct": st.median(v)}
            for k, v in sds.items()}


def _f(v, nd=1):
    return "—" if v is None else (f"{v:.{nd}f}" if isinstance(v, (int, float)) else str(v))


REG_JA = {"throttled": "低（<0.90）", "wave": "高（≥0.90）",
          "throttled?": "未記録（RO<3）", "wave?": "未記録（RO≥3）"}
FAIL_JA = {"nan": "NaN が末尾まで残る", "timeout": "時間切れ", "blew_up": "発散",
           "cylinder_collapse": "気筒の崩れ", "not_converged": "未収束", "missing": "結果なし"}


def write_md(out):
    L = ["## 表 A — 物理モデル単体（無調整）と実車",
         "",
         "実車 = rf × 短期補正 × 長期補正（ECU の rf 単位、%）をセッションごとに平均し、等しい重みで平均した値。"
         "ばらつき = セッション平均の変動係数。モデル = 大気圧 1.00 倍の回の末尾 10 周期平均（同じ単位）。"
         "幅 = 大気圧 ±1% の 3 回の最大−最小。",
         "",
         "| 回転 | RO | 平均吸気管圧 | 吸気管圧/大気圧 | セッション/日/BIN | 実車 | ばらつき % | モデル | 幅 | 誤差 % | 失敗 |",
         "|--:|--:|:--|--:|:--|--:|--:|--:|--:|--:|:--|"]
    for r in out["tableA"]:
        if not r["scored"]:
            continue
        fail = FAIL_JA.get(r["failure"], "") if r["failure"] else ""
        if r["failure"] and r["model_raw_ve"]:
            fail += f"（生の値 {r['model_raw_ve']:.1f}）"
        if r["early_killed_then_rerun"]:
            fail += " ※早期打ち切り→回し直し"
        L.append(f"| {r['rpm']} | {r['ro']} | {REG_JA[r['regime']]} | {_f(r['map_ratio_car'], 2)} | "
                 f"{r['n_sessions']}/{r['n_days']}/{r['n_bases']} | {_f(r['car'])} | {_f(r['car_cv_pct'])} | "
                 f"{_f(r['model'])} | {_f(r['model_pm1pct_range'])} | {_f(r.get('err_pct'), 0)} | {fail} |")
    L += ["", "参考（RO 1 未満、20 セルに数えない）:", "",
          "| 回転 | RO | 吸気管圧/大気圧 | 実車 | モデル | 誤差 % | 失敗 |", "|--:|--:|--:|--:|--:|--:|:--|"]
    for r in out["tableA"]:
        if r["scored"]:
            continue
        L.append(f"| {r['rpm']} | {r['ro']} | {_f(r['map_ratio_car'], 2)} | {_f(r['car'])} | {_f(r['model'])} | "
                 f"{_f(r.get('err_pct'), 0)} | {FAIL_JA.get(r['failure'], '') if r['failure'] else ''} |")
    L += ["", "## 表 B — 実車を基準に、モデルの変化分だけを使う予測", "",
          "予測 = 実車(元) × モデル(先)／モデル(元)。「変えない」= 実車(元)をそのまま先の予測にしたときの誤差。", "",
          "| 元 → 先 | 方向 | 実車の変化 % | モデルの変化 % | 予測の誤差 % | 変えない誤差 % |",
          "|:--|:--|--:|--:|--:|--:|"]
    for r in out["tableB"]:
        L.append(f"| {r['from']} → {r['to']} | {'回転' if r['axis'] == 'rpm' else '開度'} | "
                 f"{r['car_change_pct']:+.1f} | {r['model_change_pct']:+.1f} | {r['err_pct']:+.1f} | "
                 f"{r['naive_err_pct']:+.1f} |")
    open(os.path.join(OUT, "score_tables.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")


def main():
    ledger, doc, rows = load()
    M = model_by_cell(rows)
    led = {(c["rpm"], c["ro"]): c for c in ledger["cells"]}

    def ve(r):
        return float(r["ve"]) if r and r.get("ve") not in (None, "") else None

    tableA = []
    for c in doc["scored"] + doc["reference_ro_below_1"]:
        key = (c["rpm"], c["ro"])
        arms = M.get(key, {})
        r0 = arms.get("p100")
        f = failed(r0)
        car = led[key]
        mv = ve(r0)
        others = [ve(arms[a]) for a in ("p099", "p101") if arms.get(a) and not failed(arms[a])]
        band = [x for x in [mv] + others if x is not None and f is None]
        elast = None
        if arms.get("p099") and arms.get("p101") and not failed(arms["p099"]) and not failed(arms["p101"]):
            elast = math.log(ve(arms["p101"]) / ve(arms["p099"])) / math.log(1.01 / 0.99)
        row = {"rpm": c["rpm"], "ro": c["ro"], "scored": c["ro"] >= 1, "regime": c["regime"],
               "map_ratio_car": car["map_ratio"], "car": car["air"], "car_cv_pct": car["cv_pct"],
               "car_b1": car["b1"], "car_b2": car["b2"], "car_raw_nearest": car["air_raw_nearest"],
               "n_sessions": car["n_sessions"], "n_days": car["n_days"], "n_bases": car["n_bases"],
               "n_rows": car["n_rows"],
               "evan_map": c["evan_map_display"], "evan_ist": c["evan_ist_display"],
               "avan_map": c["avan_map_display"], "avan_ist": c["avan_ist_display"],
               "pamb": c["pamb_med"], "tamb": c["tamb_med"],
               "model": mv if f is None else None, "model_raw_ve": mv, "failure": f,
               "model_valid_flag": r0.get("valid") if r0 else None,
               "early_killed_then_rerun": bool(r0 and r0.get("early_killed")),
               "model_cycles": r0.get("cyc") if r0 else None,
               "model_osc_amp": r0.get("osc_amp") if r0 else None,
               "model_pm1pct_range": (max(band) - min(band)) if len(band) > 1 else None,
               "model_elasticity_p": elast}
        if f is None and mv is not None:
            row["err_pts"] = mv - car["air"]
            row["err_pct"] = 100 * (mv / car["air"] - 1)
        tableA.append(row)

    scored = [r for r in tableA if r["scored"]]
    ok = [r for r in scored if r.get("err_pct") is not None]

    def summ(rs):
        if not rs:
            return None
        e = [r["err_pct"] for r in rs]
        return {"n": len(rs), "median_err_pct": st.median(e), "median_abs_err_pct": st.median(map(abs, e)),
                "max_abs_err_pct": max(map(abs, e)), "median_car_cv_pct": st.median(r["car_cv_pct"] for r in rs)}

    summary = {"scored_cells": len(scored), "model_failures": sum(1 for r in scored if r["failure"]),
               "all": summ(ok),
               # regime = mean MAP/ambient < 0.90 vs >= 0.90 (a measured split, NOT
               # "throttle vs waves": the S54 has one throttle per cylinder and the
               # sensor reads the averaged eq-tube pressure, so a per-cylinder
               # throttle can still restrict at a mean ratio of 0.95).
               "map_below_0p90": summ([r for r in ok if r["regime"].startswith("throttled")]),
               "map_0p90_or_more": summ([r for r in ok if r["regime"].startswith("wave")]),
               "raw_values_incl_nan_failures": summ([dict(r, err_pct=100 * (r["model_raw_ve"] / r["car"] - 1))
                                                     for r in scored if r["model_raw_ve"]])}

    # Table B: neighbouring scored cells (same RO adjacent rpm node; same rpm adjacent RO node)
    good = {(r["rpm"], r["ro"]): r for r in ok}
    rpms = sorted({k[0] for k in led})
    ros = sorted({k[1] for k in led})
    pairs = []
    for (x, y) in good:
        xi, yi = rpms.index(x), ros.index(y)
        for nb in ([(rpms[xi + 1], y)] if xi + 1 < len(rpms) else []) + \
                  ([(x, ros[yi + 1])] if yi + 1 < len(ros) else []):
            if nb in good:
                pairs.append(((x, y), nb))
    tableB = []
    for a, b in sorted(pairs):
        A, B = good[a], good[b]
        for c1, c2 in ((A, B), (B, A)):
            pred = c1["car"] * c2["model"] / c1["model"]
            tableB.append({"from": f"{c1['rpm']}/{c1['ro']}", "to": f"{c2['rpm']}/{c2['ro']}",
                           "axis": "rpm" if a[1] == b[1] else "ro",
                           "car_change_pct": 100 * (c2["car"] / c1["car"] - 1),
                           "model_change_pct": 100 * (c2["model"] / c1["model"] - 1),
                           "err_pct": 100 * (pred / c2["car"] - 1),
                           "naive_err_pct": 100 * (c1["car"] / c2["car"] - 1)})
    b_summary = None
    if tableB:
        b_summary = {"n_directed_pairs": len(tableB),
                     "median_abs_err_pct": st.median(abs(r["err_pct"]) for r in tableB),
                     "median_abs_naive_err_pct": st.median(abs(r["naive_err_pct"]) for r in tableB),
                     "model_beats_naive": sum(abs(r["err_pct"]) < abs(r["naive_err_pct"]) for r in tableB),
                     "sign_agrees": sum((r["car_change_pct"] > 0) == (r["model_change_pct"] > 0) for r in tableB)}
        for ax in ("rpm", "ro"):
            rs = [r for r in tableB if r["axis"] == ax]
            if rs:
                b_summary[ax] = {"n": len(rs), "median_abs_err_pct": st.median(abs(r["err_pct"]) for r in rs),
                                 "median_abs_naive_err_pct": st.median(abs(r["naive_err_pct"]) for r in rs),
                                 "model_beats_naive": sum(abs(r["err_pct"]) < abs(r["naive_err_pct"]) for r in rs),
                                 "sign_agrees": sum((r["car_change_pct"] > 0) == (r["model_change_pct"] > 0)
                                                    for r in rs)}

    # car within-cell ambient-pressure elasticity (pooled, cell means removed)
    xs, ys = [], []
    for c in doc["scored"]:
        per = [p for p in led[(c["rpm"], c["ro"])]["sessions"] if p["pamb"]]
        if len(per) < 2:
            continue
        lx = [math.log(p["pamb"]) for p in per]
        ly = [math.log(p["air"]) for p in per]
        mx, my = st.mean(lx), st.mean(ly)
        xs += [v - mx for v in lx]
        ys += [v - my for v in ly]
    sxx = sum(v * v for v in xs)
    car_el = sum(a * b for a, b in zip(xs, ys)) / sxx if sxx else None
    car_el_se = (math.sqrt(sum((b - car_el * a) ** 2 for a, b in zip(xs, ys)) / (len(xs) - 1) / sxx)
                 if sxx else None)
    m_el = [r["model_elasticity_p"] for r in scored if r["model_elasticity_p"] is not None]
    ambient = {"car_elasticity": car_el, "car_elasticity_se": car_el_se, "car_n": len(xs),
               "car_pressure_span_sd_pct": 100 * math.sqrt(sxx / len(xs)) if xs else None,
               "model_elasticity_median": st.median(m_el) if m_el else None,
               "model_elasticity_range": [min(m_el), max(m_el)] if m_el else None}

    probe = M.get((2700, 7.495), {})
    checks = {}
    if probe.get("p100") and probe.get("dup"):
        checks["determinism_identical_ve"] = probe["p100"]["ve"] == probe["dup"]["ve"]
        checks["determinism_ve"] = [probe["p100"]["ve"], probe["dup"]["ve"]]
    if probe.get("p100") and probe.get("dT25"):
        a, b = ve(probe["p100"]), ve(probe["dT25"])
        checks["ambient_T_plus25K_change_pct"] = 100 * (b / a - 1) if a else None

    # drive list: RO 20..100 x rpm 1800..3100 (operator's range), from the ledger
    drive = []
    s0 = next(s for s in ledger["meta"]["sessions"] if "excluded" not in s)
    ax = V.rf_table(open(os.path.join(V.ARCHIVE, s0["dir"], "base.bin"), "rb").read())
    for x in [v for v in ax["rpm"] if 1800 <= v <= 3100]:
        for y in [round(v, 3) for v in ax["ro"] if 14.9 <= v <= 100]:
            c = led.get((x, y))
            drive.append({"rpm": x, "ro": round(y, 3), "sessions_with_15_rows": c["n_sessions"] if c else 0,
                          "days": c["n_days"] if c else 0})

    out = {"summary": summary, "tableA": tableA, "tableB": tableB, "tableB_summary": b_summary,
           "ambient": ambient, "checks": checks, "visit_noise": visit_noise(doc["scored"]),
           "bin_invariance": ledger["meta"]["bin_invariance"], "drive_list": drive}
    json.dump(out, open(os.path.join(OUT, "score.json"), "w", encoding="ascii"), indent=1)
    write_md(out)
    print(json.dumps({k: out[k] for k in ("summary", "tableB_summary", "ambient", "checks")}, indent=1))


if __name__ == "__main__":
    main()

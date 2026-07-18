"""WOT-pull analysis for real DS2 drive logs (Stage 76 P4 harness).

Extracts full-throttle pulls from a telemetry log and builds the measured
WOT fill curve rf(rpm), then compares it — density-corrected — against:

  - the ECU's stored WOT row (kf_rf_soll @ RO=100, the calibration target), and
  - the sim's WOT row (last_run_full_map @ RO=100, the v14 twin),

so the difference (corrected measured − sim) is the EMPIRICAL box-mode /
model-deficit profile per rpm. Also reports, per pull: sweep rate, VANOS
schedule vs the map through the sweep, per-cylinder ignition spread (knock
retard shows up as one cylinder retarded vs its bank), and data-quality
exclusions.

Inter-block skew: one LiveSample polls block 3 (rpm/rf/RO), then 19 (tz),
then 35 (MAP/VANOS) sequentially (~0.4s span at 2.4Hz). At a lift-off or
gearshift the halves disagree (RO still 100, MAP already collapsed). Samples
with RO>=WOT_RO but MAP < MAP_FLOOR are flagged "skew" and excluded from the
steady curve — rf may be genuine there but its pairing is not trustworthy.

Run:  cd CSL_Simulator/backend && python scripts/analyze_wot_pull.py <log_id> [...]
      (no args = every non-mock log that contains WOT samples)
"""
import json
import os
import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "data")
WOT_RO = 85.0          # RO threshold for "full load" (map row 85.01 upward)
MAP_FLOOR = 800.0      # mbar; below this at WOT-RO = inter-block skew artifact
MIN_PULL = 2           # samples; the valley is visited in short 2-sample stabs
GAP_TOL = 1            # samples allowed to dip below WOT_RO inside one pull
SHIFT_DROP = 150.0     # rpm drop between samples = gearshift -> split the pull
BIN_RPM = 150.0        # fine grid for the measured curve
R_AIR = 287.0
EVAN_OFFSET = 70.0     # map = live + 70   (measured convention)
AVAN_SUM = 128.0       # map = 128 - live  (measured convention, inverted)


def _interp1(axis, v):
    """Index pair + weight for linear interpolation, clamped at the ends."""
    if v <= axis[0]:
        return 0, 0, 0.0
    if v >= axis[-1]:
        return len(axis) - 1, len(axis) - 1, 0.0
    for i in range(len(axis) - 1):
        if axis[i] <= v <= axis[i + 1]:
            w = (v - axis[i]) / (axis[i + 1] - axis[i])
            return i, i + 1, w
    return len(axis) - 1, len(axis) - 1, 0.0


def lut(m, x, y):
    """BILINEAR map lookup — the DME's real convention. Nearest-breakpoint
    (the deck-cache convention elsewhere) is WRONG for continuous drive data:
    across the 3100->3900 rpm column jump (68.4 -> 129.5) it inflates the
    rf/map ratio scatter 10x (CV 17.7% vs 1.7%, verified on the real logs)."""
    x0, x1, wx = _interp1(m["x_axis"], x)
    y0, y1, wy = _interp1(m["y_axis"], y)
    v = m["values"]
    top = v[y0][x0] * (1 - wx) + v[y0][x1] * wx
    bot = v[y1][x0] * (1 - wx) + v[y1][x1] * wx
    return top * (1 - wy) + bot * wy


def extract_pulls(samples):
    """Contiguous WOT segments (time order), tolerating GAP_TOL sub-WOT samples.
    A drop of SHIFT_DROP rpm between consecutive samples is a gearshift and
    splits the pull (the fill curve must never span a gear change)."""
    pulls, cur, gap = [], [], 0

    def flush():
        nonlocal cur
        if len(cur) >= MIN_PULL:
            pulls.append(cur)
        cur = []

    for x in samples:
        wot = x.get("ro") is not None and x["ro"] >= WOT_RO and x["rpm"] > 900
        if wot:
            if cur and x["rpm"] < cur[-1]["rpm"] - SHIFT_DROP:
                flush()
            cur.append(x)
            gap = 0
        elif cur:
            gap += 1
            if gap > GAP_TOL:
                flush()
                gap = 0
    flush()
    return pulls


def tz_stats(x):
    tz = [t for t in (x.get("tz") or []) if t is not None]
    if not tz:
        return None, None
    return st.mean(tz), max(tz) - min(tz)


def analyze(log_id, maps, run):
    with open(os.path.join(DATA_DIR, "telemetry", f"{log_id}.json"), encoding="utf-8") as f:
        rec = json.load(f)
    meta, samples = rec.get("meta", {}), rec["samples"]
    if meta.get("decoder_version", 1) < 2:
        print(f"{log_id}: decoder v1 — migrate first (scripts/migrate_telemetry_ro.py)")
        return None

    pulls = extract_pulls(samples)
    if not pulls:
        print(f"{log_id}: no WOT pulls (RO >= {WOT_RO}, >= {MIN_PULL} samples)")
        return None

    print("=" * 76)
    print(f"{log_id}: {len(pulls)} WOT pull(s)")

    # drive-day density vs the sim's environment (charge temp = ambient, not
    # the heat-soaked IAT sensor; both factors reported for honesty)
    amb_p = st.mean([x["ambientPressure"] for x in samples if x.get("ambientPressure")])
    amb_t = st.mean([x["ambientTemp"] for x in samples if x.get("ambientTemp")])
    iat_wot = st.mean([x["iat"] for p in pulls for x in p if x.get("iat") is not None])
    rho_amb = amb_p * 100 / (R_AIR * (amb_t + 273.15))
    rho_iat = amb_p * 100 / (R_AIR * (iat_wot + 273.15))
    rho_sim = 101325.0 / (R_AIR * 298.0)
    k_amb, k_iat = rho_sim / rho_amb, rho_sim / rho_iat
    print(f"conditions: ambient {amb_t:.0f}C/{amb_p:.0f}mbar (rho {rho_amb:.3f}), "
          f"IAT@WOT {iat_wot:.0f}C (rho {rho_iat:.3f}), sim rho {rho_sim:.3f}")
    print(f"density factor to sim conditions: x{k_amb:.3f} (ambient) .. x{k_iat:.3f} (IAT)")

    clean, skew = [], []
    for pi, p in enumerate(pulls, 1):
        dur = p[-1]["t"] - p[0]["t"]
        rate = (p[-1]["rpm"] - p[0]["rpm"]) / dur if dur > 0 else 0.0
        ok = [x for x in p if x.get("map") is None or x["map"] >= MAP_FLOOR]
        bad = [x for x in p if x.get("map") is not None and x["map"] < MAP_FLOOR]
        clean += ok
        skew += bad
        print(f"\npull {pi}: {p[0]['rpm']:.0f} -> {p[-1]['rpm']:.0f} rpm in {dur:.1f}s "
              f"({rate:+.0f} rpm/s), {len(p)} samples ({len(bad)} skew-excluded)")
        for x in ok:
            tzm, tzs = tz_stats(x)
            print(f"   t={x['t']:7.1f} {x['rpm']:5.0f}rpm RO{x['ro']:6.1f} "
                  f"rf {x['rf']:6.1f} MAP {x['map']:4.0f} "
                  f"evan {x['evanIst']:5.1f}/{x['evanSoll']:5.1f} "
                  f"avan {x['avanIst']:5.1f}/{x['avanSoll']:5.1f} "
                  f"tz {tzm:5.1f} (spread {tzs:3.1f})")

    # ---- per-sample ratio vs the stored map at the sample's ACTUAL RO ------
    # rf/map(rpm, RO) — if the car today == the car the map was calibrated on,
    # this ratio is a CONSTANT (the day's density scale). rpm-dependence of the
    # ratio would mean the map's SHAPE no longer matches the hardware.
    rf_map = maps["kf_rf_soll"]
    ratios = [(x["rpm"], x["rf"] / (lut(rf_map, x["rpm"], x["ro"]) * 100)) for x in clean]
    rs = [r for _, r in ratios]
    print(f"\nrf / kf_rf_soll(rpm, actual RO): mean {st.mean(rs):.3f} +/- {st.pstdev(rs):.3f}"
          f"  (constant => the stored map IS this car, scaled by today's density)")

    # ---- VANOS schedule through the sweep ----------------------------------
    devs_e = [x["evanIst"] - (lut(maps["kf_evan1_soll"], x["rpm"], x["ro"]) - EVAN_OFFSET)
              for x in clean]
    devs_a = [x["avanIst"] - (AVAN_SUM - lut(maps["kf_avan1_soll"], x["rpm"], x["ro"]))
              for x in clean]
    print(f"VANOS through the sweeps (actual - map schedule): "
          f"intake {st.mean(devs_e):+.2f} +/- {st.pstdev(devs_e):.2f} deg | "
          f"exhaust {st.mean(devs_a):+.2f} +/- {st.pstdev(devs_a):.2f} deg")

    # ---- per-cylinder ignition at WOT (knock retard = one cylinder pulled) --
    by_cyl = [[t for x in clean if x.get("tz") and x["tz"][c] is not None
               for t in [x["tz"][c]]] for c in range(6)]
    if all(by_cyl):
        means = [st.mean(c) for c in by_cyl]
        print("ignition per cylinder at WOT [degKW]: "
              + "  ".join(f"cyl{c+1} {m:5.1f}" for c, m in enumerate(means)))
        lo, hi = min(means), max(means)
        print(f"   slowest-vs-fastest cylinder: {hi - lo:.1f} deg "
              f"({'PERSISTENT offset — knock retard or cylinder-individual map' if hi - lo > 3 else 'tight'})")
    return {"log_id": log_id, "k_amb": k_amb, "k_iat": k_iat,
            "clean": clean, "n_skew": len(skew), "pulls": len(pulls)}


def combined_curve(results, maps, run):
    """Merge clean WOT samples from all logs into one fine-grained curve and
    the map-axis comparison table (measured vs stored map vs sim)."""
    allc = [(x, r["k_amb"]) for r in results for x in r["clean"]]
    if not allc:
        return
    rf_map = maps["kf_rf_soll"]
    rpm_axis = run["axes"]["rpm"]
    wot_li = run["axes"]["load"].index(100.0)
    print("=" * 76)
    print(f"COMBINED WOT curve ({len(results)} log(s), {len(allc)} clean samples), "
          f"{BIN_RPM:.0f}rpm bins, density-corrected to sim conditions (ambient basis):")
    print("   rpm_bin   n   rf_raw   rf_corr   map(actualRO)   raw/map")
    bins = {}
    for x, k in allc:
        bins.setdefault(round(x["rpm"] / BIN_RPM) * BIN_RPM, []).append((x, k))
    for b in sorted(bins):
        xs = bins[b]
        raw = st.median([x["rf"] for x, _ in xs])
        corr = st.median([x["rf"] * k for x, k in xs])
        mapv = st.median([lut(rf_map, x["rpm"], x["ro"]) * 100 for x, _ in xs])
        print("   %6.0f %4d %8.1f %9.1f %11.1f %11.3f"
              % (b, len(xs), raw, corr, mapv, raw / mapv if mapv else float("nan")))

    print("\n   map-axis comparison (nearest-cell, RO>=95 samples only => true WOT row):")
    print("   rpm     n  rf_corr  map_row   sim_ve   corr-sim  corr-map")
    for ri, rpm in enumerate(rpm_axis):
        near = [(x, k) for x, k in allc
                if x["ro"] >= 95 and abs(x["rpm"] - rpm) <= 200]
        if not near:
            continue
        corr = st.median([x["rf"] * k for x, k in near])
        map_v = lut(rf_map, rpm, 100.0) * 100
        cell = run["cells"][wot_li][ri]
        sim = cell.get("ve_sim")
        valid = cell.get("health", {}).get("valid")
        print("  %5d %5d %8.1f %8.1f %8s %9s %9s" % (
            rpm, len(near), corr, map_v,
            ("%.1f" % sim) if sim is not None else "--",
            ("%+.1f" % (corr - sim)) if sim is not None else "--",
            "%+.1f" % (corr - map_v)) + ("" if valid else "  (sim INVALID)"))


def main():
    ids = sys.argv[1:]
    tdir = os.path.join(DATA_DIR, "telemetry")
    if not ids:
        ids = [f[:-5] for f in sorted(os.listdir(tdir))
               if f.endswith(".json") and not f.startswith("mock_")]
    with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8") as f:
        maps = json.load(f)
    with open(os.path.join(DATA_DIR, "last_run_full_map.json"), encoding="utf-8") as f:
        run = json.load(f)
    results = [r for log_id in ids if (r := analyze(log_id, maps, run))]
    combined_curve(results, maps, run)


if __name__ == "__main__":
    main()

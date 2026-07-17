"""One-time migration: fix the aq_rel (RO) scale in decoder-v1 telemetry logs.

The reference catalog (DmeLiveValueCatalog.cs) gives aq_rel the scale
100/215 = 0.46511627906976744; the owner's car falsified it — the correct
scale is 100/32768 (the same U16-percent scale its sibling dr_rel carries).
Logs recorded before the fix hold ro = raw * 100/215.

The transform is exactly invertible: raw is an integer, so raw =
round(ro_v1 / (100/215)) recovers it bit-for-bit, and ro_v2 = raw * 100/32768.
The script REFUSES to touch a log whose ro values are not integer multiples of
the v1 scale (i.e. not actually v1 data), and re-scores each log against the
DME's own kf_rf_soll model before/after so the fix is proven, not assumed.

Run:  cd CSL_Simulator/backend && python scripts/migrate_telemetry_ro.py [--apply]
"""
import glob
import json
import os
import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "data")
TEL_DIR = os.path.join(DATA_DIR, "telemetry")
V1_SCALE = 0.46511627906976744          # catalog (wrong)
V2_SCALE = 0.0030517578125              # 100/32768 (correct)
DECODER_VERSION = 2


def lut(m, x, y):
    xi = min(range(len(m["x_axis"])), key=lambda i: abs(m["x_axis"][i] - x))
    yi = min(range(len(m["y_axis"])), key=lambda i: abs(m["y_axis"][i] - y))
    return m["values"][yi][xi]


def score(samples, rf_map, key="ro"):
    """mean/sd of (measured rf - the DME's own kf_rf_soll(rpm, RO)) [pp]."""
    errs = [s["rf"] - lut(rf_map, s["rpm"], s[key]) * 100
            for s in samples
            if s.get("rf") is not None and s.get(key) is not None
            and s["rpm"] >= 700 and 0 <= s[key] <= 105]
    if not errs:
        return None
    return len(errs), st.mean(errs), st.pstdev(errs)


def main():
    apply = "--apply" in sys.argv
    with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8") as f:
        rf_map = json.load(f)["kf_rf_soll"]

    for path in sorted(glob.glob(os.path.join(TEL_DIR, "*.json"))):
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as f:
            rec = json.load(f)
        meta, samples = rec.get("meta", {}), rec["samples"]
        if meta.get("decoder_version", 1) >= DECODER_VERSION:
            print(f"{name}: already v{meta['decoder_version']} — skip")
            continue

        # integrality guard: every ro must be an exact raw*V1_SCALE
        bad = 0
        for s in samples:
            if s.get("ro") is None:
                continue
            raw = s["ro"] / V1_SCALE
            if abs(raw - round(raw)) > 1e-6:
                bad += 1
        if bad:
            print(f"{name}: REFUSING — {bad} ro values are not raw*{V1_SCALE} "
                  f"(not decoder-v1 data?)")
            continue

        before = score(samples, rf_map)
        migrated = [dict(s) for s in samples]
        for s in migrated:
            if s.get("ro") is not None:
                s["ro"] = round(s["ro"] / V1_SCALE) * V2_SCALE
        after = score(migrated, rf_map)

        def fmt(x):
            return "n/a" if x is None else f"n={x[0]:4d} mean={x[1]:+7.2f}pp sd={x[2]:5.2f}"
        print(f"{name}: {len(samples)} pts")
        print(f"   vs kf_rf_soll before: {fmt(before)}")
        print(f"   vs kf_rf_soll after : {fmt(after)}")

        if not apply:
            print("   (dry run — pass --apply to write)")
            continue
        if after is None or before is None or abs(after[1]) >= abs(before[1]):
            print("   REFUSING to write: the fix does not improve agreement")
            continue

        rec["samples"] = migrated
        meta["decoder_version"] = DECODER_VERSION
        meta.setdefault("corrections", []).append("aq_rel_scale_100_over_32768")
        rec["meta"] = meta
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f)
        os.replace(tmp, path)
        print("   WRITTEN (decoder_version=2)")


if __name__ == "__main__":
    main()

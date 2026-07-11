#!/usr/bin/env python3
# =====================================================================
# !! TIMING-INVALID (Stage 69): this script predates the pure BMW-spread
# !! conversion. It uses the DELETED EXVANOS-base / sign-inverted exhaust
# !! convention (or the pre-datum-fix intake). DO NOT RE-RUN as-is --
# !! migrate to engine.intake_cam_spread / exhaust_cam_spread first.
# =====================================================================
"""Task 5 (Stage 67) — mod ΔVE ranking vs the validated X+170mm twin.

Mission deliverable: mod ΔVE RANK + magnitude bucket + confidence — never a
calibrated absolute number. Valley cell = 2700 WOT (the only fully-valid
in-valley fitted column). 3900 is DIRECTIONAL ONLY (the WOT 3900 absolute is a
documented permanent model limit — Stages 64/66); its Δ is still informative
because the mission's fidelity criterion is "the model responds faithfully to
mods". 4600/6300 (and 5300/6900 for finalists) are top-end regression sentinels.

Buckets: |Δ| < 2pp noise / 2-5 small / 5-10 medium / > 10 large.
Confidence: HIGH = all cells valid+converged, consistent; MED = some
non-converged (FLAG) but plausible VE; LOW = blow-up/NaN in any cell.

Usage: python t5_mod_rank.py csv1 [csv2 ...]
"""
import csv
import sys

# Stage-63/65 validated production baseline (deck-cached, omp1)
BASE = {2700: 75.3, 3900: 96.2, 4600: 121.2, 5300: 115.6,
        6300: 112.4, 6900: 110.2}
VALLEY, DIRECTIONAL = 2700, 3900
SENTINELS = (4600, 5300, 6300, 6900)


def bucket(d):
    a = abs(d)
    return ("noise" if a < 2 else "small" if a < 5 else
            "medium" if a < 10 else "LARGE")


def main():
    rows = []
    for path in sys.argv[1:]:
        with open(path, newline="") as f:
            rows.extend(csv.DictReader(f))

    variants = {}
    for r in rows:
        if float(r["load"]) < 100:
            continue
        tag = r.get("tag") or "?"
        rpm = int(float(r["rpm"]))
        if rpm not in BASE:
            continue
        variants.setdefault(tag, {})[rpm] = {
            "ve": float(r["ve"]), "valid": r.get("valid") == "1",
            "converged": r.get("converged") == "1",
            "blew": r.get("blew_up") == "1",
            "nan": r.get("nan_free") == "0",
        }

    scored = []
    for tag, cells in variants.items():
        d = {rpm: c["ve"] - BASE[rpm] for rpm, c in cells.items()}
        dv = d.get(VALLEY)
        d39 = d.get(DIRECTIONAL)
        reg = min([d[r] for r in SENTINELS if r in d] + [0.0])
        any_blow = any(c["blew"] or c["nan"] for c in cells.values())
        all_valid = all(c["valid"] for c in cells.values())
        conf = ("LOW" if any_blow else "HIGH" if all_valid else "MED")
        scored.append({"tag": tag, "dv": dv, "d39": d39, "reg": reg,
                       "conf": conf, "d": d, "cells": cells})

    scored.sort(key=lambda s: (s["dv"] if s["dv"] is not None else -99),
                reverse=True)
    print("# Task-5 mod ranking vs X+170mm twin "
          "(valley = Δ2700 WOT; 3900 = DIRECTIONAL ONLY — permanent model limit)")
    print(f"{'rank':<5}{'mod':<11}{'Δ2700':>7} {'bucket':<7}"
          f"{'Δ3900*':>8}{'Δ4600':>7}{'Δ6300':>7}{'worst-reg':>10}  conf")
    for i, s in enumerate(scored, 1):
        d = s["d"]
        line = (f"{i:<5}{s['tag']:<11}"
                f"{s['dv']:>+7.1f} {bucket(s['dv']):<7}" if s["dv"] is not None
                else f"{i:<5}{s['tag']:<11}{'--':>7} {'':<7}")
        line += (f"{s['d39']:>+8.1f}" if s["d39"] is not None else f"{'--':>8}")
        line += (f"{d.get(4600, 0):>+7.1f}" if 4600 in d else f"{'--':>7}")
        line += (f"{d.get(6300, 0):>+7.1f}" if 6300 in d else f"{'--':>7}")
        line += f"{s['reg']:>+10.1f}  {s['conf']}"
        flags = [f"{r}:{'B' if c['blew'] else 'N' if c['nan'] else 'f'}"
                 for r, c in sorted(s["cells"].items())
                 if not c["valid"]]
        if flags:
            line += "  [" + " ".join(flags) + "]"
        print(line)
    print("# * Δ3900 is directional (absolute 3900 un-scoreable); "
          "f=not-converged B=blow-up N=NaN")


if __name__ == "__main__":
    main()

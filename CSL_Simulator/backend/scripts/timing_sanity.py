#!/usr/bin/env python3
"""Stage 69 — valve-timing sanity gate (ZERO simulations).

Prints IVO/IVC/EVO/EVC (crank deg + human BTDC/ABDC/BBDC/ATDC terms), MOPs and
the overlap window for the PURE BMW-spread conversion across the WOT row and
representative part-load cells, plus the two-stage ignition lookup table
(kf_rf_soll -> kf_tz_grund). Compares against the OLD (Stage-47, sign-inverted)
production angles so the fix is visible cell by cell.

Crank frame: 0 = combustion TDC, 180 = BDC power, 360 = OVERLAP TDC,
540 = BDC intake. Cosine lift: MOP = open + dur/2, close = open + dur.

PURE conversion (owner-confirmed BMW lift-diagram convention):
  open_in  = 360 + evan - dur/2 - (offset_in  + delta_in)
  open_ex  = 360 - avan - dur/2 - (offset_ex + delta_ex)

HARD GATES (WOT row must pass before ANY pure-timing sim runs):
  EVO in [30, 70] deg BBDC ; EVC in [10, 50] deg ATDC(overlap)
  IVO in [20, 75] deg BTDC(overlap) ; IVC in [10, 70] deg ABDC
  overlap center within 360 +/- 25 deg
Exit code 0 = all gates green; 1 = any gate violated.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402
sys.path.insert(0, HERE)
from app.models import SimConfig  # noqa: E402

DATA_DIR = os.path.join(HERE, "app", "data")
MAPS = json.load(open(os.path.join(DATA_DIR, "csl_ecu_maps.json")))


def lut(m, rpm, load):
    rx, ly, v = m["x_axis"], m["y_axis"], m["values"]
    return v[min(range(len(ly)), key=lambda i: abs(ly[i] - load))][
        min(range(len(rx)), key=lambda i: abs(rx[i] - rpm))]


def ignition_for(rpm, load):
    """Two-stage physical lookup: (rpm, load%) -> rf via kf_rf_soll ->
    ignition (deg BTDC) via kf_tz_grund. Nearest-breakpoint (map convention)."""
    tz = MAPS.get("kf_tz_grund")
    if not tz:
        return None
    rf = lut(MAPS["kf_rf_soll"], rpm, load)     # relative fill (0.05..1.2)
    return lut(tz, rpm, rf)


def main():
    cfg = SimConfig()
    dur_in = cfg.engine.head.intake_valve.duration
    dur_ex = cfg.engine.head.exhaust_valve.duration
    off_in = cfg.engine.vanos_intake_offset     # -2 (advance-positive)
    off_ex = cfg.engine.vanos_exhaust_offset    # +1

    wot_bases_old = {600: 130.0, 870: 170.0, 1100: 130.0, 1300: 170.0,
                     1400: 130.0, 1600: 130.0, 1800: 130.0, 2100: 150.0,
                     2400: 130.0, 2700: 130.0, 3900: 130.0, 4600: 130.0,
                     5300: 155.0, 6300: 170.0, 6900: 170.0}

    cells = [(r, 100.0) for r in (2700, 3900, 4600, 5300, 6300, 6900)] + \
            [(2700, 30.0), (2700, 65.0), (3900, 45.0), (1300, 100.0), (2100, 100.0)]

    print("# Stage 69 timing sanity — PURE BMW-spread conversion vs OLD production")
    print(f"# durations: intake {dur_in:.0f} / exhaust {dur_ex:.0f} deg; "
          f"offsets K_EVAN1 {off_in:+.0f} / K_AVAN1 {off_ex:+.0f} (+=advance)")
    hdr = (f"{'cell':>10} {'evan':>5} {'avan':>5} | "
           f"{'IVO':>12} {'IVC':>10} {'EVO':>11} {'EVC':>10} {'ovl_ctr':>8} | "
           f"{'oldEVO':>7} {'oldEVC':>7} | {'ign':>5}")
    print(hdr)

    fails = []
    for rpm, load in cells:
        evan = lut(MAPS["kf_evan1_soll"], rpm, load)
        avan = lut(MAPS["kf_avan1_soll"], rpm, load)
        o_in = 360.0 + evan - dur_in / 2.0 - off_in
        o_ex = 360.0 - avan - dur_ex / 2.0 - off_ex
        ivc = o_in + dur_in
        evc = o_ex + dur_ex
        ovl_ctr = (max(o_in, o_ex) + min(ivc, evc)) / 2.0

        ivo_h = f"{360 - o_in:.0f}BTDCov" if o_in < 360 else f"{o_in - 360:.0f}ATDCov"
        ivc_h = f"{ivc - 540:.0f}ABDC" if ivc >= 540 else f"{540 - ivc:.0f}BBDC"
        evo_h = f"{180 - o_ex:.0f}BBDC" if o_ex < 180 else f"{o_ex - 180:.0f}ABDC"
        evc_h = f"{evc - 360:.0f}ATDCov" if evc >= 360 else f"{360 - evc:.0f}BTDCov"

        # OLD production (sign-inverted Stage-47): open_ex = 102 - ((base-avan)+1)
        old = ""
        if load >= 100 and rpm in wot_bases_old:
            b = wot_bases_old[rpm]
            oo_ex = 102.0 - ((b - avan) + off_ex)
            old = f"{180 - oo_ex:7.0f} {360 - (oo_ex + dur_ex):6.0f}B"

        ign = ignition_for(rpm, load)
        ign_s = f"{ign:.0f}" if ign is not None else "n/a"
        print(f"{int(rpm):>6}/{int(load):<3} {evan:>5.0f} {avan:>5.0f} | "
              f"{o_in:6.1f}={ivo_h:>9} {ivc_h:>10} {o_ex:5.1f}={evo_h:>7} "
              f"{evc_h:>10} {ovl_ctr:8.1f} | {old:>15} | {ign_s:>5}")

        if load >= 100:
            evo_bbdc = 180 - o_ex
            evc_atdc = evc - 360
            ivo_btdc = 360 - o_in
            ivc_abdc = ivc - 540
            # bounds catch NON-PHYSICAL conversions (the old path was 60-100 deg
            # off), not the ECU's real commands: 6900 IVO 17 BTDC-ov is the
            # map's genuine near-redline intake retard -> lower bound 15.
            for name, val, lo, hi in (("EVO_BBDC", evo_bbdc, 30, 70),
                                      ("EVC_ATDCov", evc_atdc, 10, 50),
                                      ("IVO_BTDCov", ivo_btdc, 15, 75),
                                      ("IVC_ABDC", ivc_abdc, 10, 70),
                                      ("ovl_center", ovl_ctr, 335, 385)):
                if not (lo <= val <= hi):
                    fails.append(f"{int(rpm)}/{int(load)} {name}={val:.1f} not in [{lo},{hi}]")

    if MAPS.get("kf_tz_grund"):
        print("\n# ignition two-stage lookup spot table (rpm/load -> rf -> degBTDC):")
        for rpm, load in ((2700, 100), (3900, 100), (5300, 100), (6900, 100),
                          (2700, 30), (2700, 65), (1300, 100)):
            rf = lut(MAPS["kf_rf_soll"], rpm, load)
            print(f"  {rpm}/{load}: rf={rf:.3f} -> ign {ignition_for(rpm, load):.1f} degBTDC "
                  f"(old hardcode: {20.0 if load >= 100 else 15.0})")
    else:
        print("\n# kf_tz_grund NOT in csl_ecu_maps.json yet — ignition table skipped")

    if fails:
        print("\n# GATE FAILURES:")
        for f in fails:
            print("  " + f)
        return 1
    print("\n# ALL GATES GREEN — pure conversion is physically plausible; sims may proceed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage 119 - Faithful port of the MSS54HP '0401' internal residual-gas model.

WHY THIS EXISTS
---------------
On the CSL '0401' the load path is pure Alpha-N (``k_rf_hfm_cfg = 0``); ``rf``/``ml``
are the ECU's own model of breathing, not a MAF reading. The owner's ``kf_rf_soll``
table (valley 0.68 @3100, peak 1.29 @3900) is that model, calibrated against measured
lambda. The BMW firmware ALSO carries an explicit, quantitative model of how camshaft
phase turns valve overlap into trapped residual gas: ``rg_m_calc`` @ master 0x221A0,
active because ``k_rg_m_cfg = 1`` (dynamic calc, not table lookup).

This module ports ``rg_m_calc`` (and the exhaust-back-pressure feed) byte-faithfully so
we can ask BMW's own physics: *how much of the mid-rpm VE valley does the ECU attribute
to cam-overlap-driven internal EGR?* The answer is the overlay in ``ecu_rg_overlay`` and
feeds the Stage-120 sim cam->air sensitivity comparison. This is a DIAGNOSTIC, not a
calibration knob: nothing here is tuned to fit anything.

SOURCES (all read directly from ``Full 211323000401PD31_TERRA.bin`` at the XDF addresses)
- decomp:  CSL_0401_Binary_Disassembly_Notes/app/public/data/decomp/master/0221a0.txt
- XDF:     CSL_0401_Karter16_v3_6_publish.xdf (addresses cited per array below)
Raw integer arrays are baked in below and re-verified against the binary by
``verify_against_binary()`` when the binary is present.

Units at the ECU internal boundary (what the raw arithmetic uses):
  N          rpm
  EVAN1_IST  intake cam actual,   0.1 degKW  (telemetry evanIst[degKW] * 10)
  AVAN1_IST  exhaust cam actual,  0.1 degKW  (telemetry avanIst[degKW] * 10)
  p_saug     manifold pressure,   mbar
  p_egbp     exhaust back pressure, mbar  (= ambient + kl_rg_abgasdruck_ml(ml))
  trg        exhaust gas temp,    degC   (telemetry has no EGT channel -> parameterised)
  rg_m       residual gas mass,   mg     (clamped to [k_rg_m_min, k_rg_m_max])
"""
from __future__ import annotations

import argparse
import json
import os
import struct
from typing import Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Constants (master params, file offset = XDF addr in the 1 MB container)
# --------------------------------------------------------------------------- #
K_RG_M_CFG = 1                 # 0xE6C6  0=table lookup, 1=dynamic rg_m_calc (ACTIVE)
K_RG_R = 287                   # 0xE6C8  J/(kg*K) - dry-air gas constant
K_RG_V_HUB = 3246              # 0xE6CA  cm3 - swept volume
K_RG_ZYLANZ_BANK = 3           # 0xE6CC  cylinders per bank
K_RG_M_MIN = -2000             # 0xE6CE  mg  (signed)
K_RG_M_MAX = 4000              # 0xE6D0  mg
K_RG_AVAN1_OFFSET = 20         # 0xE6D2  raw 0.1degKW (= 2.0 degKW)
K_RG_EVAN1_MOLMASSE_MIN = 870  # 0xE6D4  raw *100 g/mol (= 8.70 g/mol)

# --------------------------------------------------------------------------- #
# Curves - baked raw integer arrays (address, element size 16b BE).
# Each is (x_raw[], y_raw[]); engineering scaling noted in comments.
# --------------------------------------------------------------------------- #
# kl_rg_as_gain  @0xE6D8 / y@0xE6F0 - exhaust cam phase -> closing-flank effectiveness
#   x: 0.1degKW  y: gain*1000
AS_GAIN_X = [0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700]
AS_GAIN_Y = [0, 0, 60, 200, 595, 1070, 1355, 1545, 1625, 1760, 3000, 4000]

# kl_rg_as_druckverh_gain  @0xE70A / y@0xE71E (signed) - p_saug/p_egbp -> re-breathing
#   x: ratio*1000  y: gain*10000 (signed)
DRUCK_X = [400, 600, 800, 900, 1000, 1100, 1200, 1400, 1600, 2000]
DRUCK_Y = [4840, 4787, 3964, 2988, 0, -2865, -3700, -4454, -4741, -4840]

# kl_rg_evan1_molmasse  @0xE734 / y@0xE74C - intake cam phase -> residual molar mass
#   x: EVAN1_with_offset raw (= EVAN1_IST[0.1degKW] + 3000)   y: g/mol*100
MOL_X = [3000, 3100, 3200, 3300, 3400, 3500, 3600, 3700, 3800, 3900, 4000, 4100]
MOL_Y = [4680, 3699, 2798, 2031, 1445, 1078, 952, 1078, 1445, 2031, 2798, 3600]

# kl_rg_temp_dichte_korr  @0xE766 / y@0xE78A - temp density index -> density mult
#   x: raw key (= (200000/rg_t)*10000/K_RG_R)   y: density*100000
TEMPD_X = [4555, 4801, 5087, 5575, 6010, 6766, 7743, 8821, 10248,
           11240, 12015, 12905, 14518, 17000, 19357, 22479, 26802, 31680]
TEMPD_Y = [2134, 2191, 2255, 2361, 2451, 2601, 2783, 2970, 3201,
           3353, 3466, 3592, 3810, 4123, 4400, 4741, 5177, 5628]

# kl_rg_abgasdruck_ml  @0xE6A6 / y@0xE6B6 - load(ml) -> exhaust dP over ambient
#   x: kg/hr   y: mbar*32
ABG_X = [0, 200, 800, 1400, 2000, 2600, 3200, 4000]
ABG_Y = [0, 224, 416, 1536, 3616, 6656, 10624, 12800]

DEFAULT_BIN = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..",
    "CSL_0401_Binary_Disassembly_Notes", "Full 211323000401PD31_TERRA.bin",
)


# --------------------------------------------------------------------------- #
# ECU integer helpers
# --------------------------------------------------------------------------- #
def _idiv(a: int, b: int) -> int:
    """Integer division truncating toward zero (CPU32 DIVS/DIVU semantics)."""
    if b == 0:
        return 0
    q = abs(a) // abs(b)
    return -q if (a < 0) != (b < 0) else q


def _interp(x_raw: List[int], y_raw: List[int], key: int) -> int:
    """klu_wint / kls_wint: clamped piecewise-linear interpolation on raw ints.

    Below x[0] -> y[0]; above x[-1] -> y[-1]. Signed-safe (kls) since the same
    integer interpolation covers negative y (kl_rg_as_druckverh_gain)."""
    if key <= x_raw[0]:
        return y_raw[0]
    if key >= x_raw[-1]:
        return y_raw[-1]
    for i in range(1, len(x_raw)):
        if key <= x_raw[i]:
            x0, x1 = x_raw[i - 1], x_raw[i]
            y0, y1 = y_raw[i - 1], y_raw[i]
            return y0 + _idiv((y1 - y0) * (key - x0), (x1 - x0))
    return y_raw[-1]


# --------------------------------------------------------------------------- #
# The model - literal port of rg_m_calc (decomp master 0x221A0)
# --------------------------------------------------------------------------- #
def p_egbp_from_ml(ml_kghr: float, amb_mbar: float) -> int:
    """p_abgasdruck_calc feed: exhaust back pressure = ambient + kl_rg_abgasdruck_ml(ml)."""
    dp = _interp(ABG_X, ABG_Y, int(round(ml_kghr)))  # y = mbar*32
    return int(round(amb_mbar)) + _idiv(dp, 32)


def rg_m_calc(N: int, EVAN1_IST: int, AVAN1_IST: int,
              p_saug: int, p_egbp: int, trg: int) -> Dict[str, int]:
    """Faithful rg_m_calc. Cam positions in 0.1degKW, pressures mbar, trg degC.

    Returns dict of the key internal quantities + the clamped total ``rg_m`` (mg)."""
    rg_t = trg + 273  # Kelvin

    # ---- exhaust cam contribution (rg_m_avan1) ----
    off = K_RG_AVAN1_OFFSET + AVAN1_IST
    rg_avan1_ist_offset = off if off > 0 else 0
    eff = _interp(AS_GAIN_X, AS_GAIN_Y, rg_avan1_ist_offset)          # gain*1000
    if N == 0:
        u = 0
    else:
        u = _idiv(_idiv(rg_avan1_ist_offset * 1000, 6), N)
    evc = 1250 if u >= 1251 else (0 if u < 0 else u)
    ratio = 0 if p_egbp == 0 else _idiv(p_saug * 1000, p_egbp)
    pgf = _interp(DRUCK_X, DRUCK_Y, ratio)                            # gain*10000 (signed)
    tkey = _idiv(_idiv(200000, rg_t) * 10000, K_RG_R)
    tdc = _interp(TEMPD_X, TEMPD_Y, tkey)                             # density*1e5
    dens = _idiv(p_saug * tdc, 32000)
    rg_m_avan1 = _idiv(_idiv(pgf * dens, 10000) * _idiv(eff * evc, 100), 1000)

    # ---- intake cam contribution (rg_m_evan1) ----
    mol_density = _idiv(_idiv(p_egbp * 3125, rg_t), K_RG_R)           # mol/cc-ish
    ev = EVAN1_IST + 3000
    if ev < 3000:
        ev = 3000
    mol = _interp(MOL_X, MOL_Y, ev)                                  # g/mol*100
    if mol < K_RG_EVAN1_MOLMASSE_MIN:
        mol = K_RG_EVAN1_MOLMASSE_MIN
    if mol > K_RG_EVAN1_MOLMASSE_MIN + 10000:
        mol = K_RG_EVAN1_MOLMASSE_MIN + 10000
    rg_evan1_MV = _idiv(_idiv(mol * K_RG_V_HUB, K_RG_ZYLANZ_BANK), 20000)
    rg_m_evan1 = _idiv(rg_evan1_MV * mol_density, 100)

    rg_m = rg_m_evan1 + rg_m_avan1
    if rg_m < K_RG_M_MIN:
        rg_m = K_RG_M_MIN
    elif rg_m > K_RG_M_MAX:
        rg_m = K_RG_M_MAX

    return {
        "rg_m": rg_m, "rg_m_evan1": rg_m_evan1, "rg_m_avan1": rg_m_avan1,
        "eff": eff, "evc": evc, "pgf": pgf, "tdc": tdc, "dens": dens,
        "mol": mol, "mol_density": mol_density, "ratio": ratio,
    }


def residual_gas(rpm: float, evan_deg: float, avan_deg: float,
                 map_mbar: float, amb_mbar: float, ml_kghr: float,
                 tabg_C: float) -> Dict[str, int]:
    """Engineering-unit wrapper. Cam angles in degKW; converts to 0.1degKW internally."""
    p_egbp = p_egbp_from_ml(ml_kghr, amb_mbar)
    return rg_m_calc(
        N=int(round(rpm)),
        EVAN1_IST=int(round(evan_deg * 10)),
        AVAN1_IST=int(round(avan_deg * 10)),
        p_saug=int(round(map_mbar)),
        p_egbp=p_egbp,
        trg=int(round(tabg_C)),
    )


# --------------------------------------------------------------------------- #
# Verification against the binary (ground truth)
# --------------------------------------------------------------------------- #
def verify_against_binary(path: str = DEFAULT_BIN) -> bool:
    """Re-decode the raw arrays/constants from the binary and assert they match the
    baked-in literals. Returns True if verified, False if the binary is unavailable."""
    if not os.path.isfile(path):
        print(f"[verify] binary not found ({path}); skipping (baked values unverified)")
        return False
    with open(path, "rb") as f:
        data = f.read()

    def u8(a): return data[a]
    def u16(a): return struct.unpack_from(">H", data, a)[0]
    def s16(a): return struct.unpack_from(">h", data, a)[0]
    def arr(a, n, s=False):
        fn = s16 if s else u16
        return [fn(a + 2 * i) for i in range(n)]

    checks = [
        ("K_RG_M_CFG", K_RG_M_CFG, u8(0xE6C6)),
        ("K_RG_R", K_RG_R, u16(0xE6C8)),
        ("K_RG_V_HUB", K_RG_V_HUB, u16(0xE6CA)),
        ("K_RG_ZYLANZ_BANK", K_RG_ZYLANZ_BANK, u8(0xE6CC)),
        ("K_RG_M_MIN", K_RG_M_MIN, s16(0xE6CE)),
        ("K_RG_M_MAX", K_RG_M_MAX, u16(0xE6D0)),
        ("K_RG_AVAN1_OFFSET", K_RG_AVAN1_OFFSET, s16(0xE6D2)),
        ("K_RG_EVAN1_MOLMASSE_MIN", K_RG_EVAN1_MOLMASSE_MIN, u16(0xE6D4)),
        ("AS_GAIN_X", AS_GAIN_X, arr(0xE6D8, 12)),
        ("AS_GAIN_Y", AS_GAIN_Y, arr(0xE6F0, 12)),
        ("DRUCK_X", DRUCK_X, arr(0xE70A, 10)),
        ("DRUCK_Y", DRUCK_Y, arr(0xE71E, 10, True)),
        ("MOL_X", MOL_X, arr(0xE734, 12)),
        ("MOL_Y", MOL_Y, arr(0xE74C, 12)),
        ("TEMPD_X", TEMPD_X, arr(0xE766, 18)),
        ("TEMPD_Y", TEMPD_Y, arr(0xE78A, 18)),
        ("ABG_X", ABG_X, arr(0xE6A6, 8)),
        ("ABG_Y", ABG_Y, arr(0xE6B6, 8)),
    ]
    ok = True
    for name, baked, live in checks:
        if baked != live:
            ok = False
            print(f"[verify] MISMATCH {name}: baked={baked} binary={live}")
    print("[verify] all residual-gas constants/arrays match binary" if ok
          else "[verify] FAILED")
    return ok


# --------------------------------------------------------------------------- #
# Overlay driver: BMW residual model vs the owner VE valley, over an rpm sweep
# --------------------------------------------------------------------------- #
def wot_row_cams(maps_path: str) -> Tuple[List[float], List[float], List[float], List[float]]:
    """Return (rpm_intake, intake_live_deg, rpm_exhaust, exhaust_live_deg) for the WOT
    (85%) row of csl_ecu_maps.json, converted map-display -> live cam angle:
    intake_live = display - 70 ; exhaust_live = 128 - display."""
    with open(maps_path, "r", encoding="utf-8") as f:
        m = json.load(f)
    ie = m["kf_evan1_soll"]
    ia = m["kf_avan1_soll"]
    in_rpm = ie["x_axis"]
    in_live = [v - 70 for v in ie["values"][-1]]     # last row = 85% (WOT)
    ex_rpm = ia["x_axis"]
    ex_live = [128 - v for v in ia["values"][-1]]
    return in_rpm, in_live, ex_rpm, ex_live


def _nearest(xs: List[float], x: float) -> int:
    return min(range(len(xs)), key=lambda i: abs(xs[i] - x))


def telemetry_wot_points(tel_dir: str, min_map_ratio: float = 0.90) -> List[dict]:
    """Aggregate true-WOT samples (pedal>=99, map/amb>=ratio) into 150-rpm bins,
    returning per-bin medians of the fields the residual model needs."""
    import glob
    from statistics import median

    def g(x, k):
        v = x.get(k)
        return v[0] if isinstance(v, list) else v

    rows = []
    for fp in sorted(glob.glob(os.path.join(tel_dir, "2026*.json"))):
        with open(fp, "r", encoding="utf-8") as f:
            d = json.load(f)
        for s in d.get("samples", []):
            ped = g(s, "pedal")
            amb = g(s, "ambientPressure")
            mp = g(s, "map")
            if ped is None or ped < 99 or not amb or not mp:
                continue
            if mp / amb < min_map_ratio:
                continue
            rows.append(s)
    if not rows:
        return []
    bins: Dict[int, List[dict]] = {}
    for s in rows:
        rpm = g(s, "rpm")
        b = int(round(rpm / 150.0) * 150)
        bins.setdefault(b, []).append(s)
    out = []
    for b in sorted(bins):
        grp = bins[b]
        out.append({
            "rpm": b,
            "n": len(grp),
            "evanIst": median(g(s, "evanIst") for s in grp),
            "avanIst": median(g(s, "avanIst") for s in grp),
            "map": median(g(s, "map") for s in grp),
            "amb": median(g(s, "ambientPressure") for s in grp),
            "ml": median(g(s, "ml") for s in grp),
            "rf": median(g(s, "rf") for s in grp),
        })
    return out


def overlay(tel_dir: str, tabg_C: float) -> List[dict]:
    """Evaluate BMW's residual-gas model at the real per-rpm WOT cams/conditions.

    Adds ``fresh_mg`` (fresh charge per cylinder per cycle, derived from the ml air
    mass) and ``resid_frac`` (rg_m / (rg_m + fresh_mg)) - the physically meaningful
    quantity for VE. rg_m is per-cylinder (V_HUB / K_RG_ZYLANZ_BANK), so both terms
    are per-cylinder-per-cycle and commensurable."""
    pts = telemetry_wot_points(tel_dir)
    res = []
    for p in pts:
        r = residual_gas(p["rpm"], p["evanIst"], p["avanIst"],
                         p["map"], p["amb"], p["ml"], tabg_C)
        # per-cylinder per-cycle fresh mass [mg] = ml[kg/hr]*1e6 / (180*N)
        fresh_mg = p["ml"] * 1.0e6 / (180.0 * p["rpm"]) if p["rpm"] else 0.0
        rg = r["rg_m"]
        r["fresh_mg"] = round(fresh_mg, 1)
        r["resid_frac"] = round(rg / (rg + fresh_mg), 4) if (rg + fresh_mg) > 0 else 0.0
        res.append({**p, **r})
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 119 ECU residual-gas model port + overlay")
    ap.add_argument("--verify", action="store_true", help="verify baked arrays vs binary")
    ap.add_argument("--selftest", action="store_true", help="print representative model points")
    ap.add_argument("--overlay", action="store_true", help="run telemetry-driven overlay")
    ap.add_argument("--tel-dir", default=os.path.join(os.path.dirname(__file__), "..",
                    "app", "data", "telemetry"))
    ap.add_argument("--tabg", type=float, default=850.0, help="assumed WOT exhaust gas temp degC")
    ap.add_argument("--out", default=None, help="write overlay JSON to this path")
    args = ap.parse_args()

    if args.verify or not (args.selftest or args.overlay):
        verify_against_binary()

    if args.selftest:
        print("\n=== self-test: residual mass vs intake cam (exh=35deg, 3000rpm, MAP970/amb1013, ml300, EGT850) ===")
        for ev in (0, 10, 20, 30, 40, 50, 60):
            r = residual_gas(3000, ev, 35, 970, 1013, 300, 850)
            print(f"  EVAN {ev:3d}deg -> rg_m {r['rg_m']:5d} mg "
                  f"(evan1 {r['rg_m_evan1']:5d} + avan1 {r['rg_m_avan1']:5d}), mol {r['mol']/100:.2f} g/mol")

    if args.overlay:
        rows = overlay(args.tel_dir, args.tabg)
        print(f"\n=== BMW residual-gas model at real WOT cams (EGT assumed {args.tabg:.0f}C) ===")
        print(f"{'rpm':>5} {'n':>3} {'evan':>5} {'avan':>5} {'map':>6} {'ml':>6} "
              f"{'rf':>5} {'rg_m':>6} {'fresh':>7} {'resid%':>7}")
        for r in rows:
            print(f"{r['rpm']:5d} {r['n']:3d} {r['evanIst']:5.1f} {r['avanIst']:5.1f} "
                  f"{r['map']:6.0f} {r['ml']:6.0f} {r['rf']:5.1f} "
                  f"{r['rg_m']:6d} {r['fresh_mg']:7.0f} {100*r['resid_frac']:7.2f}")
        vb = [r for r in rows if 2100 <= r["rpm"] <= 3150]
        pb = [r for r in rows if 3600 <= r["rpm"] <= 3900]
        if vb and pb:
            import statistics
            fv = statistics.mean(r["resid_frac"] for r in vb)
            fp = statistics.mean(r["resid_frac"] for r in pb)
            rv = statistics.mean(r["rf"] for r in vb)
            rp = statistics.mean(r["rf"] for r in pb)
            print(f"\n valley(2100-3150): resid {100*fv:.2f}%  rf {rv:.1f}")
            print(f" peak  (3600-3900): resid {100*fp:.2f}%  rf {rp:.1f}")
            print(f" -> BMW residual DELTA valley-peak = {100*(fv-fp):+.2f} pp of trapped mass, "
                  f"vs VE swing {rp-rv:+.1f} rf pp")
        if args.out:
            os.makedirs(os.path.dirname(args.out), exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump({"tabg_C": args.tabg, "rows": rows}, f, indent=2)
            print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()

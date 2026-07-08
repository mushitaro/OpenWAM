#!/usr/bin/env python3
"""Golden-deck regression gate (PLAN_PARTLOAD_CALIBRATION.md Phase 0).

Pins the LEGACY deck bytes: a SimConfig with every legacy geometry value made
EXPLICIT (plenum 10.5 L, duct 350xphi200, filter 20xphi300, runners 15/25,
eq_tube model="plenum" phi30x75) must generate byte-identical .wam/.vlv output
before and after the rail/geometry config plumbing lands. Hashes were recorded
at the pre-edit HEAD; every later commit must reproduce them exactly
(`python golden_deck_check.py` exits non-zero on drift).

Decks pinned (x FAST_OUTPUT on/off):
  wot    : rpm 5300, tps 1.00, ignition 20.0 (the app WOT map cell)
  pl20   : rpm 5300, tps 0.20, default ignition (the app part-load map cell)
  chain  : wot deck with eq_tube.model="chain" (the opt-in chain path, kept)

Usage:
  python golden_deck_check.py            # check against golden_deck_hashes.json
  python golden_deck_check.py --record   # (re)record the hashes (pre-edit HEAD only)
"""
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _local import HERE  # noqa: E402  (CSL_Simulator/backend)

sys.path.insert(0, HERE)
from app.models import SimConfig, ExhaustLayoutType  # noqa: E402
from app.simulator.wam_generator import WAMGenerator  # noqa: E402

HASH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "golden_deck_hashes.json")


def _legacy_config():
    """Every legacy-relevant knob EXPLICIT so later default flips cannot move it."""
    cfg = SimConfig()
    cfg.engine.rpm = 5300.0
    cfg.simulation.duration_cycles = 30
    cfg.exhaust.port_junction_vol = 0.0
    # fixed, arbitrary-but-typical cam biases (exercise the VANOS deck path)
    cfg.engine.vanos_intake_bias = 15.0
    cfg.engine.vanos_exhaust_bias = -11.0
    # legacy intake geometry, pinned (EVERY field the measured-geometry default
    # flip moves is pinned here, so the flip cannot drift these decks)
    cfg.intake.plenum_vol = 10.5
    cfg.intake.inlet.duct_length = 350.0    # == the legacy hardcoded duct
    cfg.intake.inlet.duct_diameter = 200.0
    cfg.intake.inlet.exit_width = None      # circular exit (no slot)
    cfg.intake.inlet.exit_height = None
    cfg.intake.inlet.filter_diameter = 300.0
    cfg.intake.inlet.filter_thickness = 20.0
    cfg.intake.runner.upper_length = 15.0
    cfg.intake.runner.lower_length = 25.0
    cfg.intake.bellmouth.length = 150.0     # legacy trumpet (the measured 170mm is now the default)
    cfg.exhaust.section1_1.layout = ExhaustLayoutType.STRAIGHT  # legacy independent banks
    cfg.exhaust.section1_2.layout = ExhaustLayoutType.STRAIGHT  # (owner X-Pipe is now the default)
    cfg.intake.eq_tube.model = "plenum"
    cfg.intake.eq_tube.stub_diameter = 30.0
    cfg.intake.eq_tube.stub_length = 75.0
    cfg.intake.eq_tube.stub_friction = 0.02
    cfg.exhaust.headers.primary_length = 300.0   # legacy placeholder primaries
    return cfg


def _scrub_env():
    """Deck bytes depend on OPENWAM_*/CSL_* env -- neutralize the caller's shell."""
    for k in list(os.environ):
        if k.startswith("OPENWAM_") or k.startswith("CSL_"):
            del os.environ[k]


def _deck_hash(cfg, ignition, fast_output):
    if fast_output:
        os.environ["OPENWAM_FAST_OUTPUT"] = "1"
    else:
        os.environ.pop("OPENWAM_FAST_OUTPUT", None)
    with tempfile.TemporaryDirectory() as wd:
        gen = WAMGenerator(cfg, wd)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            deck = (gen.generate(ignition_timing=ignition)
                    if ignition is not None else gen.generate())
        h = hashlib.sha256()
        h.update(deck.encode("utf-8"))
        for vlv in ("intake.vlv", "exhaust.vlv"):
            with open(os.path.join(wd, vlv), "rb") as f:
                h.update(f.read())
    return h.hexdigest(), deck


def _all_hashes(keep_decks=None):
    _scrub_env()
    out = {}
    variants = []
    wot = _legacy_config()
    wot.engine.throttle_position = 1.0
    variants.append(("wot", wot, 20.0))

    pl = _legacy_config()
    pl.engine.throttle_position = 0.20
    variants.append(("pl20", pl, None))

    chain = _legacy_config()
    chain.engine.throttle_position = 1.0
    chain.intake.eq_tube.model = "chain"
    variants.append(("chain", chain, 20.0))

    for name, cfg, ign in variants:
        for fast in (True, False):
            key = f"{name}_{'fast' if fast else 'full'}"
            out[key], deck = _deck_hash(cfg, ign, fast)
            if keep_decks is not None:
                keep_decks[key] = deck
    return out


def main():
    record = "--record" in sys.argv
    hashes = _all_hashes()
    commit = "unknown"
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=HERE,
            stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        pass

    if record:
        with open(HASH_FILE, "w") as f:
            json.dump({"recorded_at_commit": commit, "hashes": hashes}, f, indent=2)
        print(f"RECORDED {len(hashes)} golden hashes at {commit[:12]} -> {HASH_FILE}")
        for k, v in hashes.items():
            print(f"  {k:12s} {v}")
        return 0

    try:
        with open(HASH_FILE) as f:
            golden = json.load(f)
    except OSError:
        print(f"FAIL: no {HASH_FILE}; run with --record at the pre-edit HEAD first")
        return 2

    bad = []
    for k, want in golden["hashes"].items():
        got = hashes.get(k)
        if got != want:
            bad.append((k, want, got))
    if bad:
        print(f"GOLDEN DECK DRIFT vs {golden['recorded_at_commit'][:12]}:")
        # dump the drifted decks for diffing
        decks = {}
        _all_hashes(keep_decks=decks)
        dump = os.path.join(tempfile.gettempdir(), "golden_deck_drift")
        os.makedirs(dump, exist_ok=True)
        for k, want, got in bad:
            p = os.path.join(dump, f"{k}.wam")
            with open(p, "w") as f:
                f.write(decks[k])
            print(f"  {k}: want {want[:16]}... got {(got or 'None')[:16]}...  deck -> {p}")
        return 1
    print(f"golden-deck OK ({len(hashes)} decks byte-identical to "
          f"{golden['recorded_at_commit'][:12]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

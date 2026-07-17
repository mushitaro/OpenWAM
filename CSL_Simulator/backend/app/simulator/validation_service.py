"""Stage 76 P2 — measured-vs-simulated validation.

Bins DS2 telemetry logs (app/data/telemetry/<id>.json, recorded by the Live
tab) onto the ECU map axes (rpm x RO — the same kf_rf_soll axes every sim run
uses) with steady-state gating, then compares the binned measurements against
a simulation run (last_run_<mode>.json):

  - rf (the DME's own relative-fill estimate, %) vs sim VE — SAME unit since
    Stage 74 (ECU m_ref 606.06), so delta is directly in pp;
  - rf_drrel (alpha-N) and rf_psau (MAP-based) as secondary rf estimates;
  - psau MAP [mbar] recorded per cell (plenum-pressure comparison feed);
  - VANOS: mean actual vs target vs OUR commanded map value (validates the
    spread conventions the DME docs could not confirm);
  - tz (ignition actual) vs the KF_TZ_VL / two-stage lookup the sim uses;
  - ambient conditions (IAT / pumg / coolant) so sims can be re-run at the
    measured environment.

Interpretation note baked into the payload: in the 3900-5300 WOT band the
model limit is deficit-by-design (missing 3D box mode) — there,
measured-minus-sim is an EMPIRICAL ESTIMATE OF THE BOX-MODE CONTRIBUTION,
not a calibration error.
"""
import json
import os

from . import metrics as M

# steady-state gates (MLV-filter-inspired; tuned for ~1-7 Hz DS2 sampling)
MAX_DRPM_DT = 1500.0     # rpm/s — rejects gearshift/clutch spikes, keeps WOT sweeps
MAX_DRO_DT = 60.0        # %/s  — rejects tip-in/tip-out transients
MIN_COOLANT = 75.0       # degC — warm engine only
MIN_HITS = 3             # min samples in a cell to report it
RPM_MIN = 500.0          # below = cranking/stall noise (map axis reaches 600)


def _nearest(axis, v):
    return min(range(len(axis)), key=lambda i: abs(axis[i] - v))


def _map_at(m, rpm, ro):
    """Nearest-breakpoint lookup on ONE map's own axes (evan/avan axes differ)."""
    try:
        xi = _nearest(m["x_axis"], rpm)
        yi = _nearest(m["y_axis"], ro)
        return m["values"][yi][xi]
    except Exception:
        return None


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return (sum(xs) / len(xs)) if xs else None


def _std(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) ** 0.5


class ValidationService:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.telemetry_dir = os.path.join(data_dir, "telemetry")

    # ------------------------------------------------------------------ io
    def _load_log(self, log_id):
        path = os.path.join(self.telemetry_dir, f"{log_id}.json")
        if not os.path.exists(path):
            raise FileNotFoundError(f"telemetry log {log_id} not found")
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def _load_run(self, mode):
        path = os.path.join(self.data_dir, f"last_run_{mode}.json")
        if not os.path.exists(path):
            raise FileNotFoundError(f"last_run_{mode}.json not found — run the map first")
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def _load_maps(self):
        with open(os.path.join(self.data_dir, "csl_ecu_maps.json"), encoding="utf-8") as f:
            return json.load(f)

    # ------------------------------------------------------------ binning
    def bin_log(self, samples, rpm_axis, ro_axis):
        """Steady-gated (rpm, RO) binning onto the map axes.

        Returns (cells dict keyed (ri, li), conditions summary, gate stats).
        """
        n_total = len(samples)
        kept = []
        for i, s in enumerate(samples):
            rpm = s.get("rpm")
            ro = s.get("ro")
            if rpm is None or ro is None or rpm < RPM_MIN:
                continue
            cool = s.get("coolant")
            if cool is not None and cool < MIN_COOLANT:
                continue
            # derivative gate vs the previous kept-worthy neighbour
            if i > 0:
                p = samples[i - 1]
                dt = (s.get("t", 0) - p.get("t", 0)) or 1e-3
                if dt > 0 and p.get("rpm") is not None:
                    if abs(rpm - p["rpm"]) / dt > MAX_DRPM_DT:
                        continue
                    if p.get("ro") is not None and abs(ro - p["ro"]) / dt > MAX_DRO_DT:
                        continue
            kept.append(s)

        cells = {}
        for s in kept:
            key = (_nearest(rpm_axis, s["rpm"]), _nearest(ro_axis, s["ro"]))
            cells.setdefault(key, []).append(s)

        conditions = {
            "iat_mean": _mean([s.get("iat") for s in kept]),
            "coolant_mean": _mean([s.get("coolant") for s in kept]),
            "ambient_pressure_mean": _mean([s.get("ambientPressure") for s in kept]),
        }
        gates = {"total": n_total, "kept": len(kept),
                 "rejected": n_total - len(kept)}
        return cells, conditions, gates

    # ------------------------------------------------------------ compare
    def compare(self, log_id, mode="full_map"):
        log = self._load_log(log_id)
        run = self._load_run(mode)
        maps = self._load_maps()

        rpm_axis = run["axes"]["rpm"]
        ro_axis = run["axes"]["load"]
        sim_cells = run["cells"]  # [loadRow][rpmCol]

        evan_map = maps.get("kf_evan1_soll", {})
        avan_map = maps.get("kf_avan1_soll", {})

        binned, conditions, gates = self.bin_log(log["samples"], rpm_axis, ro_axis)

        out_cells = []
        for (ri, li), ss in sorted(binned.items()):
            if len(ss) < MIN_HITS:
                continue
            rpm, ro = rpm_axis[ri], ro_axis[li]
            sim = sim_cells[li][ri] if li < len(sim_cells) and ri < len(sim_cells[li]) else None
            sim_ve = sim.get("ve_sim") if sim else None
            sim_valid = bool(sim and sim.get("health", {}).get("valid"))

            rf_mean = _mean([s.get("rf") for s in ss])
            cell = {
                "rpm": rpm, "ro": ro, "hits": len(ss),
                "rf_mean": rf_mean, "rf_std": _std([s.get("rf") for s in ss]),
                # rf_drrel / rf_psau arrive as fractions (x0.001 raw scale) -> %
                "rf_drrel_mean": _mean([s["rfDrrel"] * 100 for s in ss
                                        if s.get("rfDrrel") is not None]),
                "rf_psau_mean": _mean([s["rfPsau"] * 100 for s in ss
                                       if s.get("rfPsau") is not None]),
                "map_mbar_mean": _mean([s.get("map") for s in ss]),
                "sim_ve": sim_ve, "sim_valid": sim_valid,
                "delta": (rf_mean - sim_ve) if (rf_mean is not None and sim_ve is not None) else None,
                # VANOS: measured actual/target + our commanded map value
                "evan_ist": _mean([s.get("evanIst") for s in ss]),
                "evan_soll": _mean([s.get("evanSoll") for s in ss]),
                "avan_ist": _mean([s.get("avanIst") for s in ss]),
                "avan_soll": _mean([s.get("avanSoll") for s in ss]),
                "tz_mean": _mean([
                    _mean(s.get("tz") or []) for s in ss if s.get("tz")
                ]),
                "tz_expected": M.ignition_for(maps, rpm, ro),
            }
            cell["evan_map"] = _map_at(evan_map, rpm, ro)
            cell["avan_map"] = _map_at(avan_map, rpm, ro)
            out_cells.append(cell)

        # band summaries over WOT-ish cells (ro >= 85)
        band = M.MODEL_LIMITS["wot_deficit_band"]
        wot = [c for c in out_cells if c["ro"] >= band["load_min"] and c["delta"] is not None]
        in_band = [c for c in wot if band["rpm_min"] <= c["rpm"] <= band["rpm_max"]]
        out_band = [c for c in wot if not (band["rpm_min"] <= c["rpm"] <= band["rpm_max"])]
        vanos_cells = [c for c in out_cells
                       if c["evan_ist"] is not None and c["evan_soll"] is not None]

        summary = {
            "n_cells": len(out_cells),
            "wot_delta_mean_ex_band": _mean([c["delta"] for c in out_band]),
            "wot_delta_mean_in_band": _mean([c["delta"] for c in in_band]),
            "box_mode_note": (
                "in-band (3900-5300 WOT) measured-minus-sim estimates the 3D "
                "box-mode contribution the 1D model cannot host — expect it "
                "POSITIVE there; it is not a calibration error"),
            "vanos_tracking_mean_abs": _mean([
                abs(c["evan_ist"] - c["evan_soll"]) for c in vanos_cells
            ]) if vanos_cells else None,
            "vanos_map_match_mean_abs": _mean([
                abs(c["evan_soll"] - c["evan_map"]) for c in vanos_cells
                if c.get("evan_map") is not None
            ]) if vanos_cells else None,
        }

        return {
            "schema_version": M.SCHEMA_VERSION,
            "log_id": log_id,
            "log_meta": log.get("meta", {}),
            "run_mode": mode,
            "run_id": run.get("run_id"),
            "run_unit": run.get("unit"),
            "model_limits": M.MODEL_LIMITS,
            "gates": gates,
            "conditions": conditions,
            "cells": out_cells,
            "summary": summary,
        }

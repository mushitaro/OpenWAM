"""Input-validation report for a real DS2 drive log (Stage 76 P3).

Answers "can we trust this log, and are the model's INPUTS right?" BEFORE any
VE conclusion is drawn from it (Stage-74 rule: input truth precedes fit
quality). Every check below is one the owner's car can settle by itself:

  1. RO decode      - measured rf vs the DME's OWN kf_rf_soll(rpm, RO) model.
                      The ECU must agree with itself; a wrong aq_rel scale
                      shows up here as a huge bias (this is how the catalog's
                      100/215 scale was falsified -> 100/32768).
  2. rf provenance  - is rf the MAF measurement (usable as ground truth) or a
                      map read-back (useless)? Compares rf against ml/rpm and
                      recovers the DME's m_ref.
  3. VANOS          - hardware tracking (ist vs soll) and the map<->live
                      conventions, then whether the SIM's per-cell cam phase
                      (map lookup + conversion) equals the car's actual cam.
  4. Ignition       - measured tz vs what metrics.ignition_for() feeds decks.
  5. Conditions     - inlet density of the drive vs the sim's environment; rf
                      is a MASS ratio, so a density mismatch biases every
                      comparison and must be stated with any VE claim.

Run:  cd CSL_Simulator/backend && python scripts/validate_drive_log.py <log_id> [...]
"""
import json
import os
import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.simulator import metrics as M            # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "data")
M_REF = 606.06        # mg, ECU reference (BIN K_RF_LUFTDICHTE 1.136 * 3.201/6)
RHO_REF = 1.136       # kg/m3, the density that reference mass assumes
# ml[kg/h] -> mg per cylinder-event: *1e6/3600 / (rpm/60/2*6)
ML_TO_MG = 5555.6
EVAN_OFFSET = 70.0    # map = live + 70            (confirmed on the car)
AVAN_SUM = 128.0      # map = 128 - live (INVERTED) (confirmed on the car)
R_AIR = 287.0


def lut(m, x, y):
    xi = min(range(len(m["x_axis"])), key=lambda i: abs(m["x_axis"][i] - x))
    yi = min(range(len(m["y_axis"])), key=lambda i: abs(m["y_axis"][i] - y))
    return m["values"][yi][xi]


def stats(xs):
    return (len(xs), st.mean(xs), st.pstdev(xs)) if xs else (0, float("nan"), float("nan"))


def report(log_id, maps, sim_env):
    path = os.path.join(DATA_DIR, "telemetry", f"{log_id}.json")
    with open(path, encoding="utf-8") as f:
        rec = json.load(f)
    meta, samples = rec.get("meta", {}), rec["samples"]
    print("=" * 74)
    print(f"{log_id}   n={len(samples)}  dur={samples[-1]['t'] - samples[0]['t']:.0f}s  "
          f"VIN {meta.get('vin')}  decoder v{meta.get('decoder_version', 1)}")
    if meta.get("source") != "webserial":
        print("  !! source is not 'webserial' - this is NOT measured data")
    if meta.get("complete") is False:
        print("  !! incomplete (checkpoint of an interrupted recording)")
    s = [x for x in samples if x["rpm"] > 900 and x.get("rf") is not None]

    # 1 - RO decode vs the DME's own model
    e = [x["rf"] - lut(maps["kf_rf_soll"], x["rpm"], x["ro"]) * 100
         for x in s if x.get("ro") is not None]
    n, mu, sd = stats(e)
    oor = sum(1 for x in s if x.get("ro") is not None and not 0 <= x["ro"] <= 105)
    print(f"\n[1] RO decode   rf - kf_rf_soll(rpm,RO): mean {mu:+6.2f}pp sd {sd:5.2f}  n={n}"
          f"   out-of-range RO: {oor}")
    print("    -> the ECU agreeing with its own model within a few pp = RO scale is right"
          if abs(mu) < 3 and oor == 0 else "    -> SUSPECT: the aq_rel scale looks wrong")

    # 2 - is rf the MAF measurement?
    pairs = [(x["rf"], x["ml"] * ML_TO_MG / x["rpm"] / M_REF * 100) for x in s if x.get("ml")]
    if pairs:
        a = [p[0] for p in pairs]
        b = [p[1] for p in pairs]
        ma, mb = st.mean(a), st.mean(b)
        num = sum((u - ma) * (v - mb) for u, v in zip(a, b))
        den = (sum((u - ma) ** 2 for u in a) * sum((v - mb) ** 2 for v in b)) ** 0.5
        ratio = [u / v for u, v in pairs if v > 1]
        print(f"\n[2] rf source   corr(rf, MAF-derived fill) = {num/den:.4f}"
              f"   rf/MAF-fill = {st.mean(ratio):.3f} +/- {st.pstdev(ratio):.3f}")
        print(f"    -> rf IS the MAF measurement; implied m_ref = {M_REF/st.mean(ratio):.1f} mg "
              f"(ours {M_REF})" if num/den > 0.999 else "    -> rf does NOT track the MAF")

    # 3 - VANOS
    ei = [x["evanIst"] - x["evanSoll"] for x in s if x.get("evanIst") is not None]
    ai = [x["avanIst"] - x["avanSoll"] for x in s if x.get("avanIst") is not None]
    print(f"\n[3] VANOS       tracking ist-soll: intake {st.mean(ei):+5.2f} +/- {st.pstdev(ei):4.2f} deg"
          f" | exhaust {st.mean(ai):+5.2f} +/- {st.pstdev(ai):4.2f} deg")
    di = [x["evanIst"] - (lut(maps["kf_evan1_soll"], x["rpm"], x["ro"]) - EVAN_OFFSET) for x in s]
    da = [x["avanIst"] - (AVAN_SUM - lut(maps["kf_avan1_soll"], x["rpm"], x["ro"])) for x in s]
    print(f"    sim-assumed cam vs car ACTUAL: intake {st.mean(di):+5.2f} +/- {st.pstdev(di):4.2f} deg"
          f" | exhaust {st.mean(da):+5.2f} +/- {st.pstdev(da):4.2f} deg")
    print("    -> conventions: intake map = live+70, exhaust map = 128-live (INVERTED)")

    # 4 - ignition
    dz = [st.mean([t for t in x["tz"] if t is not None]) - M.ignition_for(maps, x["rpm"], x["ro"])
          for x in s if x.get("tz") and any(t is not None for t in x["tz"])]
    wot = [x for x in s if x["ro"] >= 85 and x.get("tz")]
    dzw = [st.mean([t for t in x["tz"] if t is not None]) - M.ignition_for(maps, x["rpm"], x["ro"])
           for x in wot]
    print(f"\n[4] Ignition    measured tz - sim input: all {st.mean(dz):+6.2f} +/- {st.pstdev(dz):5.2f} deg"
          + (f" | WOT(n={len(dzw)}) {st.mean(dzw):+6.2f} +/- {st.pstdev(dzw):4.2f}" if dzw else ""))
    print("    -> negative = the sim runs MORE advance than the car did")

    # 5 - conditions / density
    iat = st.mean([x["iat"] for x in s])
    amb_t = st.mean([x["ambientTemp"] for x in s])
    amb_p = st.mean([x["ambientPressure"] for x in s])
    rho_sim = sim_env["ambient_pressure"] / (R_AIR * sim_env["ambient_temp"])
    rho_iat = amb_p * 100 / (R_AIR * (iat + 273.15))
    rho_amb = amb_p * 100 / (R_AIR * (amb_t + 273.15))
    print(f"\n[5] Conditions  drive: ambient {amb_t:.0f}C / {amb_p:.0f}mbar, IAT {iat:.0f}C"
          f"   sim: {sim_env['ambient_temp'] - 273.15:.0f}C / {sim_env['ambient_pressure']/100:.0f}mbar")
    print(f"    inlet density  sim {rho_sim:.3f} | car(IAT) {rho_iat:.3f} | car(ambient) {rho_amb:.3f} kg/m3"
          f"   (rf reference {RHO_REF})")
    print(f"    -> rf is a MASS ratio: measured rf must be scaled x{rho_sim/rho_iat:.3f}"
          f" (IAT) .. x{rho_sim/rho_amb:.3f} (ambient) to compare against this sim")

    # WOT roll call - the mission-critical cells
    print(f"\n[*] WOT samples (RO>=85): n={len(wot)}")
    for x in sorted(wot, key=lambda x: x["rpm"]):
        print(f"    {x['rpm']:5d} rpm  RO {x['ro']:5.1f}  rf {x['rf']:6.1f}  "
              f"map {x['map']:4.0f}mbar  IAT {x['iat']:.0f}C  "
              f"evan {x['evanIst']:5.1f} avan {x['avanIst']:5.1f}  "
              f"tz {st.mean([t for t in x['tz'] if t is not None]):5.1f}")


def main():
    ids = sys.argv[1:]
    if not ids:
        tdir = os.path.join(DATA_DIR, "telemetry")
        ids = [f[:-5] for f in sorted(os.listdir(tdir))
               if f.endswith(".json") and not f.startswith("mock_")]
    with open(os.path.join(DATA_DIR, "csl_ecu_maps.json"), encoding="utf-8") as f:
        maps = json.load(f)
    with open(os.path.join(os.path.dirname(__file__), "..", "..", "frontend",
                           "presets", "v14_owner.json"), encoding="utf-8") as f:
        sim_env = json.load(f)["environment"]
    for log_id in ids:
        report(log_id, maps, sim_env)


if __name__ == "__main__":
    main()

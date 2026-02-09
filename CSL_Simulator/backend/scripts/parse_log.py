"""Parse OpenWAM simulation log to extract gas-exchange data."""
import re, sys

log_file = sys.argv[1] if len(sys.argv) > 1 else "output/test_vanos_vlvcd_log.txt"

with open(log_file, "r", errors="ignore") as f:
    log = f.read()

# Extract gas exchange blocks
pattern = (
    r"End of Gas-exchange process in cylinder (\d+)\s*\n"
    r".*?\n"
    r"INFO: Intake mass:\s+([\d.]+) \(g\)\s*\n"
    r"INFO: Exhaust mass:\s+([\-\d.]+) \(g\)\s*\n"
    r"INFO: Trapped mass:\s+([\d.]+) \(g\)\s*\n"
    r"INFO: Time: ([\d.]+) RPM: (\d+) Trapped mass: [\d.]+ \(g\)\s*\n"
    r"INFO: Pressure at I\.C\.:\s+([\d.]+) \(bar\)\s*\n"
    r"INFO: Fuel mass:\s+([\d.]+) \(mg\)"
)
blocks = re.findall(pattern, log, re.DOTALL)

print(f"Total gas-exchange events: {len(blocks)}")
print()

# Header
hdr = f"{'Cyl':>4s} {'Intake_g':>10s} {'Exhaust_g':>10s} {'Trapped_g':>10s} {'P_IC_bar':>10s} {'Fuel_mg':>10s} {'Time_s':>8s} {'RPM':>5s}"
print(hdr)
print("-" * len(hdr))

# Show last 18 blocks (3 full engine cycles for 6-cyl)
for cyl, intake, exhaust, trapped, time_s, rpm, p_ic, fuel in blocks[-18:]:
    print(f"{cyl:>4s} {intake:>10s} {exhaust:>10s} {trapped:>10s} {p_ic:>10s} {fuel:>10s} {time_s:>8s} {rpm:>5s}")

# Summary stats for last full cycle (6 events)
if len(blocks) >= 6:
    print()
    print("=== Last Cycle Summary ===")
    last6 = blocks[-6:]
    masses = [float(b[3]) for b in last6]
    intakes = [float(b[1]) for b in last6]
    exhausts = [abs(float(b[2])) for b in last6]
    pressures = [float(b[6]) for b in last6]
    
    avg_trapped = sum(masses) / len(masses) * 1000  # mg
    avg_intake = sum(intakes) / len(intakes) * 1000  # mg
    avg_exhaust = sum(exhausts) / len(exhausts) * 1000  # mg
    avg_p = sum(pressures) / len(pressures)
    
    # Residual gas fraction estimate  
    residual = avg_trapped - avg_intake
    residual_frac = residual / avg_trapped * 100 if avg_trapped > 0 else 0
    
    print(f"  Avg Trapped mass:    {avg_trapped:.1f} mg")
    print(f"  Avg Intake mass:     {avg_intake:.1f} mg")
    print(f"  Avg Exhaust mass:    {avg_exhaust:.1f} mg")
    print(f"  Avg Pressure @ IVC:  {avg_p:.4f} bar")
    print(f"  Residual gas:        {residual:.1f} mg ({residual_frac:.1f}%)")
    print(f"  Mass balance:        Trapped - Intake = {avg_trapped - avg_intake:.1f} mg")
    
    # VE calculation
    R_air = 287.058
    rho_air = 101325.0 / (R_air * 298.0)
    disp_cc = 543.0  # per cylinder
    th_mass_mg = disp_cc * (rho_air / 1000.0) * 1000.0
    ve = (avg_intake / th_mass_mg) * 100.0
    
    print(f"  Theoretical mass:    {th_mass_mg:.1f} mg (per cyl @ STP)")
    print(f"  VE (intake/theor):   {ve:.1f}%")
    print(f"  VE (trapped/theor):  {(avg_trapped / th_mass_mg) * 100:.1f}%")

# Check for NaN warnings
nan_count = log.count("NaN")
print(f"\n  NaN occurrences in log: {nan_count}")

# Check valve NaN details
valve_nans = re.findall(r"DEBUG VALVE NaN Cyl (\d+) (Adm|Esc)Valve (\d+)", log)
if valve_nans:
    print(f"  Valve NaN events: {len(valve_nans)}")
    # Group by type
    adm = [v for v in valve_nans if v[1] == "Adm"]
    esc = [v for v in valve_nans if v[1] == "Esc"]
    print(f"    Intake (Adm): {len(adm)} events")
    print(f"    Exhaust (Esc): {len(esc)} events")
    # Which cylinders
    adm_cyls = set(v[0] for v in adm)
    esc_cyls = set(v[0] for v in esc)
    if adm_cyls: print(f"    Intake NaN cylinders: {sorted(adm_cyls)}")
    if esc_cyls: print(f"    Exhaust NaN cylinders: {sorted(esc_cyls)}")

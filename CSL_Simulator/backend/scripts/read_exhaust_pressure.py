"""Extract pressure stats from OpenWAM INS.DAT by pipe ID mapping."""
# Pipe ID mapping from DEBUG output:
# Intake: 1=IntakePipe, 2=Filter, 3=Bell1, 4=Run1, 5-8=Port_In_1, 9=Bell2...
# Exhaust starts at 39: Port_Ex_Pocket_1_1
# Headers: 43,48,53,58,63,68
# Col_Out: 69,70, Sec1_1: 71,72, FrontCat: 73,74
# Sec1_2: 75,76, Sec2_1: 77,78, H: 79-81, Sec2_2: 82,83
# Muf_Adapter: 84,85, Tail: 86,87

pipe_map = {
    1: "CSL_Intake_Pipe", 2: "Panel_Filter",
    3: "Bellmouth_1", 4: "Runner_1",
    5: "Port_In_Main_1_1", 6: "Port_In_Pocket_1_1",
    39: "Port_Ex_Pocket_1_1", 40: "Port_Ex_Main_1_1",
    43: "Header_1", 48: "Header_2", 53: "Header_3",
    58: "Header_4", 63: "Header_5", 68: "Header_6",
    69: "Col_Out_L", 70: "Col_Out_R",
    71: "Sec1_1_L", 73: "FrontCat_L",
    75: "Sec1_2_L", 77: "Sec2_1_L",
    79: "Sec2_H_L", 81: "Sec2_H_Cross",
    82: "Sec2_2_L", 84: "Muf_Adapter_L",
    86: "Tail_1", 87: "Tail_2",
}

with open("temp_test_vanos_vlvcdINS.DAT", "r", errors="ignore") as f:
    header = f.readline().strip()
    lines = f.readlines()

cols = header.split("\t")

# Build column index for inlet pressure (at_0_m) of each target duct
target_cols = {}
for i, c in enumerate(cols):
    for pid, name in pipe_map.items():
        key = f"P_duct_{pid}_at_0_m"
        if c.startswith(key):
            target_cols[name] = i
            break

print(f"Mapped {len(target_cols)} pressure columns")
print()

# Analyze last 10% of data (stabilized cycle)
n = len(lines)
start = int(n * 0.9)

from collections import defaultdict
sums = defaultdict(float)
counts = defaultdict(int)
mins = defaultdict(lambda: 999.0)
maxs = defaultdict(lambda: -999.0)

for line in lines[start:]:
    parts = line.strip().split("\t")
    for name, idx in target_cols.items():
        try:
            val = float(parts[idx])
            if -50 < val < 200:
                sums[name] += val
                counts[name] += 1
                mins[name] = min(mins[name], val)
                maxs[name] = max(maxs[name], val)
        except (ValueError, IndexError):
            pass

print(f"{'Component':<25s} {'Avg(bar)':>10s} {'Min(bar)':>10s} {'Max(bar)':>10s} {'Delta':>8s}")
print("=" * 65)

order = [
    "--- INTAKE ---",
    "CSL_Intake_Pipe", "Panel_Filter", "Bellmouth_1", "Runner_1",
    "Port_In_Main_1_1", "Port_In_Pocket_1_1",
    "--- EXHAUST ---",
    "Port_Ex_Pocket_1_1", "Port_Ex_Main_1_1",
    "Header_1", "Col_Out_L", "Sec1_1_L", "FrontCat_L",
    "Sec1_2_L", "Sec2_1_L", "Sec2_H_L", "Sec2_H_Cross",
    "Sec2_2_L", "Muf_Adapter_L", "Tail_1",
]

for name in order:
    if name.startswith("---"):
        print(f"\n{name}")
        continue
    if name in counts and counts[name] > 0:
        avg = sums[name] / counts[name]
        delta = maxs[name] - mins[name]
        print(f"  {name:<23s} {avg:>10.4f} {mins[name]:>10.4f} {maxs[name]:>10.4f} {delta:>8.4f}")
    else:
        print(f"  {name:<23s}  (no data)")

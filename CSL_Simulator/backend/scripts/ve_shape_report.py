#!/usr/bin/env python3
"""Shape-following report for a VE sweep CSV (Stage 49+).

Reads the resumable sweep CSV (rpm,load,base,exbias,stock,sim,valid,cyc) and prints
per-load-row tables plus SHAPE metrics. Per the project goal the ABSOLUTE offset is
removed by a correction; what must track is the SHAPE/trend, so we report:
  - per-cell sim/stock
  - row-normalised shape: (sim/row_mean_sim) vs (stock/row_mean_stock), and their
    max deviation per row ("shape err")
  - Pearson r over all trusted cells, and per load row
Cells are TRUSTED only if valid=1 (cylinder-balance gate) and cyc >= 26.
"""
import csv, math, os, sys

CSV = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shape_map_choke.csv"
MIN_CYC = int(os.environ.get("SHAPE_MIN_CYC", "26"))

rows = []
if os.path.exists(CSV):
    for r in csv.reader(open(CSV)):
        if len(r) >= 8 and r[0] != "rpm":
            rows.append(dict(rpm=int(r[0]), load=int(float(r[1])), base=int(float(r[2])),
                             stock=float(r[4]), sim=float(r[5]) if r[5] != "nan" else float("nan"),
                             valid=r[6] == "1", cyc=int(r[7])))

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return float("nan")
    mx, my = sum(xs)/n, sum(ys)/n
    sx = math.sqrt(sum((x-mx)**2 for x in xs)); sy = math.sqrt(sum((y-my)**2 for y in ys))
    if sx == 0 or sy == 0: return float("nan")
    return sum((x-mx)*(y-my) for x, y in zip(xs, ys))/(sx*sy)

trusted = [r for r in rows if r["valid"] and r["cyc"] >= MIN_CYC and r["sim"] == r["sim"]]
gated   = [r for r in rows if not r["valid"] or r["cyc"] < MIN_CYC]

loads = sorted({r["load"] for r in rows}, reverse=True)
print(f"# shape report: {CSV}  ({len(trusted)} trusted / {len(rows)} cells; gate: valid & cyc>={MIN_CYC})")
all_ratio = []
for ld in loads:
    seg = sorted([r for r in trusted if r["load"] == ld], key=lambda r: r["rpm"])
    rej = sorted([r for r in rows if r["load"] == ld and r not in seg], key=lambda r: r["rpm"])
    if not seg and not rej: continue
    print(f"\n## load {ld}")
    print("  rpm    stock    sim   sim/stock  shape_sim shape_stock")
    if seg:
        ms = sum(r["sim"] for r in seg)/len(seg); mk = sum(r["stock"] for r in seg)/len(seg)
        for r in seg:
            ss, sk = r["sim"]/ms, r["stock"]/mk
            all_ratio.append(r["sim"]/r["stock"])
            print(f"  {r['rpm']:>4} {r['stock']:>7.1f} {r['sim']:>7.1f}   {r['sim']/r['stock']:>5.2f}     {ss:>5.2f}     {sk:>5.2f}")
        rr = pearson([r["sim"] for r in seg], [r["stock"] for r in seg])
        shape_err = max(abs(r["sim"]/ms - r["stock"]/mk) for r in seg)
        print(f"  -> row r={rr:.3f}  max shape err={shape_err:.2f}  scale={ms/mk:.2f}")
    for r in rej:
        why = "GATED(cyl-balance)" if not r["valid"] else f"cyc{r['cyc']}<{MIN_CYC}"
        print(f"  {r['rpm']:>4} {r['stock']:>7.1f} {r['sim']:>7.1f}   [{why}]")

if trusted:
    rall = pearson([r["sim"] for r in trusted], [r["stock"] for r in trusted])
    import statistics
    print(f"\n# OVERALL: r={rall:.3f} over {len(trusted)} cells; sim/stock median {statistics.median(all_ratio):.2f}"
          f" spread {min(all_ratio):.2f}-{max(all_ratio):.2f}; {len(gated)} gated/unconverged")

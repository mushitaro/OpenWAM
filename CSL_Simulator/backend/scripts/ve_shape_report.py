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
import csv, math, os, re, statistics, sys

CSV = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shape_map_choke.csv"
MIN_CYC = int(os.environ.get("SHAPE_MIN_CYC", "26"))
M_REF = math.pi*(0.087/2)**2*0.091*(101325/(287.05*298.0))*1000  # 0.6408 g = 100% VE

def cyl_health(rpm, load, base):
    """Per-cylinder health from the cell's run.log (if it still exists in /tmp).
    Returns (healthy_VE_percent, n_collapsed) or (nan, -1). A cylinder is
    collapsed if its last-2-cycle mean Mtrap < 0.5x the fleet median (the
    cylinder_balance criterion)."""
    path = f"/tmp/ex_{rpm}_{load}_{base}/run.log"
    if not os.path.exists(path):
        return float("nan"), -1
    t = open(path, encoding="utf-8", errors="ignore").read()
    pairs = re.findall(r"VEDIAG Cyl:(\d+) .*?Mtrap:([0-9.]+) g", t)
    if len(pairs) < 12:
        return float("nan"), -1
    last = {}
    for c, m in pairs[-12:]:
        last.setdefault(int(c), []).append(float(m))
    means = {c: statistics.mean(v) for c, v in last.items()}
    med = statistics.median(means.values())
    healthy = [m for m in means.values() if m >= 0.5*med]
    ncol = len(means) - len(healthy)
    return (statistics.mean(healthy)/M_REF*100 if healthy else float("nan")), ncol

rows = []
if os.path.exists(CSV):
    for r in csv.reader(open(CSV)):
        if len(r) >= 8 and r[0] != "rpm":
            d = dict(rpm=int(r[0]), load=int(float(r[1])), base=int(float(r[2])),
                     stock=float(r[4]), sim=float(r[5]) if r[5] != "nan" else float("nan"),
                     valid=r[6] == "1", cyc=int(r[7]))
            d["hve"], d["ncol"] = cyl_health(d["rpm"], d["load"], d["base"])
            # the comparison VE: healthy-cylinder mean when the log is available
            # and a collapse is present (Stage 42/48: collapse cells are gated,
            # but the healthy fill still measures the breathing model)
            d["cmp"] = d["hve"] if (d["ncol"] > 0 and d["hve"] == d["hve"]) else d["sim"]
            rows.append(d)

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return float("nan")
    mx, my = sum(xs)/n, sum(ys)/n
    sx = math.sqrt(sum((x-mx)**2 for x in xs)); sy = math.sqrt(sum((y-my)**2 for y in ys))
    if sx == 0 or sy == 0: return float("nan")
    return sum((x-mx)*(y-my) for x, y in zip(xs, ys))/(sx*sy)

trusted = [r for r in rows if r["valid"] and r["cyc"] >= MIN_CYC and r["cmp"] == r["cmp"]]
gated   = [r for r in rows if not r["valid"] or r["cyc"] < MIN_CYC]

loads = sorted({r["load"] for r in rows}, reverse=True)
print(f"# shape report: {CSV}  ({len(trusted)} trusted / {len(rows)} cells; gate: valid & cyc>={MIN_CYC})")
print(f"# cmp = healthy-cylinder VE where a cyl collapse is present (ncol>0), else the all-cyl VE")
all_ratio = []
for ld in loads:
    seg = sorted([r for r in trusted if r["load"] == ld], key=lambda r: r["rpm"])
    rej = sorted([r for r in rows if r["load"] == ld and r not in seg], key=lambda r: r["rpm"])
    if not seg and not rej: continue
    print(f"\n## load {ld}")
    print("  rpm    stock    cmp   cmp/stock  shape_sim shape_stock  ncol")
    if seg:
        ms = sum(r["cmp"] for r in seg)/len(seg); mk = sum(r["stock"] for r in seg)/len(seg)
        for r in seg:
            ss, sk = r["cmp"]/ms, r["stock"]/mk
            all_ratio.append(r["cmp"]/r["stock"])
            nc = r["ncol"] if r["ncol"] >= 0 else "?"
            print(f"  {r['rpm']:>4} {r['stock']:>7.1f} {r['cmp']:>7.1f}   {r['cmp']/r['stock']:>5.2f}     {ss:>5.2f}     {sk:>5.2f}     {nc}")
        rr = pearson([r["cmp"] for r in seg], [r["stock"] for r in seg])
        shape_err = max(abs(r["cmp"]/ms - r["stock"]/mk) for r in seg)
        print(f"  -> row r={rr:.3f}  max shape err={shape_err:.2f}  scale={ms/mk:.2f}")
    for r in rej:
        why = "GATED(spread)" if not r["valid"] else f"cyc{r['cyc']}<{MIN_CYC}"
        extra = f" hve={r['hve']:.1f} ncol={r['ncol']}" if r["hve"] == r["hve"] and r["ncol"] >= 0 else ""
        print(f"  {r['rpm']:>4} {r['stock']:>7.1f} {r['sim']:>7.1f}   [{why}]{extra}")

if trusted:
    rall = pearson([r["cmp"] for r in trusted], [r["stock"] for r in trusted])
    print(f"\n# OVERALL: r={rall:.3f} over {len(trusted)} cells; cmp/stock median {statistics.median(all_ratio):.2f}"
          f" spread {min(all_ratio):.2f}-{max(all_ratio):.2f}; {len(gated)} gated/unconverged")

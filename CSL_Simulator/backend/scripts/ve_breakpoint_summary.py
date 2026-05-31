#!/usr/bin/env python3
"""Overlay init / cold / conv VE against the real kf_rf_soll target at its own
breakpoints. Reports per-RPM table and a shape-correlation: does the
thermally-clean breathing (init/cold) track the peaky target, and is conv flat?"""
import csv, os, math

def load(mode):
    p = f"/tmp/bp_{mode}.csv"
    if not os.path.exists(p): return {}
    return {int(r["rpm"]): (float(r["ve_sim"]), float(r["ve_tgt"]), int(r["nan"]), int(r["fin"]))
            for r in csv.DictReader(open(p))}

I, C, V = load("init"), load("cold"), load("conv")
rpms = sorted(set(I) | set(C) | set(V))
tgt = {r: (I.get(r) or C.get(r) or V.get(r))[1] for r in rpms}

print(f"{'RPM':>5} {'tgt%':>6} | {'init%':>6} {'cold%':>6} {'conv%':>6} | "
      f"{'init/t':>6} {'cold/t':>6} {'conv/t':>6}")
print("-"*70)
for r in rpms:
    t = tgt[r]
    iv = I.get(r, (float('nan'),))[0]; cv = C.get(r, (float('nan'),))[0]; vv = V.get(r, (float('nan'),))[0]
    print(f"{r:5d} {t:6.1f} | {iv:6.1f} {cv:6.1f} {vv:6.1f} | "
          f"{iv/t:6.2f} {cv/t:6.2f} {vv/t:6.2f}")

def pearson(xs, ys):
    pts = [(x, y) for x, y in zip(xs, ys) if x == x and y == y]
    if len(pts) < 3: return float('nan')
    xs, ys = zip(*pts); n = len(xs)
    mx, my = sum(xs)/n, sum(ys)/n
    cov = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x-mx)**2 for x in xs)); sy = math.sqrt(sum((y-my)**2 for y in ys))
    return cov/(sx*sy) if sx and sy else float('nan')

tv = [tgt[r] for r in rpms]
print("\n# Shape correlation vs target (1.0 = perfectly tracks the peaky shape):")
for name, D in (("init", I), ("cold", C), ("conv", V)):
    sv = [D.get(r, (float('nan'),))[0] for r in rpms]
    sd = (max(x for x in sv if x == x) - min(x for x in sv if x == x)) if any(x==x for x in sv) else float('nan')
    print(f"  {name:5}: corr={pearson(tv, sv):+.2f}  span(maxVE-minVE)={sd:5.1f}pp")
print("\n# Interpretation: high corr + wide span on init/cold but ~0 corr + narrow span")
print("#   on conv => the peaky tuning IS in the breathing, the feedback flattens it.")

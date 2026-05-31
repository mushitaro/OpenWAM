#!/usr/bin/env python3
"""Robust converged-VE extractor: reads clean 10-cycle logs and takes the mean
trapped mass of the LAST FULL CYCLE (6 cylinders), comparing to the CORRECTED
stock target. Avoids the median-of-last-6 transient bug in ve_converged_sweep."""
import re, json, math, glob, os

BORE, STROKE = 0.087, 0.091
M_REF = math.pi*(BORE/2)**2*STROKE * (101325/(287.05*298.0)) * 1000  # g @ VE=100%
STOCK = {d["rpm"]: d["ve"] for d in json.load(open("app/data/stock_csl_ve.json"))}

def sve(rpm):
    xs = sorted(STOCK)
    if rpm <= xs[0]: return STOCK[xs[0]]
    if rpm >= xs[-1]: return STOCK[xs[-1]]
    for i in range(len(xs)-1):
        if xs[i] <= rpm <= xs[i+1]:
            t = (rpm-xs[i])/(xs[i+1]-xs[i])
            return STOCK[xs[i]]*(1-t) + STOCK[xs[i+1]]*t

print(f"M_REF(VE=100%) = {M_REF:.4f} g")
print(f"{'RPM':>5} {'last_cyc_g':>10} {'VE_sim%':>8} {'tgt%':>6} {'gap_pp':>7} {'ratio':>6} {'NaN':>4} {'FIN':>4}")
print("-"*60)
rows = []
for rpm in [2000,3000,3500,4000,4500,5000,6000,7000]:
    log = f"/tmp/trj_{rpm}.log"
    if not os.path.exists(log): continue
    t = open(log, encoding='utf-8', errors='ignore').read()
    tms = [float(x) for x in re.findall(r'Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)', t)]
    # de-duplicate consecutive identical prints (each IVC printed twice)
    dedup = []
    for v in tms:
        if not dedup or abs(dedup[-1]-v) > 1e-9:
            dedup.append(v)
    good = [m for m in dedup if 1e-3 < m < 2.0]
    last6 = good[-6:] if len(good) >= 6 else good
    m = sum(last6)/len(last6) if last6 else float('nan')
    ve = m/M_REF*100
    tgt = sve(rpm)*100
    nan = len(re.findall(r'DEBUG BC NaN', t))
    fin = 1 if 'FINISHED CORRECTLY' in t else 0
    rows.append((rpm, m, ve, tgt, ve-tgt, ve/tgt, nan, fin))
    print(f"{rpm:5d} {m:10.4f} {ve:8.1f} {tgt:6.1f} {ve-tgt:7.1f} {ve/tgt:6.2f} {nan:4d} {fin:4d}")

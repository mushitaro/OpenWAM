#!/usr/bin/env python3
"""Converged VE sweep (HLLC, stable multi-cycle). Runs N cycles per RPM and
takes the trapped mass from the LAST cycle (converged), comparing to stock CSL.
Usage: ve_converged_sweep.py [cycles] [timeout_s]
"""
import sys, io, os, re, subprocess, time, json, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator
BIN = "/home/user/OpenWAM/build/bin/release/OpenWAM"
CYCLES = int(sys.argv[1]) if len(sys.argv) > 1 else 6
TMO = int(sys.argv[2]) if len(sys.argv) > 2 else 90
BORE, STROKE = 0.087, 0.091
V_CYL = math.pi*(BORE/2)**2*STROKE
M_REF = V_CYL*(101325/(287.05*298.0))*1000  # g (VE=100%)
STOCK = {d["rpm"]: d["ve"] for d in json.load(open("app/data/stock_csl_ve.json"))}
def sve(rpm):
    xs=sorted(STOCK)
    if rpm<=xs[0]: return STOCK[xs[0]]
    if rpm>=xs[-1]: return STOCK[xs[-1]]
    for i in range(len(xs)-1):
        if xs[i]<=rpm<=xs[i+1]:
            t=(rpm-xs[i])/(xs[i+1]-xs[i]); return STOCK[xs[i]]*(1-t)+STOCK[xs[i+1]]*t
RPMS = [2000,3000,4000,5000,6000,7000]
print(f"{'RPM':>5} {'trap_g':>7} {'VE_sim%':>8} {'VE_stk%':>8} {'ratio':>6} {'NaN':>4} {'FIN':>4}")
print("-"*50)
rows=[]
env=dict(os.environ); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]="1"
for rpm in RPMS:
    cfg=SimConfig(); cfg.engine.rpm=float(rpm); cfg.engine.throttle_position=1.0
    cfg.simulation.duration_cycles=CYCLES; cfg.exhaust.port_junction_vol=0.0
    buf=io.StringIO(); old=sys.stdout; sys.stdout=buf
    g=WAMGenerator(cfg,'.'); c=g.generate(ignition_timing=20.0); sys.stdout=old
    wam=f"/tmp/vec_{rpm}.wam"; log=f"/tmp/vec_{rpm}.log"; open(wam,"w").write(c)
    with open(log,"wb") as lf:
        p=subprocess.Popen(["timeout",str(TMO),BIN,wam],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env)
        w,cap=0,3_000_000
        for ch in iter(lambda:p.stdout.read(65536), b""):
            if w<cap: lf.write(ch[:cap-w]); w+=len(ch)
        p.wait()
    t=open(log,encoding='utf-8',errors='ignore').read()
    tms=[float(x) for x in re.findall(r'Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)',t)]
    good=[m for m in tms if 1e-3<m<2.0]
    # converged: median of last 6 IVC samples (one cycle = 6 cyls)
    conv=good[-6:] if len(good)>=6 else good
    mconv=sorted(conv)[len(conv)//2] if conv else float('nan')
    ve=mconv/M_REF*100 if conv else float('nan')
    vk=sve(rpm)*100
    nan=len(re.findall(r'DEBUG BC NaN',t)); fin=1 if 'FINISHED CORRECTLY' in t else 0
    rows.append((rpm,mconv,ve,vk,ve/vk if vk else 0,nan,fin))
    print(f"{rpm:5d} {mconv:7.4f} {ve:8.1f} {vk:8.1f} {ve/vk if vk else 0:6.2f} {nan:4d} {fin:4d}")
open("/tmp/ve_converged.csv","w").write("rpm,trapped_g,ve_sim,ve_stock,ratio,nan,fin\n"+
    "\n".join(f"{r[0]},{r[1]:.5f},{r[2]:.2f},{r[3]:.2f},{r[4]:.3f},{r[5]},{r[6]}" for r in rows))
print("\nCSV: /tmp/ve_converged.csv")

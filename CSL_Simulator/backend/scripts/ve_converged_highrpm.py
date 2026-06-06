#!/usr/bin/env python3
"""Converged (30-cycle) plenum-vs-chain WOT VE at the high-rpm shape breakpoints.
Run SEQUENTIALLY (one at a time, full CPU) so each fully converges -- the batched
under-converged sweep truncated the plenum high-rpm decline. Confirms whether the
plenum recovers its high-rpm plateau (better shape) and whether the chain keeps its
spurious ~6300 ram peak.
"""
import sys, os, io, re, subprocess, math, json
BIN="/home/user/OpenWAM/build/bin/release/OpenWAM"
sys.path.insert(0,"/home/user/OpenWAM/CSL_Simulator/backend")
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator
BORE,STROKE=0.087,0.091
M_REF=math.pi*(BORE/2)**2*STROKE*(101325/(287.05*298.0))*1000
STOCK={d["rpm"]:d["ve"] for d in json.load(open("/home/user/OpenWAM/CSL_Simulator/backend/app/data/stock_csl_ve.json"))}
BP=[5300,6300,7300]; CYCLES=30
def gen(rpm,chain):
    wd=f"/tmp/cv_{'c' if chain else 'p'}_{rpm}"; os.makedirs(wd,exist_ok=True)
    if chain: os.environ["OPENWAM_EQ_CHAIN"]="1"
    elif "OPENWAM_EQ_CHAIN" in os.environ: del os.environ["OPENWAM_EQ_CHAIN"]
    cfg=SimConfig(); cfg.engine.rpm=float(rpm); cfg.engine.throttle_position=1.0
    cfg.simulation.duration_cycles=CYCLES; cfg.exhaust.port_junction_vol=0.0
    buf=io.StringIO(); old=sys.stdout; sys.stdout=buf
    c=WAMGenerator(cfg,wd).generate(ignition_timing=20.0); sys.stdout=old
    open(wd+"/m.wam","w").write(c)
    for f in("intake.vlv","exhaust.vlv"):
        s="/tmp/vediag_5300/"+f
        if os.path.exists(s): open(wd+"/"+f,"wb").write(open(s,"rb").read())
    return wd
def launch(rpm,chain):
    wd=gen(rpm,chain)
    env=os.environ.copy(); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]="1"; env["OPENWAM_VEDIAG"]="1"
    lf=open(wd+"/run.log","wb")
    return subprocess.Popen(["timeout","600",BIN,"m.wam"],cwd=wd,stdout=lf,stderr=subprocess.STDOUT,env=env)
def parse(rpm,chain):
    wd=f"/tmp/cv_{'c' if chain else 'p'}_{rpm}"
    t=open(wd+"/run.log",encoding='utf-8',errors='ignore').read()
    ms=[float(x) for x in re.findall(r'Mtrap:([0-9.]+) g',t)]
    cyc=len(re.findall(r'VEDIAG Cyl:1 ',t))
    if len(ms)<6: return float('nan'),cyc
    seg=ms[-6:]
    if any(x>1.6 or x<1e-3 for x in seg): return float('nan'),cyc
    return sum(seg)/6/M_REF*100,cyc
# 3-parallel (4 cores; leave one for the system)
jobs=[(rpm,ch) for ch in (False,True) for rpm in BP]
res={}; i=0
while i<len(jobs):
    batch=jobs[i:i+3]
    procs=[(rpm,ch,launch(rpm,ch)) for rpm,ch in batch]
    for rpm,ch,p in procs: p.wait()
    i+=3
for rpm,ch in jobs: res[(rpm,ch)]=parse(rpm,ch)
print(f"# CONVERGED {CYCLES}cyc  M_REF={M_REF:.4f}g",flush=True)
print(f"{'RPM':>5}{'stock%':>8}{'plenum%':>9}{'(cyc)':>6}{'chain%':>8}{'(cyc)':>6}",flush=True)
for rpm in BP:
    p,pc=res[(rpm,False)]; c,cc=res[(rpm,True)]; s=STOCK[rpm]*100
    print(f"{rpm:5d}{s:8.1f}{p:9.1f}{pc:6d}{c:8.1f}{cc:6d}",flush=True)


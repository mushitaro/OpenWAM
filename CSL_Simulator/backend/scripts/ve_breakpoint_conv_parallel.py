import sys, os, io, re, subprocess, math, json
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, "/home/user/OpenWAM/CSL_Simulator/backend")
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator
BIN="/home/user/OpenWAM/build/bin/release/OpenWAM"
BORE,STROKE=0.087,0.091
M_REF=math.pi*(BORE/2)**2*STROKE*(101325/(287.05*298.0))*1000
STOCK=[(d["rpm"],d["ve"]) for d in json.load(open("/home/user/OpenWAM/CSL_Simulator/backend/app/data/stock_csl_ve.json"))]
BP=[r for r,_ in STOCK if 1500<=r<=7900]; TGT=dict(STOCK)
CYCLES=10
def run(rpm):
    wd=f"/tmp/cvc_{rpm}"; os.makedirs(wd,exist_ok=True)
    cfg=SimConfig(); cfg.engine.rpm=float(rpm); cfg.engine.throttle_position=1.0
    cfg.simulation.duration_cycles=CYCLES; cfg.exhaust.port_junction_vol=0.0
    buf=io.StringIO(); old=sys.stdout; sys.stdout=buf
    c=WAMGenerator(cfg,wd).generate(ignition_timing=20.0); sys.stdout=old
    wam=os.path.join(wd,"model.wam"); log=f"/tmp/cvc_{rpm}.log"; open(wam,"w").write(c)
    env=dict(os.environ); env["OPENWAM_HLLC"]="1"; env["OMP_NUM_THREADS"]="1"
    with open(log,"wb") as lf:
        p=subprocess.Popen(["timeout","300",BIN,"model.wam"],cwd=wd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env)
        w,cap=0,6_000_000
        for ch in iter(lambda:p.stdout.read(65536),b""):
            if w<cap: lf.write(ch[:cap-w]); w+=len(ch)
        p.wait()
    t=open(log,encoding='utf-8',errors='ignore').read()
    tms=[float(x) for x in re.findall(r'Trapped mass:\s+([0-9.eE+-]+)\s+\(g\)',t)]
    dd=[]
    for v in tms:
        if not dd or abs(dd[-1]-v)>1e-9: dd.append(v)
    nan=len(re.findall(r'DEBUG BC NaN',t)); fin=1 if 'FINISHED CORRECTLY' in t else 0
    good=[m for m in dd if 1e-3<m<1.2]
    if len(good)<6: return (rpm,float('nan'),nan,fin)
    seg=good[-6:]; return (rpm,sum(seg)/len(seg),nan,fin)
if __name__=="__main__":
    with ProcessPoolExecutor(max_workers=3) as ex:
        res=sorted(ex.map(run,BP))
    print(f"# CONV CYCLES={CYCLES} M_REF={M_REF:.4f} g")
    print(f"{'RPM':>5} {'VE_sim%':>8} {'tgt%':>6} {'gap_pp':>7} {'ratio':>6} {'NaN':>4} {'FIN':>3}")
    rows=[]
    for rpm,m,nan,fin in res:
        ve=m/M_REF*100; tgt=TGT[rpm]*100
        print(f"{rpm:5d} {ve:8.1f} {tgt:6.1f} {ve-tgt:7.1f} {ve/tgt:6.2f} {nan:4d} {fin:3d}")
        rows.append((rpm,ve,tgt,nan,fin))
    open("/tmp/bp_conv.csv","w").write("rpm,ve_sim,ve_tgt,nan,fin\n"+"\n".join(f"{r},{v:.2f},{t:.2f},{n},{f}" for r,v,t,n,f in rows))
    # shape correlation (normalized)
    pass
    print("# CSV: /tmp/bp_conv.csv")

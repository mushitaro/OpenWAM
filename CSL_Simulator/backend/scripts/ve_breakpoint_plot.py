import csv, math, statistics
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
rows=[r for r in csv.DictReader(open("/tmp/bp_conv.csv"))]
rpm=[int(r["rpm"]) for r in rows]; sim=[float(r["ve_sim"]) for r in rows]
tgt=[float(r["ve_tgt"]) for r in rows]; fin=[int(r["fin"]) for r in rows]; nan=[int(r["nan"]) for r in rows]
fig,(ax1,ax2)=plt.subplots(2,1,figsize=(9,8),sharex=True)
ax1.plot(rpm,tgt,"o-",color="#1f77b4",lw=2,label="stock CSL target VE")
# mark unreliable points (FIN=0 or NaN>0)
good=[i for i in range(len(rpm)) if nan[i]==0]
bad=[i for i in range(len(rpm)) if nan[i]!=0]
ax1.plot([rpm[i] for i in good],[sim[i] for i in good],"s-",color="#d62728",lw=2,label="sim converged VE (clean)")
if bad: ax1.plot([rpm[i] for i in bad],[sim[i] for i in bad],"x",color="gray",ms=9,label="sim (NaN events - unreliable)")
ax1.set_ylabel("VE  [%]"); ax1.grid(alpha=.3); ax1.legend(); ax1.set_title("Converged VE vs RPM at the real kf_rf_soll breakpoints")
ax1.set_ylim(0,130)
# normalized shape (each / its own mean) to compare TUNING shape independent of magnitude
sm=statistics.mean([sim[i] for i in good]); tm=statistics.mean(tgt)
ax2.plot(rpm,[t/tm for t in tgt],"o-",color="#1f77b4",lw=2,label="target (normalized)")
ax2.plot([rpm[i] for i in good],[sim[i]/sm for i in good],"s-",color="#d62728",lw=2,label="sim (normalized)")
ax2.axhline(1.0,color="k",lw=.7,ls=":")
ax2.set_ylabel("VE / mean(VE)"); ax2.set_xlabel("Engine speed  [rpm]"); ax2.grid(alpha=.3); ax2.legend()
ax2.set_title("Normalized SHAPE: does the sim reproduce the tuning peaks?")
plt.tight_layout(); plt.savefig("/tmp/bp_conv.png",dpi=110)
# stats on clean points
s=[sim[i] for i in good]; t=[tgt[i] for i in good]
def pear(a,b):
    ma,mb=statistics.mean(a),statistics.mean(b)
    num=sum((x-ma)*(y-mb) for x,y in zip(a,b)); den=math.sqrt(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))
    return num/den if den else float("nan")
print(f"clean points: {len(good)}/{len(rpm)}")
print(f"sim VE mean={statistics.mean(s):.1f}% range={min(s):.1f}-{max(s):.1f}% CV={statistics.pstdev(s)/statistics.mean(s)*100:.0f}%")
print(f"tgt VE mean={statistics.mean(t):.1f}% range={min(t):.1f}-{max(t):.1f}% CV={statistics.pstdev(t)/statistics.mean(t)*100:.0f}%")
print(f"shape Pearson r = {pear(s,t):+.2f}   mean ratio sim/tgt = {statistics.mean([x/y for x,y in zip(s,t)]):.2f}")
print("saved /tmp/bp_conv.png")

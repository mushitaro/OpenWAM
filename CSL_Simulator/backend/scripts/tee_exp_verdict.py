#!/usr/bin/env python3
"""Stage 117 verdict: which T12 closure exponent conserves mass at the tee.

tee.wam's added subnetwork: pipe 94 (105->106), 95 (106->107), 96 (106->108).
The tee is node 106; members p94:R, p95:L, p96:L. Exact half-cell bookkeeping:
J_L = dFL + dM_L, J_R = dM_R - dFR; a storage-free junction must sum to 0.
rel = |sum J| / sum |J| over a late window.
"""
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
AUD = re.compile(r"^MASSAUDIT pipe=(\d+) t=([-\d.eE+]+) nin=(\d+) M=([-\d.eE+]+) "
                 r"dM_L=([-\d.eE+]+) dM_R=([-\d.eE+]+) "
                 r"FL=([-\d.eE+]+) FR=([-\d.eE+]+) FM=([-\d.eE+]+)")
def verdict(log):
    rows = {}
    nan = 0
    for line in open(log, encoding="utf-8", errors="replace"):
        if not line.startswith("MASSAUDIT"):
            continue
        if "nan" in line:
            nan += 1; continue
        m = AUD.match(line)
        if not m: continue
        rows.setdefault(int(m.group(1)), []).append(
            tuple(float(m.group(i)) for i in range(2, 10)))
    need = [94, 95, 96]
    if any(p not in rows for p in need):
        return f"pipes missing (nan={nan})"
    n = min(len(rows[p]) for p in need)
    if n < 6:
        return f"only {n} reports (nan={nan})"
    i0, i1 = max(0, n - 6), n - 1
    dt = rows[94][i1][0] - rows[94][i0][0]
    def J(p, side):
        g = lambda k: rows[p][i1][k] - rows[p][i0][k]
        return (g(4) + g(2)) if side == "L" else (g(3) - g(5))
    js = [J(94, "R"), J(95, "L"), J(96, "L")]
    s, a = sum(js), sum(abs(x) for x in js)
    return (f"tee imbalance rel = {abs(s)/a*100 if a else 0:6.3f}%   "
            f"(|sum| {abs(s)/dt:.3e} / thru {a/dt:.3e} per s, "
            f"window {dt:.3f}s, nan={nan})")
for lab, log in (("legacy exp=2", "r_expleg/run.log"),
                 ("exp=0      ", "r_exp0/run.log"),
                 ("exp=5      ", "r_exp5/run.log")):
    try: print(f"  {lab}: {verdict(log)}")
    except Exception as e: print(f"  {lab}: ERROR {e}")

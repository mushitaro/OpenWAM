# Stage 73 box-mode ROM ladder driver (moved from the session scratchpad).
#!/usr/bin/env python3
"""Run a ladder of box-mode configs via boxdiag.py (concurrent subprocesses).

Usage: python boxladder.py <rpm> "<gain,freq,zeta,vgate,cap,tag> ..." [conc]
Each spec: gain,freq,zeta,vgate,cap,tag  (vgate/cap may be empty strings)
"""
import os, subprocess, sys, threading, queue

HERE = os.path.dirname(os.path.abspath(__file__))
BOXDIAG = os.path.join(HERE, "box_rom_probe.py")
EXE = r"C:\Users\kazuh\OpenWAM\build_rom\bin\release\OpenWAM.exe"

rpm = sys.argv[1]
specs = [s.split(",") for s in sys.argv[2].split() if s.strip()]
conc = int(sys.argv[3]) if len(sys.argv) > 3 else 3

q = queue.Queue()
for s in specs:
    q.put(s)
results = {}
lock = threading.Lock()

def worker():
    while True:
        try:
            gain, freq, zeta, vgate, cap, tag = q.get_nowait()
        except queue.Empty:
            return
        env = dict(os.environ, OPENWAM_EXE=EXE)
        args = [sys.executable, BOXDIAG, rpm, gain, freq, zeta, tag, vgate, cap]
        p = subprocess.run(args, capture_output=True, text=True, env=env,
                           timeout=2400)
        tailed = "\n".join(p.stdout.splitlines()[-60:])
        with lock:
            results[tag] = tailed
            print(f"### DONE {tag} (rc={p.returncode})", flush=True)

threads = [threading.Thread(target=worker) for _ in range(conc)]
for t in threads: t.start()
for t in threads: t.join()
for tag in sorted(results):
    print(f"\n===== {tag} =====")
    print(results[tag])

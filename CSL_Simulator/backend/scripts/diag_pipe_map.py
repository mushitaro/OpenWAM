"""Diagnostic: Map pipe IDs to physical names"""
import sys, os
sys.path.insert(0, '.')
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

cfg = SimConfig()
cfg.engine.rpm = 2200.0
cfg.engine.throttle_position = 0.01

# Monkey-patch _add_pipe to log
original_add_pipe = WAMGenerator._add_pipe
pipe_log = []

def logged_add_pipe(self, pid, label, length, d_in, d_out, wall_temp, 
                    cid_left, cid_right, friction=None, dx_mesh=None):
    pipe_log.append((pid, label, length, d_in, d_out, dx_mesh or 0.05))
    original_add_pipe(self, pid, label, length, d_in, d_out, wall_temp,
                     cid_left, cid_right, friction=friction, dx_mesh=dx_mesh)

WAMGenerator._add_pipe = logged_add_pipe
gen = WAMGenerator(cfg, '.')
content = gen.generate(ignition_timing=25.0)

print(f"\n=== Pipe ID Map ===")
print(f"{'ID':>4} {'Label':<30} {'L(mm)':>8} {'D_in(mm)':>10} {'D_out(mm)':>10} {'dx(mm)':>8} {'Cells':>6}")
print("-" * 85)
for pid, label, length, d_in, d_out, dx in sorted(pipe_log, key=lambda x: x[0]):
    cells = max(3, int(round(length / dx)))
    marker = " <<< CRASH" if pid in (9, 43) else ""
    print(f"{pid:4d} {label:<30} {length*1000:8.1f} {d_in*1000:10.1f} {d_out*1000:10.1f} {dx*1000:8.1f} {cells:6d}{marker}")
print(f"\nTotal pipes: {len(pipe_log)}")

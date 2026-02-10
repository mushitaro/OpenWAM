"""
Comprehensive OpenWAM S54 CSL Model Audit
==========================================
Extracts every pipe, plenum, connection, and valve with full parameters
for topology visualization and engineering review.
"""
import sys, os, io, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator

# ---------- Monkey-patch to capture ALL data ----------
plenum_data = {}   # {id: {label, vol_physical, vol_clamped, temp, type}}
pipe_data = {}     # {id: {label, length, dia_l, dia_r, temp, cid_l, cid_r, friction, dx_mesh}}

original_add_plenum = WAMGenerator._add_plenum
def patched_add_plenum(self, plid, label, vol, wall_temp, ptype=0):
    vol_clamped = max(vol, 0.00005)  # matches the clamp in the actual code
    plenum_data[plid] = {
        'label': label,
        'vol_physical_cc': vol * 1e6,
        'vol_clamped_cc': vol_clamped * 1e6,
        'temp_K': wall_temp,
        'type': ptype,
        'is_clamped': vol < 0.00005
    }
    return original_add_plenum(self, plid, label, vol, wall_temp, ptype)
WAMGenerator._add_plenum = patched_add_plenum

original_add_pipe = WAMGenerator._add_pipe
def patched_add_pipe(self, pid, label, length, dia_left, dia_right, temp, cid_left, cid_right, friction=0.02, dx_mesh=0.030):
    pipe_data[pid] = {
        'label': label,
        'length_mm': length * 1000,
        'dia_left_mm': dia_left * 1000,
        'dia_right_mm': dia_right * 1000,
        'temp_K': temp,
        'cid_left': cid_left,
        'cid_right': cid_right,
        'friction': friction,
        'dx_mesh_mm': dx_mesh * 1000,
        'nodes': int(length / dx_mesh) + 1
    }
    return original_add_pipe(self, pid, label, length, dia_left, dia_right, temp, cid_left, cid_right, friction=friction, dx_mesh=dx_mesh)
WAMGenerator._add_pipe = patched_add_pipe

# ---------- Generate ----------
config = SimConfig(rpm=2200, ro_percent=0.39)
gen = WAMGenerator(config, output_dir="output")
old = sys.stdout; sys.stdout = io.StringIO()
content = gen.generate()
sys.stdout = old

# ---------- Connection analysis ----------
connection_data = {}
for cid, (ctype, cdata) in gen.connections.items():
    # Find pipes connected to this CID
    connected_pipes = []
    for pid, p in pipe_data.items():
        if p['cid_left'] == cid:
            connected_pipes.append((pid+1, p['label'], 'left'))
        if p['cid_right'] == cid:
            connected_pipes.append((pid+1, p['label'], 'right'))
    connection_data[cid] = {
        'type': ctype,
        'pipes': connected_pipes
    }

# ---------- Output ----------
output = {
    'summary': {
        'total_pipes': len(pipe_data),
        'total_plenums': len(plenum_data),
        'total_connections': len(gen.connections),
        'type_12_count': sum(1 for cid, (ct, cd) in gen.connections.items() if ct == 12),
        'type_6_count': sum(1 for cid, (ct, cd) in gen.connections.items() if ct == 6),
        'type_11_count': sum(1 for cid, (ct, cd) in gen.connections.items() if ct == 11),
    },
    'pipes': {str(pid+1): p for pid, p in sorted(pipe_data.items())},
    'plenums': {str(plid): p for plid, p in sorted(plenum_data.items())},
    'type_12_junctions': {},
    'type_6_junctions': {},
}

for cid, cinfo in connection_data.items():
    if cinfo['type'] == 12:
        output['type_12_junctions'][str(cid)] = cinfo
    elif cinfo['type'] == 6:
        output['type_6_junctions'][str(cid)] = cinfo

with open('scripts/model_audit.json', 'w') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)
print("Written to scripts/model_audit.json")

# ---------- Console Summary ----------
print(f"\n{'='*80}")
print(f"S54 CSL OpenWAM Model Audit")
print(f"{'='*80}")
print(f"Pipes: {output['summary']['total_pipes']}")
print(f"Plenums: {output['summary']['total_plenums']}")
print(f"Connections: {output['summary']['total_connections']}")
print(f"  Type 6 (Pipe-to-Pipe): {output['summary']['type_6_count']}")
print(f"  Type 11 (Pipe-Plenum): {output['summary']['type_11_count']}")
print(f"  Type 12 (Branch Junction): {output['summary']['type_12_count']}")

print(f"\n{'='*80}")
print(f"PIPE TOPOLOGY")
print(f"{'='*80}")
print(f"{'ID':>4s} {'Label':<30s} {'L(mm)':>7s} {'DL(mm)':>7s} {'DR(mm)':>7s} {'T(K)':>5s} {'f':>5s} {'dx':>5s} {'Nodes':>5s} {'CID_L':>5s} {'CID_R':>5s}")
print("-" * 120)
for pid_str in sorted(output['pipes'].keys(), key=lambda x: int(x)):
    p = output['pipes'][pid_str]
    print(f"{pid_str:>4s} {p['label']:<30s} {p['length_mm']:7.1f} {p['dia_left_mm']:7.1f} {p['dia_right_mm']:7.1f} {p['temp_K']:5.0f} {p['friction']:5.3f} {p['dx_mesh_mm']:5.1f} {p['nodes']:5d} {p['cid_left']:5d} {p['cid_right']:5d}")

print(f"\n{'='*80}")
print(f"PLENUM TOPOLOGY")
print(f"{'='*80}")
print(f"{'ID':>4s} {'Label':<30s} {'Vol_phys(cc)':>12s} {'Vol_clamp(cc)':>13s} {'Clamped?':>8s} {'T(K)':>5s}")
print("-" * 80)
for plid_str in sorted(output['plenums'].keys(), key=lambda x: int(x)):
    p = output['plenums'][plid_str]
    clamp = "YES" if p['is_clamped'] else "no"
    print(f"{plid_str:>4s} {p['label']:<30s} {p['vol_physical_cc']:12.4f} {p['vol_clamped_cc']:13.4f} {clamp:>8s} {p['temp_K']:5.0f}")

print(f"\n{'='*80}")
print(f"TYPE 12 BRANCH JUNCTIONS")
print(f"{'='*80}")
for cid_str, cinfo in sorted(output['type_12_junctions'].items(), key=lambda x: int(x[0])):
    pipes_str = ", ".join([f"Pipe {pid} ({label}) [{side}]" for pid, label, side in cinfo['pipes']])
    print(f"  CID {cid_str}: {pipes_str}")

print(f"\n{'='*80}")
print(f"TYPE 6 PIPE-TO-PIPE CONNECTIONS")
print(f"{'='*80}")
for cid_str, cinfo in sorted(output['type_6_junctions'].items(), key=lambda x: int(x[0])):
    pipes_str = " <-> ".join([f"Pipe {pid} ({label}) [{side}]" for pid, label, side in cinfo['pipes']])
    print(f"  CID {cid_str}: {pipes_str}")

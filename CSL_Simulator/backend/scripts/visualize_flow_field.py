"""
Flow Field Spatial Visualization — OpenWAM INS Data
Reads the INS.DAT file and creates an HTML visualization showing:
- X-axis: spatial position along Cylinder 1 flow path (intake → cyl → exhaust)
- Y-axis: Pressure, Velocity, Temperature
- Slider: crank angle
"""
import os, re, sys, json
import csv

INS_FILE = sys.argv[1] if len(sys.argv) > 1 else "temp_seq_3_2200_7.5INS.DAT"
OUT_HTML = sys.argv[2] if len(sys.argv) > 2 else "output/flow_field.html"

# Extract RPM/RO from filename for subtitle
import re as _re
_m = _re.search(r'_(\d+)_([\d.]+)INS', INS_FILE)
SUB_RPM = _m.group(1) if _m else '?'
SUB_RO = _m.group(2) if _m else '?'

print(f"Reading {INS_FILE}...")

# --- 1. Define the flow path for Cylinder 1 ---
# Topology: Intake → Panel_Filter → Bellmouth_1 → Runner_1 → Port_In → [CYL1] → Port_Ex → Header_1 → [Type12] → Col_Out_L → ...
# Each element: (type, id, label, length_mm)
# type: 'pipe' or 'cyl' or 'plenum' or 'junction'

FLOW_PATH = [
    # --- INTAKE (Pipe IDs from wam_generator pipe_counter sequence) ---
    ('pipe',  1,  'Intake',        350),   # CSL_Intake_Pipe
    ('pipe',  2,  'Panel_Filter',   20),   # CSL_Panel_Filter
    ('plenum', 2, 'Plenum_Main',     0),   # Intake plenum (10.5L)
    ('pipe',  3,  'Bellmouth_1',   150),   # Bellmouth_1
    ('plenum', 3, 'ITB_Junct_1',     0),   # ITB_Junction_1
    ('pipe',  4,  'Runner_1',       40),   # Runner_1
    ('plenum', 4, 'Split_Pl_1',      0),   # Split_Plenum_1
    ('pipe',  5,  'Port_In_1_1',    73),   # Port_In_Main_1_1
    ('plenum', 5, 'ValvePkt_In',     0),   # ValvePocket_In_1_1
    ('pipe',  6,  'Port_In_Pkt',    32),   # Port_In_Pocket_1_1
    # --- CYLINDER 1 ---
    ('cyl',   1,  'Cylinder_1',     80),   # ~bore diameter as reference
    # --- EXHAUST (Pipe IDs: 39=Pocket_1_1, 40=Main_1_1, 41=Pocket_1_2, 42=Main_1_2, 43=Header_1) ---
    ('plenum', 28,'ValvePkt_Ex',     0),   # ValvePocket_Ex_1_1
    ('pipe',  39, 'Port_Ex_Pkt',    27),   # Port_Ex_Pocket_1_1
    ('pipe',  40, 'Port_Ex_Main',   63),   # Port_Ex_Main_1_1
    ('plenum', 27,'Port_Junct_1',    0),   # Port_Junct_1 (merge 2 exhaust ports)
    ('pipe',  43, 'Header_1',      300),   # Header_1
    # Type 12 branch junction — no plenum volume
    ('pipe',  69, 'Col_Out_L',     500),   # Col_Out_L
    ('pipe',  71, 'Sec1_1_L',      600),   # Sec1_1_L
    ('pipe',  73, 'FrontCat_L',    200),   # FrontCat_L
    ('pipe',  75, 'Sec1_2_L',      400),   # Sec1_2_L
    ('pipe',  77, 'Sec2_1_L',      400),   # Sec2_1_L
]

# --- 2. Read INS file header ---
with open(INS_FILE, 'r') as f:
    header_line = f.readline().strip()
    columns = header_line.split('\t')

col_index = {name: i for i, name in enumerate(columns)}

# Build the list of columns we need for the flow path
# For each pipe: P, V, T at inlet (0m) and outlet (L)
# For each plenum: P, T
# For each cylinder: P, T, Mass

data_points = []  # (x_position_mm, label, col_P, col_V, col_T, col_F, element_type)

x_pos = 0.0

for elem_type, elem_id, label, length_mm in FLOW_PATH:
    if elem_type == 'pipe':
        # Find inlet and outlet column names for this pipe
        p_cols = [c for c in columns if c.startswith(f'P_duct_{elem_id}_at_')]
        if len(p_cols) < 2:
            print(f"  WARNING: Pipe {elem_id} ({label}) only has {len(p_cols)} P columns, skipping")
            x_pos += length_mm
            continue
        
        # Parse positions from column names: P_duct_N_at_XX.XX_m
        positions = []
        for pc in p_cols:
            match = re.search(r'at_([0-9.]+)_m', pc)
            if match:
                positions.append((float(match.group(1)), pc))
        positions.sort(key=lambda x: x[0])
        
        for pos_m, p_col_name in positions:
            prefix = p_col_name.replace('P_', '', 1).replace('(bar)', '')
            v_col = f'V_{prefix}(m/s)'
            t_col = f'T_{prefix}(degC)'
            f_col = f'F_{prefix}(kg/s)'
            
            col_P = col_index.get(p_col_name, -1)
            col_V = col_index.get(v_col, -1)
            col_T = col_index.get(t_col, -1)
            col_F = col_index.get(f_col, -1)
            
            dp_x = x_pos + pos_m * 1000
            data_points.append({
                'x': dp_x,
                'label': f'{label}@{pos_m*1000:.0f}mm',
                'col_P': col_P, 'col_V': col_V, 'col_T': col_T, 'col_F': col_F,
                'type': 'pipe', 'pipe_id': elem_id
            })
        
        x_pos += length_mm
        
    elif elem_type == 'plenum':
        p_col = f'Pressure_plenum_{elem_id}(bar)'
        t_col = f'Temperature_plenum_{elem_id}(degC)'
        col_P = col_index.get(p_col, -1)
        col_T = col_index.get(t_col, -1)
        
        data_points.append({
            'x': x_pos,
            'label': label,
            'col_P': col_P, 'col_V': -1, 'col_T': col_T, 'col_F': -1,
            'type': 'plenum', 'plenum_id': elem_id
        })
        # Plenums have zero length
        
    elif elem_type == 'cyl':
        p_col = f'Pressure_Cyl_{elem_id}(bar)'
        t_col = f'Temperature_Cyl_{elem_id}(degC)'
        m_col = f'Mass_Cyl_{elem_id}(kg)'
        col_P = col_index.get(p_col, -1)
        col_T = col_index.get(t_col, -1)
        col_M = col_index.get(m_col, -1)
        
        data_points.append({
            'x': x_pos + length_mm / 2,
            'label': label,
            'col_P': col_P, 'col_V': -1, 'col_T': col_T, 'col_F': -1,
            'type': 'cyl', 'cyl_id': elem_id, 'col_M': col_M
        })
        x_pos += length_mm

# Validate
valid = sum(1 for dp in data_points if dp['col_P'] >= 0)
print(f"  Flow path: {len(data_points)} data points, {valid} with valid P column")

# --- 3. Read data rows ---
print("  Reading data rows...")
times = []
angles = []
all_data = []  # list of dicts per row

angle_col = col_index['Angle(deg)']
time_col = col_index['Time']

row_count = 0
with open(INS_FILE, 'r') as f:
    f.readline()  # skip header
    for line in f:
        vals = line.strip().split('\t')
        if len(vals) < 10:
            continue
        
        try:
            angle = float(vals[angle_col])
            time_val = float(vals[time_col])
        except (ValueError, IndexError):
            continue
        
        # Extract data for each flow path point
        row_data = []
        for dp in data_points:
            p = float(vals[dp['col_P']]) if dp['col_P'] >= 0 and dp['col_P'] < len(vals) else None
            v = float(vals[dp['col_V']]) if dp['col_V'] >= 0 and dp['col_V'] < len(vals) else None
            t = float(vals[dp['col_T']]) if dp['col_T'] >= 0 and dp['col_T'] < len(vals) else None
            f_val = float(vals[dp['col_F']]) if dp['col_F'] >= 0 and dp['col_F'] < len(vals) else None
            row_data.append({'P': p, 'V': v, 'T': t, 'F': f_val})
        
        times.append(time_val)
        angles.append(angle)
        all_data.append(row_data)
        row_count += 1

print(f"  Read {row_count} time steps, angle range: {min(angles):.1f}° - {max(angles):.1f}°")

# --- 4. Sample every Nth row to keep HTML manageable ---
# Take last 2 complete cycles (720° each)
# Find the last full cycle boundary
max_angle = max(angles)
# Sample: take every 10th row from last 2 cycles
start_angle = max_angle - 720
sampled_indices = []
for i, a in enumerate(angles):
    if a >= start_angle and i % 5 == 0:
        sampled_indices.append(i)

print(f"  Sampled {len(sampled_indices)} steps from last cycle (angle >= {start_angle:.0f}°)")

# --- 5. Build JSON for HTML ---
x_positions = [dp['x'] for dp in data_points]
labels = [dp['label'] for dp in data_points]
types = [dp['type'] for dp in data_points]

frames = []
for idx in sampled_indices:
    frame = {
        'angle': round(angles[idx], 1),
        'time': round(times[idx], 6),
        'P': [all_data[idx][j]['P'] for j in range(len(data_points))],
        'V': [all_data[idx][j]['V'] for j in range(len(data_points))],
        'T': [all_data[idx][j]['T'] for j in range(len(data_points))],
        'F': [all_data[idx][j]['F'] for j in range(len(data_points))],
    }
    frames.append(frame)

chart_data = {
    'x': x_positions,
    'labels': labels,
    'types': types,
    'frames': frames,
    'pipe_map': [(etype, eid, label, length) for etype, eid, label, length in FLOW_PATH if etype == 'pipe'],
}

# --- 5b. Load VE validation results CSV if available ---
ve_csv_path = os.path.join('output', 've_validation_results_seq.csv')
ve_rows_html = ''
ve_stats_html = ''
if os.path.exists(ve_csv_path):
    with open(ve_csv_path, 'r') as csvf:
        reader = csv.DictReader(csvf)
        ve_data = list(reader)
    total = len(ve_data)
    passed = sum(1 for r in ve_data if r['exit_code'] == '0' or float(r.get('mass_mg','0')) > 0)
    diffs = [abs(float(r['diff'])) for r in ve_data if r['diff']]
    mae = sum(diffs) / len(diffs) if diffs else 0
    ve_stats_html = f'<div class="ve-stats">{passed}/{total} Passed | MAE: {mae:.1f}%</div>'
    for r in ve_data:
        rpm_v, ro_v = r['rpm'], r['ro']
        ec = r['exit_code']
        mass = r.get('mass_mg', '')
        vs = r.get('ve_sim', '')
        vo = r.get('ve_oem', '')
        d = float(r['diff']) if r['diff'] else 0
        # Color-code diff: green if |d|<10, yellow if <25, red otherwise
        if abs(d) < 10:
            dcls = 'good'
        elif abs(d) < 25:
            dcls = 'mid'
        else:
            dcls = 'bad'
        # Highlight current operating point
        is_current = (rpm_v == SUB_RPM and ro_v == SUB_RO)
        row_cls = ' class="current"' if is_current else ''
        status = '✅' if ec == '0' else '⚠️'
        ve_rows_html += f'<tr{row_cls}><td>{rpm_v}</td><td>{ro_v}</td><td>{status}</td>'
        ve_rows_html += f'<td>{mass}</td><td>{vs}%</td><td>{vo}%</td>'
        ve_rows_html += f'<td class="{dcls}">{d:+.1f}%</td></tr>\n'
    print(f"  VE CSV loaded: {total} points, MAE={mae:.1f}%")
else:
    print(f"  VE CSV not found at {ve_csv_path}, skipping results panel")

# --- 6. Generate HTML ---
html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>OpenWAM Flow Field — Cylinder 1 Path</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ background: #0a0a1a; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; padding: 20px; }}
h1 {{ text-align: center; color: #4fc3f7; margin-bottom: 5px; font-size: 1.5rem; }}
.subtitle {{ text-align: center; color: #888; margin-bottom: 15px; font-size: 0.9rem; }}
.controls {{ display: flex; align-items: center; justify-content: center; gap: 20px; margin: 10px 0; }}
.controls label {{ color: #aaa; font-size: 0.85rem; }}
.controls input[type=range] {{ width: 500px; accent-color: #4fc3f7; }}
.angle-display {{ font-size: 1.8rem; font-weight: bold; color: #ff9800; min-width: 120px; text-align: center; }}
.charts {{ display: flex; flex-direction: column; gap: 8px; }}
canvas {{ background: #111122; border: 1px solid #333; border-radius: 6px; }}
.legend {{ display: flex; gap: 15px; justify-content: center; margin: 5px 0; font-size: 0.75rem; color: #aaa; }}
.legend span {{ display: flex; align-items: center; gap: 4px; }}
.legend .dot {{ width: 10px; height: 10px; border-radius: 50%; display: inline-block; }}
.info {{ display: flex; gap: 20px; justify-content: center; margin-top: 10px; font-size: 0.8rem; color: #666; }}
.btn {{ background: #1a1a2e; border: 1px solid #4fc3f7; color: #4fc3f7; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }}
.btn:hover {{ background: #4fc3f7; color: #000; }}
.btn.active {{ background: #4fc3f7; color: #000; }}
.tooltip {{ position: fixed; background: #1a1a2eee; border: 1px solid #4fc3f7; border-radius: 6px; padding: 10px 14px; font-size: 0.85rem; color: #e0e0e0; pointer-events: none; display: none; z-index: 100; min-width: 220px; line-height: 1.6; }}
.tooltip .name {{ color: #4fc3f7; font-weight: bold; font-size: 1rem; }}
.tooltip .type-badge {{ display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.7rem; margin-left: 6px; }}
.tooltip .val {{ color: #fff; font-family: monospace; }}
.ve-panel {{ margin: 20px auto; max-width: 800px; background: #111122; border: 1px solid #333; border-radius: 8px; padding: 15px 20px; }}
.ve-panel h2 {{ color: #4fc3f7; font-size: 1.1rem; margin-bottom: 8px; text-align: center; }}
.ve-stats {{ text-align: center; color: #66bb6a; font-size: 0.95rem; font-weight: bold; margin-bottom: 10px; }}
.ve-table {{ width: 100%; border-collapse: collapse; font-size: 0.8rem; font-family: 'Consolas', monospace; }}
.ve-table th {{ background: #1a1a2e; color: #4fc3f7; padding: 6px 8px; border-bottom: 2px solid #4fc3f7; text-align: right; }}
.ve-table td {{ padding: 5px 8px; border-bottom: 1px solid #222; text-align: right; }}
.ve-table tr:hover {{ background: #1a1a3e; }}
.ve-table tr.current {{ background: #4fc3f720; border-left: 3px solid #4fc3f7; }}
.ve-table .good {{ color: #66bb6a; font-weight: bold; }}
.ve-table .mid {{ color: #ffa726; }}
.ve-table .bad {{ color: #ef5350; }}
</style>
</head>
<body>
<h1>🏎️ OpenWAM Flow Field — Cylinder 1 Path</h1>
<div class="subtitle">Intake → Cylinder → Exhaust | {SUB_RPM} RPM @ RO={SUB_RO}% | 50cc Plenum Fix Applied</div>

<div class="ve-panel">
<h2>📊 VE Validation Sweep — 17 Points (50cc Plenum Fix)</h2>
{ve_stats_html}
<table class="ve-table">
<tr><th>RPM</th><th>RO%</th><th>Status</th><th>Mass(mg)</th><th>VE_sim</th><th>VE_oem</th><th>Δ</th></tr>
{ve_rows_html}
</table>
</div>

<div class="controls">
    <button class="btn" id="playBtn" onclick="togglePlay()">▶ Play</button>
    <label>Crank Angle:</label>
    <input type="range" id="slider" min="0" max="100" value="0" oninput="updateFrame(this.value)">
    <div class="angle-display" id="angleDisplay">0°</div>
</div>

<div class="legend">
    <span><span class="dot" style="background:#4fc3f7"></span> Pipe</span>
    <span><span class="dot" style="background:#ff9800"></span> Plenum</span>
    <span><span class="dot" style="background:#f44336"></span> Cylinder</span>
</div>

<div class="charts">
    <canvas id="pressureChart" width="1400" height="220"></canvas>
    <canvas id="velocityChart" width="1400" height="180"></canvas>
    <canvas id="tempChart" width="1400" height="180"></canvas>
    <canvas id="massFlowChart" width="1400" height="180"></canvas>
</div>

<div class="info" id="info"></div>
<div class="tooltip" id="tooltip"></div>

<script>
const DATA = {json.dumps(chart_data)};
const slider = document.getElementById('slider');
slider.max = DATA.frames.length - 1;

let playing = false;
let playInterval = null;

function togglePlay() {{
    playing = !playing;
    const btn = document.getElementById('playBtn');
    if (playing) {{
        btn.textContent = '⏸ Pause';
        btn.classList.add('active');
        playInterval = setInterval(() => {{
            let v = parseInt(slider.value) + 1;
            if (v >= DATA.frames.length) v = 0;
            slider.value = v;
            updateFrame(v);
        }}, 50);
    }} else {{
        btn.textContent = '▶ Play';
        btn.classList.remove('active');
        clearInterval(playInterval);
    }}
}}

// Store point positions for hover hit-testing
let pointPositions = [];

function drawChart(canvasId, values, ylabel, ymin, ymax, color) {{
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const margin = {{ left: 70, right: 20, top: 25, bottom: 40 }};
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    
    ctx.clearRect(0, 0, W, H);
    
    // Grid + zero line
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {{
        let y = margin.top + plotH * i / 5;
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(W - margin.right, y); ctx.stroke();
    }}
    if (ymin < 0 && ymax > 0) {{
        let zeroY = margin.top + (1 - (0 - ymin) / (ymax - ymin)) * plotH;
        ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(margin.left, zeroY); ctx.lineTo(W - margin.right, zeroY); ctx.stroke();
    }}
    
    // Y-axis labels
    ctx.fillStyle = '#888'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {{
        let y = margin.top + plotH * i / 5;
        let val = ymax - (ymax - ymin) * i / 5;
        ctx.fillText(val.toFixed(2), margin.left - 5, y + 4);
    }}
    ctx.save(); ctx.translate(15, margin.top + plotH/2); ctx.rotate(-Math.PI/2);
    ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(ylabel, 0, 0); ctx.restore();
    
    let xMin = Math.min(...DATA.x), xMax = Math.max(...DATA.x);
    const typeColors = {{ pipe: '#4fc3f7', plenum: '#ff9800', cyl: '#f44336' }};
    const typeBg = {{ pipe: '#4fc3f720', plenum: '#ff980020', cyl: '#f4433620' }};
    
    // Draw region backgrounds for each pipe/element
    let prevType = null, regionStart = 0;
    for (let i = 0; i <= DATA.x.length; i++) {{
        let curType = i < DATA.x.length ? DATA.types[i] : null;
        if (curType !== prevType && prevType === 'pipe') {{
            let x1 = margin.left + (DATA.x[regionStart] - xMin) / (xMax - xMin) * plotW;
            let x2 = margin.left + (DATA.x[i-1] - xMin) / (xMax - xMin) * plotW;
            ctx.fillStyle = '#4fc3f708';
            ctx.fillRect(x1, margin.top, x2-x1, plotH);
        }}
        if (curType !== prevType) {{ regionStart = i; prevType = curType; }}
    }}
    
    // Connecting line
    ctx.strokeStyle = color + '80'; ctx.lineWidth = 1.5; ctx.beginPath();
    let first = true;
    for (let i = 0; i < DATA.x.length; i++) {{
        if (values[i] === null) {{ first = true; continue; }}
        let px = margin.left + (DATA.x[i] - xMin) / (xMax - xMin) * plotW;
        let py = margin.top + (1 - (values[i] - ymin) / (ymax - ymin)) * plotH;
        py = Math.max(margin.top, Math.min(margin.top + plotH, py));
        if (first) {{ ctx.moveTo(px, py); first = false; }} else ctx.lineTo(px, py);
    }}
    ctx.stroke();
    
    // Points + store positions
    for (let i = 0; i < DATA.x.length; i++) {{
        if (values[i] === null) continue;
        let px = margin.left + (DATA.x[i] - xMin) / (xMax - xMin) * plotW;
        let py = margin.top + (1 - (values[i] - ymin) / (ymax - ymin)) * plotH;
        py = Math.max(margin.top, Math.min(margin.top + plotH, py));
        
        ctx.fillStyle = typeColors[DATA.types[i]] || color;
        let r = DATA.types[i] === 'cyl' ? 6 : (DATA.types[i] === 'plenum' ? 5 : 3.5);
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        
        pointPositions.push({{ canvasId, idx: i, px, py }});
    }}
    
    // X-axis labels — all points, rotated
    ctx.fillStyle = '#777'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    for (let i = 0; i < DATA.x.length; i++) {{
        let px = margin.left + (DATA.x[i] - xMin) / (xMax - xMin) * plotW;
        ctx.save(); ctx.translate(px, H - 2); ctx.rotate(-Math.PI/3);
        ctx.fillStyle = typeColors[DATA.types[i]] || '#666';
        ctx.fillText(DATA.labels[i], 0, 0);
        ctx.restore();
    }}
    
    // Cylinder vertical line
    for (let i = 0; i < DATA.types.length; i++) {{
        if (DATA.types[i] === 'cyl') {{
            let px = margin.left + (DATA.x[i] - xMin) / (xMax - xMin) * plotW;
            ctx.strokeStyle = '#f4433650'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(px, margin.top); ctx.lineTo(px, margin.top + plotH); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = '#f44336'; ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center'; ctx.fillText('CYL 1', px, margin.top - 5);
        }}
    }}
}}

let currentFrameIdx = 0;
function updateFrame(idx) {{
    currentFrameIdx = idx;
    const frame = DATA.frames[idx];
    document.getElementById('angleDisplay').textContent = frame.angle + '°';
    
    pointPositions = [];
    
    let pVals = frame.P.filter(v => v !== null);
    let pMin = Math.min(...pVals) * 0.95, pMax = Math.max(...pVals) * 1.05;
    pMin = Math.max(0, Math.min(pMin, 0.8)); pMax = Math.max(pMax, 1.5);
    
    drawChart('pressureChart', frame.P, 'Pressure (bar)', pMin, pMax, '#4fc3f7');
    drawChart('velocityChart', frame.V, 'Velocity (m/s)', -200, 300, '#66bb6a');
    drawChart('tempChart',     frame.T, 'Temp (°C)',       -50, 900, '#ff7043');
    
    let fVals = frame.F.filter(v => v !== null);
    let fMin = fVals.length ? Math.min(...fVals) * 1.1 : -0.1;
    let fMax = fVals.length ? Math.max(...fVals) * 1.1 : 0.1;
    fMin = Math.min(fMin, -0.05); fMax = Math.max(fMax, 0.05);
    drawChart('massFlowChart', frame.F, 'Mass Flow (kg/s)', fMin, fMax, '#ab47bc');
    
    document.getElementById('info').textContent = 
        'Time: ' + frame.time.toFixed(6) + 's | Angle: ' + frame.angle + '° | Frame: ' + idx + '/' + DATA.frames.length;
}}

// Tooltip on hover
const tooltip = document.getElementById('tooltip');
const typeBadgeColors = {{ pipe: '#4fc3f7', plenum: '#ff9800', cyl: '#f44336' }};

document.querySelector('.charts').addEventListener('mousemove', (e) => {{
    const rect = e.target.getBoundingClientRect();
    if (!rect || e.target.tagName !== 'CANVAS') {{ tooltip.style.display = 'none'; return; }}
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const canvasId = e.target.id;
    
    let closest = null, minDist = 30;
    for (const pt of pointPositions) {{
        if (pt.canvasId !== canvasId) continue;
        let d = Math.sqrt((pt.px - mx) ** 2 + (pt.py - my) ** 2);
        if (d < minDist) {{ minDist = d; closest = pt; }}
    }}
    
    if (closest) {{
        const i = closest.idx;
        const frame = DATA.frames[currentFrameIdx];
        const tc = typeBadgeColors[DATA.types[i]] || '#888';
        tooltip.innerHTML = `
            <div class="name">${{DATA.labels[i]}} <span class="type-badge" style="background:${{tc}}40;color:${{tc}}">${{DATA.types[i]}}</span></div>
            <div>P: <span class="val">${{frame.P[i] !== null ? frame.P[i].toFixed(4) + ' bar' : 'N/A'}}</span></div>
            <div>V: <span class="val">${{frame.V[i] !== null ? frame.V[i].toFixed(2) + ' m/s' : 'N/A'}}</span></div>
            <div>T: <span class="val">${{frame.T[i] !== null ? frame.T[i].toFixed(1) + ' °C' : 'N/A'}}</span></div>
            <div>F: <span class="val">${{frame.F[i] !== null ? frame.F[i].toFixed(5) + ' kg/s' : 'N/A'}}</span></div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
    }} else {{
        tooltip.style.display = 'none';
    }}
}});

document.querySelector('.charts').addEventListener('mouseleave', () => {{
    tooltip.style.display = 'none';
}});
</script>
</body>
</html>"""

os.makedirs('output', exist_ok=True)
with open(OUT_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

print(f"\n✅ Written to {OUT_HTML}")
print(f"   Open in browser to view interactive flow field visualization")

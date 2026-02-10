"""
Generate comprehensive model topology visualization as HTML.
Reads model_audit.json and produces an interactive SVG diagram + tables.
"""
import json, os

with open(os.path.join(os.path.dirname(__file__), 'model_audit.json')) as f:
    data = json.load(f)

pipes = data['pipes']
plenums = data['plenums']

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>S54 CSL — OpenWAM Model Topology Audit</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
h1 { color: #58a6ff; font-size: 24px; margin-bottom: 8px; }
h2 { color: #79c0ff; font-size: 18px; margin: 24px 0 12px; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
h3 { color: #d2a8ff; font-size: 15px; margin: 16px 0 8px; }
.subtitle { color: #8b949e; font-size: 13px; margin-bottom: 20px; }

.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 16px 0; }
.summary-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
.summary-card .value { font-size: 28px; font-weight: 700; color: #58a6ff; }
.summary-card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }

.warn { background: #2d1b00; border-color: #9e6a03; }
.warn .value { color: #e3b341; }
.error { background: #3d0000; border-color: #f85149; }
.error .value { color: #f85149; }

table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
th { background: #161b22; color: #58a6ff; padding: 8px 6px; text-align: left; border-bottom: 2px solid #30363d; position: sticky; top: 0; }
td { padding: 6px; border-bottom: 1px solid #21262d; }
tr:hover { background: #161b22; }
.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; }
.clamped { background: #3d1f00; color: #e3b341; }
.ok { color: #3fb950; }
.bad { color: #f85149; font-weight: 600; }

.issue-card { background: #161b22; border-left: 4px solid #f85149; padding: 12px 16px; margin: 8px 0; border-radius: 0 6px 6px 0; }
.issue-card.warn { border-left-color: #e3b341; }
.issue-card .tag { font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
.issue-card .tag.critical { color: #f85149; }
.issue-card .tag.warning { color: #e3b341; }
.issue-card p { font-size: 13px; line-height: 1.5; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 1200px) { .two-col { grid-template-columns: 1fr; } }

.topology-section { margin: 16px 0; padding: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
.flow-line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin: 6px 0; font-size: 11px; }
.fl-pipe { background: #1f3a5f; color: #79c0ff; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
.fl-plenum { background: #3d2a00; color: #e3b341; padding: 3px 8px; border-radius: 12px; white-space: nowrap; }
.fl-junction { background: #1a3d1f; color: #3fb950; padding: 3px 8px; border-radius: 4px; white-space: nowrap; border: 1px solid #3fb950; }
.fl-valve { background: #3d0020; color: #f778ba; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
.fl-arrow { color: #484f58; }
.fl-ambient { background: #0d4429; color: #56d364; padding: 3px 8px; border-radius: 12px; font-weight: 600; }

.section-label { font-size: 11px; color: #8b949e; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>

<h1>🏎️ S54 CSL — OpenWAM Model Topology Audit</h1>
<p class="subtitle">BMW S54B32 | 3246cc I6 DOHC | Individual Throttle Bodies | Dual-Exit Exhaust</p>

<!-- Summary Cards -->
<div class="summary-grid">
  <div class="summary-card"><div class="value">87</div><div class="label">Pipes</div></div>
  <div class="summary-card"><div class="value">48</div><div class="label">Plenums</div></div>
  <div class="summary-card"><div class="value">155</div><div class="label">Connections</div></div>
  <div class="summary-card"><div class="value">2</div><div class="label">Type 12<br>Branch Junctions</div></div>
  <div class="summary-card"><div class="value">13</div><div class="label">Type 6<br>Pipe-to-Pipe</div></div>
  <div class="summary-card warn"><div class="value">44/48</div><div class="label">Plenums<br>Volume-Clamped</div></div>
  <div class="summary-card error"><div class="value">50→50cc</div><div class="label">Clamp Override<br>(1-5cc physical)</div></div>
</div>

<!-- Workflow Section -->
<h2>📋 Simulation Workflow (正しいデータフロー)</h2>
<div class="topology-section">
<pre style="font-size: 12px; color: #c9d1d9; line-height: 1.6;">
<span style="color:#58a6ff">1. WAM Generation</span>
   models.py (SimConfig) → wam_generator.py → <b>xxx.wam</b> (入力ファイル)
   ・RPM, RO%, 全パラメータから87パイプ+48プレナムのトポロジーを構築
   ・⚠️ バルブタイミングmapping、摩擦係数、プレナム容量クランプに注意

<span style="color:#58a6ff">2. Simulation Execution</span>
   OpenWAM.exe xxx.wam → <b>xxxINS.DAT</b> (結果ファイル)
   ・Exit code 0 = 成功、それ以外 = クラッシュ
   ・⚠️ <span style="color:#f85149">INSファイルはWAMファイル名に連動 — 同名で再実行すると上書き・消失</span>
   ・⚠️ クラッシュ時もINSファイルを部分的に生成→破損データの可能性

<span style="color:#58a6ff">3. Result Analysis</span>
   xxxINS.DAT → visualize_flow_field.py → <b>flow_field.html</b>
   ・Pipe ID が FLOW_PATH 定義と一致する必要あり
   ・⚠️ wam_generator変更後は FLOW_PATH の ID 再マッピング必須

<span style="color:#f85149; font-weight:600">🛡️ 安全ルール:</span>
   ・成功したINSファイルは即座にリネーム/コピーして保護
   ・wam_generator変更前に git commit で状態を保存
   ・WAMファイル名に日時スタンプを含める: temp_{rpm}_{ro}_{timestamp}.wam
</pre>
</div>

<!-- Flow Topology -->
<h2>🔧 Flow Topology — Cylinder 1 (代表)</h2>

<div class="topology-section">
<div class="section-label">Intake Path (Ambient → Cylinder)</div>
<div class="flow-line">
  <span class="fl-ambient">Ambient (∞)</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P2: Intake φ200 L350</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P3: Filter φ300 L20 f=0.8</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">Plenum_Main 10.5L</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P4: Bellmouth φ60→50 L150</span>
  <span class="fl-arrow">→</span>
  <span class="fl-valve">🦋 ITB Throttle</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">ITB_Junct [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P5: Runner φ50→35 L40</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">Split_Pl [50cc★]</span>
</div>
<div class="flow-line" style="margin-left: 16px;">
  <span style="color:#484f58">├─</span>
  <span class="fl-pipe">P6: Port_Main φ35→33 L73</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">ValvePkt [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P7: Port_Pkt φ33→35 L32</span>
  <span class="fl-arrow">→</span>
  <span class="fl-valve">🔴 Intake Valve 1</span>
</div>
<div class="flow-line" style="margin-left: 16px;">
  <span style="color:#484f58">└─</span>
  <span class="fl-pipe">P8: Port_Main φ35→33 L73</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">ValvePkt [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P9: Port_Pkt φ33→35 L32</span>
  <span class="fl-arrow">→</span>
  <span class="fl-valve">🔴 Intake Valve 2</span>
</div>
</div>

<div class="topology-section">
<div class="section-label">Exhaust Path (Cylinder → Ambient) — Bank Left (Cyl 1-3)</div>
<div class="flow-line">
  <span class="fl-valve">🔴 Ex Valve 1</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P40: Pkt φ30→32 L27</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">ValvePkt_Ex [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P41: Main φ32→30 L63</span>
  <span class="fl-arrow">──┐</span>
</div>
<div class="flow-line">
  <span class="fl-valve">🔴 Ex Valve 2</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P42: Pkt φ30→32 L27</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">ValvePkt_Ex [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P43: Main φ32→30 L63</span>
  <span class="fl-arrow">──┤</span>
</div>
<div class="flow-line" style="margin-left: 40px;">
  <span class="fl-plenum">Port_Junct [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P44: Header φ40→60 L300</span>
  <span class="fl-arrow">→</span>
  <span class="fl-junction">Type12 CID75 (3→1)</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P70: Col_Out φ60 L500</span>
</div>
<div class="flow-line" style="margin-left: 40px;">
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P72: Sec1_1 φ60 L600</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P74: FrontCat φ120 L200</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P76: Sec1_2 φ60 L400</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P78: Sec2_1 φ60 L400</span>
</div>
<div class="flow-line" style="margin-left: 40px;">
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">H_Junc_L [50cc★]</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P80: H_L φ60 L200</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P83: Sec2_2 φ60 L800</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P85: Muf_Adpt φ60 L150 f=0.1</span>
  <span class="fl-arrow">→</span>
  <span class="fl-plenum">Muffler 30L</span>
  <span class="fl-arrow">→</span>
  <span class="fl-pipe">P87: Tail φ60 L150</span>
  <span class="fl-arrow">→</span>
  <span class="fl-ambient">Ambient</span>
</div>
</div>

<!-- PIPE TABLE -->
<h2>📐 Pipe Parameters (Complete)</h2>
<div style="overflow-x: auto;">
<table>
<tr>
  <th>ID</th><th>Label</th><th>L(mm)</th><th>φL(mm)</th><th>φR(mm)</th>
  <th>T(K)</th><th>f</th><th>dx(mm)</th><th>Nodes</th><th>CID_L</th><th>CID_R</th>
</tr>
"""

# Pipe rows
for pid_str in sorted(pipes.keys(), key=lambda x: int(x)):
    p = pipes[pid_str]
    # Highlight issues
    row_class = ''
    notes = []
    if p['dx_mesh_mm'] < 10:
        notes.append('⚠️ mesh<10mm')
    if p['length_mm'] < 30 and p['nodes'] < 3:
        notes.append('⚠️ <3 nodes')
        row_class = ' class="clamped"'
    if p['friction'] > 0.05:
        notes.append(f'⚠️ f={p["friction"]:.2f}')
    
    html += f"""<tr{row_class}>
  <td class="num">{pid_str}</td>
  <td>{p['label']}</td>
  <td class="num">{p['length_mm']:.0f}</td>
  <td class="num">{p['dia_left_mm']:.1f}</td>
  <td class="num">{p['dia_right_mm']:.1f}</td>
  <td class="num">{p['temp_K']:.0f}</td>
  <td class="num">{p['friction']:.3f}</td>
  <td class="num">{p['dx_mesh_mm']:.0f}</td>
  <td class="num">{p['nodes']}</td>
  <td class="num">{p['cid_left']}</td>
  <td class="num">{p['cid_right']}</td>
</tr>
"""

html += """</table>
</div>

<!-- PLENUM TABLE -->
<h2>🫧 Plenum Parameters (Complete)</h2>
<div style="overflow-x: auto;">
<table>
<tr>
  <th>ID</th><th>Label</th><th>Physical(cc)</th><th>Clamped(cc)</th>
  <th>Ratio</th><th>T(K)</th><th>Status</th>
</tr>
"""

# Plenum rows
for plid_str in sorted(plenums.keys(), key=lambda x: int(x)):
    p = plenums[plid_str]
    row_class = ' class="clamped"' if p['is_clamped'] else ''
    status = '<span class="bad">CLAMPED ×{:.0f}</span>'.format(p['vol_clamped_cc'] / p['vol_physical_cc']) if p['is_clamped'] else '<span class="ok">OK</span>'
    
    html += f"""<tr{row_class}>
  <td class="num">{plid_str}</td>
  <td>{p['label']}</td>
  <td class="num">{p['vol_physical_cc']:.1f}</td>
  <td class="num">{p['vol_clamped_cc']:.1f}</td>
  <td class="num">{'×{:.0f}'.format(p['vol_clamped_cc'] / p['vol_physical_cc']) if p['is_clamped'] else '1:1'}</td>
  <td class="num">{p['temp_K']:.0f}</td>
  <td>{status}</td>
</tr>
"""

html += """</table>
</div>

<!-- ENGINEERING ISSUES -->
<h2>⚠️ F1 Engineering Analysis — Problem Identification</h2>

<div class="issue-card">
  <div class="tag critical">CRITICAL — Root Cause of NaN Crash</div>
  <p><b>50cc Volume Clamp — 全小型プレナムが10-50倍に膨張</b><br>
  ITB_Junction (物理: 1cc → 強制: 50cc)、Split_Plenum (2cc→50cc)、ValvePocket (3-5cc→50cc)、Port_Junct (1cc→50cc)。
  これにより、1気筒あたりのバルブ周辺に合計200cc（Split 50 + ValvePkt×2 100 + Port_Junct 50）の「仮想容積」が追加される。
  6気筒合計で <b>1200cc = 1.2L</b> の非物理的容積が存在。
  M54のストロークボリューム541cc/cylに対して37%に相当。</p>
</div>

<div class="issue-card">
  <div class="tag critical">CRITICAL — 数値安定性 vs 物理精度のジレンマ</div>
  <p><b>クランプ削減→即クラッシュ（1ccクランプでStudyInflowOutflowMass エラー）</b><br>
  ボリュームクランプ50cc→1ccに下げると、プレナム内の気体質量が極小化し、
  排気ブローダウン（4-6bar→1bar）または吸気バルブ閉鎖時の逆流衝撃波で質量がゼロ以下になる。
  これがOpenWAMの <code>StudyInflowOutflowMass</code> エラーの直接原因。<br>
  <b>解決策候補:</b> バルブ近傍プレナムの廃止（Type 12化 or パイプ統合）</p>
</div>

<div class="issue-card warn">
  <div class="tag warning">WARNING — 排気ポートの解像度不足</div>
  <p><b>Port_Ex_Pocket: L=27mm / dx=20mm → 2ノードのみ</b><br>
  排気ポケットパイプはたった2ノードで離散化。排気ブローダウンの衝撃波（マッハ0.5-1.0）を
  解像するには最低5-10ノード（dx=5mm）が必要。特にバルブ開直後の圧力勾配は1mm単位で変化する。
  <br><b>Port_Ex_Main: L=63mm / dx=25mm → 3ノードのみ</b> — 同様に不足。</p>
</div>

<div class="issue-card warn">
  <div class="tag warning">WARNING — Runner長が非現実的に短い</div>
  <p><b>Runner: L=40mm / φ50→35mm</b><br>
  S54のITBランナーは実際には120-180mm程度。40mmはほぼ存在しない短さで、
  ランナー内の共鳴効果（Helmholtz共鳴 / ラム空気効果）が全く再現されない。
  VE特性のRPM依存性に大きく影響する。</p>
</div>

<div class="issue-card warn">
  <div class="tag warning">WARNING — ITB_Junction 50ccクランプの影響</div>
  <p><b>Bellmouth (φ60→50mm) → [ITB Throttle] → ITB_Junction (50cc★) → Runner (φ50→35mm)</b><br>
  ITB_JunctionはITBスロットルの下流（スロットルとランナーの間）に配置されている。
  物理的にはITBバタフライ直下の小さな空間（~1cc）だが、50ccにクランプされることで
  スロットル直後の真空形成が鈍化し、スロットル応答特性に影響する。</p>
</div>

<div class="issue-card warn">
  <div class="tag warning">WARNING — CSL_Panel_Filter の異常摩擦</div>
  <p><b>f = 0.800 (通常パイプの40倍)</b><br>
  パイプ圧損 ∝ f·L/D·ρ·v²/2。ただし L=20mm, φ300mmなので実効圧損は極小。
  フィルターのモデリングとしてはφ300mmの超短管 + 高摩擦よりも、
  適切な圧損係数を持つオリフィスまたはCd制限の方が物理的に正確。</p>
</div>

<div class="issue-card warn">
  <div class="tag warning">WARNING — Type 12 (Branch Junction) の安定性限界</div>
  <p><b>Header 3本 + Col_Out 1本 = 4パイプ接続</b><br>
  Type 12 (TCCRamificacion) はCollectorレベルでは安定動作するが、
  バルブ直近（Split_Pl, Port_Junct）では NaN 不安定が発生した。
  これは TCCRamificacion が特性線法の分岐計算で音速超えに対応できないことを示唆。
  <b>Type 12 の適用はCollector合流点および下流のみに制限すべき。</b></p>
</div>

<div class="issue-card">
  <div class="tag critical">CRITICAL — Muffler 30L の問題</div>
  <p><b>Muffler_Dual: 30L = 30,000cc</b><br>
  マフラー容量が30Lは妥当だが、排気系全体のバックプレッシャー応答を平準化する。
  実マフラーの内部構造（バッフル、パンチングパイプ）はモデル化されていないため、
  単なる大容量タンクとして機能し、排気干渉効果が消失する。</p>
</div>

</body>
</html>
"""

output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output', 'model_audit.html')
os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(html)
print(f"Written to {output_path}")

# NEXT SESSION PROMPT — 部分負荷キャリブレーション精密化（Stage 58 候補）

以下をそのまま次のローカル Claude Code セッションに貼り付けてください。

---

CSL_Simulator の部分負荷キャリブレーション後続作業（Stage 58）を進めてください。

## 前提（読んでから着手 — 再導出しないこと）
- `CSL_Simulator/docs/EXHAUST_STABILIZATION_NOTES.md` **Stage 57**（前回の全記録）
- `CSL_Simulator/docs/HANDOFF_NEXT_SESSION.md` のトップバナー
- 現状: 実測ジオメトリ + rail EQ がデフォルト。`backend/app/data/calibration.json` (schema v2) に
  WOT points / sigma(pedal) / ICV σ=0.30 / base面 がフィット済み。プランの数値ゲートは未達
  （WOT 2700/3900 の低回転チャージ不足が物理起因、詳細は Stage 57）。

## タスク（優先順）

### 1. part_load_alpha=0.4 での再フィット（本命・期待値最大）
Stage-57 Step-D の事実: α0.4 は LOAD-20 行 r **0.983**（レガシー 0.693）、±5 base 摂動スイング
**0.6pp**（レガシー 17.5pp）。不採用理由は 3900/45 の持続NaN 1セルのみ。
1. まず 3900/45 α0.4 を診断（`scratchpad` にログ保持で再現、NaN の場所と持続性を確認。
   周辺 base ±10 で回避できるなら実害なし）。
2. `calibration.json` の `mouth_rad.part_load_alpha` を 0.4 にして、`fit_partload.py sigma`
   → `apply` → `base` → `apply` → `recheck` を再実行（α0.4 の deck 環境下で全て再フィット。
   ICV σ=0.30 は据え置きで開始し、recheck 残差 >0.05 なら1回だけ再調整）。
3. 採用判定: 検証マップ（`phase5_verify.py`）で per-row wot_ratio_maxdp が現状
   （20行:0.137 / 30行:0.114 / 45行:0.149 / 65行:0.265、フィット6列）から改善し、
   invalid セルが増えないこと。ダメなら α null に戻して差分を記録。

### 2. 低回転吸気供給の物理モデル化（WOT 2700/3900 の残欠損）
Stage-57 の発見: ICV σ 0.30 が 2700 WOT を 87.5→97.3 に押し上げた（stock 103.7）。
開いたレールは実在する低回転供給経路。ただし実車の ICV は負荷依存デューティ（WOT ほぼ閉）。
- 候補A: `icv` を負荷依存に拡張（`calibration.json` に `sigma_by_load`、simulation_service の
  注入は per-cell deck 焼き込みなのでソルバー変更不要）。R3（定数打ち切り）の緩和になるので、
  「物理的に正当化できる単調減少 σ(load)」に限定し、fit_meta に根拠を記録。
- 候補B: ダクト/スロットの端補正・箱内トランペット形状（`wam_generator.py` の duct テーパ表現の
  精密化）。2セルプローブ（2700/3900 WOT）で効くか先に確認してから広げること。
- どちらも golden_deck_check.py green 維持（レガシー経路不変）が絶対条件。

### 3.（1・2が落ち着いたら）アイドル帯域列の拡張
base 面の rpm 列を 600-2400 に拡張（現状は 2700 未満が 2700 列にクランプ）。
870/1400/2100 の既知 cyl-collapse セルはゲート除外のまま。

## 非交渉事項（全作業共通）
- `OMP_NUM_THREADS=1`、`OPENWAM_HLLC=1`、`OPENWAM_THR_CHOKE=1`、`OPENWAM_VEDIAG=1`、
  `OPENWAM_FAST_OUTPUT=1`（スイープはセル並列で稼ぐ。`scripts/run_cells_local.py` が全部やる）
- 収束は slope 判定（|dVE/dcyc|<0.3）。deck キャップは 60 サイクル（デフォルト済み）。
- NaN ゲートは「持続 NaN のみ無効」（サイクル5以降）。始動過渡の回復 NaN は許容。
- 変更のたびに `python scripts/golden_deck_check.py`（レガシー deck バイト同一）。
- コミットは master 直接 + push（trunk-based）。

## ツール
- `backend/scripts/run_cells_local.py` — アプリ同一経路のセルランナー（deck キャッシュ互換・再開可能）
- `backend/scripts/fit_partload.py` — sweep+fit CLI（icv/sigma/base/alpha/recheck/apply）
- `backend/scripts/phase3_analyze.py` / `phase5_verify.py` — 形状分析・検証マップ
- アプリ起動は `CSL_Simulator/start_app.bat`（ダブルクリック）または skill `csl-simulator-run`
- セル単価目安: 部分負荷 2-4分、WOT 3-8分、2700 WOT 長め（60cyc で〜10分）。16コアで12並列。

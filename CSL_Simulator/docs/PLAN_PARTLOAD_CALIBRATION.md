# PLAN — 実測ジオメトリのデフォルト化 + 部分負荷校正 (ローカル実行用)

作成: 2026-07-04 (クラウドセッション、計画のみ)。実装・全ソルバー検証は**ローカルPC**で行う。
前提知識: `HANDOFF_NEXT_SESSION.md` (Stage 56)、`HANDOFF_UX_M2_TO_M3.md`、`UX_APP_DEV_SPEC.md` §3-§5、
`EXHAUST_STABILIZATION_NOTES.md` Stage 35/48/49/56。本書はそれらの「次フェーズ」を実行可能な形に確定したもの。

---

## 0. 背景と確定事項

### 0.1 実車実測値 (オーナー実測、2026-07。これが新デフォルトになる)

| 項目 | 現行モデル | 実測 (新デフォルト) |
|---|---|---|
| プレナム容積 | 10.5 L (`models.py:66`) | **22.9 L** |
| 吸気ダクト | ハードコード 350mm×φ200 (`wam_generator.py:559`) | **長さ400mm、入口内径φ190、プレナム側開口550×190mm** |
| ダクト→プレナム面積等価径 | φ200 (実質) | **Deq = √(4·0.55·0.19/π) ≈ 365mm** (面積等価。1DソルバーのDは面積スケジュールなので水力直径ではなく面積等価を使う) |
| パネルフィルタ | 20mm×φ300 (`wam_generator.py:581`) | **550×190の接続面に配置、厚み~20mm** |
| ランナー上流 (スロットル→EQ分岐) | 15mm (`RunnerConfig.upper_length`) | **10mm** |
| ランナー下流 (EQ分岐→ポート分割) | 25mm (`RunnerConfig.lower_length`) | **60mm** |
| EQ系トポロジー | 各気筒φ30×75mmスタブ → **閉じた**中央141ccプレナム | **共通レール φ21×570mm** が6気筒ランナーに直接タップ、**レール中央付近**から **φ21×250mmゴムパイプ → ICV(アイドルバルブ)経由 → メインプレナムに帰還** |

### 0.2 トポロジー変更の物理的意味 (重要)
- 現行の「閉じたEQプレナム」に対し、実車のEQレールは**ICV経由でスロットル上流(プレナム)に開いている**。
  これはスロットルを迂回するバイパス流路 = **アイドル/低負荷の吸気経路**。
- Stage 49 の発見「低ペダル域の有効面積が3〜5倍不足 (必要σ_eff≈0.046-0.067 vs 幾何値0.013、AGAIN~3.2-3.7)」は、
  このバイパスの欠落と符合する可能性が高い (φ21帰還パイプ面積 ≈346mm²、6気筒共有 — 同オーダー)。
  → **ICV有効面積は物理的に正当な部分負荷校正レバー**になる (従来のAGAINファッジの一部を置き換える)。
- レール容積 ~197cc + 帰還パイプ ~87cc が「分布した」形で入る (現行は141ccの集中定数) — 音響特性も変わる。

### 0.3 ユーザー確認済みの決定
1. EQレール = **共通レール型** (φ21×570mmレールが6ランナーに直接タップ、タップはスロットル下流の既存Type-12ティー位置)
2. プレナム帰還は**ICV等を経由** (常時開放ではない) → `icv_sigma` はフィットパラメータ
3. ゴムパイプは**レール中央付近**から (`return_tap="center"` 既定)
4. パネルフィルタは**550×190面**にある (厚み~20mm)
5. 部分負荷校正のターゲット = **ECUマップ `kf_rf_soll`** (24×20; アップロードBINがあればそちら優先)
6. **負荷10%未満の行 (0.1〜7.5%のアイドル域) は校正対象外** — ICVの実動作はECUデューティ制御であり
   固定有効面積モデルでは保証できないため。校正対象 = **負荷10〜100%の11行 × 20rpm**
7. MSS54HP CSLチューナー統合は本フェーズ完了後

### 0.4 非交渉事項 (全Phase共通; UX_APP_DEV_SPEC §3)
- `OMP_NUM_THREADS=1` (決定論; セル並列で速度を稼ぐ)、`OPENWAM_HLLC=1`、`OPENWAM_THR_CHOKE=1`、`OPENWAM_VEDIAG=1`
- 収束は**slope判定** (|dVE/dcyc| < 0.3、最後の5サイクル)。サイクル数では判定しない
- `cylinder_balance` ゲート (collapse セルは除外・平均に混ぜない)
- 評価は**シェイプ** (絶対レベルはWOT比補正で除去)
- **config-envシャドウイング禁止**: SimConfigフィールド化したパラメータを simulation_service が env で設定してはならない
  (THR_GAMMA/RUNNER_SC の前例; `HANDOFF_UX_M2_TO_M3.md` GOTCHA)

---

## Phase 0 — ベースライン + 回帰ハーネス (挙動変更なし)

1. **`backend/scripts/golden_deck_check.py` 新規**: レガシー値を明示固定した `SimConfig`
   (plenum 10.5 / runner 15/25 / eq `model="plenum"` / デフォルトduct) で
   (rpm=5300, tps=1.0, ign=20.0) と (5300, tps=0.20) の2 deckを生成し SHA-256 を記録。
   **編集前HEADでハッシュを採取してから**編集を始め、以後の全コミットでバイト同一性を確認する。
2. ローカルで基準データ採取: `wot_quick` (20セル) + 部分負荷1列 (5300 × tps 20/45/65)。
   `last_run_*.json` とmetricsを pre-geometry datum として保存。~25セル。

## Phase 1 — configプラミング (デフォルトはレガシー値のまま、railはopt-in)

### 1.1 `backend/app/models.py`
- `InletConfig`: デフォルトを**現行ハードコード値に合わせて** `duct_length=350.0, duct_diameter=200.0` に変更し、
  generatorから読むようにする (現状 200/100 は未配線のダミー)。追加:
  ```python
  exit_width: float | None = None    # mm — プレナム側スロット開口幅 (Noneなら円形=duct_diameter)
  exit_height: float | None = None   # mm
  filter_diameter: float = 300.0     # mm (exit_width/height指定時はスロットDeqを使用)
  filter_thickness: float = 20.0     # mm
  ```
- `EqTubeConfig` 拡張:
  ```python
  model: str = "plenum"              # "plenum" | "chain" | "rail"  (railはPhase 3.5で既定化)
  rail_diameter: float = 21.0        # mm 共通レール内径
  rail_length: float = 570.0         # mm タップ1〜6のスパン (5セグメント×114mm)
  rail_tap_diameter: float = 30.0    # mm 数値安定床 (物理はφ21; リスクR1参照)
  rail_tap_length: float = 30.0      # mm ランナーティー→レールティーのスタブ
  return_pipe_diameter: float = 21.0 # mm ゴムパイプ
  return_pipe_length: float = 250.0  # mm
  return_tap: str = "center"         # "center" | "cyl1_end" | "cyl6_end" (実車=中央付近)
  icv_sigma: float = 0.15            # ICV有効開口率 (帰還パイプ断面比; Phase 4Aでフィット)
  ```
- `RunnerConfig.upper_length/lower_length` のデフォルト変更は**Phase 3.5まで待つ** (15/25のまま)。

### 1.2 `backend/app/simulator/wam_generator.py`
- **ダクト** (L559): `c.intake.inlet` から読む。テーパは `_add_pipe` の d_start/d_end で表現
  (入口 `duct_diameter`、出口 = スロット指定時 Deq、なければ `duct_diameter`)。friction 0.05 / dx 0.05 維持。
- **フィルタ** (L581): `filter_thickness` / `filter_diameter`(or スロットDeq)。friction 0.8 維持。
- **railトポロジー** — 既存 chain モデル (L634-641 / L790-795 / L842-866) のパターンを踏襲:
  - フラグ: `self._eq_rail = (env OPENWAM_EQ_RAIL or c.intake.eq_tube.model=="rail") and not self._skip_eqtube`
    を `_eq_chain` (L634) の隣に。`self._rail_tee_cids = []`。
  - 気筒ループ内 (スタブ生成ブロック L769-803 のrail分岐): タップスタブ `EqRail_Tap_{i}`
    (φ`rail_tap_diameter`×`rail_tap_length`、friction=`stub_friction`、dx 0.025、`init_p=intake_map_bar`) を
    既存 `cid_eq_branch` (L744) から新設 `_create_branch_junction()` ティーへ; ティーを `_rail_tee_cids` に追加。
  - ループ後: `EqRail_Seg_{s}` ×5 (φ`rail_diameter`×`rail_length/5`、friction~0.03ゴム、dx 0.025) で隣接ティーを連結。
    `return_tap=="center"`: 中央セグメント (3-4間) を2分割して7個目のティーを挿入し、そこから
    `EqRail_Return` (φ`return_pipe_diameter`×`return_pipe_length`) を出す。
  - **ICV**: `EqRail_Return` の端を `_add_con_plenum_pipe_v2(plenum_id, return_pipe_id, 1, valve_idx=icv_valve_id)` で
    Plenum_Main に接続。ICV = Type-11接続上の**固定Cdバルブ** (INTAKE_V2マウスバルブ L714/L1217 と同じ実証済み機構)。
    `_generate_footer` (L1199) で rail 時 `total_valves += 1`; `icv_valve_id = 26 + n_cyl + (1 if intake_v2 else 0)`。
    σは `_ce("OPENWAM_ICV_SIGMA", c.intake.eq_tube.icv_sigma, 0.15)` (env > config > default)。
  - **"plenum"/"chain" は回帰bisect用に温存**。rail無効時は既存コード経路に一切触れない (golden-deckゲートで担保)。
  - Type-12は必ず3パイプ構成を維持 (4パイプ直タップは作らない — chainモデルと同じ流儀)。
- **`_calibrated_sigma`** (L1838): env `OPENWAM_THR_SIGMA_BP` → **インスタンス属性 `self._sigma_bp`**
  (simulation_serviceがcalibration.jsonから注入する `[[pedal,sigma],...]`) → None(幾何経路) の優先順位に拡張。

### 1.3 フロントエンド `frontend/components/VehicleBuilder.tsx`
- デフォルト (L118-124): models.py と常に一致させる (Phase 1ではレガシー値+新フィールド、Phase 3.5でフリップ)。
- フォーム: eq_tube ケース (L477) にモデル選択へ `"rail"` 追加 (L488付近) + rail寸法/Return/ICV行の条件表示;
  Duct行 (L448付近) に duct_diameter / exit_width / exit_height を追加。

### 1.4 実測シート・計装
- `backend/app/parameters/manifest.py`: `intake.plenum_vol` **vmax 20→30** (22.9が弾かれる)。
  追加Param: `intake.inlet.exit_width/exit_height` (50-800)、`filter_thickness`、
  `intake.eq_tube.rail_diameter` (5-40) / `rail_length` (100-1000) / `return_pipe_diameter` / `return_pipe_length`。
  既存 `eq_tube.stub_length` vmax 300 は rail_length を別Paramにするのでそのままで可。
  `icv_sigma` は**載せない** (計測不能・フィット値)。SHEET_SCHEMA を 2 に。旧シートはパスマッチなので互換。
- `backend/app/store/run_store.py::extract_geometry` (L189-190): ランナー長ハードコード(15.0/25.0)を config 読みに;
  `eq_model`・rail寸法・`icv_sigma` を追加 (サロゲートの特徴量になる)。
- `docs/MODEL_SPEC.md`: 「吸気トポロジー v2 (rail)」節を追加、旧plenumモデル表はlegacyと明記、実測値を記録。

**コミット1** = Phase 1全部 (レガシーデフォルト + golden-deck green)。**コミット2 (Phase 3.5)** = デフォルトフリップ。

## Phase 2 — レール安定性スクリーニング (フィット前; ~12-18セル, <1h)

- セル: {2700, 6900} × {tps 20, 100} × {plenum, rail} = 8 + 5300×45 両モデル = 10。
- ゲート: NaNなし / blow-upなし (VE>300で棄却) / slope<0.3 @ cyc≤45 / `cylinder_balance` が plenumモデル比で**悪化しない**。
- **リスクR1 (最重要)**: φ52ランナー : φ21タップ = 面積比6.1:1 は Stage-35 の安定床 (~3:1; φ10は-10MWのNaN源、
  φ30が最小安定) を超える。→ 既定は**タップφ30の数値床** (物理φ21との差は数値上の妥協としてMODEL_SPECに明記)。
  レールセグメント自体のφ21はティー側がφ30なので面積比~2:1で安全。φ21直タップはHLLC下でA/B確認のみ(2セル)、NaNなら即φ30維持。

## Phase 3 — WOT再検証・再フィット (ジオメトリ変更はWOT校正を無効化する; ~100-120セル, 2-4h)

プレナム2.2倍・実ダクト・ランナー10/60でram共振が移動する。alpha=0.4もEXVANOS datumも旧ジオメトリでのフィット。

1. **WOT行比較**: 実測ジオメトリ × {plenum, rail} を fit-rpm 6点 (2700/3900/4600/5300/6300/6900) で回し、
   勝者を20点フルで。シェイプ指標 (r / max_norm_shape_err / peak rpm / range) vs `stock_csl_ve.json`。
2. **monostability + alphaスイープ**: `OPENWAM_MOUTH_RAD` ∈ {0.2,0.3,0.4,0.5} × 6rpm。
   `OPENWAM_EXVANOS_BASE` ±5 摂動 (3900/5300) でattractor flipしない**最小alpha**を採用 → `calibration.json mouth_rad.alpha`。
3. **EXVANOS WOT再フィット**: base {130,150,170} × 6rpm でbracket→secant。実ジオメトリでram peakが3900に来れば
   **flat datumへフォールド** (`use_stale_shape_fit=false` + `wot_base_stable` 更新、stale解除が本命)。
   per-rpmスイングがまだ要るなら `points` を `fit_cam_deg: 260` で再記録。
4. **進行ゲート**: r≥0.95 / max_shape_err≤0.05 (hard 0.12) / peak 3900±1bp / health全green。
   → **Phase 3.5: デフォルトフリップ**を単一コミットで (models.py / VehicleBuilder.tsx / manifest現在値、
   `plenum_vol=22.9, duct=400/190+550×190, runner=10/60, model="rail"`)。

## Phase 4 — 部分負荷校正ロジック

### 4.0 配線 (コード; フィット開始前)
- **`calibration.json` schema v2** (`backend/app/data/calibration.json` + `calibration_constants._default()`):
  ```json
  {
    "schema_version": 2,
    "mouth_rad": {"alpha": "<Phase3再フィット>", "w": 0.005, "wot_tps_threshold": 85.0,
                  "part_load_alpha": null},
    "thr_choke": 1,
    "intake_vanos_base": 130.0,
    "thr_sigma": {"enabled": false,
                  "points": [[0.0,0.001],[0.20,null],[0.30,null],[0.45,null],[0.65,null],[0.85,null],[1.0,0.96]],
                  "fit_meta": null},
    "icv": {"sigma": null, "fit_meta": null},
    "exvanos_base": {"wot_base_stable": "<Phase3>", "use_stale_shape_fit": false,
                     "part_load_const": 150.0, "scale": 1.0, "points": [],
                     "surface": null}
  }
  ```
  `null`/欠落 = レガシー挙動 (スキーマはフィット前に投入できる)。
- **`calibration_constants.py`**: `exvanos_base_for(cal, rpm, load, is_wot)` 化 — `surface` があり非WOTなら
  (rpm, load) bilinear補間 (クランプ)。**load=100行はWOTフィットと同値にアンカー**し、`is_wot` 短絡は不変
  → WOT行は構造上回帰不能。`thr_sigma_points(cal)` / `icv_sigma(cal)` / `part_load_alpha(cal)` 追加。
  **`reload()`/mtimeチェック追加 (リスクR4: `_CACHE` が無効化されず、フィッタの書き込みが稼働サーバーに見えない)**。
- **`simulation_service.py`**:
  - `exvanos_base_for` 呼び出し2箇所 (L348 VEマップ / L599 waveform) に load を渡す。
  - `gen = WAMGenerator(...)` 直後 (L359 / L618): `gen._sigma_bp = calib.thr_sigma_points(cal)`;
    `icv_sigma(cal)` が非Noneなら `point_config.intake.eq_tube.icv_sigma` に注入 (優先順位: env > calibration.json > SimConfig)。
  - `_build_sim_env`: 非WOTで `part_load_alpha` 設定時のみ `OPENWAM_MOUTH_RAD` を出す
    (`MOUTH_RAD` は `_RESULT_ENV` 済みなのでdeckキャッシュキーは正しい)。
  - `CSL_LOAD_SUBSET` フックを `CSL_RPM_SUBSET` (L301) の隣に追加 (部分マップをフィッタが安く回すため)。
  - run記録の `calib` ブロックに `schema_version` / surface・sigma のsha1 / `icv_sigma` / `part_load_alpha` を追加。
- **deckキャッシュ整合 (R5)**: icv_sigma / sigma_bp / rail寸法は**deck焼き込み**なのでキャッシュは自然に正しい。
  env側は `part_load_alpha`→`OPENWAM_MOUTH_RAD` のみで、これは `_RESULT_ENV` 済み。

### 4.1 フィット基盤 (`calibration_service.py` は復活させない)
- `calibration_service.py` は501のまま (docs推奨; `self.app_dir` 未定義バグあり)。代わりに:
- **新規 `backend/app/simulator/calibration_fit.py`** — 純関数・I/Oなし・ソルバー起動なし:
  `fit_icv(cells, kf_maps) -> sigma`、`fit_sigma_bp(cells, kf_maps) -> points`、
  `fit_base_surface(cells, kf_maps, wot_anchor_row) -> surface`、`apply_fits(cal, ...) -> new_cal` (+残差レポート)。
  缶詰CSVでユニットテスト可能に。
- **新規CLI `backend/scripts/fit_partload.py`** — スイープ実行 (WAMGenerator + subprocess、omp1、
  `concurrent.futures` セル並列、セル毎CSV追記で再開可能 — `exvanos_base_sweep.py` の流儀をローカル向けに
  omp1並列化)、`calibration_fit` を呼び、`calibration.json` を**アトミック書き込み** (tmp+replace) +
  `fit_meta` = {date, commit, exe sig, 元CSV, 残差}。

### 4.2 フィット順序: **ICV → sigma(pedal) → base(rpm,load) → 外側再チェック1回**
順序の根拠: ICVバイパスは「ほぼ閉じたスロットルに並列な固定面積」で、baseレバーが死んでいる最低負荷×高rpmセル
(Stage 48: 6900/20はどのbaseでも0.67x stock) を支配する。sigma(pedal)を先にフィットすると低ペダルBPが
バイパス分を吸収し、ICV導入後に二重計上になる。

- **Step A — ICV有効面積** (~48セル): rpm {3100,3900,5300,6900} × load {10.01,14.99,20} × σ {0.05,0.10,0.20,0.40}、
  幾何sigma経路・base150。目的関数: Σ|p_sim−p_stock|、p = VE/VE_WOT (sim側VE_WOTはPhase-3行、stock側は
  kf_rf_soll の load行/100行)。単一定数を期待; 強いrpm依存が残れば中央値で打ち切り残差はStep Bへ (リスクR3)。
- **Step B — sigma(pedal)** (~50-70セル): **calibration.json `thr_sigma` に持つ (ThrottleConfigに入れない**
  — フィット値・run毎トレース必須・フォールド可能にするため。ThrottleConfigは物理値 offset/gamma のみ)。
  ペダル {0.20,0.30,0.45,0.65,0.85} × rpm {3100,3900,5300,6900}: 各BPをsecant 2-3評価で
  p(load) ターゲットのrpm平均に合わせる。アンカー 1.0→0.96 (WOT終端不変) / 0.0→0.001。BP間単調性制約。
- **Step C — base(rpm,load)面** (~90-120セル): ICV+sigma凍結。行 {20,30,45,65} × rpm 6点 ×
  base {WOT_fit−40, WOT_fit, WOT_fit+40} bracket + secant 1回/セル (Stage-48: 5300のstock交差は
  load 20/45/65 → ~95/135/162 と滑らか)。load=100行 = Phase-3フィット固定。
  `cylinder_balance` 棄却セルはフィットから除外し、**フィット後に再ゲート** (低baseがcollapseを誘発する既知結合:
  6900/45 は base150でvalid・base110でREJ)。
- **Step D — 部分負荷減衰判断** (~36セル): `part_load_alpha` ∈ {off, 0.2, 0.4} × load {20,45} × 6rpm を
  Step A-C校正で A/B。採用条件: collapse数 ≤ レガシー / LOAD-20行 r ≥ 0.89 (Stage-50データム) 維持 /
  ±5 base摂動2セルでsmooth。満たさなければ `null` (レガシー) のまま。
- **Step E — 外側再チェック1回**: 最終sigma/baseでStep-Aセルを再検証、p誤差>0.05ならICVを1回だけ再調整して終了
  (往復させない)。

### 4.3 部分負荷メトリクス + ターゲット配線
- `simulation_service.run_point` (L414付近): 部分負荷セルに `ve_stock = lut(kf_rf_soll, rpm, load)·100` +
  `stock_source: "ecu_map"` を付与 (WOTは従来の `stock_csl_ve.json` = 実測wideband)。
  → 既存の per-row r / shape-err / peak メトリクスが部分負荷行で即活性化。
- `metrics.py`: `wot_ratio_maxdp` 実装 (L228のNoneスタブ置換)。クロス行なので `run_ve_map_generation` 側で
  load=100行の存在時に計算して各行dictへ注入: 行内のhealth-trusted rpmにわたる max|sim/sim_wot − stock/stock_wot|。
  閾値 (UX §5 metric #8): **GREEN ≤ 0.05 / YELLOW ≤ 0.12 / RED > 0.12**。部分負荷行の status に合成。
- `frontend/components/ValidityPanel.tsx`: `maxΔp` 列追加 (`statusOf(row.wot_ratio_maxdp, 0.05, 0.12, false)`、
  L68の既存パターン)。行型に `wot_ratio_maxdp` 追加。

## Phase 5 — 最終検証 + ドキュメント (~220セル, 4-8h/夜間可)

- `CSL_LOAD_SUBSET` で負荷≥10%の**11行×20rpm=220セル** (任意で480全面を夜間)。
- 合格基準: WOT行 green (r≥0.95, shape-err≤0.05) / 部分負荷行 `wot_ratio_maxdp` ≤0.05 (許容0.12) /
  NaNゼロ / collapseはゲートで除外(平均に混ぜない) / overall "Valid — proceed to Tuning"。
- `MODEL_SPEC.md` (railトポロジー最終版) / `EXHAUST_STABILIZATION_NOTES.md` (新Stage追記) /
  `HANDOFF_NEXT_SESSION.md` 更新。**MSS54HP CSLチューナー統合がアンブロック**されたことを明記。

---

## 実行予算 (ローカル、omp1 × 8-12並列想定)

| Phase | セル数 | 目安 |
|---|---|---|
| 0 ベースライン | ~25 | ~1h |
| 2 レール安定性 | 12-18 | <1h |
| 3 WOT再フィット | 100-120 | 2-4h |
| 4A ICV | ~48 | 2-4h |
| 4B sigma(pedal) | 50-70 | 2-4h |
| 4C base面 | 90-120 | 4-6h |
| 4D+E 減衰A/B+再チェック | ~40 | 2h |
| 5 検証マップ | 220 (任意480) | 4-8h (夜間) |

## リスク台帳

- **R1** レールタップのType-12面積比 (φ52:φ21=6.1:1 > 安定床~3:1; φ10のNaN前歴) → タップφ30数値床、全ティー3パイプ。
- **R2** 22.9Lプレナム+実ダクトでram共振が移動し多安定が再発しうる → **alpha再スイープ(Phase 3.2)をフィット前に必須**。
- **R3** ICVは実際にはECUデューティ制御 → 固定面積でフィットし、動作点依存が残っても**テーブル化せず**定数で打ち切り・明記。
- **R4** `calibration_constants._CACHE` が無効化されない → reload/mtimeチェックを4.0で追加。
- **R5** deckキャッシュ: 新レバーは全てdeck焼き込み (env側は `part_load_alpha`→MOUTH_RADのみ、`_RESULT_ENV`済み)。
- **R6** kf_rf_soll のy軸をpedal%として扱うのは近似 (MSS54はfill-demand) — sigma(pedal)フィットが吸収する。本書で明記済み。

## 変更対象ファイル一覧

| ファイル | 変更 |
|---|---|
| `backend/app/models.py` | InletConfig拡張 / EqTubeConfig rail / (3.5でデフォルトフリップ) |
| `backend/app/simulator/wam_generator.py` | ダクト・フィルタconfig化 / railトポロジー / `_sigma_bp` |
| `backend/app/simulator/calibration_constants.py` | schema v2 / `exvanos_base_for(rpm,load)` / reload |
| `backend/app/data/calibration.json` | schema v2 |
| `backend/app/simulator/simulation_service.py` | load渡し / sigma・icv注入 / part_load_alpha / LOAD_SUBSET / calibログ |
| `backend/app/simulator/metrics.py` | `wot_ratio_maxdp` |
| `backend/app/simulator/calibration_fit.py` | **新規** (純関数フィット) |
| `backend/scripts/fit_partload.py` | **新規** (スイープ+フィットCLI) |
| `backend/scripts/golden_deck_check.py` | **新規** (回帰ゲート) |
| `backend/app/parameters/manifest.py` | vmax修正 + rail Param + SHEET_SCHEMA 2 |
| `backend/app/store/run_store.py` | extract_geometry更新 |
| `frontend/components/VehicleBuilder.tsx` | デフォルト+フォーム |
| `frontend/components/ValidityPanel.tsx` | maxΔp列 |
| `docs/MODEL_SPEC.md` ほか | railトポロジー節 / 新Stage追記 |

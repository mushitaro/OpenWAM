# OpenWAM S54 CSL — 完全モデル仕様書

最終更新: 2026-02-11 (Port Taper + Exhaust Valve Dia Fix)
生成元: `app/simulator/wam_generator.py`
パイプ数: 75 | プレナム数: 7 | コネクション数: 89 | Type 12 接合: 20

---

## 1. シミュレーション・ワークフロー

### ファイル構成と生成順序

```
[入力]
  app/models.py                    SimConfigクラス（RPM, RO%, エンジン寸法, 排気レイアウト等）
  app/simulator/wam_generator.py   WAMGenerator（SimConfig → .wam テキストファイル生成）

[実行]
  OpenWAM.exe {filename}.wam
    実行バイナリ: c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe

[出力]
  {filename}INS.DAT      圧力・流速・温度の時系列データ（全パイプ・全ノード）
  {filename}RES.DAT      サイクル平均結果（VEなど）
```

### C++ 修正履歴（バイナリに反映済み）

| 日時 | ファイル | 内容 |
|------|---------|------|
| 2026-02-09 | TCCRamificacion.cpp | Type 12 ReadAverageResults() シグネチャ修正 |
| 2026-02-10 | TCCPerdidadePresion.cpp | CalculaCD 呼び出し追加、FSectionRatio=1.0 初期化 |
| 2026-02-10 | TTipoValvula.cpp | FSectionRatio デフォルト 1.0 設定 |
| 2026-02-11 | TTubo.cpp | γ relaxation no-op fix + Species NaN recovery |
| 2026-02-11 | TCCRamificacion.cpp | Junction convergence MAX_ITER + shock guard |
| 2026-02-11 | Globales.h | ReduceSubsonicFlow Mach floor guard |
| 2026-02-11 | TCCUnionEntreTubos.cpp | Entropy guard for flow direction calc |

---

## 2. 吸気系トポロジー（Type 12 プレナムレス設計）

### 吸気フロー順序（1気筒あたり）

```
[Ambient_Intake] Plenum 1
    |
    v
P1: CSL_Intake_Pipe (共通)
    |  --- CID 1: Type 6 (Pipe-to-Pipe) ---
    v
P2: CSL_Panel_Filter (共通)
    |  --- CID 2: Type 11 (Plenum_Main) ---
    v
[Plenum_Main] Plenum 2 (10.5L)
    |  --- CID 3/10/17/24/31/38: Type 11 ×6 ---
    v  (×6 分岐)
P3/9/15/21/27/33: Bellmouth_{1-6} (φ70→φ52, 150mm)
    |  --- CID 4/11/18/25/32/39: Type 10 (Throttle) ---
    v
[ITB Throttle] (vid=26+i)
    |
    v
P4/10/16/22/28/34: Runner_Upper_{1-6} (φ52, 15mm)
    |  --- CID 5/12/19/26/33/40: Type 12 ① (等圧管分岐) ---
    ├→ P5/11/17/23/29/35: EqTube_Stub_{1-6} (φ10, 75mm)
    |      |  --- CID 6/13/20/27/34/41: Type 11 → Eq_Tube Plenum 3 ---
    v
P6/12/18/24/30/36: Runner_Lower_{1-6} (φ52, 25mm)
    |  --- CID 7/14/21/28/35/42: Type 12 ② (ポート分岐) ---
     ├→ P7/13/19/25/31/37: Port_In_{1-6}_1 (φ52→φ35, 105mm) → [Valve vid=i*2+1]
     └→ P8/14/20/26/32/38: Port_In_{1-6}_2 (φ52→φ35, 105mm) → [Valve vid=i*2+2]
```

### 吸気系パイプ一覧（全38本）

#### 共通パイプ（2本）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 1 | CSL_Intake_Pipe | 350 | 200.0 | 200.0 | 300 | 0.050 | 50 | 0 | 1 |
| 2 | CSL_Panel_Filter | 20 | 300.0 | 300.0 | 300 | 0.800 | 10 | 1 | 2 |

#### 気筒1（Pipe 3–8）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 3 | Bellmouth_1 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 3 | 4 |
| 4 | Runner_Upper_1 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 4 | 5 |
| 5 | EqTube_Stub_1 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 5 | 6 |
| 6 | Runner_Lower_1 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 5 | 7 |
| 7 | Port_In_1_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 7 | 8 |
| 8 | Port_In_1_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 7 | 9 |

#### 気筒2（Pipe 9–14）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 9 | Bellmouth_2 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 10 | 11 |
| 10 | Runner_Upper_2 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 11 | 12 |
| 11 | EqTube_Stub_2 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 12 | 13 |
| 12 | Runner_Lower_2 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 12 | 14 |
| 13 | Port_In_2_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 14 | 15 |
| 14 | Port_In_2_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 14 | 16 |

#### 気筒3（Pipe 15–20）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 15 | Bellmouth_3 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 17 | 18 |
| 16 | Runner_Upper_3 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 18 | 19 |
| 17 | EqTube_Stub_3 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 19 | 20 |
| 18 | Runner_Lower_3 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 19 | 21 |
| 19 | Port_In_3_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 21 | 22 |
| 20 | Port_In_3_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 21 | 23 |

#### 気筒4（Pipe 21–26）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 21 | Bellmouth_4 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 24 | 25 |
| 22 | Runner_Upper_4 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 25 | 26 |
| 23 | EqTube_Stub_4 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 26 | 27 |
| 24 | Runner_Lower_4 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 26 | 28 |
| 25 | Port_In_4_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 28 | 29 |
| 26 | Port_In_4_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 28 | 30 |

#### 気筒5（Pipe 27–32）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 27 | Bellmouth_5 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 31 | 32 |
| 28 | Runner_Upper_5 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 32 | 33 |
| 29 | EqTube_Stub_5 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 33 | 34 |
| 30 | Runner_Lower_5 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 33 | 35 |
| 31 | Port_In_5_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 35 | 36 |
| 32 | Port_In_5_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 35 | 37 |

#### 気筒6（Pipe 33–38）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 33 | Bellmouth_6 | 150 | 70.0 | 52.0 | 313 | 0.015 | 10 | 38 | 39 |
| 34 | Runner_Upper_6 | 15 | 52.0 | 52.0 | 313 | 0.050 | 8 | 39 | 40 |
| 35 | EqTube_Stub_6 | 75 | 10.0 | 10.0 | 313 | 0.020 | 25 | 40 | 41 |
| 36 | Runner_Lower_6 | 25 | 52.0 | 52.0 | 313 | 0.050 | 10 | 40 | 42 |
| 37 | Port_In_6_1 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 42 | 43 |
| 38 | Port_In_6_2 | 105 | 52.0 | 35.0 | 400 | 0.050 | 10 | 42 | 44 |

---

## 3. 排気系トポロジー（Type 12 プレナムレス設計 + フル3段構成）

### 排気フロー順序（1気筒あたり → 下流共通）

```
[Exhaust Valve 1] (vid=12+i*2+1) ──→ P39/42/45/48/51/54: Port_Ex_{1-6}_1 (φ30.5→φ48, 90mm) ──┐
                                                                                               v
[Exhaust Valve 2] (vid=12+i*2+2) ──→ P40/43/46/49/52/55: Port_Ex_{1-6}_2 (φ30.5→φ48, 90mm) → [Type 12 ③]
                                                                                          |
     CID 47/50/53/56/59/62: Port Merge                                                   |
                                                                                          v
                           P41/44/47/50/53/56: Header_{1-6} (φ48→φ68, 300mm)
                                                    |
                                                    v
                           CID 45: [Type 12 Collector Bank1] (Header 1-3 + Col_Out_L)
                           CID 46: [Type 12 Collector Bank2] (Header 4-6 + Col_Out_R)

=== 下流共通（左右対称） ===

[Type 12 CID 45] → P57: Col_Out_L       [Type 12 CID 46] → P58: Col_Out_R
                     |                                         |
    (Type 6)         v                          (Type 6)       v
                   P59: Sec1_1_L                             P60: Sec1_1_R
                     |                                         |
                   P61: FrontCat_L                           P62: FrontCat_R
                     |                                         |
                   P63: Sec1_2_L                             P64: Sec1_2_R
                     |                                         |
                   P65: Sec2_1_L                             P66: Sec2_1_R
                     |                                         |
    (Type 11)        v                          (Type 11)      v
              [H_Junc_L] Plenum 4                       [H_Junc_R] Plenum 5
                   |                                         |
                   ├→ P67: Sec2_H_L                         ├→ P68: Sec2_H_R
                   |                                         |
                   └→ P69: Sec2_H_Cross ──→ [H_Junc_R] ←───┘
                   |                                         |
    (Type 6)       v                                         v
                 P70: Sec2_2_L                             P71: Sec2_2_R
                   |                                         |
                 P72: Muf_Adapter_L                        P73: Muf_Adapter_R
                   |                                         |
    (Type 11)      v                                         v
              [Muffler_Dual] Plenum 6 (30L, 共通)
                   |                     |
                 P74: Tail_1           P75: Tail_2
                   |                     |
              [Ambient_Exhaust] Plenum 7 (共通)
```

### 排気系パイプ一覧（全37本）

#### 気筒1 排気（Pipe 39–41）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 39 | Port_Ex_1_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 48 | 47 |
| 40 | Port_Ex_1_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 49 | 47 |
| 41 | Header_1 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 47 | 45 |

#### 気筒2 排気（Pipe 42–44）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 42 | Port_Ex_2_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 51 | 50 |
| 43 | Port_Ex_2_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 52 | 50 |
| 44 | Header_2 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 50 | 45 |

#### 気筒3 排気（Pipe 45–47）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 45 | Port_Ex_3_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 54 | 53 |
| 46 | Port_Ex_3_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 55 | 53 |
| 47 | Header_3 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 53 | 45 |

#### 気筒4 排気（Pipe 48–50）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 48 | Port_Ex_4_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 57 | 56 |
| 49 | Port_Ex_4_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 58 | 56 |
| 50 | Header_4 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 56 | 46 |

#### 気筒5 排気（Pipe 51–53）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 51 | Port_Ex_5_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 60 | 59 |
| 52 | Port_Ex_5_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 61 | 59 |
| 53 | Header_5 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 59 | 46 |

#### 気筒6 排気（Pipe 54–56）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|
| 54 | Port_Ex_6_1 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 63 | 62 |
| 55 | Port_Ex_6_2 | 90 | 30.5 | 48.0 | 600 | 0.050 | 10 | 64 | 62 |
| 56 | Header_6 | 300 | 48.0 | 68.0 | 800 | 0.020 | 35 | 62 | 46 |

#### 排気下流共通パイプ（Pipe 57–75, 19本）

| Pipe ID | ラベル | 長さ(mm) | 入口径(mm) | 出口径(mm) | T(K) | 摩擦 | dx(mm) | 左CID | 右CID | 備考 |
|--------:|--------|--------:|----------:|----------:|-----:|-----:|------:|------:|------:|------|
| 57 | Col_Out_L | 500 | 68.0 | 68.0 | 700 | 0.010 | 50 | 45 | 65 | Type12→Type6 |
| 58 | Col_Out_R | 500 | 68.0 | 68.0 | 700 | 0.010 | 50 | 46 | 66 | Type12→Type6 |
| 59 | Sec1_1_L | 600 | 68.0 | 68.0 | 380 | 0.010 | 50 | 65 | 67 | Type6 |
| 60 | Sec1_1_R | 600 | 68.0 | 68.0 | 380 | 0.010 | 50 | 66 | 68 | Type6 |
| 61 | FrontCat_L | 200 | 120.0 | 120.0 | 600 | 0.030 | 50 | 67 | 69 | Type6 |
| 62 | FrontCat_R | 200 | 120.0 | 120.0 | 600 | 0.030 | 50 | 68 | 70 | Type6 |
| 63 | Sec1_2_L | 400 | 68.0 | 68.0 | 370 | 0.010 | 50 | 69 | 71 | Type6 |
| 64 | Sec1_2_R | 400 | 68.0 | 68.0 | 370 | 0.010 | 50 | 70 | 72 | Type6 |
| 65 | Sec2_1_L | 400 | 68.0 | 68.0 | 360 | 0.010 | 50 | 71 | 73 | Type6→Type11(H_Junc) |
| 66 | Sec2_1_R | 400 | 68.0 | 68.0 | 360 | 0.010 | 50 | 72 | 74 | Type6→Type11(H_Junc) |
| 67 | Sec2_H_L | 200 | 68.0 | 68.0 | 360 | 0.010 | 50 | 75 | 79 | Type11→Type6 |
| 68 | Sec2_H_R | 200 | 68.0 | 68.0 | 360 | 0.010 | 50 | 76 | 80 | Type11→Type6 |
| 69 | Sec2_H_Cross | 150 | 68.0 | 68.0 | 360 | 0.010 | 50 | 77 | 78 | H_Junc_L→H_Junc_R |
| 70 | Sec2_2_L | 800 | 68.0 | 68.0 | 350 | 0.010 | 50 | 79 | 81 | Type6 |
| 71 | Sec2_2_R | 800 | 68.0 | 68.0 | 350 | 0.010 | 50 | 80 | 82 | Type6 |
| 72 | Muf_Adapter_L | 150 | 68.0 | 68.0 | 350 | 0.100 | 50 | 81 | 83 | Type6→Type11(Muffler) |
| 73 | Muf_Adapter_R | 150 | 68.0 | 68.0 | 350 | 0.100 | 50 | 82 | 84 | Type6→Type11(Muffler) |
| 74 | Tail_1 | 150 | 68.0 | 68.0 | 350 | 0.010 | 50 | 85 | 86 | Type11(Muffler)→Type11(Ambient) |
| 75 | Tail_2 | 150 | 68.0 | 68.0 | 350 | 0.010 | 50 | 87 | 88 | Type11(Muffler)→Type11(Ambient) |

---

## 4. プレナム一覧（全7個）

| Plenum ID | ラベル | 物理容量(cc) | 実容量(cc) | T(K) | 役割 |
|----------:|--------|----------:|--------:|-----:|------|
| 1 | Ambient_Intake | ∞ | ∞ | 300 | 吸気大気開放端 |
| 2 | Plenum_Main | 10,500 | 10,500 | 313 | エアボックス（6気筒共有） |
| 3 | Equalization_Tube | 141 | 141 | 313 | 等圧管 φ20×450mm相当（6本EqTube_Stub接続） |
| 4 | H_Junc_L | 2 | 50※ | 360 | Hパイプ接続点（左バンク） |
| 5 | H_Junc_R | 2 | 50※ | 360 | Hパイプ接続点（右バンク） |
| 6 | Muffler_Dual | 30,000 | 30,000 | 400 | マフラー（L/R共通） |
| 7 | Ambient_Exhaust | ∞ | ∞ | 300 | 排気大気開放端 |

※ H_Juncはmin_plenum_volクランプ適用 (`vol = max(vol, min_plenum_vol)`)

---

## 5. コネクション一覧（全89個）

### Type 12: Branch Junction（20個）

| CID | 接続パイプ | 役割 |
|----:|----------|------|
| 5 | P4:Runner_Upper_1(R), P5:EqTube_Stub_1(L), P6:Runner_Lower_1(L) | 等圧管分岐 ① Cyl1 |
| 7 | P6:Runner_Lower_1(R), P7:Port_In_1_1(L), P8:Port_In_1_2(L) | ポート分岐 ② Cyl1 |
| 12 | P10:Runner_Upper_2(R), P11:EqTube_Stub_2(L), P12:Runner_Lower_2(L) | 等圧管分岐 ① Cyl2 |
| 14 | P12:Runner_Lower_2(R), P13:Port_In_2_1(L), P14:Port_In_2_2(L) | ポート分岐 ② Cyl2 |
| 19 | P16:Runner_Upper_3(R), P17:EqTube_Stub_3(L), P18:Runner_Lower_3(L) | 等圧管分岐 ① Cyl3 |
| 21 | P18:Runner_Lower_3(R), P19:Port_In_3_1(L), P20:Port_In_3_2(L) | ポート分岐 ② Cyl3 |
| 26 | P22:Runner_Upper_4(R), P23:EqTube_Stub_4(L), P24:Runner_Lower_4(L) | 等圧管分岐 ① Cyl4 |
| 28 | P24:Runner_Lower_4(R), P25:Port_In_4_1(L), P26:Port_In_4_2(L) | ポート分岐 ② Cyl4 |
| 33 | P28:Runner_Upper_5(R), P29:EqTube_Stub_5(L), P30:Runner_Lower_5(L) | 等圧管分岐 ① Cyl5 |
| 35 | P30:Runner_Lower_5(R), P31:Port_In_5_1(L), P32:Port_In_5_2(L) | ポート分岐 ② Cyl5 |
| 40 | P34:Runner_Upper_6(R), P35:EqTube_Stub_6(L), P36:Runner_Lower_6(L) | 等圧管分岐 ① Cyl6 |
| 42 | P36:Runner_Lower_6(R), P37:Port_In_6_1(L), P38:Port_In_6_2(L) | ポート分岐 ② Cyl6 |
| 47 | P39:Port_Ex_1_1(R), P40:Port_Ex_1_2(R), P41:Header_1(L) | 排気ポートマージ ③ Cyl1 |
| 50 | P42:Port_Ex_2_1(R), P43:Port_Ex_2_2(R), P44:Header_2(L) | 排気ポートマージ ③ Cyl2 |
| 53 | P45:Port_Ex_3_1(R), P46:Port_Ex_3_2(R), P47:Header_3(L) | 排気ポートマージ ③ Cyl3 |
| 56 | P48:Port_Ex_4_1(R), P49:Port_Ex_4_2(R), P50:Header_4(L) | 排気ポートマージ ③ Cyl4 |
| 59 | P51:Port_Ex_5_1(R), P52:Port_Ex_5_2(R), P53:Header_5(L) | 排気ポートマージ ③ Cyl5 |
| 62 | P54:Port_Ex_6_1(R), P55:Port_Ex_6_2(R), P56:Header_6(L) | 排気ポートマージ ③ Cyl6 |
| 45 | P41:Header_1(R), P44:Header_2(R), P47:Header_3(R), P57:Col_Out_L(L) | Collector Bank1 (3→1) |
| 46 | P50:Header_4(R), P53:Header_5(R), P56:Header_6(R), P58:Col_Out_R(L) | Collector Bank2 (3→1) |

### Type 10: Throttle（6個）— ITB

| CID | 接続 | Valve ID |
|----:|------|--------:|
| 4 | Bellmouth_1(R) ↔ Runner_Upper_1(L) | 26 |
| 11 | Bellmouth_2(R) ↔ Runner_Upper_2(L) | 27 |
| 18 | Bellmouth_3(R) ↔ Runner_Upper_3(L) | 28 |
| 25 | Bellmouth_4(R) ↔ Runner_Upper_4(L) | 29 |
| 32 | Bellmouth_5(R) ↔ Runner_Upper_5(L) | 30 |
| 39 | Bellmouth_6(R) ↔ Runner_Upper_6(L) | 31 |

### Type 7/8: Valve Connections（24個）

| CID範囲 | Type | 接続 |
|---------|-----:|------|
| 8,9,15,16,22,23,29,30,36,37,43,44 | 7 | 吸気バルブ（Port_In 右端 → Cylinder） |
| 48,49,51,52,54,55,57,58,60,61,63,64 | 8 | 排気バルブ（Cylinder → Port_Ex 左端） |

### Type 6: Pipe-to-Pipe（12個）

| CID | 接続 |
|----:|------|
| 1 | CSL_Intake_Pipe(R) ↔ CSL_Panel_Filter(L) |
| 65 | Col_Out_L(R) ↔ Sec1_1_L(L) |
| 66 | Col_Out_R(R) ↔ Sec1_1_R(L) |
| 67 | Sec1_1_L(R) ↔ FrontCat_L(L) |
| 68 | Sec1_1_R(R) ↔ FrontCat_R(L) |
| 69 | FrontCat_L(R) ↔ Sec1_2_L(L) |
| 70 | FrontCat_R(R) ↔ Sec1_2_R(L) |
| 71 | Sec1_2_L(R) ↔ Sec2_1_L(L) |
| 72 | Sec1_2_R(R) ↔ Sec2_1_R(L) |
| 79 | Sec2_H_L(R) ↔ Sec2_2_L(L) |
| 80 | Sec2_H_R(R) ↔ Sec2_2_R(L) |
| 81 | Sec2_2_L(R) ↔ Muf_Adapter_L(L) |
| 82 | Sec2_2_R(R) ↔ Muf_Adapter_R(L) |

### Type 11: Plenum-Pipe（27個）

| CID | 接続 | プレナム |
|----:|------|---------|
| 0 | CSL_Intake_Pipe(L) | Plenum 1: Ambient_Intake |
| 2 | CSL_Panel_Filter(R) | Plenum 2: Plenum_Main |
| 3,10,17,24,31,38 | Bellmouth_{1-6}(L) | Plenum 2: Plenum_Main |
| 6,13,20,27,34,41 | EqTube_Stub_{1-6}(R) | Plenum 3: Equalization_Tube |
| 73 | Sec2_1_L(R) | Plenum 4: H_Junc_L |
| 74 | Sec2_1_R(R) | Plenum 5: H_Junc_R |
| 75 | Sec2_H_L(L) | Plenum 4: H_Junc_L |
| 76 | Sec2_H_R(L) | Plenum 5: H_Junc_R |
| 77 | Sec2_H_Cross(L) | Plenum 4: H_Junc_L |
| 78 | Sec2_H_Cross(R) | Plenum 5: H_Junc_R |
| 83,84 | Muf_Adapter_{L,R}(R) | Plenum 6: Muffler_Dual |
| 85,87 | Tail_{1,2}(L) | Plenum 6: Muffler_Dual |
| 86,88 | Tail_{1,2}(R) | Plenum 7: Ambient_Exhaust |

---

## 6. バルブ・マッピング

### 吸気バルブ（12個）

| Valve ID | 気筒 | 接続パイプ | CID |
|---------:|-----:|----------|----:|
| 1 | 1 | Port_In_1_1 (P7) 右端 | 8 |
| 2 | 1 | Port_In_1_2 (P8) 右端 | 9 |
| 3 | 2 | Port_In_2_1 (P13) 右端 | 15 |
| 4 | 2 | Port_In_2_2 (P14) 右端 | 16 |
| 5 | 3 | Port_In_3_1 (P19) 右端 | 22 |
| 6 | 3 | Port_In_3_2 (P20) 右端 | 23 |
| 7 | 4 | Port_In_4_1 (P25) 右端 | 29 |
| 8 | 4 | Port_In_4_2 (P26) 右端 | 30 |
| 9 | 5 | Port_In_5_1 (P31) 右端 | 36 |
| 10 | 5 | Port_In_5_2 (P32) 右端 | 37 |
| 11 | 6 | Port_In_6_1 (P37) 右端 | 43 |
| 12 | 6 | Port_In_6_2 (P38) 右端 | 44 |

### 排気バルブ（12個）

| Valve ID | 気筒 | 接続パイプ | CID |
|---------:|-----:|----------|----:|
| 13 | 1 | Port_Ex_1_1 (P39) 左端 | 48 |
| 14 | 1 | Port_Ex_1_2 (P40) 左端 | 49 |
| 15 | 2 | Port_Ex_2_1 (P42) 左端 | 51 |
| 16 | 2 | Port_Ex_2_2 (P43) 左端 | 52 |
| 17 | 3 | Port_Ex_3_1 (P45) 左端 | 54 |
| 18 | 3 | Port_Ex_3_2 (P46) 左端 | 55 |
| 19 | 4 | Port_Ex_4_1 (P48) 左端 | 57 |
| 20 | 4 | Port_Ex_4_2 (P49) 左端 | 58 |
| 21 | 5 | Port_Ex_5_1 (P51) 左端 | 60 |
| 22 | 5 | Port_Ex_5_2 (P52) 左端 | 61 |
| 23 | 6 | Port_Ex_6_1 (P54) 左端 | 63 |
| 24 | 6 | Port_Ex_6_2 (P55) 左端 | 64 |

### ITBスロットルバルブ（6個）

| Valve ID | 気筒 | 接続 | CID |
|---------:|-----:|------|----:|
| 26 | 1 | Bellmouth_1(R) → Runner_Upper_1(L) | 4 |
| 27 | 2 | Bellmouth_2(R) → Runner_Upper_2(L) | 11 |
| 28 | 3 | Bellmouth_3(R) → Runner_Upper_3(L) | 18 |
| 29 | 4 | Bellmouth_4(R) → Runner_Upper_4(L) | 25 |
| 30 | 5 | Bellmouth_5(R) → Runner_Upper_5(L) | 32 |
| 31 | 6 | Bellmouth_6(R) → Runner_Upper_6(L) | 39 |

---

## 7. S54 CSL 実車スペック対応表

| パラメータ | モデル値 | 備考 |
|----------|-------:|------|
| 排気量 | 3,246cc | ボア87mm × ストローク91mm |
| ベルマウス | φ70→φ52, 150mm | 実車ファンネル相当 |
| ITB/ランナー径 | φ52 | Runner_Upper 15mm + Runner_Lower 25mm |
| 吸気ポート | φ52→φ35, 105mm | テーパー（ランナー→バルブシート） |
| 吸気バルブ径 | φ35mm | S54 CSL |
| 吸気カム | 268° / リフト11.8mm | **CSL固有**（標準S54は260°）。吸気寄りの非対称カム |
| 排気カム | 264° / リフト11.2mm | **CSL固有**（標準S54は260°） |
| 排気バルブ径 | φ30.5mm | S54 CSL 実測値 |
| 排気ポート | φ30.5→φ48, 90mm | テーパー（バルブシート→ヘッダー） |
| VANOSオフセット（吸気） | −2° KW | MSS54 `K_EVAN1_OFFSET`（DME表記"W"=Winkel=°KW） |
| VANOSオフセット（排気） | +1° KW | MSS54 `K_AVAN1_OFFSET`。機械的VANOS基準トリム |
| ヘッダー | φ48→φ68, 300mm, 800K | 3-into-1 ×2 |
| Col_Out | φ68, 500mm, 700K | コレクター出口 |
| 排気配管 | φ68 | Sec1〜Tail全セクション |
| 触媒 | φ120, 200mm | FrontCat（摩擦0.030） |
| 等圧管 | 141cc | φ20相当（Stub: φ10, 75mm ×6本） |
| マフラー | 30L | デュアル構造、共通プレナム |

### カムタイミング / VANOS の取り扱い

- **デュレーション**: コサインリフトの幾何学的開角窓として扱う。CSL実機の
  268°(吸気)/264°(排気) を採用（従来は標準S54の260°/260°だった）。
  IVC = IVO + デュレーション のため、吸気デュレーション増（260→268）は
  IVC を 8° 遅らせる。IVO基準（`OPENWAM_IVO`, 既定360°=ガス交換TDC）の較正は
  この CSL デュレーションを前提に再スイープすること。
- **VANOSオフセット**: `K_EVAN1_OFFSET`/`K_AVAN1_OFFSET` は機械的なVANOS
  ゼロ基準トリム。実効カム位相 =（`kf_evan1_soll`/`kf_avan1_soll` マップ目標）
  ± オフセット。`WAMGenerator._add_valve_def` で `vanos_bias` と同符号
  （正=進角）で `open_angle` に加算され、静的・制御どちらのモードでも適用される。
  - **符号は暫定モデル仮定**: DME内部の符号定義は一次情報で未確定のため、
    マップ進角と同符号（正=進角）として実装。検証で逆と判明すれば
    `vanos_*_offset` の符号を反転するだけで対応可能。

---

## 8. 設計変更履歴

### 2026-05-30: 吸気温度の単位バグ修正（K→℃）

**変更内容:**

- OpenWAMはパイプ壁温・外気温を**摂氏**で読む（`degCToK()`）が、ジェネレータが
  吸気側を**ケルビン**で書いていた単位取り違えを修正。
  - 外気温: `298`（=298℃=571K）→ `ambient_temp - 273.15`（=24.85℃≈298K）
  - 吸気壁温: スノーケル/フィルタ `300→27`、ベルマウス/ランナー `313→40`、
    ポート `400→127`（すべて℃）
- 排気管（700/800℃）・エンジンブロック（"60"℃）は元から正しい摂氏のため不変。
- 効果: 収束VE **50%→~57%**（HLLC, 4000 RPM）。本物の物理修正だが支配因ではない。
- 診断: 残差の主因は**排気スカベンジング不良→オーバーラップ逆流→高温チャージ**と
  判明（`OPENWAM_VLVWIN`）。詳細は `EXHAUST_STABILIZATION_NOTES.md` Stage 15。

### 2026-05-30: CSLカム実機スペック + VANOS基準オフセット

**変更内容:**

- 吸気カムデュレーション: 260° → **268°**（CSL固有。標準S54は260°）
- 排気カムデュレーション: 260° → **264°**（CSL固有。標準S54は260°）
  - CSLは吸気寄りの非対称カム（268/264）を採用しており、従来モデルは
    標準S54の対称260/260だった。
- VANOS機械基準オフセットを `EngineConfig` に追加:
  - `vanos_intake_offset = -2.0`（MSS54 `K_EVAN1_OFFSET`, °KW）
  - `vanos_exhaust_offset = +1.0`（MSS54 `K_AVAN1_OFFSET`, °KW）
  - `WAMGenerator._add_valve_def` で `open_angle` に反映（`vanos_bias` と
    同符号、静的・制御両モード）。実効カム位相 = マップ目標 ± オフセット。
- 値の出典: アップロード済み MSS54 バイナリの読取値。CSLカムの 268/264 と
  オフセット −2/+1 は MSS54 DME の CSL 設定として複数の一次情報と一致。

**IVO/IVC再較正（`scripts/ivo_sweep.py`、クリーン5RPM×5IVO実行）:**
吸気デュレーション増（260→268）でIVCが遅角するためIVOベースを再スイープ。
各RPMでIVCに対し明確な逆U字。旧 IVO360（IVC90°）は全RPMで最悪（平均VE67%）。
最良の単一静的中心は **knob 330（IVC≈60° ABDC、平均VE84%、最悪値62%）** で、
デフォルト `base_open_intake` を **360→330** に変更（`OPENWAM_IVO`で可変）。

| IVOノブ | IVC° | 平均VE | 各RPM[3k,4k,5k,6k,7k] |
|---|---|---|---|
| 320 | 50 | 81% | 39,85,92,93,98 |
| **330** | **60** | **84%** | 62,96,85,91,88 |
| 340 | 70 | 82% | 71,90,80,84,85 |
| 350 | 80 | 75% | 67,76,76,75,80 |
| 360 | 90 | 67% | 62,63,66,69,75（旧デフォルト） |

**留保:** これは初サイクル中央値VE。各RPM最適点でも 71-98%（stock 95-109%）で
**乖離が残る**（低回転 −24%、高回転 −7〜16%）。IVCは大レバーだが、Stage 12 の
誘導負圧不足は未解決でこれが残差の主因。各RPM最適は高回転ほど早閉じ
（3000:70°→7000:50°）で、RPM依存スケジューリングはVANOSマップ（`kf_evan1_soll`）
が担う。詳細・訂正経緯は `EXHAUST_STABILIZATION_NOTES.md` Stage 14。

### 2026-02-11: Type 12 プレナムレス設計

**旧** → **新**:

- パイプ: 87本 → 75本（ポート統合 + バルブポケット除去で12本削減）
- プレナム: 48個 → 7個（41個の数値緩衝プレナム除去）
- Type 12: 2個 → 20個（等圧管分岐6 + ポート分岐6 + 排気マージ6 + コレクター2）

**除去コンポーネント:**

- ITB_Junction ×6（Type 10 スロットル直結に変更）
- Split_Plenum ×6（Type 12② に置換）
- ValvePocket_In ×12（ポート1本化で不要）
- ValvePocket_Ex ×12（ポート1本化で不要）
- Port_Junct ×6（Type 12③ に置換）
- Merge Plenum ×6（Type 12③ に置換）

**径変更:**

- ベルマウス: φ60→φ50 → φ70→φ52
- ランナー: φ50→φ35 → φ52（等径）
- 吸気ポート: φ35 → φ52（等径）
- 排気ポート: φ30 → φ48（等径）
- ヘッダー: φ40→φ60 → φ48→φ68
- 排気全セクション: φ55-60 → φ68

### 2026-02-11: ポートテーパー + 排気バルブ径修正

**変更内容:**

- 吸気ポート: φ52→φ52（等径）→ **φ52→φ35**（テーパー、バルブシート径）
- 排気ポート: φ48→φ48（等径）→ **φ30.5→φ48**（テーパー、バルブ～ヘッダー径）
- 排気バルブ径: 35.0mm → **30.5mm**（S54 CSL 実測値）
- 排気壁温修正: ポート600K, ヘッダー800K, コレクター700K

**NaN修正（C++ 8-fix plan）:**

- γ relaxation no-op → clamped step-limited (TTubo.cpp)
- Junction convergence MAX_ITER + entropy guards (TCCRamificacion.cpp)
- ReduceSubsonicFlow Mach floor guard (Globales.h)
- Species NaN recovery + clamping (TTubo.cpp)
- Entropy guard (TCCUnionEntreTubos.cpp)

**新規コンポーネント:**

- Runner_Upper / Runner_Lower（ランナー2分割）
- EqTube_Stub ×6（等圧管スタブ φ10）
- Equalization_Tube プレナム（141cc）

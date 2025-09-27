# BMW E46 M3 VANOSシミュレータ 実装ガイド

## 概要

BMW E46 M3 VANOSシミュレータの実装における重要なポイント、計算手順、およびデバッグ方法をまとめた実装ガイドです。

## 1. 実装アーキテクチャ

### 1.1 クラス構造

```
BMWE46M3Simulator
├── EngineBlock
│   ├── Cylinder (components.py)
│   ├── Valve (Intake/Exhaust)
│   └── VANOS Configuration
├── Configuration (bmw_e46_m3_config.py)
│   ├── Engine Specifications
│   ├── VANOS Tables
│   └── Valve Profiles
└── Thermodynamics (thermo.py)
    └── Air Properties
```

### 1.2 データフロー

```
1. RPM/TPS入力
2. VANOS角度補間 (bmw_e46_m3_config.py)
3. バルブタイミング計算 (components.py)
4. オーバーラップ計算 (bmw_e46_m3_simulator.py)
5. 体積効率計算 (components.py)
6. 充填空気量計算 (components.py)
7. 結果出力
```

## 2. 重要な実装ポイント

### 2.1 VANOS角度の補間

```python
# bmw_e46_m3_config.py
def interpolate_vanos_angle(rpm, tps, vanos_config):
    """
    DME制御VANOSテーブルから2次元線形補間で角度を取得
    
    重要ポイント:
    1. RPMとTPSの両軸で補間
    2. 範囲外の値は最近傍値でクランプ
    3. インテーク/エキゾーストで異なるテーブル使用
    """
    rpm_points = np.array(vanos_config['rpm_points'])
    tps_points = np.array(vanos_config['tps_points'])
    angle_map = np.array(vanos_config['angle_map'])
    
    # 範囲チェックとクランプ
    rpm_clamped = np.clip(rpm, rpm_points[0], rpm_points[-1])
    tps_clamped = np.clip(tps, tps_points[0], tps_points[-1])
    
    # 2次元線形補間
    f = RegularGridInterpolator((rpm_points, tps_points), angle_map, 
                               method='linear', bounds_error=False, fill_value=None)
    
    return float(f([rpm_clamped, tps_clamped]))
```

### 2.2 バルブタイミング計算

```python
# components.py - Cylinder class
def get_effective_valve_timing(self, valve_type):
    """
    VANOS角度を考慮した有効バルブタイミング
    
    重要ポイント:
    1. VANOS角度 = バルブ最大リフト角度
    2. 開度期間260°を中心に±130°
    3. インテーク: ATDC基準、エキゾースト: ABDC基準
    """
    valve_duration = 260.0  # BMW S54仕様
    
    if valve_type == 'intake':
        # インテークVANOS角度はATDC（上死点後）
        valve_max_lift_angle_atdc = self.current_intake_vanos
        opening_angle = valve_max_lift_angle_atdc - valve_duration/2
        closing_angle = valve_max_lift_angle_atdc + valve_duration/2
    else:
        # エキゾーストVANOS角度はABDC（下死点後）
        valve_max_lift_angle_abdc = self.current_exhaust_vanos
        opening_angle = valve_max_lift_angle_abdc - valve_duration/2
        closing_angle = valve_max_lift_angle_abdc + valve_duration/2
    
    return opening_angle, closing_angle
```

### 2.3 オーバーラップ計算（参考スクリプト準拠）

```python
# bmw_e46_m3_simulator.py
def calculate_valve_overlap(self, intake_opening, intake_closing, exhaust_opening, exhaust_closing):
    """
    参考JavaScriptスクリプトと同じ方式でオーバーラップを計算
    
    重要ポイント:
    1. -360°～360°の角度範囲を使用
    2. sin関数でリフトカーブを計算
    3. 両バルブが0.1mm以上開いている角度を検出
    4. 方向調整: インテーク正、エキゾースト負
    """
    def calculate_valve_lift_curve(max_lift, duration, max_lift_angle, crank_angles, direction):
        start_angle = max_lift_angle - duration / 2
        lift_values = []
        
        for angle in crank_angles:
            # 参考スクリプトと同じ方向調整
            adjusted_angle = angle if direction == 'intake' else -angle
            
            if start_angle <= adjusted_angle <= start_angle + duration:
                lift = max_lift * math.sin(math.pi * (adjusted_angle - start_angle) / duration)
                lift_values.append(lift)
            else:
                lift_values.append(0.0)
        
        return lift_values
    
    # -360°～360°の角度範囲（参考スクリプトと同じ）
    crank_angles = list(range(-360, 361))
    max_lift = 11.8  # BMW S54仕様
    duration = 260.0
    
    # リフトカーブを計算
    intake_lift = calculate_valve_lift_curve(max_lift, duration, 
                                           self.cylinder.current_intake_vanos, 
                                           crank_angles, 'intake')
    exhaust_lift = calculate_valve_lift_curve(max_lift, duration, 
                                            self.cylinder.current_exhaust_vanos, 
                                            crank_angles, 'exhaust')
    
    # オーバーラップ検出
    overlap_angles = []
    for i, angle in enumerate(crank_angles):
        if intake_lift[i] > 0.1 and exhaust_lift[i] > 0.1:
            overlap_angles.append(angle)
    
    return {
        'duration': len(overlap_angles),
        'start_angle': overlap_angles[0] if overlap_angles else 0,
        'end_angle': overlap_angles[-1] if overlap_angles else 0
    }
```

### 2.4 体積効率計算

```python
# components.py - Cylinder class
def calculate_volumetric_efficiency(self, crank_angle_deg, rpm=3000):
    """
    RPMとVANOS角度を考慮した体積効率計算
    
    重要ポイント:
    1. RPM依存の基本カーブ
    2. VANOS角度による補正係数
    3. オーバーラップ効果
    4. 現実的な範囲制限（0.60-0.98）
    """
    # RPMベースの基本体積効率
    base_ve = self.rpm_ve_curve(rpm)
    
    # VANOS補正係数
    intake_factor = self.intake_correction_factor(rpm, self.current_intake_vanos)
    exhaust_factor = self.exhaust_correction_factor(rpm, self.current_exhaust_vanos)
    overlap_factor = self.overlap_correction_factor(rpm, actual_overlap)
    
    # 最終体積効率
    ve = base_ve * intake_factor * exhaust_factor * overlap_factor
    
    # 現実的な範囲に制限
    return max(0.60, min(0.98, ve))
```

## 3. デバッグ方法

### 3.1 VANOS角度の確認

```python
# debug_vanos_angles.py
def debug_vanos_angles():
    config = get_bmw_e46_m3_config()
    
    test_points = [
        (600, 15.0),   # アイドル
        (3000, 50.0),  # 中回転
        (6000, 85.0),  # 高回転
    ]
    
    for rpm, tps in test_points:
        intake_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
        exhaust_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
        
        print(f'RPM {rpm}, TPS {tps}%:')
        print(f'  Intake VANOS: {intake_vanos:.1f}° ATDC')
        print(f'  Exhaust VANOS: {exhaust_vanos:.1f}° ABDC')
        
        # DME制御範囲チェック
        if not (70 <= intake_vanos <= 130):
            print(f'  ⚠️  Intake VANOS out of range!')
        if not (52 <= exhaust_vanos <= 97):
            print(f'  ⚠️  Exhaust VANOS out of range!')
```

### 3.2 オーバーラップ計算の検証

```python
# debug_overlap_calculation.py
def debug_overlap_calculation():
    simulator = BMWE46M3Simulator()
    
    # テストケース
    test_cases = [
        {'intake': 90, 'exhaust': 75, 'expected_overlap': '30-40°'},
        {'intake': 110, 'exhaust': 85, 'expected_overlap': '10-20°'},
        {'intake': 130, 'exhaust': 97, 'expected_overlap': '0-10°'},
    ]
    
    for case in test_cases:
        simulator.cylinder.current_intake_vanos = case['intake']
        simulator.cylinder.current_exhaust_vanos = case['exhaust']
        
        # オーバーラップ計算
        intake_opening, intake_closing = simulator.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = simulator.cylinder.get_effective_valve_timing('exhaust')
        overlap_details = simulator.calculate_valve_overlap(intake_opening, intake_closing, 
                                                          exhaust_opening, exhaust_closing)
        
        print(f'VANOS: I{case["intake"]}°/E{case["exhaust"]}° → Overlap: {overlap_details["duration"]}°')
        print(f'  Expected: {case["expected_overlap"]}')
        
        # 妥当性チェック
        if not (0 <= overlap_details['duration'] <= 50):
            print(f'  ⚠️  Overlap duration seems unrealistic!')
```

### 3.3 体積効率の妥当性確認

```python
# debug_volumetric_efficiency.py
def debug_volumetric_efficiency():
    simulator = BMWE46M3Simulator()
    
    rpm_range = range(1000, 8001, 500)
    
    print('RPM vs Volumetric Efficiency:')
    for rpm in rpm_range:
        # 標準VANOS設定
        tps = 50.0
        config = get_bmw_e46_m3_config()
        intake_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['intake'])
        exhaust_vanos = interpolate_vanos_angle(rpm, tps, config['vanos']['exhaust'])
        
        simulator.cylinder.current_intake_vanos = intake_vanos
        simulator.cylinder.current_exhaust_vanos = exhaust_vanos
        
        ve = simulator.cylinder.calculate_volumetric_efficiency(0, rpm)
        
        print(f'  {rpm:4d} RPM: VE = {ve:.3f}')
        
        # 妥当性チェック
        if not (0.60 <= ve <= 0.98):
            print(f'    ⚠️  VE out of realistic range!')
        
        # RPM変化に対する応答性チェック
        if rpm > 1000:
            prev_ve = simulator.cylinder.calculate_volumetric_efficiency(0, rpm - 500)
            ve_change = abs(ve - prev_ve)
            if ve_change > 0.1:  # 500RPMで10%以上変化は異常
                print(f'    ⚠️  Large VE change: {ve_change:.3f}')
```

## 4. パフォーマンス最適化

### 4.1 計算の効率化

```python
# 事前計算可能な値をキャッシュ
class OptimizedCylinder(Cylinder):
    def __init__(self, config, engine_block):
        super().__init__(config, engine_block)
        
        # RPMベース体積効率をLUTで事前計算
        self._ve_lut = {}
        for rpm in range(500, 8501, 100):
            self._ve_lut[rpm] = self.rpm_ve_curve(rpm)
    
    def get_base_ve_fast(self, rpm):
        """LUTを使用した高速VE取得"""
        rpm_key = round(rpm / 100) * 100
        rpm_key = max(500, min(8500, rpm_key))
        return self._ve_lut[rpm_key]
```

### 4.2 メモリ使用量の最適化

```python
# 大きな配列の使用を避ける
def calculate_overlap_optimized(self, intake_vanos, exhaust_vanos):
    """
    メモリ効率的なオーバーラップ計算
    全角度配列を作らず、必要な範囲のみ計算
    """
    max_lift = 11.8
    duration = 260.0
    
    # 理論的なオーバーラップ範囲を事前計算
    intake_start = intake_vanos - duration/2
    intake_end = intake_vanos + duration/2
    exhaust_start = exhaust_vanos - duration/2
    exhaust_end = exhaust_vanos + duration/2
    
    # 重複する可能性のある範囲のみ計算
    overlap_start = max(intake_start, -exhaust_end)  # エキゾーストは負方向
    overlap_end = min(intake_end, -exhaust_start)
    
    if overlap_start >= overlap_end:
        return {'duration': 0, 'start_angle': 0, 'end_angle': 0}
    
    # 重複範囲のみで詳細計算
    overlap_count = 0
    first_overlap = None
    last_overlap = None
    
    for angle in range(int(overlap_start), int(overlap_end) + 1):
        intake_lift = self.calculate_single_lift(angle, intake_vanos, 'intake')
        exhaust_lift = self.calculate_single_lift(angle, exhaust_vanos, 'exhaust')
        
        if intake_lift > 0.1 and exhaust_lift > 0.1:
            if first_overlap is None:
                first_overlap = angle
            last_overlap = angle
            overlap_count += 1
    
    return {
        'duration': overlap_count,
        'start_angle': first_overlap or 0,
        'end_angle': last_overlap or 0
    }
```

## 5. テスト戦略

### 5.1 単体テスト

```python
# test_vanos_calculations.py
import unittest

class TestVANOSCalculations(unittest.TestCase):
    
    def setUp(self):
        self.simulator = BMWE46M3Simulator()
    
    def test_vanos_interpolation(self):
        """VANOS角度補間のテスト"""
        config = get_bmw_e46_m3_config()
        
        # 既知の点での値確認
        angle = interpolate_vanos_angle(3000, 50, config['vanos']['intake'])
        self.assertGreaterEqual(angle, 70)
        self.assertLessEqual(angle, 130)
    
    def test_valve_timing_calculation(self):
        """バルブタイミング計算のテスト"""
        self.simulator.cylinder.current_intake_vanos = 100
        opening, closing = self.simulator.cylinder.get_effective_valve_timing('intake')
        
        # 開度期間が260°であることを確認
        duration = closing - opening
        self.assertAlmostEqual(duration, 260, delta=1)
    
    def test_overlap_calculation(self):
        """オーバーラップ計算のテスト"""
        self.simulator.cylinder.current_intake_vanos = 100
        self.simulator.cylinder.current_exhaust_vanos = 80
        
        intake_opening, intake_closing = self.simulator.cylinder.get_effective_valve_timing('intake')
        exhaust_opening, exhaust_closing = self.simulator.cylinder.get_effective_valve_timing('exhaust')
        overlap = self.simulator.calculate_valve_overlap(intake_opening, intake_closing, 
                                                       exhaust_opening, exhaust_closing)
        
        # オーバーラップが現実的な範囲内であることを確認
        self.assertGreaterEqual(overlap['duration'], 0)
        self.assertLessEqual(overlap['duration'], 50)
    
    def test_volumetric_efficiency_range(self):
        """体積効率の範囲テスト"""
        for rpm in [1000, 3000, 6000, 8000]:
            ve = self.simulator.cylinder.calculate_volumetric_efficiency(0, rpm)
            self.assertGreaterEqual(ve, 0.60)
            self.assertLessEqual(ve, 0.98)
```

### 5.2 統合テスト

```python
# test_integration.py
def test_full_simulation():
    """フルシミュレーションの統合テスト"""
    simulator = BMWE46M3Simulator()
    
    # 複数の運転条件でテスト
    test_conditions = [
        {'rpm': 1500, 'load': 25},
        {'rpm': 3000, 'load': 50},
        {'rpm': 6000, 'load': 75},
    ]
    
    for condition in test_conditions:
        history = simulator.run_simulation(
            rpm=condition['rpm'], 
            load=condition['load']
        )
        
        # 結果の妥当性確認
        assert len(history['volumetric_efficiency']) > 0
        assert all(0.60 <= ve <= 0.98 for ve in history['volumetric_efficiency'])
        assert all(mass > 0 for mass in history['air_mass_trapped'])
        
        print(f"✅ Test passed for RPM {condition['rpm']}, Load {condition['load']}%")
```

## 6. トラブルシューティング

### 6.1 よくある問題と解決方法

| 問題 | 症状 | 原因 | 解決方法 |
|------|------|------|----------|
| VANOS角度が範囲外 | 70°未満または130°超過 | 補間テーブルの問題 | テーブルデータを確認、境界値処理を追加 |
| オーバーラップが0° | 常にオーバーラップなし | 角度計算の符号エラー | 方向調整ロジックを確認 |
| 体積効率が一定 | RPM変化に応答しない | RPMベースカーブの問題 | rpm_ve_curve関数を確認 |
| 充填空気量が異常 | 負の値または極端に大きい | 体積効率計算エラー | VE計算の各係数を個別確認 |

### 6.2 デバッグ用ログ出力

```python
# デバッグモード用の詳細ログ
def debug_calculation_step(self, rpm, vanos_intake, vanos_exhaust):
    """計算ステップの詳細ログ出力"""
    print(f"=== Debug Calculation Step ===")
    print(f"Input: RPM={rpm}, Intake VANOS={vanos_intake}°, Exhaust VANOS={exhaust_vanos}°")
    
    # 基本VE
    base_ve = self.rpm_ve_curve(rpm)
    print(f"Base VE: {base_ve:.3f}")
    
    # 各補正係数
    intake_factor = self.intake_correction_factor(rpm, vanos_intake)
    exhaust_factor = self.exhaust_correction_factor(rpm, vanos_exhaust)
    overlap_factor = self.overlap_correction_factor(rpm, actual_overlap)
    
    print(f"Correction factors:")
    print(f"  Intake: {intake_factor:.3f}")
    print(f"  Exhaust: {exhaust_factor:.3f}")
    print(f"  Overlap: {overlap_factor:.3f}")
    
    # 最終結果
    final_ve = base_ve * intake_factor * exhaust_factor * overlap_factor
    clamped_ve = max(0.60, min(0.98, final_ve))
    
    print(f"Final VE: {final_ve:.3f} → Clamped: {clamped_ve:.3f}")
    
    if final_ve != clamped_ve:
        print(f"⚠️  VE was clamped!")
```

---

**作成日**: 2024年
**バージョン**: 1.0
**対象**: BMW E46 M3 VANOSシミュレータ開発者
**更新履歴**: 初版作成

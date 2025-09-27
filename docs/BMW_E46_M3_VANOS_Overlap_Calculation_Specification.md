# BMW E46 M3 VANOSシミュレータ オーバーラップ計算仕様書

## 概要

BMW E46 M3（S54エンジン）のVANOSシステムにおけるバルブオーバーラップ計算の詳細仕様です。参考JavaScriptスクリプトに基づく正確な計算方式を実装しています。

## VANOSテーブルデータについて

現在使用しているVANOSテーブルの値は、**DME（Digital Motor Electronics）パラメータに設定されているVANOS角度**です。これらの値は：

- **インテークVANOS**: DMEが制御する進角値（70°～130° ATDC）
- **エキゾーストVANOS**: DMEが制御する遅角値（52°～97° ABDC）
- **RPM × TPS（スロットル開度）**: 実際のエンジン制御マップに基づく
- **制御ロジック**: BMW純正DMEの制御戦略を反映

これらの値は実測データではなく、**BMW S54エンジンのDME制御パラメータ**として設定されている値です。

## 1. バルブリフトカーブ計算

### 1.1 基本計算式

参考スクリプトと同じsin関数ベースのリフトカーブを使用：

```python
def calculate_valve_lift_curve(max_lift, duration, max_lift_angle, crank_angles, direction):
    """
    参考スクリプトと同じ計算方式
    
    Parameters:
    - max_lift: 最大リフト量 (11.8mm for BMW S54)
    - duration: バルブ開度期間 (260°)
    - max_lift_angle: バルブ最大リフト角度 (VANOS角度)
    - crank_angles: クランク角度配列 (-360° to 360°)
    - direction: 'intake' または 'exhaust'
    """
    start_angle = max_lift_angle - duration / 2
    lift_values = []
    
    for angle in crank_angles:
        # 参考スクリプト: adjustedAngle = direction === 'intake' ? angle : -angle;
        adjusted_angle = angle if direction == 'intake' else -angle
        
        # 参考スクリプト: if (adjustedAngle >= startAngle && adjustedAngle <= startAngle + duration)
        if start_angle <= adjusted_angle <= start_angle + duration:
            # 参考スクリプト: return maxLift * Math.sin(Math.PI * (adjustedAngle - startAngle) / duration);
            lift = max_lift * math.sin(math.pi * (adjusted_angle - start_angle) / duration)
            lift_values.append(lift)
        else:
            lift_values.append(0.0)
    
    return lift_values
```

### 1.2 数学的表現

**リフト量計算**:
```
L(θ) = L_max × sin(π × (θ_adj - θ_start) / D)
```

**条件**:
```
θ_start ≤ θ_adj ≤ θ_start + D
```

**パラメータ**:
- `L(θ)`: 角度θでのバルブリフト量 [mm]
- `L_max`: 最大リフト量 = 11.8 [mm] (BMW S54仕様)
- `D`: バルブ開度期間 = 260 [°]
- `θ_adj`: 調整後クランク角度 [°]
- `θ_start`: バルブ開始角度 = VANOS角度 - 130° [°]

**角度調整**:
```
θ_adj = θ           (インテークバルブの場合)
θ_adj = -θ          (エキゾーストバルブの場合)
```

## 2. VANOS角度の意味

### 2.1 インテークVANOS角度
- **基準**: ATDC（上死点後）
- **意味**: インテークバルブが最大リフトに達する角度
- **DME制御範囲**: 70°～130° ATDC
- **計算での使用**: 正の値として直接使用
- **データソース**: BMW S54 DME制御パラメータ

### 2.2 エキゾーストVANOS角度
- **基準**: ABDC（下死点後）
- **意味**: エキゾーストバルブが最大リフトに達する角度
- **DME制御範囲**: 52°～97° ABDC
- **計算での使用**: 正の値だが、direction='exhaust'で負方向に調整
- **データソース**: BMW S54 DME制御パラメータ

## 3. オーバーラップ計算

### 3.1 リフトカーブベースのオーバーラップ検出

```python
def calculate_valve_overlap(self, intake_opening, intake_closing, exhaust_opening, exhaust_closing):
    """
    バルブオーバーラップを計算
    参考スクリプトに基づく正確な方式：sin関数カーブの重複部分を計算
    """
    # -360°～360°の角度範囲を生成（参考スクリプトと同じ）
    crank_angles = list(range(-360, 361))
    max_lift = 11.8  # BMW S54は11.8mm
    duration = 260.0
    
    # インテークとエキゾーストのVANOS角度を取得
    intake_max_lift_angle = self.cylinder.current_intake_vanos
    exhaust_max_lift_angle = self.cylinder.current_exhaust_vanos
    
    # バルブリフトカーブを計算
    intake_lift = calculate_valve_lift_curve(max_lift, duration, intake_max_lift_angle, crank_angles, 'intake')
    exhaust_lift = calculate_valve_lift_curve(max_lift, duration, exhaust_max_lift_angle, crank_angles, 'exhaust')
    
    # オーバーラップ期間を計算（両バルブが同時に開いている角度）
    overlap_angles = []
    
    for i, angle in enumerate(crank_angles):
        # 両バルブが0.1mm以上開いている場合をオーバーラップとする
        if intake_lift[i] > 0.1 and exhaust_lift[i] > 0.1:
            overlap_angles.append(angle)
    
    # 連続するオーバーラップ期間を計算
    if overlap_angles:
        overlap_duration = len(overlap_angles)
        overlap_start = overlap_angles[0]
        overlap_end = overlap_angles[-1]
    else:
        overlap_start = 0
        overlap_end = 0
        overlap_duration = 0
    
    return {
        'duration': overlap_duration,
        'start_angle': overlap_start,
        'end_angle': overlap_end
    }
```

### 3.2 数学的表現

**オーバーラップ条件**:
```
L_intake(θ) > 0.1 AND L_exhaust(θ) > 0.1
```

**オーバーラップ期間**:
```
D_overlap = |{θ | L_intake(θ) > 0.1 ∧ L_exhaust(θ) > 0.1, θ ∈ [-360°, 360°]}|
```

### 3.3 角度正規化

0°～720°範囲への変換：
```python
def convert_to_720_range(angle):
    while angle < 0:
        angle += 720
    while angle >= 720:
        angle -= 720
    return angle
```

## 4. バルブタイミング計算

### 4.1 有効バルブタイミング

```python
def get_effective_valve_timing(self, valve_type):
    """
    Get effective valve timing considering VANOS adjustment.
    BMW S54エンジン仕様: 最大リフト11.8mm、開度期間260°
    """
    valve_duration = 260.0  # BMW S54の実際のバルブ開度期間
    
    if valve_type == 'intake':
        # インテークVANOS角度はATDC（上死点後）でのバルブ全開角度
        valve_max_lift_angle_atdc = self.current_intake_vanos
        
        # バルブ全開角度を中心に±130°の開度期間（260°）
        opening_angle = valve_max_lift_angle_atdc - valve_duration/2
        closing_angle = valve_max_lift_angle_atdc + valve_duration/2
        
        return opening_angle, closing_angle
    else:
        # エキゾーストVANOS角度はABDC（下死点後）でのバルブ全開角度
        valve_max_lift_angle_abdc = self.current_exhaust_vanos
        
        # エキゾーストは正の値のまま使用（参考スクリプトと同じ）
        opening_angle = valve_max_lift_angle_abdc - valve_duration/2
        closing_angle = valve_max_lift_angle_abdc + valve_duration/2
        
        return opening_angle, closing_angle
```

### 4.2 数学的表現

**インテークバルブタイミング**:
```
θ_intake_open = θ_VANOS_intake - 130°
θ_intake_close = θ_VANOS_intake + 130°
```

**エキゾーストバルブタイミング**:
```
θ_exhaust_open = θ_VANOS_exhaust - 130°
θ_exhaust_close = θ_VANOS_exhaust + 130°
```

## 5. 実装上の重要なポイント

### 5.1 参考スクリプトとの整合性

1. **角度範囲**: -360°～360°を使用（参考スクリプトと同じ）
2. **方向調整**: インテークは正方向、エキゾーストは負方向
3. **リフト閾値**: 0.1mmでオーバーラップ判定
4. **sin関数**: 同じ計算式を使用

### 5.2 BMW S54エンジン固有の仕様

1. **最大リフト**: 11.8mm（インテーク・エキゾースト共通）
2. **開度期間**: 260°（インテーク・エキゾースト共通）
3. **DME制御VANOS範囲**: 
   - インテーク: 70°～130° ATDC（DME制御パラメータ）
   - エキゾースト: 52°～97° ABDC（DME制御パラメータ）

### 5.3 計算精度

- **角度分解能**: 1°
- **リフト精度**: 0.1mm閾値
- **オーバーラップ検出**: 連続角度での同時開弁

## 6. 出力データ構造

### 6.1 オーバーラップ詳細情報

```python
overlap_details = {
    'duration': overlap_duration,           # オーバーラップ期間 [°]
    'start_angle': overlap_start,           # 開始角度 [°]
    'end_angle': overlap_end,               # 終了角度 [°]
    'intake_timing': {
        'opening': intake_opening,          # インテーク開弁角度 [°]
        'closing': intake_closing,          # インテーク閉弁角度 [°]
        'duration': 260.0,                 # インテーク開度期間 [°]
        'max_lift_angle_atdc': intake_vanos # インテーク最大リフト角度 [° ATDC]
    },
    'exhaust_timing': {
        'opening': exhaust_opening,         # エキゾースト開弁角度 [°]
        'closing': exhaust_closing,         # エキゾースト閉弁角度 [°]
        'duration': 260.0,                 # エキゾースト開度期間 [°]
        'max_lift_angle_abdc': exhaust_vanos # エキゾースト最大リフト角度 [° ABDC]
    }
}
```

## 7. 検証方法

### 7.1 参考スクリプトとの比較

1. 同じVANOS角度での計算結果比較
2. オーバーラップ期間の一致確認
3. バルブタイミングの整合性確認

### 7.2 物理的妥当性

1. オーバーラップ期間の現実的範囲（0°～50°程度）
2. バルブタイミングの連続性
3. VANOS角度変化に対する応答性

---

**作成日**: 2024年
**バージョン**: 1.0
**対象エンジン**: BMW S54 (E46 M3)
**データソース**: BMW S54 DME制御パラメータ
**参考**: JavaScriptリファレンススクリプト
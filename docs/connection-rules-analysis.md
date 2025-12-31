# OpenWAM Connection Rules Analysis

## 概要

本文書は、OpenWAMコンポーネント間の接続ルールを詳細に分析し、現在実装済みのルールと未実装のルールを整理します。VANOS制御システム構築に必要な接続パターンを特定します。

## OpenWAM接続システムの基本構造

### ノード番号システム
OpenWAMでは各コンポーネントが固有のノード番号を持ち、これらのノード間で接続が定義されます。

```
パイプ: 左端ノード(nodoIzq) ↔ 右端ノード(nodoDer)
プレナム: 単一ノード（複数パイプ接続可能）
バルブ: パイプノードとプレナムノード間
境界条件: パイプの端点ノード
```

## 現在実装済みの接続ルール

### 1. 基本パイプ接続

| 接続パターン | 実装状況 | 説明 | 使用例 |
|-------------|---------|------|--------|
| パイプ ↔ 開放端 | ✅ | パイプ端点 → 大気開放 | 排気管出口 |
| パイプ ↔ 閉端 | ✅ | パイプ端点 → 完全閉塞 | テスト用閉塞 |
| パイプ ↔ 無反射端 | ✅ | パイプ端点 → 音響吸収 | 音響テスト |
| パイプ ↔ 分岐 | ✅ | パイプ分岐・合流 | Y字配管 |

### 2. パイプ-プレナム接続（バルブ経由）

| 接続パターン | 実装状況 | 説明 | 使用例 |
|-------------|---------|------|--------|
| パイプ ↔ 固定CDバルブ ↔ プレナム | ✅ | 固定流量係数 | 基本流量制御 |
| パイプ ↔ 4Tバルブ ↔ プレナム | ✅ | エンジンバルブ | 吸排気バルブ |
| パイプ ↔ リードバルブ ↔ プレナム | ✅ | 一方向バルブ | 2Tエンジン |
| パイプ ↔ バタフライバルブ ↔ パイプ | ✅ | スロットル制御 | 吸気制御 |

### 3. エンジン接続

| 接続パターン | 実装状況 | 説明 | 使用例 |
|-------------|---------|------|--------|
| エンジンブロック ↔ 4Tシリンダー | ✅ | エンジン基本構造 | 4ストロークエンジン |
| エンジンブロック ↔ 2Tシリンダー | ✅ | エンジン基本構造 | 2ストロークエンジン |
| シリンダー ↔ パイプ（吸気） | ✅ | 吸気管接続 | 吸気システム |
| シリンダー ↔ パイプ（排気） | ✅ | 排気管接続 | 排気システム |

## 未実装の重要な接続ルール

### 1. パイプ-プレナム直接接続 ⭐ VANOS用重要

| 接続パターン | 実装状況 | 優先度 | 説明 | VANOS用途 |
|-------------|---------|--------|------|-----------|
| パイプ ↔ TCCDeposito ↔ プレナム | ❌ | **High** | 直接接続 | 油圧回路接続 |
| パイプ ↔ TCCUnionEntreTubos ↔ パイプ | ❌ | Medium | パイプ間結合 | 複雑配管 |
| プレナム ↔ TCCUnionEntreDepositos ↔ プレナム | ❌ | Low | プレナム間結合 | 複雑システム |

### 2. 制御システム接続 ⭐ VANOS制御の核心

| 接続パターン | 実装状況 | 優先度 | 説明 | VANOS用途 |
|-------------|---------|--------|------|-----------|
| TSensor → TController | ❌ | **High** | センサー信号入力 | カム・クランク位置 |
| TTable1D → TController | ❌ | **High** | マップ参照 | VANOSマップ |
| TController → TPIDController | ❌ | **High** | 制御指令 | PID制御入力 |
| TPIDController → TValvulaContr | ❌ | **High** | 制御出力 | 油圧バルブ制御 |
| TController → TDecisor | ❌ | Medium | 判定ロジック | 制御モード切替 |
| TGain → TPIDController | ❌ | Medium | ゲイン調整 | PIDゲイン設定 |

### 3. 高度な境界条件接続

| 接続パターン | 実装状況 | 優先度 | 説明 | 用途 |
|-------------|---------|--------|------|------|
| パイプ ↔ TCCPerdidadePresion ↔ パイプ | ❌ | Medium | 圧力損失要素 | 実用的流動解析 |
| パイプ ↔ TCCPulso | ❌ | Low | パルス入力 | 特殊入力条件 |
| パイプ ↔ TCCExtremoInyeccion | ❌ | Low | 噴射端 | 燃料噴射 |
| パイプ ↔ TCCPreVble | ❌ | Low | 可変圧力 | 動的境界条件 |

## VANOS制御システム接続マップ

### 基本VANOS制御ループ

```
[カムセンサー] → [コントローラー] → [PIDコントローラー] → [制御バルブ]
      ↑              ↑                    ↑
[クランクセンサー]  [VANOSマップ]      [ゲイン設定]
                   (TTable1D)         (TGain)
```

### 詳細接続仕様

#### 1. センサー接続
```typescript
interface SensorConnection {
  from: TSensor;           // カム/クランクセンサー
  to: TController;         // メインコントローラー
  signalType: 'position' | 'speed' | 'pressure';
  dataFormat: 'analog' | 'digital' | 'pwm';
}
```

#### 2. コントローラー接続
```typescript
interface ControllerConnection {
  inputs: {
    sensors: TSensor[];      // 複数センサー入力
    tables: TTable1D[];      // 複数マップテーブル
    feedback: TValvulaContr; // フィードバック信号
  };
  outputs: {
    pidController: TPIDController; // PID制御器
    decisor?: TDecisor;           // 判定ロジック
  };
}
```

#### 3. PID制御接続
```typescript
interface PIDControllerConnection {
  inputs: {
    setpoint: TController;    // 目標値
    feedback: TValvulaContr;  // フィードバック
    gains: TGain[];          // PIDゲイン
  };
  output: TValvulaContr;     // 制御バルブ
}
```

#### 4. 制御バルブ接続
```typescript
interface ControlValveConnection {
  controlInput: TPIDController; // 制御入力
  hydraulicSystem: {
    supply: TDepVolCte;        // 油圧供給プレナム
    return: TDepVolCte;        // 油圧戻りプレナム
    pipes: TTubo[];           // 油圧配管
  };
  mechanicalOutput: TValvula4T; // 機械的出力（VANOSアクチュエーター）
}
```

## 接続バリデーションルール

### 1. 基本バリデーション

```typescript
interface ConnectionValidationRule {
  fromType: ComponentType;
  fromPortType: 'outlet' | 'inlet' | 'bidirectional';
  toType: ComponentType;
  toPortType: 'outlet' | 'inlet' | 'bidirectional';
  isAllowed: boolean;
  conditions?: ValidationCondition[];
}

// 例：パイプ-境界条件接続
const pipeToOpenEndRule: ConnectionValidationRule = {
  fromType: ComponentType.PIPE,
  fromPortType: 'outlet',
  toType: ComponentType.OPEN_END_ATMOSPHERE,
  toPortType: 'inlet',
  isAllowed: true
};
```

### 2. 制御システム専用バリデーション

```typescript
interface ControlSystemValidationRule {
  signalType: 'analog' | 'digital' | 'mechanical' | 'hydraulic';
  dataFlow: 'unidirectional' | 'bidirectional';
  realTimeRequirement: boolean;
  safetyLevel: 'low' | 'medium' | 'high' | 'critical';
}

// 例：センサー-コントローラー接続
const sensorToControllerRule: ControlSystemValidationRule = {
  signalType: 'analog',
  dataFlow: 'unidirectional',
  realTimeRequirement: true,
  safetyLevel: 'critical'
};
```

### 3. 物理的制約バリデーション

```typescript
interface PhysicalConstraintRule {
  maxDistance: number;        // 最大接続距離
  temperatureRange: [number, number]; // 動作温度範囲
  pressureRange: [number, number];    // 動作圧力範囲
  compatibleFluids: string[]; // 対応流体
}
```

## 実装優先度付き接続ルール

### Phase 1: VANOS制御基盤（必須）

| 優先度 | 接続ルール | 実装工数 | 依存関係 |
|--------|-----------|----------|----------|
| 1 | TSensor → TController | 2日 | TSensor, TController |
| 2 | TTable1D → TController | 1日 | TTable1D, TController |
| 3 | TController → TPIDController | 2日 | TController, TPIDController |
| 4 | TPIDController → TValvulaContr | 3日 | TPIDController, TValvulaContr |
| 5 | パイプ ↔ TCCDeposito ↔ プレナム | 2日 | TCCDeposito |

### Phase 2: 制御系拡張（推奨）

| 優先度 | 接続ルール | 実装工数 | 依存関係 |
|--------|-----------|----------|----------|
| 6 | TController → TDecisor | 1日 | TDecisor |
| 7 | TGain → TPIDController | 1日 | TGain |
| 8 | TValvulaContr → TValvula4T | 2日 | 機械的結合 |

### Phase 3: 高度な機能（将来）

| 優先度 | 接続ルール | 実装工数 | 依存関係 |
|--------|-----------|----------|----------|
| 9 | パイプ ↔ TCCPerdidadePresion ↔ パイプ | 2日 | TCCPerdidadePresion |
| 10 | パイプ ↔ TCCUnionEntreTubos ↔ パイプ | 2日 | TCCUnionEntreTubos |

## 接続ルール実装仕様

### 1. 基本接続クラス

```typescript
class ConnectionManager {
  private rules: Map<string, ConnectionValidationRule[]>;
  
  validateConnection(
    fromComponent: ModelComponent,
    fromPort: string,
    toComponent: ModelComponent,
    toPort: string
  ): ValidationResult {
    // 基本ルールチェック
    const basicRule = this.findBasicRule(fromComponent.type, toComponent.type);
    if (!basicRule?.isAllowed) {
      return { isValid: false, errors: ['接続が許可されていません'] };
    }
    
    // 制御システム専用チェック
    if (this.isControlSystemConnection(fromComponent, toComponent)) {
      return this.validateControlConnection(fromComponent, toComponent);
    }
    
    // 物理的制約チェック
    return this.validatePhysicalConstraints(fromComponent, toComponent);
  }
}
```

### 2. VANOS制御専用バリデーター

```typescript
class VANOSConnectionValidator extends ConnectionManager {
  validateVANOSControlLoop(components: ModelComponent[]): ValidationResult {
    // VANOS制御ループの完全性チェック
    const sensors = components.filter(c => c.type === ComponentType.SENSOR);
    const controllers = components.filter(c => c.type === ComponentType.CONTROLLER);
    const pidControllers = components.filter(c => c.type === ComponentType.PID_CONTROLLER);
    const controlValves = components.filter(c => c.type === ComponentType.CONTROL_VALVE);
    
    // 必須コンポーネントの存在チェック
    if (sensors.length === 0) {
      return { isValid: false, errors: ['VANOSセンサーが不足しています'] };
    }
    
    // 制御ループの連続性チェック
    return this.validateControlLoopContinuity(sensors, controllers, pidControllers, controlValves);
  }
}
```

## エラーメッセージと修正提案

### 1. 日本語エラーメッセージ

```typescript
const connectionErrorMessages = {
  incompatibleTypes: '互換性のないコンポーネント間の接続です',
  missingComponent: '必要なコンポーネントが不足しています',
  circularReference: '循環参照が検出されました',
  maxConnectionsExceeded: '最大接続数を超えています',
  controlLoopIncomplete: 'VANOS制御ループが不完全です',
  signalTypeMismatch: '信号タイプが一致しません',
  safetyViolation: '安全要件に違反しています'
};
```

### 2. 修正提案システム

```typescript
interface ConnectionSuggestion {
  type: 'add_component' | 'change_connection' | 'modify_property';
  description: string;
  component?: ComponentType;
  action: string;
}

class ConnectionSuggestionEngine {
  generateSuggestions(error: ValidationError): ConnectionSuggestion[] {
    switch (error.type) {
      case 'missing_vanos_sensor':
        return [{
          type: 'add_component',
          description: 'カムポジションセンサーを追加してください',
          component: ComponentType.SENSOR,
          action: 'センサーパレットからカムポジションセンサーをドラッグ&ドロップ'
        }];
      
      case 'incomplete_control_loop':
        return [{
          type: 'add_component',
          description: 'PIDコントローラーを追加してください',
          component: ComponentType.PID_CONTROLLER,
          action: '制御パレットからPIDコントローラーをドラッグ&ドロップ'
        }];
    }
  }
}
```

## 実装チェックリスト

### Phase 1 実装項目

- [ ] **TSensor接続ルール**
  - [ ] センサー → コントローラー接続
  - [ ] 信号タイプバリデーション
  - [ ] リアルタイム要件チェック

- [ ] **TController接続ルール**
  - [ ] 複数センサー入力対応
  - [ ] テーブル参照接続
  - [ ] PIDコントローラー出力

- [ ] **TPIDController接続ルール**
  - [ ] 制御入力バリデーション
  - [ ] ゲイン設定接続
  - [ ] 制御バルブ出力

- [ ] **TValvulaContr接続ルール**
  - [ ] 油圧システム接続
  - [ ] 機械的出力接続
  - [ ] フィードバック信号

- [ ] **TCCDeposito接続ルール**
  - [ ] パイプ-プレナム直接接続
  - [ ] 流量計算対応
  - [ ] 圧力波伝播処理

### テスト項目

- [ ] **基本接続テスト**
  - [ ] 有効な接続の許可
  - [ ] 無効な接続の拒否
  - [ ] エラーメッセージの表示

- [ ] **VANOS制御ループテスト**
  - [ ] 完全な制御ループの検証
  - [ ] 不完全なループの検出
  - [ ] 修正提案の生成

- [ ] **パフォーマンステスト**
  - [ ] 大規模モデルでの接続検証
  - [ ] リアルタイム接続チェック
  - [ ] メモリ使用量最適化

## 結論

VANOS制御システム実装には、5つの新しい接続ルールが必要です：

1. **TSensor → TController**: センサー信号入力
2. **TTable1D → TController**: マップ参照
3. **TController → TPIDController**: 制御指令
4. **TPIDController → TValvulaContr**: 制御出力
5. **パイプ ↔ TCCDeposito ↔ プレナム**: 油圧回路接続

これらの実装により、E46 M3 VANOSシステムの完全なモデリングが可能になります。
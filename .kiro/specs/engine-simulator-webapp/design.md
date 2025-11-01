# 設計文書

## 概要

本文書は、OpenWAMエンジンシミュレーターを活用したスタンドアロンWebアプリケーションの設計を定義します。OpenWAMのソースコード解析に基づき、実際のコンポーネント構造と入力ファイル形式を考慮した設計を行います。アプリケーションは、ローカル環境で動作するWebサーバーとして実装され、ブラウザベースのインターフェースを通じてエンジンシミュレーションの設定、実行、解析を提供します。

## アーキテクチャ

### システム全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                    ブラウザ (Frontend)                        │
├─────────────────────────────────────────────────────────────┤
│  React.js Application                                       │
│  ├── ビジュアルモデルエディター (Canvas/SVG)                    │
│  ├── 設定インターフェース (Forms)                              │
│  ├── 結果ビューア (Charts.js/D3.js)                          │
│  └── ファイル管理 (Upload/Download)                           │
└─────────────────────────────────────────────────────────────┘
                              │ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                ローカルWebサーバー (Backend)                   │
├─────────────────────────────────────────────────────────────┤
│  Node.js/Express Server                                    │
│  ├── REST API エンドポイント                                  │
│  ├── WebSocket サーバー (リアルタイム通信)                      │
│  ├── ファイル管理サービス                                      │
│  └── シミュレーション管理サービス                               │
└─────────────────────────────────────────────────────────────┘
                              │ Process Execution
┌─────────────────────────────────────────────────────────────┐
│                OpenWAM シミュレーションエンジン                │
├─────────────────────────────────────────────────────────────┤
│  ├── OpenWAM実行ファイル                                      │
│  ├── 入力ファイル生成                                         │
│  ├── 結果ファイル解析                                         │
│  └── プロセス監視                                            │
└─────────────────────────────────────────────────────────────┘
```

### 技術スタック

**フロントエンド:**
- React.js 18+ (UI フレームワーク)
- TypeScript (型安全性)
- Material-UI または Ant Design (UIコンポーネント)
- Konva.js または Fabric.js (ビジュアルエディター用Canvas)
- Chart.js または Recharts (データ可視化)
- Axios (HTTP クライアント)
- Socket.io-client (リアルタイム通信)

**バックエンド:**
- Node.js 18+ (ランタイム)
- Express.js (Webフレームワーク)
- TypeScript (型安全性)
- Socket.io (WebSocket サーバー)
- Multer (ファイルアップロード)
- Child Process (OpenWAM実行)
- Winston (ログ記録)

**データストレージ:**
- SQLite (軽量データベース - プロジェクト、履歴管理)
- ファイルシステム (シミュレーションファイル、結果)

## コンポーネントと インターフェース

### フロントエンドコンポーネント

#### 1. メインダッシュボード
- プロジェクト一覧表示
- 新規プロジェクト作成
- 最近のシミュレーション履歴
- システムステータス表示

#### 2. ビジュアルモデルエディター

OpenWAMのソースコード解析に基づく実際のコンポーネント定義：

```typescript
// OpenWAMの実際のコンポーネントカテゴリ
enum ComponentCategory {
  PIPES = 'pipes',              // 1DPipes
  BOUNDARIES = 'boundaries',    // Boundaries
  PLENUMS = 'plenums',         // ODModels (0D Models)
  VALVES = 'valves',           // Connections
  TURBOCHARGER = 'turbocharger', // Turbocompressor
  ENGINE = 'engine',           // Engine
  CONTROL = 'control',         // Control
  DPF = 'dpf',                // DPF (Diesel Particulate Filter)
  EXTERNAL = 'external'        // Extern
}

// OpenWAMの実際のコンポーネントタイプ（ソースコード解析に基づく）
enum ComponentType {
  // 1DPipes
  PIPE = 'TTubo',
  CONCENTRIC_PIPE = 'TConcentrico',
  
  // Boundaries (境界条件)
  OPEN_END_ATMOSPHERE = 'TCCDescargaExtremoAbierto',      // nmOpenEndAtmosphere
  OPEN_END_RESERVOIR = 'TCCDescargaExtremoAbierto',       // nmOpenEndReservoir  
  CLOSED_END = 'TCCExtremoCerrado',                       // nmClosedEnd
  ANECHOIC_END = 'TCCExtremoAnecoico',                   // nmAnechoicEnd
  PULSE_END = 'TCCPulso',                                // nmIncidentPressurWave
  INJECTION_END = 'TCCExtremoInyeccion',                 // nmInjectionEnd
  PRESSURE_LOSS_LINEAR = 'TCCPerdidadePresion',          // nmLinearPressureLoss
  PRESSURE_LOSS_QUADRATIC = 'TCCPerdidadePresion',       // nmQuadraticPressureLoss
  PIPES_CONNECTION = 'TCCUnionEntreTubos',               // nmPipesConnection
  PIPE_TO_PLENUM = 'TCCDeposito',                        // nmPipeToPlenumConnection
  BRANCH = 'TCCRamificacion',                            // nmBranch
  VOLUMETRIC_COMPRESSOR = 'TCCCompresorVolumetrico',     // nmVolumetricCompressor
  COMPRESSOR_INLET = 'TCCEntradaCompresor',              // nmEntradaCompre
  UNION_BETWEEN_PLENUMS = 'TCCUnionEntreDepositos',      // nmUnionEntreDepositos
  COMPRESSOR_BC = 'TCCCompresor',                        // nmCompresor
  VARIABLE_PRESSURE = 'TCCPreVble',                      // nmPresionVble
  CFD_CONNECTION = 'TCFDConnection',                     // nmCFDConnection
  EXTERNAL_CONNECTION = 'TCCExternalConnection',         // nmExternalConnection
  
  // ODModels (プレナム)
  CONSTANT_VOLUME_PLENUM = 'TDepVolCte',
  VARIABLE_VOLUME_PLENUM = 'TDepVolVariable', 
  SIMPLE_TURBINE = 'TTurbinaSimple',
  TWIN_TURBINE = 'TTurbinaTwin',
  VENTURI = 'TVenturi',
  DIRECTIONAL_UNION = 'TUnionDireccional',
  ACOUSTIC_TURBINE = 'TAcousticTurbine',
  
  // Connections (バルブ)
  FIXED_CD = 'TCDFijo',                    // nmCDFijo
  VALVE_4T = 'TValvula4T',                // nmValvula4T
  REED_VALVE = 'TLamina',                 // nmLamina
  ROTARY_DISC = 'TDiscoRotativo',         // nmDiscoRotativo
  PORT_2T = 'TLumbrera',                  // nmLumbrera2T
  CONTROL_VALVE = 'TValvulaContr',        // nmValvulaContr
  WASTEGATE = 'TWasteGate',               // nmWasteGate
  TURBINE_STATOR = 'TEstatorTurbina',     // nmStator
  TURBINE_ROTOR = 'TRotorTurbina',        // nmRotor
  EXTERNAL_CALC = 'TCDExterno',           // nmCalcExtern
  BUTTERFLY_VALVE = 'TMariposa',          // nmMariposa
  
  // Turbocompressor
  COMPRESSOR_DEP = 'TCompresorDep',
  COMPRESSOR_TUB_DEP = 'TCompTubDep', 
  COMPRESSOR_TUBES = 'TCompTubos',
  TURBO_AXIS = 'TEjeTurbogrupo',
  ACOUSTIC_COMPRESSOR = 'TAcousticCompressor',
  
  // Engine
  ENGINE_BLOCK = 'TBloqueMotor',
  CYLINDER_4T = 'TCilindro4T',
  CYLINDER_2T = 'TCilindro2T',
  
  // Control
  SENSOR = 'TSensor',
  PID_CONTROLLER = 'TPIDController',
  TABLE_1D = 'TTable1D',
  CONTROLLER = 'TController',
  DECISOR = 'TDecisor',
  GAIN = 'TGain',
  
  // DPF
  DPF = 'TDPF',
  DPF_CHANNEL = 'TCanalDPF'
}

// OpenWAMの実際のノード接続システム
interface ComponentNode {
  id: string;
  name: string;
  type: 'left' | 'right' | 'inlet' | 'outlet' | 'bidirectional';
  position: { x: number; y: number };
  nodeNumber: number; // OpenWAMのノード番号
  allowedConnections: ComponentType[];
  maxConnections: number;
}

// OpenWAMの実際のプロパティ構造（TTuboクラスに基づく）
interface PipeProperties {
  // 基本幾何パラメータ
  numeroTubo: number;           // FNumeroTubo
  nodoIzq: number;             // FNodoIzq  
  nodoDer: number;             // FNodoDer
  nin: number;                 // FNin (計算セル数)
  longitudTotal: number;       // FLongitudTotal
  mallado: number;             // FMallado
  nTramos: number;             // FNTramos
  tipoMallado: 'distance' | 'angular'; // FTipoMallado
  
  // 熱伝達・摩擦特性
  friccion: number;            // FFriccion
  tipoTransCal: number;        // FTipoTransCal
  coefAjusFric: number;        // FCoefAjusFric
  coefAjusTC: number;          // FCoefAjusTC
  
  // 壁面特性
  espesorPrin: number;         // FEspesorPrin
  densidadPrin: number;        // FDensidadPrin
  calEspPrin: number;          // FCalEspPrin
  conductPrin: number;         // FConductPrin
  tRefrigerante: number;       // FTRefrigerante
  tipRefrig: 'air' | 'water';  // FTipRefrig
  
  // 初期条件
  tini: number;                // FTini
  pini: number;                // FPini
  velMedia: number;            // FVelMedia
  
  // 幾何形状配列
  lTramo: number[];            // FLTramo
  dExtTramo: number[];         // FDExtTramo
  
  // 壁面層構造
  numCapas: number;            // FNumCapas
  capas: WallLayer[];          // FCapa
}

interface WallLayer {
  esPrincipal: boolean;
  esFluida: boolean;
  density: number;
  calorEspecifico: number;
  conductividad: number;
  espesor: number;
  emisividadInterior: number;
  emisividadExterior: number;
}

// OpenWAMコンポーネント定義
interface ComponentDefinition {
  type: ComponentType;
  category: ComponentCategory;
  name: string;
  description: string;
  icon: string;
  nodes: ComponentNode[];
  defaultProperties: ComponentProperties;
  propertySchema: PropertySchema;
  size: { width: number; height: number };
  openWAMClass: string; // 対応するC++クラス名
}

// OpenWAMの各コンポーネントタイプ別プロパティ
type ComponentProperties = 
  | PipeProperties 
  | PlenumProperties 
  | ValveProperties 
  | BoundaryProperties 
  | EngineProperties 
  | CompressorProperties;

interface PlenumProperties {
  numeroDeposito: number;
  volumen0: number;
  tipoDeposito: 'constant' | 'variable' | 'turbine_simple' | 'turbine_twin' | 'venturi' | 'directional_union';
  // TDeposito クラスのプロパティに基づく
  temperature: number;
  pressure: number;
  masa0: number;
}

interface ValveProperties {
  tipoValvula: 'cd_fijo' | 'valvula_4t' | 'lamina' | 'disco_rotativo' | 'lumbrera' | 'control' | 'wastegate';
  tubo: number;
  nodo: number;
  tipo: number;
  valvula: number;
  sentido: number;
  diametroTubo: number;
  // TTipoValvula クラスのプロパティに基づく
}

interface BoundaryProperties {
  tipoCC: number; // nmTypeBC enum値
  numeroCC: number;
  // 各境界条件タイプ固有のプロパティ
  [key: string]: any;
}

interface EngineProperties {
  // TBloqueMotor クラスのプロパティに基づく
  tipoMotor: '2T' | '4T';
  geometria: {
    nCilin: number;
    carrera: number;
    diametro: number;
    biela: number;
    vcc: number;
    relaCompresion: number;
  };
  combustible: 'diesel' | 'gasoline';
}

interface CompressorProperties {
  // TCompresor クラスのプロパティに基づく
  numeroCompresor: number;
  eje: number;
  depRotor: number;
  depStator: number;
  modeloCompresor: 'original' | 'plenums' | 'pipes';
}

interface ModelComponent {
  id: string;
  type: ComponentType;
  position: { x: number; y: number };
  rotation: number; // 回転角度（度）
  properties: Record<string, any>;
  customName?: string; // ユーザー定義名
}

interface Connection {
  id: string;
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
  isValid: boolean; // 接続の妥当性
  validationErrors?: string[];
}

interface EngineModel {
  components: ModelComponent[];
  connections: Connection[];
  metadata: {
    name: string;
    description: string;
    created: Date;
    modified: Date;
    version: string;
  };
  validationResult: {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  };
}

// 接続ルール定義
interface ConnectionRule {
  fromType: ComponentType;
  fromPortType: string;
  toType: ComponentType;
  toPortType: string;
  isAllowed: boolean;
  conditions?: ConnectionCondition[];
}

interface ConnectionCondition {
  property: string;
  operator: 'equals' | 'greater' | 'less' | 'range';
  value: any;
  message: string;
}
```

#### 3. 設定インターフェース
```typescript
// プロパティスキーマ定義
interface PropertySchema {
  [key: string]: PropertyDefinition;
}

interface PropertyDefinition {
  type: 'number' | 'string' | 'boolean' | 'select' | 'array';
  label: string;
  description?: string;
  unit?: string;
  required: boolean;
  validation: ValidationRule[];
  defaultValue: any;
  options?: SelectOption[]; // select型の場合
  dependencies?: PropertyDependency[]; // 他のプロパティとの依存関係
}

interface ValidationRule {
  type: 'min' | 'max' | 'range' | 'pattern' | 'custom';
  value: any;
  message: string;
}

interface PropertyDependency {
  property: string;
  condition: any;
  effect: 'show' | 'hide' | 'enable' | 'disable' | 'setValue';
}

// コンポーネントライブラリ
interface ComponentLibrary {
  categories: ComponentCategory[];
  components: ComponentDefinition[];
  connectionRules: ConnectionRule[];
  templates: ModelTemplate[];
}

interface ModelTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  model: EngineModel;
  thumbnail: string;
}
```

#### 4. 結果ビューア
- インタラクティブチャート
- データテーブル
- 比較機能
- エクスポート機能

### バックエンドAPI設計

#### REST API エンドポイント

```typescript
// プロジェクト管理
GET    /api/projects              // プロジェクト一覧取得
POST   /api/projects              // 新規プロジェクト作成
GET    /api/projects/:id          // プロジェクト詳細取得
PUT    /api/projects/:id          // プロジェクト更新
DELETE /api/projects/:id          // プロジェクト削除

// モデル管理
GET    /api/projects/:id/model    // モデル取得
PUT    /api/projects/:id/model    // モデル保存
POST   /api/projects/:id/validate // モデル検証
GET    /api/components/library    // コンポーネントライブラリ取得
GET    /api/components/rules      // 接続ルール取得
GET    /api/templates             // モデルテンプレート一覧

// シミュレーション
POST   /api/projects/:id/simulate // シミュレーション開始
GET    /api/simulations/:id       // シミュレーション状態取得
DELETE /api/simulations/:id       // シミュレーション停止

// ファイル管理
POST   /api/files/upload          // ファイルアップロード
GET    /api/files/:id/download    // ファイルダウンロード
GET    /api/projects/:id/results  // 結果ファイル一覧

// システム
GET    /api/system/status         // システム状態
GET    /api/system/logs           // ログ取得
```

#### WebSocket イベント

```typescript
// クライアント → サーバー
'simulation:start'    // シミュレーション開始
'simulation:stop'     // シミュレーション停止
'model:validate'      // モデル検証

// サーバー → クライアント
'simulation:progress' // 進行状況更新
'simulation:complete' // 完了通知
'simulation:error'    // エラー通知
'system:status'       // システム状態更新
```

## データモデル

### データベーススキーマ (SQLite)

```sql
-- プロジェクトテーブル
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  model_data TEXT, -- JSON形式のモデルデータ
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- シミュレーション履歴テーブル
CREATE TABLE simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  status TEXT CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
  input_file_path TEXT,
  output_file_path TEXT,
  error_message TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  progress INTEGER DEFAULT 0
);

-- ファイルテーブル
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### ファイルシステム構造

```
app_data/
├── projects/
│   ├── {project_id}/
│   │   ├── model.json          // ビジュアルモデルデータ
│   │   ├── input/              // 入力ファイル
│   │   │   ├── engine.wam
│   │   │   └── uploaded_files/
│   │   ├── output/             // 出力ファイル
│   │   │   ├── results.csv
│   │   │   ├── plots/
│   │   │   └── logs/
│   │   └── temp/               // 一時ファイル
├── templates/                  // プリセットテンプレート
├── logs/                       // アプリケーションログ
└── backups/                    // バックアップファイル
```

## OpenWAM入力ファイル構造解析

### 実際のOpenWAM入力ファイル形式

OpenWAMのソースコード解析により、以下の入力ファイル構造が判明しました：

```
OpenWAM入力ファイル (.wam)
├── バージョン情報
├── 独立計算フラグ
├── 一般データ
│   ├── 角度増分、シミュレーション時間
│   ├── 環境圧力、環境温度
│   ├── 化学種計算タイプ、ガンマ計算タイプ
│   ├── エンジンブロック存在フラグ
│   ├── エンジンタイプ (2T/4T)、モデリングタイプ
│   ├── EGRフラグ
│   └── 大気組成データ
├── エンジンデータ (存在する場合)
├── パイプデータ
│   ├── パイプ数
│   └── 各パイプの詳細データ
├── DPFデータ (有効な場合)
├── 同心円要素データ (有効な場合)
├── バルブデータ
│   ├── バルブ数
│   └── 各バルブの詳細データ
├── プレナムデータ
│   ├── プレナム数
│   ├── タービン数、ベンチュリ数、方向性結合数
│   └── 各プレナムの詳細データ
├── コンプレッサーデータ
├── 境界条件データ
├── ターボチャージャー軸データ
├── センサーデータ
├── コントローラーデータ
├── 出力データ
└── DLL計算フラグ
```

### コンポーネントライブラリ設計

実際のOpenWAMコンポーネント構造に基づく設計：

```
components/
├── pipes/
│   ├── TTubo.json              # 1Dパイプ
│   ├── TConcentrico.json       # 同心円パイプ
│   └── icons/
├── boundaries/
│   ├── TCCDescargaExtremoAbierto.json    # 開放端
│   ├── TCCExtremoCerrado.json            # 閉端
│   ├── TCCExtremoAnecoico.json          # 無反射端
│   ├── TCCPulso.json                    # パルス端
│   ├── TCCExtremoInyeccion.json         # 噴射端
│   ├── TCCPerdidadePresion.json         # 圧力損失
│   ├── TCCUnionEntreTubos.json          # パイプ間結合
│   ├── TCCDeposito.json                 # パイプ-プレナム結合
│   ├── TCCRamificacion.json             # 分岐
│   └── icons/
├── plenums/
│   ├── TDepVolCte.json                  # 定容積プレナム
│   ├── TDepVolVariable.json             # 可変容積プレナム
│   ├── TTurbinaSimple.json              # シンプルタービン
│   ├── TTurbinaTwin.json                # ツインタービン
│   ├── TVenturi.json                    # ベンチュリ
│   ├── TUnionDireccional.json           # 方向性結合
│   └── icons/
├── valves/
│   ├── TCDFijo.json                     # 固定CD
│   ├── TValvula4T.json                  # 4Tバルブ
│   ├── TLamina.json                     # リードバルブ
│   ├── TDiscoRotativo.json              # 回転ディスク
│   ├── TLumbrera.json                   # 2Tポート
│   ├── TValvulaContr.json               # 制御バルブ
│   ├── TWasteGate.json                  # ウェストゲート
│   ├── TEstatorTurbina.json             # タービンステーター
│   ├── TRotorTurbina.json               # タービンローター
│   ├── TMariposa.json                   # バタフライバルブ
│   └── icons/
├── turbocharger/
│   ├── TCompresorDep.json               # プレナム型コンプレッサー
│   ├── TCompTubDep.json                 # パイプ-プレナム型コンプレッサー
│   ├── TCompTubos.json                  # パイプ型コンプレッサー
│   ├── TEjeTurbogrupo.json              # ターボチャージャー軸
│   └── icons/
├── engine/
│   ├── TBloqueMotor.json                # エンジンブロック
│   ├── TCilindro4T.json                 # 4Tシリンダー
│   ├── TCilindro2T.json                 # 2Tシリンダー
│   └── icons/
└── control/
    ├── TSensor.json                     # センサー
    ├── TPIDController.json              # PIDコントローラー
    ├── TTable1D.json                    # 1Dテーブル
    ├── TController.json                 # コントローラー
    ├── TDecisor.json                    # デシジョン
    ├── TGain.json                       # ゲイン
    └── icons/
```

#### 接続バリデーション

```typescript
class ConnectionValidator {
  private rules: ConnectionRule[];
  
  validateConnection(
    fromComponent: ModelComponent,
    fromPort: string,
    toComponent: ModelComponent,
    toPort: string
  ): ValidationResult {
    // 1. 基本的な接続ルールチェック
    const rule = this.findRule(fromComponent.type, fromPort, toComponent.type, toPort);
    if (!rule || !rule.isAllowed) {
      return { isValid: false, errors: ['この接続は許可されていません'] };
    }
    
    // 2. 条件チェック
    const conditionErrors = this.validateConditions(rule.conditions, fromComponent, toComponent);
    if (conditionErrors.length > 0) {
      return { isValid: false, errors: conditionErrors };
    }
    
    // 3. 循環参照チェック
    if (this.hasCircularReference(fromComponent, toComponent)) {
      return { isValid: false, errors: ['循環参照が検出されました'] };
    }
    
    // 4. 重複接続チェック
    if (this.hasDuplicateConnection(fromComponent, fromPort, toComponent, toPort)) {
      return { isValid: false, errors: ['既に接続されています'] };
    }
    
    return { isValid: true, errors: [] };
  }
  
  validateModel(model: EngineModel): ModelValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // 全接続の検証
    model.connections.forEach(connection => {
      const result = this.validateConnection(/* ... */);
      if (!result.isValid) {
        errors.push(...result.errors.map(error => ({
          type: 'connection',
          componentId: connection.fromComponent,
          message: error
        })));
      }
    });
    
    // 孤立コンポーネントの検出
    const isolatedComponents = this.findIsolatedComponents(model);
    isolatedComponents.forEach(component => {
      warnings.push({
        type: 'isolation',
        componentId: component.id,
        message: 'このコンポーネントは他のコンポーネントと接続されていません'
      });
    });
    
    // 必須プロパティの検証
    model.components.forEach(component => {
      const propertyErrors = this.validateProperties(component);
      errors.push(...propertyErrors);
    });
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}
```

### OpenWAMファイル生成

実際のOpenWAM入力ファイル形式に完全準拠した生成クラス：

```typescript
class OpenWAMGenerator {
  generateInputFile(model: EngineModel): string {
    let content = '';
    
    // 1. バージョン情報と独立計算フラグ
    content += `${model.openWAMVersion || 2200}\n`;  // OpenWAMバージョン
    content += `${model.independent ? 1 : 0}\n`;     // 独立計算フラグ
    
    // 2. 一般データ
    content += this.generateGeneralData(model);
    
    // 3. エンジンデータ (存在する場合)
    if (model.hasEngine) {
      content += this.generateEngineData(model);
    }
    
    // 4. パイプデータ
    content += this.generatePipeData(model);
    
    // 5. DPFデータ (有効な場合)
    if (model.hasDPF) {
      content += this.generateDPFData(model);
    }
    
    // 6. 同心円要素データ (有効な場合)
    if (model.hasConcentricElements) {
      content += this.generateConcentricData(model);
    }
    
    // 7. バルブデータ
    content += this.generateValveData(model);
    
    // 8. プレナムデータ
    content += this.generatePlenumData(model);
    
    // 9. コンプレッサーデータ
    content += this.generateCompressorData(model);
    
    // 10. 境界条件データ
    content += this.generateBoundaryConditions(model);
    
    // 11. ターボチャージャー軸データ
    content += this.generateTurbochargerAxisData(model);
    
    // 12. センサーデータ
    content += this.generateSensorData(model);
    
    // 13. コントローラーデータ
    content += this.generateControllerData(model);
    
    // 14. 出力データ
    content += this.generateOutputData(model);
    
    // 15. DLL計算フラグ
    content += `${model.hasDLL ? 1 : 0}\n`;
    
    return content;
  }
  
  private generateGeneralData(model: EngineModel): string {
    let section = '';
    
    // 角度増分とシミュレーション時間
    section += `${model.angleIncrement} ${model.simulationDuration}\n`;
    
    // 環境条件
    section += `${model.ambientPressure} ${model.ambientTemperature}\n`;
    
    // 化学種計算とガンマ計算タイプ
    section += `${model.speciesCalculationType} ${model.gammaCalculationType}\n`;
    
    // エンジンブロック存在フラグ
    section += `${model.hasEngine ? 1 : 0}\n`;
    
    if (model.hasEngine) {
      // エンジンタイプ、モデリングタイプ、EGRフラグ
      section += `${model.engineType} ${model.modelingType} ${model.hasEGR ? 1 : 0}\n`;
      
      if (model.modelingType !== 0) { // 非定常計算の場合
        section += `${model.cyclesWithoutThermalInertia}\n`;
      }
    }
    
    // 燃料関連データ
    if (model.speciesCalculationType === 1) { // 完全計算の場合
      section += `${model.hasFuel ? 1 : 0}\n`;
      if (model.hasFuel) {
        section += `${model.fuelType}\n`;
      }
    } else { // 簡易計算の場合
      section += `${model.hasFuel ? 1 : 0}\n`;
      if (model.hasFuel) {
        section += `${model.fuelType}\n`;
      }
    }
    
    // 大気組成
    model.atmosphericComposition.forEach((fraction, index) => {
      if (index < model.atmosphericComposition.length - 1) {
        section += `${fraction} `;
      }
    });
    section += '\n';
    
    return section;
  }
  
  private generatePipeData(model: EngineModel): string {
    const pipes = model.components.filter(c => c.type === ComponentType.PIPE);
    let section = `${pipes.length}\n`;
    
    pipes.forEach((pipe) => {
      const props = pipe.properties as PipeProperties;
      
      // 基本データ: 番号、左ノード、右ノード、セル数、クラス、長さ、メッシュサイズ
      section += `${props.numeroTubo} ${props.nodoIzq} ${props.nodoDer} `;
      section += `${props.nin} ${props.jClase} ${props.longitudTotal} ${props.mallado}\n`;
      
      // 幾何データ: セクション数、メッシュタイプ
      section += `${props.nTramos} ${props.tipoMallado}\n`;
      
      // 各セクションの長さと直径
      for (let i = 0; i < props.nTramos; i++) {
        section += `${props.lTramo[i]} ${props.dExtTramo[i]}\n`;
      }
      
      // 熱伝達・摩擦特性
      section += `${props.tipoTransCal} ${props.coefAjusFric} ${props.coefAjusTC}\n`;
      
      // 壁面材料特性
      section += `${props.espesorPrin} ${props.densidadPrin} `;
      section += `${props.calEspPrin} ${props.conductPrin}\n`;
      
      // 冷却剤データ
      section += `${props.tRefrigerante} ${props.tipRefrig}\n`;
      
      // 初期条件
      section += `${props.tini} ${props.pini} ${props.velMedia}\n`;
      
      // 壁面層データ
      section += `${props.numCapas}\n`;
      props.capas.forEach(capa => {
        section += `${capa.espesor} ${capa.density} `;
        section += `${capa.calorEspecifico} ${capa.conductividad}\n`;
      });
    });
    
    return section;
  }
  
  private generateValveData(model: EngineModel): string {
    const valves = model.components.filter(c => c.category === ComponentCategory.VALVES);
    let section = `${valves.length}\n`;
    
    valves.forEach((valve) => {
      const props = valve.properties as ValveProperties;
      
      // バルブタイプ
      section += `${this.getValveTypeNumber(props.tipoValvula)}\n`;
      
      // バルブタイプ別の詳細データ
      switch (props.tipoValvula) {
        case 'cd_fijo':
          section += this.generateFixedCDValveData(props);
          break;
        case 'valvula_4t':
          section += this.generate4TValveData(props);
          break;
        case 'lamina':
          section += this.generateReedValveData(props);
          break;
        // 他のバルブタイプも同様に処理
      }
    });
    
    return section;
  }
  
  private generatePlenumData(model: EngineModel): string {
    const plenums = model.components.filter(c => c.category === ComponentCategory.PLENUMS);
    const turbines = plenums.filter(p => p.type === ComponentType.SIMPLE_TURBINE || p.type === ComponentType.TWIN_TURBINE);
    const venturis = plenums.filter(p => p.type === ComponentType.VENTURI);
    const directionalUnions = plenums.filter(p => p.type === ComponentType.DIRECTIONAL_UNION);
    
    let section = `${plenums.length}\n`;
    section += `${turbines.length} ${venturis.length} ${directionalUnions.length}\n`;
    
    plenums.forEach((plenum) => {
      const props = plenum.properties as PlenumProperties;
      
      // プレナムタイプ
      section += `${this.getPlenumTypeNumber(props.tipoDeposito)}\n`;
      
      // タイプ別の追加データ
      switch (props.tipoDeposito) {
        case 'turbine_simple':
        case 'turbine_twin':
          section += `${props.turbineNumber}\n`;
          break;
        case 'venturi':
          section += `${props.venturiNumber}\n`;
          break;
      }
      
      // 基本プレナムデータ
      section += this.generateBasicPlenumData(props);
      
      // タイプ別の詳細データ
      section += this.generateSpecificPlenumData(plenum);
    });
    
    return section;
  }
  
  private getValveTypeNumber(type: string): number {
    const typeMap = {
      'cd_fijo': 0,
      'valvula_4t': 1,
      'lamina': 2,
      'disco_rotativo': 3,
      'lumbrera': 4,
      'control': 5,
      'wastegate': 6,
      'stator': 7,
      'rotor': 8,
      'calc_extern': 9,
      'mariposa': 10
    };
    return typeMap[type] || 0;
  }
  
  private getPlenumTypeNumber(type: string): number {
    const typeMap = {
      'constant': 0,
      'variable': 1,
      'turbine_simple': 2,
      'turbine_twin': 3,
      'venturi': 4,
      'directional_union': 5
    };
    return typeMap[type] || 0;
  }
}
```

## エラーハンドリング

### エラー分類と対応

1. **バリデーションエラー**
   - モデル構成エラー
   - パラメータ範囲エラー
   - ファイル形式エラー

2. **実行時エラー**
   - OpenWAM実行エラー
   - ファイルI/Oエラー
   - メモリ不足エラー

3. **システムエラー**
   - サーバー起動エラー
   - データベース接続エラー
   - 権限エラー

### エラー処理戦略

```typescript
interface AppError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

// エラーハンドリングミドルウェア
const errorHandler = (error: AppError, req: Request, res: Response, next: NextFunction) => {
  // ログ記録
  logger.log(error.severity, error.message, error.details);
  
  // クライアントへの応答
  res.status(getHttpStatus(error.code)).json({
    error: {
      code: error.code,
      message: error.message,
      ...(process.env.NODE_ENV === 'development' && { details: error.details })
    }
  });
};
```

## テスト戦略

### テスト分類

1. **ユニットテスト**
   - ビジネスロジック
   - ユーティリティ関数
   - データ変換処理

2. **統合テスト**
   - API エンドポイント
   - データベース操作
   - ファイル操作

3. **E2Eテスト**
   - ユーザーワークフロー
   - シミュレーション実行
   - ファイルアップロード/ダウンロード

### テストツール

- **フロントエンド**: Jest, React Testing Library, Cypress
- **バックエンド**: Jest, Supertest
- **E2E**: Playwright または Cypress

## セキュリティ考慮事項

### ローカル環境でのセキュリティ

1. **ファイルアクセス制御**
   - アプリケーションディレクトリ外へのアクセス制限
   - ファイルタイプ検証
   - ファイルサイズ制限

2. **プロセス実行制御**
   - OpenWAM実行時のサンドボックス化
   - タイムアウト設定
   - リソース使用量制限

3. **入力検証**
   - パラメータ値の範囲チェック
   - SQLインジェクション対策
   - XSS対策

## パフォーマンス最適化

### フロントエンド最適化

1. **コード分割**
   - ルートベースの遅延読み込み
   - コンポーネントの動的インポート

2. **状態管理最適化**
   - Redux Toolkit または Zustand
   - メモ化の活用

3. **レンダリング最適化**
   - 仮想化リスト
   - Canvas最適化

### バックエンド最適化

1. **非同期処理**
   - シミュレーション実行の非同期化
   - ファイル操作の並列化

2. **キャッシュ戦略**
   - 計算結果のキャッシュ
   - ファイルメタデータのキャッシュ

3. **リソース管理**
   - メモリ使用量監視
   - プロセス数制限
# バグ記録・分類システム

## 概要

OpenWAM Engine Simulator WebアプリケーションのバグトラッキングシステムはUIテストとバグ洗い出しプロセスで発見された問題を体系的に記録、分類、管理するためのシステムです。

## システム構成

### 1. バグ記録テンプレート

#### 基本テンプレート構造

```typescript
interface BugReportTemplate {
  title: string;           // バグのタイトル
  description: string;     // 詳細説明
  reproductionSteps: BugReproductionStep[];  // 再現手順
  expectedBehavior: string;    // 期待される動作
  actualBehavior: string;      // 実際の動作
  environment: BugEnvironment; // 環境情報
  attachments: BugAttachment[]; // 添付ファイル
}
```

#### 利用可能なテンプレート

1. **UIコンポーネント表示問題**
   - UIコンポーネントが正しく表示されない問題
   - 必須フィールド: title, description, reproductionSteps, environment

2. **コンポーネント接続エラー**
   - コンポーネント間の接続が失敗する問題
   - 必須フィールド: componentIds, connectionDetails

3. **ファイルアップロード失敗**
   - ファイル操作が失敗する問題
   - 必須フィールド: fileInfo, errorMessage

4. **シミュレーション実行エラー**
   - シミュレーションの実行が失敗する問題
   - 必須フィールド: modelData, simulationSettings

5. **レンダリング性能問題**
   - UIのレンダリングが遅い性能問題
   - 必須フィールド: performanceMetrics

6. **ブラウザ互換性問題**
   - 特定のブラウザで機能が動作しない問題
   - 必須フィールド: browserInfo, compatibilityDetails

7. **バリデーションエラー**
   - 不正なバリデーションエラーが表示される問題
   - 必須フィールド: validationRules, inputData

8. **データ損失問題**
   - ユーザーデータが予期せず失われる問題
   - 必須フィールド: dataDetails, lossCircumstances

### 2. 重要度分類システム

#### 深刻度レベル

- **Critical (緊急)**: システムクラッシュ、データ損失、セキュリティ問題
- **High (高)**: 主要機能の停止、重大なUI問題
- **Medium (中)**: 軽微な機能問題、パフォーマンス問題
- **Low (低)**: 改善提案、軽微なUI問題

#### 優先度計算アルゴリズム

優先度は以下の要因を総合的に評価して0-100のスコアで算出されます：

1. **深刻度スコア (0-10)**
   - Critical: 10, High: 7, Medium: 4, Low: 2

2. **ユーザー影響度スコア (0-10)**
   - カテゴリによる基本スコア
   - エラーメッセージの存在
   - プロジェクトデータへの影響
   - 複数コンポーネントへの影響

3. **頻度スコア (0-10)**
   - 関連バグの数
   - 特定のタグによる推定
   - ブラウザ互換性問題の一般性

4. **ビジネス影響度スコア (0-10)**
   - 重要機能への影響
   - バグタイプによる影響
   - データ損失の可能性
   - セキュリティ関連

5. **技術的複雑度スコア (0-10)**
   - デバッグ情報の豊富さ
   - 再現手順の詳細度
   - 環境依存性
   - 複数コンポーネント関連

#### 推奨アクション

- **90-100点**: 緊急対応 (1時間以内)
- **75-89点**: 高優先度対応 (当日中)
- **50-74点**: 通常対応 (1週間以内)
- **25-49点**: 低優先度対応 (1ヶ月以内)
- **0-24点**: 将来対応 (次期バージョン)

### 3. ブラウザ固有問題記録システム

#### 対象ブラウザ

- Chrome 90+ (Windows, macOS, Linux)
- Firefox 88+ (Windows, macOS, Linux)
- Safari 14+ (macOS)
- Edge 90+ (Windows)

#### ブラウザ固有情報の記録

```typescript
interface BrowserSpecificInfo {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  screenResolution: string;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  userAgent: string;
  supportedFeatures: string[];
  knownIssues: string[];
}
```

#### 互換性問題の分類

1. **CSS/レイアウト問題**
   - ブラウザ固有のCSS実装差異
   - レスポンシブデザインの問題

2. **JavaScript API問題**
   - ブラウザAPIの実装差異
   - ポリフィルが必要な機能

3. **パフォーマンス問題**
   - ブラウザエンジンによる性能差
   - メモリ使用量の差異

4. **ファイル操作問題**
   - ファイルアップロード/ダウンロードの制限
   - MIME type の扱いの差異

### 4. パフォーマンス問題記録システム

#### 測定指標

```typescript
interface PerformanceMetrics {
  loadTime?: number;        // 読み込み時間 (ms)
  renderTime?: number;      // レンダリング時間 (ms)
  memoryUsage?: number;     // メモリ使用量 (MB)
  cpuUsage?: number;        // CPU使用率 (%)
  networkRequests?: number; // ネットワークリクエスト数
  errorCount?: number;      // エラー発生数
  componentCount?: number;  // コンポーネント数
  connectionCount?: number; // 接続数
}
```

#### パフォーマンス問題の分類

1. **読み込み性能**
   - 初期読み込み時間
   - リソース読み込み時間

2. **レンダリング性能**
   - UI描画時間
   - アニメーション性能

3. **操作性能**
   - ユーザー操作の応答時間
   - 大規模データ処理時間

4. **メモリ性能**
   - メモリ使用量
   - メモリリーク

#### 自動パフォーマンス監視

```typescript
// 使用例
BugReporter.getInstance().reportPerformanceIssue(
  'Component Rendering',
  3500, // 実際の時間 (ms)
  2000, // 期待時間 (ms)
  {
    memoryUsage: 150,
    componentCount: 50,
    connectionCount: 25
  }
);
```

### 5. バグ修正優先度決定基準

#### 優先度決定マトリックス

| 深刻度 | データ損失 | ユーザー影響 | 頻度 | 優先度 |
|--------|------------|--------------|------|--------|
| Critical | あり | 高 | 高 | 緊急 |
| Critical | あり | 高 | 低 | 高 |
| Critical | なし | 高 | 高 | 高 |
| High | あり | 中 | 高 | 高 |
| High | なし | 高 | 中 | 中 |
| Medium | なし | 中 | 中 | 中 |
| Low | なし | 低 | 低 | 低 |

#### 修正順序の決定要因

1. **データ整合性への影響**
   - データ損失の可能性
   - データ破損の可能性

2. **セキュリティへの影響**
   - セキュリティホールの存在
   - 機密情報の漏洩可能性

3. **ユーザー体験への影響**
   - 主要機能の利用可能性
   - 操作性への影響

4. **ビジネス影響**
   - 開発効率への影響
   - リリーススケジュールへの影響

5. **修正コスト**
   - 技術的複雑度
   - 必要な開発時間

## API使用方法

### バグレポートの作成

```typescript
// 手動でバグレポートを作成
const bugReport = BugReporter.getInstance().createManualBugReport(
  'コンポーネント配置エラー',
  'パイプコンポーネントがキャンバスに配置できない',
  BugSeverity.HIGH,
  BugCategory.FUNCTIONALITY,
  [
    'プロジェクトエディターを開く',
    'コンポーネントパレットから「1Dパイプ」を選択',
    'キャンバス上にドラッグ&ドロップ'
  ],
  'パイプコンポーネントがキャンバスに配置される',
  'エラーメッセージが表示され、配置に失敗する',
  {
    projectId: 123,
    componentIds: ['pipe_1'],
    tags: ['drag-drop', 'component-placement'],
    errorMessage: 'Invalid component position'
  }
);

// APIに送信
fetch('/api/bugs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bugReport)
});
```

### 自動バグレポート

```typescript
// JavaScript エラーの自動レポート
window.addEventListener('error', (event) => {
  BugReporter.getInstance().reportJavaScriptError(
    event.error,
    undefined,
    {
      projectId: getCurrentProjectId(),
      userAction: getLastUserAction()
    }
  );
});

// パフォーマンス問題の自動レポート
const startTime = performance.now();
await performHeavyOperation();
const endTime = performance.now();

if (endTime - startTime > 2000) {
  BugReporter.getInstance().reportPerformanceIssue(
    'Heavy Operation',
    endTime - startTime,
    2000
  );
}
```

### バグ統計の取得

```typescript
// バグ統計を取得
const response = await fetch('/api/bugs/statistics');
const statistics = await response.json();

console.log('総バグ数:', statistics.data.total);
console.log('重要度別:', statistics.data.bySeverity);
console.log('カテゴリ別:', statistics.data.byCategory);
```

## データベーススキーマ

### bug_reports テーブル

```sql
CREATE TABLE bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')) NOT NULL,
  status TEXT CHECK(status IN ('open', 'in_progress', 'resolved', 'closed', 'duplicate', 'wont_fix')) DEFAULT 'open',
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  reported_by TEXT NOT NULL,
  reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  environment_data TEXT, -- JSON
  reproduction_steps TEXT, -- JSON
  expected_behavior TEXT NOT NULL,
  actual_behavior TEXT NOT NULL,
  error_message TEXT,
  stack_trace TEXT,
  console_errors TEXT, -- JSON
  performance_metrics TEXT, -- JSON
  project_id INTEGER,
  model_data TEXT,
  component_ids TEXT, -- JSON
  priority_score INTEGER DEFAULT 0,
  priority_factors TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### bug_comments テーブル

```sql
CREATE TABLE bug_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bug_id) REFERENCES bug_reports(id) ON DELETE CASCADE
);
```

### bug_attachments テーブル

```sql
CREATE TABLE bug_attachments (
  id TEXT PRIMARY KEY,
  bug_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT CHECK(file_type IN ('screenshot', 'video', 'log', 'model', 'other')) NOT NULL,
  file_size INTEGER NOT NULL,
  description TEXT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bug_id) REFERENCES bug_reports(id) ON DELETE CASCADE
);
```

## 使用ガイドライン

### バグレポート作成時の注意点

1. **明確なタイトル**: 問題を簡潔に表現
2. **詳細な説明**: 問題の背景と影響を記述
3. **再現手順**: 他の人が同じ問題を再現できるよう詳細に記述
4. **スクリーンショット**: 視覚的な問題は必ずスクリーンショットを添付
5. **環境情報**: ブラウザ、OS、画面解像度などを記録

### 優先度設定のガイドライン

1. **Critical**: システムクラッシュ、データ損失、セキュリティ問題
2. **High**: 主要機能が使用不可、重大なUI問題
3. **Medium**: 軽微な機能問題、パフォーマンス問題
4. **Low**: 改善提案、軽微なUI問題

### バグ修正プロセス

1. **トリアージ**: 新しいバグの優先度を決定
2. **割り当て**: 適切な開発者に割り当て
3. **修正**: バグの修正を実装
4. **テスト**: 修正の検証とテスト
5. **クローズ**: バグの解決を確認

## 今後の拡張予定

1. **自動テスト連携**: E2Eテストの失敗を自動的にバグレポートに変換
2. **AI分析**: 類似バグの自動検出と分類
3. **ダッシュボード**: バグ統計とトレンドの可視化
4. **通知システム**: 重要なバグの即座通知
5. **外部ツール連携**: GitHub Issues、Jiraとの連携
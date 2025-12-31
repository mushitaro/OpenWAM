import { BugTemplate, BugCategory, BugType, BugSeverity } from '../types/bugTracking';

export const BUG_TEMPLATES: BugTemplate[] = [
  {
    id: 'ui_component_not_rendering',
    name: 'UIコンポーネントが表示されない',
    description: 'UIコンポーネントが正しく表示されない問題',
    category: BugCategory.UI_UX,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.HIGH,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior', 'environment'],
    template: {
      title: 'UIコンポーネントが表示されない: [コンポーネント名]',
      description: `## 問題の概要
[コンポーネント名]が期待通りに表示されません。

## 影響範囲
- 影響を受ける機能: 
- 影響を受けるユーザー: 

## 追加情報
- エラーメッセージ: 
- コンソールエラー: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: 'アプリケーションを開く',
          expectedResult: 'アプリケーションが正常に読み込まれる',
          actualResult: ''
        },
        {
          stepNumber: 2,
          action: '[具体的な操作を記述]',
          expectedResult: '[期待される結果を記述]',
          actualResult: '[実際の結果を記述]'
        }
      ],
      expectedBehavior: '[コンポーネント名]が正しく表示される',
      tags: ['ui', 'rendering', 'component']
    }
  },
  {
    id: 'component_connection_failure',
    name: 'コンポーネント接続エラー',
    description: 'コンポーネント間の接続が失敗する問題',
    category: BugCategory.FUNCTIONALITY,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.HIGH,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior', 'componentIds'],
    template: {
      title: 'コンポーネント接続エラー: [コンポーネントA] → [コンポーネントB]',
      description: `## 問題の概要
[コンポーネントA]と[コンポーネントB]の接続が失敗します。

## 関連コンポーネント
- 接続元: [コンポーネントA] (ID: )
- 接続先: [コンポーネントB] (ID: )
- 接続タイプ: 

## エラー詳細
- エラーメッセージ: 
- 接続バリデーション結果: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: 'プロジェクトエディターを開く',
          expectedResult: 'エディターが正常に表示される'
        },
        {
          stepNumber: 2,
          action: '[コンポーネントA]をキャンバスに配置',
          expectedResult: 'コンポーネントが配置される'
        },
        {
          stepNumber: 3,
          action: '[コンポーネントB]をキャンバスに配置',
          expectedResult: 'コンポーネントが配置される'
        },
        {
          stepNumber: 4,
          action: '[コンポーネントA]から[コンポーネントB]への接続を試行',
          expectedResult: '接続が成功する',
          actualResult: '接続が失敗する'
        }
      ],
      expectedBehavior: 'コンポーネント間の接続が正常に作成される',
      tags: ['connection', 'validation', 'components']
    }
  },
  {
    id: 'file_upload_failure',
    name: 'ファイルアップロード失敗',
    description: 'ファイルのアップロードが失敗する問題',
    category: BugCategory.FILE_OPERATIONS,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.MEDIUM,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior'],
    template: {
      title: 'ファイルアップロード失敗: [ファイル形式]',
      description: `## 問題の概要
[ファイル形式]ファイルのアップロードが失敗します。

## ファイル詳細
- ファイル名: 
- ファイルサイズ: 
- ファイル形式: 
- ファイルの内容: 

## エラー詳細
- エラーメッセージ: 
- HTTPステータスコード: 
- ネットワークエラー: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: 'ファイル管理画面を開く',
          expectedResult: 'ファイル管理画面が表示される'
        },
        {
          stepNumber: 2,
          action: '「ファイルアップロード」ボタンをクリック',
          expectedResult: 'ファイル選択ダイアログが開く'
        },
        {
          stepNumber: 3,
          action: '[問題のファイル]を選択',
          expectedResult: 'ファイルが選択される'
        },
        {
          stepNumber: 4,
          action: 'アップロードを実行',
          expectedResult: 'ファイルが正常にアップロードされる',
          actualResult: 'アップロードが失敗する'
        }
      ],
      expectedBehavior: 'ファイルが正常にアップロードされ、処理される',
      tags: ['file-upload', 'file-operations', 'server']
    }
  },
  {
    id: 'simulation_execution_error',
    name: 'シミュレーション実行エラー',
    description: 'シミュレーションの実行が失敗する問題',
    category: BugCategory.SIMULATION,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.CRITICAL,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior', 'modelData'],
    template: {
      title: 'シミュレーション実行エラー: [エラーの種類]',
      description: `## 問題の概要
シミュレーションの実行が[エラーの種類]で失敗します。

## モデル詳細
- プロジェクト名: 
- コンポーネント数: 
- 接続数: 
- モデルの複雑さ: 

## シミュレーション設定
- 時間刻み: 
- 総時間: 
- エンジン回転数: 

## エラー詳細
- OpenWAMエラーメッセージ: 
- 実行ログ: 
- 終了コード: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: 'プロジェクトを開く',
          expectedResult: 'プロジェクトが正常に読み込まれる'
        },
        {
          stepNumber: 2,
          action: 'シミュレーションタブに移動',
          expectedResult: 'シミュレーション設定画面が表示される'
        },
        {
          stepNumber: 3,
          action: 'シミュレーション設定を確認',
          expectedResult: '設定が正しく表示される'
        },
        {
          stepNumber: 4,
          action: '「シミュレーション開始」ボタンをクリック',
          expectedResult: 'シミュレーションが開始される',
          actualResult: 'エラーが発生してシミュレーションが失敗する'
        }
      ],
      expectedBehavior: 'シミュレーションが正常に実行され、結果が表示される',
      tags: ['simulation', 'openwam', 'execution', 'critical']
    }
  },
  {
    id: 'performance_slow_rendering',
    name: 'レンダリング性能問題',
    description: 'UIのレンダリングが遅い性能問題',
    category: BugCategory.PERFORMANCE,
    type: BugType.PERFORMANCE_ISSUE,
    defaultSeverity: BugSeverity.MEDIUM,
    requiredFields: ['title', 'description', 'reproductionSteps', 'performanceMetrics'],
    template: {
      title: 'レンダリング性能問題: [具体的な画面/機能]',
      description: `## 問題の概要
[具体的な画面/機能]のレンダリングが期待より遅くなっています。

## 性能指標
- 期待される読み込み時間: 
- 実際の読み込み時間: 
- 影響を受ける操作: 

## システム環境
- CPU: 
- メモリ: 
- GPU: 
- ストレージ: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: 'ブラウザの開発者ツールを開く',
          expectedResult: '開発者ツールが表示される'
        },
        {
          stepNumber: 2,
          action: 'Performanceタブを選択',
          expectedResult: 'パフォーマンス測定の準備ができる'
        },
        {
          stepNumber: 3,
          action: '[問題の操作]を実行',
          expectedResult: '操作が迅速に完了する',
          actualResult: '操作の完了に時間がかかる'
        }
      ],
      expectedBehavior: '[具体的な画面/機能]が2秒以内に表示される',
      tags: ['performance', 'rendering', 'ui', 'slow']
    }
  },
  {
    id: 'browser_compatibility_issue',
    name: 'ブラウザ互換性問題',
    description: '特定のブラウザで機能が正しく動作しない問題',
    category: BugCategory.BROWSER_COMPATIBILITY,
    type: BugType.COMPATIBILITY_ISSUE,
    defaultSeverity: BugSeverity.MEDIUM,
    requiredFields: ['title', 'description', 'reproductionSteps', 'environment'],
    template: {
      title: 'ブラウザ互換性問題: [ブラウザ名] - [機能名]',
      description: `## 問題の概要
[ブラウザ名]で[機能名]が正しく動作しません。

## 影響範囲
- 影響を受けるブラウザ: 
- 影響を受けるバージョン: 
- 正常に動作するブラウザ: 

## 互換性詳細
- 使用している機能: 
- 代替手段の有無: 
- ポリフィルの必要性: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: '[ブラウザ名]でアプリケーションを開く',
          expectedResult: 'アプリケーションが正常に読み込まれる'
        },
        {
          stepNumber: 2,
          action: '[問題の機能]を使用',
          expectedResult: '機能が正常に動作する',
          actualResult: '機能が動作しない、またはエラーが発生する'
        }
      ],
      expectedBehavior: 'すべてのサポート対象ブラウザで機能が正常に動作する',
      tags: ['browser-compatibility', 'cross-browser', 'compatibility']
    }
  },
  {
    id: 'validation_error_incorrect',
    name: '不正なバリデーションエラー',
    description: '正しい入力に対して不正なバリデーションエラーが表示される問題',
    category: BugCategory.VALIDATION,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.HIGH,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior'],
    template: {
      title: '不正なバリデーションエラー: [フィールド名/機能名]',
      description: `## 問題の概要
[フィールド名/機能名]で正しい値を入力しているにも関わらず、バリデーションエラーが表示されます。

## 入力詳細
- 入力値: 
- 期待される動作: 
- バリデーションルール: 
- エラーメッセージ: 

## 関連情報
- 関連するコンポーネント: 
- バリデーション条件: `,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: '[該当画面]を開く',
          expectedResult: '画面が正常に表示される'
        },
        {
          stepNumber: 2,
          action: '[フィールド名]に正しい値を入力',
          expectedResult: '入力が受け入れられる',
          actualResult: 'バリデーションエラーが表示される'
        }
      ],
      expectedBehavior: '正しい入力値に対してバリデーションエラーが表示されない',
      tags: ['validation', 'input', 'error', 'false-positive']
    }
  },
  {
    id: 'data_loss_issue',
    name: 'データ損失問題',
    description: 'ユーザーデータが予期せず失われる問題',
    category: BugCategory.DATA_INTEGRITY,
    type: BugType.BUG,
    defaultSeverity: BugSeverity.CRITICAL,
    requiredFields: ['title', 'description', 'reproductionSteps', 'expectedBehavior', 'actualBehavior'],
    template: {
      title: 'データ損失問題: [データの種類]',
      description: `## 問題の概要
[データの種類]が予期せず失われています。

## 損失データ詳細
- データの種類: 
- 損失したデータ量: 
- 最後に確認できた時刻: 
- 損失が発見された時刻: 

## 影響範囲
- 影響を受けるプロジェクト: 
- 影響を受けるユーザー: 
- 復旧可能性: 

## 緊急度
この問題は重要なユーザーデータの損失を伴うため、最優先で対応が必要です。`,
      reproductionSteps: [
        {
          stepNumber: 1,
          action: '[データ作成/編集操作]を実行',
          expectedResult: 'データが正常に保存される'
        },
        {
          stepNumber: 2,
          action: '[特定の操作/条件]',
          expectedResult: 'データが保持される',
          actualResult: 'データが失われる'
        }
      ],
      expectedBehavior: 'ユーザーデータが常に安全に保存され、失われることがない',
      tags: ['data-loss', 'critical', 'data-integrity', 'urgent']
    }
  }
];

export function getBugTemplateById(id: string): BugTemplate | undefined {
  return BUG_TEMPLATES.find(template => template.id === id);
}

export function getBugTemplatesByCategory(category: BugCategory): BugTemplate[] {
  return BUG_TEMPLATES.filter(template => template.category === category);
}

export function getBugTemplatesByType(type: BugType): BugTemplate[] {
  return BUG_TEMPLATES.filter(template => template.type === type);
}
/**
 * Documentation Updater Service
 * Automatically updates implementation status documentation based on component management system data
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentManagementSystem,
  ImplementationStatus,
  Priority,
  QualityCheckType,
  ComponentImplementationRecord,
  ImplementationProgressReport
} from './ComponentManagementSystem';

import { ComponentCategory, ComponentType } from '../types/openWAMComponents';

// ============================================================================
// DOCUMENTATION UPDATER CLASS
// ============================================================================

export class DocumentationUpdater {
  private managementSystem: ComponentManagementSystem;
  private docsPath: string;

  constructor(managementSystem: ComponentManagementSystem, docsPath: string = 'docs') {
    this.managementSystem = managementSystem;
    this.docsPath = docsPath;
  }

  /**
   * Update the component implementation status document
   */
  async updateImplementationStatusDocument(): Promise<void> {
    const report = this.managementSystem.generateProgressReport();
    const allRecords = this.managementSystem.getAllImplementationRecords();
    
    const content = this.generateImplementationStatusMarkdown(report, allRecords);
    
    const filePath = path.join(this.docsPath, 'component-implementation-status.md');
    await this.writeFile(filePath, content);
  }

  /**
   * Update the component reference document
   */
  async updateComponentReferenceDocument(): Promise<void> {
    const allRecords = this.managementSystem.getAllImplementationRecords();
    
    const content = this.generateComponentReferenceMarkdown(allRecords);
    
    const filePath = path.join(this.docsPath, 'component-reference.md');
    await this.writeFile(filePath, content);
  }

  /**
   * Update the VANOS implementation roadmap
   */
  async updateVANOSRoadmapDocument(): Promise<void> {
    const vanosRecords = this.managementSystem.getRecordsByCategory(ComponentCategory.CONTROL);
    const report = this.managementSystem.generateProgressReport();
    
    const content = this.generateVANOSRoadmapMarkdown(vanosRecords, report);
    
    const filePath = path.join(this.docsPath, 'vanos-implementation-roadmap.md');
    await this.writeFile(filePath, content);
  }

  /**
   * Update all documentation files
   */
  async updateAllDocumentation(): Promise<void> {
    await Promise.all([
      this.updateImplementationStatusDocument(),
      this.updateComponentReferenceDocument(),
      this.updateVANOSRoadmapDocument()
    ]);
  }

  // ============================================================================
  // MARKDOWN GENERATORS
  // ============================================================================

  /**
   * Generate implementation status markdown content
   */
  private generateImplementationStatusMarkdown(
    report: ImplementationProgressReport,
    records: ComponentImplementationRecord[]
  ): string {
    const now = new Date();
    
    let content = `# OpenWAM Component Implementation Status

## 実装状況追跡表

**最終更新**: ${now.toLocaleDateString('ja-JP')} ${now.toLocaleTimeString('ja-JP')}

### 凡例

- ✅ **完了**: 実装済み、テスト済み
- 🚧 **進行中**: 実装中
- ❌ **未実装**: 未着手
- 🔄 **計画中**: 実装計画済み
- 📝 **テスト済み**: テスト完了
- 📚 **文書化済み**: ドキュメント完了

## 全体進捗サマリー

| 指標 | 値 | 進捗 |
|------|----|----|
| 総コンポーネント数 | ${report.totalComponents} | - |
| 完了済み | ${report.completedComponents} | ${report.completionPercentage.toFixed(1)}% |
| 進行中 | ${report.inProgressComponents} | ${((report.inProgressComponents / report.totalComponents) * 100).toFixed(1)}% |
| 未着手 | ${report.notStartedComponents} | ${((report.notStartedComponents / report.totalComponents) * 100).toFixed(1)}% |

### 進捗バー
\`\`\`
${'█'.repeat(Math.floor(report.completionPercentage / 5))}${'░'.repeat(20 - Math.floor(report.completionPercentage / 5))} ${report.completionPercentage.toFixed(1)}%
\`\`\`

## カテゴリ別進捗

| カテゴリ | 総数 | 完了 | 進捗率 | 状況 |
|---------|------|------|-------|------|
`;

    Object.entries(report.categoryBreakdown).forEach(([category, data]) => {
      const progressBar = '█'.repeat(Math.floor(data.percentage / 10)) + '░'.repeat(10 - Math.floor(data.percentage / 10));
      content += `| ${this.getCategoryDisplayName(category as ComponentCategory)} | ${data.total} | ${data.completed} | ${data.percentage.toFixed(1)}% | \`${progressBar}\` |\n`;
    });

    content += `
## 優先度別進捗

| 優先度 | 総数 | 完了 | 進捗率 |
|--------|------|------|-------|
`;

    Object.entries(report.priorityBreakdown).forEach(([priority, data]) => {
      content += `| ${this.getPriorityDisplayName(priority as Priority)} | ${data.total} | ${data.completed} | ${data.percentage.toFixed(1)}% |\n`;
    });

    content += `
## 品質メトリクス

| メトリクス | 値 |
|-----------|-----|
| 平均テストカバレッジ | ${report.qualityMetrics.averageTestCoverage.toFixed(1)}% |
| ドキュメント完備コンポーネント | ${report.qualityMetrics.componentsWithDocumentation} |
| 完全検証済みコンポーネント | ${report.qualityMetrics.componentsWithFullValidation} |

## 詳細実装状況

`;

    // Group records by category
    const recordsByCategory = new Map<ComponentCategory, ComponentImplementationRecord[]>();
    records.forEach(record => {
      if (!recordsByCategory.has(record.category)) {
        recordsByCategory.set(record.category, []);
      }
      recordsByCategory.get(record.category)!.push(record);
    });

    recordsByCategory.forEach((categoryRecords, category) => {
      content += `### ${this.getCategoryDisplayName(category)}\n\n`;
      content += `| # | OpenWAMクラス | 状況 | 実装日 | 担当者 | テスト状況 | 品質スコア | 備考 |\n`;
      content += `|---|--------------|------|--------|--------|-----------|-----------|------|\n`;

      categoryRecords.forEach((record, index) => {
        const statusIcon = this.getStatusIcon(record.status);
        const testStatusIcon = this.getStatusIcon(record.testStatus);
        const qualityScore = this.calculateQualityScore(record);
        const implementationDate = record.implementationDate 
          ? record.implementationDate.toLocaleDateString('ja-JP')
          : '-';
        
        content += `| ${index + 1} | ${record.openWAMClass} | ${statusIcon} | ${implementationDate} | ${record.assignee || '-'} | ${testStatusIcon} | ${qualityScore}/100 | ${this.getComponentTypeName(record.componentType)} |\n`;
      });

      content += '\n';
    });

    // Add blocked components section if any
    if (report.blockedComponents.length > 0) {
      content += `## ブロックされたコンポーネント

以下のコンポーネントは依存関係により実装がブロックされています：

| コンポーネント | ブロック理由 | 依存関係 |
|---------------|-------------|----------|
`;

      report.blockedComponents.forEach(record => {
        const dependencies = record.dependencies
          .map(dep => this.getComponentTypeName(dep))
          .join(', ');
        
        content += `| ${this.getComponentTypeName(record.componentType)} | 依存関係未完了 | ${dependencies} |\n`;
      });

      content += '\n';
    }

    content += `
## 実装計画

### Phase 1: 基本制御コンポーネント（完了）

| 優先度 | コンポーネント | 推定工数 | 依存関係 | 完了状況 |
|--------|---------------|----------|----------|----------|
`;

    const phase1Components = [
      ComponentType.SENSOR,
      ComponentType.TABLE_1D,
      ComponentType.CONTROLLER,
      ComponentType.PID_CONTROLLER,
      ComponentType.CONTROL_VALVE,
      ComponentType.PIPE_TO_PLENUM
    ];

    phase1Components.forEach((componentType, index) => {
      const record = this.managementSystem.getImplementationRecord(componentType);
      if (record) {
        const dependencies = record.dependencies.length > 0 
          ? record.dependencies.map(dep => this.getComponentTypeName(dep)).join(', ')
          : 'なし';
        
        content += `| ${index + 1} | ${this.getComponentTypeName(componentType)} | ${record.estimatedEffort}日 | ${dependencies} | ${this.getStatusIcon(record.status)} |\n`;
      }
    });

    content += `
### 今後の実装予定

次の実装対象コンポーネント（優先度順）：

`;

    const notStartedRecords = records
      .filter(r => r.status === ImplementationStatus.NOT_STARTED)
      .sort((a, b) => {
        const priorityOrder = { [Priority.CRITICAL]: 0, [Priority.HIGH]: 1, [Priority.MEDIUM]: 2, [Priority.LOW]: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, 10);

    notStartedRecords.forEach((record, index) => {
      content += `${index + 1}. **${this.getComponentTypeName(record.componentType)}** (${this.getPriorityDisplayName(record.priority)}) - ${record.estimatedEffort}日\n`;
    });

    content += `
---

*このドキュメントは自動生成されます。最新の状況は Component Management System で確認してください。*
`;

    return content;
  }

  /**
   * Generate component reference markdown content
   */
  private generateComponentReferenceMarkdown(records: ComponentImplementationRecord[]): string {
    const now = new Date();
    
    let content = `# OpenWAM Component Reference

**最終更新**: ${now.toLocaleDateString('ja-JP')} ${now.toLocaleTimeString('ja-JP')}

このドキュメントは、OpenWAMエンジンシミュレーターで利用可能なすべてのコンポーネントの詳細リファレンスです。

## 目次

`;

    // Generate table of contents
    const categories = Array.from(new Set(records.map(r => r.category)));
    categories.forEach(category => {
      content += `- [${this.getCategoryDisplayName(category)}](#${category.toLowerCase()})\n`;
    });

    content += '\n';

    // Generate content for each category
    categories.forEach(category => {
      const categoryRecords = records.filter(r => r.category === category);
      
      content += `## ${this.getCategoryDisplayName(category)} {#${category.toLowerCase()}}\n\n`;
      
      categoryRecords.forEach(record => {
        content += `### ${this.getComponentTypeName(record.componentType)}\n\n`;
        content += `**OpenWAMクラス**: \`${record.openWAMClass}\`\n\n`;
        content += `**実装状況**: ${this.getStatusIcon(record.status)} ${this.getStatusDisplayName(record.status)}\n\n`;
        content += `**優先度**: ${this.getPriorityDisplayName(record.priority)}\n\n`;
        
        if (record.status === ImplementationStatus.COMPLETED) {
          const qualityChecks = record.qualityChecks;
          if (qualityChecks.length > 0) {
            content += `**品質チェック結果**:\n\n`;
            qualityChecks.forEach(check => {
              const checkIcon = check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
              content += `- ${checkIcon} ${this.getQualityCheckDisplayName(check.type)}: ${check.message}\n`;
            });
            content += '\n';
          }
        }

        if (record.dependencies.length > 0) {
          content += `**依存関係**: ${record.dependencies.map(dep => this.getComponentTypeName(dep)).join(', ')}\n\n`;
        }

        if (record.notes.length > 0) {
          content += `**実装ノート**:\n\n`;
          record.notes.slice(-3).forEach(note => {
            content += `- ${note}\n`;
          });
          content += '\n';
        }

        content += '---\n\n';
      });
    });

    return content;
  }

  /**
   * Generate VANOS roadmap markdown content
   */
  private generateVANOSRoadmapMarkdown(
    vanosRecords: ComponentImplementationRecord[],
    report: ImplementationProgressReport
  ): string {
    const now = new Date();
    
    let content = `# VANOS Implementation Roadmap

**最終更新**: ${now.toLocaleDateString('ja-JP')} ${now.toLocaleTimeString('ja-JP')}

このドキュメントは、BMW E46 M3 VANOSシステムの実装ロードマップです。

## VANOS制御システム概要

VANOSは可変バルブタイミングシステムで、以下のコンポーネントで構成されます：

### 制御ループ構成

\`\`\`
センサー → コントローラー → PIDコントローラー → 制御バルブ
    ↑              ↑
1Dテーブル    パイプ-プレナム接続
(VANOSマップ)
\`\`\`

## 実装進捗

### 制御システムコンポーネント

| コンポーネント | 状況 | 品質スコア | 実装日 | 備考 |
|---------------|------|-----------|--------|------|
`;

    vanosRecords.forEach(record => {
      const statusIcon = this.getStatusIcon(record.status);
      const qualityScore = this.calculateQualityScore(record);
      const implementationDate = record.implementationDate 
        ? record.implementationDate.toLocaleDateString('ja-JP')
        : '-';
      
      content += `| ${this.getComponentTypeName(record.componentType)} | ${statusIcon} | ${qualityScore}/100 | ${implementationDate} | ${record.openWAMClass} |\n`;
    });

    const controlProgress = vanosRecords.filter(r => r.status === ImplementationStatus.COMPLETED).length;
    const controlTotal = vanosRecords.length;
    const controlPercentage = controlTotal > 0 ? (controlProgress / controlTotal) * 100 : 0;

    content += `
### 進捗サマリー

- **完了**: ${controlProgress}/${controlTotal} (${controlPercentage.toFixed(1)}%)
- **平均品質スコア**: ${this.calculateAverageQualityScore(vanosRecords).toFixed(1)}/100

## 実装フェーズ

### Phase 1: 基本制御コンポーネント ✅

すべての基本制御コンポーネントの実装が完了しました：

1. ✅ **TSensor** - カムポジションセンサー、クランクセンサー
2. ✅ **TTable1D** - VANOSマップテーブル
3. ✅ **TController** - VANOS制御ロジック
4. ✅ **TPIDController** - VANOS PID制御
5. ✅ **TValvulaContr** - VANOS油圧制御バルブ
6. ✅ **TCCDeposito** - パイプ-プレナム結合

### Phase 2: 制御系拡張（推奨）

| 優先度 | コンポーネント | 推定工数 | 依存関係 | 状況 |
|--------|---------------|----------|----------|------|
| 7 | TDecisor | 2日 | TController | 未実装 |
| 8 | TGain | 1日 | なし | 未実装 |

### Phase 3: 高度な制御機能（将来）

| 優先度 | コンポーネント | 推定工数 | 依存関係 | 状況 |
|--------|---------------|----------|----------|------|
| 9 | TCCCilindro | 3日 | TCilindro4T | 未実装 |
| 10 | TCilindro | 2日 | なし | 未実装 |

## VANOS制御パラメータ

### 推奨設定値

#### PIDコントローラー設定
- **Kp (比例ゲイン)**: 1.0
- **Ki (積分ゲイン)**: 0.1
- **Kd (微分ゲイン)**: 0.05
- **サンプル時間**: 0.01s

#### VANOSタイミング範囲
- **吸気VANOS**: 0-40° (進角)
- **排気VANOS**: 0-20° (進角)

#### センサー設定
- **分解能**: 0.1°
- **フィルター時定数**: 0.01s

## 品質保証

### テスト項目

`;

    vanosRecords.forEach(record => {
      if (record.status === ImplementationStatus.COMPLETED) {
        content += `#### ${this.getComponentTypeName(record.componentType)}\n\n`;
        
        const checklist = this.managementSystem.getChecklist(record.componentType);
        if (checklist) {
          checklist.items.forEach(item => {
            const icon = item.completed ? '✅' : '❌';
            content += `- ${icon} ${item.title}\n`;
          });
          content += '\n';
        }
      }
    });

    content += `
## 既知の問題と制限事項

### 現在の技術的負債

1. **型定義の不整合**: 一部のコンポーネントで型定義が不完全
2. **テストカバレッジ**: 平均${report.qualityMetrics.averageTestCoverage.toFixed(1)}%（目標: 80%以上）
3. **ドキュメント**: ${report.qualityMetrics.componentsWithDocumentation}/${report.totalComponents}コンポーネントで完備

### 解決計画

1. **型定義修正**: 継続的に改善中
2. **テスト強化**: 各コンポーネント実装時にテスト追加
3. **ドキュメント充実**: 自動生成システムで継続更新

## 成功指標

### 短期目標（Phase 1完了時） ✅

- [x] 制御システムの基本動作確認
- [x] 汎用エンジンモデルの構築可能
- [x] 基本的な制御システムシミュレーション実行

### 中期目標（Phase 2完了時）

- [ ] 高度な制御ロジック実装
- [ ] 制御パラメータの最適化機能
- [ ] 詳細な制御性能解析

### 長期目標（Phase 3完了時）

- [ ] 包括的なエンジンシミュレーション
- [ ] 複雑な配管システム対応
- [ ] 産業レベルの解析精度達成

---

*このドキュメントは自動生成されます。最新の状況は Component Management System で確認してください。*
`;

    return content;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      console.error(`Failed to write file ${filePath}:`, error);
      throw error;
    }
  }

  private getStatusIcon(status: ImplementationStatus): string {
    switch (status) {
      case ImplementationStatus.COMPLETED:
        return '✅';
      case ImplementationStatus.IN_PROGRESS:
        return '🚧';
      case ImplementationStatus.TESTED:
        return '📝';
      case ImplementationStatus.DOCUMENTED:
        return '📚';
      case ImplementationStatus.DEPRECATED:
        return '🗑️';
      default:
        return '❌';
    }
  }

  private getStatusDisplayName(status: ImplementationStatus): string {
    switch (status) {
      case ImplementationStatus.COMPLETED:
        return '完了';
      case ImplementationStatus.IN_PROGRESS:
        return '進行中';
      case ImplementationStatus.TESTED:
        return 'テスト済み';
      case ImplementationStatus.DOCUMENTED:
        return '文書化済み';
      case ImplementationStatus.DEPRECATED:
        return '非推奨';
      default:
        return '未実装';
    }
  }

  private getPriorityDisplayName(priority: Priority): string {
    switch (priority) {
      case Priority.CRITICAL:
        return '🔴 緊急';
      case Priority.HIGH:
        return '🟠 高';
      case Priority.MEDIUM:
        return '🟡 中';
      case Priority.LOW:
        return '🟢 低';
      default:
        return '不明';
    }
  }

  private getCategoryDisplayName(category: ComponentCategory): string {
    switch (category) {
      case ComponentCategory.PIPES:
        return '1次元パイプ';
      case ComponentCategory.BOUNDARIES:
        return '境界条件';
      case ComponentCategory.PLENUMS:
        return 'プレナム・0次元モデル';
      case ComponentCategory.VALVES:
        return 'バルブ・接続';
      case ComponentCategory.ENGINE:
        return 'エンジン';
      case ComponentCategory.CONTROL:
        return '制御システム';
      case ComponentCategory.DPF:
        return 'DPF';
      case ComponentCategory.TURBOCHARGER:
        return 'ターボチャージャー';
      case ComponentCategory.EXTERNAL:
        return '外部接続';
      default:
        return category;
    }
  }

  private getComponentTypeName(componentType: ComponentType): string {
    // Convert component type to readable name
    const nameMap: Record<string, string> = {
      [ComponentType.PIPE]: '1Dパイプ',
      [ComponentType.SENSOR]: 'センサー',
      [ComponentType.TABLE_1D]: '1Dテーブル',
      [ComponentType.CONTROLLER]: 'コントローラー',
      [ComponentType.PID_CONTROLLER]: 'PIDコントローラー',
      [ComponentType.CONTROL_VALVE]: '制御バルブ',
      [ComponentType.PIPE_TO_PLENUM]: 'パイプ-プレナム接続',
      [ComponentType.ENGINE_BLOCK]: 'エンジンブロック',
      [ComponentType.CYLINDER_4T]: '4Tシリンダー',
      [ComponentType.CONSTANT_VOLUME_PLENUM]: '定容積プレナム',
      [ComponentType.OPEN_END_ATMOSPHERE]: '開放端（大気）',
      [ComponentType.CLOSED_END]: '閉端'
    };

    return nameMap[componentType] || componentType;
  }

  private getQualityCheckDisplayName(checkType: QualityCheckType): string {
    switch (checkType) {
      case QualityCheckType.TYPE_DEFINITIONS:
        return 'TypeScript型定義';
      case QualityCheckType.PROPERTY_SCHEMA:
        return 'プロパティスキーマ';
      case QualityCheckType.DEFAULT_VALUES:
        return 'デフォルト値';
      case QualityCheckType.VALIDATION_RULES:
        return 'バリデーションルール';
      case QualityCheckType.CONNECTION_RULES:
        return '接続ルール';
      case QualityCheckType.UNIT_TESTS:
        return '単体テスト';
      case QualityCheckType.INTEGRATION_TESTS:
        return '統合テスト';
      case QualityCheckType.DOCUMENTATION:
        return 'ドキュメント';
      case QualityCheckType.OPENWAM_COMPLIANCE:
        return 'OpenWAM準拠性';
      default:
        return checkType;
    }
  }

  private calculateQualityScore(record: ComponentImplementationRecord): number {
    if (record.qualityChecks.length === 0) {
      return 0;
    }

    const weights = {
      [QualityCheckType.TYPE_DEFINITIONS]: 15,
      [QualityCheckType.PROPERTY_SCHEMA]: 15,
      [QualityCheckType.DEFAULT_VALUES]: 10,
      [QualityCheckType.VALIDATION_RULES]: 15,
      [QualityCheckType.CONNECTION_RULES]: 10,
      [QualityCheckType.UNIT_TESTS]: 15,
      [QualityCheckType.INTEGRATION_TESTS]: 10,
      [QualityCheckType.DOCUMENTATION]: 5,
      [QualityCheckType.OPENWAM_COMPLIANCE]: 5
    };

    let totalScore = 0;
    let totalWeight = 0;

    record.qualityChecks.forEach(check => {
      const weight = weights[check.type] || 5;
      let score = 0;

      switch (check.status) {
        case 'pass':
          score = 100;
          break;
        case 'warning':
          score = 70;
          break;
        case 'fail':
          score = 0;
          break;
        default:
          score = 0;
      }

      totalScore += score * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
  }

  private calculateAverageQualityScore(records: ComponentImplementationRecord[]): number {
    const completedRecords = records.filter(r => r.status === ImplementationStatus.COMPLETED);
    if (completedRecords.length === 0) {
      return 0;
    }

    const totalScore = completedRecords.reduce((sum, record) => sum + this.calculateQualityScore(record), 0);
    return totalScore / completedRecords.length;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create documentation updater instance
 */
export function createDocumentationUpdater(
  managementSystem: ComponentManagementSystem,
  docsPath?: string
): DocumentationUpdater {
  return new DocumentationUpdater(managementSystem, docsPath);
}

/**
 * Update all documentation files
 */
export async function updateAllDocumentation(
  managementSystem: ComponentManagementSystem,
  docsPath?: string
): Promise<void> {
  const updater = createDocumentationUpdater(managementSystem, docsPath);
  await updater.updateAllDocumentation();
}
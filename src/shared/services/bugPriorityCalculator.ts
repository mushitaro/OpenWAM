import { BugReport, BugSeverity, BugCategory, BugType, PriorityFactors } from '../types/bugTracking';

export class BugPriorityCalculator {
  
  /**
   * バグの優先度を計算する
   * 複数の要因を考慮して0-100のスコアを算出
   */
  static calculatePriority(bug: BugReport): PriorityFactors {
    const severityScore = this.calculateSeverityScore(bug.severity);
    const userImpactScore = this.calculateUserImpactScore(bug);
    const frequencyScore = this.calculateFrequencyScore(bug);
    const businessImpactScore = this.calculateBusinessImpactScore(bug);
    const technicalComplexityScore = this.calculateTechnicalComplexityScore(bug);

    // 重み付け設定
    const weights = this.getWeights(bug);

    // 総合スコア計算
    const totalScore = Math.round(
      (severityScore * weights.severityWeight +
       userImpactScore * weights.userImpactWeight +
       frequencyScore * weights.frequencyWeight +
       businessImpactScore * weights.businessImpactWeight +
       technicalComplexityScore * weights.technicalComplexityWeight) / 
      (weights.severityWeight + weights.userImpactWeight + weights.frequencyWeight + 
       weights.businessImpactWeight + weights.technicalComplexityWeight) * 100
    );

    return {
      severityWeight: weights.severityWeight,
      userImpactWeight: weights.userImpactWeight,
      frequencyWeight: weights.frequencyWeight,
      businessImpactWeight: weights.businessImpactWeight,
      technicalComplexityWeight: weights.technicalComplexityWeight,
      
      severityScore,
      userImpactScore,
      frequencyScore,
      businessImpactScore,
      technicalComplexityScore,
      
      totalScore: Math.min(100, Math.max(0, totalScore))
    };
  }

  /**
   * 深刻度スコア計算 (0-10)
   */
  private static calculateSeverityScore(severity: BugSeverity): number {
    const severityScores = {
      [BugSeverity.CRITICAL]: 10,
      [BugSeverity.HIGH]: 7,
      [BugSeverity.MEDIUM]: 4,
      [BugSeverity.LOW]: 2
    };
    return severityScores[severity];
  }

  /**
   * ユーザー影響度スコア計算 (0-10)
   */
  private static calculateUserImpactScore(bug: BugReport): number {
    let score = 0;

    // カテゴリによる基本スコア
    const categoryImpact = {
      [BugCategory.DATA_INTEGRITY]: 10,
      [BugCategory.SECURITY]: 10,
      [BugCategory.FUNCTIONALITY]: 8,
      [BugCategory.SIMULATION]: 8,
      [BugCategory.FILE_OPERATIONS]: 7,
      [BugCategory.UI_UX]: 6,
      [BugCategory.VALIDATION]: 6,
      [BugCategory.PERFORMANCE]: 5,
      [BugCategory.BROWSER_COMPATIBILITY]: 4,
      [BugCategory.CONNECTIVITY]: 3
    };
    score += categoryImpact[bug.category] || 5;

    // エラーメッセージの存在
    if (bug.errorMessage || bug.stackTrace) {
      score += 1;
    }

    // プロジェクトデータへの影響
    if (bug.projectId && bug.modelData) {
      score += 2;
    }

    // 複数コンポーネントへの影響
    if (bug.componentIds && bug.componentIds.length > 1) {
      score += 1;
    }

    return Math.min(10, score);
  }

  /**
   * 頻度スコア計算 (0-10)
   * 注: 実装では関連バグ数やタグから推定
   */
  private static calculateFrequencyScore(bug: BugReport): number {
    let score = 5; // デフォルト値

    // 関連バグの数
    if (bug.relatedBugs && bug.relatedBugs.length > 0) {
      score += Math.min(3, bug.relatedBugs.length);
    }

    // 特定のタグによる頻度推定
    const highFrequencyTags = ['common', 'frequent', 'recurring', 'widespread'];
    const lowFrequencyTags = ['rare', 'edge-case', 'specific'];
    
    const hasHighFrequencyTag = bug.tags.some(tag => 
      highFrequencyTags.some(hfTag => tag.toLowerCase().includes(hfTag))
    );
    const hasLowFrequencyTag = bug.tags.some(tag => 
      lowFrequencyTags.some(lfTag => tag.toLowerCase().includes(lfTag))
    );

    if (hasHighFrequencyTag) {
      score += 2;
    } else if (hasLowFrequencyTag) {
      score -= 2;
    }

    // ブラウザ互換性問題は一般的に頻度が高い
    if (bug.category === BugCategory.BROWSER_COMPATIBILITY) {
      score += 1;
    }

    return Math.min(10, Math.max(0, score));
  }

  /**
   * ビジネス影響度スコア計算 (0-10)
   */
  private static calculateBusinessImpactScore(bug: BugReport): number {
    let score = 0;

    // 重要機能への影響
    const criticalFunctionalities = [
      'simulation', 'file-operations', 'data-integrity', 'security'
    ];
    
    const affectsCriticalFunction = bug.tags.some(tag => 
      criticalFunctionalities.some(cf => tag.toLowerCase().includes(cf))
    );

    if (affectsCriticalFunction) {
      score += 4;
    }

    // バグタイプによる影響
    const typeImpact = {
      [BugType.BUG]: 6,
      [BugType.PERFORMANCE_ISSUE]: 4,
      [BugType.COMPATIBILITY_ISSUE]: 3,
      [BugType.ENHANCEMENT]: 2,
      [BugType.FEATURE_REQUEST]: 1
    };
    score += typeImpact[bug.type];

    // データ損失の可能性
    if (bug.category === BugCategory.DATA_INTEGRITY || 
        bug.tags.includes('data-loss')) {
      score += 3;
    }

    // セキュリティ関連
    if (bug.category === BugCategory.SECURITY) {
      score += 3;
    }

    return Math.min(10, score);
  }

  /**
   * 技術的複雑度スコア計算 (0-10)
   * 注: 高い複雑度は優先度を下げる要因
   */
  private static calculateTechnicalComplexityScore(bug: BugReport): number {
    let complexity = 5; // デフォルト値

    // スタックトレースの存在（デバッグ情報が豊富）
    if (bug.stackTrace) {
      complexity -= 1;
    }

    // 再現手順の詳細度
    if (bug.reproductionSteps.length >= 5) {
      complexity -= 1;
    } else if (bug.reproductionSteps.length <= 2) {
      complexity += 1;
    }

    // 環境依存性
    if (bug.category === BugCategory.BROWSER_COMPATIBILITY) {
      complexity += 2;
    }

    // パフォーマンス問題は複雑
    if (bug.category === BugCategory.PERFORMANCE) {
      complexity += 1;
    }

    // 複数コンポーネント関連は複雑
    if (bug.componentIds && bug.componentIds.length > 3) {
      complexity += 1;
    }

    // 複雑度を優先度スコアに変換（複雑度が高いほど優先度は下がる）
    return Math.min(10, Math.max(0, 10 - complexity));
  }

  /**
   * バグの特性に応じた重み付け設定
   */
  private static getWeights(bug: BugReport): {
    severityWeight: number;
    userImpactWeight: number;
    frequencyWeight: number;
    businessImpactWeight: number;
    technicalComplexityWeight: number;
  } {
    // デフォルト重み
    let weights = {
      severityWeight: 3.0,
      userImpactWeight: 2.5,
      frequencyWeight: 1.5,
      businessImpactWeight: 2.0,
      technicalComplexityWeight: 1.0
    };

    // クリティカルバグは深刻度を重視
    if (bug.severity === BugSeverity.CRITICAL) {
      weights.severityWeight = 4.0;
      weights.userImpactWeight = 3.0;
    }

    // データ整合性問題は特別扱い
    if (bug.category === BugCategory.DATA_INTEGRITY) {
      weights.severityWeight = 4.0;
      weights.userImpactWeight = 4.0;
      weights.businessImpactWeight = 3.0;
    }

    // パフォーマンス問題は頻度と技術的複雑度を重視
    if (bug.category === BugCategory.PERFORMANCE) {
      weights.frequencyWeight = 2.0;
      weights.technicalComplexityWeight = 1.5;
    }

    // ブラウザ互換性問題は頻度を重視
    if (bug.category === BugCategory.BROWSER_COMPATIBILITY) {
      weights.frequencyWeight = 2.5;
      weights.technicalComplexityWeight = 1.5;
    }

    return weights;
  }

  /**
   * 優先度スコアに基づく推奨アクション
   */
  static getRecommendedAction(priorityScore: number): {
    action: string;
    timeframe: string;
    description: string;
  } {
    if (priorityScore >= 90) {
      return {
        action: '緊急対応',
        timeframe: '即座（1時間以内）',
        description: 'システムの安定性やデータ整合性に重大な影響を与える可能性があります。最優先で対応してください。'
      };
    } else if (priorityScore >= 75) {
      return {
        action: '高優先度対応',
        timeframe: '当日中',
        description: 'ユーザー体験に大きな影響を与える問題です。可能な限り早急に対応してください。'
      };
    } else if (priorityScore >= 50) {
      return {
        action: '通常対応',
        timeframe: '1週間以内',
        description: '通常の開発サイクルで対応可能な問題です。次のリリースで修正を検討してください。'
      };
    } else if (priorityScore >= 25) {
      return {
        action: '低優先度対応',
        timeframe: '1ヶ月以内',
        description: '影響は限定的ですが、改善の余地がある問題です。時間に余裕がある時に対応してください。'
      };
    } else {
      return {
        action: '将来対応',
        timeframe: '次期バージョン',
        description: '現在の機能に大きな影響はありません。将来のバージョンで検討してください。'
      };
    }
  }

  /**
   * 複数のバグを優先度順にソート
   */
  static sortBugsByPriority(bugs: BugReport[]): BugReport[] {
    return bugs.sort((a, b) => {
      // 優先度スコアで降順ソート
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      
      // 同じ優先度の場合は深刻度で比較
      const severityOrder = {
        [BugSeverity.CRITICAL]: 4,
        [BugSeverity.HIGH]: 3,
        [BugSeverity.MEDIUM]: 2,
        [BugSeverity.LOW]: 1
      };
      
      if (severityOrder[b.severity] !== severityOrder[a.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      
      // 最後に作成日時で比較（新しいものを優先）
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
}
import { BugSeverity, BugCategory, BugType, CreateBugRequest, BugEnvironment, BugReproductionStep } from '../types/bugTracking';

export class BugReporter {
  private static instance: BugReporter;
  private isEnabled: boolean = true;
  private apiEndpoint: string = '/api/bugs';

  private constructor() {}

  static getInstance(): BugReporter {
    if (!BugReporter.instance) {
      BugReporter.instance = new BugReporter();
    }
    return BugReporter.instance;
  }

  /**
   * バグレポート機能の有効/無効を設定
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * APIエンドポイントを設定
   */
  setApiEndpoint(endpoint: string): void {
    this.apiEndpoint = endpoint;
  }

  /**
   * 自動的にJavaScriptエラーをバグレポートとして送信
   */
  reportJavaScriptError(
    error: Error,
    componentStack?: string,
    additionalInfo?: {
      projectId?: number;
      componentIds?: string[];
      userAction?: string;
    }
  ): Promise<void> {
    if (!this.isEnabled) return Promise.resolve();

    const bugReport: CreateBugRequest = {
      title: `JavaScript Error: ${error.name} - ${error.message}`,
      description: this.formatErrorDescription(error, componentStack, additionalInfo),
      severity: this.determineSeverityFromError(error),
      category: BugCategory.FUNCTIONALITY,
      type: BugType.BUG,
      environment: this.collectEnvironmentInfo(),
      reproductionSteps: this.generateErrorReproductionSteps(additionalInfo?.userAction),
      expectedBehavior: 'エラーが発生せずに正常に動作する',
      actualBehavior: `${error.name}エラーが発生: ${error.message}`,
      errorMessage: error.message,
      stackTrace: error.stack,
      consoleErrors: [error.toString()],
      projectId: additionalInfo?.projectId,
      componentIds: additionalInfo?.componentIds,
      tags: ['javascript-error', 'automatic', error.name.toLowerCase()]
    };

    return this.submitBugReport(bugReport);
  }

  /**
   * パフォーマンス問題を自動レポート
   */
  reportPerformanceIssue(
    operation: string,
    actualTime: number,
    expectedTime: number,
    additionalMetrics?: {
      memoryUsage?: number;
      componentCount?: number;
      connectionCount?: number;
    }
  ): Promise<void> {
    if (!this.isEnabled) return Promise.resolve();

    const bugReport: CreateBugRequest = {
      title: `Performance Issue: ${operation} - ${actualTime}ms (expected: ${expectedTime}ms)`,
      description: this.formatPerformanceDescription(operation, actualTime, expectedTime, additionalMetrics),
      severity: this.determineSeverityFromPerformance(actualTime, expectedTime),
      category: BugCategory.PERFORMANCE,
      type: BugType.PERFORMANCE_ISSUE,
      environment: this.collectEnvironmentInfo(),
      reproductionSteps: this.generatePerformanceReproductionSteps(operation),
      expectedBehavior: `${operation}が${expectedTime}ms以内に完了する`,
      actualBehavior: `${operation}が${actualTime}msかかった`,
      performanceMetrics: {
        loadTime: actualTime,
        memoryUsage: additionalMetrics?.memoryUsage,
        componentCount: additionalMetrics?.componentCount,
        connectionCount: additionalMetrics?.connectionCount
      },
      tags: ['performance', 'automatic', 'slow-operation']
    };

    return this.submitBugReport(bugReport);
  }

  /**
   * ブラウザ互換性問題を自動レポート
   */
  reportCompatibilityIssue(
    feature: string,
    error: string,
    browserInfo?: {
      browser: string;
      version: string;
    }
  ): Promise<void> {
    if (!this.isEnabled) return Promise.resolve();

    const environment = this.collectEnvironmentInfo();
    if (browserInfo) {
      environment.browser = browserInfo.browser;
      environment.browserVersion = browserInfo.version;
    }

    const bugReport: CreateBugRequest = {
      title: `Browser Compatibility Issue: ${feature} - ${environment.browser}`,
      description: this.formatCompatibilityDescription(feature, error, environment),
      severity: BugSeverity.MEDIUM,
      category: BugCategory.BROWSER_COMPATIBILITY,
      type: BugType.COMPATIBILITY_ISSUE,
      environment,
      reproductionSteps: this.generateCompatibilityReproductionSteps(feature),
      expectedBehavior: `${feature}がすべてのサポート対象ブラウザで正常に動作する`,
      actualBehavior: `${environment.browser}で${feature}が動作しない: ${error}`,
      errorMessage: error,
      tags: ['browser-compatibility', 'automatic', environment.browser.toLowerCase()]
    };

    return this.submitBugReport(bugReport);
  }

  /**
   * ファイル操作エラーを自動レポート
   */
  reportFileOperationError(
    operation: 'upload' | 'download' | 'parse' | 'generate',
    filename: string,
    error: string,
    fileInfo?: {
      size?: number;
      type?: string;
    }
  ): Promise<void> {
    if (!this.isEnabled) return Promise.resolve();

    const bugReport: CreateBugRequest = {
      title: `File Operation Error: ${operation} - ${filename}`,
      description: this.formatFileOperationDescription(operation, filename, error, fileInfo),
      severity: this.determineSeverityFromFileOperation(operation),
      category: BugCategory.FILE_OPERATIONS,
      type: BugType.BUG,
      environment: this.collectEnvironmentInfo(),
      reproductionSteps: this.generateFileOperationReproductionSteps(operation, filename),
      expectedBehavior: `ファイル${operation}が正常に完了する`,
      actualBehavior: `ファイル${operation}が失敗: ${error}`,
      errorMessage: error,
      tags: ['file-operations', 'automatic', operation]
    };

    return this.submitBugReport(bugReport);
  }

  /**
   * バリデーションエラーを自動レポート
   */
  reportValidationError(
    field: string,
    value: any,
    validationRule: string,
    error: string
  ): Promise<void> {
    if (!this.isEnabled) return Promise.resolve();

    const bugReport: CreateBugRequest = {
      title: `Validation Error: ${field} - ${validationRule}`,
      description: this.formatValidationDescription(field, value, validationRule, error),
      severity: BugSeverity.MEDIUM,
      category: BugCategory.VALIDATION,
      type: BugType.BUG,
      environment: this.collectEnvironmentInfo(),
      reproductionSteps: this.generateValidationReproductionSteps(field, value),
      expectedBehavior: `${field}の値が正しくバリデーションされる`,
      actualBehavior: `不正なバリデーションエラー: ${error}`,
      errorMessage: error,
      tags: ['validation', 'automatic', 'false-positive']
    };

    return this.submitBugReport(bugReport);
  }

  /**
   * 手動でバグレポートを作成するためのヘルパー
   */
  createManualBugReport(
    title: string,
    description: string,
    severity: BugSeverity,
    category: BugCategory,
    reproductionSteps: string[],
    expectedBehavior: string,
    actualBehavior: string,
    additionalInfo?: {
      projectId?: number;
      componentIds?: string[];
      tags?: string[];
      errorMessage?: string;
      stackTrace?: string;
    }
  ): CreateBugRequest {
    return {
      title,
      description,
      severity,
      category,
      type: BugType.BUG,
      environment: this.collectEnvironmentInfo(),
      reproductionSteps: reproductionSteps.map((step, index) => ({
        stepNumber: index + 1,
        action: step,
        expectedResult: index === reproductionSteps.length - 1 ? expectedBehavior : undefined,
        actualResult: index === reproductionSteps.length - 1 ? actualBehavior : undefined
      })),
      expectedBehavior,
      actualBehavior,
      errorMessage: additionalInfo?.errorMessage,
      stackTrace: additionalInfo?.stackTrace,
      projectId: additionalInfo?.projectId,
      componentIds: additionalInfo?.componentIds,
      tags: [...(additionalInfo?.tags || []), 'manual']
    };
  }

  private async submitBugReport(bugReport: CreateBugRequest): Promise<void> {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bugReport)
      });

      if (!response.ok) {
        console.error('Failed to submit bug report:', response.statusText);
      }
    } catch (error) {
      console.error('Error submitting bug report:', error);
    }
  }

  private collectEnvironmentInfo(): BugEnvironment {
    const userAgent = navigator.userAgent;
    
    return {
      browser: this.getBrowserName(),
      browserVersion: this.getBrowserVersion(),
      os: this.getOperatingSystem(),
      osVersion: 'Unknown',
      screenResolution: `${screen.width}x${screen.height}`,
      deviceType: this.getDeviceType(),
      userAgent,
      timestamp: new Date().toISOString()
    };
  }

  private getBrowserName(): string {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  private getBrowserVersion(): string {
    const userAgent = navigator.userAgent;
    const match = userAgent.match(/(Chrome|Firefox|Safari|Edge)\/([0-9.]+)/);
    return match ? match[2] : 'Unknown';
  }

  private getOperatingSystem(): string {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    return 'Unknown';
  }

  private getDeviceType(): 'desktop' | 'tablet' | 'mobile' {
    const width = screen.width;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  private formatErrorDescription(
    error: Error,
    componentStack?: string,
    additionalInfo?: any
  ): string {
    let description = `## エラー詳細\n`;
    description += `- エラー名: ${error.name}\n`;
    description += `- エラーメッセージ: ${error.message}\n`;
    
    if (componentStack) {
      description += `- コンポーネントスタック:\n\`\`\`\n${componentStack}\n\`\`\`\n`;
    }
    
    if (error.stack) {
      description += `- スタックトレース:\n\`\`\`\n${error.stack}\n\`\`\`\n`;
    }
    
    if (additionalInfo?.userAction) {
      description += `- ユーザーアクション: ${additionalInfo.userAction}\n`;
    }
    
    description += `\n## 自動検出\nこのエラーは自動的に検出されました。`;
    
    return description;
  }

  private formatPerformanceDescription(
    operation: string,
    actualTime: number,
    expectedTime: number,
    metrics?: any
  ): string {
    let description = `## パフォーマンス問題\n`;
    description += `- 操作: ${operation}\n`;
    description += `- 実際の時間: ${actualTime}ms\n`;
    description += `- 期待時間: ${expectedTime}ms\n`;
    description += `- 遅延: ${actualTime - expectedTime}ms (${Math.round((actualTime / expectedTime - 1) * 100)}%)\n`;
    
    if (metrics) {
      description += `\n## パフォーマンス指標\n`;
      if (metrics.memoryUsage) description += `- メモリ使用量: ${metrics.memoryUsage}MB\n`;
      if (metrics.componentCount) description += `- コンポーネント数: ${metrics.componentCount}\n`;
      if (metrics.connectionCount) description += `- 接続数: ${metrics.connectionCount}\n`;
    }
    
    return description;
  }

  private formatCompatibilityDescription(
    feature: string,
    error: string,
    environment: BugEnvironment
  ): string {
    return `## ブラウザ互換性問題\n` +
           `- 機能: ${feature}\n` +
           `- ブラウザ: ${environment.browser} ${environment.browserVersion}\n` +
           `- OS: ${environment.os}\n` +
           `- エラー: ${error}\n\n` +
           `この機能は他のブラウザでは正常に動作する可能性があります。`;
  }

  private formatFileOperationDescription(
    operation: string,
    filename: string,
    error: string,
    fileInfo?: any
  ): string {
    let description = `## ファイル操作エラー\n`;
    description += `- 操作: ${operation}\n`;
    description += `- ファイル名: ${filename}\n`;
    description += `- エラー: ${error}\n`;
    
    if (fileInfo) {
      if (fileInfo.size) description += `- ファイルサイズ: ${fileInfo.size} bytes\n`;
      if (fileInfo.type) description += `- ファイルタイプ: ${fileInfo.type}\n`;
    }
    
    return description;
  }

  private formatValidationDescription(
    field: string,
    value: any,
    validationRule: string,
    error: string
  ): string {
    return `## バリデーションエラー\n` +
           `- フィールド: ${field}\n` +
           `- 入力値: ${JSON.stringify(value)}\n` +
           `- バリデーションルール: ${validationRule}\n` +
           `- エラーメッセージ: ${error}\n\n` +
           `この値は有効であるべきですが、バリデーションエラーが発生しています。`;
  }

  private determineSeverityFromError(error: Error): BugSeverity {
    const criticalErrors = ['TypeError', 'ReferenceError', 'SyntaxError'];
    const highErrors = ['RangeError', 'URIError'];
    
    if (criticalErrors.includes(error.name)) return BugSeverity.CRITICAL;
    if (highErrors.includes(error.name)) return BugSeverity.HIGH;
    return BugSeverity.MEDIUM;
  }

  private determineSeverityFromPerformance(actualTime: number, expectedTime: number): BugSeverity {
    const ratio = actualTime / expectedTime;
    if (ratio > 5) return BugSeverity.HIGH;
    if (ratio > 3) return BugSeverity.MEDIUM;
    return BugSeverity.LOW;
  }

  private determineSeverityFromFileOperation(operation: string): BugSeverity {
    if (operation === 'upload' || operation === 'parse') return BugSeverity.HIGH;
    return BugSeverity.MEDIUM;
  }

  private generateErrorReproductionSteps(userAction?: string): BugReproductionStep[] {
    const steps: BugReproductionStep[] = [
      {
        stepNumber: 1,
        action: 'アプリケーションを開く',
        expectedResult: 'アプリケーションが正常に読み込まれる'
      }
    ];

    if (userAction) {
      steps.push({
        stepNumber: 2,
        action: userAction,
        expectedResult: '操作が正常に完了する',
        actualResult: 'JavaScriptエラーが発生'
      });
    } else {
      steps.push({
        stepNumber: 2,
        action: 'エラーが発生した操作を実行',
        expectedResult: '操作が正常に完了する',
        actualResult: 'JavaScriptエラーが発生'
      });
    }

    return steps;
  }

  private generatePerformanceReproductionSteps(operation: string): BugReproductionStep[] {
    return [
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
        action: `${operation}を実行`,
        expectedResult: '操作が迅速に完了する',
        actualResult: '操作の完了に時間がかかる'
      }
    ];
  }

  private generateCompatibilityReproductionSteps(feature: string): BugReproductionStep[] {
    return [
      {
        stepNumber: 1,
        action: '問題のブラウザでアプリケーションを開く',
        expectedResult: 'アプリケーションが正常に読み込まれる'
      },
      {
        stepNumber: 2,
        action: `${feature}を使用`,
        expectedResult: '機能が正常に動作する',
        actualResult: '機能が動作しない、またはエラーが発生する'
      }
    ];
  }

  private generateFileOperationReproductionSteps(operation: string, filename: string): BugReproductionStep[] {
    return [
      {
        stepNumber: 1,
        action: 'ファイル管理画面を開く',
        expectedResult: 'ファイル管理画面が表示される'
      },
      {
        stepNumber: 2,
        action: `${filename}で${operation}操作を実行`,
        expectedResult: '操作が正常に完了する',
        actualResult: '操作が失敗する'
      }
    ];
  }

  private generateValidationReproductionSteps(field: string, value: any): BugReproductionStep[] {
    return [
      {
        stepNumber: 1,
        action: '該当フォームを開く',
        expectedResult: 'フォームが正常に表示される'
      },
      {
        stepNumber: 2,
        action: `${field}に${JSON.stringify(value)}を入力`,
        expectedResult: '入力が受け入れられる',
        actualResult: 'バリデーションエラーが表示される'
      }
    ];
  }
}
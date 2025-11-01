/**
 * エラー報告とユーザー通知サービス
 */

import { AppError, ErrorCode, ErrorSeverity } from '../errors/AppError';
import { ErrorAnalyzer, ErrorAnalysisResult } from '../errors/ErrorAnalyzer';

export interface ErrorReport {
  id: string;
  timestamp: Date;
  error: AppError;
  analysis: ErrorAnalysisResult;
  userNotified: boolean;
  resolved: boolean;
  resolutionNotes?: string;
}

export interface UserNotification {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  suggestions?: string[];
  actions?: NotificationAction[];
  persistent?: boolean;
  autoClose?: number; // milliseconds
}

export interface NotificationAction {
  label: string;
  action: 'retry' | 'dismiss' | 'contact_support' | 'view_logs' | 'custom';
  handler?: () => void;
}

export class ErrorReportingService {
  private static instance: ErrorReportingService;
  private errorReports: Map<string, ErrorReport> = new Map();
  private notificationCallbacks: Array<(notification: UserNotification) => void> = [];

  public static getInstance(): ErrorReportingService {
    if (!ErrorReportingService.instance) {
      ErrorReportingService.instance = new ErrorReportingService();
    }
    return ErrorReportingService.instance;
  }

  public reportError(error: Error, context?: any): ErrorReport {
    const appError = error instanceof AppError ? error : this.convertToAppError(error, context);
    const analysis = ErrorAnalyzer.analyzeError(appError);
    
    const report: ErrorReport = {
      id: this.generateReportId(),
      timestamp: new Date(),
      error: appError,
      analysis,
      userNotified: false,
      resolved: false
    };

    this.errorReports.set(report.id, report);

    // 重要度に応じてユーザーに通知
    if (this.shouldNotifyUser(appError)) {
      this.notifyUser(report);
    }

    return report;
  }

  public notifyUser(report: ErrorReport): void {
    const notification = this.createUserNotification(report);
    
    this.notificationCallbacks.forEach(callback => {
      try {
        callback(notification);
      } catch (error) {
        console.error('Error in notification callback:', error);
      }
    });

    report.userNotified = true;
  }

  public onNotification(callback: (notification: UserNotification) => void): void {
    this.notificationCallbacks.push(callback);
  }

  public resolveError(reportId: string, resolutionNotes?: string): boolean {
    const report = this.errorReports.get(reportId);
    if (report) {
      report.resolved = true;
      report.resolutionNotes = resolutionNotes;
      return true;
    }
    return false;
  }

  public getErrorReports(filter?: {
    severity?: ErrorSeverity;
    resolved?: boolean;
    since?: Date;
  }): ErrorReport[] {
    let reports = Array.from(this.errorReports.values());

    if (filter) {
      if (filter.severity) {
        reports = reports.filter(r => r.error.severity === filter.severity);
      }
      if (filter.resolved !== undefined) {
        reports = reports.filter(r => r.resolved === filter.resolved);
      }
      if (filter.since) {
        reports = reports.filter(r => r.timestamp >= filter.since!);
      }
    }

    return reports.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private convertToAppError(error: Error, context?: any): AppError {
    return new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      error.message,
      'システムエラーが発生しました',
      ErrorSeverity.ERROR,
      {
        timestamp: new Date(),
        stackTrace: error.stack,
        additionalData: context
      }
    );
  }

  private shouldNotifyUser(error: AppError): boolean {
    // クリティカルエラーとエラーレベルは常に通知
    if (error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.ERROR) {
      return true;
    }

    // 特定のエラーコードは警告レベルでも通知
    const alwaysNotifyErrors = [
      ErrorCode.OPENWAM_EXECUTION_FAILED,
      ErrorCode.FILE_CORRUPTED,
      ErrorCode.VALIDATION_MODEL_INVALID
    ];

    return alwaysNotifyErrors.includes(error.code);
  }

  private createUserNotification(report: ErrorReport): UserNotification {
    const { error, analysis } = report;
    
    const notification: UserNotification = {
      type: this.getNotificationType(error.severity),
      title: this.getNotificationTitle(error.code),
      message: analysis.userMessage,
      suggestions: analysis.suggestions,
      actions: this.getNotificationActions(error, analysis),
      persistent: error.severity === ErrorSeverity.CRITICAL,
      autoClose: error.severity === ErrorSeverity.WARNING ? 5000 : undefined
    };

    return notification;
  }

  private getNotificationType(severity: ErrorSeverity): 'error' | 'warning' | 'info' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.ERROR:
        return 'error';
      case ErrorSeverity.WARNING:
        return 'warning';
      case ErrorSeverity.INFO:
        return 'info';
      default:
        return 'error';
    }
  }

  private getNotificationTitle(code: ErrorCode): string {
    const titleMap: Partial<Record<ErrorCode, string>> = {
      [ErrorCode.OPENWAM_EXECUTION_FAILED]: 'シミュレーション実行エラー',
      [ErrorCode.OPENWAM_TIMEOUT]: 'シミュレーションタイムアウト',
      [ErrorCode.OPENWAM_CONVERGENCE_FAILED]: '収束エラー',
      [ErrorCode.FILE_NOT_FOUND]: 'ファイルが見つかりません',
      [ErrorCode.FILE_CORRUPTED]: 'ファイルが破損しています',
      [ErrorCode.VALIDATION_MODEL_INVALID]: 'モデル検証エラー',
      [ErrorCode.SYSTEM_CRASH]: 'システムクラッシュ',
      [ErrorCode.DATABASE_CONNECTION_FAILED]: 'データベース接続エラー'
    };

    return titleMap[code] || 'エラーが発生しました';
  }

  private getNotificationActions(error: AppError, analysis: ErrorAnalysisResult): NotificationAction[] {
    const actions: NotificationAction[] = [
      { label: '閉じる', action: 'dismiss' }
    ];

    if (analysis.retryable) {
      actions.unshift({ label: '再試行', action: 'retry' });
    }

    if (error.severity === ErrorSeverity.CRITICAL) {
      actions.push({ label: 'サポートに連絡', action: 'contact_support' });
    }

    if (process.env.NODE_ENV === 'development') {
      actions.push({ label: 'ログを表示', action: 'view_logs' });
    }

    return actions;
  }

  private generateReportId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
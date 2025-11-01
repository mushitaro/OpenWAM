/**
 * クラッシュ復旧サービス
 * 自動起動、プロセス監視、クラッシュ検出と復旧機能
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { ErrorReportingService } from '../../shared/services/errorReportingService';

export interface CrashReport {
  id: string;
  timestamp: Date;
  processId: number;
  exitCode: number | null;
  signal: string | null;
  error?: Error;
  stackTrace?: string;
  systemMetrics?: any;
  recoveryAttempts: number;
  recovered: boolean;
}

export interface RecoveryConfig {
  maxRetries: number;
  retryDelay: number; // milliseconds
  exponentialBackoff: boolean;
  healthCheckInterval: number; // milliseconds
  crashThreshold: number; // crashes per hour
  autoRestart: boolean;
  gracefulShutdownTimeout: number; // milliseconds
}

export class CrashRecoveryService extends EventEmitter {
  private static instance: CrashRecoveryService;
  private crashHistory: CrashReport[] = [];
  private recoveryAttempts: Map<string, number> = new Map();
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private errorReporting: ErrorReportingService;
  private pidFile: string;
  private lockFile: string;
  
  private readonly config: RecoveryConfig = {
    maxRetries: 3,
    retryDelay: 5000,
    exponentialBackoff: true,
    healthCheckInterval: 10000,
    crashThreshold: 5,
    autoRestart: true,
    gracefulShutdownTimeout: 30000
  };

  public static getInstance(): CrashRecoveryService {
    if (!CrashRecoveryService.instance) {
      CrashRecoveryService.instance = new CrashRecoveryService();
    }
    return CrashRecoveryService.instance;
  }

  constructor() {
    super();
    this.errorReporting = ErrorReportingService.getInstance();
    this.pidFile = path.join(process.cwd(), 'app_data', 'server.pid');
    this.lockFile = path.join(process.cwd(), 'app_data', 'server.lock');
    
    this.setupProcessHandlers();
  }

  public async initialize(): Promise<void> {
    try {
      // PIDファイルとロックファイルのディレクトリを作成
      await fs.mkdir(path.dirname(this.pidFile), { recursive: true });
      
      // 既存のプロセスチェック
      await this.checkExistingProcess();
      
      // PIDファイル作成
      await this.createPidFile();
      
      // ロックファイル作成
      await this.createLockFile();
      
      // 監視開始
      this.startMonitoring();
      
      logger.info('Crash recovery service initialized');
    } catch (error: any) {
      const initError = new AppError(
        ErrorCode.SYSTEM_STARTUP_FAILED,
        `Failed to initialize crash recovery service: ${error.message}`,
        'クラッシュ復旧サービスの初期化に失敗しました',
        ErrorSeverity.CRITICAL
      );
      
      this.errorReporting.reportError(initError);
      throw initError;
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down crash recovery service...');
    
    this.stopMonitoring();
    
    try {
      // PIDファイル削除
      await fs.unlink(this.pidFile).catch(() => {});
      
      // ロックファイル削除
      await fs.unlink(this.lockFile).catch(() => {});
      
      logger.info('Crash recovery service shutdown complete');
    } catch (error: any) {
      logger.error('Error during crash recovery service shutdown:', error);
    }
  }

  public reportCrash(error?: Error, exitCode?: number, signal?: string): CrashReport {
    const crashReport: CrashReport = {
      id: this.generateCrashId(),
      timestamp: new Date(),
      processId: process.pid,
      exitCode: exitCode || null,
      signal: signal || null,
      error,
      stackTrace: error?.stack,
      recoveryAttempts: 0,
      recovered: false
    };

    this.crashHistory.push(crashReport);
    
    // 履歴サイズ制限
    if (this.crashHistory.length > 100) {
      this.crashHistory = this.crashHistory.slice(-100);
    }

    logger.error('Crash reported:', crashReport);
    
    // クラッシュ頻度チェック
    if (this.isCrashThresholdExceeded()) {
      this.handleCrashThresholdExceeded();
    }

    this.emit('crash', crashReport);
    
    return crashReport;
  }

  public async attemptRecovery(crashReport: CrashReport): Promise<boolean> {
    if (!this.config.autoRestart) {
      logger.info('Auto-restart is disabled, skipping recovery');
      return false;
    }

    const attempts = this.recoveryAttempts.get(crashReport.id) || 0;
    
    if (attempts >= this.config.maxRetries) {
      logger.error(`Max recovery attempts (${this.config.maxRetries}) exceeded for crash ${crashReport.id}`);
      this.emit('recoveryFailed', crashReport);
      return false;
    }

    this.recoveryAttempts.set(crashReport.id, attempts + 1);
    crashReport.recoveryAttempts = attempts + 1;

    logger.info(`Attempting recovery ${attempts + 1}/${this.config.maxRetries} for crash ${crashReport.id}`);

    try {
      // 復旧遅延（指数バックオフ）
      const delay = this.config.exponentialBackoff 
        ? this.config.retryDelay * Math.pow(2, attempts)
        : this.config.retryDelay;
      
      await this.sleep(delay);

      // 復旧処理
      await this.performRecovery();

      crashReport.recovered = true;
      this.emit('recovered', crashReport);
      
      logger.info(`Recovery successful for crash ${crashReport.id}`);
      return true;
      
    } catch (error: any) {
      logger.error(`Recovery attempt ${attempts + 1} failed for crash ${crashReport.id}:`, error);
      
      // 最大試行回数に達した場合
      if (attempts + 1 >= this.config.maxRetries) {
        const recoveryError = new AppError(
          ErrorCode.SYSTEM_CRASH,
          `Recovery failed after ${this.config.maxRetries} attempts`,
          'システムの復旧に失敗しました',
          ErrorSeverity.CRITICAL,
          {
            additionalData: {
              crashId: crashReport.id,
              attempts: attempts + 1
            }
          }
        );
        
        this.errorReporting.reportError(recoveryError);
        this.emit('recoveryFailed', crashReport);
      }
      
      return false;
    }
  }

  public getCrashHistory(limit?: number): CrashReport[] {
    const history = [...this.crashHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  public getCrashStatistics(hours: number = 24): {
    totalCrashes: number;
    recoveredCrashes: number;
    failedRecoveries: number;
    crashRate: number; // crashes per hour
  } {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentCrashes = this.crashHistory.filter(crash => crash.timestamp >= cutoff);

    return {
      totalCrashes: recentCrashes.length,
      recoveredCrashes: recentCrashes.filter(crash => crash.recovered).length,
      failedRecoveries: recentCrashes.filter(crash => !crash.recovered && crash.recoveryAttempts > 0).length,
      crashRate: recentCrashes.length / hours
    };
  }

  private setupProcessHandlers(): void {
    // 未処理の例外
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception:', error);
      const crashReport = this.reportCrash(error);
      
      // 復旧試行
      this.attemptRecovery(crashReport).then(recovered => {
        if (!recovered) {
          process.exit(1);
        }
      });
    });

    // 未処理のPromise拒否
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled promise rejection:', reason);
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const crashReport = this.reportCrash(error);
      
      // 復旧試行
      this.attemptRecovery(crashReport);
    });

    // 正常終了シグナル
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, initiating graceful shutdown');
      this.gracefulShutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, initiating graceful shutdown');
      this.gracefulShutdown();
    });
  }

  private async checkExistingProcess(): Promise<void> {
    try {
      const pidData = await fs.readFile(this.pidFile, 'utf8');
      const existingPid = parseInt(pidData.trim());
      
      if (existingPid && this.isProcessRunning(existingPid)) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Server is already running with PID ${existingPid}`,
          'サーバーは既に実行中です',
          ErrorSeverity.ERROR
        );
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async createPidFile(): Promise<void> {
    await fs.writeFile(this.pidFile, process.pid.toString());
  }

  private async createLockFile(): Promise<void> {
    const lockData = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    };
    
    await fs.writeFile(this.lockFile, JSON.stringify(lockData, null, 2));
  }

  private startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    logger.info('Process monitoring started');
  }

  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
  }

  private async performHealthCheck(): Promise<void> {
    try {
      // ロックファイルの更新
      await this.updateLockFile();
      
      // メモリ使用量チェック
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB
        logger.warn('High memory usage detected:', memUsage);
      }

      // プロセス稼働時間チェック
      const uptime = process.uptime();
      if (uptime > 24 * 60 * 60) { // 24 hours
        logger.info(`Process has been running for ${Math.round(uptime / 3600)} hours`);
      }

    } catch (error: any) {
      logger.error('Health check failed:', error);
    }
  }

  private async updateLockFile(): Promise<void> {
    try {
      const lockData = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        lastUpdate: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      };
      
      await fs.writeFile(this.lockFile, JSON.stringify(lockData, null, 2));
    } catch (error: any) {
      logger.error('Failed to update lock file:', error);
    }
  }

  private isCrashThresholdExceeded(): boolean {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCrashes = this.crashHistory.filter(crash => crash.timestamp >= oneHourAgo);
    
    return recentCrashes.length >= this.config.crashThreshold;
  }

  private handleCrashThresholdExceeded(): void {
    const error = new AppError(
      ErrorCode.SYSTEM_CRASH,
      `Crash threshold exceeded: ${this.config.crashThreshold} crashes in the last hour`,
      'システムクラッシュの頻度が異常に高くなっています',
      ErrorSeverity.CRITICAL,
      {
        additionalData: {
          crashThreshold: this.config.crashThreshold,
          recentCrashes: this.getCrashStatistics(1)
        }
      },
      [
        'システムを再起動してください',
        'ログを確認して根本原因を特定してください',
        'システム管理者に連絡してください'
      ]
    );

    this.errorReporting.reportError(error);
    this.emit('thresholdExceeded', this.getCrashStatistics(1));
  }

  private async performRecovery(): Promise<void> {
    logger.info('Performing system recovery...');

    // メモリクリーンアップ
    if (global.gc) {
      global.gc();
    }

    // 一時ファイルクリーンアップ
    await this.cleanupTempFiles();

    // データベース接続リセット（必要に応じて）
    // await this.resetDatabaseConnections();

    logger.info('System recovery completed');
  }

  private async cleanupTempFiles(): Promise<void> {
    try {
      const tempDir = path.join(process.cwd(), 'app_data', 'temp');
      const files = await fs.readdir(tempDir).catch(() => []);
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath).catch(() => null);
        
        if (stats && Date.now() - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch (error: any) {
      logger.error('Failed to cleanup temp files:', error);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown...');

    const shutdownTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, this.config.gracefulShutdownTimeout);

    try {
      // 監視停止
      this.stopMonitoring();

      // クリーンアップ処理
      await this.shutdown();

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);
      
    } catch (error: any) {
      logger.error('Error during graceful shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateCrashId(): string {
    return `crash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public updateConfig(newConfig: Partial<RecoveryConfig>): void {
    Object.assign(this.config, newConfig);
    logger.info('Crash recovery config updated:', newConfig);
  }

  public getConfig(): RecoveryConfig {
    return { ...this.config };
  }
}
/**
 * システムヘルスモニタリングサービス
 * サーバーの状態監視、リソース使用量追跡、自動復旧機能
 */

import { EventEmitter } from 'events';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { ErrorReportingService } from '../../shared/services/errorReportingService';

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number; // percentage
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number; // bytes
    free: number; // bytes
    used: number; // bytes
    usagePercentage: number;
  };
  process: {
    pid: number;
    uptime: number; // seconds
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
  disk: {
    total: number; // bytes
    free: number; // bytes
    used: number; // bytes
    usagePercentage: number;
  };
  network: {
    connections: number;
    activeSimulations: number;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical' | 'down';
  score: number; // 0-100
  issues: HealthIssue[];
  metrics: SystemMetrics;
  lastCheck: Date;
}

export interface HealthIssue {
  type: 'cpu' | 'memory' | 'disk' | 'process' | 'network';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  suggestions: string[];
}

export interface HealthThresholds {
  cpu: {
    warning: number; // percentage
    critical: number; // percentage
  };
  memory: {
    warning: number; // percentage
    critical: number; // percentage
  };
  disk: {
    warning: number; // percentage
    critical: number; // percentage
  };
  process: {
    maxMemory: number; // bytes
    maxUptime: number; // seconds
  };
}

export class SystemHealthService extends EventEmitter {
  private static instance: SystemHealthService;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private healthHistory: HealthStatus[] = [];
  private maxHistorySize = 1000;
  private errorReporting: ErrorReportingService;
  private isMonitoring = false;
  
  private readonly thresholds: HealthThresholds = {
    cpu: {
      warning: 80,
      critical: 95
    },
    memory: {
      warning: 80,
      critical: 95
    },
    disk: {
      warning: 85,
      critical: 95
    },
    process: {
      maxMemory: 2 * 1024 * 1024 * 1024, // 2GB
      maxUptime: 24 * 60 * 60 // 24 hours
    }
  };

  public static getInstance(): SystemHealthService {
    if (!SystemHealthService.instance) {
      SystemHealthService.instance = new SystemHealthService();
    }
    return SystemHealthService.instance;
  }

  constructor() {
    super();
    this.errorReporting = ErrorReportingService.getInstance();
  }

  public startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      logger.warn('Health monitoring is already running');
      return;
    }

    logger.info(`Starting system health monitoring (interval: ${intervalMs}ms)`);
    this.isMonitoring = true;

    // 初回チェック
    this.performHealthCheck();

    // 定期チェック
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info('System health monitoring stopped');
  }

  public async performHealthCheck(): Promise<HealthStatus> {
    try {
      const metrics = await this.collectMetrics();
      const issues = this.analyzeMetrics(metrics);
      const status = this.calculateHealthStatus(issues);
      const score = this.calculateHealthScore(issues);

      const healthStatus: HealthStatus = {
        status,
        score,
        issues,
        metrics,
        lastCheck: new Date()
      };

      // 履歴に追加
      this.addToHistory(healthStatus);

      // 問題がある場合は通知
      if (issues.length > 0) {
        this.handleHealthIssues(issues);
      }

      // イベント発行
      this.emit('healthCheck', healthStatus);

      return healthStatus;
    } catch (error: any) {
      const healthError = new AppError(
        ErrorCode.SYSTEM_CRASH,
        `Health check failed: ${error.message}`,
        'システムヘルスチェックに失敗しました',
        ErrorSeverity.CRITICAL
      );
      
      this.errorReporting.reportError(healthError);
      throw healthError;
    }
  }

  public getLatestHealth(): HealthStatus | null {
    return this.healthHistory.length > 0 ? this.healthHistory[this.healthHistory.length - 1] : null;
  }

  public getHealthHistory(limit?: number): HealthStatus[] {
    const history = [...this.healthHistory];
    return limit ? history.slice(-limit) : history;
  }

  public getHealthTrends(hours: number = 24): {
    cpu: number[];
    memory: number[];
    disk: number[];
    timestamps: Date[];
  } {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentHistory = this.healthHistory.filter(h => h.lastCheck >= cutoff);

    return {
      cpu: recentHistory.map(h => h.metrics.cpu.usage),
      memory: recentHistory.map(h => h.metrics.memory.usagePercentage),
      disk: recentHistory.map(h => h.metrics.disk.usagePercentage),
      timestamps: recentHistory.map(h => h.lastCheck)
    };
  }

  private async collectMetrics(): Promise<SystemMetrics> {
    const cpuUsage = await this.getCpuUsage();
    const memoryInfo = this.getMemoryInfo();
    const processInfo = this.getProcessInfo();
    const diskInfo = await this.getDiskInfo();

    return {
      timestamp: new Date(),
      cpu: {
        usage: cpuUsage,
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      memory: memoryInfo,
      process: processInfo,
      disk: diskInfo,
      network: {
        connections: 0, // TODO: Implement network monitoring
        activeSimulations: 0 // TODO: Get from simulation service
      }
    };
  }

  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime();

      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = process.hrtime(startTime);

        const totalTime = endTime[0] * 1000000 + endTime[1] / 1000; // microseconds
        const cpuTime = (endUsage.user + endUsage.system); // microseconds
        const usage = (cpuTime / totalTime) * 100;

        resolve(Math.min(100, Math.max(0, usage)));
      }, 100);
    });
  }

  private getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usagePercentage = (used / total) * 100;

    return {
      total,
      free,
      used,
      usagePercentage
    };
  }

  private getProcessInfo() {
    return {
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };
  }

  private async getDiskInfo() {
    try {
      const stats = await fs.stat(process.cwd());
      // Note: Getting actual disk usage requires platform-specific code
      // This is a simplified implementation
      return {
        total: 1000000000000, // 1TB placeholder
        free: 500000000000,   // 500GB placeholder
        used: 500000000000,   // 500GB placeholder
        usagePercentage: 50   // 50% placeholder
      };
    } catch (error) {
      return {
        total: 0,
        free: 0,
        used: 0,
        usagePercentage: 0
      };
    }
  }

  private analyzeMetrics(metrics: SystemMetrics): HealthIssue[] {
    const issues: HealthIssue[] = [];

    // CPU チェック
    if (metrics.cpu.usage >= this.thresholds.cpu.critical) {
      issues.push({
        type: 'cpu',
        severity: 'critical',
        message: 'CPU使用率が危険レベルに達しています',
        value: metrics.cpu.usage,
        threshold: this.thresholds.cpu.critical,
        suggestions: [
          '他のアプリケーションを終了してください',
          'システムを再起動してください',
          'シミュレーションの並列実行数を減らしてください'
        ]
      });
    } else if (metrics.cpu.usage >= this.thresholds.cpu.warning) {
      issues.push({
        type: 'cpu',
        severity: 'warning',
        message: 'CPU使用率が高くなっています',
        value: metrics.cpu.usage,
        threshold: this.thresholds.cpu.warning,
        suggestions: [
          '不要なプロセスを終了してください',
          'シミュレーションの設定を見直してください'
        ]
      });
    }

    // メモリチェック
    if (metrics.memory.usagePercentage >= this.thresholds.memory.critical) {
      issues.push({
        type: 'memory',
        severity: 'critical',
        message: 'メモリ使用量が危険レベルに達しています',
        value: metrics.memory.usagePercentage,
        threshold: this.thresholds.memory.critical,
        suggestions: [
          '他のアプリケーションを終了してください',
          'システムを再起動してください',
          'メモリを増設してください'
        ]
      });
    } else if (metrics.memory.usagePercentage >= this.thresholds.memory.warning) {
      issues.push({
        type: 'memory',
        severity: 'warning',
        message: 'メモリ使用量が高くなっています',
        value: metrics.memory.usagePercentage,
        threshold: this.thresholds.memory.warning,
        suggestions: [
          '不要なアプリケーションを終了してください',
          'モデルの複雑さを減らしてください'
        ]
      });
    }

    // ディスクチェック
    if (metrics.disk.usagePercentage >= this.thresholds.disk.critical) {
      issues.push({
        type: 'disk',
        severity: 'critical',
        message: 'ディスク使用量が危険レベルに達しています',
        value: metrics.disk.usagePercentage,
        threshold: this.thresholds.disk.critical,
        suggestions: [
          '不要なファイルを削除してください',
          '古いシミュレーション結果を削除してください',
          'ディスク容量を増やしてください'
        ]
      });
    } else if (metrics.disk.usagePercentage >= this.thresholds.disk.warning) {
      issues.push({
        type: 'disk',
        severity: 'warning',
        message: 'ディスク使用量が高くなっています',
        value: metrics.disk.usagePercentage,
        threshold: this.thresholds.disk.warning,
        suggestions: [
          '不要なファイルを削除してください',
          '自動バックアップの設定を確認してください'
        ]
      });
    }

    // プロセスメモリチェック
    if (metrics.process.memoryUsage.heapUsed >= this.thresholds.process.maxMemory) {
      issues.push({
        type: 'process',
        severity: 'critical',
        message: 'アプリケーションのメモリ使用量が上限に達しています',
        value: metrics.process.memoryUsage.heapUsed,
        threshold: this.thresholds.process.maxMemory,
        suggestions: [
          'アプリケーションを再起動してください',
          '実行中のシミュレーションを停止してください'
        ]
      });
    }

    return issues;
  }

  private calculateHealthStatus(issues: HealthIssue[]): 'healthy' | 'warning' | 'critical' | 'down' {
    if (issues.length === 0) {
      return 'healthy';
    }

    const hasCritical = issues.some(issue => issue.severity === 'critical');
    if (hasCritical) {
      return 'critical';
    }

    return 'warning';
  }

  private calculateHealthScore(issues: HealthIssue[]): number {
    if (issues.length === 0) {
      return 100;
    }

    let score = 100;
    for (const issue of issues) {
      if (issue.severity === 'critical') {
        score -= 30;
      } else if (issue.severity === 'warning') {
        score -= 10;
      }
    }

    return Math.max(0, score);
  }

  private addToHistory(healthStatus: HealthStatus): void {
    this.healthHistory.push(healthStatus);
    
    // 履歴サイズ制限
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory = this.healthHistory.slice(-this.maxHistorySize);
    }
  }

  private handleHealthIssues(issues: HealthIssue[]): void {
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    
    if (criticalIssues.length > 0) {
      // クリティカルな問題がある場合
      for (const issue of criticalIssues) {
        const error = new AppError(
          ErrorCode.SYSTEM_RESOURCE_EXHAUSTED,
          `Critical system issue: ${issue.message}`,
          issue.message,
          ErrorSeverity.CRITICAL,
          {
            timestamp: new Date(),
            additionalData: {
              type: issue.type,
              value: issue.value,
              threshold: issue.threshold
            }
          },
          issue.suggestions
        );
        
        this.errorReporting.reportError(error);
      }
      
      // クリティカルイベント発行
      this.emit('critical', criticalIssues);
    } else {
      // 警告レベルの問題
      this.emit('warning', issues);
    }
  }

  public updateThresholds(newThresholds: Partial<HealthThresholds>): void {
    Object.assign(this.thresholds, newThresholds);
    logger.info('Health monitoring thresholds updated', newThresholds);
  }

  public getThresholds(): HealthThresholds {
    return { ...this.thresholds };
  }
}
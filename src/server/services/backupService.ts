/**
 * 自動バックアップサービス
 * 設定とデータの定期バックアップ、復元機能
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { logger } from '../utils/logger';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { ErrorReportingService } from '../../shared/services/errorReportingService';
import { DatabaseManager } from '../database/DatabaseManager';

export interface BackupConfig {
  enabled: boolean;
  interval: number; // milliseconds
  maxBackups: number;
  compression: boolean;
  includeUploads: boolean;
  includeLogs: boolean;
  backupPath: string;
}

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  version: string;
  size: number; // bytes
  compressed: boolean;
  files: BackupFileInfo[];
  checksum: string;
}

export interface BackupFileInfo {
  path: string;
  size: number;
  lastModified: Date;
  checksum: string;
}

export interface RestoreOptions {
  backupId: string;
  includeDatabase: boolean;
  includeUploads: boolean;
  includeLogs: boolean;
  overwriteExisting: boolean;
}

export class BackupService extends EventEmitter {
  private static instance: BackupService;
  private backupInterval: NodeJS.Timeout | null = null;
  private isBackupRunning = false;
  private errorReporting: ErrorReportingService;
  private dbManager?: DatabaseManager;
  
  private readonly config: BackupConfig = {
    enabled: true,
    interval: 24 * 60 * 60 * 1000, // 24 hours
    maxBackups: 7,
    compression: true,
    includeUploads: true,
    includeLogs: false,
    backupPath: path.join(process.cwd(), 'app_data', 'backups')
  };

  public static getInstance(): BackupService {
    if (!BackupService.instance) {
      BackupService.instance = new BackupService();
    }
    return BackupService.instance;
  }

  constructor() {
    super();
    this.errorReporting = ErrorReportingService.getInstance();
    // DatabaseManager will be injected when needed
  }

  public async initialize(): Promise<void> {
    try {
      // バックアップディレクトリ作成
      await fs.mkdir(this.config.backupPath, { recursive: true });
      
      // 自動バックアップ開始
      if (this.config.enabled) {
        this.startAutoBackup();
      }
      
      logger.info('Backup service initialized');
    } catch (error: any) {
      const initError = new AppError(
        ErrorCode.SYSTEM_STARTUP_FAILED,
        `Failed to initialize backup service: ${error.message}`,
        'バックアップサービスの初期化に失敗しました',
        ErrorSeverity.ERROR
      );
      
      this.errorReporting.reportError(initError);
      throw initError;
    }
  }

  public startAutoBackup(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    this.backupInterval = setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error: any) {
        logger.error('Scheduled backup failed:', error);
      }
    }, this.config.interval);

    logger.info(`Auto backup started (interval: ${this.config.interval}ms)`);
  }

  public stopAutoBackup(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    logger.info('Auto backup stopped');
  }

  public async createBackup(description?: string): Promise<BackupMetadata> {
    if (this.isBackupRunning) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Backup is already running',
        'バックアップが既に実行中です',
        ErrorSeverity.WARNING
      );
    }

    this.isBackupRunning = true;
    const backupId = this.generateBackupId();
    
    try {
      logger.info(`Starting backup: ${backupId}`);
      this.emit('backupStarted', { backupId, timestamp: new Date() });

      // バックアップメタデータ
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp: new Date(),
        version: process.env.npm_package_version || '1.0.0',
        size: 0,
        compressed: this.config.compression,
        files: [],
        checksum: ''
      };

      // バックアップディレクトリ作成
      const backupDir = path.join(this.config.backupPath, backupId);
      await fs.mkdir(backupDir, { recursive: true });

      // データベースバックアップ
      await this.backupDatabase(backupDir, metadata);

      // 設定ファイルバックアップ
      await this.backupConfigFiles(backupDir, metadata);

      // アップロードファイルバックアップ
      if (this.config.includeUploads) {
        await this.backupUploads(backupDir, metadata);
      }

      // ログファイルバックアップ
      if (this.config.includeLogs) {
        await this.backupLogs(backupDir, metadata);
      }

      // メタデータファイル作成
      await this.saveMetadata(backupDir, metadata);

      // 圧縮
      if (this.config.compression) {
        await this.compressBackup(backupDir, metadata);
      }

      // 古いバックアップ削除
      await this.cleanupOldBackups();

      logger.info(`Backup completed: ${backupId} (${this.formatBytes(metadata.size)})`);
      this.emit('backupCompleted', metadata);

      return metadata;

    } catch (error: any) {
      const backupError = new AppError(
        ErrorCode.SYSTEM_CRASH,
        `Backup failed: ${error.message}`,
        'バックアップの作成に失敗しました',
        ErrorSeverity.ERROR,
        {
          additionalData: { backupId }
        }
      );
      
      this.errorReporting.reportError(backupError);
      this.emit('backupFailed', { backupId, error: backupError });
      throw backupError;
      
    } finally {
      this.isBackupRunning = false;
    }
  }

  public async restoreBackup(options: RestoreOptions): Promise<void> {
    const { backupId } = options;
    
    try {
      logger.info(`Starting restore from backup: ${backupId}`);
      this.emit('restoreStarted', { backupId, timestamp: new Date() });

      // バックアップの存在確認
      const backupPath = await this.findBackupPath(backupId);
      if (!backupPath) {
        throw new AppError(
          ErrorCode.FILE_NOT_FOUND,
          `Backup not found: ${backupId}`,
          'バックアップファイルが見つかりません',
          ErrorSeverity.ERROR
        );
      }

      // メタデータ読み込み
      const metadata = await this.loadMetadata(backupPath);

      // 展開（圧縮されている場合）
      let restoreDir = backupPath;
      if (metadata.compressed) {
        restoreDir = await this.decompressBackup(backupPath);
      }

      // データベース復元
      if (options.includeDatabase) {
        await this.restoreDatabase(restoreDir);
      }

      // アップロードファイル復元
      if (options.includeUploads) {
        await this.restoreUploads(restoreDir, options.overwriteExisting);
      }

      // ログファイル復元
      if (options.includeLogs) {
        await this.restoreLogs(restoreDir, options.overwriteExisting);
      }

      logger.info(`Restore completed from backup: ${backupId}`);
      this.emit('restoreCompleted', { backupId, timestamp: new Date() });

    } catch (error: any) {
      const restoreError = new AppError(
        ErrorCode.SYSTEM_CRASH,
        `Restore failed: ${error.message}`,
        'バックアップの復元に失敗しました',
        ErrorSeverity.ERROR,
        {
          additionalData: { backupId }
        }
      );
      
      this.errorReporting.reportError(restoreError);
      this.emit('restoreFailed', { backupId, error: restoreError });
      throw restoreError;
    }
  }

  public async listBackups(): Promise<BackupMetadata[]> {
    try {
      const backupDirs = await fs.readdir(this.config.backupPath);
      const backups: BackupMetadata[] = [];

      for (const dir of backupDirs) {
        try {
          const backupPath = path.join(this.config.backupPath, dir);
          const metadata = await this.loadMetadata(backupPath);
          backups.push(metadata);
        } catch (error) {
          // メタデータが読めないバックアップはスキップ
          logger.warn(`Failed to load metadata for backup: ${dir}`);
        }
      }

      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error: any) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }

  public async deleteBackup(backupId: string): Promise<void> {
    try {
      const backupPath = await this.findBackupPath(backupId);
      if (!backupPath) {
        throw new AppError(
          ErrorCode.FILE_NOT_FOUND,
          `Backup not found: ${backupId}`,
          'バックアップファイルが見つかりません',
          ErrorSeverity.ERROR
        );
      }

      await fs.rm(backupPath, { recursive: true, force: true });
      logger.info(`Backup deleted: ${backupId}`);
      
    } catch (error: any) {
      const deleteError = new AppError(
        ErrorCode.FILE_ACCESS_DENIED,
        `Failed to delete backup: ${error.message}`,
        'バックアップの削除に失敗しました',
        ErrorSeverity.ERROR
      );
      
      this.errorReporting.reportError(deleteError);
      throw deleteError;
    }
  }

  private async backupDatabase(backupDir: string, metadata: BackupMetadata): Promise<void> {
    const dbPath = path.join(process.cwd(), 'app_data', 'openwam.db');
    const backupDbPath = path.join(backupDir, 'database.db');
    
    try {
      await fs.copyFile(dbPath, backupDbPath);
      
      const stats = await fs.stat(backupDbPath);
      metadata.files.push({
        path: 'database.db',
        size: stats.size,
        lastModified: stats.mtime,
        checksum: await this.calculateChecksum(backupDbPath)
      });
      
      metadata.size += stats.size;
    } catch (error: any) {
      logger.error('Failed to backup database:', error);
      throw error;
    }
  }

  private async backupConfigFiles(backupDir: string, metadata: BackupMetadata): Promise<void> {
    const configFiles = [
      'package.json',
      '.env',
      'tsconfig.json'
    ];

    for (const configFile of configFiles) {
      try {
        const sourcePath = path.join(process.cwd(), configFile);
        const backupPath = path.join(backupDir, 'config', configFile);
        
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.copyFile(sourcePath, backupPath);
        
        const stats = await fs.stat(backupPath);
        metadata.files.push({
          path: `config/${configFile}`,
          size: stats.size,
          lastModified: stats.mtime,
          checksum: await this.calculateChecksum(backupPath)
        });
        
        metadata.size += stats.size;
      } catch (error: any) {
        // 設定ファイルが存在しない場合はスキップ
        if (error.code !== 'ENOENT') {
          logger.error(`Failed to backup config file ${configFile}:`, error);
        }
      }
    }
  }

  private async backupUploads(backupDir: string, metadata: BackupMetadata): Promise<void> {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const backupUploadsDir = path.join(backupDir, 'uploads');
    
    try {
      await this.copyDirectory(uploadsDir, backupUploadsDir, metadata, 'uploads/');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to backup uploads:', error);
        throw error;
      }
    }
  }

  private async backupLogs(backupDir: string, metadata: BackupMetadata): Promise<void> {
    const logsDir = path.join(process.cwd(), 'logs');
    const backupLogsDir = path.join(backupDir, 'logs');
    
    try {
      await this.copyDirectory(logsDir, backupLogsDir, metadata, 'logs/');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to backup logs:', error);
        throw error;
      }
    }
  }

  private async copyDirectory(sourceDir: string, targetDir: string, metadata: BackupMetadata, prefix: string): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });
    
    const items = await fs.readdir(sourceDir);
    
    for (const item of items) {
      const sourcePath = path.join(sourceDir, item);
      const targetPath = path.join(targetDir, item);
      
      const stats = await fs.stat(sourcePath);
      
      if (stats.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath, metadata, `${prefix}${item}/`);
      } else {
        await fs.copyFile(sourcePath, targetPath);
        
        metadata.files.push({
          path: `${prefix}${item}`,
          size: stats.size,
          lastModified: stats.mtime,
          checksum: await this.calculateChecksum(targetPath)
        });
        
        metadata.size += stats.size;
      }
    }
  }

  private async saveMetadata(backupDir: string, metadata: BackupMetadata): Promise<void> {
    const metadataPath = path.join(backupDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private async loadMetadata(backupPath: string): Promise<BackupMetadata> {
    let metadataPath: string;
    
    // 圧縮されたバックアップの場合
    if (backupPath.endsWith('.tar.gz')) {
      // 簡略化: 実際の実装では tar.gz から metadata.json を抽出
      throw new Error('Compressed backup metadata loading not implemented');
    } else {
      metadataPath = path.join(backupPath, 'metadata.json');
    }
    
    const metadataContent = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);
    
    // Date オブジェクトに変換
    metadata.timestamp = new Date(metadata.timestamp);
    metadata.files.forEach((file: any) => {
      file.lastModified = new Date(file.lastModified);
    });
    
    return metadata;
  }

  private async compressBackup(backupDir: string, metadata: BackupMetadata): Promise<void> {
    // 簡略化: 実際の実装では tar.gz 圧縮を行う
    logger.info('Backup compression not implemented in this version');
  }

  private async decompressBackup(backupPath: string): Promise<string> {
    // 簡略化: 実際の実装では tar.gz 展開を行う
    throw new Error('Backup decompression not implemented in this version');
  }

  private async findBackupPath(backupId: string): Promise<string | null> {
    const possiblePaths = [
      path.join(this.config.backupPath, backupId),
      path.join(this.config.backupPath, `${backupId}.tar.gz`)
    ];
    
    for (const backupPath of possiblePaths) {
      try {
        await fs.access(backupPath);
        return backupPath;
      } catch (error) {
        // ファイルが存在しない場合は次をチェック
      }
    }
    
    return null;
  }

  private async restoreDatabase(restoreDir: string): Promise<void> {
    const backupDbPath = path.join(restoreDir, 'database.db');
    const dbPath = path.join(process.cwd(), 'app_data', 'openwam.db');
    
    // データベース接続を閉じる
    if (this.dbManager) {
      await this.dbManager.close();
    }
    
    try {
      await fs.copyFile(backupDbPath, dbPath);
      
      // データベース接続を再開
      if (this.dbManager) {
        await this.dbManager.initialize();
      }
      
    } catch (error: any) {
      logger.error('Failed to restore database:', error);
      throw error;
    }
  }

  private async restoreUploads(restoreDir: string, overwrite: boolean): Promise<void> {
    const backupUploadsDir = path.join(restoreDir, 'uploads');
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    try {
      await this.restoreDirectory(backupUploadsDir, uploadsDir, overwrite);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to restore uploads:', error);
        throw error;
      }
    }
  }

  private async restoreLogs(restoreDir: string, overwrite: boolean): Promise<void> {
    const backupLogsDir = path.join(restoreDir, 'logs');
    const logsDir = path.join(process.cwd(), 'logs');
    
    try {
      await this.restoreDirectory(backupLogsDir, logsDir, overwrite);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to restore logs:', error);
        throw error;
      }
    }
  }

  private async restoreDirectory(sourceDir: string, targetDir: string, overwrite: boolean): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });
    
    const items = await fs.readdir(sourceDir);
    
    for (const item of items) {
      const sourcePath = path.join(sourceDir, item);
      const targetPath = path.join(targetDir, item);
      
      const stats = await fs.stat(sourcePath);
      
      if (stats.isDirectory()) {
        await this.restoreDirectory(sourcePath, targetPath, overwrite);
      } else {
        if (!overwrite) {
          try {
            await fs.access(targetPath);
            continue; // ファイルが存在し、上書きしない場合はスキップ
          } catch (error) {
            // ファイルが存在しない場合は続行
          }
        }
        
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups();
      
      if (backups.length > this.config.maxBackups) {
        const backupsToDelete = backups.slice(this.config.maxBackups);
        
        for (const backup of backupsToDelete) {
          await this.deleteBackup(backup.id);
          logger.info(`Old backup deleted: ${backup.id}`);
        }
      }
    } catch (error: any) {
      logger.error('Failed to cleanup old backups:', error);
    }
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    // 簡略化: 実際の実装では SHA-256 ハッシュを計算
    const stats = await fs.stat(filePath);
    return `${stats.size}_${stats.mtime.getTime()}`;
  }

  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `backup_${timestamp}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  public updateConfig(newConfig: Partial<BackupConfig>): void {
    Object.assign(this.config, newConfig);
    
    // 自動バックアップの再開
    if (this.config.enabled && this.backupInterval) {
      this.stopAutoBackup();
      this.startAutoBackup();
    } else if (!this.config.enabled) {
      this.stopAutoBackup();
    }
    
    logger.info('Backup config updated:', newConfig);
  }

  public getConfig(): BackupConfig {
    return { ...this.config };
  }

  public async shutdown(): Promise<void> {
    this.stopAutoBackup();
    logger.info('Backup service shutdown complete');
  }
}
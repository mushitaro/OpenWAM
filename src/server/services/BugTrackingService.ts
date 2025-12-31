import { DatabaseManager } from '../database/DatabaseManager';
import { BugReport, BugComment, BugAttachment, CreateBugRequest, UpdateBugRequest, BugStatistics, BugSearchFilters, BugEnvironment } from '../../shared/types/bugTracking';
import { BugPriorityCalculator } from '../../shared/services/bugPriorityCalculator';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export class BugTrackingService {
  constructor(private db: DatabaseManager) {}

  /**
   * 新しいバグレポートを作成
   */
  async createBugReport(reportData: CreateBugRequest, reportedBy: string = 'anonymous'): Promise<BugReport> {
    try {
      // 優先度を計算
      const tempBug: BugReport = {
        id: 0,
        title: reportData.title,
        description: reportData.description,
        severity: reportData.severity,
        status: 'open',
        category: reportData.category,
        type: reportData.type,
        reportedBy,
        reportedAt: new Date().toISOString(),
        environment: reportData.environment,
        reproductionSteps: reportData.reproductionSteps,
        expectedBehavior: reportData.expectedBehavior,
        actualBehavior: reportData.actualBehavior,
        errorMessage: reportData.errorMessage,
        stackTrace: reportData.stackTrace,
        consoleErrors: reportData.consoleErrors,
        performanceMetrics: reportData.performanceMetrics,
        projectId: reportData.projectId,
        modelData: reportData.modelData,
        componentIds: reportData.componentIds,
        relatedBugs: [],
        tags: reportData.tags || [],
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        priorityScore: 0,
        priorityFactors: {} as any
      };

      const priorityFactors = BugPriorityCalculator.calculatePriority(tempBug);
      tempBug.priorityScore = priorityFactors.totalScore;
      tempBug.priorityFactors = priorityFactors;

      const bugReport = await this.db.createBugReport(tempBug);

      logger.info(`Bug report created: ${bugReport.id} - ${bugReport.title}`);
      return bugReport;
    } catch (error) {
      logger.error('Failed to create bug report:', error);
      throw error;
    }
  }

  /**
   * バグレポートを取得
   */
  async getBugReport(id: number): Promise<BugReport> {
    try {
      const bugReport = await this.db.getBugReport(id);
      
      // 添付ファイルを読み込み
      bugReport.attachments = await this.db.getBugAttachments(id);
      
      return bugReport;
    } catch (error) {
      logger.error(`Failed to get bug report ${id}:`, error);
      throw error;
    }
  }

  /**
   * バグレポート一覧を取得
   */
  async getBugReports(filters?: BugSearchFilters, page: number = 1, pageSize: number = 20): Promise<{
    bugs: BugReport[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    try {
      const offset = (page - 1) * pageSize;
      
      const dbFilters = {
        status: filters?.status,
        severity: filters?.severity,
        category: filters?.category,
        assignedTo: filters?.assignedTo,
        projectId: filters?.projectId,
        limit: pageSize,
        offset
      };

      const result = await this.db.getAllBugReports(dbFilters);
      
      // 各バグの添付ファイルを読み込み（パフォーマンスを考慮して必要に応じて）
      for (const bug of result.bugs) {
        bug.attachments = await this.db.getBugAttachments(bug.id);
      }

      return {
        bugs: result.bugs,
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize)
      };
    } catch (error) {
      logger.error('Failed to get bug reports:', error);
      throw error;
    }
  }

  /**
   * バグレポートを更新
   */
  async updateBugReport(id: number, updates: UpdateBugRequest): Promise<BugReport> {
    try {
      const currentBug = await this.db.getBugReport(id);
      
      // ステータスが解決済みに変更された場合、解決日時を設定
      if (updates.status === 'resolved' && currentBug.status !== 'resolved') {
        updates.resolvedAt = new Date().toISOString();
      }

      // 優先度を再計算（重要な変更があった場合）
      if (updates.severity || updates.category || updates.type) {
        const updatedBug = { ...currentBug, ...updates };
        const priorityFactors = BugPriorityCalculator.calculatePriority(updatedBug as BugReport);
        updates.priorityScore = priorityFactors.totalScore;
        updates.priorityFactors = priorityFactors;
      }

      const bugReport = await this.db.updateBugReport(id, updates as any);
      
      logger.info(`Bug report updated: ${id} - ${bugReport.title}`);
      return bugReport;
    } catch (error) {
      logger.error(`Failed to update bug report ${id}:`, error);
      throw error;
    }
  }

  /**
   * バグレポートを削除
   */
  async deleteBugReport(id: number): Promise<void> {
    try {
      // 関連する添付ファイルを削除
      const attachments = await this.db.getBugAttachments(id);
      for (const attachment of attachments) {
        try {
          await fs.unlink(attachment.filePath);
        } catch (error) {
          logger.warn(`Failed to delete attachment file: ${attachment.filePath}`, error);
        }
      }

      await this.db.deleteBugReport(id);
      logger.info(`Bug report deleted: ${id}`);
    } catch (error) {
      logger.error(`Failed to delete bug report ${id}:`, error);
      throw error;
    }
  }

  /**
   * バグコメントを追加
   */
  async addComment(bugId: number, author: string, content: string, attachments?: BugAttachment[]): Promise<BugComment> {
    try {
      const comment = await this.db.createBugComment(bugId, author, content, attachments);
      logger.info(`Comment added to bug ${bugId} by ${author}`);
      return comment;
    } catch (error) {
      logger.error(`Failed to add comment to bug ${bugId}:`, error);
      throw error;
    }
  }

  /**
   * バグコメント一覧を取得
   */
  async getComments(bugId: number): Promise<BugComment[]> {
    try {
      return await this.db.getBugComments(bugId);
    } catch (error) {
      logger.error(`Failed to get comments for bug ${bugId}:`, error);
      throw error;
    }
  }

  /**
   * 添付ファイルをアップロード
   */
  async uploadAttachment(
    bugId: number,
    file: Express.Multer.File,
    fileType: 'screenshot' | 'video' | 'log' | 'model' | 'other',
    description?: string
  ): Promise<BugAttachment> {
    try {
      const attachmentId = uuidv4();
      const uploadsDir = path.join(__dirname, '../../../app_data/bug_attachments');
      
      // ディレクトリを作成
      await fs.mkdir(uploadsDir, { recursive: true });
      
      // ファイル名を生成
      const fileExtension = path.extname(file.originalname);
      const filename = `${attachmentId}${fileExtension}`;
      const filePath = path.join(uploadsDir, filename);
      
      // ファイルを保存
      await fs.writeFile(filePath, file.buffer);
      
      const attachment: Omit<BugAttachment, 'uploadedAt'> = {
        id: attachmentId,
        bugId,
        filename: file.originalname,
        filePath,
        fileType,
        fileSize: file.size,
        description
      };
      
      const savedAttachment = await this.db.createBugAttachment(attachment);
      logger.info(`Attachment uploaded for bug ${bugId}: ${filename}`);
      
      return savedAttachment;
    } catch (error) {
      logger.error(`Failed to upload attachment for bug ${bugId}:`, error);
      throw error;
    }
  }

  /**
   * 添付ファイルを取得
   */
  async getAttachment(attachmentId: string): Promise<BugAttachment> {
    try {
      return await this.db.getBugAttachment(attachmentId);
    } catch (error) {
      logger.error(`Failed to get attachment ${attachmentId}:`, error);
      throw error;
    }
  }

  /**
   * バグ統計を取得
   */
  async getBugStatistics(): Promise<BugStatistics> {
    try {
      const allBugs = await this.db.getAllBugReports();
      const bugs = allBugs.bugs;

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const statistics: BugStatistics = {
        total: bugs.length,
        byStatus: {
          open: 0,
          in_progress: 0,
          resolved: 0,
          closed: 0,
          duplicate: 0,
          wont_fix: 0
        },
        bySeverity: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0
        },
        byCategory: {
          ui_ux: 0,
          functionality: 0,
          performance: 0,
          browser_compatibility: 0,
          file_operations: 0,
          simulation: 0,
          validation: 0,
          connectivity: 0,
          data_integrity: 0,
          security: 0
        },
        byType: {
          bug: 0,
          enhancement: 0,
          feature_request: 0,
          performance_issue: 0,
          compatibility_issue: 0
        },
        openedThisWeek: 0,
        resolvedThisWeek: 0,
        averageResolutionTime: 0,
        criticalBugsOpen: 0,
        highPriorityBugsOpen: 0,
        browserIssues: {},
        performanceIssues: 0
      };

      let totalResolutionTime = 0;
      let resolvedBugsCount = 0;
      let oldestOpenBug: BugReport | undefined;

      for (const bug of bugs) {
        // Status statistics
        statistics.byStatus[bug.status]++;
        
        // Severity statistics
        statistics.bySeverity[bug.severity]++;
        
        // Category statistics
        statistics.byCategory[bug.category]++;
        
        // Type statistics
        statistics.byType[bug.type]++;

        // Weekly statistics
        const createdAt = new Date(bug.createdAt);
        if (createdAt >= oneWeekAgo) {
          statistics.openedThisWeek++;
        }

        if (bug.resolvedAt) {
          const resolvedAt = new Date(bug.resolvedAt);
          if (resolvedAt >= oneWeekAgo) {
            statistics.resolvedThisWeek++;
          }
          
          // Resolution time calculation
          const resolutionTime = resolvedAt.getTime() - createdAt.getTime();
          totalResolutionTime += resolutionTime;
          resolvedBugsCount++;
        }

        // Priority statistics
        if (bug.severity === 'critical' && (bug.status === 'open' || bug.status === 'in_progress')) {
          statistics.criticalBugsOpen++;
        }
        
        if (bug.priorityScore >= 75 && (bug.status === 'open' || bug.status === 'in_progress')) {
          statistics.highPriorityBugsOpen++;
        }

        // Oldest open bug
        if ((bug.status === 'open' || bug.status === 'in_progress')) {
          if (!oldestOpenBug || new Date(bug.createdAt) < new Date(oldestOpenBug.createdAt)) {
            oldestOpenBug = bug;
          }
        }

        // Browser compatibility issues
        if (bug.category === 'browser_compatibility') {
          const browser = bug.environment.browser || 'Unknown';
          statistics.browserIssues[browser] = (statistics.browserIssues[browser] || 0) + 1;
        }

        // Performance issues
        if (bug.category === 'performance' || bug.type === 'performance_issue') {
          statistics.performanceIssues++;
        }
      }

      // Calculate average resolution time in hours
      if (resolvedBugsCount > 0) {
        statistics.averageResolutionTime = Math.round(totalResolutionTime / resolvedBugsCount / (1000 * 60 * 60));
      }

      statistics.oldestOpenBug = oldestOpenBug;

      return statistics;
    } catch (error) {
      logger.error('Failed to get bug statistics:', error);
      throw error;
    }
  }

  /**
   * 環境情報を自動収集
   */
  static collectEnvironmentInfo(userAgent: string, additionalInfo?: Partial<BugEnvironment>): BugEnvironment {
    // User Agentから基本情報を抽出
    const browserInfo = this.parseBrowserInfo(userAgent);
    
    return {
      browser: browserInfo.browser,
      browserVersion: browserInfo.version,
      os: browserInfo.os,
      osVersion: browserInfo.osVersion,
      screenResolution: additionalInfo?.screenResolution || 'Unknown',
      deviceType: additionalInfo?.deviceType || 'desktop',
      userAgent,
      timestamp: new Date().toISOString(),
      ...additionalInfo
    };
  }

  private static parseBrowserInfo(userAgent: string): {
    browser: string;
    version: string;
    os: string;
    osVersion: string;
  } {
    let browser = 'Unknown';
    let version = 'Unknown';
    let os = 'Unknown';
    let osVersion = 'Unknown';

    // Browser detection
    if (userAgent.includes('Chrome')) {
      browser = 'Chrome';
      const match = userAgent.match(/Chrome\/([0-9.]+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Firefox')) {
      browser = 'Firefox';
      const match = userAgent.match(/Firefox\/([0-9.]+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'Safari';
      const match = userAgent.match(/Version\/([0-9.]+)/);
      version = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Edge')) {
      browser = 'Edge';
      const match = userAgent.match(/Edge\/([0-9.]+)/);
      version = match ? match[1] : 'Unknown';
    }

    // OS detection
    if (userAgent.includes('Windows NT')) {
      os = 'Windows';
      const match = userAgent.match(/Windows NT ([0-9.]+)/);
      osVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Mac OS X')) {
      os = 'macOS';
      const match = userAgent.match(/Mac OS X ([0-9_]+)/);
      osVersion = match ? match[1].replace(/_/g, '.') : 'Unknown';
    } else if (userAgent.includes('Linux')) {
      os = 'Linux';
    }

    return { browser, version, os, osVersion };
  }

  /**
   * 重複バグを検出
   */
  async findDuplicateBugs(bugReport: BugReport): Promise<BugReport[]> {
    try {
      const allBugs = await this.db.getAllBugReports({
        status: ['open', 'in_progress'],
        category: [bugReport.category]
      });

      const potentialDuplicates: BugReport[] = [];

      for (const bug of allBugs.bugs) {
        if (bug.id === bugReport.id) continue;

        let similarity = 0;

        // Title similarity (simple word matching)
        const titleWords1 = bugReport.title.toLowerCase().split(/\s+/);
        const titleWords2 = bug.title.toLowerCase().split(/\s+/);
        const commonTitleWords = titleWords1.filter(word => titleWords2.includes(word));
        similarity += (commonTitleWords.length / Math.max(titleWords1.length, titleWords2.length)) * 0.4;

        // Category and type match
        if (bug.category === bugReport.category) similarity += 0.2;
        if (bug.type === bugReport.type) similarity += 0.1;

        // Error message similarity
        if (bug.errorMessage && bugReport.errorMessage) {
          if (bug.errorMessage === bugReport.errorMessage) {
            similarity += 0.3;
          }
        }

        // Component similarity
        if (bug.componentIds && bugReport.componentIds) {
          const commonComponents = bug.componentIds.filter(id => 
            bugReport.componentIds!.includes(id)
          );
          if (commonComponents.length > 0) {
            similarity += 0.2;
          }
        }

        // Consider as potential duplicate if similarity > 60%
        if (similarity > 0.6) {
          potentialDuplicates.push(bug);
        }
      }

      return potentialDuplicates.sort((a, b) => b.priorityScore - a.priorityScore);
    } catch (error) {
      logger.error('Failed to find duplicate bugs:', error);
      return [];
    }
  }
}
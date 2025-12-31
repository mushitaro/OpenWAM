import express from 'express';
import multer from 'multer';
import { BugTrackingService } from '../services/BugTrackingService';
import { DatabaseManager } from '../database/DatabaseManager';
import { CreateBugRequest, UpdateBugRequest, BugSearchFilters } from '../../shared/types/bugTracking';
import { logger } from '../utils/logger';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types for bug attachments
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
      'text/plain',
      'application/json',
      'application/octet-stream'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});

// Initialize service (will be injected by the main server)
let bugTrackingService: BugTrackingService;

export function initializeBugTrackingRoutes(db: DatabaseManager) {
  bugTrackingService = new BugTrackingService(db);
}

/**
 * GET /api/bugs
 * バグレポート一覧を取得
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    
    const filters: BugSearchFilters = {};
    
    if (req.query.status) {
      filters.status = Array.isArray(req.query.status) 
        ? req.query.status as string[]
        : [req.query.status as string];
    }
    
    if (req.query.severity) {
      filters.severity = Array.isArray(req.query.severity)
        ? req.query.severity as string[]
        : [req.query.severity as string];
    }
    
    if (req.query.category) {
      filters.category = Array.isArray(req.query.category)
        ? req.query.category as string[]
        : [req.query.category as string];
    }
    
    if (req.query.assignedTo) {
      filters.assignedTo = req.query.assignedTo as string;
    }
    
    if (req.query.projectId) {
      filters.projectId = parseInt(req.query.projectId as string);
    }
    
    if (req.query.tags) {
      filters.tags = Array.isArray(req.query.tags)
        ? req.query.tags as string[]
        : [req.query.tags as string];
    }

    const result = await bugTrackingService.getBugReports(filters, page, pageSize);
    
    res.json({
      data: result
    });
  } catch (error) {
    logger.error('Failed to get bug reports:', error);
    res.status(500).json({
      error: {
        message: 'バグレポートの取得に失敗しました',
        code: 'BUG_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * GET /api/bugs/:id
 * 特定のバグレポートを取得
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bugReport = await bugTrackingService.getBugReport(id);
    
    res.json({
      data: bugReport
    });
  } catch (error) {
    logger.error(`Failed to get bug report ${req.params.id}:`, error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: {
          message: 'バグレポートが見つかりません',
          code: 'BUG_NOT_FOUND'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'バグレポートの取得に失敗しました',
          code: 'BUG_FETCH_ERROR',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

/**
 * POST /api/bugs
 * 新しいバグレポートを作成
 */
router.post('/', async (req, res) => {
  try {
    const bugData: CreateBugRequest = req.body;
    
    // 環境情報を自動収集
    const userAgent = req.headers['user-agent'] || '';
    const environment = BugTrackingService.collectEnvironmentInfo(userAgent, bugData.environment);
    bugData.environment = environment;
    
    const reportedBy = req.headers['x-user-id'] as string || 'anonymous';
    
    const bugReport = await bugTrackingService.createBugReport(bugData, reportedBy);
    
    res.status(201).json({
      data: bugReport
    });
  } catch (error) {
    logger.error('Failed to create bug report:', error);
    res.status(500).json({
      error: {
        message: 'バグレポートの作成に失敗しました',
        code: 'BUG_CREATE_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * PUT /api/bugs/:id
 * バグレポートを更新
 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates: UpdateBugRequest = req.body;
    
    const bugReport = await bugTrackingService.updateBugReport(id, updates);
    
    res.json({
      data: bugReport
    });
  } catch (error) {
    logger.error(`Failed to update bug report ${req.params.id}:`, error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: {
          message: 'バグレポートが見つかりません',
          code: 'BUG_NOT_FOUND'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'バグレポートの更新に失敗しました',
          code: 'BUG_UPDATE_ERROR',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

/**
 * DELETE /api/bugs/:id
 * バグレポートを削除
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await bugTrackingService.deleteBugReport(id);
    
    res.status(204).send();
  } catch (error) {
    logger.error(`Failed to delete bug report ${req.params.id}:`, error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: {
          message: 'バグレポートが見つかりません',
          code: 'BUG_NOT_FOUND'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'バグレポートの削除に失敗しました',
          code: 'BUG_DELETE_ERROR',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

/**
 * GET /api/bugs/:id/comments
 * バグのコメント一覧を取得
 */
router.get('/:id/comments', async (req, res) => {
  try {
    const bugId = parseInt(req.params.id);
    const comments = await bugTrackingService.getComments(bugId);
    
    res.json({
      data: comments
    });
  } catch (error) {
    logger.error(`Failed to get comments for bug ${req.params.id}:`, error);
    res.status(500).json({
      error: {
        message: 'コメントの取得に失敗しました',
        code: 'COMMENT_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * POST /api/bugs/:id/comments
 * バグにコメントを追加
 */
router.post('/:id/comments', async (req, res) => {
  try {
    const bugId = parseInt(req.params.id);
    const { content } = req.body;
    const author = req.headers['x-user-id'] as string || 'anonymous';
    
    const comment = await bugTrackingService.addComment(bugId, author, content);
    
    res.status(201).json({
      data: comment
    });
  } catch (error) {
    logger.error(`Failed to add comment to bug ${req.params.id}:`, error);
    res.status(500).json({
      error: {
        message: 'コメントの追加に失敗しました',
        code: 'COMMENT_CREATE_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * POST /api/bugs/:id/attachments
 * バグに添付ファイルをアップロード
 */
router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const bugId = parseInt(req.params.id);
    const file = req.file;
    const { fileType, description } = req.body;
    
    if (!file) {
      return res.status(400).json({
        error: {
          message: 'ファイルが指定されていません',
          code: 'FILE_REQUIRED'
        }
      });
    }
    
    const attachment = await bugTrackingService.uploadAttachment(
      bugId,
      file,
      fileType || 'other',
      description
    );
    
    res.status(201).json({
      data: attachment
    });
  } catch (error) {
    logger.error(`Failed to upload attachment for bug ${req.params.id}:`, error);
    res.status(500).json({
      error: {
        message: 'ファイルのアップロードに失敗しました',
        code: 'ATTACHMENT_UPLOAD_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * GET /api/bugs/attachments/:attachmentId
 * 添付ファイルをダウンロード
 */
router.get('/attachments/:attachmentId', async (req, res) => {
  try {
    const attachmentId = req.params.attachmentId;
    const attachment = await bugTrackingService.getAttachment(attachmentId);
    
    res.download(attachment.filePath, attachment.filename);
  } catch (error) {
    logger.error(`Failed to download attachment ${req.params.attachmentId}:`, error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: {
          message: '添付ファイルが見つかりません',
          code: 'ATTACHMENT_NOT_FOUND'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: '添付ファイルのダウンロードに失敗しました',
          code: 'ATTACHMENT_DOWNLOAD_ERROR',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

/**
 * GET /api/bugs/templates
 * バグレポートテンプレート一覧を取得
 */
router.get('/templates', async (req, res) => {
  try {
    const { BUG_TEMPLATES } = await import('../../shared/templates/bugTemplates');
    
    res.json({
      data: BUG_TEMPLATES
    });
  } catch (error) {
    logger.error('Failed to get bug templates:', error);
    res.status(500).json({
      error: {
        message: 'バグテンプレートの取得に失敗しました',
        code: 'TEMPLATE_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * GET /api/bugs/statistics
 * バグ統計を取得
 */
router.get('/statistics', async (req, res) => {
  try {
    const statistics = await bugTrackingService.getBugStatistics();
    
    res.json({
      data: statistics
    });
  } catch (error) {
    logger.error('Failed to get bug statistics:', error);
    res.status(500).json({
      error: {
        message: 'バグ統計の取得に失敗しました',
        code: 'STATISTICS_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * GET /api/bugs/:id/duplicates
 * 重複の可能性があるバグを検索
 */
router.get('/:id/duplicates', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bugReport = await bugTrackingService.getBugReport(id);
    const duplicates = await bugTrackingService.findDuplicateBugs(bugReport);
    
    res.json({
      data: duplicates
    });
  } catch (error) {
    logger.error(`Failed to find duplicates for bug ${req.params.id}:`, error);
    res.status(500).json({
      error: {
        message: '重複バグの検索に失敗しました',
        code: 'DUPLICATE_SEARCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

export { router as bugTrackingRouter };
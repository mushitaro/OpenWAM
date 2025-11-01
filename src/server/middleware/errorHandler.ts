/**
 * Express エラーハンドリングミドルウェア
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { ErrorAnalyzer } from '../../shared/errors/ErrorAnalyzer';
import { logger } from '../utils/logger';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    suggestions?: string[];
    retryable?: boolean;
    timestamp: string;
    requestId?: string;
  };
  details?: any;
}

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // リクエストIDの生成（トレーサビリティのため）
  const requestId = req.headers['x-request-id'] as string || generateRequestId();
  
  let appError: AppError;
  
  // AppErrorでない場合は変換
  if (!(error instanceof AppError)) {
    const analysis = ErrorAnalyzer.analyzeError(error);
    
    appError = new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      error.message,
      analysis.userMessage,
      analysis.severity,
      {
        requestId,
        timestamp: new Date(),
        stackTrace: error.stack,
        additionalData: {
          url: req.url,
          method: req.method,
          userAgent: req.headers['user-agent'],
          ip: req.ip
        }
      },
      analysis.suggestions,
      analysis.retryable
    );
  } else {
    appError = error;
    appError.context.requestId = requestId;
  }

  // ログ記録
  logError(appError, req);

  // レスポンス生成
  const response: ErrorResponse = {
    error: {
      code: appError.code,
      message: appError.userMessage,
      suggestions: appError.suggestions,
      retryable: appError.retryable,
      timestamp: appError.context.timestamp.toISOString(),
      requestId
    }
  };

  // 開発環境では詳細情報を含める
  if (process.env.NODE_ENV === 'development') {
    response.details = {
      technicalMessage: appError.technicalMessage,
      stack: appError.stack,
      context: appError.context
    };
  }

  res.status(appError.httpStatusCode).json(response);
};

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new AppError(
    ErrorCode.NOT_FOUND,
    `Route ${req.method} ${req.path} not found`,
    'リクエストされたリソースが見つかりません',
    ErrorSeverity.WARNING,
    {
      timestamp: new Date(),
      additionalData: {
        url: req.url,
        method: req.method
      }
    }
  );
  
  next(error);
};

function logError(error: AppError, req: Request): void {
  const logData = {
    error: {
      code: error.code,
      message: error.technicalMessage,
      severity: error.severity,
      stack: error.stack
    },
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query,
      ip: req.ip
    },
    context: error.context
  };

  switch (error.severity) {
    case ErrorSeverity.CRITICAL:
      logger.error('Critical error occurred', logData);
      break;
    case ErrorSeverity.ERROR:
      logger.error('Error occurred', logData);
      break;
    case ErrorSeverity.WARNING:
      logger.warn('Warning occurred', logData);
      break;
    case ErrorSeverity.INFO:
      logger.info('Info event occurred', logData);
      break;
  }
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
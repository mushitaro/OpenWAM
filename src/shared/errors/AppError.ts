/**
 * 包括的エラーハンドリングシステム
 * OpenWAM実行エラー、ファイルI/Oエラー、バリデーションエラーの統一処理
 */

export enum ErrorCode {
  // システムエラー
  SYSTEM_STARTUP_FAILED = 'SYSTEM_STARTUP_FAILED',
  SYSTEM_CRASH = 'SYSTEM_CRASH',
  SYSTEM_RESOURCE_EXHAUSTED = 'SYSTEM_RESOURCE_EXHAUSTED',
  
  // OpenWAM実行エラー
  OPENWAM_EXECUTION_FAILED = 'OPENWAM_EXECUTION_FAILED',
  OPENWAM_TIMEOUT = 'OPENWAM_TIMEOUT',
  OPENWAM_INVALID_INPUT = 'OPENWAM_INVALID_INPUT',
  OPENWAM_CONVERGENCE_FAILED = 'OPENWAM_CONVERGENCE_FAILED',
  OPENWAM_MEMORY_ERROR = 'OPENWAM_MEMORY_ERROR',
  OPENWAM_PROCESS_KILLED = 'OPENWAM_PROCESS_KILLED',
  
  // ファイルI/Oエラー
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED',
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  FILE_SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED',
  FILE_FORMAT_INVALID = 'FILE_FORMAT_INVALID',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_DOWNLOAD_FAILED = 'FILE_DOWNLOAD_FAILED',
  
  // バリデーションエラー
  VALIDATION_MODEL_INVALID = 'VALIDATION_MODEL_INVALID',
  VALIDATION_COMPONENT_INVALID = 'VALIDATION_COMPONENT_INVALID',
  VALIDATION_CONNECTION_INVALID = 'VALIDATION_CONNECTION_INVALID',
  VALIDATION_PROPERTY_INVALID = 'VALIDATION_PROPERTY_INVALID',
  VALIDATION_PARAMETER_OUT_OF_RANGE = 'VALIDATION_PARAMETER_OUT_OF_RANGE',
  
  // データベースエラー
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  DATABASE_QUERY_FAILED = 'DATABASE_QUERY_FAILED',
  DATABASE_CONSTRAINT_VIOLATION = 'DATABASE_CONSTRAINT_VIOLATION',
  
  // ネットワーク/通信エラー
  WEBSOCKET_CONNECTION_FAILED = 'WEBSOCKET_CONNECTION_FAILED',
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  
  // 認証・認可エラー
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // 一般的なエラー
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT'
}

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface ErrorContext {
  userId?: string;
  projectId?: number;
  simulationId?: number;
  componentId?: string;
  fileName?: string;
  requestId?: string;
  sessionId?: string;
  userAgent?: string;
  ip?: string;
  timestamp: Date;
  stackTrace?: string;
  additionalData?: Record<string, any>;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly isOperational: boolean;
  public readonly httpStatusCode: number;
  public readonly userMessage: string;
  public readonly technicalMessage: string;
  public readonly suggestions?: string[];
  public readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    technicalMessage: string,
    userMessage: string,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    context: Partial<ErrorContext> = {},
    suggestions?: string[],
    retryable: boolean = false
  ) {
    super(technicalMessage);
    
    this.name = 'AppError';
    this.code = code;
    this.severity = severity;
    this.technicalMessage = technicalMessage;
    this.userMessage = userMessage;
    this.suggestions = suggestions;
    this.retryable = retryable;
    this.isOperational = true;
    this.httpStatusCode = this.getHttpStatusCode(code);
    
    this.context = {
      timestamp: new Date(),
      stackTrace: this.stack,
      ...context
    };

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  private getHttpStatusCode(code: ErrorCode): number {
    const statusMap: Record<ErrorCode, number> = {
      [ErrorCode.SYSTEM_STARTUP_FAILED]: 503,
      [ErrorCode.SYSTEM_CRASH]: 500,
      [ErrorCode.SYSTEM_RESOURCE_EXHAUSTED]: 503,
      
      [ErrorCode.OPENWAM_EXECUTION_FAILED]: 422,
      [ErrorCode.OPENWAM_TIMEOUT]: 408,
      [ErrorCode.OPENWAM_INVALID_INPUT]: 400,
      [ErrorCode.OPENWAM_CONVERGENCE_FAILED]: 422,
      [ErrorCode.OPENWAM_MEMORY_ERROR]: 507,
      [ErrorCode.OPENWAM_PROCESS_KILLED]: 500,
      
      [ErrorCode.FILE_NOT_FOUND]: 404,
      [ErrorCode.FILE_ACCESS_DENIED]: 403,
      [ErrorCode.FILE_CORRUPTED]: 422,
      [ErrorCode.FILE_SIZE_EXCEEDED]: 413,
      [ErrorCode.FILE_FORMAT_INVALID]: 400,
      [ErrorCode.FILE_UPLOAD_FAILED]: 500,
      [ErrorCode.FILE_DOWNLOAD_FAILED]: 500,
      
      [ErrorCode.VALIDATION_MODEL_INVALID]: 400,
      [ErrorCode.VALIDATION_COMPONENT_INVALID]: 400,
      [ErrorCode.VALIDATION_CONNECTION_INVALID]: 400,
      [ErrorCode.VALIDATION_PROPERTY_INVALID]: 400,
      [ErrorCode.VALIDATION_PARAMETER_OUT_OF_RANGE]: 400,
      
      [ErrorCode.DATABASE_CONNECTION_FAILED]: 503,
      [ErrorCode.DATABASE_QUERY_FAILED]: 500,
      [ErrorCode.DATABASE_CONSTRAINT_VIOLATION]: 409,
      
      [ErrorCode.WEBSOCKET_CONNECTION_FAILED]: 503,
      [ErrorCode.API_REQUEST_FAILED]: 500,
      
      [ErrorCode.UNAUTHORIZED]: 401,
      [ErrorCode.FORBIDDEN]: 403,
      
      [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
      [ErrorCode.BAD_REQUEST]: 400,
      [ErrorCode.NOT_FOUND]: 404,
      [ErrorCode.CONFLICT]: 409
    };

    return statusMap[code] || 500;
  }

  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.userMessage,
      technicalMessage: this.technicalMessage,
      severity: this.severity,
      httpStatusCode: this.httpStatusCode,
      suggestions: this.suggestions,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack
    };
  }

  public toUserResponse() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        suggestions: this.suggestions,
        retryable: this.retryable,
        timestamp: this.context.timestamp
      }
    };
  }
}

// OpenWAM固有のエラークラス
export class OpenWAMError extends AppError {
  public readonly exitCode?: number;
  public readonly stderr?: string;
  public readonly stdout?: string;
  public readonly inputFile?: string;
  public readonly outputFile?: string;

  constructor(
    code: ErrorCode,
    technicalMessage: string,
    userMessage: string,
    context: Partial<ErrorContext> & {
      exitCode?: number;
      stderr?: string;
      stdout?: string;
      inputFile?: string;
      outputFile?: string;
    } = {}
  ) {
    super(code, technicalMessage, userMessage, ErrorSeverity.ERROR, context);
    
    this.exitCode = context.exitCode;
    this.stderr = context.stderr;
    this.stdout = context.stdout;
    this.inputFile = context.inputFile;
    this.outputFile = context.outputFile;
  }
}

// ファイルI/O固有のエラークラス
export class FileError extends AppError {
  public readonly filePath?: string;
  public readonly operation?: string;
  public readonly fileSize?: number;
  public readonly expectedFormat?: string;

  constructor(
    code: ErrorCode,
    technicalMessage: string,
    userMessage: string,
    context: Partial<ErrorContext> & {
      filePath?: string;
      operation?: string;
      fileSize?: number;
      expectedFormat?: string;
    } = {}
  ) {
    super(code, technicalMessage, userMessage, ErrorSeverity.ERROR, context);
    
    this.filePath = context.filePath;
    this.operation = context.operation;
    this.fileSize = context.fileSize;
    this.expectedFormat = context.expectedFormat;
  }
}

// バリデーション固有のエラークラス
export class ValidationError extends AppError {
  public readonly validationErrors: Array<{
    field: string;
    value: any;
    constraint: string;
    message: string;
  }>;

  constructor(
    code: ErrorCode,
    technicalMessage: string,
    userMessage: string,
    validationErrors: Array<{
      field: string;
      value: any;
      constraint: string;
      message: string;
    }>,
    context: Partial<ErrorContext> = {}
  ) {
    super(code, technicalMessage, userMessage, ErrorSeverity.WARNING, context);
    
    this.validationErrors = validationErrors;
  }
}
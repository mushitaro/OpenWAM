/**
 * Error helper functions for backward compatibility
 */

import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';

export function createError(message: string, statusCode: number, code?: string): AppError {
  // Map HTTP status codes to error codes
  let errorCode: ErrorCode;
  
  switch (statusCode) {
    case 400:
      errorCode = code === 'VALIDATION_ERROR' ? ErrorCode.VALIDATION_MODEL_INVALID : ErrorCode.BAD_REQUEST;
      break;
    case 401:
      errorCode = ErrorCode.UNAUTHORIZED;
      break;
    case 403:
      errorCode = ErrorCode.FORBIDDEN;
      break;
    case 404:
      errorCode = ErrorCode.NOT_FOUND;
      break;
    case 409:
      errorCode = ErrorCode.CONFLICT;
      break;
    case 500:
    default:
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
      break;
  }

  const severity = statusCode >= 500 ? ErrorSeverity.ERROR : ErrorSeverity.WARNING;
  
  return new AppError(
    errorCode,
    message,
    message,
    severity
  );
}
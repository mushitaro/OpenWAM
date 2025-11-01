/**
 * エラーハンドリング用カスタムフック
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';

export interface ErrorInfo {
  code: string;
  message: string;
  suggestions?: string[];
  retryable?: boolean;
  timestamp: string;
  requestId?: string;
}

export interface ErrorState {
  hasError: boolean;
  error: ErrorInfo | null;
  isRetrying: boolean;
}

export const useErrorHandler = () => {
  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null,
    isRetrying: false
  });

  const handleError = useCallback((error: any) => {
    let errorInfo: ErrorInfo;

    if (error.response?.data?.error) {
      // API エラーレスポンス
      errorInfo = error.response.data.error;
    } else if (error.error) {
      // カスタムエラーオブジェクト
      errorInfo = error.error;
    } else {
      // 一般的なエラー
      errorInfo = {
        code: 'UNKNOWN_ERROR',
        message: error.message || 'エラーが発生しました',
        timestamp: new Date().toISOString(),
        retryable: false
      };
    }

    setErrorState({
      hasError: true,
      error: errorInfo,
      isRetrying: false
    });

    // 重要度に応じてメッセージ表示
    if (errorInfo.code.includes('CRITICAL') || errorInfo.code.includes('SYSTEM')) {
      message.error(errorInfo.message, 0); // 永続表示
    } else if (errorInfo.code.includes('WARNING')) {
      message.warning(errorInfo.message, 5);
    } else {
      message.error(errorInfo.message, 3);
    }
  }, []);

  const clearError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null,
      isRetrying: false
    });
  }, []);

  const retry = useCallback(async (retryFunction?: () => Promise<void>) => {
    if (!errorState.error?.retryable) {
      return;
    }

    setErrorState(prev => ({
      ...prev,
      isRetrying: true
    }));

    try {
      if (retryFunction) {
        await retryFunction();
      }
      clearError();
      message.success('操作が正常に完了しました');
    } catch (error) {
      handleError(error);
    } finally {
      setErrorState(prev => ({
        ...prev,
        isRetrying: false
      }));
    }
  }, [errorState.error?.retryable, handleError, clearError]);

  const handleApiError = useCallback((error: any) => {
    // Axios エラーの詳細処理
    if (error.response) {
      // サーバーからのエラーレスポンス
      const status = error.response.status;
      const data = error.response.data;

      if (status >= 500) {
        // サーバーエラー
        handleError({
          code: 'SERVER_ERROR',
          message: data?.error?.message || 'サーバーエラーが発生しました',
          suggestions: ['しばらく待ってから再試行してください', 'システム管理者に連絡してください'],
          retryable: true,
          timestamp: new Date().toISOString()
        });
      } else if (status >= 400) {
        // クライアントエラー
        handleError(data?.error || {
          code: 'CLIENT_ERROR',
          message: 'リクエストエラーが発生しました',
          timestamp: new Date().toISOString(),
          retryable: false
        });
      }
    } else if (error.request) {
      // ネットワークエラー
      handleError({
        code: 'NETWORK_ERROR',
        message: 'ネットワークエラーが発生しました',
        suggestions: ['インターネット接続を確認してください', 'しばらく待ってから再試行してください'],
        retryable: true,
        timestamp: new Date().toISOString()
      });
    } else {
      // その他のエラー
      handleError(error);
    }
  }, [handleError]);

  return {
    errorState,
    handleError,
    handleApiError,
    clearError,
    retry
  };
};
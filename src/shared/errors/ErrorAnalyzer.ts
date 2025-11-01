/**
 * OpenWAMエラー解析とユーザーフレンドリーなメッセージ生成
 */

import { ErrorCode, OpenWAMError, FileError, ValidationError, ErrorSeverity } from './AppError';

export interface ErrorAnalysisResult {
  errorType: 'openwam' | 'file' | 'validation' | 'system' | 'unknown';
  primaryCause: string;
  possibleCauses: string[];
  userMessage: string;
  technicalDetails: string;
  suggestions: string[];
  severity: ErrorSeverity;
  retryable: boolean;
}

export class ErrorAnalyzer {
  private static readonly OPENWAM_ERROR_PATTERNS = [
    {
      pattern: /Error reading file/i,
      code: ErrorCode.FILE_NOT_FOUND,
      message: '入力ファイルが見つからないか、読み取りできません',
      suggestions: ['ファイルパスを確認してください', 'ファイルの権限を確認してください']
    },
    {
      pattern: /Convergence not achieved/i,
      code: ErrorCode.OPENWAM_CONVERGENCE_FAILED,
      message: 'シミュレーションが収束しませんでした',
      suggestions: ['時間刻みを小さくしてください', '初期条件を見直してください', 'モデルの設定を確認してください']
    },
    {
      pattern: /Memory allocation failed/i,
      code: ErrorCode.OPENWAM_MEMORY_ERROR,
      message: 'メモリ不足によりシミュレーションが失敗しました',
      suggestions: ['他のアプリケーションを終了してください', 'モデルの複雑さを減らしてください']
    },
    {
      pattern: /Invalid parameter/i,
      code: ErrorCode.OPENWAM_INVALID_INPUT,
      message: '無効なパラメータが検出されました',
      suggestions: ['入力パラメータの値を確認してください', 'パラメータの範囲を確認してください']
    },
    {
      pattern: /Pipe diameter must be positive/i,
      code: ErrorCode.VALIDATION_PARAMETER_OUT_OF_RANGE,
      message: 'パイプ直径は正の値である必要があります',
      suggestions: ['パイプ直径の値を確認してください']
    },
    {
      pattern: /Connection not allowed/i,
      code: ErrorCode.VALIDATION_CONNECTION_INVALID,
      message: '無効な接続が検出されました',
      suggestions: ['コンポーネント間の接続を確認してください', '接続ルールを確認してください']
    }
  ];

  private static readonly FILE_ERROR_PATTERNS = [
    {
      pattern: /ENOENT/i,
      code: ErrorCode.FILE_NOT_FOUND,
      message: 'ファイルまたはディレクトリが見つかりません'
    },
    {
      pattern: /EACCES/i,
      code: ErrorCode.FILE_ACCESS_DENIED,
      message: 'ファイルへのアクセスが拒否されました'
    },
    {
      pattern: /EMFILE|ENFILE/i,
      code: ErrorCode.SYSTEM_RESOURCE_EXHAUSTED,
      message: 'システムリソースが不足しています'
    }
  ];

  public static analyzeError(error: Error): ErrorAnalysisResult {
    if (error instanceof OpenWAMError) {
      return this.analyzeOpenWAMError(error);
    } else if (error instanceof FileError) {
      return this.analyzeFileError(error);
    } else if (error instanceof ValidationError) {
      return this.analyzeValidationError(error);
    } else {
      return this.analyzeGenericError(error);
    }
  }

  private static analyzeOpenWAMError(error: OpenWAMError): ErrorAnalysisResult {
    const stderr = error.stderr || '';
    const stdout = error.stdout || '';
    const combinedOutput = `${stderr} ${stdout}`;

    // パターンマッチングによるエラー分析
    for (const pattern of this.OPENWAM_ERROR_PATTERNS) {
      if (pattern.pattern.test(combinedOutput)) {
        return {
          errorType: 'openwam',
          primaryCause: pattern.message,
          possibleCauses: [pattern.message],
          userMessage: pattern.message,
          technicalDetails: `OpenWAM実行エラー: ${error.technicalMessage}`,
          suggestions: pattern.suggestions || [],
          severity: ErrorSeverity.ERROR,
          retryable: false
        };
      }
    }

    // 終了コードによる分析
    if (error.exitCode) {
      return this.analyzeExitCode(error.exitCode, combinedOutput);
    }

    return {
      errorType: 'openwam',
      primaryCause: 'OpenWAMシミュレーションでエラーが発生しました',
      possibleCauses: ['入力データの問題', '計算の収束問題', 'システムリソースの不足'],
      userMessage: 'シミュレーションの実行中にエラーが発生しました',
      technicalDetails: combinedOutput || error.technicalMessage,
      suggestions: [
        '入力パラメータを確認してください',
        'モデルの設定を見直してください',
        'システムリソースを確認してください'
      ],
      severity: ErrorSeverity.ERROR,
      retryable: true
    };
  }

  private static analyzeFileError(error: FileError): ErrorAnalysisResult {
    const message = error.message.toLowerCase();

    for (const pattern of this.FILE_ERROR_PATTERNS) {
      if (pattern.pattern.test(message)) {
        return {
          errorType: 'file',
          primaryCause: pattern.message,
          possibleCauses: [pattern.message],
          userMessage: pattern.message,
          technicalDetails: error.technicalMessage,
          suggestions: this.getFileSuggestions(pattern.code, error),
          severity: ErrorSeverity.ERROR,
          retryable: pattern.code !== ErrorCode.FILE_ACCESS_DENIED
        };
      }
    }

    return {
      errorType: 'file',
      primaryCause: 'ファイル操作でエラーが発生しました',
      possibleCauses: ['ファイルの権限問題', 'ファイルの破損', 'ディスク容量不足'],
      userMessage: 'ファイルの処理中にエラーが発生しました',
      technicalDetails: error.technicalMessage,
      suggestions: [
        'ファイルの存在を確認してください',
        'ファイルの権限を確認してください',
        'ディスク容量を確認してください'
      ],
      severity: ErrorSeverity.ERROR,
      retryable: true
    };
  }

  private static analyzeValidationError(error: ValidationError): ErrorAnalysisResult {
    const validationMessages = error.validationErrors.map(ve => ve.message);
    
    return {
      errorType: 'validation',
      primaryCause: 'モデルの検証でエラーが発生しました',
      possibleCauses: validationMessages,
      userMessage: `${validationMessages.length}個の検証エラーが見つかりました`,
      technicalDetails: JSON.stringify(error.validationErrors, null, 2),
      suggestions: [
        'モデルの設定を確認してください',
        'コンポーネントのプロパティを見直してください',
        '接続の妥当性を確認してください'
      ],
      severity: ErrorSeverity.WARNING,
      retryable: false
    };
  }

  private static analyzeGenericError(error: Error): ErrorAnalysisResult {
    return {
      errorType: 'unknown',
      primaryCause: 'システムエラーが発生しました',
      possibleCauses: ['システムの一時的な問題', 'ソフトウェアのバグ', 'リソース不足'],
      userMessage: '予期しないエラーが発生しました',
      technicalDetails: error.message,
      suggestions: [
        'しばらく待ってから再試行してください',
        'アプリケーションを再起動してください',
        'システム管理者に連絡してください'
      ],
      severity: ErrorSeverity.ERROR,
      retryable: true
    };
  }

  private static analyzeExitCode(exitCode: number, output: string): ErrorAnalysisResult {
    const exitCodeMap: Record<number, { message: string; suggestions: string[] }> = {
      1: {
        message: 'OpenWAMの一般的な実行エラーです',
        suggestions: ['入力ファイルの形式を確認してください', 'パラメータの値を見直してください']
      },
      2: {
        message: 'OpenWAMの初期化エラーです',
        suggestions: ['システム環境を確認してください', 'OpenWAMの設定を確認してください']
      },
      139: {
        message: 'セグメンテーション違反が発生しました',
        suggestions: ['モデルの複雑さを減らしてください', 'メモリ使用量を確認してください']
      },
      '-9': {
        message: 'プロセスが強制終了されました',
        suggestions: ['タイムアウト設定を確認してください', 'システムリソースを確認してください']
      }
    };

    const exitInfo = exitCodeMap[exitCode];
    if (exitInfo) {
      return {
        errorType: 'openwam',
        primaryCause: exitInfo.message,
        possibleCauses: [exitInfo.message],
        userMessage: exitInfo.message,
        technicalDetails: `終了コード: ${exitCode}, 出力: ${output}`,
        suggestions: exitInfo.suggestions,
        severity: ErrorSeverity.ERROR,
        retryable: exitCode !== 139 // セグメンテーション違反以外は再試行可能
      };
    }

    return {
      errorType: 'openwam',
      primaryCause: `OpenWAMが異常終了しました (終了コード: ${exitCode})`,
      possibleCauses: ['計算エラー', 'システムエラー', 'リソース不足'],
      userMessage: 'シミュレーションが異常終了しました',
      technicalDetails: `終了コード: ${exitCode}, 出力: ${output}`,
      suggestions: [
        'モデルの設定を確認してください',
        'システムリソースを確認してください',
        'しばらく待ってから再試行してください'
      ],
      severity: ErrorSeverity.ERROR,
      retryable: true
    };
  }

  private static getFileSuggestions(code: ErrorCode, error: FileError): string[] {
    const baseSuggestions: Partial<Record<ErrorCode, string[]>> = {
      [ErrorCode.FILE_NOT_FOUND]: [
        'ファイルパスが正しいか確認してください',
        'ファイルが存在するか確認してください'
      ],
      [ErrorCode.FILE_ACCESS_DENIED]: [
        'ファイルの権限を確認してください',
        '管理者権限で実行してください',
        'ファイルが他のプロセスで使用されていないか確認してください'
      ],
      [ErrorCode.SYSTEM_RESOURCE_EXHAUSTED]: [
        '他のアプリケーションを終了してください',
        'システムを再起動してください',
        'ディスク容量を確認してください'
      ]
    };

    return baseSuggestions[code] || ['システム管理者に連絡してください'];
  }
}
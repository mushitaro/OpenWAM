import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { DatabaseManager } from '../database/DatabaseManager';
import { AppError, OpenWAMError, FileError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { ErrorReportingService } from '../../shared/services/errorReportingService';

export interface SimulationConfig {
  id: number;
  projectId: number;
  inputFilePath: string;
  outputDirectory: string;
  timeout?: number; // in milliseconds, default 30 minutes
}

export interface SimulationProgress {
  simulationId: number;
  progress: number; // 0-100
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  message?: string;
  timestamp: Date;
}

export interface SimulationResult {
  simulationId: number;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  outputFiles: string[];
  errorMessage?: string;
  executionTime: number; // in milliseconds
  logs: string[];
}

export class SimulationService extends EventEmitter {
  private runningSimulations: Map<number, ChildProcess> = new Map();
  private simulationTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private dbManager: DatabaseManager;
  private openWAMExecutablePath: string;
  private defaultTimeout: number = 30 * 60 * 1000; // 30 minutes
  private errorReporting: ErrorReportingService;

  constructor(dbManager: DatabaseManager, openWAMPath?: string) {
    super();
    this.dbManager = dbManager;
    this.openWAMExecutablePath = openWAMPath || this.findOpenWAMExecutable();
    this.errorReporting = ErrorReportingService.getInstance();
  }

  /**
   * Find OpenWAM executable in the system
   */
  private findOpenWAMExecutable(): string {
    // Check common locations for OpenWAM executable
    const possiblePaths = [
      path.join(process.cwd(), 'bin', 'OpenWAM.exe'),
      path.join(process.cwd(), 'bin', 'debug', 'OpenWAM.exe'),
      path.join(process.cwd(), 'bin', 'release', 'OpenWAM.exe'),
      path.join(process.cwd(), 'OpenWAM.exe'),
      'OpenWAM.exe', // Assume it's in PATH
      'OpenWAM' // Linux/Unix version
    ];

    // For now, return the first path (will be configurable later)
    return possiblePaths[0];
  }

  /**
   * Start a new OpenWAM simulation
   */
  async startSimulation(config: SimulationConfig): Promise<void> {
    const { id, inputFilePath, outputDirectory, timeout = this.defaultTimeout } = config;

    // Check if simulation is already running
    if (this.runningSimulations.has(id)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Simulation ${id} is already running`,
        'このシミュレーションは既に実行中です',
        ErrorSeverity.WARNING,
        { simulationId: id }
      );
    }

    // Validate input file exists
    try {
      await fs.access(inputFilePath);
    } catch (error) {
      throw new FileError(
        ErrorCode.FILE_NOT_FOUND,
        `Input file not accessible: ${inputFilePath}`,
        '入力ファイルが見つからないか、アクセスできません',
        {
          filePath: inputFilePath,
          operation: 'access',
          simulationId: id
        }
      );
    }

    // Ensure output directory exists
    try {
      await fs.mkdir(outputDirectory, { recursive: true });
    } catch (error: any) {
      const fileError = new FileError(
        ErrorCode.FILE_ACCESS_DENIED,
        `Failed to create output directory: ${outputDirectory}`,
        '出力ディレクトリの作成に失敗しました',
        {
          filePath: outputDirectory,
          operation: 'mkdir',
          simulationId: id
        }
      );
      this.errorReporting.reportError(fileError);
      throw fileError;
    }

    logger.info(`Starting OpenWAM simulation ${id} with input: ${inputFilePath}`);

    // Update simulation status in database
    await this.dbManager.updateSimulation(id, {
      status: 'running',
      progress: 0
    });

    const startTime = Date.now();
    const logs: string[] = [];

    try {
      // Spawn OpenWAM process
      const process = spawn(this.openWAMExecutablePath, [inputFilePath], {
        cwd: outputDirectory,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.runningSimulations.set(id, process);

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(id);
      }, timeout);
      this.simulationTimeouts.set(id, timeoutHandle);

      // Handle process output
      process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        logs.push(`STDOUT: ${output}`);
        logger.debug(`Simulation ${id} stdout: ${output}`);
        
        // Parse progress from output (OpenWAM specific parsing)
        const progress = this.parseProgress(output);
        if (progress !== null) {
          this.emitProgress(id, progress, 'running');
        }
      });

      process.stderr?.on('data', (data: Buffer) => {
        const error = data.toString();
        logs.push(`STDERR: ${error}`);
        logger.warn(`Simulation ${id} stderr: ${error}`);
      });

      // Handle process completion
      process.on('close', async (code: number | null, signal: string | null) => {
        const executionTime = Date.now() - startTime;
        this.cleanup(id);

        logger.info(`Simulation ${id} finished with code: ${code}, signal: ${signal}`);

        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          // Process was cancelled
          await this.handleCancellation(id, logs, executionTime);
        } else if (code === 0) {
          // Success
          await this.handleSuccess(id, outputDirectory, logs, executionTime);
        } else {
          // Error - create detailed OpenWAM error
          const openWAMError = new OpenWAMError(
            ErrorCode.OPENWAM_EXECUTION_FAILED,
            `OpenWAM process exited with code ${code}`,
            'シミュレーションの実行中にエラーが発生しました',
            {
              simulationId: id,
              exitCode: code || undefined,
              stderr: logs.filter(log => log.startsWith('STDERR:')).join('\n'),
              stdout: logs.filter(log => log.startsWith('STDOUT:')).join('\n'),
              inputFile: inputFilePath,
              outputFile: outputDirectory
            }
          );
          this.errorReporting.reportError(openWAMError);
          await this.handleError(id, openWAMError, logs, executionTime);
        }
      });

      process.on('error', async (error: Error) => {
        const executionTime = Date.now() - startTime;
        this.cleanup(id);
        
        const processError = new OpenWAMError(
          ErrorCode.OPENWAM_EXECUTION_FAILED,
          `OpenWAM process error: ${error.message}`,
          'シミュレーションプロセスでエラーが発生しました',
          {
            simulationId: id,
            stderr: error.message,
            inputFile: inputFilePath
          }
        );
        
        this.errorReporting.reportError(processError);
        await this.handleError(id, processError, logs, executionTime);
      });

      // Emit initial progress
      this.emitProgress(id, 0, 'running', 'Simulation started');

    } catch (error: any) {
      this.cleanup(id);
      
      if (error instanceof AppError) {
        await this.handleError(id, error, logs, 0);
        throw error;
      } else {
        const startupError = new OpenWAMError(
          ErrorCode.OPENWAM_EXECUTION_FAILED,
          `Failed to start OpenWAM simulation: ${error.message}`,
          'シミュレーションの開始に失敗しました',
          {
            simulationId: id,
            stderr: error.message,
            inputFile: inputFilePath
          }
        );
        
        this.errorReporting.reportError(startupError);
        await this.handleError(id, startupError, logs, 0);
        throw startupError;
      }
    }
  }

  /**
   * Stop a running simulation
   */
  async stopSimulation(id: number): Promise<void> {
    const process = this.runningSimulations.get(id);
    if (!process) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `Simulation ${id} is not running`,
        'このシミュレーションは実行されていません',
        ErrorSeverity.WARNING,
        { simulationId: id }
      );
    }

    logger.info(`Stopping simulation ${id}`);

    // Kill the process
    process.kill('SIGTERM');

    // If it doesn't stop gracefully, force kill after 5 seconds
    setTimeout(() => {
      if (this.runningSimulations.has(id)) {
        logger.warn(`Force killing simulation ${id}`);
        process.kill('SIGKILL');
      }
    }, 5000);
  }

  /**
   * Get status of all running simulations
   */
  getRunningSimulations(): number[] {
    return Array.from(this.runningSimulations.keys());
  }

  /**
   * Check if a simulation is running
   */
  isSimulationRunning(id: number): boolean {
    return this.runningSimulations.has(id);
  }

  /**
   * Parse progress from OpenWAM output
   */
  private parseProgress(output: string): number | null {
    // OpenWAM progress patterns (these would need to be adjusted based on actual OpenWAM output)
    const progressPatterns = [
      /Progress:\s*(\d+(?:\.\d+)?)%/i,
      /Completed:\s*(\d+(?:\.\d+)?)%/i,
      /(\d+(?:\.\d+)?)%\s*complete/i,
      /Cycle\s+(\d+)\s+of\s+(\d+)/i, // Extract cycle progress
      /Time:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i // Extract time progress
    ];

    for (const pattern of progressPatterns) {
      const match = output.match(pattern);
      if (match) {
        if (pattern.source.includes('Cycle')) {
          // Calculate percentage from cycle numbers
          const current = parseInt(match[1]);
          const total = parseInt(match[2]);
          return Math.min(100, Math.round((current / total) * 100));
        } else if (pattern.source.includes('Time')) {
          // Calculate percentage from time
          const current = parseFloat(match[1]);
          const total = parseFloat(match[2]);
          return Math.min(100, Math.round((current / total) * 100));
        } else {
          // Direct percentage
          return Math.min(100, Math.round(parseFloat(match[1])));
        }
      }
    }

    return null;
  }

  /**
   * Emit progress update
   */
  private emitProgress(id: number, progress: number, status: string, message?: string): void {
    const progressData: SimulationProgress = {
      simulationId: id,
      progress,
      status: status as any,
      message,
      timestamp: new Date()
    };

    this.emit('progress', progressData);
    logger.debug(`Simulation ${id} progress: ${progress}%`);
  }

  /**
   * Handle simulation timeout
   */
  private async handleTimeout(id: number): Promise<void> {
    logger.warn(`Simulation ${id} timed out`);
    
    const process = this.runningSimulations.get(id);
    if (process) {
      process.kill('SIGKILL');
    }

    this.cleanup(id);

    const timeoutError = new OpenWAMError(
      ErrorCode.OPENWAM_TIMEOUT,
      `Simulation ${id} exceeded timeout limit`,
      'シミュレーションがタイムアウトしました',
      {
        simulationId: id
      }
    );

    this.errorReporting.reportError(timeoutError);

    await this.dbManager.updateSimulation(id, {
      status: 'failed',
      error_message: timeoutError.userMessage,
      completed_at: new Date().toISOString(),
      progress: 0
    });

    this.emit('result', {
      simulationId: id,
      status: 'timeout',
      outputFiles: [],
      errorMessage: timeoutError.userMessage,
      executionTime: 0,
      logs: []
    } as SimulationResult);
  }

  /**
   * Handle successful simulation completion
   */
  private async handleSuccess(id: number, outputDirectory: string, logs: string[], executionTime: number): Promise<void> {
    try {
      // Find output files
      const outputFiles = await this.findOutputFiles(outputDirectory);
      
      await this.dbManager.updateSimulation(id, {
        status: 'completed',
        output_file_path: outputFiles.length > 0 ? outputFiles[0] : undefined,
        completed_at: new Date().toISOString(),
        progress: 100
      });

      this.emitProgress(id, 100, 'completed', 'Simulation completed successfully');

      this.emit('result', {
        simulationId: id,
        status: 'completed',
        outputFiles,
        executionTime,
        logs
      } as SimulationResult);

    } catch (error: any) {
      logger.error(`Error handling simulation ${id} success:`, error);
      await this.handleError(id, `Post-processing error: ${error.message}`, logs, executionTime);
    }
  }

  /**
   * Handle simulation error
   */
  private async handleError(id: number, error: AppError | string, logs: string[], executionTime: number): Promise<void> {
    const errorMessage = error instanceof AppError ? error.userMessage : error;
    const technicalMessage = error instanceof AppError ? error.technicalMessage : error;

    await this.dbManager.updateSimulation(id, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    });

    this.emitProgress(id, 0, 'failed', errorMessage);

    this.emit('result', {
      simulationId: id,
      status: 'failed',
      outputFiles: [],
      errorMessage,
      executionTime,
      logs
    } as SimulationResult);
  }

  /**
   * Handle simulation cancellation
   */
  private async handleCancellation(id: number, logs: string[], executionTime: number): Promise<void> {
    await this.dbManager.updateSimulation(id, {
      status: 'cancelled',
      completed_at: new Date().toISOString()
    });

    this.emitProgress(id, 0, 'cancelled', 'Simulation was cancelled');

    this.emit('result', {
      simulationId: id,
      status: 'cancelled',
      outputFiles: [],
      errorMessage: 'Simulation was cancelled by user',
      executionTime,
      logs
    } as SimulationResult);
  }

  /**
   * Find output files in the output directory
   */
  private async findOutputFiles(outputDirectory: string): Promise<string[]> {
    try {
      const files = await fs.readdir(outputDirectory);
      const outputFiles = files.filter(file => {
        // Common OpenWAM output file extensions
        const ext = path.extname(file).toLowerCase();
        return ['.csv', '.dat', '.txt', '.out', '.res'].includes(ext);
      });

      return outputFiles.map(file => path.join(outputDirectory, file));
    } catch (error) {
      logger.error(`Error reading output directory ${outputDirectory}:`, error);
      return [];
    }
  }

  /**
   * Clean up simulation resources
   */
  private cleanup(id: number): void {
    this.runningSimulations.delete(id);
    
    const timeout = this.simulationTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.simulationTimeouts.delete(id);
    }
  }

  /**
   * Clean up all running simulations (for shutdown)
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down simulation service...');
    
    const runningIds = Array.from(this.runningSimulations.keys());
    
    // Stop all running simulations
    for (const id of runningIds) {
      try {
        await this.stopSimulation(id);
      } catch (error) {
        logger.error(`Error stopping simulation ${id} during shutdown:`, error);
      }
    }

    // Clear all timeouts
    for (const timeout of this.simulationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.simulationTimeouts.clear();

    logger.info('Simulation service shutdown complete');
  }
}
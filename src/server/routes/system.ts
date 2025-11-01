import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SystemHealthService } from '../services/systemHealthService';
import { CrashRecoveryService } from '../services/crashRecoveryService';
import { BackupService } from '../services/backupService';

export function systemRoutes(): Router {
  const router = Router();
  
  const healthService = SystemHealthService.getInstance();
  const crashRecovery = CrashRecoveryService.getInstance();
  const backupService = BackupService.getInstance();

  // GET /api/system/status - Get system status
  router.get('/status', asyncHandler(async (req, res) => {
    const status = {
      server: {
        status: 'running',
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      system: {
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpus: os.cpus().length,
        loadAverage: os.loadavg()
      },
      process: {
        memoryUsage: process.memoryUsage(),
        pid: process.pid
      },
      timestamp: new Date().toISOString()
    };

    res.json(status);
  }));

  // GET /api/system/logs - Get recent logs
  router.get('/logs', asyncHandler(async (req, res) => {
    const logFile = path.join(__dirname, '../../../logs/combined.log');
    const lines = parseInt(req.query.lines as string) || 100;

    try {
      const logContent = await fs.readFile(logFile, 'utf-8');
      const logLines = logContent.split('\n').filter(line => line.trim());
      const recentLogs = logLines.slice(-lines);

      res.json({
        logs: recentLogs.map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line, timestamp: new Date().toISOString() };
          }
        }),
        totalLines: logLines.length
      });
    } catch (error) {
      logger.warn('Could not read log file:', error);
      res.json({
        logs: [],
        totalLines: 0,
        error: 'Log file not accessible'
      });
    }
  }));

  // GET /api/system/health - Detailed health check endpoint
  router.get('/health', asyncHandler(async (req, res) => {
    const healthStatus = await healthService.performHealthCheck();
    res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);
  }));

  // GET /api/system/health/history - Health history
  router.get('/health/history', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const history = healthService.getHealthHistory(limit);
    res.json({ history });
  }));

  // GET /api/system/health/trends - Health trends
  router.get('/health/trends', asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const trends = healthService.getHealthTrends(hours);
    res.json(trends);
  }));

  // PUT /api/system/health/thresholds - Update health thresholds
  router.put('/health/thresholds', asyncHandler(async (req, res) => {
    healthService.updateThresholds(req.body);
    res.json({ message: 'Health thresholds updated', thresholds: healthService.getThresholds() });
  }));

  // GET /api/system/crashes - Get crash history
  router.get('/crashes', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const crashes = crashRecovery.getCrashHistory(limit);
    res.json({ crashes });
  }));

  // GET /api/system/crashes/stats - Get crash statistics
  router.get('/crashes/stats', asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const stats = crashRecovery.getCrashStatistics(hours);
    res.json(stats);
  }));

  // PUT /api/system/recovery/config - Update recovery configuration
  router.put('/recovery/config', asyncHandler(async (req, res) => {
    crashRecovery.updateConfig(req.body);
    res.json({ message: 'Recovery config updated', config: crashRecovery.getConfig() });
  }));

  // GET /api/system/backups - List backups
  router.get('/backups', asyncHandler(async (req, res) => {
    const backups = await backupService.listBackups();
    res.json({ backups });
  }));

  // POST /api/system/backups - Create backup
  router.post('/backups', asyncHandler(async (req, res) => {
    const { description } = req.body;
    const metadata = await backupService.createBackup(description);
    res.status(201).json({ message: 'Backup created successfully', metadata });
  }));

  // POST /api/system/backups/:id/restore - Restore backup
  router.post('/backups/:id/restore', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const options = {
      backupId: id,
      includeDatabase: req.body.includeDatabase !== false,
      includeUploads: req.body.includeUploads !== false,
      includeLogs: req.body.includeLogs !== false,
      overwriteExisting: req.body.overwriteExisting === true
    };
    
    await backupService.restoreBackup(options);
    res.json({ message: 'Backup restored successfully' });
  }));

  // DELETE /api/system/backups/:id - Delete backup
  router.delete('/backups/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    await backupService.deleteBackup(id);
    res.json({ message: 'Backup deleted successfully' });
  }));

  // PUT /api/system/backup/config - Update backup configuration
  router.put('/backup/config', asyncHandler(async (req, res) => {
    backupService.updateConfig(req.body);
    res.json({ message: 'Backup config updated', config: backupService.getConfig() });
  }));

  return router;
}
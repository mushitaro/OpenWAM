import express from 'express';
import cors from 'cors';
// Trigger restart
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { logger } from './utils/logger';
import { DatabaseManager } from './database/DatabaseManager';
import { SimulationService } from './services/simulationService';
import { setupRoutes } from './routes';
import { setupSocketHandlers } from './socket/socketHandlers';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { SystemHealthService } from './services/systemHealthService';
import { CrashRecoveryService } from './services/crashRecoveryService';
import { BackupService } from './services/backupService';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Initialize database
const dbManager = new DatabaseManager();

// Initialize simulation service
const simulationService = new SimulationService(dbManager);

// Initialize system services
const healthService = SystemHealthService.getInstance();
const crashRecovery = CrashRecoveryService.getInstance();
const backupService = BackupService.getInstance();

// Setup routes
setupRoutes(app, dbManager, simulationService);

// Setup socket handlers
setupSocketHandlers(io, dbManager, simulationService);

// 404 handler for unknown routes
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Initialize server
async function startServer() {
  try {
    // Initialize crash recovery first
    await crashRecovery.initialize();
    logger.info('Crash recovery service initialized');

    // Initialize database
    await dbManager.initialize();
    logger.info('Database initialized successfully');

    // Initialize backup service
    await backupService.initialize();
    logger.info('Backup service initialized');

    // Start health monitoring
    healthService.startMonitoring();
    logger.info('Health monitoring started');

    // Start server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Setup service event handlers
    setupServiceEventHandlers();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await gracefulShutdown();
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  try {
    // Stop health monitoring
    healthService.stopMonitoring();
    
    // Stop simulation service
    await simulationService.shutdown();
    
    // Stop backup service
    await backupService.shutdown();
    
    // Close database
    await dbManager.close();
    
    // Shutdown crash recovery
    await crashRecovery.shutdown();
    
    // Close server
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

function setupServiceEventHandlers() {
  // Health service events
  healthService.on('healthCheck', (status) => {
    io.emit('system:health', status);
  });

  healthService.on('critical', (issues) => {
    logger.error('Critical system issues detected:', issues);
    io.emit('system:critical', issues);
  });

  healthService.on('warning', (issues) => {
    logger.warn('System warnings detected:', issues);
    io.emit('system:warning', issues);
  });

  // Crash recovery events
  crashRecovery.on('crash', (crashReport) => {
    logger.error('System crash detected:', crashReport);
    io.emit('system:crash', crashReport);
  });

  crashRecovery.on('recovered', (crashReport) => {
    logger.info('System recovered from crash:', crashReport);
    io.emit('system:recovered', crashReport);
  });

  crashRecovery.on('recoveryFailed', (crashReport) => {
    logger.error('System recovery failed:', crashReport);
    io.emit('system:recoveryFailed', crashReport);
  });

  // Backup service events
  backupService.on('backupCompleted', (metadata) => {
    logger.info('Backup completed:', metadata);
    io.emit('system:backupCompleted', metadata);
  });

  backupService.on('backupFailed', (error) => {
    logger.error('Backup failed:', error);
    io.emit('system:backupFailed', error);
  });
}

startServer();

export { app, io, dbManager, simulationService, healthService, crashRecovery, backupService };
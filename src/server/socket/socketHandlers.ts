import { Server as SocketIOServer } from 'socket.io';
import { DatabaseManager } from '../database/DatabaseManager';
import { SimulationService, SimulationProgress, SimulationResult } from '../services/simulationService';
import { logger } from '../utils/logger';

export function setupSocketHandlers(io: SocketIOServer, dbManager: DatabaseManager, simulationService: SimulationService): void {
  
  // Set up simulation service event listeners
  simulationService.on('progress', (progress: SimulationProgress) => {
    // Broadcast progress to simulation room
    io.to(`simulation:${progress.simulationId}`).emit('simulation:progress', progress);
    
    // Also broadcast to project room if we can determine the project
    // (This would require tracking simulation-to-project mapping)
    logger.debug(`Broadcasting progress for simulation ${progress.simulationId}: ${progress.progress}%`);
  });

  simulationService.on('result', (result: SimulationResult) => {
    // Broadcast result to simulation room
    io.to(`simulation:${result.simulationId}`).emit('simulation:result', result);
    
    // Clean up simulation room
    io.in(`simulation:${result.simulationId}`).socketsLeave(`simulation:${result.simulationId}`);
    
    logger.info(`Broadcasting result for simulation ${result.simulationId}: ${result.status}`);
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Join project room for project-specific updates
    socket.on('join:project', (projectId: number) => {
      socket.join(`project:${projectId}`);
      logger.info(`Client ${socket.id} joined project room: ${projectId}`);
    });

    // Leave project room
    socket.on('leave:project', (projectId: number) => {
      socket.leave(`project:${projectId}`);
      logger.info(`Client ${socket.id} left project room: ${projectId}`);
    });

    // Join simulation room for real-time updates
    socket.on('join:simulation', (simulationId: number) => {
      socket.join(`simulation:${simulationId}`);
      logger.info(`Client ${socket.id} joined simulation room: ${simulationId}`);
    });

    // Leave simulation room
    socket.on('leave:simulation', (simulationId: number) => {
      socket.leave(`simulation:${simulationId}`);
      logger.info(`Client ${socket.id} left simulation room: ${simulationId}`);
    });

    // Handle simulation start requests
    socket.on('simulation:start', async (data) => {
      try {
        const { projectId, inputFilePath, timeout } = data;
        logger.info(`Simulation start requested for project ${projectId}`);
        
        // Validate required data
        if (!projectId || !inputFilePath) {
          socket.emit('simulation:error', { 
            error: 'Missing required parameters',
            details: 'Project ID and input file path are required'
          });
          return;
        }

        // Verify project exists
        try {
          await dbManager.getProject(projectId);
        } catch (error) {
          socket.emit('simulation:error', { 
            error: 'Project not found',
            details: `Project ${projectId} does not exist`
          });
          return;
        }

        // Create simulation record
        const simulation = await dbManager.createSimulation(projectId, inputFilePath);
        const simulationId = simulation.id;
        
        // Join simulation room for real-time updates
        socket.join(`simulation:${simulationId}`);
        
        // Prepare output directory
        const path = require('path');
        const outputDirectory = path.join(process.cwd(), 'app_data', 'projects', projectId.toString(), 'output', simulationId.toString());

        // Start the simulation
        await simulationService.startSimulation({
          id: simulationId,
          projectId,
          inputFilePath,
          outputDirectory,
          timeout
        });

        // Emit acknowledgment
        socket.emit('simulation:started', { 
          simulationId, 
          status: 'running',
          projectId,
          outputDirectory
        });
        
        // Broadcast to project room
        socket.to(`project:${projectId}`).emit('simulation:update', {
          simulationId,
          status: 'running',
          progress: 0,
          timestamp: new Date().toISOString()
        });

      } catch (error: any) {
        logger.error('Error starting simulation:', error);
        socket.emit('simulation:error', { 
          error: 'Failed to start simulation',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle simulation stop requests
    socket.on('simulation:stop', async (data) => {
      try {
        const { simulationId } = data;
        logger.info(`Simulation stop requested: ${simulationId}`);
        
        if (!simulationId) {
          socket.emit('simulation:error', { 
            error: 'Missing simulation ID',
            details: 'Simulation ID is required to stop simulation'
          });
          return;
        }

        // Check if simulation exists
        try {
          await dbManager.getSimulation(simulationId);
        } catch (error) {
          socket.emit('simulation:error', { 
            error: 'Simulation not found',
            details: `Simulation ${simulationId} does not exist`
          });
          return;
        }

        // Stop the simulation using the service
        if (simulationService.isSimulationRunning(simulationId)) {
          await simulationService.stopSimulation(simulationId);
          logger.info(`Running simulation stopped: ${simulationId}`);
        } else {
          // Update status if not running
          await dbManager.updateSimulation(simulationId, { 
            status: 'cancelled',
            completed_at: new Date().toISOString()
          });
          logger.info(`Simulation marked as cancelled: ${simulationId}`);
        }
        
        // Emit to simulation room
        io.to(`simulation:${simulationId}`).emit('simulation:stopped', { 
          simulationId,
          status: 'cancelled',
          timestamp: new Date().toISOString()
        });
        
      } catch (error: any) {
        logger.error('Error stopping simulation:', error);
        socket.emit('simulation:error', { 
          error: 'Failed to stop simulation',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle simulation status requests
    socket.on('simulation:status', async (data) => {
      try {
        const { simulationId } = data;
        
        if (!simulationId) {
          socket.emit('simulation:error', { 
            error: 'Missing simulation ID',
            details: 'Simulation ID is required'
          });
          return;
        }

        // Get simulation from database
        const simulation = await dbManager.getSimulation(simulationId);
        
        // Check if it's currently running
        const isRunning = simulationService.isSimulationRunning(simulationId);
        
        socket.emit('simulation:status-response', {
          simulationId,
          ...simulation,
          isRunning,
          timestamp: new Date().toISOString()
        });

      } catch (error: any) {
        logger.error('Error getting simulation status:', error);
        socket.emit('simulation:error', { 
          error: 'Failed to get simulation status',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle running simulations list request
    socket.on('simulations:running', async () => {
      try {
        const runningIds = simulationService.getRunningSimulations();
        const runningSimulations: any[] = [];
        
        for (const id of runningIds) {
          try {
            const simulation = await dbManager.getSimulation(id);
            runningSimulations.push({
              ...simulation,
              isRunning: true
            });
          } catch (error) {
            logger.warn(`Failed to get simulation ${id}:`, error);
          }
        }
        
        socket.emit('simulations:running-response', {
          simulations: runningSimulations,
          count: runningSimulations.length,
          timestamp: new Date().toISOString()
        });

      } catch (error: any) {
        logger.error('Error getting running simulations:', error);
        socket.emit('simulation:error', { 
          error: 'Failed to get running simulations',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle model validation requests
    socket.on('model:validate', (data) => {
      try {
        const { projectId, model } = data;
        logger.info(`Model validation requested for project: ${projectId}`);
        
        // Basic validation (will be expanded in later tasks)
        const validation = {
          isValid: true,
          errors: [],
          warnings: []
        };
        
        socket.emit('model:validated', {
          projectId,
          validation
        });
      } catch (error: any) {
        logger.error('Error validating model:', error);
        socket.emit('model:validation-error', { 
          error: 'Failed to validate model',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle system status requests
    socket.on('system:status', () => {
      try {
        const runningSimulations = simulationService.getRunningSimulations();
        const systemStatus = {
          status: 'healthy',
          runningSimulations: runningSimulations.length,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        };
        
        socket.emit('system:status-response', systemStatus);
      } catch (error: any) {
        logger.error('Error getting system status:', error);
        socket.emit('system:error', { 
          error: 'Failed to get system status',
          details: error.message || 'Unknown error'
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });

    // Send initial connection confirmation
    socket.emit('connected', { 
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  // Utility function to broadcast simulation progress (legacy support)
  const broadcastSimulationProgress = (simulationId: number, progress: number, status?: string) => {
    io.to(`simulation:${simulationId}`).emit('simulation:progress', {
      simulationId,
      progress,
      status,
      timestamp: new Date().toISOString()
    });
  };

  // Utility function to broadcast system status
  const broadcastSystemStatus = (status: any) => {
    io.emit('system:status', {
      ...status,
      timestamp: new Date().toISOString()
    });
  };

  // Utility function to broadcast to project room
  const broadcastToProject = (projectId: number, event: string, data: any) => {
    io.to(`project:${projectId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
  };

  // Utility function to broadcast simulation update to project
  const broadcastSimulationUpdate = async (simulationId: number, update: any) => {
    try {
      const simulation = await dbManager.getSimulation(simulationId);
      broadcastToProject(simulation.project_id, 'simulation:update', {
        simulationId,
        ...update
      });
    } catch (error) {
      logger.error(`Failed to broadcast simulation update for ${simulationId}:`, error);
    }
  };

  // Export utility functions for use in other modules
  (io as any).broadcastSimulationProgress = broadcastSimulationProgress;
  (io as any).broadcastSystemStatus = broadcastSystemStatus;
  (io as any).broadcastToProject = broadcastToProject;
  (io as any).broadcastSimulationUpdate = broadcastSimulationUpdate;
}
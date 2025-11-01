import { Router } from 'express';
import { DatabaseManager } from '../database/DatabaseManager';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { createError } from '../utils/errorHelpers';
import { logger } from '../utils/logger';
import { SimulationService } from '../services/simulationService';
import path from 'path';

export function simulationRoutes(dbManager: DatabaseManager, simulationService: SimulationService): Router {
  const router = Router();

  // GET /api/simulations/:id - Get simulation by ID
  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid simulation ID', 400, 'INVALID_ID');
    }

    try {
      const simulation = await dbManager.getSimulation(id);
      res.json(simulation);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Simulation not found', 404, 'SIMULATION_NOT_FOUND');
      }
      throw error;
    }
  }));

  // POST /api/simulations - Create and start new simulation
  router.post('/', asyncHandler(async (req, res) => {
    const { projectId, inputFilePath, timeout } = req.body;
    
    if (!projectId) {
      throw createError('Project ID is required', 400, 'VALIDATION_ERROR');
    }

    if (!inputFilePath) {
      throw createError('Input file path is required', 400, 'VALIDATION_ERROR');
    }

    // Verify project exists
    let project;
    try {
      project = await dbManager.getProject(projectId);
    } catch (error) {
      throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    // Create simulation record
    const simulation = await dbManager.createSimulation(projectId, inputFilePath);
    logger.info(`Simulation created: ${simulation.id} for project ${projectId}`);

    // Prepare output directory
    const outputDirectory = path.join(process.cwd(), 'app_data', 'projects', projectId.toString(), 'output', simulation.id.toString());

    try {
      // Start the simulation
      await simulationService.startSimulation({
        id: simulation.id,
        projectId,
        inputFilePath,
        outputDirectory,
        timeout
      });

      res.status(201).json({
        ...simulation,
        status: 'running',
        outputDirectory
      });
    } catch (error: any) {
      // Update simulation status to failed if start fails
      await dbManager.updateSimulation(simulation.id, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      });
      
      throw createError(`Failed to start simulation: ${error.message}`, 500, 'SIMULATION_START_ERROR');
    }
  }));

  // PUT /api/simulations/:id - Update simulation status
  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid simulation ID', 400, 'INVALID_ID');
    }

    const allowedUpdates = ['status', 'progress', 'output_file_path', 'error_message', 'completed_at'];
    const updates = Object.keys(req.body)
      .filter(key => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {} as any);

    if (Object.keys(updates).length === 0) {
      throw createError('No valid updates provided', 400, 'VALIDATION_ERROR');
    }

    try {
      const simulation = await dbManager.updateSimulation(id, updates);
      logger.info(`Simulation updated: ${simulation.id} - status: ${simulation.status}`);
      res.json(simulation);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Simulation not found', 404, 'SIMULATION_NOT_FOUND');
      }
      throw error;
    }
  }));

  // DELETE /api/simulations/:id - Cancel/stop simulation
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid simulation ID', 400, 'INVALID_ID');
    }

    try {
      // Check if simulation exists
      const simulation = await dbManager.getSimulation(id);
      
      // Stop the simulation if it's running
      if (simulationService.isSimulationRunning(id)) {
        await simulationService.stopSimulation(id);
        logger.info(`Running simulation stopped: ${id}`);
      } else {
        // Update status if not running
        await dbManager.updateSimulation(id, { 
          status: 'cancelled',
          completed_at: new Date().toISOString()
        });
        logger.info(`Simulation cancelled: ${id}`);
      }

      const updatedSimulation = await dbManager.getSimulation(id);
      res.json(updatedSimulation);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Simulation not found', 404, 'SIMULATION_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/simulations/running - Get all running simulations
  router.get('/running', asyncHandler(async (req, res) => {
    const runningIds = simulationService.getRunningSimulations();
    const runningSimulations: any[] = [];
    
    for (const id of runningIds) {
      try {
        const simulation = await dbManager.getSimulation(id);
        runningSimulations.push(simulation);
      } catch (error) {
        logger.warn(`Failed to get simulation ${id}:`, error);
      }
    }
    
    res.json(runningSimulations);
  }));

  return router;
}
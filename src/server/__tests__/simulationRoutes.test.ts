import request from 'supertest';
import express from 'express';
import { DatabaseManager } from '../database/DatabaseManager';
import { SimulationService } from '../services/simulationService';
import { setupRoutes } from '../routes';
import { errorHandler } from '../middleware/errorHandler';
import { setupTestDatabase, cleanupTestDatabase } from './setup';

// Mock the simulation service
jest.mock('../services/simulationService');

describe('Simulation Routes', () => {
  let app: express.Application;
  let dbManager: DatabaseManager;
  let mockSimulationService: jest.Mocked<SimulationService>;
  let testProject: any;

  beforeEach(async () => {
    dbManager = await setupTestDatabase();
    
    // Create mock simulation service
    mockSimulationService = {
      startSimulation: jest.fn(),
      stopSimulation: jest.fn(),
      getRunningSimulations: jest.fn(),
      isSimulationRunning: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      shutdown: jest.fn(),
    } as any;

    app = express();
    app.use(express.json());
    setupRoutes(app, dbManager, mockSimulationService);
    app.use(errorHandler);

    // Create a test project
    testProject = await dbManager.createProject('Test Project', 'Test Description');
  });

  afterEach(async () => {
    await cleanupTestDatabase(dbManager);
  });

  describe('POST /api/projects/:id/simulate', () => {
    test('should start simulation successfully', async () => {
      const mockSimulation = {
        id: 1,
        project_id: testProject.id,
        status: 'running',
        progress: 0,
        started_at: new Date(),
      };

      mockSimulationService.startSimulation.mockResolvedValue(mockSimulation as any);

      const response = await request(app)
        .post(`/api/projects/${testProject.id}/simulate`)
        .send({
          inputFilePath: '/test/input.wam',
          timeout: 30000
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
      expect(mockSimulationService.startSimulation).toHaveBeenCalled();
    });

    test('should return error if simulation is already running', async () => {
      mockSimulationService.startSimulation.mockRejectedValue(
        new Error('Simulation is already running')
      );

      const response = await request(app)
        .post(`/api/projects/${testProject.id}/simulate`)
        .send({
          inputFilePath: '/test/input.wam'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('already running');
    });

    test('should validate input file path', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/simulate`)
        .send({
          // Missing inputFilePath
          timeout: 30000
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .post('/api/projects/999/simulate')
        .send({
          inputFilePath: '/test/input.wam'
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('GET /api/simulations/:id', () => {
    test('should return simulation status', async () => {
      // Create a simulation record
      const simulation = await dbManager.createSimulation(testProject.id, '/test/input.wam');

      const response = await request(app)
        .get(`/api/simulations/${simulation.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(simulation.id);
      expect(response.body.status).toBe('running');
    });

    test('should return 404 for non-existent simulation', async () => {
      const response = await request(app)
        .get('/api/simulations/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SIMULATION_NOT_FOUND');
    });
  });

  describe('DELETE /api/simulations/:id', () => {
    test('should stop running simulation', async () => {
      const simulation = await dbManager.createSimulation(testProject.id, '/test/input.wam');
      
      mockSimulationService.stopSimulation.mockResolvedValue(undefined);
      mockSimulationService.isSimulationRunning.mockReturnValue(true);

      const response = await request(app)
        .delete(`/api/simulations/${simulation.id}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('stopped');
      expect(mockSimulationService.stopSimulation).toHaveBeenCalledWith(simulation.id);
    });

    test('should return error if simulation is not running', async () => {
      const simulation = await dbManager.createSimulation(testProject.id, '/test/input.wam');
      
      mockSimulationService.isSimulationRunning.mockReturnValue(false);

      const response = await request(app)
        .delete(`/api/simulations/${simulation.id}`);

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('not running');
    });

    test('should return 404 for non-existent simulation', async () => {
      const response = await request(app)
        .delete('/api/simulations/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SIMULATION_NOT_FOUND');
    });
  });

  describe('GET /api/projects/:id/simulations', () => {
    test('should return project simulations', async () => {
      // Create multiple simulations
      await dbManager.createSimulation(testProject.id, '/test/input1.wam');
      await dbManager.createSimulation(testProject.id, '/test/input2.wam');

      const response = await request(app)
        .get(`/api/projects/${testProject.id}/simulations`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    test('should return empty array for project with no simulations', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/simulations`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .get('/api/projects/999/simulations');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('GET /api/simulations/running', () => {
    test('should return running simulations', async () => {
      const runningSimulations = [
        { id: 1, projectId: testProject.id, status: 'running' },
        { id: 2, projectId: testProject.id, status: 'running' }
      ];

      mockSimulationService.getRunningSimulations.mockReturnValue(runningSimulations as any);

      const response = await request(app)
        .get('/api/simulations/running');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockSimulationService.getRunningSimulations).toHaveBeenCalled();
    });

    test('should return empty array when no simulations are running', async () => {
      mockSimulationService.getRunningSimulations.mockReturnValue([]);

      const response = await request(app)
        .get('/api/simulations/running');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });
});
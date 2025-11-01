import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { app, dbManager, simulationService } from '../server';
import { DatabaseManager } from '../database/DatabaseManager';
import path from 'path';
import fs from 'fs/promises';

// Mock child_process for testing
jest.mock('child_process');
jest.mock('fs/promises');

describe('Simulation Integration Tests', () => {
  let testDbManager: DatabaseManager;
  
  beforeAll(async () => {
    // Use in-memory database for testing
    testDbManager = new DatabaseManager();
    await testDbManager.initialize();
  });

  afterAll(async () => {
    await testDbManager.close();
    await simulationService.shutdown();
  });

  beforeEach(() => {
    // Mock file system operations
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.readdir as jest.Mock).mockResolvedValue(['result.csv']);
  });

  describe('Simulation API Endpoints', () => {
    let projectId: number;

    beforeEach(async () => {
      // Create a test project
      const project = await testDbManager.createProject('Test Project', 'Test Description');
      projectId = project.id;
    });

    it('should create and start a simulation', async () => {
      const response = await request(app)
        .post('/api/simulations')
        .send({
          projectId,
          inputFilePath: '/test/input.wam',
          timeout: 30000
        })
        .expect(201);

      expect(response.body).toMatchObject({
        project_id: projectId,
        status: 'running',
        input_file_path: '/test/input.wam'
      });

      expect(response.body.id).toBeDefined();
      expect(response.body.outputDirectory).toBeDefined();
    });

    it('should get simulation by id', async () => {
      // Create a simulation first
      const simulation = await testDbManager.createSimulation(projectId, '/test/input.wam');

      const response = await request(app)
        .get(`/api/simulations/${simulation.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: simulation.id,
        project_id: projectId,
        status: 'running'
      });
    });

    it('should get running simulations', async () => {
      const response = await request(app)
        .get('/api/simulations/running')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should handle simulation not found', async () => {
      const response = await request(app)
        .get('/api/simulations/99999')
        .expect(404);

      expect(response.body.error.code).toBe('SIMULATION_NOT_FOUND');
    });

    it('should handle missing project id', async () => {
      const response = await request(app)
        .post('/api/simulations')
        .send({
          inputFilePath: '/test/input.wam'
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle missing input file path', async () => {
      const response = await request(app)
        .post('/api/simulations')
        .send({
          projectId
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle non-existent project', async () => {
      const response = await request(app)
        .post('/api/simulations')
        .send({
          projectId: 99999,
          inputFilePath: '/test/input.wam'
        })
        .expect(404);

      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('System Health', () => {
    it('should return system status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        version: expect.any(String)
      });
    });
  });
});
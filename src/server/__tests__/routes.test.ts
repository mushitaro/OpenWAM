import request from 'supertest';
import express from 'express';
import { DatabaseManager } from '../database/DatabaseManager';
import { setupRoutes } from '../routes';
import { errorHandler } from '../middleware/errorHandler';
import { setupTestDatabase, cleanupTestDatabase } from './setup';

describe('API Routes', () => {
  let app: express.Application;
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    dbManager = await setupTestDatabase();
    app = express();
    app.use(express.json());
    // Create a mock simulation service for testing
    const mockSimulationService = {} as any;
    setupRoutes(app, dbManager, mockSimulationService);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await cleanupTestDatabase(dbManager);
  });

  describe('Project routes', () => {
    test('POST /api/projects should create project', async () => {
      const response = await request(app)
        .post('/api/projects')
        .send({
          name: 'Test Project',
          description: 'Test Description'
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Test Project');
      expect(response.body.description).toBe('Test Description');
    });

    test('GET /api/projects should return all projects', async () => {
      await dbManager.createProject('Project 1');
      await dbManager.createProject('Project 2');

      const response = await request(app).get('/api/projects');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    test('GET /api/projects/:id should return specific project', async () => {
      const project = await dbManager.createProject('Test Project');

      const response = await request(app).get(`/api/projects/${project.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(project.id);
      expect(response.body.name).toBe('Test Project');
    });

    test('PUT /api/projects/:id should update project', async () => {
      const project = await dbManager.createProject('Original Name');

      const response = await request(app)
        .put(`/api/projects/${project.id}`)
        .send({
          name: 'Updated Name',
          description: 'Updated Description'
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Name');
      expect(response.body.description).toBe('Updated Description');
    });

    test('DELETE /api/projects/:id should delete project', async () => {
      const project = await dbManager.createProject('To Delete');

      const response = await request(app).delete(`/api/projects/${project.id}`);

      expect(response.status).toBe(204);

      // Verify project is deleted
      const getResponse = await request(app).get(`/api/projects/${project.id}`);
      expect(getResponse.status).toBe(404);
    });
  });

  describe('System routes', () => {
    test('GET /api/system/status should return system status', async () => {
      const response = await request(app).get('/api/system/status');

      expect(response.status).toBe(200);
      expect(response.body.server).toBeDefined();
      expect(response.body.system).toBeDefined();
      expect(response.body.process).toBeDefined();
    });

    test('GET /api/system/health should return health status', async () => {
      const response = await request(app).get('/api/system/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
      expect(response.body.checks).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('should return 404 for non-existent project', async () => {
      const response = await request(app).get('/api/projects/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    test('should return 400 for invalid project ID', async () => {
      const response = await request(app).get('/api/projects/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_ID');
    });

    test('should return 400 for validation errors', async () => {
      const response = await request(app)
        .post('/api/projects')
        .send({
          // Missing required name field
          description: 'Test Description'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
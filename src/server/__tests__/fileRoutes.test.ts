import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { DatabaseManager } from '../database/DatabaseManager';
import { setupRoutes } from '../routes';
import { errorHandler } from '../middleware/errorHandler';
import { setupTestDatabase, cleanupTestDatabase } from './setup';

describe('File Routes', () => {
  let app: express.Application;
  let dbManager: DatabaseManager;
  let testProject: any;

  beforeEach(async () => {
    dbManager = await setupTestDatabase();
    app = express();
    app.use(express.json());
    
    const mockSimulationService = {} as any;
    setupRoutes(app, dbManager, mockSimulationService);
    app.use(errorHandler);

    // Create a test project
    testProject = await dbManager.createProject('Test Project', 'Test Description');
  });

  afterEach(async () => {
    await cleanupTestDatabase(dbManager);
  });

  describe('POST /api/files/upload', () => {
    test('should upload WAM file successfully', async () => {
      const testFileContent = `2200
0
0.1 1.0
101325 293
1 1
0
0
1 1 0
0
1
1 1 2 10 1 1.0 0.1
1 0
1.0 0.05
1 1.0 1.0
0.002 7800 460 50
293 0
293 101325 0
1
0.002 7800 460 50
0
0
0
0
0
0
0
0
0
0`;

      const response = await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from(testFileContent), 'test.wam');

      expect(response.status).toBe(200);
      expect(response.body.filename).toBe('test.wam');
      expect(response.body.fileType).toBe('application/octet-stream');
    });

    test('should reject non-WAM files', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from('invalid content'), 'test.txt');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject files that are too large', async () => {
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB

      const response = await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from(largeContent), 'large.wam');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    });

    test('should require project ID', async () => {
      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', Buffer.from('test content'), 'test.wam');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/files/:id/download', () => {
    test('should download file successfully', async () => {
      // First upload a file
      const testContent = 'test file content';
      const uploadResponse = await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from(testContent), 'test.wam');

      const fileId = uploadResponse.body.id;

      // Then download it
      const downloadResponse = await request(app)
        .get(`/api/files/${fileId}/download`);

      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.text).toBe(testContent);
      expect(downloadResponse.headers['content-disposition']).toContain('test.wam');
    });

    test('should return 404 for non-existent file', async () => {
      const response = await request(app)
        .get('/api/files/999/download');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FILE_NOT_FOUND');
    });
  });

  describe('GET /api/projects/:id/files', () => {
    test('should return project files', async () => {
      // Upload a file
      await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from('test content'), 'test.wam');

      const response = await request(app)
        .get(`/api/projects/${testProject.id}/files`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].filename).toBe('test.wam');
    });

    test('should return empty array for project with no files', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/files`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('DELETE /api/files/:id', () => {
    test('should delete file successfully', async () => {
      // Upload a file
      const uploadResponse = await request(app)
        .post('/api/files/upload')
        .field('projectId', testProject.id.toString())
        .attach('file', Buffer.from('test content'), 'test.wam');

      const fileId = uploadResponse.body.id;

      // Delete it
      const deleteResponse = await request(app)
        .delete(`/api/files/${fileId}`);

      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const downloadResponse = await request(app)
        .get(`/api/files/${fileId}/download`);

      expect(downloadResponse.status).toBe(404);
    });

    test('should return 404 for non-existent file', async () => {
      const response = await request(app)
        .delete('/api/files/999');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FILE_NOT_FOUND');
    });
  });
});
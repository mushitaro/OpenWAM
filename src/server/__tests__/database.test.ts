import { DatabaseManager } from '../database/DatabaseManager';
import { setupTestDatabase, cleanupTestDatabase } from './setup';

describe('DatabaseManager', () => {
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    dbManager = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(dbManager);
  });

  describe('Project operations', () => {
    test('should create a new project', async () => {
      const project = await dbManager.createProject('Test Project', 'Test Description');
      
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.description).toBe('Test Description');
      expect(project.created_at).toBeDefined();
      expect(project.updated_at).toBeDefined();
    });

    test('should get project by ID', async () => {
      const created = await dbManager.createProject('Test Project');
      const retrieved = await dbManager.getProject(created.id);
      
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test Project');
    });

    test('should get all projects', async () => {
      await dbManager.createProject('Project 1');
      await dbManager.createProject('Project 2');
      
      const projects = await dbManager.getAllProjects();
      expect(projects).toHaveLength(2);
    });

    test('should update project', async () => {
      const project = await dbManager.createProject('Original Name');
      const updated = await dbManager.updateProject(project.id, {
        name: 'Updated Name',
        description: 'Updated Description'
      });
      
      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated Description');
    });

    test('should delete project', async () => {
      const project = await dbManager.createProject('To Delete');
      await dbManager.deleteProject(project.id);
      
      await expect(dbManager.getProject(project.id)).rejects.toThrow('not found');
    });
  });

  describe('Simulation operations', () => {
    test('should create simulation', async () => {
      const project = await dbManager.createProject('Test Project');
      const simulation = await dbManager.createSimulation(project.id, '/path/to/input.wam');
      
      expect(simulation.id).toBeDefined();
      expect(simulation.project_id).toBe(project.id);
      expect(simulation.status).toBe('running');
      expect(simulation.input_file_path).toBe('/path/to/input.wam');
      expect(simulation.progress).toBe(0);
    });

    test('should update simulation status', async () => {
      const project = await dbManager.createProject('Test Project');
      const simulation = await dbManager.createSimulation(project.id);
      
      const updated = await dbManager.updateSimulation(simulation.id, {
        status: 'completed',
        progress: 100,
        output_file_path: '/path/to/output.csv'
      });
      
      expect(updated.status).toBe('completed');
      expect(updated.progress).toBe(100);
      expect(updated.output_file_path).toBe('/path/to/output.csv');
    });

    test('should get project simulations', async () => {
      const project = await dbManager.createProject('Test Project');
      await dbManager.createSimulation(project.id);
      await dbManager.createSimulation(project.id);
      
      const simulations = await dbManager.getProjectSimulations(project.id);
      expect(simulations).toHaveLength(2);
    });
  });

  describe('File operations', () => {
    test('should create file record', async () => {
      const project = await dbManager.createProject('Test Project');
      const fileRecord = await dbManager.createFileRecord(
        project.id,
        'test.wam',
        '/path/to/test.wam',
        'application/octet-stream',
        1024
      );
      
      expect(fileRecord.id).toBeDefined();
      expect(fileRecord.project_id).toBe(project.id);
      expect(fileRecord.filename).toBe('test.wam');
      expect(fileRecord.file_size).toBe(1024);
    });

    test('should get project files', async () => {
      const project = await dbManager.createProject('Test Project');
      await dbManager.createFileRecord(project.id, 'file1.wam', '/path/1');
      await dbManager.createFileRecord(project.id, 'file2.wam', '/path/2');
      
      const files = await dbManager.getProjectFiles(project.id);
      expect(files).toHaveLength(2);
    });

    test('should delete file record', async () => {
      const project = await dbManager.createProject('Test Project');
      const fileRecord = await dbManager.createFileRecord(project.id, 'test.wam', '/path');
      
      await dbManager.deleteFileRecord(fileRecord.id);
      await expect(dbManager.getFileRecord(fileRecord.id)).rejects.toThrow('not found');
    });
  });
});
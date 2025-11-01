import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { Template, Preset, ProjectHistory } from '../../shared/types';

export interface Project {
  id: number;
  name: string;
  description?: string;
  model_data?: string;
  created_at: string;
  updated_at: string;
}

export interface Simulation {
  id: number;
  project_id: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  input_file_path?: string;
  output_file_path?: string;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  progress: number;
}

export interface FileRecord {
  id: number;
  project_id: number;
  filename: string;
  file_path: string;
  file_type?: string;
  file_size: number;
  uploaded_at: string;
}

export class DatabaseManager {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor() {
    const dataDir = path.join(__dirname, '../../../app_data');
    this.dbPath = path.join(dataDir, 'openwam.db');
  }

  async initialize(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Enable foreign keys
      await this.db.exec('PRAGMA foreign_keys = ON');

      // Create tables
      await this.createTables();

      // Initialize default data
      await this.initializeDefaultData();

      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const createProjectsTable = `
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        model_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSimulationsTable = `
      CREATE TABLE IF NOT EXISTS simulations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        status TEXT CHECK(status IN ('running', 'completed', 'failed', 'cancelled')) NOT NULL,
        input_file_path TEXT,
        output_file_path TEXT,
        error_message TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        progress INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `;

    const createFilesTable = `
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `;

    const createTemplatesTable = `
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'general',
        model_data TEXT NOT NULL,
        thumbnail TEXT,
        is_system BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createPresetsTable = `
      CREATE TABLE IF NOT EXISTS presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        component_type TEXT NOT NULL,
        properties_data TEXT NOT NULL,
        is_system BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createProjectHistoryTable = `
      CREATE TABLE IF NOT EXISTS project_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        model_data TEXT NOT NULL,
        change_description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_simulations_project_id ON simulations(project_id);
      CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status);
      CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
      CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
      CREATE INDEX IF NOT EXISTS idx_presets_component_type ON presets(component_type);
      CREATE INDEX IF NOT EXISTS idx_project_history_project_id ON project_history(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_history_version ON project_history(project_id, version_number);
    `;

    await this.db.exec(createProjectsTable);
    await this.db.exec(createSimulationsTable);
    await this.db.exec(createFilesTable);
    await this.db.exec(createTemplatesTable);
    await this.db.exec(createPresetsTable);
    await this.db.exec(createProjectHistoryTable);
    await this.db.exec(createIndexes);

    logger.info('Database tables created successfully');
  }

  // Project methods
  async createProject(name: string, description?: string): Promise<Project> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO projects (name, description) VALUES (?, ?)',
      [name, description]
    );

    return this.getProject(result.lastID!);
  }

  async getProject(id: number): Promise<Project> {
    if (!this.db) throw new Error('Database not initialized');

    const project = await this.db.get<Project>(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );

    if (!project) {
      throw new Error(`Project with id ${id} not found`);
    }

    return project;
  }

  async getAllProjects(): Promise<Project[]> {
    if (!this.db) throw new Error('Database not initialized');

    return this.db.all<Project[]>(
      'SELECT * FROM projects ORDER BY updated_at DESC'
    );
  }

  async updateProject(id: number, updates: Partial<Omit<Project, 'id' | 'created_at'>>): Promise<Project> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');

    const values: any[] = Object.values(updates);
    values.push(id);

    await this.db.run(
      `UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    return this.getProject(id);
  }

  async deleteProject(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM projects WHERE id = ?', [id]);
  }

  // Simulation methods
  async createSimulation(projectId: number, inputFilePath?: string): Promise<Simulation> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO simulations (project_id, status, input_file_path) VALUES (?, ?, ?)',
      [projectId, 'running', inputFilePath]
    );

    return this.getSimulation(result.lastID!);
  }

  async getSimulation(id: number): Promise<Simulation> {
    if (!this.db) throw new Error('Database not initialized');

    const simulation = await this.db.get<Simulation>(
      'SELECT * FROM simulations WHERE id = ?',
      [id]
    );

    if (!simulation) {
      throw new Error(`Simulation with id ${id} not found`);
    }

    return simulation;
  }

  async updateSimulation(id: number, updates: Partial<Omit<Simulation, 'id' | 'project_id' | 'started_at'>>): Promise<Simulation> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');

    const values: any[] = Object.values(updates);
    values.push(id);

    await this.db.run(
      `UPDATE simulations SET ${setClause} WHERE id = ?`,
      values
    );

    return this.getSimulation(id);
  }

  async getProjectSimulations(projectId: number): Promise<Simulation[]> {
    if (!this.db) throw new Error('Database not initialized');

    return this.db.all<Simulation[]>(
      'SELECT * FROM simulations WHERE project_id = ? ORDER BY started_at DESC',
      [projectId]
    );
  }

  // File methods
  async createFileRecord(projectId: number, filename: string, filePath: string, fileType?: string, fileSize?: number): Promise<FileRecord> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO files (project_id, filename, file_path, file_type, file_size) VALUES (?, ?, ?, ?, ?)',
      [projectId, filename, filePath, fileType, fileSize || 0]
    );

    return this.getFileRecord(result.lastID!);
  }

  async getFileRecord(id: number): Promise<FileRecord> {
    if (!this.db) throw new Error('Database not initialized');

    const file = await this.db.get<FileRecord>(
      'SELECT * FROM files WHERE id = ?',
      [id]
    );

    if (!file) {
      throw new Error(`File with id ${id} not found`);
    }

    return file;
  }

  async getProjectFiles(projectId: number): Promise<FileRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    return this.db.all<FileRecord[]>(
      'SELECT * FROM files WHERE project_id = ? ORDER BY uploaded_at DESC',
      [projectId]
    );
  }

  async deleteFileRecord(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM files WHERE id = ?', [id]);
  }

  // Template methods
  async createTemplate(name: string, description: string, category: string, modelData: string, thumbnail?: string, isSystem: boolean = false): Promise<Template> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO templates (name, description, category, model_data, thumbnail, is_system) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description, category, modelData, thumbnail, isSystem ? 1 : 0]
    );

    return this.getTemplate(result.lastID!);
  }

  async getTemplate(id: number): Promise<Template> {
    if (!this.db) throw new Error('Database not initialized');

    const template = await this.db.get<Template>(
      'SELECT * FROM templates WHERE id = ?',
      [id]
    );

    if (!template) {
      throw new Error(`Template with id ${id} not found`);
    }

    return template;
  }

  async getAllTemplates(category?: string): Promise<Template[]> {
    if (!this.db) throw new Error('Database not initialized');

    if (category) {
      return this.db.all<Template[]>(
        'SELECT * FROM templates WHERE category = ? ORDER BY name',
        [category]
      );
    } else {
      return this.db.all<Template[]>(
        'SELECT * FROM templates ORDER BY category, name'
      );
    }
  }

  async updateTemplate(id: number, updates: Partial<Omit<Template, 'id' | 'created_at' | 'updated_at'>>): Promise<Template> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');

    const values: any[] = Object.values(updates);
    values.push(new Date().toISOString());
    values.push(id);

    await this.db.run(
      `UPDATE templates SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    );

    return this.getTemplate(id);
  }

  async deleteTemplate(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM templates WHERE id = ?', [id]);
  }

  // Preset methods
  async createPreset(name: string, description: string, componentType: string, propertiesData: string, isSystem: boolean = false): Promise<Preset> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO presets (name, description, component_type, properties_data, is_system) VALUES (?, ?, ?, ?, ?)',
      [name, description, componentType, propertiesData, isSystem ? 1 : 0]
    );

    return this.getPreset(result.lastID!);
  }

  async getPreset(id: number): Promise<Preset> {
    if (!this.db) throw new Error('Database not initialized');

    const preset = await this.db.get<Preset>(
      'SELECT * FROM presets WHERE id = ?',
      [id]
    );

    if (!preset) {
      throw new Error(`Preset with id ${id} not found`);
    }

    return preset;
  }

  async getAllPresets(componentType?: string): Promise<Preset[]> {
    if (!this.db) throw new Error('Database not initialized');

    if (componentType) {
      return this.db.all<Preset[]>(
        'SELECT * FROM presets WHERE component_type = ? ORDER BY name',
        [componentType]
      );
    } else {
      return this.db.all<Preset[]>(
        'SELECT * FROM presets ORDER BY component_type, name'
      );
    }
  }

  async updatePreset(id: number, updates: Partial<Omit<Preset, 'id' | 'created_at' | 'updated_at'>>): Promise<Preset> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');

    const values: any[] = Object.values(updates);
    values.push(new Date().toISOString());
    values.push(id);

    await this.db.run(
      `UPDATE presets SET ${setClause}, updated_at = ? WHERE id = ?`,
      values
    );

    return this.getPreset(id);
  }

  async deletePreset(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM presets WHERE id = ?', [id]);
  }

  // Project history methods
  async createProjectHistory(projectId: number, versionNumber: number, modelData: string, changeDescription?: string): Promise<ProjectHistory> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'INSERT INTO project_history (project_id, version_number, model_data, change_description) VALUES (?, ?, ?, ?)',
      [projectId, versionNumber, modelData, changeDescription]
    );

    return this.getProjectHistory(result.lastID!);
  }

  async getProjectHistory(id: number): Promise<ProjectHistory> {
    if (!this.db) throw new Error('Database not initialized');

    const history = await this.db.get<ProjectHistory>(
      'SELECT * FROM project_history WHERE id = ?',
      [id]
    );

    if (!history) {
      throw new Error(`Project history with id ${id} not found`);
    }

    return history;
  }

  async getProjectHistoryByProject(projectId: number): Promise<ProjectHistory[]> {
    if (!this.db) throw new Error('Database not initialized');

    return this.db.all<ProjectHistory[]>(
      'SELECT * FROM project_history WHERE project_id = ? ORDER BY version_number DESC',
      [projectId]
    );
  }

  async getLatestProjectVersion(projectId: number): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.get<{ max_version: number }>(
      'SELECT MAX(version_number) as max_version FROM project_history WHERE project_id = ?',
      [projectId]
    );

    return result?.max_version || 0;
  }

  async deleteProjectHistory(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM project_history WHERE id = ?', [id]);
  }

  // Initialize default system data
  async initializeDefaultData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Check if system templates already exist
    const existingTemplates = await this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM templates WHERE is_system = 1'
    );

    if (existingTemplates && existingTemplates.count > 0) {
      logger.info('System templates already exist, skipping initialization');
      return;
    }

    logger.info('Initializing default system templates and presets');

    // Create default templates
    const defaultTemplates = [
      {
        name: 'Simple Engine',
        description: 'Basic 4-stroke engine with intake and exhaust pipes',
        category: 'engine',
        model_data: JSON.stringify({
          components: [
            {
              id: 'engine_1',
              type: 'TBloqueMotor',
              position: { x: 300, y: 200 },
              rotation: 0,
              properties: {
                tipoMotor: '4T',
                geometria: {
                  nCilin: 4,
                  carrera: 0.086,
                  diametro: 0.086,
                  biela: 0.143,
                  vcc: 0.0005,
                  relaCompresion: 10.0
                },
                combustible: 'gasoline'
              }
            },
            {
              id: 'intake_pipe',
              type: 'TTubo',
              position: { x: 100, y: 150 },
              rotation: 0,
              properties: {
                numeroTubo: 1,
                nodoIzq: 1,
                nodoDer: 2,
                nin: 20,
                longitudTotal: 0.5,
                mallado: 0.025,
                nTramos: 1,
                tipoMallado: 1,
                friccion: 0.02,
                lTramo: [0.5],
                dExtTramo: [0.05]
              }
            },
            {
              id: 'exhaust_pipe',
              type: 'TTubo',
              position: { x: 500, y: 150 },
              rotation: 0,
              properties: {
                numeroTubo: 2,
                nodoIzq: 3,
                nodoDer: 4,
                nin: 20,
                longitudTotal: 1.0,
                mallado: 0.05,
                nTramos: 1,
                tipoMallado: 1,
                friccion: 0.02,
                lTramo: [1.0],
                dExtTramo: [0.04]
              }
            }
          ],
          connections: [],
          metadata: {
            name: 'Simple Engine',
            description: 'Basic engine template',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            version: '1.0'
          }
        })
      },
      {
        name: 'Turbocharged Engine',
        description: 'Engine with turbocharger, intercooler, and wastegate',
        category: 'engine',
        model_data: JSON.stringify({
          components: [
            {
              id: 'engine_1',
              type: 'TBloqueMotor',
              position: { x: 400, y: 200 },
              rotation: 0,
              properties: {
                tipoMotor: '4T',
                geometria: {
                  nCilin: 4,
                  carrera: 0.086,
                  diametro: 0.086,
                  biela: 0.143,
                  vcc: 0.0005,
                  relaCompresion: 8.5
                },
                combustible: 'gasoline'
              }
            },
            {
              id: 'compressor_1',
              type: 'TCompresorDep',
              position: { x: 200, y: 100 },
              rotation: 0,
              properties: {
                numeroCompresor: 1,
                eje: 1,
                depRotor: 1,
                depStator: 2,
                modeloCompresor: 'plenums'
              }
            },
            {
              id: 'turbine_1',
              type: 'TTurbinaSimple',
              position: { x: 600, y: 100 },
              rotation: 0,
              properties: {
                numeroDeposito: 3,
                tipoDeposito: 'turbine_simple',
                volumen0: 0.001
              }
            }
          ],
          connections: [],
          metadata: {
            name: 'Turbocharged Engine',
            description: 'Turbocharged engine template',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            version: '1.0'
          }
        })
      },
      {
        name: 'Pipe Network',
        description: 'Simple pipe network for flow analysis',
        category: 'flow',
        model_data: JSON.stringify({
          components: [
            {
              id: 'inlet',
              type: 'TCCDescargaExtremoAbierto',
              position: { x: 50, y: 200 },
              rotation: 0,
              properties: {
                tipoCC: 0,
                numeroCC: 1
              }
            },
            {
              id: 'pipe_1',
              type: 'TTubo',
              position: { x: 200, y: 200 },
              rotation: 0,
              properties: {
                numeroTubo: 1,
                nodoIzq: 1,
                nodoDer: 2,
                nin: 30,
                longitudTotal: 2.0,
                mallado: 0.067,
                nTramos: 1,
                tipoMallado: 1,
                friccion: 0.02,
                lTramo: [2.0],
                dExtTramo: [0.1]
              }
            },
            {
              id: 'outlet',
              type: 'TCCDescargaExtremoAbierto',
              position: { x: 350, y: 200 },
              rotation: 0,
              properties: {
                tipoCC: 0,
                numeroCC: 2
              }
            }
          ],
          connections: [],
          metadata: {
            name: 'Pipe Network',
            description: 'Simple pipe network template',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            version: '1.0'
          }
        })
      }
    ];

    // Insert default templates
    for (const template of defaultTemplates) {
      await this.createTemplate(
        template.name,
        template.description,
        template.category,
        template.model_data,
        undefined,
        true // is_system = true
      );
    }

    // Create default presets
    const defaultPresets = [
      {
        name: 'Standard Pipe',
        description: 'Standard pipe properties for typical applications',
        component_type: 'TTubo',
        properties_data: JSON.stringify({
          nin: 20,
          longitudTotal: 1.0,
          mallado: 0.05,
          nTramos: 1,
          tipoMallado: 1,
          friccion: 0.02,
          tipoTransCal: 0,
          coefAjusFric: 1.0,
          coefAjusTC: 1.0,
          espesorPrin: 0.005,
          densidadPrin: 7800,
          calEspPrin: 460,
          conductPrin: 50,
          tRefrigerante: 293.15,
          tipRefrig: 'air',
          tini: 293.15,
          pini: 101325,
          velMedia: 0,
          dExtTramo: [0.05],
          numCapas: 1
        })
      },
      {
        name: 'High Performance Pipe',
        description: 'High performance pipe with enhanced heat transfer',
        component_type: 'TTubo',
        properties_data: JSON.stringify({
          nin: 30,
          longitudTotal: 1.0,
          mallado: 0.033,
          nTramos: 1,
          tipoMallado: 1,
          friccion: 0.015,
          tipoTransCal: 1,
          coefAjusFric: 0.9,
          coefAjusTC: 1.2,
          espesorPrin: 0.003,
          densidadPrin: 2700,
          calEspPrin: 900,
          conductPrin: 200,
          tRefrigerante: 293.15,
          tipRefrig: 'water',
          tini: 293.15,
          pini: 101325,
          velMedia: 0,
          dExtTramo: [0.05],
          numCapas: 1
        })
      },
      {
        name: 'Standard Plenum',
        description: 'Standard constant volume plenum',
        component_type: 'TDepVolCte',
        properties_data: JSON.stringify({
          numeroDeposito: 1,
          tipoDeposito: 'constant',
          volumen0: 0.001,
          temperature: 293.15,
          pressure: 101325,
          masa0: 0.001
        })
      }
    ];

    // Insert default presets
    for (const preset of defaultPresets) {
      await this.createPreset(
        preset.name,
        preset.description,
        preset.component_type,
        preset.properties_data,
        true // is_system = true
      );
    }

    logger.info('Default system data initialized successfully');
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }
}
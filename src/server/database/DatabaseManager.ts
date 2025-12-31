import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { Template, Preset, ProjectHistory } from '../../shared/types';
import { BugReport, BugComment, BugAttachment } from '../../shared/types/bugTracking';

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

    const createBugReportsTable = `
      CREATE TABLE IF NOT EXISTS bug_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')) NOT NULL,
        status TEXT CHECK(status IN ('open', 'in_progress', 'resolved', 'closed', 'duplicate', 'wont_fix')) DEFAULT 'open',
        category TEXT CHECK(category IN ('ui_ux', 'functionality', 'performance', 'browser_compatibility', 'file_operations', 'simulation', 'validation', 'connectivity', 'data_integrity', 'security')) NOT NULL,
        type TEXT CHECK(type IN ('bug', 'enhancement', 'feature_request', 'performance_issue', 'compatibility_issue')) NOT NULL,
        
        reported_by TEXT NOT NULL,
        reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        environment_data TEXT, -- JSON string
        reproduction_steps TEXT, -- JSON string
        expected_behavior TEXT NOT NULL,
        actual_behavior TEXT NOT NULL,
        
        error_message TEXT,
        stack_trace TEXT,
        console_errors TEXT, -- JSON string
        network_errors TEXT, -- JSON string
        performance_metrics TEXT, -- JSON string
        
        project_id INTEGER,
        model_data TEXT,
        component_ids TEXT, -- JSON string
        
        assigned_to TEXT,
        resolved_by TEXT,
        resolved_at DATETIME,
        resolution TEXT,
        resolution_notes TEXT,
        
        duplicate_of INTEGER,
        related_bugs TEXT, -- JSON string
        tags TEXT, -- JSON string
        
        priority_score INTEGER DEFAULT 0,
        priority_factors TEXT, -- JSON string
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (duplicate_of) REFERENCES bug_reports(id) ON DELETE SET NULL
      )
    `;

    const createBugCommentsTable = `
      CREATE TABLE IF NOT EXISTS bug_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug_id INTEGER NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bug_id) REFERENCES bug_reports(id) ON DELETE CASCADE
      )
    `;

    const createBugAttachmentsTable = `
      CREATE TABLE IF NOT EXISTS bug_attachments (
        id TEXT PRIMARY KEY,
        bug_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT CHECK(file_type IN ('screenshot', 'video', 'log', 'model', 'other')) NOT NULL,
        file_size INTEGER NOT NULL,
        description TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bug_id) REFERENCES bug_reports(id) ON DELETE CASCADE
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
      
      CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_severity ON bug_reports(severity);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_category ON bug_reports(category);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_priority ON bug_reports(priority_score);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_project_id ON bug_reports(project_id);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_assigned_to ON bug_reports(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_bug_reports_reported_by ON bug_reports(reported_by);
      CREATE INDEX IF NOT EXISTS idx_bug_comments_bug_id ON bug_comments(bug_id);
      CREATE INDEX IF NOT EXISTS idx_bug_attachments_bug_id ON bug_attachments(bug_id);
    `;

    await this.db.exec(createProjectsTable);
    await this.db.exec(createSimulationsTable);
    await this.db.exec(createFilesTable);
    await this.db.exec(createTemplatesTable);
    await this.db.exec(createPresetsTable);
    await this.db.exec(createProjectHistoryTable);
    await this.db.exec(createBugReportsTable);
    await this.db.exec(createBugCommentsTable);
    await this.db.exec(createBugAttachmentsTable);
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

  // Bug tracking methods
  async createBugReport(bugData: Omit<BugReport, 'id' | 'createdAt' | 'updatedAt'>): Promise<BugReport> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`
      INSERT INTO bug_reports (
        title, description, severity, status, category, type,
        reported_by, environment_data, reproduction_steps, expected_behavior, actual_behavior,
        error_message, stack_trace, console_errors, network_errors, performance_metrics,
        project_id, model_data, component_ids,
        assigned_to, resolved_by, resolved_at, resolution, resolution_notes,
        duplicate_of, related_bugs, tags, priority_score, priority_factors
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      bugData.title,
      bugData.description,
      bugData.severity,
      bugData.status,
      bugData.category,
      bugData.type,
      bugData.reportedBy,
      JSON.stringify(bugData.environment),
      JSON.stringify(bugData.reproductionSteps),
      bugData.expectedBehavior,
      bugData.actualBehavior,
      bugData.errorMessage,
      bugData.stackTrace,
      JSON.stringify(bugData.consoleErrors || []),
      JSON.stringify(bugData.networkErrors || []),
      JSON.stringify(bugData.performanceMetrics),
      bugData.projectId,
      bugData.modelData,
      JSON.stringify(bugData.componentIds || []),
      bugData.assignedTo,
      bugData.resolvedBy,
      bugData.resolvedAt,
      bugData.resolution,
      bugData.resolutionNotes,
      bugData.duplicateOf,
      JSON.stringify(bugData.relatedBugs || []),
      JSON.stringify(bugData.tags || []),
      bugData.priorityScore,
      JSON.stringify(bugData.priorityFactors)
    ]);

    return this.getBugReport(result.lastID!);
  }

  async getBugReport(id: number): Promise<BugReport> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(`
      SELECT * FROM bug_reports WHERE id = ?
    `, [id]);

    if (!row) {
      throw new Error(`Bug report with id ${id} not found`);
    }

    return this.mapRowToBugReport(row);
  }

  async getAllBugReports(filters?: {
    status?: string[];
    severity?: string[];
    category?: string[];
    assignedTo?: string;
    projectId?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ bugs: BugReport[]; total: number }> {
    if (!this.db) throw new Error('Database not initialized');

    let whereClause = '';
    let params: any[] = [];
    
    if (filters) {
      const conditions: string[] = [];
      
      if (filters.status && filters.status.length > 0) {
        conditions.push(`status IN (${filters.status.map(() => '?').join(', ')})`);
        params.push(...filters.status);
      }
      
      if (filters.severity && filters.severity.length > 0) {
        conditions.push(`severity IN (${filters.severity.map(() => '?').join(', ')})`);
        params.push(...filters.severity);
      }
      
      if (filters.category && filters.category.length > 0) {
        conditions.push(`category IN (${filters.category.map(() => '?').join(', ')})`);
        params.push(...filters.category);
      }
      
      if (filters.assignedTo) {
        conditions.push('assigned_to = ?');
        params.push(filters.assignedTo);
      }
      
      if (filters.projectId) {
        conditions.push('project_id = ?');
        params.push(filters.projectId);
      }
      
      if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }
    }

    // Get total count
    const countResult = await this.db.get(`
      SELECT COUNT(*) as total FROM bug_reports ${whereClause}
    `, params);

    // Get bugs with pagination
    let query = `
      SELECT * FROM bug_reports ${whereClause}
      ORDER BY priority_score DESC, created_at DESC
    `;
    
    if (filters?.limit) {
      query += ` LIMIT ${filters.limit}`;
      if (filters.offset) {
        query += ` OFFSET ${filters.offset}`;
      }
    }

    const rows = await this.db.all(query, params);
    const bugs = rows.map(row => this.mapRowToBugReport(row));

    return {
      bugs,
      total: countResult?.total || 0
    };
  }

  async updateBugReport(id: number, updates: Partial<BugReport>): Promise<BugReport> {
    if (!this.db) throw new Error('Database not initialized');

    const setClause: string[] = [];
    const values: any[] = [];

    // Map updates to database columns
    if (updates.title !== undefined) {
      setClause.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClause.push('description = ?');
      values.push(updates.description);
    }
    if (updates.severity !== undefined) {
      setClause.push('severity = ?');
      values.push(updates.severity);
    }
    if (updates.status !== undefined) {
      setClause.push('status = ?');
      values.push(updates.status);
    }
    if (updates.category !== undefined) {
      setClause.push('category = ?');
      values.push(updates.category);
    }
    if (updates.type !== undefined) {
      setClause.push('type = ?');
      values.push(updates.type);
    }
    if (updates.assignedTo !== undefined) {
      setClause.push('assigned_to = ?');
      values.push(updates.assignedTo);
    }
    if (updates.resolvedBy !== undefined) {
      setClause.push('resolved_by = ?');
      values.push(updates.resolvedBy);
    }
    if (updates.resolvedAt !== undefined) {
      setClause.push('resolved_at = ?');
      values.push(updates.resolvedAt);
    }
    if (updates.resolution !== undefined) {
      setClause.push('resolution = ?');
      values.push(updates.resolution);
    }
    if (updates.resolutionNotes !== undefined) {
      setClause.push('resolution_notes = ?');
      values.push(updates.resolutionNotes);
    }
    if (updates.duplicateOf !== undefined) {
      setClause.push('duplicate_of = ?');
      values.push(updates.duplicateOf);
    }
    if (updates.relatedBugs !== undefined) {
      setClause.push('related_bugs = ?');
      values.push(JSON.stringify(updates.relatedBugs));
    }
    if (updates.tags !== undefined) {
      setClause.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.priorityScore !== undefined) {
      setClause.push('priority_score = ?');
      values.push(updates.priorityScore);
    }
    if (updates.priorityFactors !== undefined) {
      setClause.push('priority_factors = ?');
      values.push(JSON.stringify(updates.priorityFactors));
    }

    if (setClause.length === 0) {
      return this.getBugReport(id);
    }

    setClause.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await this.db.run(
      `UPDATE bug_reports SET ${setClause.join(', ')} WHERE id = ?`,
      values
    );

    return this.getBugReport(id);
  }

  async deleteBugReport(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM bug_reports WHERE id = ?', [id]);
  }

  async createBugComment(bugId: number, author: string, content: string, attachments?: BugAttachment[]): Promise<BugComment> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(`
      INSERT INTO bug_comments (bug_id, author, content, attachments)
      VALUES (?, ?, ?, ?)
    `, [
      bugId,
      author,
      content,
      JSON.stringify(attachments || [])
    ]);

    return this.getBugComment(result.lastID!);
  }

  async getBugComment(id: number): Promise<BugComment> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(`
      SELECT * FROM bug_comments WHERE id = ?
    `, [id]);

    if (!row) {
      throw new Error(`Bug comment with id ${id} not found`);
    }

    return {
      id: row.id,
      bugId: row.bug_id,
      author: row.author,
      content: row.content,
      attachments: JSON.parse(row.attachments || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getBugComments(bugId: number): Promise<BugComment[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(`
      SELECT * FROM bug_comments WHERE bug_id = ? ORDER BY created_at ASC
    `, [bugId]);

    return rows.map(row => ({
      id: row.id,
      bugId: row.bug_id,
      author: row.author,
      content: row.content,
      attachments: JSON.parse(row.attachments || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async createBugAttachment(attachmentData: Omit<BugAttachment, 'uploadedAt'>): Promise<BugAttachment> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(`
      INSERT INTO bug_attachments (id, bug_id, filename, file_path, file_type, file_size, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      attachmentData.id,
      attachmentData.bugId,
      attachmentData.filename,
      attachmentData.filePath,
      attachmentData.fileType,
      attachmentData.fileSize,
      attachmentData.description
    ]);

    return this.getBugAttachment(attachmentData.id);
  }

  async getBugAttachment(id: string): Promise<BugAttachment> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(`
      SELECT * FROM bug_attachments WHERE id = ?
    `, [id]);

    if (!row) {
      throw new Error(`Bug attachment with id ${id} not found`);
    }

    return {
      id: row.id,
      bugId: row.bug_id,
      filename: row.filename,
      filePath: row.file_path,
      fileType: row.file_type,
      fileSize: row.file_size,
      description: row.description,
      uploadedAt: row.uploaded_at
    };
  }

  async getBugAttachments(bugId: number): Promise<BugAttachment[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = await this.db.all(`
      SELECT * FROM bug_attachments WHERE bug_id = ? ORDER BY uploaded_at DESC
    `, [bugId]);

    return rows.map(row => ({
      id: row.id,
      bugId: row.bug_id,
      filename: row.filename,
      filePath: row.file_path,
      fileType: row.file_type,
      fileSize: row.file_size,
      description: row.description,
      uploadedAt: row.uploaded_at
    }));
  }

  private mapRowToBugReport(row: any): BugReport {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      category: row.category,
      type: row.type,
      
      reportedBy: row.reported_by,
      reportedAt: row.reported_at,
      
      environment: JSON.parse(row.environment_data || '{}'),
      reproductionSteps: JSON.parse(row.reproduction_steps || '[]'),
      expectedBehavior: row.expected_behavior,
      actualBehavior: row.actual_behavior,
      
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      consoleErrors: JSON.parse(row.console_errors || '[]'),
      networkErrors: JSON.parse(row.network_errors || '[]'),
      performanceMetrics: JSON.parse(row.performance_metrics || '{}'),
      
      projectId: row.project_id,
      modelData: row.model_data,
      componentIds: JSON.parse(row.component_ids || '[]'),
      
      assignedTo: row.assigned_to,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      resolution: row.resolution,
      resolutionNotes: row.resolution_notes,
      
      duplicateOf: row.duplicate_of,
      relatedBugs: JSON.parse(row.related_bugs || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      
      priorityScore: row.priority_score,
      priorityFactors: JSON.parse(row.priority_factors || '{}'),
      
      attachments: [], // Will be loaded separately if needed
      
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
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
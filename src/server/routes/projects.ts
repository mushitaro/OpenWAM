import { Router } from 'express';
import Joi from 'joi';
import { DatabaseManager } from '../database/DatabaseManager';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { createError } from '../utils/errorHelpers';
import { logger } from '../utils/logger';

const projectSchema = Joi.object({
  name: Joi.string().required().min(1).max(255),
  description: Joi.string().optional().allow('').max(1000)
});

const updateProjectSchema = Joi.object({
  name: Joi.string().optional().min(1).max(255),
  description: Joi.string().optional().allow('').max(1000),
  model_data: Joi.string().optional()
});

export function projectRoutes(dbManager: DatabaseManager): Router {
  const router = Router();

  // GET /api/projects - Get all projects
  router.get('/', asyncHandler(async (req, res) => {
    const projects = await dbManager.getAllProjects();
    res.json(projects);
  }));

  // POST /api/projects - Create new project
  router.post('/', asyncHandler(async (req, res) => {
    const { error, value } = projectSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    const { name, description } = value;
    const project = await dbManager.createProject(name, description);
    
    logger.info(`Project created: ${project.id} - ${project.name}`);
    res.status(201).json(project);
  }));

  // GET /api/projects/:id - Get project by ID
  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    try {
      const project = await dbManager.getProject(id);
      res.json(project);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // PUT /api/projects/:id - Update project
  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    const { error, value } = updateProjectSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    try {
      const project = await dbManager.updateProject(id, value);
      logger.info(`Project updated: ${project.id} - ${project.name}`);
      res.json(project);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // DELETE /api/projects/:id - Delete project
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    try {
      await dbManager.deleteProject(id);
      logger.info(`Project deleted: ${id}`);
      res.status(204).send();
    } catch (error) {
      throw createError('Failed to delete project', 500, 'DELETE_ERROR');
    }
  }));

  // GET /api/projects/:id/model - Get project model
  router.get('/:id/model', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    try {
      const project = await dbManager.getProject(id);
      const modelData = project.model_data ? JSON.parse(project.model_data) : null;
      res.json({ model: modelData });
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // PUT /api/projects/:id/model - Update project model
  router.put('/:id/model', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    const { model } = req.body;
    if (!model) {
      throw createError('Model data is required', 400, 'VALIDATION_ERROR');
    }

    try {
      const modelData = JSON.stringify(model);
      const project = await dbManager.updateProject(id, { model_data: modelData });
      logger.info(`Project model updated: ${project.id}`);
      res.json({ model });
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/projects/:id/simulations - Get project simulations
  router.get('/:id/simulations', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    const simulations = await dbManager.getProjectSimulations(id);
    res.json(simulations);
  }));

  // GET /api/projects/:id/files - Get project files
  router.get('/:id/files', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    const files = await dbManager.getProjectFiles(id);
    res.json(files);
  }));

  // GET /api/projects/:id/history - Get project version history
  router.get('/:id/history', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    try {
      await dbManager.getProject(id); // Verify project exists
      const history = await dbManager.getProjectHistoryByProject(id);
      res.json(history);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // POST /api/projects/:id/save-version - Save current model as new version
  router.post('/:id/save-version', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    const { changeDescription } = req.body;

    try {
      const project = await dbManager.getProject(id);
      if (!project.model_data) {
        throw createError('Project has no model data to save', 400, 'NO_MODEL_DATA');
      }

      const latestVersion = await dbManager.getLatestProjectVersion(id);
      const newVersion = latestVersion + 1;

      const history = await dbManager.createProjectHistory(
        id,
        newVersion,
        project.model_data,
        changeDescription
      );

      logger.info(`Project version saved: ${id} v${newVersion}`);
      res.status(201).json(history);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
      }
      throw error;
    }
  }));

  // POST /api/projects/:id/restore-version/:versionId - Restore project to specific version
  router.post('/:id/restore-version/:versionId', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const versionId = parseInt(req.params.versionId);
    
    if (isNaN(id) || isNaN(versionId)) {
      throw createError('Invalid project or version ID', 400, 'INVALID_ID');
    }

    try {
      const history = await dbManager.getProjectHistory(versionId);
      if (history.project_id !== id) {
        throw createError('Version does not belong to this project', 400, 'VERSION_MISMATCH');
      }

      // Save current state as backup before restoring
      const project = await dbManager.getProject(id);
      if (project.model_data) {
        const latestVersion = await dbManager.getLatestProjectVersion(id);
        await dbManager.createProjectHistory(
          id,
          latestVersion + 1,
          project.model_data,
          `Backup before restoring to version ${history.version_number}`
        );
      }

      // Restore to selected version
      const updatedProject = await dbManager.updateProject(id, {
        model_data: history.model_data
      });

      logger.info(`Project restored: ${id} to version ${history.version_number}`);
      res.json({
        project: updatedProject,
        restoredVersion: history.version_number
      });
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Project or version not found', 404, 'NOT_FOUND');
      }
      throw error;
    }
  }));

  return router;
}
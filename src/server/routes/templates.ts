import { Router } from 'express';
import Joi from 'joi';
import { DatabaseManager } from '../database/DatabaseManager';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { createError } from '../utils/errorHelpers';
import { logger } from '../utils/logger';

const templateSchema = Joi.object({
  name: Joi.string().required().min(1).max(255),
  description: Joi.string().optional().max(1000),
  category: Joi.string().required().min(1).max(100),
  model_data: Joi.string().required(),
  thumbnail: Joi.string().optional()
});

const updateTemplateSchema = Joi.object({
  name: Joi.string().optional().min(1).max(255),
  description: Joi.string().optional().max(1000),
  category: Joi.string().optional().min(1).max(100),
  model_data: Joi.string().optional(),
  thumbnail: Joi.string().optional()
});

export function templateRoutes(dbManager: DatabaseManager): Router {
  const router = Router();

  // GET /api/templates - Get all templates
  router.get('/', asyncHandler(async (req, res) => {
    const { category } = req.query;
    const templates = await dbManager.getAllTemplates(category as string);
    
    res.json({
      templates: templates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        thumbnail: template.thumbnail,
        is_system: template.is_system,
        created_at: template.created_at,
        updated_at: template.updated_at
      }))
    });
  }));

  // POST /api/templates - Create new template
  router.post('/', asyncHandler(async (req, res) => {
    const { error, value } = templateSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    const { name, description, category, model_data, thumbnail } = value;
    
    // Validate model_data is valid JSON
    try {
      JSON.parse(model_data);
    } catch (error) {
      throw createError('Invalid model data format', 400, 'INVALID_MODEL_DATA');
    }

    const template = await dbManager.createTemplate(
      name,
      description || '',
      category,
      model_data,
      thumbnail,
      false // User templates are not system templates
    );
    
    logger.info(`Template created: ${template.id} - ${template.name}`);
    res.status(201).json(template);
  }));

  // GET /api/templates/:id - Get template by ID
  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid template ID', 400, 'INVALID_ID');
    }

    try {
      const template = await dbManager.getTemplate(id);
      res.json(template);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // PUT /api/templates/:id - Update template
  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid template ID', 400, 'INVALID_ID');
    }

    const { error, value } = updateTemplateSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    // Validate model_data if provided
    if (value.model_data) {
      try {
        JSON.parse(value.model_data);
      } catch (error) {
        throw createError('Invalid model data format', 400, 'INVALID_MODEL_DATA');
      }
    }

    try {
      const existingTemplate = await dbManager.getTemplate(id);
      
      // Prevent modification of system templates
      if (existingTemplate.is_system) {
        throw createError('Cannot modify system templates', 403, 'SYSTEM_TEMPLATE');
      }

      const template = await dbManager.updateTemplate(id, value);
      logger.info(`Template updated: ${template.id} - ${template.name}`);
      res.json(template);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // DELETE /api/templates/:id - Delete template
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid template ID', 400, 'INVALID_ID');
    }

    try {
      const template = await dbManager.getTemplate(id);
      
      // Prevent deletion of system templates
      if (template.is_system) {
        throw createError('Cannot delete system templates', 403, 'SYSTEM_TEMPLATE');
      }

      await dbManager.deleteTemplate(id);
      logger.info(`Template deleted: ${id}`);
      res.status(204).send();
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // POST /api/templates/:id/clone - Clone template to create new project
  router.post('/:id/clone', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid template ID', 400, 'INVALID_ID');
    }

    const { projectName, projectDescription } = req.body;
    if (!projectName) {
      throw createError('Project name is required', 400, 'VALIDATION_ERROR');
    }

    try {
      const template = await dbManager.getTemplate(id);
      
      // Create new project from template
      const project = await dbManager.createProject(
        projectName,
        projectDescription || `Created from template: ${template.name}`
      );

      // Set the model data from template
      const updatedProject = await dbManager.updateProject(project.id, {
        model_data: template.model_data
      });

      logger.info(`Project created from template: ${project.id} from template ${template.id}`);
      res.status(201).json(updatedProject);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/templates/categories - Get all template categories
  router.get('/categories', asyncHandler(async (req, res) => {
    const templates = await dbManager.getAllTemplates();
    const categories = [...new Set(templates.map(t => t.category))].sort();
    
    res.json({ categories });
  }));

  return router;
}
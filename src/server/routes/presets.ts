import { Router } from 'express';
import Joi from 'joi';
import { DatabaseManager } from '../database/DatabaseManager';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { createError } from '../utils/errorHelpers';
import { logger } from '../utils/logger';

const presetSchema = Joi.object({
  name: Joi.string().required().min(1).max(255),
  description: Joi.string().optional().max(1000),
  component_type: Joi.string().required().min(1).max(100),
  properties_data: Joi.string().required()
});

const updatePresetSchema = Joi.object({
  name: Joi.string().optional().min(1).max(255),
  description: Joi.string().optional().max(1000),
  component_type: Joi.string().optional().min(1).max(100),
  properties_data: Joi.string().optional()
});

export function presetRoutes(dbManager: DatabaseManager): Router {
  const router = Router();

  // GET /api/presets - Get all presets
  router.get('/', asyncHandler(async (req, res) => {
    const { component_type } = req.query;
    const presets = await dbManager.getAllPresets(component_type as string);
    
    res.json({
      presets: presets.map(preset => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        component_type: preset.component_type,
        is_system: preset.is_system,
        created_at: preset.created_at,
        updated_at: preset.updated_at
      }))
    });
  }));

  // POST /api/presets - Create new preset
  router.post('/', asyncHandler(async (req, res) => {
    const { error, value } = presetSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    const { name, description, component_type, properties_data } = value;
    
    // Validate properties_data is valid JSON
    try {
      JSON.parse(properties_data);
    } catch (error) {
      throw createError('Invalid properties data format', 400, 'INVALID_PROPERTIES_DATA');
    }

    const preset = await dbManager.createPreset(
      name,
      description || '',
      component_type,
      properties_data,
      false // User presets are not system presets
    );
    
    logger.info(`Preset created: ${preset.id} - ${preset.name}`);
    res.status(201).json(preset);
  }));

  // GET /api/presets/:id - Get preset by ID
  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid preset ID', 400, 'INVALID_ID');
    }

    try {
      const preset = await dbManager.getPreset(id);
      res.json(preset);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Preset not found', 404, 'PRESET_NOT_FOUND');
      }
      throw error;
    }
  }));

  // PUT /api/presets/:id - Update preset
  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid preset ID', 400, 'INVALID_ID');
    }

    const { error, value } = updatePresetSchema.validate(req.body);
    if (error) {
      throw createError(error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    // Validate properties_data if provided
    if (value.properties_data) {
      try {
        JSON.parse(value.properties_data);
      } catch (error) {
        throw createError('Invalid properties data format', 400, 'INVALID_PROPERTIES_DATA');
      }
    }

    try {
      const existingPreset = await dbManager.getPreset(id);
      
      // Prevent modification of system presets
      if (existingPreset.is_system) {
        throw createError('Cannot modify system presets', 403, 'SYSTEM_PRESET');
      }

      const preset = await dbManager.updatePreset(id, value);
      logger.info(`Preset updated: ${preset.id} - ${preset.name}`);
      res.json(preset);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Preset not found', 404, 'PRESET_NOT_FOUND');
      }
      throw error;
    }
  }));

  // DELETE /api/presets/:id - Delete preset
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid preset ID', 400, 'INVALID_ID');
    }

    try {
      const preset = await dbManager.getPreset(id);
      
      // Prevent deletion of system presets
      if (preset.is_system) {
        throw createError('Cannot delete system presets', 403, 'SYSTEM_PRESET');
      }

      await dbManager.deletePreset(id);
      logger.info(`Preset deleted: ${id}`);
      res.status(204).send();
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('Preset not found', 404, 'PRESET_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/presets/component-types - Get all component types that have presets
  router.get('/component-types', asyncHandler(async (req, res) => {
    const presets = await dbManager.getAllPresets();
    const componentTypes = [...new Set(presets.map(p => p.component_type))].sort();
    
    res.json({ componentTypes });
  }));

  return router;
}
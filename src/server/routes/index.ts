import { Application } from 'express';
import { DatabaseManager } from '../database/DatabaseManager';
import { SimulationService } from '../services/simulationService';
import { projectRoutes } from './projects';
import { simulationRoutes } from './simulations';
import { fileRoutes } from './files';
import { systemRoutes } from './system';
import { createResultsRouter } from './results';
import { templateRoutes } from './templates';
import { presetRoutes } from './presets';

export function setupRoutes(app: Application, dbManager: DatabaseManager, simulationService: SimulationService): void {
  // API routes
  app.use('/api/projects', projectRoutes(dbManager));
  app.use('/api/simulations', simulationRoutes(dbManager, simulationService));
  app.use('/api/files', fileRoutes(dbManager));
  app.use('/api/system', systemRoutes());
  app.use('/api/results', createResultsRouter(dbManager));
  app.use('/api/templates', templateRoutes(dbManager));
  app.use('/api/presets', presetRoutes(dbManager));

  // Catch-all for API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: {
        message: 'API endpoint not found',
        code: 'NOT_FOUND'
      }
    });
  });
}
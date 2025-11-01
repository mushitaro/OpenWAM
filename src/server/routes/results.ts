import express from 'express';
import path from 'path';
import { DatabaseManager } from '../database/DatabaseManager';
import { ResultAnalysisService } from '../../shared/services/resultAnalysisService';
import { logger } from '../utils/logger';
import { ApiResponse, SimulationResults, ChartData } from '../../shared/types';

const router = express.Router();

export function createResultsRouter(dbManager: DatabaseManager): express.Router {
  const resultAnalysisService = new ResultAnalysisService();

  /**
   * Get parsed simulation results
   */
  router.get('/simulations/:id/results', async (req, res) => {
    try {
      const simulationId = parseInt(req.params.id);
      
      if (isNaN(simulationId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid simulation ID',
            code: 'INVALID_SIMULATION_ID'
          }
        } as ApiResponse);
      }

      // Get simulation from database
      const simulation = await dbManager.getSimulation(simulationId);
      if (!simulation) {
        return res.status(404).json({
          error: {
            message: 'Simulation not found',
            code: 'SIMULATION_NOT_FOUND'
          }
        } as ApiResponse);
      }

      if (simulation.status !== 'completed') {
        return res.status(400).json({
          error: {
            message: 'Simulation is not completed',
            code: 'SIMULATION_NOT_COMPLETED'
          }
        } as ApiResponse);
      }

      // Determine output directory
      const outputDirectory = simulation.output_file_path 
        ? path.dirname(simulation.output_file_path)
        : path.join(process.cwd(), 'app_data', 'projects', simulation.project_id.toString(), 'output', simulationId.toString());

      // Parse simulation results
      const results = await resultAnalysisService.parseSimulationResults(
        simulationId,
        simulation.project_id,
        outputDirectory
      );

      res.json({
        data: results
      } as ApiResponse<SimulationResults>);

    } catch (error: any) {
      logger.error('Error getting simulation results:', error);
      res.status(500).json({
        error: {
          message: 'Failed to get simulation results',
          code: 'RESULTS_FETCH_ERROR',
          details: error.message
        }
      } as ApiResponse);
    }
  });

  /**
   * Get chart data for specific data type and components
   */
  router.get('/simulations/:id/chart-data', async (req, res) => {
    try {
      const simulationId = parseInt(req.params.id);
      const dataType = req.query.dataType as string;
      const componentIds = req.query.componentIds as string | string[];
      
      if (isNaN(simulationId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid simulation ID',
            code: 'INVALID_SIMULATION_ID'
          }
        } as ApiResponse);
      }

      if (!dataType) {
        return res.status(400).json({
          error: {
            message: 'Data type is required',
            code: 'MISSING_DATA_TYPE'
          }
        } as ApiResponse);
      }

      // Validate data type
      const validDataTypes = ['pressure', 'temperature', 'velocity', 'massFlow', 'torque', 'power'];
      if (!validDataTypes.includes(dataType)) {
        return res.status(400).json({
          error: {
            message: `Invalid data type. Must be one of: ${validDataTypes.join(', ')}`,
            code: 'INVALID_DATA_TYPE'
          }
        } as ApiResponse);
      }

      // Get simulation from database
      const simulation = await dbManager.getSimulation(simulationId);
      if (!simulation) {
        return res.status(404).json({
          error: {
            message: 'Simulation not found',
            code: 'SIMULATION_NOT_FOUND'
          }
        } as ApiResponse);
      }

      if (simulation.status !== 'completed') {
        return res.status(400).json({
          error: {
            message: 'Simulation is not completed',
            code: 'SIMULATION_NOT_COMPLETED'
          }
        } as ApiResponse);
      }

      // Determine output directory
      const outputDirectory = simulation.output_file_path 
        ? path.dirname(simulation.output_file_path)
        : path.join(process.cwd(), 'app_data', 'projects', simulation.project_id.toString(), 'output', simulationId.toString());

      // Parse simulation results
      const results = await resultAnalysisService.parseSimulationResults(
        simulationId,
        simulation.project_id,
        outputDirectory
      );

      // Prepare component IDs array
      let componentIdsArray: string[] | undefined;
      if (componentIds) {
        componentIdsArray = Array.isArray(componentIds) ? componentIds : [componentIds];
      }

      // Prepare chart data
      const chartData = resultAnalysisService.prepareChartData(
        results,
        dataType as any,
        componentIdsArray
      );

      res.json({
        data: chartData
      } as ApiResponse<ChartData>);

    } catch (error: any) {
      logger.error('Error getting chart data:', error);
      res.status(500).json({
        error: {
          message: 'Failed to get chart data',
          code: 'CHART_DATA_ERROR',
          details: error.message
        }
      } as ApiResponse);
    }
  });

  /**
   * Compare multiple simulations
   */
  router.post('/simulations/compare', async (req, res) => {
    try {
      const { simulationIds } = req.body;
      
      if (!Array.isArray(simulationIds) || simulationIds.length < 2) {
        return res.status(400).json({
          error: {
            message: 'At least 2 simulation IDs are required for comparison',
            code: 'INSUFFICIENT_SIMULATIONS'
          }
        } as ApiResponse);
      }

      const results: SimulationResults[] = [];

      // Get results for each simulation
      for (const simulationId of simulationIds) {
        const simulation = await dbManager.getSimulation(simulationId);
        if (!simulation) {
          return res.status(404).json({
            error: {
              message: `Simulation ${simulationId} not found`,
              code: 'SIMULATION_NOT_FOUND'
            }
          } as ApiResponse);
        }

        if (simulation.status !== 'completed') {
          return res.status(400).json({
            error: {
              message: `Simulation ${simulationId} is not completed`,
              code: 'SIMULATION_NOT_COMPLETED'
            }
          } as ApiResponse);
        }

        // Determine output directory
        const outputDirectory = simulation.output_file_path 
          ? path.dirname(simulation.output_file_path)
          : path.join(process.cwd(), 'app_data', 'projects', simulation.project_id.toString(), 'output', simulationId.toString());

        // Parse simulation results
        const simulationResults = await resultAnalysisService.parseSimulationResults(
          simulationId,
          simulation.project_id,
          outputDirectory
        );

        results.push(simulationResults);
      }

      // Compare simulations
      const comparison = resultAnalysisService.compareSimulations(results);

      res.json({
        data: {
          simulations: results.map(r => ({
            id: r.metadata.simulationId,
            projectId: r.metadata.projectId,
            statistics: r.statistics,
            metadata: r.metadata
          })),
          comparison: comparison.comparison,
          recommendations: comparison.recommendations
        }
      } as ApiResponse);

    } catch (error: any) {
      logger.error('Error comparing simulations:', error);
      res.status(500).json({
        error: {
          message: 'Failed to compare simulations',
          code: 'COMPARISON_ERROR',
          details: error.message
        }
      } as ApiResponse);
    }
  });

  /**
   * Get available components for a simulation
   */
  router.get('/simulations/:id/components', async (req, res) => {
    try {
      const simulationId = parseInt(req.params.id);
      
      if (isNaN(simulationId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid simulation ID',
            code: 'INVALID_SIMULATION_ID'
          }
        } as ApiResponse);
      }

      // Get simulation from database
      const simulation = await dbManager.getSimulation(simulationId);
      if (!simulation) {
        return res.status(404).json({
          error: {
            message: 'Simulation not found',
            code: 'SIMULATION_NOT_FOUND'
          }
        } as ApiResponse);
      }

      if (simulation.status !== 'completed') {
        return res.status(400).json({
          error: {
            message: 'Simulation is not completed',
            code: 'SIMULATION_NOT_COMPLETED'
          }
        } as ApiResponse);
      }

      // Determine output directory
      const outputDirectory = simulation.output_file_path 
        ? path.dirname(simulation.output_file_path)
        : path.join(process.cwd(), 'app_data', 'projects', simulation.project_id.toString(), 'output', simulationId.toString());

      // Parse simulation results
      const results = await resultAnalysisService.parseSimulationResults(
        simulationId,
        simulation.project_id,
        outputDirectory
      );

      // Extract component information
      const components = results.components.map(component => ({
        id: component.componentId,
        type: component.componentType,
        availableData: {
          pressure: !!component.pressure,
          temperature: !!component.temperature,
          velocity: !!component.velocity,
          massFlow: !!component.massFlow,
          density: !!component.density
        }
      }));

      res.json({
        data: {
          components,
          globalData: {
            engineTorque: !!results.globalData.engineTorque,
            enginePower: !!results.globalData.enginePower,
            fuelConsumption: !!results.globalData.fuelConsumption,
            airFlow: !!results.globalData.airFlow,
            exhaustTemperature: !!results.globalData.exhaustTemperature
          }
        }
      } as ApiResponse);

    } catch (error: any) {
      logger.error('Error getting simulation components:', error);
      res.status(500).json({
        error: {
          message: 'Failed to get simulation components',
          code: 'COMPONENTS_FETCH_ERROR',
          details: error.message
        }
      } as ApiResponse);
    }
  });

  /**
   * Export simulation results in various formats
   */
  router.get('/simulations/:id/export', async (req, res) => {
    try {
      const simulationId = parseInt(req.params.id);
      const format = req.query.format as string || 'json';
      
      if (isNaN(simulationId)) {
        return res.status(400).json({
          error: {
            message: 'Invalid simulation ID',
            code: 'INVALID_SIMULATION_ID'
          }
        } as ApiResponse);
      }

      // Validate format
      const validFormats = ['json', 'csv', 'xlsx'];
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          error: {
            message: `Invalid format. Must be one of: ${validFormats.join(', ')}`,
            code: 'INVALID_FORMAT'
          }
        } as ApiResponse);
      }

      // Get simulation from database
      const simulation = await dbManager.getSimulation(simulationId);
      if (!simulation) {
        return res.status(404).json({
          error: {
            message: 'Simulation not found',
            code: 'SIMULATION_NOT_FOUND'
          }
        } as ApiResponse);
      }

      if (simulation.status !== 'completed') {
        return res.status(400).json({
          error: {
            message: 'Simulation is not completed',
            code: 'SIMULATION_NOT_COMPLETED'
          }
        } as ApiResponse);
      }

      // Determine output directory
      const outputDirectory = simulation.output_file_path 
        ? path.dirname(simulation.output_file_path)
        : path.join(process.cwd(), 'app_data', 'projects', simulation.project_id.toString(), 'output', simulationId.toString());

      // Parse simulation results
      const results = await resultAnalysisService.parseSimulationResults(
        simulationId,
        simulation.project_id,
        outputDirectory
      );

      // Set appropriate headers based on format
      const filename = `simulation_${simulationId}_results.${format}`;
      
      switch (format) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.json(results);
          break;
          
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          
          // Convert to CSV format (simplified)
          let csvContent = 'Component,Type,Time,Pressure,Temperature,Velocity\n';
          
          results.components.forEach(component => {
            const timeData = component.pressure?.time || component.temperature?.time || component.velocity?.time || [];
            const pressureData = component.pressure?.values || [];
            const temperatureData = component.temperature?.values || [];
            const velocityData = component.velocity?.values || [];
            
            for (let i = 0; i < timeData.length; i++) {
              csvContent += `${component.componentId},${component.componentType},${timeData[i] || ''},${pressureData[i] || ''},${temperatureData[i] || ''},${velocityData[i] || ''}\n`;
            }
          });
          
          res.send(csvContent);
          break;
          
        default:
          return res.status(400).json({
            error: {
              message: 'Format not implemented yet',
              code: 'FORMAT_NOT_IMPLEMENTED'
            }
          } as ApiResponse);
      }

    } catch (error: any) {
      logger.error('Error exporting simulation results:', error);
      res.status(500).json({
        error: {
          message: 'Failed to export simulation results',
          code: 'EXPORT_ERROR',
          details: error.message
        }
      } as ApiResponse);
    }
  });

  return router;
}
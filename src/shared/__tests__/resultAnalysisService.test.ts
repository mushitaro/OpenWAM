import { ResultAnalysisService } from '../services/resultAnalysisService';
import fs from 'fs/promises';
import path from 'path';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('ResultAnalysisService', () => {
  let service: ResultAnalysisService;
  const mockOutputDirectory = '/test/output';
  const mockSimulationId = 1;
  const mockProjectId = 1;

  beforeEach(() => {
    service = new ResultAnalysisService();
    jest.clearAllMocks();
  });

  describe('parseSimulationResults', () => {
    it('should parse CSV results correctly', async () => {
      // Mock file system
      mockFs.readdir.mockResolvedValue(['results.csv', 'log.txt'] as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
      
      // Mock CSV content
      const csvContent = `Time,Pipe1_Pressure,Pipe1_Temperature,Pipe1_Velocity
0.0,101325,293.15,10.5
0.1,102000,295.20,12.3
0.2,103500,298.50,15.1`;
      
      mockFs.readFile.mockImplementation((filePath: any) => {
        if (filePath.includes('results.csv')) {
          return Promise.resolve(csvContent);
        }
        if (filePath.includes('log.txt')) {
          return Promise.resolve('Engine speed: 2000 rpm\nCycles: 100');
        }
        return Promise.resolve('');
      });

      const results = await service.parseSimulationResults(
        mockSimulationId,
        mockProjectId,
        mockOutputDirectory
      );

      expect(results).toBeDefined();
      expect(results.metadata.simulationId).toBe(mockSimulationId);
      expect(results.metadata.projectId).toBe(mockProjectId);
      expect(results.metadata.engineSpeed).toBe(2000);
      expect(results.components).toHaveLength(1);
      expect(results.components[0].componentId).toBe('Pipe1');
      expect(results.components[0].pressure?.values).toEqual([101325, 102000, 103500]);
      expect(results.components[0].temperature?.values).toEqual([293.15, 295.20, 298.50]);
      expect(results.components[0].velocity?.values).toEqual([10.5, 12.3, 15.1]);
      expect(results.globalData.time).toEqual([0.0, 0.1, 0.2]);
    });

    it('should handle empty output directory', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const results = await service.parseSimulationResults(
        mockSimulationId,
        mockProjectId,
        mockOutputDirectory
      );

      expect(results).toBeDefined();
      expect(results.components).toHaveLength(0);
      expect(results.globalData.time).toHaveLength(0);
    });

    it('should handle file read errors gracefully', async () => {
      mockFs.readdir.mockResolvedValue(['results.csv'] as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true } as any);
      mockFs.readFile.mockRejectedValue(new Error('File read error'));

      const results = await service.parseSimulationResults(
        mockSimulationId,
        mockProjectId,
        mockOutputDirectory
      );

      expect(results).toBeDefined();
      expect(results.components).toHaveLength(0);
    });
  });

  describe('prepareChartData', () => {
    it('should prepare chart data for pressure visualization', () => {
      const mockResults = {
        metadata: {
          simulationId: 1,
          projectId: 1,
          startTime: new Date()
        },
        components: [
          {
            componentId: 'Pipe1',
            componentType: 'pipe',
            pressure: {
              time: [0, 0.1, 0.2],
              values: [101325, 102000, 103500],
              unit: 'Pa',
              label: 'Pipe1_Pressure'
            }
          },
          {
            componentId: 'Pipe2',
            componentType: 'pipe',
            pressure: {
              time: [0, 0.1, 0.2],
              values: [101000, 101500, 102000],
              unit: 'Pa',
              label: 'Pipe2_Pressure'
            }
          }
        ],
        globalData: {
          time: [0, 0.1, 0.2]
        },
        statistics: {}
      };

      const chartData = service.prepareChartData(mockResults, 'pressure');

      expect(chartData.datasets).toHaveLength(2);
      expect(chartData.datasets[0].label).toBe('Pipe1 Pressure');
      expect(chartData.datasets[0].data).toEqual([
        { x: 0, y: 101325 },
        { x: 0.1, y: 102000 },
        { x: 0.2, y: 103500 }
      ]);
      expect(chartData.datasets[1].label).toBe('Pipe2 Pressure');
      expect(chartData.xAxis.label).toBe('Time');
      expect(chartData.yAxis.label).toBe('Pressure');
      expect(chartData.yAxis.unit).toBe('Pa');
    });

    it('should filter components by componentIds', () => {
      const mockResults = {
        metadata: {
          simulationId: 1,
          projectId: 1,
          startTime: new Date()
        },
        components: [
          {
            componentId: 'Pipe1',
            componentType: 'pipe',
            pressure: {
              time: [0, 0.1, 0.2],
              values: [101325, 102000, 103500],
              unit: 'Pa',
              label: 'Pipe1_Pressure'
            }
          },
          {
            componentId: 'Pipe2',
            componentType: 'pipe',
            pressure: {
              time: [0, 0.1, 0.2],
              values: [101000, 101500, 102000],
              unit: 'Pa',
              label: 'Pipe2_Pressure'
            }
          }
        ],
        globalData: {
          time: [0, 0.1, 0.2]
        },
        statistics: {}
      };

      const chartData = service.prepareChartData(mockResults, 'pressure', ['Pipe1']);

      expect(chartData.datasets).toHaveLength(1);
      expect(chartData.datasets[0].label).toBe('Pipe1 Pressure');
    });
  });

  describe('compareSimulations', () => {
    it('should compare multiple simulation results', () => {
      const mockResults = [
        {
          metadata: { simulationId: 1, projectId: 1, startTime: new Date() },
          components: [],
          globalData: { time: [] },
          statistics: { maxTorque: 150, maxPower: 75000, maxPressure: 200000 }
        },
        {
          metadata: { simulationId: 2, projectId: 1, startTime: new Date() },
          components: [],
          globalData: { time: [] },
          statistics: { maxTorque: 160, maxPower: 80000, maxPressure: 210000 }
        }
      ];

      const comparison = service.compareSimulations(mockResults);

      expect(comparison.comparison.maxTorque).toEqual({ 1: 150, 2: 160 });
      expect(comparison.comparison.maxPower).toEqual({ 1: 75000, 2: 80000 });
      expect(comparison.comparison.maxPressure).toEqual({ 1: 200000, 2: 210000 });
      expect(comparison.recommendations).toContain('Simulation 2 achieved the highest torque (160.00 Nm)');
    });
  });
});
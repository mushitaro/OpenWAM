import { SimulationService } from '../services/simulationService';
import { DatabaseManager } from '../database/DatabaseManager';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';

// Mock the child_process module
jest.mock('child_process');
jest.mock('fs/promises');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('SimulationService', () => {
  let simulationService: SimulationService;
  let mockDbManager: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDbManager = {
      updateSimulation: jest.fn(),
      getSimulation: jest.fn(),
    } as any;

    simulationService = new SimulationService(mockDbManager);
  });

  afterEach(async () => {
    await simulationService.shutdown();
  });

  describe('constructor', () => {
    it('should initialize with database manager', () => {
      expect(simulationService).toBeInstanceOf(SimulationService);
    });

    it('should set up event emitter', () => {
      expect(simulationService.on).toBeDefined();
      expect(simulationService.emit).toBeDefined();
    });
  });

  describe('getRunningSimulations', () => {
    it('should return empty array when no simulations are running', () => {
      const running = simulationService.getRunningSimulations();
      expect(running).toEqual([]);
    });
  });

  describe('isSimulationRunning', () => {
    it('should return false for non-existent simulation', () => {
      const isRunning = simulationService.isSimulationRunning(123);
      expect(isRunning).toBe(false);
    });
  });

  describe('startSimulation', () => {
    const mockConfig = {
      id: 1,
      projectId: 1,
      inputFilePath: '/test/input.wam',
      outputDirectory: '/test/output',
      timeout: 30000
    };

    let mockProcess: any;

    beforeEach(() => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(['result.csv', 'output.dat']);
      mockDbManager.updateSimulation.mockResolvedValue({} as any);

      // Create a mock process with EventEmitter
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      
      mockSpawn.mockReturnValue(mockProcess as any);
    });

    it('should throw error if simulation is already running', async () => {
      // Start first simulation (don't await to keep it running)
      const startPromise = simulationService.startSimulation(mockConfig);
      
      // Wait a bit for the simulation to be registered as running
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Try to start same simulation again
      await expect(simulationService.startSimulation(mockConfig))
        .rejects.toThrow('Simulation 1 is already running');
      
      // Clean up
      mockProcess.emit('close', 0, null);
    });

    it('should throw error if input file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      
      await expect(simulationService.startSimulation(mockConfig))
        .rejects.toThrow('Input file not found: /test/input.wam');
    });

    it('should update simulation status to running', async () => {
      simulationService.startSimulation(mockConfig);
      
      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockDbManager.updateSimulation).toHaveBeenCalledWith(1, {
        status: 'running',
        progress: 0
      });
      
      // Clean up
      mockProcess.emit('close', 0, null);
    });
  });

  describe('stopSimulation', () => {
    it('should throw error if simulation is not running', async () => {
      await expect(simulationService.stopSimulation(123))
        .rejects.toThrow('Simulation 123 is not running');
    });
  });

  describe('parseProgress', () => {
    it('should parse progress from various output formats', () => {
      const service = simulationService as any;
      
      // Test percentage patterns
      expect(service.parseProgress('Progress: 45.5%')).toBe(46);
      expect(service.parseProgress('Completed: 75%')).toBe(75);
      expect(service.parseProgress('25% complete')).toBe(25);
      
      // Test cycle patterns
      expect(service.parseProgress('Cycle 50 of 100')).toBe(50);
      
      // Test time patterns
      expect(service.parseProgress('Time: 0.5 / 1.0')).toBe(50);
      
      // Test no match
      expect(service.parseProgress('Random output')).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should clean up resources', async () => {
      await simulationService.shutdown();
      expect(simulationService.getRunningSimulations()).toEqual([]);
    });
  });
});
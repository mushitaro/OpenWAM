/**
 * Tests for OpenWAM File Service
 */

import { OpenWAMFileService } from '../services/openWAMFileService';
import { OpenWAMParser } from '../parsers/openWAMParser';
import { OpenWAMGenerator } from '../generators/openWAMGenerator';
import { ComponentType, EngineModel } from '../types/openWAMComponents';

// Mock the parser and generator
jest.mock('../parsers/openWAMParser');
jest.mock('../generators/openWAMGenerator');

describe('OpenWAMFileService', () => {
  let fileService: OpenWAMFileService;
  let mockParser: jest.Mocked<OpenWAMParser>;
  let mockGenerator: jest.Mocked<OpenWAMGenerator>;

  beforeEach(() => {
    mockParser = new OpenWAMParser() as jest.Mocked<OpenWAMParser>;
    mockGenerator = new OpenWAMGenerator() as jest.Mocked<OpenWAMGenerator>;
    fileService = new OpenWAMFileService(mockParser, mockGenerator);
  });

  describe('parseWAMFile', () => {
    test('should parse valid WAM file content', async () => {
      const wamContent = `2200
0
0.1 1.0
101325 293
1 1
0
0
1 1 0
0
1
1 1 2 10 1 1.0 0.1
1 0
1.0 0.05
1 1.0 1.0
0.002 7800 460 50
293 0
293 101325 0
1
0.002 7800 460 50
0
0
0
0
0
0
0
0
0
0`;

      const expectedModel: EngineModel = {
        components: [
          {
            id: 'pipe-1',
            type: ComponentType.PIPE,
            position: { x: 100, y: 100 },
            rotation: 0,
            properties: {
              numeroTubo: 1,
              nodoIzq: 1,
              nodoDer: 2,
              nin: 10
            }
          }
        ],
        connections: [],
        metadata: {
          name: 'Parsed Model',
          description: 'Model parsed from WAM file',
          created: expect.any(Date),
          modified: expect.any(Date),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      mockParser.parseWAMContent.mockResolvedValue(expectedModel);

      const result = await fileService.parseWAMFile(wamContent);

      expect(mockParser.parseWAMContent).toHaveBeenCalledWith(wamContent);
      expect(result).toEqual(expectedModel);
    });

    test('should handle parsing errors', async () => {
      const invalidContent = 'invalid wam content';
      
      mockParser.parseWAMContent.mockRejectedValue(new Error('Invalid WAM format'));

      await expect(fileService.parseWAMFile(invalidContent))
        .rejects.toThrow('Invalid WAM format');
    });

    test('should validate WAM file format', async () => {
      const invalidContent = 'not a wam file';
      
      const result = fileService.validateWAMFormat(invalidContent);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid WAM file format');
    });

    test('should validate correct WAM file format', async () => {
      const validContent = `2200
0
0.1 1.0`;
      
      const result = fileService.validateWAMFormat(validContent);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('generateWAMFile', () => {
    test('should generate WAM file from model', async () => {
      const model: EngineModel = {
        components: [
          {
            id: 'pipe-1',
            type: ComponentType.PIPE,
            position: { x: 100, y: 100 },
            rotation: 0,
            properties: {
              numeroTubo: 1,
              nodoIzq: 1,
              nodoDer: 2,
              nin: 10,
              longitudTotal: 1.0,
              mallado: 0.1
            }
          }
        ],
        connections: [],
        metadata: {
          name: 'Test Model',
          description: 'Test model for generation',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      const expectedWAMContent = `2200
0
0.1 1.0
101325 293
1 1
0
0
1 1 0
0
1
1 1 2 10 1 1.0 0.1
1 0
1.0 0.05
1 1.0 1.0
0.002 7800 460 50
293 0
293 101325 0
1
0.002 7800 460 50
0
0
0
0
0
0
0
0
0
0`;

      mockGenerator.generateWAMContent.mockReturnValue(expectedWAMContent);

      const result = await fileService.generateWAMFile(model);

      expect(mockGenerator.generateWAMContent).toHaveBeenCalledWith(model);
      expect(result).toBe(expectedWAMContent);
    });

    test('should handle generation errors', async () => {
      const invalidModel = {} as EngineModel;
      
      mockGenerator.generateWAMContent.mockImplementation(() => {
        throw new Error('Invalid model structure');
      });

      await expect(fileService.generateWAMFile(invalidModel))
        .rejects.toThrow('Invalid model structure');
    });
  });

  describe('convertModelToWAM', () => {
    test('should convert visual model to WAM format', async () => {
      const visualModel: EngineModel = {
        components: [
          {
            id: 'pipe-1',
            type: ComponentType.PIPE,
            position: { x: 200, y: 200 },
            rotation: 0,
            properties: {
              numeroTubo: 1,
              longitudTotal: 1.5,
              nin: 15
            }
          },
          {
            id: 'atm-1',
            type: ComponentType.OPEN_END_ATMOSPHERE,
            position: { x: 100, y: 200 },
            rotation: 0,
            properties: {
              numeroCC: 1,
              tipoCC: 0
            }
          }
        ],
        connections: [
          {
            id: 'conn-1',
            fromComponent: 'atm-1',
            fromPort: 'connection',
            toComponent: 'pipe-1',
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Visual Model',
          description: 'Model created in visual editor',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      const expectedWAMContent = 'generated wam content';
      mockGenerator.generateWAMContent.mockReturnValue(expectedWAMContent);

      const result = await fileService.convertModelToWAM(visualModel);

      expect(result).toBe(expectedWAMContent);
      expect(mockGenerator.generateWAMContent).toHaveBeenCalledWith(visualModel);
    });
  });

  describe('convertWAMToModel', () => {
    test('should convert WAM content to visual model', async () => {
      const wamContent = 'wam file content';
      const expectedModel: EngineModel = {
        components: [],
        connections: [],
        metadata: {
          name: 'Imported Model',
          description: 'Model imported from WAM file',
          created: expect.any(Date),
          modified: expect.any(Date),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      mockParser.parseWAMContent.mockResolvedValue(expectedModel);

      const result = await fileService.convertWAMToModel(wamContent);

      expect(result).toEqual(expectedModel);
      expect(mockParser.parseWAMContent).toHaveBeenCalledWith(wamContent);
    });
  });

  describe('validateModelForExport', () => {
    test('should validate model before export', () => {
      const validModel: EngineModel = {
        components: [
          {
            id: 'pipe-1',
            type: ComponentType.PIPE,
            position: { x: 100, y: 100 },
            rotation: 0,
            properties: {
              numeroTubo: 1,
              nodoIzq: 1,
              nodoDer: 2
            }
          }
        ],
        connections: [],
        metadata: {
          name: 'Valid Model',
          description: 'Valid model for export',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      const result = fileService.validateModelForExport(validModel);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should detect invalid model for export', () => {
      const invalidModel: EngineModel = {
        components: [], // Empty model
        connections: [],
        metadata: {
          name: 'Invalid Model',
          description: 'Invalid model for export',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: false,
          errors: []
        }
      };

      const result = fileService.validateModelForExport(invalidModel);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Model has no components');
    });
  });

  describe('getFileMetadata', () => {
    test('should extract metadata from WAM file', () => {
      const wamContent = `2200
0
0.1 1.0
101325 293`;

      const metadata = fileService.getFileMetadata(wamContent);

      expect(metadata.version).toBe('2200');
      expect(metadata.hasEngine).toBe(false);
      expect(metadata.angleIncrement).toBe(0.1);
      expect(metadata.simulationDuration).toBe(1.0);
    });
  });
});
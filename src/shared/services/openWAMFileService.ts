/**
 * OpenWAM File Service
 * Provides high-level interface for OpenWAM file generation and parsing
 */

import { EngineModel, ComponentType } from '../types/openWAMComponents';
import { OpenWAMGenerator, OpenWAMGenerationConfig } from '../generators/openWAMGenerator';
import { OpenWAMParser, ParsedOpenWAMData } from '../parsers/openWAMParser';

/**
 * File operation result
 */
export interface FileOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}

/**
 * OpenWAM file validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  version?: number;
  componentCounts?: {
    pipes: number;
    plenums: number;
    valves: number;
    boundaries: number;
    compressors: number;
  };
}

/**
 * OpenWAM File Service
 * Handles all OpenWAM file operations including generation, parsing, and validation
 */
export class OpenWAMFileService {
  private generator: OpenWAMGenerator;
  private parser: OpenWAMParser;

  constructor(config?: Partial<OpenWAMGenerationConfig>) {
    this.generator = new OpenWAMGenerator(config);
    this.parser = new OpenWAMParser();
  }

  /**
   * Generate OpenWAM input file from engine model
   */
  generateInputFile(model: EngineModel, config?: Partial<OpenWAMGenerationConfig>): FileOperationResult<string> {
    try {
      // Validate model before generation
      const validation = this.validateEngineModel(model);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Model validation failed: ${validation.errors.join(', ')}`
        };
      }

      // Create generator with updated config if provided
      const generator = config ? new OpenWAMGenerator(config) : this.generator;
      
      // Generate file content
      const content = generator.generateInputFile(model);

      return {
        success: true,
        data: content,
        warnings: validation.warnings
      };
    } catch (error) {
      return {
        success: false,
        error: `Generation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Parse OpenWAM file and convert to engine model
   */
  parseInputFile(content: string): FileOperationResult<EngineModel> {
    try {
      // Validate file format first
      const validation = this.validateFileFormat(content);
      if (!validation.isValid) {
        return {
          success: false,
          error: `File validation failed: ${validation.errors.join(', ')}`
        };
      }

      // Parse file content
      const parsedData = this.parser.parseFile(content);

      // Convert to engine model
      const model = this.parser.convertToEngineModel(parsedData);

      return {
        success: true,
        data: model,
        warnings: validation.warnings
      };
    } catch (error) {
      return {
        success: false,
        error: `Parsing failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Validate WAM file content (public method for file upload validation)
   */
  validateWAMFile(content: string): { isValid: boolean; errors: string[] } {
    const validation = this.validateFileFormat(content);
    return {
      isValid: validation.isValid,
      errors: validation.errors
    };
  }

  /**
   * Validate OpenWAM file format
   */
  validateFileFormat(content: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      if (lines.length < 2) {
        result.isValid = false;
        result.errors.push('File is too short - missing header information');
        return result;
      }

      // Check version
      const version = parseInt(lines[0]);
      if (isNaN(version) || version < 2000 || version > 3000) {
        result.isValid = false;
        result.errors.push(`Invalid OpenWAM version: ${lines[0]}`);
      } else {
        result.version = version;
        if (version !== 2200) {
          result.warnings.push(`OpenWAM version ${version} may not be fully supported`);
        }
      }

      // Check independence flag
      const independent = parseInt(lines[1]);
      if (isNaN(independent) || (independent !== 0 && independent !== 1)) {
        result.isValid = false;
        result.errors.push(`Invalid independence flag: ${lines[1]}`);
      }

      // Basic structure validation
      if (lines.length < 10) {
        result.warnings.push('File appears to be incomplete or very simple');
      }

      // Try to parse component counts
      try {
        const parsedData = this.parser.parseFile(content);
        result.componentCounts = {
          pipes: parsedData.pipes.length,
          plenums: parsedData.plenums.length,
          valves: parsedData.valves.length,
          boundaries: parsedData.boundaries.length,
          compressors: parsedData.compressors.length
        };

        // Validate component counts
        if (parsedData.pipes.length === 0) {
          result.warnings.push('No pipes found in model');
        }
        if (parsedData.boundaries.length === 0) {
          result.warnings.push('No boundary conditions found in model');
        }
      } catch (error) {
        result.warnings.push('Could not fully parse component structure');
      }

    } catch (error) {
      result.isValid = false;
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Validate engine model before generation
   */
  validateEngineModel(model: EngineModel): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Check if model has components
    if (!model.components || model.components.length === 0) {
      result.isValid = false;
      result.errors.push('Model has no components');
      return result;
    }

    // Check for required component types
    const componentTypes = model.components.map(c => c.type);
    const hasPipes = componentTypes.some(type => type.includes('TTubo'));
    const hasBoundaries = componentTypes.some(type => type.includes('TCC'));

    if (!hasPipes) {
      result.warnings.push('Model has no pipe components');
    }

    if (!hasBoundaries) {
      result.warnings.push('Model has no boundary conditions');
    }

    // Validate component properties
    for (const component of model.components) {
      if (!component.id || !component.type || !component.properties) {
        result.errors.push(`Component ${component.id || 'unknown'} is missing required properties`);
        result.isValid = false;
      }

      // Validate position
      if (!component.position || typeof component.position.x !== 'number' || typeof component.position.y !== 'number') {
        result.warnings.push(`Component ${component.id} has invalid position`);
      }
    }

    // Validate connections
    if (model.connections) {
      for (const connection of model.connections) {
        if (!connection.fromComponent || !connection.toComponent) {
          result.errors.push(`Connection ${connection.id} is missing component references`);
          result.isValid = false;
        }

        // Check if referenced components exist
        const fromExists = model.components.some(c => c.id === connection.fromComponent);
        const toExists = model.components.some(c => c.id === connection.toComponent);

        if (!fromExists) {
          result.errors.push(`Connection ${connection.id} references non-existent component: ${connection.fromComponent}`);
          result.isValid = false;
        }

        if (!toExists) {
          result.errors.push(`Connection ${connection.id} references non-existent component: ${connection.toComponent}`);
          result.isValid = false;
        }
      }
    }

    // Count components for validation
    result.componentCounts = {
      pipes: model.components.filter(c => c.type.includes('TTubo')).length,
      plenums: model.components.filter(c => c.type.includes('TDep') || c.type.includes('TTurbina') || c.type.includes('TVenturi')).length,
      valves: model.components.filter(c => c.type.includes('TValvula') || c.type.includes('TCD') || c.type.includes('TLamina')).length,
      boundaries: model.components.filter(c => c.type.includes('TCC')).length,
      compressors: model.components.filter(c => c.type.includes('TCompresor')).length
    };

    return result;
  }

  /**
   * Get file statistics from parsed data
   */
  getFileStatistics(data: ParsedOpenWAMData): {
    version: number;
    independent: boolean;
    componentCounts: {
      pipes: number;
      plenums: number;
      valves: number;
      boundaries: number;
      compressors: number;
      sensors: number;
      controllers: number;
    };
    hasEngine: boolean;
    hasDPF: boolean;
    hasConcentric: boolean;
    hasDLL: boolean;
  } {
    return {
      version: data.version,
      independent: data.independent,
      componentCounts: {
        pipes: data.pipes.length,
        plenums: data.plenums.length,
        valves: data.valves.length,
        boundaries: data.boundaries.length,
        compressors: data.compressors.length,
        sensors: data.sensors.length,
        controllers: data.controllers.length
      },
      hasEngine: data.generalData.hasEngine,
      hasDPF: data.dpfs.length > 0,
      hasConcentric: data.concentrics.length > 0,
      hasDLL: data.hasDLL
    };
  }

  /**
   * Create a simple test model for validation
   */
  createTestModel(): EngineModel {
    return {
      components: [
        {
          id: 'pipe_1',
          type: ComponentType.PIPE,
          position: { x: 100, y: 100 },
          rotation: 0,
          properties: {
            id: 'pipe_1',
            numeroTubo: 1,
            nodoIzq: 1,
            nodoDer: 2,
            nin: 10,
            longitudTotal: 1.0,
            mallado: 0.1,
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
            tipRefrig: 'air' as const,
            tini: 293.15,
            pini: 101325,
            velMedia: 0,
            lTramo: [1.0],
            dExtTramo: [0.05],
            numCapas: 1,
            capas: [{
              esPrincipal: true,
              esFluida: false,
              density: 7800,
              calorEspecifico: 460,
              conductividad: 50,
              espesor: 0.005,
              emisividadInterior: 0.8,
              emisividadExterior: 0.8
            }]
          }
        },
        {
          id: 'boundary_1',
          type: ComponentType.OPEN_END_ATMOSPHERE,
          position: { x: 300, y: 100 },
          rotation: 0,
          properties: {
            id: 'boundary_1',
            tipoCC: 0,
            numeroCC: 1
          }
        }
      ],
      connections: [],
      metadata: {
        name: 'Test Model',
        description: 'Simple test model for validation',
        created: new Date(),
        modified: new Date(),
        version: '1.0'
      },
      validationResult: {
        isValid: true,
        errors: [],
        warnings: []
      }
    };
  }

  /**
   * Update generator configuration
   */
  updateConfig(config: Partial<OpenWAMGenerationConfig>): void {
    this.generator = new OpenWAMGenerator(config);
  }
}

// Export singleton instance
export const openWAMFileService = new OpenWAMFileService();
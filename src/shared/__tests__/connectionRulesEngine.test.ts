/**
 * Tests for Advanced Connection Rules Engine
 */

import {
  ComponentType,
  ModelComponent,
  EngineModel,
  Connection
} from '../types/openWAMComponents';

import {
  AdvancedConnectionRulesEngine,
  NodeSystemValidator,
  CircularReferenceDetector,
  DuplicateConnectionDetector,
  createAdvancedRulesEngine,
  validateModelWithAdvancedRules
} from '../validation/connectionRulesEngine';

import { createComponent } from '../components/componentLibrary';

describe('Advanced Connection Rules Engine', () => {
  let engine: AdvancedConnectionRulesEngine;
  let pipeComponent1: ModelComponent;
  let pipeComponent2: ModelComponent;
  let atmosphereComponent: ModelComponent;
  let plenumComponent: ModelComponent;

  beforeEach(() => {
    engine = createAdvancedRulesEngine();
    
    pipeComponent1 = createComponent(
      ComponentType.PIPE,
      'pipe-1',
      { x: 100, y: 100 }
    )!;
    
    pipeComponent2 = createComponent(
      ComponentType.PIPE,
      'pipe-2',
      { x: 200, y: 100 }
    )!;
    
    // Set different node numbers for pipe 2
    (pipeComponent2.properties as any).numeroTubo = 2;
    (pipeComponent2.properties as any).nodoIzq = 2;
    (pipeComponent2.properties as any).nodoDer = 3;

    atmosphereComponent = createComponent(
      ComponentType.OPEN_END_ATMOSPHERE,
      'atmosphere-1',
      { x: 50, y: 100 }
    )!;

    plenumComponent = createComponent(
      ComponentType.CONSTANT_VOLUME_PLENUM,
      'plenum-1',
      { x: 300, y: 100 }
    )!;
  });

  describe('Basic Connection Validation', () => {
    test('should validate allowed pipe to atmosphere connection', () => {
      const result = engine.validateConnection(
        pipeComponent1,
        'left',
        atmosphereComponent,
        'connection'
      );

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should validate allowed pipe to plenum connection', () => {
      const result = engine.validateConnection(
        pipeComponent1,
        'right',
        plenumComponent,
        'inlet'
      );

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should reject forbidden plenum to plenum connection', () => {
      const plenum2 = createComponent(
        ComponentType.CONSTANT_VOLUME_PLENUM,
        'plenum-2',
        { x: 400, y: 100 }
      )!;

      const result = engine.validateConnection(
        plenumComponent,
        'inlet',
        plenum2,
        'inlet'
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject connection with no rule', () => {
      // Try to connect atmosphere to atmosphere (no rule exists)
      const atmosphere2 = createComponent(
        ComponentType.OPEN_END_ATMOSPHERE,
        'atmosphere-2',
        { x: 400, y: 100 }
      )!;

      const result = engine.validateConnection(
        atmosphereComponent,
        'connection',
        atmosphere2,
        'connection'
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Node System Validation', () => {
    let nodeValidator: NodeSystemValidator;

    beforeEach(() => {
      nodeValidator = new NodeSystemValidator();
    });

    test('should validate proper node system', () => {
      const model: EngineModel = {
        components: [pipeComponent1, pipeComponent2, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: pipeComponent2.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Test Model',
          description: 'Test model for node validation',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = nodeValidator.validateNodeSystem(model);
      expect(errors.filter(e => e.severity === 'error').length).toBe(0);
    });

    test('should detect duplicate node numbers in same component', () => {
      // Create pipe with same left and right node
      const invalidPipe = createComponent(
        ComponentType.PIPE,
        'invalid-pipe',
        { x: 100, y: 100 }
      )!;
      (invalidPipe.properties as any).nodoIzq = 1;
      (invalidPipe.properties as any).nodoDer = 1; // Same as left node

      const model: EngineModel = {
        components: [invalidPipe],
        connections: [],
        metadata: {
          name: 'Invalid Model',
          description: 'Model with invalid node configuration',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = nodeValidator.validateNodeSystem(model);
      expect(errors.filter(e => e.severity === 'error').length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('same node number'))).toBe(true);
    });

    test('should detect too many connections per node', () => {
      // Create multiple pipes sharing the same node (more than 3)
      const pipes: ModelComponent[] = [];
      for (let i = 0; i < 5; i++) {
        const pipe = createComponent(
          ComponentType.PIPE,
          `pipe-${i}`,
          { x: 100 + i * 50, y: 100 }
        )!;
        (pipe.properties as any).numeroTubo = i + 1;
        (pipe.properties as any).nodoIzq = 1; // All share node 1
        (pipe.properties as any).nodoDer = i + 2;
        pipes.push(pipe);
      }

      const model: EngineModel = {
        components: pipes,
        connections: [],
        metadata: {
          name: 'Overcrowded Node Model',
          description: 'Model with too many connections per node',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = nodeValidator.validateNodeSystem(model);
      expect(errors.filter(e => e.severity === 'error').length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('maximum 3 connections'))).toBe(true);
    });
  });

  describe('Circular Reference Detection', () => {
    let circularDetector: CircularReferenceDetector;

    beforeEach(() => {
      circularDetector = new CircularReferenceDetector();
    });

    test('should detect circular references', () => {
      const model: EngineModel = {
        components: [pipeComponent1, pipeComponent2],
        connections: [
          {
            id: 'conn-1',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: pipeComponent2.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: pipeComponent2.id,
            fromPort: 'right',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Circular Model',
          description: 'Model with circular references',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = circularDetector.detectCircularReferences(model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('Circular reference'))).toBe(true);
    });

    test('should not detect false positives in linear connections', () => {
      const model: EngineModel = {
        components: [pipeComponent1, pipeComponent2, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: pipeComponent2.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Linear Model',
          description: 'Model with linear connections',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = circularDetector.detectCircularReferences(model);
      expect(errors.length).toBe(0);
    });
  });

  describe('Duplicate Connection Detection', () => {
    let duplicateDetector: DuplicateConnectionDetector;

    beforeEach(() => {
      duplicateDetector = new DuplicateConnectionDetector();
    });

    test('should detect duplicate connections', () => {
      const model: EngineModel = {
        components: [pipeComponent1, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Duplicate Model',
          description: 'Model with duplicate connections',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = duplicateDetector.detectDuplicateConnections(model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('Duplicate connection'))).toBe(true);
    });

    test('should not detect false positives for different connections', () => {
      const model: EngineModel = {
        components: [pipeComponent1, pipeComponent2, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: pipeComponent2.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Unique Model',
          description: 'Model with unique connections',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const errors = duplicateDetector.detectDuplicateConnections(model);
      expect(errors.length).toBe(0);
    });
  });

  describe('Complete Model Validation', () => {
    test('should validate complete valid model', () => {
      const model: EngineModel = {
        components: [pipeComponent1, atmosphereComponent, plenumComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          },
          {
            id: 'conn-2',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: plenumComponent.id,
            toPort: 'inlet',
            isValid: true
          }
        ],
        metadata: {
          name: 'Valid Complete Model',
          description: 'Complete valid model',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const result = engine.validateModel(model);
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should detect empty model', () => {
      const emptyModel: EngineModel = {
        components: [],
        connections: [],
        metadata: {
          name: 'Empty Model',
          description: 'Empty model',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const result = engine.validateModel(emptyModel);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Model is empty'))).toBe(true);
    });

    test('should detect pipes without boundary conditions', () => {
      const model: EngineModel = {
        components: [pipeComponent1, pipeComponent2],
        connections: [
          {
            id: 'conn-1',
            fromComponent: pipeComponent1.id,
            fromPort: 'right',
            toComponent: pipeComponent2.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'No Boundary Model',
          description: 'Model without boundary conditions',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const result = engine.validateModel(model);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.message.includes('no boundary conditions'))).toBe(true);
    });
  });

  describe('Utility Functions', () => {
    test('should create advanced rules engine', () => {
      const newEngine = createAdvancedRulesEngine();
      expect(newEngine).toBeInstanceOf(AdvancedConnectionRulesEngine);
    });

    test('should validate model with utility function', () => {
      const model: EngineModel = {
        components: [pipeComponent1, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent1.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Utility Test Model',
          description: 'Model for utility function test',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: { isValid: true, errors: [] }
      };

      const result = validateModelWithAdvancedRules(model);
      expect(result).toBeDefined();
      expect(typeof result.isValid).toBe('boolean');
    });
  });
});
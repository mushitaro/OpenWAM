/**
 * Tests for OpenWAM Component System
 */

import {
  ComponentType,
  ComponentCategory,
  BoundaryConditionType,
  ValveType,
  PlenumType,
  ModelComponent,
  EngineModel
} from '../types/openWAMComponents';

import {
  componentLibrary,
  getComponent,
  createComponent,
  canConnect
} from '../components/componentLibrary';

import {
  createValidator,
  validateConnection,
  validateModel
} from '../validation/componentValidator';

describe('OpenWAM Component System', () => {
  
  describe('Component Library', () => {
    test('should have component definitions', () => {
      expect(componentLibrary.components.length).toBeGreaterThan(0);
    });

    test('should get pipe component definition', () => {
      const pipeComponent = getComponent(ComponentType.PIPE);
      expect(pipeComponent).toBeDefined();
      expect(pipeComponent?.type).toBe(ComponentType.PIPE);
      expect(pipeComponent?.category).toBe(ComponentCategory.PIPES);
      expect(pipeComponent?.openWAMClass).toBe('TTubo');
    });

    test('should get plenum component definition', () => {
      const plenumComponent = getComponent(ComponentType.CONSTANT_VOLUME_PLENUM);
      expect(plenumComponent).toBeDefined();
      expect(plenumComponent?.type).toBe(ComponentType.CONSTANT_VOLUME_PLENUM);
      expect(plenumComponent?.category).toBe(ComponentCategory.PLENUMS);
      expect(plenumComponent?.openWAMClass).toBe('TDepVolCte');
    });

    test('should create component instance', () => {
      const component = createComponent(
        ComponentType.PIPE,
        'test-pipe-1',
        { x: 100, y: 100 }
      );

      expect(component).toBeDefined();
      expect(component?.id).toBe('test-pipe-1');
      expect(component?.type).toBe(ComponentType.PIPE);
      expect(component?.position).toEqual({ x: 100, y: 100 });
      expect(component?.properties).toBeDefined();
    });

    test('should check component compatibility', () => {
      // Pipe to atmosphere should be allowed
      const canConnectPipeToAtmosphere = canConnect(
        ComponentType.PIPE,
        'left',
        ComponentType.OPEN_END_ATMOSPHERE,
        'connection'
      );
      expect(canConnectPipeToAtmosphere).toBe(true);

      // Pipe to plenum should be allowed
      const canConnectPipeToPlenum = canConnect(
        ComponentType.PIPE,
        'right',
        ComponentType.CONSTANT_VOLUME_PLENUM,
        'inlet'
      );
      expect(canConnectPipeToPlenum).toBe(true);
    });

    test('should search components', () => {
      const searchResults = componentLibrary.searchComponents('pipe');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults.some(c => c.type === ComponentType.PIPE)).toBe(true);
    });

    test('should get components by category', () => {
      const pipeComponents = componentLibrary.getComponentsByCategory(ComponentCategory.PIPES);
      expect(pipeComponents.length).toBeGreaterThan(0);
      expect(pipeComponents.every(c => c.category === ComponentCategory.PIPES)).toBe(true);
    });
  });

  describe('Component Validation', () => {
    let validator: ReturnType<typeof createValidator>;
    let pipeComponent: ModelComponent;
    let atmosphereComponent: ModelComponent;

    beforeEach(() => {
      validator = createValidator();
      
      pipeComponent = createComponent(
        ComponentType.PIPE,
        'test-pipe',
        { x: 100, y: 100 }
      )!;

      atmosphereComponent = createComponent(
        ComponentType.OPEN_END_ATMOSPHERE,
        'test-atmosphere',
        { x: 50, y: 100 }
      )!;
    });

    test('should validate valid connection', () => {
      const result = validateConnection(
        atmosphereComponent,
        'connection',
        pipeComponent,
        'left'
      );

      if (!result.isValid) {
        console.log('Validation errors:', result.errors);
      }

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should validate component properties', () => {
      const result = validator.validateComponentProperties(pipeComponent);
      expect(result.length).toBe(0); // No errors expected for default properties
    });

    test('should detect invalid property values', () => {
      // Create component with invalid properties
      const invalidComponent: ModelComponent = {
        ...pipeComponent,
        properties: {
          ...pipeComponent.properties,
          nin: -5 // Invalid: negative number of cells
        }
      };

      const result = validator.validateComponentProperties(invalidComponent);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(error => error.message.includes('nin'))).toBe(true);
    });

    test('should validate complete model', () => {
      const model: EngineModel = {
        components: [pipeComponent, atmosphereComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Test Model',
          description: 'Test model for validation',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      const result = validateModel(model);
      
      if (!result.isValid) {
        console.log('Model validation errors:', result.errors);
      }
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should detect isolated components', () => {
      const isolatedComponent = createComponent(
        ComponentType.CONSTANT_VOLUME_PLENUM,
        'isolated-plenum',
        { x: 200, y: 200 }
      )!;

      const model: EngineModel = {
        components: [pipeComponent, atmosphereComponent, isolatedComponent],
        connections: [
          {
            id: 'conn-1',
            fromComponent: atmosphereComponent.id,
            fromPort: 'connection',
            toComponent: pipeComponent.id,
            toPort: 'left',
            isValid: true
          }
        ],
        metadata: {
          name: 'Test Model with Isolation',
          description: 'Test model with isolated component',
          created: new Date(),
          modified: new Date(),
          version: '1.0'
        },
        validationResult: {
          isValid: true,
          errors: []
        }
      };

      const result = validateModel(model);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings!.some(w => w.type === 'isolation')).toBe(true);
    });
  });

  describe('Component Types and Enums', () => {
    test('should have correct boundary condition types', () => {
      expect(BoundaryConditionType.OPEN_END_ATMOSPHERE).toBe(0);
      expect(BoundaryConditionType.CLOSED_END).toBe(3);
      expect(BoundaryConditionType.PIPE_TO_PLENUM_CONNECTION).toBe(11);
    });

    test('should have correct valve types', () => {
      expect(ValveType.FIXED_CD).toBe(0);
      expect(ValveType.VALVE_4T).toBe(1);
      expect(ValveType.REED_VALVE).toBe(2);
      expect(ValveType.WASTEGATE).toBe(6);
    });

    test('should have correct plenum types', () => {
      expect(PlenumType.CONSTANT_VOLUME).toBe(0);
      expect(PlenumType.VARIABLE_VOLUME).toBe(1);
      expect(PlenumType.SIMPLE_TURBINE).toBe(2);
    });
  });

  describe('VANOS Control Components', () => {
    test('should get sensor component definition', () => {
      const sensorComponent = getComponent(ComponentType.SENSOR);
      expect(sensorComponent).toBeDefined();
      expect(sensorComponent?.type).toBe(ComponentType.SENSOR);
      expect(sensorComponent?.category).toBe(ComponentCategory.CONTROL);
      expect(sensorComponent?.openWAMClass).toBe('TSensor');
      expect(sensorComponent?.name).toBe('Sensor');
    });

    test('should get table1D component definition', () => {
      const tableComponent = getComponent(ComponentType.TABLE_1D);
      expect(tableComponent).toBeDefined();
      expect(tableComponent?.type).toBe(ComponentType.TABLE_1D);
      expect(tableComponent?.category).toBe(ComponentCategory.CONTROL);
      expect(tableComponent?.openWAMClass).toBe('TTable1D');
      expect(tableComponent?.name).toBe('1D Table');
    });

    test('should get controller component definition', () => {
      const controllerComponent = getComponent(ComponentType.CONTROLLER);
      expect(controllerComponent).toBeDefined();
      expect(controllerComponent?.type).toBe(ComponentType.CONTROLLER);
      expect(controllerComponent?.category).toBe(ComponentCategory.CONTROL);
      expect(controllerComponent?.openWAMClass).toBe('TController');
      expect(controllerComponent?.name).toBe('Controller');
    });

    test('should get PID controller component definition', () => {
      const pidComponent = getComponent(ComponentType.PID_CONTROLLER);
      expect(pidComponent).toBeDefined();
      expect(pidComponent?.type).toBe(ComponentType.PID_CONTROLLER);
      expect(pidComponent?.category).toBe(ComponentCategory.CONTROL);
      expect(pidComponent?.openWAMClass).toBe('TPIDController');
      expect(pidComponent?.name).toBe('PID Controller');
    });

    test('should get control valve component definition', () => {
      const valveComponent = getComponent(ComponentType.CONTROL_VALVE);
      expect(valveComponent).toBeDefined();
      expect(valveComponent?.type).toBe(ComponentType.CONTROL_VALVE);
      expect(valveComponent?.category).toBe(ComponentCategory.VALVES);
      expect(valveComponent?.openWAMClass).toBe('TValvulaContr');
      expect(valveComponent?.name).toBe('Control Valve');
    });

    test('should get pipe-to-plenum connection definition', () => {
      const connectionComponent = getComponent(ComponentType.PIPE_TO_PLENUM);
      expect(connectionComponent).toBeDefined();
      expect(connectionComponent?.type).toBe(ComponentType.PIPE_TO_PLENUM);
      expect(connectionComponent?.category).toBe(ComponentCategory.BOUNDARIES);
      expect(connectionComponent?.openWAMClass).toBe('TCCDeposito');
      expect(connectionComponent?.name).toBe('Pipe-to-Plenum Connection');
    });

    test('should create VANOS control components', () => {
      const sensor = createComponent(
        ComponentType.SENSOR,
        'cam-sensor-1',
        { x: 100, y: 100 }
      );
      expect(sensor).toBeDefined();
      expect(sensor?.properties).toHaveProperty('numeroSensor');
      expect(sensor?.properties).toHaveProperty('tipoSensor');

      const table = createComponent(
        ComponentType.TABLE_1D,
        'vanos-map-1',
        { x: 200, y: 100 }
      );
      expect(table).toBeDefined();
      expect(table?.properties).toHaveProperty('numeroTabla');
      expect(table?.properties).toHaveProperty('datosX');
      expect(table?.properties).toHaveProperty('datosY');

      const controller = createComponent(
        ComponentType.CONTROLLER,
        'vanos-controller-1',
        { x: 300, y: 100 }
      );
      expect(controller).toBeDefined();
      expect(controller?.properties).toHaveProperty('numeroController');
      expect(controller?.properties).toHaveProperty('tipoController');

      const pid = createComponent(
        ComponentType.PID_CONTROLLER,
        'pid-1',
        { x: 400, y: 100 }
      );
      expect(pid).toBeDefined();
      expect(pid?.properties).toHaveProperty('numeroPID');
      expect(pid?.properties).toHaveProperty('kp');
      expect(pid?.properties).toHaveProperty('ki');
      expect(pid?.properties).toHaveProperty('kd');

      const valve = createComponent(
        ComponentType.CONTROL_VALVE,
        'vanos-valve-1',
        { x: 500, y: 100 }
      );
      expect(valve).toBeDefined();
      expect(valve?.properties).toHaveProperty('numeroValvula');
      expect(valve?.properties).toHaveProperty('tipoValvulaControl');
    });

    test('should validate VANOS control loop connections', () => {
      // Test sensor to controller connection
      const canConnectSensorToController = canConnect(
        ComponentType.SENSOR,
        'output',
        ComponentType.CONTROLLER,
        'sensor_input'
      );
      expect(canConnectSensorToController).toBe(true);

      // Test table to controller connection
      const canConnectTableToController = canConnect(
        ComponentType.TABLE_1D,
        'output',
        ComponentType.CONTROLLER,
        'table_input'
      );
      expect(canConnectTableToController).toBe(true);

      // Test controller to PID connection
      const canConnectControllerToPID = canConnect(
        ComponentType.CONTROLLER,
        'pid_output',
        ComponentType.PID_CONTROLLER,
        'setpoint'
      );
      expect(canConnectControllerToPID).toBe(true);

      // Test PID to control valve connection
      const canConnectPIDToValve = canConnect(
        ComponentType.PID_CONTROLLER,
        'output',
        ComponentType.CONTROL_VALVE,
        'control_input'
      );
      expect(canConnectPIDToValve).toBe(true);

      // Test pipe to plenum connection
      const canConnectPipeToPlenumConnection = canConnect(
        ComponentType.PIPE,
        'right',
        ComponentType.PIPE_TO_PLENUM,
        'pipe_connection'
      );
      expect(canConnectPipeToPlenumConnection).toBe(true);
    });

    test('should get control components by category', () => {
      const controlComponents = componentLibrary.getComponentsByCategory(ComponentCategory.CONTROL);
      expect(controlComponents.length).toBeGreaterThanOrEqual(4); // At least sensor, table, controller, PID
      
      const componentTypes = controlComponents.map(c => c.type);
      expect(componentTypes).toContain(ComponentType.SENSOR);
      expect(componentTypes).toContain(ComponentType.TABLE_1D);
      expect(componentTypes).toContain(ComponentType.CONTROLLER);
      expect(componentTypes).toContain(ComponentType.PID_CONTROLLER);
    });
  });

  describe('Model Templates', () => {
    test('should have predefined templates', () => {
      expect(componentLibrary.templates.length).toBeGreaterThan(0);
    });

    test('should get template by ID', () => {
      const template = componentLibrary.getTemplate('simple-pipe');
      expect(template).toBeDefined();
      expect(template?.name).toBe('Simple Pipe');
    });

    test('should get template categories', () => {
      const categories = componentLibrary.getTemplateCategories();
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.includes('Basic')).toBe(true);
    });
  });
});
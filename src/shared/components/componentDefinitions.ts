/**
 * OpenWAM Component Definitions
 * Based on actual OpenWAM source code analysis
 */

import {
  ComponentDefinition,
  ComponentType,
  ComponentCategory,
  BoundaryConditionType,
  ValveType,
  PlenumType,
  EngineType,
  HeatTransferType,
  MeshType,
  PropertySchema,
  PipeProperties,
  PlenumProperties,
  ValveProperties,
  BoundaryProperties,
  EngineProperties,
  SensorProperties,
  SensorType,
  Table1DProperties,
  TableType,
  InterpolationType,
  ExtrapolationType,
  ControllerProperties,
  ControllerType,
  OperationMode,
  PIDControllerProperties,
  AntiWindupMode,
  ControlValveProperties,
  ControlValveType,
  FlowCharacteristic,
  ActuatorType,
  FeedbackSensorType,
  PipeToPlenumProperties,
  ConnectionType,
  ConnectionRule
} from '../types/openWAMComponents';

// ============================================================================
// PROPERTY SCHEMAS
// ============================================================================

/**
 * Property schema for pipe components (TTubo)
 */
const pipePropertySchema: PropertySchema = {
  numeroTubo: {
    type: 'number',
    label: 'Pipe Number',
    description: 'Unique pipe identifier',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
    defaultValue: 1
  },
  nodoIzq: {
    type: 'number',
    label: 'Left Node',
    description: 'Left boundary node number',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Node number must be positive' }],
    defaultValue: 1
  },
  nodoDer: {
    type: 'number',
    label: 'Right Node',
    description: 'Right boundary node number',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Node number must be positive' }],
    defaultValue: 2
  },
  nin: {
    type: 'number',
    label: 'Number of Cells',
    description: 'Number of calculation cells',
    unit: '',
    required: true,
    validation: [
      { type: 'min', value: 3, message: 'Minimum 3 cells required' },
      { type: 'max', value: 1000, message: 'Maximum 1000 cells allowed' }
    ],
    defaultValue: 10
  },
  longitudTotal: {
    type: 'number',
    label: 'Total Length',
    description: 'Total pipe length',
    unit: 'm',
    required: true,
    validation: [{ type: 'min', value: 0.001, message: 'Length must be positive' }],
    defaultValue: 1.0
  },
  mallado: {
    type: 'number',
    label: 'Mesh Size',
    description: 'Mesh size for calculation',
    unit: 'm',
    required: true,
    validation: [{ type: 'min', value: 0.0001, message: 'Mesh size must be positive' }],
    defaultValue: 0.1
  },
  nTramos: {
    type: 'number',
    label: 'Number of Sections',
    description: 'Number of pipe sections',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'At least 1 section required' }],
    defaultValue: 1
  },
  tipoMallado: {
    type: 'select',
    label: 'Mesh Type',
    description: 'Type of mesh calculation',
    unit: '',
    required: true,
    validation: [],
    defaultValue: MeshType.DISTANCE,
    options: [
      { value: MeshType.DISTANCE, label: 'Distance Based' },
      { value: MeshType.ANGULAR, label: 'Angular Based' }
    ]
  },
  friccion: {
    type: 'number',
    label: 'Friction Factor',
    description: 'Pipe friction factor',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 0, message: 'Friction factor must be non-negative' }],
    defaultValue: 0.02
  },
  tipoTransCal: {
    type: 'select',
    label: 'Heat Transfer Type',
    description: 'Type of heat transfer calculation',
    unit: '',
    required: true,
    validation: [],
    defaultValue: HeatTransferType.EXHAUST_TUBE,
    options: [
      { value: HeatTransferType.INTAKE_PIPE, label: 'Intake Pipe' },
      { value: HeatTransferType.INTAKE_TUBE, label: 'Intake Tube' },
      { value: HeatTransferType.EXHAUST_TUBE, label: 'Exhaust Tube' },
      { value: HeatTransferType.EXHAUST_PIPE, label: 'Exhaust Pipe' }
    ]
  },
  coefAjusFric: {
    type: 'number',
    label: 'Friction Adjustment Coefficient',
    description: 'Friction adjustment coefficient',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 0.1, message: 'Coefficient must be positive' }],
    defaultValue: 1.0
  },
  coefAjusTC: {
    type: 'number',
    label: 'Heat Transfer Adjustment Coefficient',
    description: 'Heat transfer adjustment coefficient',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 0.1, message: 'Coefficient must be positive' }],
    defaultValue: 1.0
  },
  espesorPrin: {
    type: 'number',
    label: 'Wall Thickness',
    description: 'Principal wall thickness',
    unit: 'm',
    required: true,
    validation: [{ type: 'min', value: 0.0001, message: 'Thickness must be positive' }],
    defaultValue: 0.002
  },
  densidadPrin: {
    type: 'number',
    label: 'Wall Density',
    description: 'Principal wall material density',
    unit: 'kg/m³',
    required: true,
    validation: [{ type: 'min', value: 100, message: 'Density must be positive' }],
    defaultValue: 7800
  },
  calEspPrin: {
    type: 'number',
    label: 'Specific Heat',
    description: 'Principal wall material specific heat',
    unit: 'J/(kg·K)',
    required: true,
    validation: [{ type: 'min', value: 100, message: 'Specific heat must be positive' }],
    defaultValue: 460
  },
  conductPrin: {
    type: 'number',
    label: 'Thermal Conductivity',
    description: 'Principal wall material thermal conductivity',
    unit: 'W/(m·K)',
    required: true,
    validation: [{ type: 'min', value: 0.1, message: 'Conductivity must be positive' }],
    defaultValue: 50
  },
  tRefrigerante: {
    type: 'number',
    label: 'Coolant Temperature',
    description: 'Coolant temperature',
    unit: 'K',
    required: true,
    validation: [{ type: 'min', value: 273, message: 'Temperature must be above 0°C' }],
    defaultValue: 353
  },
  tipRefrig: {
    type: 'select',
    label: 'Coolant Type',
    description: 'Type of coolant',
    unit: '',
    required: true,
    validation: [],
    defaultValue: 'air',
    options: [
      { value: 'air', label: 'Air' },
      { value: 'water', label: 'Water' }
    ]
  },
  tini: {
    type: 'number',
    label: 'Initial Temperature',
    description: 'Initial gas temperature',
    unit: 'K',
    required: true,
    validation: [{ type: 'min', value: 273, message: 'Temperature must be above 0°C' }],
    defaultValue: 300
  },
  pini: {
    type: 'number',
    label: 'Initial Pressure',
    description: 'Initial gas pressure',
    unit: 'bar',
    required: true,
    validation: [{ type: 'min', value: 0.1, message: 'Pressure must be positive' }],
    defaultValue: 1.0
  },
  velMedia: {
    type: 'number',
    label: 'Average Velocity',
    description: 'Initial average gas velocity',
    unit: 'm/s',
    required: true,
    validation: [],
    defaultValue: 0.0
  }
};

/**
 * Property schema for plenum components
 */
const plenumPropertySchema: PropertySchema = {
  numeroDeposito: {
    type: 'number',
    label: 'Plenum Number',
    description: 'Unique plenum identifier',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Plenum number must be positive' }],
    defaultValue: 1
  },
  volumen0: {
    type: 'number',
    label: 'Volume',
    description: 'Plenum volume',
    unit: 'm³',
    required: true,
    validation: [{ type: 'min', value: 0.0001, message: 'Volume must be positive' }],
    defaultValue: 0.001
  },
  tipoDeposito: {
    type: 'select',
    label: 'Plenum Type',
    description: 'Type of plenum',
    unit: '',
    required: true,
    validation: [],
    defaultValue: PlenumType.CONSTANT_VOLUME,
    options: [
      { value: PlenumType.CONSTANT_VOLUME, label: 'Constant Volume' },
      { value: PlenumType.VARIABLE_VOLUME, label: 'Variable Volume' },
      { value: PlenumType.SIMPLE_TURBINE, label: 'Simple Turbine' },
      { value: PlenumType.TWIN_TURBINE, label: 'Twin Turbine' },
      { value: PlenumType.VENTURI, label: 'Venturi' },
      { value: PlenumType.DIRECTIONAL_UNION, label: 'Directional Union' }
    ]
  },
  temperature: {
    type: 'number',
    label: 'Initial Temperature',
    description: 'Initial gas temperature',
    unit: 'K',
    required: true,
    validation: [{ type: 'min', value: 273, message: 'Temperature must be above 0°C' }],
    defaultValue: 300
  },
  pressure: {
    type: 'number',
    label: 'Initial Pressure',
    description: 'Initial gas pressure',
    unit: 'bar',
    required: true,
    validation: [{ type: 'min', value: 0.1, message: 'Pressure must be positive' }],
    defaultValue: 1.0
  },
  masa0: {
    type: 'number',
    label: 'Initial Mass',
    description: 'Initial gas mass',
    unit: 'kg',
    required: true,
    validation: [{ type: 'min', value: 0.00001, message: 'Mass must be positive' }],
    defaultValue: 0.001
  }
};

/**
 * Property schema for valve components
 */
const valvePropertySchema: PropertySchema = {
  tipoValvula: {
    type: 'select',
    label: 'Valve Type',
    description: 'Type of valve',
    unit: '',
    required: true,
    validation: [],
    defaultValue: ValveType.FIXED_CD,
    options: [
      { value: ValveType.FIXED_CD, label: 'Fixed CD' },
      { value: ValveType.VALVE_4T, label: '4T Valve' },
      { value: ValveType.REED_VALVE, label: 'Reed Valve' },
      { value: ValveType.ROTARY_DISC, label: 'Rotary Disc' },
      { value: ValveType.PORT_2T, label: '2T Port' },
      { value: ValveType.CONTROL_VALVE, label: 'Control Valve' },
      { value: ValveType.WASTEGATE, label: 'Wastegate' },
      { value: ValveType.TURBINE_STATOR, label: 'Turbine Stator' },
      { value: ValveType.TURBINE_ROTOR, label: 'Turbine Rotor' },
      { value: ValveType.EXTERNAL_CALC, label: 'External Calculation' },
      { value: ValveType.BUTTERFLY_VALVE, label: 'Butterfly Valve' }
    ]
  },
  tubo: {
    type: 'number',
    label: 'Pipe Number',
    description: 'Connected pipe number',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
    defaultValue: 1
  },
  nodo: {
    type: 'number',
    label: 'Node Number',
    description: 'Connection node number',
    unit: '',
    required: true,
    validation: [{ type: 'min', value: 1, message: 'Node number must be positive' }],
    defaultValue: 1
  },
  diametroTubo: {
    type: 'number',
    label: 'Pipe Diameter',
    description: 'Connected pipe diameter',
    unit: 'm',
    required: true,
    validation: [{ type: 'min', value: 0.001, message: 'Diameter must be positive' }],
    defaultValue: 0.05
  }
};

// ============================================================================
// COMPONENT DEFINITIONS
// ============================================================================

/**
 * Pipe component definition (TTubo)
 */
export const pipeDefinition: ComponentDefinition = {
  type: ComponentType.PIPE,
  category: ComponentCategory.PIPES,
  name: 'Pipe',
  description: '1D pipe for gas flow simulation',
  icon: 'pipe-icon',
  nodes: [
    {
      id: 'left',
      name: 'Left End',
      type: 'left',
      position: { x: 0, y: 50 },
      nodeNumber: 1,
      allowedConnections: [],
      maxConnections: 1
    },
    {
      id: 'right',
      name: 'Right End',
      type: 'right',
      position: { x: 100, y: 50 },
      nodeNumber: 2,
      allowedConnections: [],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroTubo: 1,
    nodoIzq: 1,
    nodoDer: 2,
    nin: 10,
    longitudTotal: 1.0,
    mallado: 0.1,
    nTramos: 1,
    tipoMallado: MeshType.DISTANCE,
    friccion: 0.02,
    tipoTransCal: HeatTransferType.EXHAUST_TUBE,
    coefAjusFric: 1.0,
    coefAjusTC: 1.0,
    espesorPrin: 0.002,
    densidadPrin: 7800,
    calEspPrin: 460,
    conductPrin: 50,
    tRefrigerante: 353,
    tipRefrig: 'air',
    tini: 300,
    pini: 1.0,
    velMedia: 0.0,
    lTramo: [1.0],
    dExtTramo: [0.05],
    numCapas: 1,
    capas: [{
      esPrincipal: true,
      esFluida: false,
      density: 7800,
      calorEspecifico: 460,
      conductividad: 50,
      espesor: 0.002,
      emisividadInterior: 0.8,
      emisividadExterior: 0.8
    }]
  } as PipeProperties,
  propertySchema: pipePropertySchema,
  size: { width: 100, height: 20 },
  openWAMClass: 'TTubo'
};

/**
 * Constant volume plenum definition (TDepVolCte)
 */
export const constantVolumePlenumDefinition: ComponentDefinition = {
  type: ComponentType.CONSTANT_VOLUME_PLENUM,
  category: ComponentCategory.PLENUMS,
  name: 'Constant Volume Plenum',
  description: 'Constant volume plenum for pressure wave calculations',
  icon: 'plenum-icon',
  nodes: [
    {
      id: 'inlet',
      name: 'Inlet',
      type: 'inlet',
      position: { x: 25, y: 0 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 10
    }
  ],
  defaultProperties: {
    id: '',
    numeroDeposito: 1,
    volumen0: 0.001,
    tipoDeposito: PlenumType.CONSTANT_VOLUME,
    temperature: 300,
    pressure: 1.0,
    masa0: 0.001
  } as PlenumProperties,
  propertySchema: plenumPropertySchema,
  size: { width: 50, height: 50 },
  openWAMClass: 'TDepVolCte'
};

/**
 * Fixed CD valve definition (TCDFijo)
 */
export const fixedCDValveDefinition: ComponentDefinition = {
  type: ComponentType.FIXED_CD_VALVE,
  category: ComponentCategory.VALVES,
  name: 'Fixed CD Valve',
  description: 'Fixed discharge coefficient valve',
  icon: 'valve-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'bidirectional',
      position: { x: 25, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE, ComponentType.CONSTANT_VOLUME_PLENUM],
      maxConnections: 2
    }
  ],
  defaultProperties: {
    id: '',
    tipoValvula: ValveType.FIXED_CD,
    tubo: 1,
    nodo: 1,
    tipo: 0,
    valvula: 1,
    sentido: 0,
    diametroTubo: 0.05
  } as ValveProperties,
  propertySchema: valvePropertySchema,
  size: { width: 30, height: 30 },
  openWAMClass: 'TCDFijo'
};

/**
 * Open end atmosphere boundary condition (TCCDescargaExtremoAbierto)
 */
export const openEndAtmosphereDefinition: ComponentDefinition = {
  type: ComponentType.OPEN_END_ATMOSPHERE,
  category: ComponentCategory.BOUNDARIES,
  name: 'Open End (Atmosphere)',
  description: 'Open end boundary condition to atmosphere',
  icon: 'atmosphere-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'inlet',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    tipoCC: BoundaryConditionType.OPEN_END_ATMOSPHERE,
    numeroCC: 1
  } as BoundaryProperties,
  propertySchema: {
    tipoCC: {
      type: 'select',
      label: 'Boundary Type',
      description: 'Type of boundary condition',
      unit: '',
      required: true,
      validation: [],
      defaultValue: BoundaryConditionType.OPEN_END_ATMOSPHERE,
      options: [
        { value: BoundaryConditionType.OPEN_END_ATMOSPHERE, label: 'Open End (Atmosphere)' },
        { value: BoundaryConditionType.OPEN_END_RESERVOIR, label: 'Open End (Reservoir)' }
      ]
    }
  },
  size: { width: 40, height: 40 },
  openWAMClass: 'TCCDescargaExtremoAbierto'
};

/**
 * Closed end boundary condition (TCCExtremoCerrado)
 */
export const closedEndDefinition: ComponentDefinition = {
  type: ComponentType.CLOSED_END,
  category: ComponentCategory.BOUNDARIES,
  name: 'Closed End',
  description: 'Closed end boundary condition - reflects all pressure waves back',
  icon: 'closed-end-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'inlet',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    tipoCC: BoundaryConditionType.CLOSED_END,
    numeroCC: 1
  } as BoundaryProperties,
  propertySchema: {
    tipoCC: {
      type: 'select',
      label: 'Boundary Type',
      description: 'Type of boundary condition',
      unit: '',
      required: true,
      validation: [],
      defaultValue: BoundaryConditionType.CLOSED_END,
      options: [
        { value: BoundaryConditionType.CLOSED_END, label: 'Closed End' }
      ]
    }
  },
  size: { width: 40, height: 40 },
  openWAMClass: 'TCCExtremoCerrado'
};

/**
 * Anechoic end boundary condition (TCCExtremoAnecoico)
 */
export const anechoicEndDefinition: ComponentDefinition = {
  type: ComponentType.ANECHOIC_END,
  category: ComponentCategory.BOUNDARIES,
  name: 'Anechoic End',
  description: 'Anechoic (non-reflecting) end boundary condition - absorbs all pressure waves',
  icon: 'anechoic-end-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'inlet',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    tipoCC: BoundaryConditionType.ANECHOIC_END,
    numeroCC: 1
  } as BoundaryProperties,
  propertySchema: {
    tipoCC: {
      type: 'select',
      label: 'Boundary Type',
      description: 'Type of boundary condition',
      unit: '',
      required: true,
      validation: [],
      defaultValue: BoundaryConditionType.ANECHOIC_END,
      options: [
        { value: BoundaryConditionType.ANECHOIC_END, label: 'Anechoic End' }
      ]
    }
  },
  size: { width: 40, height: 40 },
  openWAMClass: 'TCCExtremoAnecoico'
};

/**
 * Branch boundary condition (TCCRamificacion)
 */
export const branchDefinition: ComponentDefinition = {
  type: ComponentType.BRANCH,
  category: ComponentCategory.BOUNDARIES,
  name: 'Branch',
  description: 'Branch connection for splitting or joining pipe flows',
  icon: 'branch-icon',
  nodes: [
    {
      id: 'main',
      name: 'Main',
      type: 'bidirectional',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'branch1',
      name: 'Branch 1',
      type: 'bidirectional',
      position: { x: 50, y: 10 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'branch2',
      name: 'Branch 2',
      type: 'bidirectional',
      position: { x: 50, y: 40 },
      nodeNumber: 3,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    tipoCC: BoundaryConditionType.BRANCH,
    numeroCC: 1,
    tubo1: 1,
    tubo2: 2,
    tubo3: 3,
    extremo1: 1,
    extremo2: 0,
    extremo3: 0
  } as BoundaryProperties,
  propertySchema: {
    tipoCC: {
      type: 'select',
      label: 'Boundary Type',
      description: 'Type of boundary condition',
      unit: '',
      required: true,
      validation: [],
      defaultValue: BoundaryConditionType.BRANCH,
      options: [
        { value: BoundaryConditionType.BRANCH, label: 'Branch' }
      ]
    },
    tubo1: {
      type: 'number',
      label: 'Main Pipe Number',
      description: 'Main pipe number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
      defaultValue: 1
    },
    tubo2: {
      type: 'number',
      label: 'Branch Pipe 1 Number',
      description: 'First branch pipe number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
      defaultValue: 2
    },
    tubo3: {
      type: 'number',
      label: 'Branch Pipe 2 Number',
      description: 'Second branch pipe number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
      defaultValue: 3
    }
  },
  size: { width: 50, height: 50 },
  openWAMClass: 'TCCRamificacion'
};

/**
 * Variable volume plenum definition (TDepVolVariable)
 */
export const variableVolumePlenumDefinition: ComponentDefinition = {
  type: ComponentType.VARIABLE_VOLUME_PLENUM,
  category: ComponentCategory.PLENUMS,
  name: 'Variable Volume Plenum',
  description: 'Variable volume plenum with time-dependent volume changes',
  icon: 'variable-plenum-icon',
  nodes: [
    {
      id: 'inlet',
      name: 'Inlet',
      type: 'inlet',
      position: { x: 25, y: 0 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 10
    }
  ],
  defaultProperties: {
    id: '',
    numeroDeposito: 1,
    volumen0: 0.001,
    tipoDeposito: PlenumType.VARIABLE_VOLUME,
    temperature: 300,
    pressure: 1.0,
    masa0: 0.001,
    volumeFunction: 'constant'
  } as PlenumProperties,
  propertySchema: {
    ...plenumPropertySchema,
    volumeFunction: {
      type: 'select',
      label: 'Volume Function',
      description: 'Type of volume variation',
      unit: '',
      required: true,
      validation: [],
      defaultValue: 'constant',
      options: [
        { value: 'constant', label: 'Constant' },
        { value: 'sinusoidal', label: 'Sinusoidal' },
        { value: 'table', label: 'Table-based' }
      ]
    }
  },
  size: { width: 50, height: 50 },
  openWAMClass: 'TDepVolVariable'
};

/**
 * Simple turbine definition (TTurbinaSimple)
 */
export const simpleTurbineDefinition: ComponentDefinition = {
  type: ComponentType.SIMPLE_TURBINE,
  category: ComponentCategory.PLENUMS,
  name: 'Simple Turbine',
  description: 'Simple turbine model for turbocharger applications',
  icon: 'turbine-icon',
  nodes: [
    {
      id: 'inlet',
      name: 'Inlet',
      type: 'inlet',
      position: { x: 10, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'outlet',
      name: 'Outlet',
      type: 'outlet',
      position: { x: 40, y: 25 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroDeposito: 1,
    volumen0: 0.0001,
    tipoDeposito: PlenumType.SIMPLE_TURBINE,
    temperature: 800,
    pressure: 2.0,
    masa0: 0.0001,
    turbineNumber: 1,
    efficiency: 0.75,
    mapFile: ''
  } as PlenumProperties,
  propertySchema: {
    ...plenumPropertySchema,
    turbineNumber: {
      type: 'number',
      label: 'Turbine Number',
      description: 'Turbine identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Turbine number must be positive' }],
      defaultValue: 1
    },
    efficiency: {
      type: 'number',
      label: 'Efficiency',
      description: 'Turbine efficiency',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 0.1, message: 'Efficiency must be positive' },
        { type: 'max', value: 1.0, message: 'Efficiency cannot exceed 1.0' }
      ],
      defaultValue: 0.75
    }
  },
  size: { width: 50, height: 50 },
  openWAMClass: 'TTurbinaSimple'
};

/**
 * 4T Valve definition (TValvula4T)
 */
export const valve4TDefinition: ComponentDefinition = {
  type: ComponentType.VALVE_4T,
  category: ComponentCategory.VALVES,
  name: '4T Valve',
  description: '4-stroke engine valve with cam-driven opening/closing',
  icon: '4t-valve-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'bidirectional',
      position: { x: 25, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE, ComponentType.CONSTANT_VOLUME_PLENUM],
      maxConnections: 2
    }
  ],
  defaultProperties: {
    id: '',
    tipoValvula: ValveType.VALVE_4T,
    tubo: 1,
    nodo: 1,
    tipo: 0,
    valvula: 1,
    sentido: 0,
    diametroTubo: 0.05,
    diametroValvula: 0.03,
    alzadaMaxima: 0.01,
    anguloApertura: -20,
    anguloCierre: 60,
    cdTubVol: 0.6,
    cdVolTub: 0.6
  } as ValveProperties,
  propertySchema: {
    ...valvePropertySchema,
    diametroValvula: {
      type: 'number',
      label: 'Valve Diameter',
      description: 'Valve head diameter',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Diameter must be positive' }],
      defaultValue: 0.03
    },
    alzadaMaxima: {
      type: 'number',
      label: 'Maximum Lift',
      description: 'Maximum valve lift',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.0001, message: 'Lift must be positive' }],
      defaultValue: 0.01
    },
    anguloApertura: {
      type: 'number',
      label: 'Opening Angle',
      description: 'Valve opening angle (degrees BTDC/BBDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: -20
    },
    anguloCierre: {
      type: 'number',
      label: 'Closing Angle',
      description: 'Valve closing angle (degrees ATDC/ABDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: 60
    }
  },
  size: { width: 30, height: 30 },
  openWAMClass: 'TValvula4T'
};

/**
 * Reed valve definition (TLamina)
 */
export const reedValveDefinition: ComponentDefinition = {
  type: ComponentType.REED_VALVE,
  category: ComponentCategory.VALVES,
  name: 'Reed Valve',
  description: 'Reed valve for 2-stroke engines - opens based on pressure differential',
  icon: 'reed-valve-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'bidirectional',
      position: { x: 25, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE, ComponentType.CONSTANT_VOLUME_PLENUM],
      maxConnections: 2
    }
  ],
  defaultProperties: {
    id: '',
    tipoValvula: ValveType.REED_VALVE,
    tubo: 1,
    nodo: 1,
    tipo: 0,
    valvula: 1,
    sentido: 1,
    diametroTubo: 0.05,
    areaEfectiva: 0.001,
    presionApertura: 100,
    coeficienteDescarga: 0.6
  } as ValveProperties,
  propertySchema: {
    ...valvePropertySchema,
    areaEfectiva: {
      type: 'number',
      label: 'Effective Area',
      description: 'Effective flow area when fully open',
      unit: 'm²',
      required: true,
      validation: [{ type: 'min', value: 0.00001, message: 'Area must be positive' }],
      defaultValue: 0.001
    },
    presionApertura: {
      type: 'number',
      label: 'Opening Pressure',
      description: 'Minimum pressure differential to open valve',
      unit: 'Pa',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Pressure must be positive' }],
      defaultValue: 100
    },
    coeficienteDescarga: {
      type: 'number',
      label: 'Discharge Coefficient',
      description: 'Valve discharge coefficient',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 0.1, message: 'Coefficient must be positive' },
        { type: 'max', value: 1.0, message: 'Coefficient cannot exceed 1.0' }
      ],
      defaultValue: 0.6
    }
  },
  size: { width: 30, height: 30 },
  openWAMClass: 'TLamina'
};

/**
 * Butterfly valve definition (TMariposa)
 */
export const butterflyValveDefinition: ComponentDefinition = {
  type: ComponentType.BUTTERFLY_VALVE,
  category: ComponentCategory.VALVES,
  name: 'Butterfly Valve',
  description: 'Butterfly throttle valve for intake air control',
  icon: 'butterfly-valve-icon',
  nodes: [
    {
      id: 'connection',
      name: 'Connection',
      type: 'bidirectional',
      position: { x: 25, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 2
    }
  ],
  defaultProperties: {
    id: '',
    tipoValvula: ValveType.BUTTERFLY_VALVE,
    tubo: 1,
    nodo: 1,
    tipo: 0,
    valvula: 1,
    sentido: 0,
    diametroTubo: 0.05,
    anguloApertura: 90,
    coeficienteDescarga: 0.6
  } as ValveProperties,
  propertySchema: {
    ...valvePropertySchema,
    anguloApertura: {
      type: 'number',
      label: 'Opening Angle',
      description: 'Butterfly valve opening angle (0° = closed, 90° = fully open)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 90 degrees' },
        { type: 'max', value: 90, message: 'Angle must be between 0 and 90 degrees' }
      ],
      defaultValue: 90
    },
    coeficienteDescarga: {
      type: 'number',
      label: 'Discharge Coefficient',
      description: 'Valve discharge coefficient',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 0.1, message: 'Coefficient must be positive' },
        { type: 'max', value: 1.0, message: 'Coefficient cannot exceed 1.0' }
      ],
      defaultValue: 0.6
    }
  },
  size: { width: 30, height: 30 },
  openWAMClass: 'TMariposa'
};

/**
 * Engine block definition (TBloqueMotor)
 */
export const engineBlockDefinition: ComponentDefinition = {
  type: ComponentType.ENGINE_BLOCK,
  category: ComponentCategory.ENGINE,
  name: 'Engine Block',
  description: 'Engine block containing cylinders and defining engine geometry',
  icon: 'engine-block-icon',
  nodes: [
    {
      id: 'crankshaft',
      name: 'Crankshaft',
      type: 'outlet',
      position: { x: 50, y: 60 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.CYLINDER_4T, ComponentType.CYLINDER_2T],
      maxConnections: 12
    }
  ],
  defaultProperties: {
    id: '',
    numeroMotor: 1,
    tipoMotor: EngineType.FOUR_STROKE,
    geometria: {
      nCilin: 4,
      carrera: 0.086,
      diametro: 0.086,
      biela: 0.143,
      vcc: 0.000050,
      relaCompresion: 10.0
    },
    combustible: 'gasoline'
  } as EngineProperties,
  propertySchema: {
    numeroMotor: {
      type: 'number',
      label: 'Engine Number',
      description: 'Engine identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Engine number must be positive' }],
      defaultValue: 1
    },
    tipoMotor: {
      type: 'select',
      label: 'Engine Type',
      description: 'Type of engine cycle',
      unit: '',
      required: true,
      validation: [],
      defaultValue: EngineType.FOUR_STROKE,
      options: [
        { value: EngineType.TWO_STROKE, label: '2-Stroke' },
        { value: EngineType.FOUR_STROKE, label: '4-Stroke' }
      ]
    },
    'geometria.nCilin': {
      type: 'number',
      label: 'Number of Cylinders',
      description: 'Total number of cylinders',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 1, message: 'At least 1 cylinder required' },
        { type: 'max', value: 12, message: 'Maximum 12 cylinders supported' }
      ],
      defaultValue: 4
    },
    'geometria.carrera': {
      type: 'number',
      label: 'Stroke',
      description: 'Piston stroke length',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.01, message: 'Stroke must be positive' }],
      defaultValue: 0.086
    },
    'geometria.diametro': {
      type: 'number',
      label: 'Bore',
      description: 'Cylinder bore diameter',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.01, message: 'Bore must be positive' }],
      defaultValue: 0.086
    },
    'geometria.biela': {
      type: 'number',
      label: 'Connecting Rod Length',
      description: 'Connecting rod length',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.05, message: 'Rod length must be positive' }],
      defaultValue: 0.143
    },
    'geometria.vcc': {
      type: 'number',
      label: 'Combustion Chamber Volume',
      description: 'Combustion chamber volume',
      unit: 'm³',
      required: true,
      validation: [{ type: 'min', value: 0.00001, message: 'Volume must be positive' }],
      defaultValue: 0.000050
    },
    'geometria.relaCompresion': {
      type: 'number',
      label: 'Compression Ratio',
      description: 'Engine compression ratio',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 6, message: 'Compression ratio too low' },
        { type: 'max', value: 25, message: 'Compression ratio too high' }
      ],
      defaultValue: 10.0
    },
    combustible: {
      type: 'select',
      label: 'Fuel Type',
      description: 'Type of fuel used',
      unit: '',
      required: true,
      validation: [],
      defaultValue: 'gasoline',
      options: [
        { value: 'gasoline', label: 'Gasoline' },
        { value: 'diesel', label: 'Diesel' },
        { value: 'ethanol', label: 'Ethanol' },
        { value: 'methanol', label: 'Methanol' }
      ]
    },

  },
  size: { width: 80, height: 60 },
  openWAMClass: 'TBloqueMotor'
};

/**
 * 4T Cylinder definition (TCilindro4T)
 */
export const cylinder4TDefinition: ComponentDefinition = {
  type: ComponentType.CYLINDER_4T,
  category: ComponentCategory.ENGINE,
  name: '4T Cylinder',
  description: '4-stroke engine cylinder with intake and exhaust connections',
  icon: '4t-cylinder-icon',
  nodes: [
    {
      id: 'intake',
      name: 'Intake',
      type: 'inlet',
      position: { x: 10, y: 20 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'exhaust',
      name: 'Exhaust',
      type: 'outlet',
      position: { x: 40, y: 20 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'crankshaft',
      name: 'Crankshaft',
      type: 'bidirectional',
      position: { x: 25, y: 50 },
      nodeNumber: 3,
      allowedConnections: [ComponentType.ENGINE_BLOCK],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroCilindro: 1,
    motor: 1,
    anguloAperAdm: -20,
    anguloCierreAdm: 60,
    anguloAperEsc: 50,
    anguloCierreEsc: -10,
    tuboAdmision: 1,
    tuboEscape: 2,
    nodoAdmision: 1,
    nodoEscape: 0,
    desfase: 0,
    masaCombustible: 0.00002
  } as any,
  propertySchema: {
    numeroCilindro: {
      type: 'number',
      label: 'Cylinder Number',
      description: 'Cylinder identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Cylinder number must be positive' }],
      defaultValue: 1
    },
    motor: {
      type: 'number',
      label: 'Engine Number',
      description: 'Associated engine block number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Engine number must be positive' }],
      defaultValue: 1
    },
    anguloAperAdm: {
      type: 'number',
      label: 'Intake Opening Angle',
      description: 'Intake valve opening angle (degrees BTDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: -20
    },
    anguloCierreAdm: {
      type: 'number',
      label: 'Intake Closing Angle',
      description: 'Intake valve closing angle (degrees ABDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: 60
    },
    anguloAperEsc: {
      type: 'number',
      label: 'Exhaust Opening Angle',
      description: 'Exhaust valve opening angle (degrees BBDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: 50
    },
    anguloCierreEsc: {
      type: 'number',
      label: 'Exhaust Closing Angle',
      description: 'Exhaust valve closing angle (degrees ATDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: -180, message: 'Angle must be between -180 and 180' },
        { type: 'max', value: 180, message: 'Angle must be between -180 and 180' }
      ],
      defaultValue: -10
    },
    desfase: {
      type: 'number',
      label: 'Phase Offset',
      description: 'Cylinder firing phase offset',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Phase must be non-negative' },
        { type: 'max', value: 720, message: 'Phase must be less than 720°' }
      ],
      defaultValue: 0
    },
    masaCombustible: {
      type: 'number',
      label: 'Fuel Mass per Cycle',
      description: 'Mass of fuel injected per cycle',
      unit: 'kg',
      required: true,
      validation: [{ type: 'min', value: 0.000001, message: 'Fuel mass must be positive' }],
      defaultValue: 0.00002
    }
  },
  size: { width: 50, height: 60 },
  openWAMClass: 'TCilindro4T'
};

/**
 * 2T Cylinder definition (TCilindro2T)
 */
export const cylinder2TDefinition: ComponentDefinition = {
  type: ComponentType.CYLINDER_2T,
  category: ComponentCategory.ENGINE,
  name: '2T Cylinder',
  description: '2-stroke engine cylinder with port-based gas exchange',
  icon: '2t-cylinder-icon',
  nodes: [
    {
      id: 'intake',
      name: 'Intake',
      type: 'inlet',
      position: { x: 10, y: 20 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'exhaust',
      name: 'Exhaust',
      type: 'outlet',
      position: { x: 40, y: 20 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'crankshaft',
      name: 'Crankshaft',
      type: 'bidirectional',
      position: { x: 25, y: 50 },
      nodeNumber: 3,
      allowedConnections: [ComponentType.ENGINE_BLOCK],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroCilindro: 1,
    motor: 1,
    anguloAperAdm: 120,
    anguloCierreAdm: 240,
    anguloAperEsc: 110,
    anguloCierreEsc: 250,
    tuboAdmision: 1,
    tuboEscape: 2,
    nodoAdmision: 1,
    nodoEscape: 0,
    desfase: 0,
    masaCombustible: 0.00001
  } as any,
  propertySchema: {
    numeroCilindro: {
      type: 'number',
      label: 'Cylinder Number',
      description: 'Cylinder identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Cylinder number must be positive' }],
      defaultValue: 1
    },
    motor: {
      type: 'number',
      label: 'Engine Number',
      description: 'Associated engine block number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Engine number must be positive' }],
      defaultValue: 1
    },
    anguloAperAdm: {
      type: 'number',
      label: 'Intake Opening Angle',
      description: 'Intake port opening angle (degrees ATDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 360' },
        { type: 'max', value: 360, message: 'Angle must be between 0 and 360' }
      ],
      defaultValue: 120
    },
    anguloCierreAdm: {
      type: 'number',
      label: 'Intake Closing Angle',
      description: 'Intake port closing angle (degrees ATDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 360' },
        { type: 'max', value: 360, message: 'Angle must be between 0 and 360' }
      ],
      defaultValue: 240
    },
    anguloAperEsc: {
      type: 'number',
      label: 'Exhaust Opening Angle',
      description: 'Exhaust port opening angle (degrees ATDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 360' },
        { type: 'max', value: 360, message: 'Angle must be between 0 and 360' }
      ],
      defaultValue: 110
    },
    anguloCierreEsc: {
      type: 'number',
      label: 'Exhaust Closing Angle',
      description: 'Exhaust port closing angle (degrees ATDC)',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 360' },
        { type: 'max', value: 360, message: 'Angle must be between 0 and 360' }
      ],
      defaultValue: 250
    },
    desfase: {
      type: 'number',
      label: 'Phase Offset',
      description: 'Cylinder firing phase offset',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Phase must be non-negative' },
        { type: 'max', value: 360, message: 'Phase must be less than 360°' }
      ],
      defaultValue: 0
    },
    masaCombustible: {
      type: 'number',
      label: 'Fuel Mass per Cycle',
      description: 'Mass of fuel injected per cycle',
      unit: 'kg',
      required: true,
      validation: [{ type: 'min', value: 0.000001, message: 'Fuel mass must be positive' }],
      defaultValue: 0.00001
    }
  },
  size: { width: 50, height: 60 },
  openWAMClass: 'TCilindro2T'
};

/**
 * DPF definition (TDPF)
 */
export const dpfDefinition: ComponentDefinition = {
  type: ComponentType.DPF,
  category: ComponentCategory.DPF,
  name: 'Diesel Particulate Filter',
  description: 'Diesel Particulate Filter for exhaust aftertreatment',
  icon: 'dpf-icon',
  nodes: [
    {
      id: 'inlet',
      name: 'Inlet',
      type: 'inlet',
      position: { x: 10, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'outlet',
      name: 'Outlet',
      type: 'outlet',
      position: { x: 40, y: 25 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroDPF: 1,
    longitud: 0.3,
    diametro: 0.25,
    densidadCanales: 300,
    espesorPared: 0.0003,
    porosidad: 0.5,
    permeabilidad: 1e-13,
    diametroPoroMedio: 15e-6,
    masaInicialHollin: 0.0
  } as any,
  propertySchema: {
    numeroDPF: {
      type: 'number',
      label: 'DPF Number',
      description: 'DPF identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'DPF number must be positive' }],
      defaultValue: 1
    },
    longitud: {
      type: 'number',
      label: 'Length',
      description: 'DPF substrate length',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.05, message: 'Length must be positive' }],
      defaultValue: 0.3
    },
    diametro: {
      type: 'number',
      label: 'Diameter',
      description: 'DPF substrate diameter',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.05, message: 'Diameter must be positive' }],
      defaultValue: 0.25
    },
    densidadCanales: {
      type: 'number',
      label: 'Channel Density',
      description: 'Number of channels per square inch',
      unit: 'cpsi',
      required: true,
      validation: [{ type: 'min', value: 100, message: 'Density must be positive' }],
      defaultValue: 300
    },
    espesorPared: {
      type: 'number',
      label: 'Wall Thickness',
      description: 'Channel wall thickness',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.0001, message: 'Thickness must be positive' }],
      defaultValue: 0.0003
    },
    porosidad: {
      type: 'number',
      label: 'Porosity',
      description: 'Wall porosity fraction',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 0.1, message: 'Porosity must be positive' },
        { type: 'max', value: 0.9, message: 'Porosity must be less than 0.9' }
      ],
      defaultValue: 0.5
    },
    permeabilidad: {
      type: 'number',
      label: 'Permeability',
      description: 'Wall permeability',
      unit: 'm²',
      required: true,
      validation: [{ type: 'min', value: 1e-15, message: 'Permeability must be positive' }],
      defaultValue: 1e-13
    }
  },
  size: { width: 50, height: 30 },
  openWAMClass: 'TDPF'
};

// ============================================================================
// CONTROL SYSTEM COMPONENTS (VANOS)
// ============================================================================

/**
 * Sensor definition (TSensor) - For VANOS cam/crank position sensors
 */
export const sensorDefinition: ComponentDefinition = {
  type: ComponentType.SENSOR,
  category: ComponentCategory.CONTROL,
  name: 'Sensor',
  description: 'Position sensor for VANOS control system (cam/crank position)',
  icon: 'sensor-icon',
  nodes: [
    {
      id: 'output',
      name: 'Signal Output',
      type: 'outlet',
      position: { x: 30, y: 15 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.CONTROLLER, ComponentType.PID_CONTROLLER],
      maxConnections: 5
    }
  ],
  defaultProperties: {
    id: '',
    numeroSensor: 1,
    tipoSensor: SensorType.CAM_POSITION_INTAKE,
    posicion: { x: 0, y: 0, z: 0 },
    resolucion: 0.1,
    rangoMinimo: -180,
    rangoMaximo: 180,
    filtroTiempo: 0.01,
    offset: 0,
    ganancia: 1.0,
    ruido: 0.1
  } as SensorProperties,
  propertySchema: {
    numeroSensor: {
      type: 'number',
      label: 'Sensor Number',
      description: 'Unique sensor identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Sensor number must be positive' }],
      defaultValue: 1
    },
    tipoSensor: {
      type: 'select',
      label: 'Sensor Type',
      description: 'Type of position sensor',
      unit: '',
      required: true,
      validation: [],
      defaultValue: SensorType.CAM_POSITION_INTAKE,
      options: [
        { value: SensorType.CAM_POSITION_INTAKE, label: 'Intake Cam Position' },
        { value: SensorType.CAM_POSITION_EXHAUST, label: 'Exhaust Cam Position' },
        { value: SensorType.CRANK_POSITION, label: 'Crankshaft Position' },
        { value: SensorType.PRESSURE, label: 'Pressure Sensor' },
        { value: SensorType.TEMPERATURE, label: 'Temperature Sensor' },
        { value: SensorType.FLOW_RATE, label: 'Flow Rate Sensor' }
      ]
    },
    resolucion: {
      type: 'number',
      label: 'Resolution',
      description: 'Sensor resolution',
      unit: '°',
      required: true,
      validation: [{ type: 'min', value: 0.01, message: 'Resolution must be positive' }],
      defaultValue: 0.1
    },
    rangoMinimo: {
      type: 'number',
      label: 'Minimum Range',
      description: 'Minimum measurement range',
      unit: '°',
      required: true,
      validation: [],
      defaultValue: -180
    },
    rangoMaximo: {
      type: 'number',
      label: 'Maximum Range',
      description: 'Maximum measurement range',
      unit: '°',
      required: true,
      validation: [],
      defaultValue: 180
    },
    filtroTiempo: {
      type: 'number',
      label: 'Filter Time Constant',
      description: 'Low-pass filter time constant',
      unit: 's',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Filter time must be positive' }],
      defaultValue: 0.01
    },
    ganancia: {
      type: 'number',
      label: 'Gain',
      description: 'Sensor signal gain',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 0.1, message: 'Gain must be positive' }],
      defaultValue: 1.0
    },
    offset: {
      type: 'number',
      label: 'Offset',
      description: 'Sensor signal offset',
      unit: '°',
      required: true,
      validation: [],
      defaultValue: 0
    }
  },
  size: { width: 30, height: 30 },
  openWAMClass: 'TSensor',
  connectionRules: [
    {
      fromType: ComponentType.SENSOR,
      fromPortType: 'output',
      toType: ComponentType.CONTROLLER,
      toPortType: 'sensor_input',
      isAllowed: true
    },
    {
      fromType: ComponentType.SENSOR,
      fromPortType: 'output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'feedback',
      isAllowed: true
    }
  ]
};

/**
 * 1D Table definition (TTable1D) - For VANOS maps
 */
export const table1DDefinition: ComponentDefinition = {
  type: ComponentType.TABLE_1D,
  category: ComponentCategory.CONTROL,
  name: '1D Table',
  description: '1D lookup table for VANOS timing maps and control parameters',
  icon: 'table-icon',
  nodes: [
    {
      id: 'input',
      name: 'Input',
      type: 'inlet',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.SENSOR, ComponentType.CONTROLLER],
      maxConnections: 1
    },
    {
      id: 'output',
      name: 'Output',
      type: 'outlet',
      position: { x: 50, y: 25 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.CONTROLLER, ComponentType.PID_CONTROLLER],
      maxConnections: 5
    }
  ],
  defaultProperties: {
    id: '',
    numeroTabla: 1,
    tipoTabla: TableType.VANOS_MAP_INTAKE,
    interpolacion: InterpolationType.LINEAR,
    extrapolacion: ExtrapolationType.CONSTANT,
    datosX: [800, 1500, 2500, 4000, 6000, 7000],
    datosY: [0, 5, 15, 25, 35, 40],
    unidadX: 'rpm',
    unidadY: '°',
    descripcion: 'VANOS intake timing map'
  } as Table1DProperties,
  propertySchema: {
    numeroTabla: {
      type: 'number',
      label: 'Table Number',
      description: 'Unique table identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Table number must be positive' }],
      defaultValue: 1
    },
    tipoTabla: {
      type: 'select',
      label: 'Table Type',
      description: 'Type of lookup table',
      unit: '',
      required: true,
      validation: [],
      defaultValue: TableType.VANOS_MAP_INTAKE,
      options: [
        { value: TableType.VANOS_MAP_INTAKE, label: 'VANOS Intake Map' },
        { value: TableType.VANOS_MAP_EXHAUST, label: 'VANOS Exhaust Map' },
        { value: TableType.PRESSURE_MAP, label: 'Pressure Map' },
        { value: TableType.TEMPERATURE_MAP, label: 'Temperature Map' },
        { value: TableType.FLOW_MAP, label: 'Flow Map' }
      ]
    },
    interpolacion: {
      type: 'select',
      label: 'Interpolation',
      description: 'Interpolation method',
      unit: '',
      required: true,
      validation: [],
      defaultValue: InterpolationType.LINEAR,
      options: [
        { value: InterpolationType.LINEAR, label: 'Linear' },
        { value: InterpolationType.CUBIC_SPLINE, label: 'Cubic Spline' },
        { value: InterpolationType.POLYNOMIAL, label: 'Polynomial' }
      ]
    },
    extrapolacion: {
      type: 'select',
      label: 'Extrapolation',
      description: 'Extrapolation method',
      unit: '',
      required: true,
      validation: [],
      defaultValue: ExtrapolationType.CONSTANT,
      options: [
        { value: ExtrapolationType.CONSTANT, label: 'Constant' },
        { value: ExtrapolationType.LINEAR, label: 'Linear' },
        { value: ExtrapolationType.ZERO, label: 'Zero' }
      ]
    },
    unidadX: {
      type: 'string',
      label: 'X-axis Unit',
      description: 'Unit for X-axis values',
      unit: '',
      required: true,
      validation: [],
      defaultValue: 'rpm'
    },
    unidadY: {
      type: 'string',
      label: 'Y-axis Unit',
      description: 'Unit for Y-axis values',
      unit: '',
      required: true,
      validation: [],
      defaultValue: '°'
    },
    descripcion: {
      type: 'string',
      label: 'Description',
      description: 'Table description',
      unit: '',
      required: false,
      validation: [],
      defaultValue: 'VANOS timing map'
    }
  },
  size: { width: 50, height: 30 },
  openWAMClass: 'TTable1D',
  connectionRules: [
    {
      fromType: ComponentType.SENSOR,
      fromPortType: 'output',
      toType: ComponentType.TABLE_1D,
      toPortType: 'input',
      isAllowed: true
    },
    {
      fromType: ComponentType.TABLE_1D,
      fromPortType: 'output',
      toType: ComponentType.CONTROLLER,
      toPortType: 'table_input',
      isAllowed: true
    },
    {
      fromType: ComponentType.TABLE_1D,
      fromPortType: 'output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'setpoint',
      isAllowed: true
    }
  ]
};

/**
 * Controller definition (TController) - For VANOS control logic
 */
export const controllerDefinition: ComponentDefinition = {
  type: ComponentType.CONTROLLER,
  category: ComponentCategory.CONTROL,
  name: 'Controller',
  description: 'VANOS control logic controller with multiple inputs and outputs',
  icon: 'controller-icon',
  nodes: [
    {
      id: 'sensor_input',
      name: 'Sensor Input',
      type: 'inlet',
      position: { x: 0, y: 15 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.SENSOR],
      maxConnections: 10
    },
    {
      id: 'table_input',
      name: 'Table Input',
      type: 'inlet',
      position: { x: 0, y: 35 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.TABLE_1D],
      maxConnections: 5
    },
    {
      id: 'pid_output',
      name: 'PID Output',
      type: 'outlet',
      position: { x: 60, y: 25 },
      nodeNumber: 3,
      allowedConnections: [ComponentType.PID_CONTROLLER],
      maxConnections: 5
    }
  ],
  defaultProperties: {
    id: '',
    numeroController: 1,
    tipoController: ControllerType.VANOS_MASTER,
    entradas: [],
    salidas: [],
    parametros: {
      frecuenciaEjecucion: 100,
      tiempoMuestreo: 0.01,
      retardoEjecucion: 0.001,
      modoDebug: false
    },
    modoOperacion: OperationMode.AUTOMATIC,
    limitesSeguridad: {
      temperaturaMaxima: 150,
      presionMaxima: 10,
      velocidadMaxima: 8000,
      tiempoRespuestaMaximo: 0.1
    }
  } as ControllerProperties,
  propertySchema: {
    numeroController: {
      type: 'number',
      label: 'Controller Number',
      description: 'Unique controller identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Controller number must be positive' }],
      defaultValue: 1
    },
    tipoController: {
      type: 'select',
      label: 'Controller Type',
      description: 'Type of VANOS controller',
      unit: '',
      required: true,
      validation: [],
      defaultValue: ControllerType.VANOS_MASTER,
      options: [
        { value: ControllerType.VANOS_MASTER, label: 'VANOS Master Controller' },
        { value: ControllerType.VANOS_INTAKE, label: 'VANOS Intake Controller' },
        { value: ControllerType.VANOS_EXHAUST, label: 'VANOS Exhaust Controller' },
        { value: ControllerType.PRESSURE_CONTROL, label: 'Pressure Controller' },
        { value: ControllerType.TEMPERATURE_CONTROL, label: 'Temperature Controller' }
      ]
    },
    modoOperacion: {
      type: 'select',
      label: 'Operation Mode',
      description: 'Controller operation mode',
      unit: '',
      required: true,
      validation: [],
      defaultValue: OperationMode.AUTOMATIC,
      options: [
        { value: OperationMode.AUTOMATIC, label: 'Automatic' },
        { value: OperationMode.MANUAL, label: 'Manual' },
        { value: OperationMode.CALIBRATION, label: 'Calibration' },
        { value: OperationMode.DIAGNOSTIC, label: 'Diagnostic' }
      ]
    },
    'parametros.frecuenciaEjecucion': {
      type: 'number',
      label: 'Execution Frequency',
      description: 'Controller execution frequency',
      unit: 'Hz',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Frequency must be positive' }],
      defaultValue: 100
    },
    'parametros.tiempoMuestreo': {
      type: 'number',
      label: 'Sample Time',
      description: 'Controller sample time',
      unit: 's',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Sample time must be positive' }],
      defaultValue: 0.01
    }
  },
  size: { width: 60, height: 50 },
  openWAMClass: 'TController',
  connectionRules: [
    {
      fromType: ComponentType.SENSOR,
      fromPortType: 'output',
      toType: ComponentType.CONTROLLER,
      toPortType: 'sensor_input',
      isAllowed: true
    },
    {
      fromType: ComponentType.TABLE_1D,
      fromPortType: 'output',
      toType: ComponentType.CONTROLLER,
      toPortType: 'table_input',
      isAllowed: true
    },
    {
      fromType: ComponentType.CONTROLLER,
      fromPortType: 'pid_output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'setpoint',
      isAllowed: true
    }
  ]
};

/**
 * PID Controller definition (TPIDController) - For VANOS PID control
 */
export const pidControllerDefinition: ComponentDefinition = {
  type: ComponentType.PID_CONTROLLER,
  category: ComponentCategory.CONTROL,
  name: 'PID Controller',
  description: 'PID controller for precise VANOS timing control',
  icon: 'pid-controller-icon',
  nodes: [
    {
      id: 'setpoint',
      name: 'Setpoint',
      type: 'inlet',
      position: { x: 0, y: 15 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.CONTROLLER, ComponentType.TABLE_1D],
      maxConnections: 1
    },
    {
      id: 'feedback',
      name: 'Feedback',
      type: 'inlet',
      position: { x: 0, y: 35 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.SENSOR],
      maxConnections: 1
    },
    {
      id: 'output',
      name: 'Control Output',
      type: 'outlet',
      position: { x: 50, y: 25 },
      nodeNumber: 3,
      allowedConnections: [ComponentType.CONTROL_VALVE],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroPID: 1,
    kp: 1.0,
    ki: 0.1,
    kd: 0.05,
    setpoint: 0,
    limiteSalidaMin: -100,
    limiteSalidaMax: 100,
    limiteIntegralMin: -50,
    limiteIntegralMax: 50,
    tiempoMuestreo: 0.01,
    modoAntiWindup: AntiWindupMode.CLAMP,
    filtroDerivativo: 0.01,
    deadband: 0.5
  } as PIDControllerProperties,
  propertySchema: {
    numeroPID: {
      type: 'number',
      label: 'PID Number',
      description: 'Unique PID controller identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'PID number must be positive' }],
      defaultValue: 1
    },
    kp: {
      type: 'number',
      label: 'Proportional Gain (Kp)',
      description: 'Proportional gain coefficient',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 0, message: 'Kp must be non-negative' }],
      defaultValue: 1.0
    },
    ki: {
      type: 'number',
      label: 'Integral Gain (Ki)',
      description: 'Integral gain coefficient',
      unit: '1/s',
      required: true,
      validation: [{ type: 'min', value: 0, message: 'Ki must be non-negative' }],
      defaultValue: 0.1
    },
    kd: {
      type: 'number',
      label: 'Derivative Gain (Kd)',
      description: 'Derivative gain coefficient',
      unit: 's',
      required: true,
      validation: [{ type: 'min', value: 0, message: 'Kd must be non-negative' }],
      defaultValue: 0.05
    },
    setpoint: {
      type: 'number',
      label: 'Setpoint',
      description: 'Target setpoint value',
      unit: '°',
      required: true,
      validation: [],
      defaultValue: 0
    },
    limiteSalidaMin: {
      type: 'number',
      label: 'Minimum Output Limit',
      description: 'Minimum controller output limit',
      unit: '%',
      required: true,
      validation: [],
      defaultValue: -100
    },
    limiteSalidaMax: {
      type: 'number',
      label: 'Maximum Output Limit',
      description: 'Maximum controller output limit',
      unit: '%',
      required: true,
      validation: [],
      defaultValue: 100
    },
    tiempoMuestreo: {
      type: 'number',
      label: 'Sample Time',
      description: 'PID controller sample time',
      unit: 's',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Sample time must be positive' }],
      defaultValue: 0.01
    },
    modoAntiWindup: {
      type: 'select',
      label: 'Anti-Windup Mode',
      description: 'Integral anti-windup method',
      unit: '',
      required: true,
      validation: [],
      defaultValue: AntiWindupMode.CLAMP,
      options: [
        { value: AntiWindupMode.NONE, label: 'None' },
        { value: AntiWindupMode.CLAMP, label: 'Clamp' },
        { value: AntiWindupMode.BACK_CALCULATION, label: 'Back Calculation' },
        { value: AntiWindupMode.CONDITIONAL_INTEGRATION, label: 'Conditional Integration' }
      ]
    },
    deadband: {
      type: 'number',
      label: 'Deadband',
      description: 'Deadband around setpoint',
      unit: '°',
      required: true,
      validation: [{ type: 'min', value: 0, message: 'Deadband must be non-negative' }],
      defaultValue: 0.5
    }
  },
  size: { width: 50, height: 40 },
  openWAMClass: 'TPIDController',
  connectionRules: [
    {
      fromType: ComponentType.CONTROLLER,
      fromPortType: 'pid_output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'setpoint',
      isAllowed: true
    },
    {
      fromType: ComponentType.TABLE_1D,
      fromPortType: 'output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'setpoint',
      isAllowed: true
    },
    {
      fromType: ComponentType.SENSOR,
      fromPortType: 'output',
      toType: ComponentType.PID_CONTROLLER,
      toPortType: 'feedback',
      isAllowed: true
    },
    {
      fromType: ComponentType.PID_CONTROLLER,
      fromPortType: 'output',
      toType: ComponentType.CONTROL_VALVE,
      toPortType: 'control_input',
      isAllowed: true
    }
  ]
};

/**
 * Control Valve definition (TValvulaContr) - For VANOS hydraulic control
 */
export const controlValveDefinition: ComponentDefinition = {
  type: ComponentType.CONTROL_VALVE,
  category: ComponentCategory.VALVES,
  name: 'Control Valve',
  description: 'Hydraulic control valve for VANOS actuation',
  icon: 'control-valve-icon',
  nodes: [
    {
      id: 'control_input',
      name: 'Control Input',
      type: 'inlet',
      position: { x: 15, y: 0 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PID_CONTROLLER],
      maxConnections: 1
    },
    {
      id: 'hydraulic_connection',
      name: 'Hydraulic Connection',
      type: 'bidirectional',
      position: { x: 15, y: 30 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.PIPE, ComponentType.CONSTANT_VOLUME_PLENUM],
      maxConnections: 2
    }
  ],
  defaultProperties: {
    id: '',
    numeroValvula: 1,
    tipoValvulaControl: ControlValveType.HYDRAULIC_VANOS,
    diametroNominal: 0.01,
    coeficienteDescarga: 0.6,
    tiempoRespuesta: 0.05,
    posicionMinima: 0,
    posicionMaxima: 100,
    caracteristicaFlujo: FlowCharacteristic.LINEAR,
    actuador: {
      tipo: ActuatorType.HYDRAULIC,
      fuerzaMaxima: 1000,
      velocidadMaxima: 50,
      consumoEnergia: 100,
      tiempoVida: 100000
    },
    realimentacion: {
      tipoSensor: FeedbackSensorType.POTENTIOMETER,
      resolucion: 0.1,
      precision: 0.5,
      tiempoRespuesta: 0.01
    }
  } as ControlValveProperties,
  propertySchema: {
    numeroValvula: {
      type: 'number',
      label: 'Valve Number',
      description: 'Unique control valve identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Valve number must be positive' }],
      defaultValue: 1
    },
    tipoValvulaControl: {
      type: 'select',
      label: 'Control Valve Type',
      description: 'Type of control valve',
      unit: '',
      required: true,
      validation: [],
      defaultValue: ControlValveType.HYDRAULIC_VANOS,
      options: [
        { value: ControlValveType.HYDRAULIC_VANOS, label: 'Hydraulic VANOS' },
        { value: ControlValveType.PNEUMATIC, label: 'Pneumatic' },
        { value: ControlValveType.ELECTRIC, label: 'Electric' },
        { value: ControlValveType.PROPORTIONAL, label: 'Proportional' }
      ]
    },
    diametroNominal: {
      type: 'number',
      label: 'Nominal Diameter',
      description: 'Valve nominal diameter',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Diameter must be positive' }],
      defaultValue: 0.01
    },
    coeficienteDescarga: {
      type: 'number',
      label: 'Discharge Coefficient',
      description: 'Valve discharge coefficient',
      unit: '',
      required: true,
      validation: [
        { type: 'min', value: 0.1, message: 'Coefficient must be positive' },
        { type: 'max', value: 1.0, message: 'Coefficient cannot exceed 1.0' }
      ],
      defaultValue: 0.6
    },
    tiempoRespuesta: {
      type: 'number',
      label: 'Response Time',
      description: 'Valve response time (10-90%)',
      unit: 's',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Response time must be positive' }],
      defaultValue: 0.05
    },
    caracteristicaFlujo: {
      type: 'select',
      label: 'Flow Characteristic',
      description: 'Valve flow characteristic',
      unit: '',
      required: true,
      validation: [],
      defaultValue: FlowCharacteristic.LINEAR,
      options: [
        { value: FlowCharacteristic.LINEAR, label: 'Linear' },
        { value: FlowCharacteristic.EQUAL_PERCENTAGE, label: 'Equal Percentage' },
        { value: FlowCharacteristic.QUICK_OPENING, label: 'Quick Opening' },
        { value: FlowCharacteristic.CUSTOM, label: 'Custom' }
      ]
    }
  },
  size: { width: 30, height: 40 },
  openWAMClass: 'TValvulaContr',
  connectionRules: [
    {
      fromType: ComponentType.PID_CONTROLLER,
      fromPortType: 'output',
      toType: ComponentType.CONTROL_VALVE,
      toPortType: 'control_input',
      isAllowed: true
    },
    {
      fromType: ComponentType.CONTROL_VALVE,
      fromPortType: 'hydraulic_connection',
      toType: ComponentType.PIPE,
      toPortType: 'left',
      isAllowed: true
    },
    {
      fromType: ComponentType.CONTROL_VALVE,
      fromPortType: 'hydraulic_connection',
      toType: ComponentType.PIPE,
      toPortType: 'right',
      isAllowed: true
    },
    {
      fromType: ComponentType.CONTROL_VALVE,
      fromPortType: 'hydraulic_connection',
      toType: ComponentType.CONSTANT_VOLUME_PLENUM,
      toPortType: 'inlet',
      isAllowed: true
    }
  ]
};

/**
 * Pipe-to-Plenum Connection definition (TCCDeposito) - For direct pipe-plenum connections
 */
export const pipeToPlenumDefinition: ComponentDefinition = {
  type: ComponentType.PIPE_TO_PLENUM,
  category: ComponentCategory.BOUNDARIES,
  name: 'Pipe-to-Plenum Connection',
  description: 'Direct connection between pipe and plenum for hydraulic circuits',
  icon: 'pipe-plenum-icon',
  nodes: [
    {
      id: 'pipe_connection',
      name: 'Pipe Connection',
      type: 'inlet',
      position: { x: 0, y: 25 },
      nodeNumber: 1,
      allowedConnections: [ComponentType.PIPE],
      maxConnections: 1
    },
    {
      id: 'plenum_connection',
      name: 'Plenum Connection',
      type: 'outlet',
      position: { x: 40, y: 25 },
      nodeNumber: 2,
      allowedConnections: [ComponentType.CONSTANT_VOLUME_PLENUM, ComponentType.VARIABLE_VOLUME_PLENUM],
      maxConnections: 1
    }
  ],
  defaultProperties: {
    id: '',
    numeroConexion: 1,
    tuboPrincipal: 1,
    nodoTubo: 1,
    plenum: 1,
    tipoConexion: ConnectionType.DIRECT,
    diametroConexion: 0.02,
    longitudConexion: 0.05,
    coeficientePerdida: 0.1,
    anguloConexion: 90,
    factorCorreccion: 1.0
  } as PipeToPlenumProperties,
  propertySchema: {
    numeroConexion: {
      type: 'number',
      label: 'Connection Number',
      description: 'Unique connection identifier',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Connection number must be positive' }],
      defaultValue: 1
    },
    tuboPrincipal: {
      type: 'number',
      label: 'Pipe Number',
      description: 'Connected pipe number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Pipe number must be positive' }],
      defaultValue: 1
    },
    plenum: {
      type: 'number',
      label: 'Plenum Number',
      description: 'Connected plenum number',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 1, message: 'Plenum number must be positive' }],
      defaultValue: 1
    },
    tipoConexion: {
      type: 'select',
      label: 'Connection Type',
      description: 'Type of pipe-plenum connection',
      unit: '',
      required: true,
      validation: [],
      defaultValue: ConnectionType.DIRECT,
      options: [
        { value: ConnectionType.DIRECT, label: 'Direct' },
        { value: ConnectionType.TAPERED, label: 'Tapered' },
        { value: ConnectionType.SUDDEN_EXPANSION, label: 'Sudden Expansion' },
        { value: ConnectionType.SUDDEN_CONTRACTION, label: 'Sudden Contraction' },
        { value: ConnectionType.CURVED, label: 'Curved' }
      ]
    },
    diametroConexion: {
      type: 'number',
      label: 'Connection Diameter',
      description: 'Connection diameter',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Diameter must be positive' }],
      defaultValue: 0.02
    },
    longitudConexion: {
      type: 'number',
      label: 'Connection Length',
      description: 'Connection length',
      unit: 'm',
      required: true,
      validation: [{ type: 'min', value: 0.001, message: 'Length must be positive' }],
      defaultValue: 0.05
    },
    coeficientePerdida: {
      type: 'number',
      label: 'Loss Coefficient',
      description: 'Pressure loss coefficient',
      unit: '',
      required: true,
      validation: [{ type: 'min', value: 0, message: 'Loss coefficient must be non-negative' }],
      defaultValue: 0.1
    },
    anguloConexion: {
      type: 'number',
      label: 'Connection Angle',
      description: 'Connection angle',
      unit: '°',
      required: true,
      validation: [
        { type: 'min', value: 0, message: 'Angle must be between 0 and 180°' },
        { type: 'max', value: 180, message: 'Angle must be between 0 and 180°' }
      ],
      defaultValue: 90
    }
  },
  size: { width: 40, height: 20 },
  openWAMClass: 'TCCDeposito',
  connectionRules: [
    {
      fromType: ComponentType.PIPE,
      fromPortType: 'left',
      toType: ComponentType.PIPE_TO_PLENUM,
      toPortType: 'pipe_connection',
      isAllowed: true
    },
    {
      fromType: ComponentType.PIPE,
      fromPortType: 'right',
      toType: ComponentType.PIPE_TO_PLENUM,
      toPortType: 'pipe_connection',
      isAllowed: true
    },
    {
      fromType: ComponentType.PIPE_TO_PLENUM,
      fromPortType: 'plenum_connection',
      toType: ComponentType.CONSTANT_VOLUME_PLENUM,
      toPortType: 'inlet',
      isAllowed: true
    },
    {
      fromType: ComponentType.PIPE_TO_PLENUM,
      fromPortType: 'plenum_connection',
      toType: ComponentType.VARIABLE_VOLUME_PLENUM,
      toPortType: 'inlet',
      isAllowed: true
    }
  ]
};

// ============================================================================
// COMPONENT LIBRARY
// ============================================================================

/**
 * Complete component definitions library
 */
export const componentDefinitions: ComponentDefinition[] = [
  // Pipes
  pipeDefinition,
  
  // Boundaries
  openEndAtmosphereDefinition,
  closedEndDefinition,
  anechoicEndDefinition,
  branchDefinition,
  pipeToPlenumDefinition,
  
  // Plenums
  constantVolumePlenumDefinition,
  variableVolumePlenumDefinition,
  simpleTurbineDefinition,
  
  // Valves
  fixedCDValveDefinition,
  valve4TDefinition,
  reedValveDefinition,
  butterflyValveDefinition,
  controlValveDefinition,
  
  // Engine
  engineBlockDefinition,
  cylinder4TDefinition,
  cylinder2TDefinition,
  
  // Control (VANOS)
  sensorDefinition,
  table1DDefinition,
  controllerDefinition,
  pidControllerDefinition,
  
  // DPF
  dpfDefinition
];

/**
 * Get component definition by type
 */
export function getComponentDefinition(type: ComponentType): ComponentDefinition | undefined {
  return componentDefinitions.find(def => def.type === type);
}

/**
 * Get component definitions by category
 */
export function getComponentsByCategory(category: ComponentCategory): ComponentDefinition[] {
  return componentDefinitions.filter(def => def.category === category);
}

/**
 * Get all available categories
 */
export function getAvailableCategories(): ComponentCategory[] {
  return Array.from(new Set(componentDefinitions.map(def => def.category)));
}
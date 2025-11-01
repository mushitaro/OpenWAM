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
  CompressorModel,
  EngineType,
  HeatTransferType,
  MeshType,
  PropertySchema,
  ComponentNode,
  PipeProperties,
  PlenumProperties,
  ValveProperties,
  BoundaryProperties,
  EngineProperties,
  CompressorProperties
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
  description: 'Closed end boundary condition',
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

// ============================================================================
// COMPONENT LIBRARY
// ============================================================================

/**
 * Complete component definitions library
 */
export const componentDefinitions: ComponentDefinition[] = [
  pipeDefinition,
  constantVolumePlenumDefinition,
  fixedCDValveDefinition,
  openEndAtmosphereDefinition,
  closedEndDefinition
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
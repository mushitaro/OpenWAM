/**
 * OpenWAM Component Definition System
 * Based on actual OpenWAM source code analysis
 */

// ============================================================================
// ENUMS - Based on OpenWAM source code
// ============================================================================

/**
 * Component categories based on OpenWAM source structure
 */
export enum ComponentCategory {
  PIPES = 'pipes',              // 1DPipes
  BOUNDARIES = 'boundaries',    // Boundaries
  PLENUMS = 'plenums',         // ODModels (0D Models)
  VALVES = 'valves',           // Connections (valve types)
  TURBOCHARGER = 'turbocharger', // Turbocompressor
  ENGINE = 'engine',           // Engine
  CONTROL = 'control',         // Control
  DPF = 'dpf',                // DPF (Diesel Particulate Filter)
  EXTERNAL = 'external'        // Extern
}

/**
 * Boundary condition types from OpenWAM nmTypeBC enum
 */
export enum BoundaryConditionType {
  OPEN_END_ATMOSPHERE = 0,      // nmOpenEndAtmosphere
  OPEN_END_RESERVOIR = 1,       // nmOpenEndReservoir
  OPEN_END_CALC_EXTERN = 2,     // nmOpenEndCalcExtern
  CLOSED_END = 3,               // nmClosedEnd
  ANECHOIC_END = 4,             // nmAnechoicEnd
  INCIDENT_PRESSURE_WAVE = 5,   // nmIncidentPressurWave
  PIPES_CONNECTION = 6,         // nmPipesConnection
  INTAKE_VALVE = 7,             // nmIntakeValve
  EXHAUST_VALVE = 8,            // nmExhaustValve
  LINEAR_PRESSURE_LOSS = 9,     // nmLinearPressureLoss
  QUADRATIC_PRESSURE_LOSS = 10, // nmQuadraticPressureLoss
  PIPE_TO_PLENUM_CONNECTION = 11, // nmPipeToPlenumConnection
  BRANCH = 12,                  // nmBranch
  VOLUMETRIC_COMPRESSOR = 13,   // nmVolumetricCompressor
  INJECTION_END = 14,           // nmInjectionEnd
  COMPRESSOR_INLET = 15,        // nmEntradaCompre
  UNION_BETWEEN_PLENUMS = 16,   // nmUnionEntreDepositos
  COMPRESSOR_BC = 17,           // nmCompresor
  VARIABLE_PRESSURE = 18,       // nmPresionVble
  CFD_CONNECTION = 19,          // nmCFDConnection
  EXTERNAL_CONNECTION = 20      // nmExternalConnection
}

/**
 * Valve types from OpenWAM nmTipoValvula enum
 */
export enum ValveType {
  FIXED_CD = 0,                 // nmCDFijo
  VALVE_4T = 1,                 // nmValvula4T
  REED_VALVE = 2,               // nmLamina
  ROTARY_DISC = 3,              // nmDiscoRotativo
  PORT_2T = 4,                  // nmLumbrera2T
  CONTROL_VALVE = 5,            // nmValvulaContr
  WASTEGATE = 6,                // nmWasteGate
  TURBINE_STATOR = 7,           // nmStator
  TURBINE_ROTOR = 8,            // nmRotor
  EXTERNAL_CALC = 9,            // nmCalcExtern
  BUTTERFLY_VALVE = 10          // nmMariposa
}

/**
 * Plenum types from OpenWAM nmTipoDeposito enum
 */
export enum PlenumType {
  CONSTANT_VOLUME = 0,          // nmDepVolCte
  VARIABLE_VOLUME = 1,          // nmDepVolVble
  SIMPLE_TURBINE = 2,           // nmTurbinaSimple
  TWIN_TURBINE = 3,             // nmTurbinaTwin
  VENTURI = 4,                  // nmVenturi
  DIRECTIONAL_UNION = 5         // nmUnionDireccional
}

/**
 * Compressor model types from OpenWAM nmCompressorModel enum
 */
export enum CompressorModel {
  ORIGINAL = 0,                 // nmCompOriginal (plenum to pipe)
  PLENUMS = 1,                  // nmCompPlenums (plenum to plenum)
  PIPES = 2                     // nmCompPipes (pipe to pipe)
}

/**
 * Engine types from OpenWAM nmTipoMotor enum
 */
export enum EngineType {
  TWO_STROKE = 0,               // nm2T
  FOUR_STROKE = 1               // nm4T
}

/**
 * Pipe end identification from OpenWAM nmPipeEnd enum
 */
export enum PipeEnd {
  LEFT = 0,                     // nmLeft
  RIGHT = 1                     // nmRight
}

/**
 * Heat transfer types from OpenWAM nmTipoTransCal enum
 */
export enum HeatTransferType {
  INTAKE_PIPE = 0,              // nmPipaAdmision
  INTAKE_TUBE = 1,              // nmTuboAdmision
  EXHAUST_TUBE = 2,             // nmTuboEscape
  EXHAUST_PIPE = 3              // nmPipaEscape
}

/**
 * Mesh types from OpenWAM nmTipoMallado enum
 */
export enum MeshType {
  DISTANCE = 1,                 // nmDistancia
  ANGULAR = 2                   // nmAngular
}

// ============================================================================
// COMPONENT TYPE DEFINITIONS
// ============================================================================

/**
 * OpenWAM component types based on actual C++ classes
 */
export enum ComponentType {
  // 1DPipes
  PIPE = 'TTubo',
  CONCENTRIC_PIPE = 'TConcentrico',
  
  // Boundaries (境界条件)
  OPEN_END_ATMOSPHERE = 'TCCDescargaExtremoAbierto',
  OPEN_END_RESERVOIR = 'TCCDescargaExtremoAbierto',
  CLOSED_END = 'TCCExtremoCerrado',
  ANECHOIC_END = 'TCCExtremoAnecoico',
  PULSE_END = 'TCCPulso',
  INJECTION_END = 'TCCExtremoInyeccion',
  PRESSURE_LOSS = 'TCCPerdidadePresion',
  PIPES_CONNECTION = 'TCCUnionEntreTubos',
  PIPE_TO_PLENUM = 'TCCDeposito',
  BRANCH = 'TCCRamificacion',
  VOLUMETRIC_COMPRESSOR_BC = 'TCCCompresorVolumetrico',
  COMPRESSOR_INLET_BC = 'TCCEntradaCompresor',
  UNION_BETWEEN_PLENUMS_BC = 'TCCUnionEntreDepositos',
  COMPRESSOR_BC = 'TCCCompresor',
  VARIABLE_PRESSURE_BC = 'TCCPreVble',
  CFD_CONNECTION_BC = 'TCFDConnection',
  EXTERNAL_CONNECTION_BC = 'TCCExternalConnection',
  
  // ODModels (プレナム)
  CONSTANT_VOLUME_PLENUM = 'TDepVolCte',
  VARIABLE_VOLUME_PLENUM = 'TDepVolVariable',
  SIMPLE_TURBINE = 'TTurbinaSimple',
  TWIN_TURBINE = 'TTurbinaTwin',
  VENTURI = 'TVenturi',
  DIRECTIONAL_UNION = 'TUnionDireccional',
  
  // Connections (バルブ)
  FIXED_CD_VALVE = 'TCDFijo',
  VALVE_4T = 'TValvula4T',
  REED_VALVE = 'TLamina',
  ROTARY_DISC_VALVE = 'TDiscoRotativo',
  PORT_2T_VALVE = 'TLumbrera',
  CONTROL_VALVE = 'TValvulaContr',
  WASTEGATE_VALVE = 'TWasteGate',
  TURBINE_STATOR_VALVE = 'TEstatorTurbina',
  TURBINE_ROTOR_VALVE = 'TRotorTurbina',
  EXTERNAL_CALC_VALVE = 'TCDExterno',
  BUTTERFLY_VALVE = 'TMariposa',
  
  // Turbocompressor
  COMPRESSOR_DEP = 'TCompresorDep',
  COMPRESSOR_TUB_DEP = 'TCompTubDep',
  COMPRESSOR_TUBES = 'TCompTubos',
  TURBO_AXIS = 'TEjeTurbogrupo',
  
  // Engine
  ENGINE_BLOCK = 'TBloqueMotor',
  CYLINDER_4T = 'TCilindro4T',
  CYLINDER_2T = 'TCilindro2T',
  
  // Control
  SENSOR = 'TSensor',
  PID_CONTROLLER = 'TPIDController',
  TABLE_1D = 'TTable1D',
  CONTROLLER = 'TController',
  DECISOR = 'TDecisor',
  GAIN = 'TGain',
  
  // DPF
  DPF = 'TDPF',
  DPF_CHANNEL = 'TCanalDPF'
}

// ============================================================================
// PROPERTY INTERFACES
// ============================================================================

/**
 * Base interface for all component properties
 */
export interface BaseComponentProperties {
  id: string;
  name?: string;
  description?: string;
}

/**
 * Pipe properties based on OpenWAM TTubo class
 */
export interface PipeProperties extends BaseComponentProperties {
  // Basic geometric parameters
  numeroTubo: number;           // FNumeroTubo
  nodoIzq: number;             // FNodoIzq  
  nodoDer: number;             // FNodoDer
  nin: number;                 // FNin (calculation cells)
  longitudTotal: number;       // FLongitudTotal
  mallado: number;             // FMallado
  nTramos: number;             // FNTramos
  tipoMallado: MeshType;       // FTipoMallado
  
  // Heat transfer & friction characteristics
  friccion: number;            // FFriccion
  tipoTransCal: HeatTransferType; // FTipoTransCal
  coefAjusFric: number;        // FCoefAjusFric
  coefAjusTC: number;          // FCoefAjusTC
  
  // Wall characteristics
  espesorPrin: number;         // FEspesorPrin
  densidadPrin: number;        // FDensidadPrin
  calEspPrin: number;          // FCalEspPrin
  conductPrin: number;         // FConductPrin
  tRefrigerante: number;       // FTRefrigerante
  tipRefrig: 'air' | 'water';  // FTipRefrig
  
  // Initial conditions
  tini: number;                // FTini
  pini: number;                // FPini
  velMedia: number;            // FVelMedia
  
  // Geometry arrays
  lTramo: number[];            // FLTramo
  dExtTramo: number[];         // FDExtTramo
  
  // Wall layer structure
  numCapas: number;            // FNumCapas
  capas: WallLayer[];          // FCapa
}

/**
 * Wall layer structure based on OpenWAM stCapa
 */
export interface WallLayer {
  esPrincipal: boolean;
  esFluida: boolean;
  density: number;
  calorEspecifico: number;
  conductividad: number;
  espesor: number;
  emisividadInterior: number;
  emisividadExterior: number;
}

/**
 * Plenum properties based on OpenWAM TDeposito class
 */
export interface PlenumProperties extends BaseComponentProperties {
  numeroDeposito: number;
  volumen0: number;
  tipoDeposito: PlenumType;
  temperature: number;
  pressure: number;
  masa0: number;
  // Additional properties for specific plenum types
  turbineNumber?: number;      // For turbine types
  venturiNumber?: number;      // For venturi type
}

/**
 * Valve properties based on OpenWAM TTipoValvula class
 */
export interface ValveProperties extends BaseComponentProperties {
  tipoValvula: ValveType;
  tubo: number;
  nodo: number;
  tipo: number;
  valvula: number;
  sentido: number;
  diametroTubo: number;
  // Additional properties specific to valve types
  cdTubVol?: number;
  cdVolTub?: number;
  cTorb?: number;
  cRecuperacion?: number;
}

/**
 * Boundary condition properties
 */
export interface BoundaryProperties extends BaseComponentProperties {
  tipoCC: BoundaryConditionType;
  numeroCC: number;
  // Additional properties specific to boundary condition types
  [key: string]: any;
}

/**
 * Engine properties based on OpenWAM TBloqueMotor class
 */
export interface EngineProperties extends BaseComponentProperties {
  tipoMotor: EngineType;
  geometria: {
    nCilin: number;
    carrera: number;
    diametro: number;
    biela: number;
    vcc: number;
    relaCompresion: number;
  };
  combustible: 'diesel' | 'gasoline';
}

/**
 * Compressor properties based on OpenWAM TCompresor class
 */
export interface CompressorProperties extends BaseComponentProperties {
  numeroCompresor: number;
  eje: number;
  depRotor: number;
  depStator: number;
  modeloCompresor: CompressorModel;
}

/**
 * Union type for all component properties
 */
export type ComponentProperties = 
  | PipeProperties 
  | PlenumProperties 
  | ValveProperties 
  | BoundaryProperties 
  | EngineProperties 
  | CompressorProperties;

// ============================================================================
// NODE AND CONNECTION INTERFACES
// ============================================================================

/**
 * Component node for connections
 */
export interface ComponentNode {
  id: string;
  name: string;
  type: 'left' | 'right' | 'inlet' | 'outlet' | 'bidirectional';
  position: { x: number; y: number };
  nodeNumber: number; // OpenWAM node number
  allowedConnections: ComponentType[];
  maxConnections: number;
}

/**
 * Connection between components
 */
export interface Connection {
  id: string;
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
  isValid: boolean;
  validationErrors?: string[];
}

// ============================================================================
// VALIDATION INTERFACES
// ============================================================================

/**
 * Property validation rule
 */
export interface ValidationRule {
  type: 'min' | 'max' | 'range' | 'pattern' | 'custom';
  value: any;
  message: string;
}

/**
 * Property definition for dynamic forms
 */
export interface PropertyDefinition {
  type: 'number' | 'string' | 'boolean' | 'select' | 'array';
  label: string;
  description?: string;
  unit?: string;
  required: boolean;
  validation: ValidationRule[];
  defaultValue: any;
  options?: SelectOption[];
  dependencies?: PropertyDependency[];
}

/**
 * Select option for dropdown properties
 */
export interface SelectOption {
  value: any;
  label: string;
}

/**
 * Property dependency for conditional display
 */
export interface PropertyDependency {
  property: string;
  condition: any;
  effect: 'show' | 'hide' | 'enable' | 'disable' | 'setValue';
}

/**
 * Property schema for component types
 */
export interface PropertySchema {
  [key: string]: PropertyDefinition;
}

/**
 * Validation error
 */
export interface ValidationError {
  type: 'connection' | 'property' | 'model';
  componentId: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  type: 'isolation' | 'performance' | 'compatibility';
  componentId: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

// ============================================================================
// COMPONENT DEFINITION INTERFACE
// ============================================================================

/**
 * Complete component definition
 */
export interface ComponentDefinition {
  type: ComponentType;
  category: ComponentCategory;
  name: string;
  description: string;
  icon: string;
  nodes: ComponentNode[];
  defaultProperties: ComponentProperties;
  propertySchema: PropertySchema;
  size: { width: number; height: number };
  openWAMClass: string; // Corresponding C++ class name
  connectionRules?: ConnectionRule[];
}

/**
 * Connection rule for validation
 */
export interface ConnectionRule {
  fromType: ComponentType;
  fromPortType: string;
  toType: ComponentType;
  toPortType: string;
  isAllowed: boolean;
  conditions?: ConnectionCondition[];
}

/**
 * Connection condition
 */
export interface ConnectionCondition {
  property: string;
  operator: 'equals' | 'greater' | 'less' | 'range';
  value: any;
  message: string;
}

// ============================================================================
// MODEL INTERFACES
// ============================================================================

/**
 * Model component instance
 */
export interface ModelComponent {
  id: string;
  type: ComponentType;
  position: { x: number; y: number };
  rotation: number;
  properties: ComponentProperties;
  customName?: string;
}

/**
 * Engine model
 */
export interface EngineModel {
  components: ModelComponent[];
  connections: Connection[];
  metadata: {
    name: string;
    description: string;
    created: Date;
    modified: Date;
    version: string;
  };
  validationResult: ValidationResult;
}

/**
 * Model template
 */
export interface ModelTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  model: EngineModel;
  thumbnail: string;
}

/**
 * Component library
 */
export interface ComponentLibrary {
  categories: ComponentCategory[];
  components: ComponentDefinition[];
  connectionRules: ConnectionRule[];
  templates: ModelTemplate[];
}
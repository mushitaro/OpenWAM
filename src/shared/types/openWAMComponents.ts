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
 * Sensor properties based on OpenWAM TSensor class
 */
export interface SensorProperties extends BaseComponentProperties {
  numeroSensor: number;
  tipoSensor: SensorType;
  posicion: { x: number; y: number; z: number };
  resolucion: number;
  rangoMinimo: number;
  rangoMaximo: number;
  filtroTiempo: number;
  offset: number;
  ganancia: number;
  ruido: number;
}

/**
 * Sensor types for VANOS control
 */
export enum SensorType {
  CAM_POSITION_INTAKE = 0,      // Intake cam position sensor
  CAM_POSITION_EXHAUST = 1,     // Exhaust cam position sensor
  CRANK_POSITION = 2,           // Crankshaft position sensor
  PRESSURE = 3,                 // Pressure sensor
  TEMPERATURE = 4,              // Temperature sensor
  FLOW_RATE = 5                 // Flow rate sensor
}

/**
 * Table1D properties based on OpenWAM TTable1D class
 */
export interface Table1DProperties extends BaseComponentProperties {
  numeroTabla: number;
  tipoTabla: TableType;
  interpolacion: InterpolationType;
  extrapolacion: ExtrapolationType;
  datosX: number[];
  datosY: number[];
  unidadX: string;
  unidadY: string;
  descripcion: string;
}

/**
 * Table types for control systems
 */
export enum TableType {
  VANOS_MAP_INTAKE = 0,         // VANOS intake timing map
  VANOS_MAP_EXHAUST = 1,        // VANOS exhaust timing map
  PRESSURE_MAP = 2,             // Pressure map
  TEMPERATURE_MAP = 3,          // Temperature map
  FLOW_MAP = 4                  // Flow map
}

/**
 * Interpolation types for tables
 */
export enum InterpolationType {
  LINEAR = 0,                   // Linear interpolation
  CUBIC_SPLINE = 1,            // Cubic spline interpolation
  POLYNOMIAL = 2                // Polynomial interpolation
}

/**
 * Extrapolation types for tables
 */
export enum ExtrapolationType {
  CONSTANT = 0,                 // Constant extrapolation
  LINEAR = 1,                   // Linear extrapolation
  ZERO = 2                      // Zero extrapolation
}

/**
 * Controller properties based on OpenWAM TController class
 */
export interface ControllerProperties extends BaseComponentProperties {
  numeroController: number;
  tipoController: ControllerType;
  entradas: ControllerInput[];
  salidas: ControllerOutput[];
  parametros: ControllerParameters;
  modoOperacion: OperationMode;
  limitesSeguridad: SafetyLimits;
}

/**
 * Controller types for VANOS system
 */
export enum ControllerType {
  VANOS_MASTER = 0,             // Master VANOS controller
  VANOS_INTAKE = 1,             // Intake VANOS controller
  VANOS_EXHAUST = 2,            // Exhaust VANOS controller
  PRESSURE_CONTROL = 3,         // Pressure controller
  TEMPERATURE_CONTROL = 4       // Temperature controller
}

/**
 * Controller input definition
 */
export interface ControllerInput {
  id: string;
  tipo: InputType;
  sensor: number;
  ganancia: number;
  offset: number;
  filtro: number;
}

/**
 * Controller output definition
 */
export interface ControllerOutput {
  id: string;
  tipo: OutputType;
  actuador: number;
  ganancia: number;
  offset: number;
  limitMin: number;
  limitMax: number;
}

/**
 * Input types for controllers
 */
export enum InputType {
  SENSOR_ANALOG = 0,            // Analog sensor input
  SENSOR_DIGITAL = 1,           // Digital sensor input
  TABLE_LOOKUP = 2,             // Table lookup input
  CALCULATED = 3                // Calculated input
}

/**
 * Output types for controllers
 */
export enum OutputType {
  PWM_SIGNAL = 0,               // PWM output signal
  ANALOG_VOLTAGE = 1,           // Analog voltage output
  DIGITAL_SIGNAL = 2,           // Digital signal output
  VALVE_POSITION = 3            // Valve position command
}

/**
 * Controller parameters
 */
export interface ControllerParameters {
  frecuenciaEjecucion: number;
  tiempoMuestreo: number;
  retardoEjecucion: number;
  modoDebug: boolean;
}

/**
 * Operation modes for controllers
 */
export enum OperationMode {
  AUTOMATIC = 0,                // Automatic control mode
  MANUAL = 1,                   // Manual control mode
  CALIBRATION = 2,              // Calibration mode
  DIAGNOSTIC = 3                // Diagnostic mode
}

/**
 * Safety limits for controllers
 */
export interface SafetyLimits {
  temperaturaMaxima: number;
  presionMaxima: number;
  velocidadMaxima: number;
  tiempoRespuestaMaximo: number;
}

/**
 * PID Controller properties based on OpenWAM TPIDController class
 */
export interface PIDControllerProperties extends BaseComponentProperties {
  numeroPID: number;
  kp: number;                   // Proportional gain
  ki: number;                   // Integral gain
  kd: number;                   // Derivative gain
  setpoint: number;             // Target setpoint
  limiteSalidaMin: number;      // Minimum output limit
  limiteSalidaMax: number;      // Maximum output limit
  limiteIntegralMin: number;    // Minimum integral limit
  limiteIntegralMax: number;    // Maximum integral limit
  tiempoMuestreo: number;       // Sample time
  modoAntiWindup: AntiWindupMode;
  filtroDerivativo: number;     // Derivative filter time constant
  deadband: number;             // Deadband around setpoint
}

/**
 * Anti-windup modes for PID controllers
 */
export enum AntiWindupMode {
  NONE = 0,                     // No anti-windup
  CLAMP = 1,                    // Clamp integral term
  BACK_CALCULATION = 2,         // Back calculation method
  CONDITIONAL_INTEGRATION = 3    // Conditional integration
}

/**
 * Control valve properties based on OpenWAM TValvulaContr class
 */
export interface ControlValveProperties extends BaseComponentProperties {
  numeroValvula: number;
  tipoValvulaControl: ControlValveType;
  diametroNominal: number;
  coeficienteDescarga: number;
  tiempoRespuesta: number;
  posicionMinima: number;
  posicionMaxima: number;
  caracteristicaFlujo: FlowCharacteristic;
  actuador: ActuatorProperties;
  realimentacion: FeedbackProperties;
}

/**
 * Control valve types
 */
export enum ControlValveType {
  HYDRAULIC_VANOS = 0,          // Hydraulic VANOS control valve
  PNEUMATIC = 1,                // Pneumatic control valve
  ELECTRIC = 2,                 // Electric control valve
  PROPORTIONAL = 3              // Proportional control valve
}

/**
 * Flow characteristics for control valves
 */
export enum FlowCharacteristic {
  LINEAR = 0,                   // Linear flow characteristic
  EQUAL_PERCENTAGE = 1,         // Equal percentage characteristic
  QUICK_OPENING = 2,            // Quick opening characteristic
  CUSTOM = 3                    // Custom characteristic
}

/**
 * Actuator properties for control valves
 */
export interface ActuatorProperties {
  tipo: ActuatorType;
  fuerzaMaxima: number;
  velocidadMaxima: number;
  consumoEnergia: number;
  tiempoVida: number;
}

/**
 * Actuator types
 */
export enum ActuatorType {
  HYDRAULIC = 0,                // Hydraulic actuator
  PNEUMATIC = 1,                // Pneumatic actuator
  ELECTRIC = 2,                 // Electric actuator
  PIEZOELECTRIC = 3             // Piezoelectric actuator
}

/**
 * Feedback properties for control valves
 */
export interface FeedbackProperties {
  tipoSensor: FeedbackSensorType;
  resolucion: number;
  precision: number;
  tiempoRespuesta: number;
}

/**
 * Feedback sensor types
 */
export enum FeedbackSensorType {
  POTENTIOMETER = 0,            // Potentiometer position sensor
  LVDT = 1,                     // Linear Variable Differential Transformer
  ENCODER = 2,                  // Rotary encoder
  HALL_EFFECT = 3               // Hall effect sensor
}

/**
 * Pipe-to-plenum connection properties based on OpenWAM TCCDeposito class
 */
export interface PipeToPlenumProperties extends BaseComponentProperties {
  numeroConexion: number;
  tuboPrincipal: number;
  nodoTubo: number;
  plenum: number;
  tipoConexion: ConnectionType;
  diametroConexion: number;
  longitudConexion: number;
  coeficientePerdida: number;
  anguloConexion: number;
  factorCorreccion: number;
}

/**
 * Connection types for pipe-to-plenum connections
 */
export enum ConnectionType {
  DIRECT = 0,                   // Direct connection
  TAPERED = 1,                  // Tapered connection
  SUDDEN_EXPANSION = 2,         // Sudden expansion
  SUDDEN_CONTRACTION = 3,       // Sudden contraction
  CURVED = 4                    // Curved connection
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
  | CompressorProperties
  | SensorProperties
  | Table1DProperties
  | ControllerProperties
  | PIDControllerProperties
  | ControlValveProperties
  | PipeToPlenumProperties;

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
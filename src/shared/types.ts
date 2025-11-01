// Shared types between client and server

import { types } from 'util';

export interface Project {
  id: number;
  name: string;
  description?: string;
  model_data?: string;
  created_at: string;
  updated_at: string;
}

export interface Simulation {
  id: number;
  project_id: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  input_file_path?: string;
  output_file_path?: string;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  progress: number;
}

export interface FileRecord {
  id: number;
  project_id: number;
  filename: string;
  file_path: string;
  file_type?: string;
  file_size: number;
  uploaded_at: string;
}

export interface Template {
  id: number;
  name: string;
  description?: string;
  category: string;
  model_data: string;
  thumbnail?: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Preset {
  id: number;
  name: string;
  description?: string;
  component_type: string;
  properties_data: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectHistory {
  id: number;
  project_id: number;
  version_number: number;
  model_data: string;
  change_description?: string;
  created_at: string;
}

export interface SystemStatus {
  server: {
    status: string;
    uptime: number;
    version: string;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  system: {
    totalMemory: number;
    freeMemory: number;
    cpus: number;
    loadAverage: number[];
  };
  process: {
    memoryUsage: NodeJS.MemoryUsage;
    pid: number;
  };
  timestamp: string;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: any;
  };
}

// Socket.IO event types
export interface SocketEvents {
  // Client to server
  'join:project': (projectId: number) => void;
  'leave:project': (projectId: number) => void;
  'simulation:start': (data: { projectId: number; simulationId: number }) => void;
  'simulation:stop': (data: { simulationId: number }) => void;
  'model:validate': (data: { projectId: number; model: any }) => void;

  // Server to client
  'connected': (data: { socketId: string; timestamp: string }) => void;
  'simulation:started': (data: { simulationId: number; status: string }) => void;
  'simulation:stopped': (data: { simulationId: number; status: string }) => void;
  'simulation:progress': (data: { simulationId: number; progress: number; status?: string; timestamp: string }) => void;
  'simulation:update': (data: { simulationId: number; status: string; progress: number }) => void;
  'simulation:error': (data: { error: string; details?: string }) => void;
  'model:validated': (data: { projectId: number; validation: ValidationResult }) => void;
  'model:validation-error': (data: { error: string; details?: string }) => void;
  'system:status': (data: SystemStatus) => void;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: string;
  componentId?: string;
  message: string;
}

export interface ValidationWarning {
  type: string;
  componentId?: string;
  message: string;
}// Result analysis types
export interface TimeSeriesData {
  time: number[];
  values: number[];
  unit?: string;
  label?: string;
}

export interface ComponentData {
  componentId: string;
  componentType: string;
  pressure?: TimeSeriesData;
  temperature?: TimeSeriesData;
  velocity?: TimeSeriesData;
  massFlow?: TimeSeriesData;
  density?: TimeSeriesData;
}

export interface SimulationResults {
  metadata: {
    simulationId: number;
    projectId: number;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    engineSpeed?: number;
    cycles?: number;
    timeStep?: number;
  };
  components: ComponentData[];
  globalData: {
    time: number[];
    engineTorque?: TimeSeriesData;
    enginePower?: TimeSeriesData;
    fuelConsumption?: TimeSeriesData;
    airFlow?: TimeSeriesData;
    exhaustTemperature?: TimeSeriesData;
  };
  statistics: PerformanceMetrics;
}

export interface PerformanceMetrics {
  maxTorque?: number;
  maxPower?: number;
  meanEffectivePressure?: number;
  volumetricEfficiency?: number;
  thermalEfficiency?: number;
  maxPressure?: number;
  minPressure?: number;
  pressureAmplitude?: number;
  maxVelocity?: number;
  meanVelocity?: number;
  maxTemperature?: number;
  minTemperature?: number;
  meanTemperature?: number;
  specificFuelConsumption?: number;
  fuelFlowRate?: number;
  noxEmissions?: number;
  coEmissions?: number;
  hcEmissions?: number;
  particulateEmissions?: number;
}

export interface ChartData {
  datasets: {
    label: string;
    data: { x: number; y: number; label?: string }[];
    borderColor?: string;
    backgroundColor?: string;
    componentId?: string;
    unit?: string;
  }[];
  xAxis: {
    label: string;
    unit: string;
    min?: number;
    max?: number;
  };
  yAxis: {
    label: string;
    unit: string;
    min?: number;
    max?: number;
  };
}

// Re-export OpenWAM component types
export * from './types/openWAMComponents';
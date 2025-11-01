// Shared constants between client and server

export const API_ENDPOINTS = {
  PROJECTS: '/api/projects',
  SIMULATIONS: '/api/simulations',
  FILES: '/api/files',
  SYSTEM: '/api/system'
} as const;

export const SIMULATION_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export const FILE_TYPES = {
  WAM: '.wam',
  CSV: '.csv',
  JSON: '.json',
  TXT: '.txt',
  DAT: '.dat'
} as const;

export const ALLOWED_FILE_EXTENSIONS = [
  FILE_TYPES.WAM,
  FILE_TYPES.CSV,
  FILE_TYPES.JSON,
  FILE_TYPES.TXT,
  FILE_TYPES.DAT
] as const;

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const DEFAULT_PORTS = {
  SERVER: 5000,
  CLIENT: 3000
} as const;

export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  JOIN_PROJECT: 'join:project',
  LEAVE_PROJECT: 'leave:project',
  SIMULATION_START: 'simulation:start',
  SIMULATION_STOP: 'simulation:stop',
  SIMULATION_PROGRESS: 'simulation:progress',
  MODEL_VALIDATE: 'model:validate'
} as const;
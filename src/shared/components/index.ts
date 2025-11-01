/**
 * OpenWAM Component System - Main Export
 */

// Component definitions and library
export * from './componentDefinitions';
export * from './componentLibrary';

// Validation system
export * from '../validation/componentValidator';
export * from '../validation/connectionRulesEngine';

// Types
export * from '../types/openWAMComponents';

// Default exports for convenience
export { 
  componentLibrary as default,
  getComponentLibrary,
  getComponent,
  createComponent,
  canConnect
} from './componentLibrary';

export {
  createValidator,
  validateConnection,
  validateModel
} from '../validation/componentValidator';

export {
  createAdvancedRulesEngine,
  validateModelWithAdvancedRules,
  AdvancedConnectionRulesEngine,
  NodeSystemValidator,
  CircularReferenceDetector,
  DuplicateConnectionDetector
} from '../validation/connectionRulesEngine';
/**
 * Component Management Services
 * Exports all component management system functionality
 */

// Core Component Management System
export {
  ComponentManagementSystem,
  ImplementationStatus,
  Priority,
  QualityCheckType,
  ComponentImplementationRecord,
  QualityCheckResult,
  ChecklistItem,
  ComponentChecklist,
  ImplementationProgressReport,
  componentManagementSystem,
  getComponentManagementSystem,
  runComponentQualityChecks,
  getImplementationProgressReport,
  updateComponentStatus
} from './ComponentManagementSystem';

// Documentation Updater
export {
  DocumentationUpdater,
  createDocumentationUpdater,
  updateAllDocumentation
} from './DocumentationUpdater';

// Setup and Utilities
export {
  initializeComponentStatus,
  runInitialQualityChecks,
  generateInitialDocumentation,
  setupCLIScripts,
  displaySetupSummary,
  setupComponentManagement
} from '../scripts/setupComponentManagement';

// CLI Tool (for programmatic access)
export { program as componentManagerCLI } from '../cli/ComponentManagerCLI';
#!/usr/bin/env node

/**
 * Setup Script for Component Management System
 * Initializes the component management system and generates initial documentation
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  ComponentManagementSystem,
  ImplementationStatus,
  getComponentManagementSystem,
  updateComponentStatus
} from '../services/ComponentManagementSystem';

import {
  DocumentationUpdater,
  createDocumentationUpdater
} from '../services/DocumentationUpdater';

import { ComponentType } from '../types/openWAMComponents';

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Initialize component management system with current implementation status
 */
async function initializeComponentStatus(): Promise<void> {
  console.log('🔧 Initializing Component Management System...');
  
  const managementSystem = getComponentManagementSystem();
  
  // Mark currently implemented components as completed
  const implementedComponents = [
    ComponentType.PIPE,
    ComponentType.OPEN_END_ATMOSPHERE,
    ComponentType.CLOSED_END,
    ComponentType.ANECHOIC_END,
    ComponentType.BRANCH,
    ComponentType.CONSTANT_VOLUME_PLENUM,
    ComponentType.VARIABLE_VOLUME_PLENUM,
    ComponentType.SIMPLE_TURBINE,
    ComponentType.FIXED_CD_VALVE,
    ComponentType.VALVE_4T,
    ComponentType.REED_VALVE,
    ComponentType.BUTTERFLY_VALVE,
    ComponentType.ENGINE_BLOCK,
    ComponentType.CYLINDER_4T,
    ComponentType.CYLINDER_2T,
    ComponentType.DPF,
    ComponentType.SENSOR,
    ComponentType.TABLE_1D,
    ComponentType.CONTROLLER,
    ComponentType.PID_CONTROLLER,
    ComponentType.CONTROL_VALVE,
    ComponentType.PIPE_TO_PLENUM
  ];

  implementedComponents.forEach(componentType => {
    updateComponentStatus(
      componentType,
      ImplementationStatus.COMPLETED,
      'System',
      'Marked as completed during system initialization'
    );
  });

  // Mark some components as tested
  const testedComponents = [
    ComponentType.PIPE,
    ComponentType.OPEN_END_ATMOSPHERE,
    ComponentType.CLOSED_END,
    ComponentType.CONSTANT_VOLUME_PLENUM,
    ComponentType.ENGINE_BLOCK,
    ComponentType.CYLINDER_4T
  ];

  testedComponents.forEach(componentType => {
    managementSystem.updateTestStatus(
      componentType,
      ImplementationStatus.TESTED,
      80 // Assume 80% test coverage
    );
  });

  // Mark some components as documented
  const documentedComponents = [
    ComponentType.PIPE,
    ComponentType.ENGINE_BLOCK,
    ComponentType.SENSOR,
    ComponentType.CONTROLLER
  ];

  documentedComponents.forEach(componentType => {
    managementSystem.updateDocumentationStatus(
      componentType,
      ImplementationStatus.DOCUMENTED
    );
  });

  console.log('✅ Component status initialized');
}

/**
 * Run quality checks for all implemented components
 */
async function runInitialQualityChecks(): Promise<void> {
  console.log('🔍 Running initial quality checks...');
  
  const managementSystem = getComponentManagementSystem();
  const results = managementSystem.runAllQualityChecks();
  
  console.log(`✅ Quality checks completed for ${results.size} components`);
  
  // Log summary
  let totalChecks = 0;
  let passedChecks = 0;
  
  results.forEach((checkResults, componentType) => {
    totalChecks += checkResults.length;
    passedChecks += checkResults.filter(r => r.status === 'pass').length;
  });
  
  const passRate = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0;
  console.log(`📊 Overall quality score: ${passRate.toFixed(1)}% (${passedChecks}/${totalChecks} checks passed)`);
}

/**
 * Generate initial documentation
 */
async function generateInitialDocumentation(): Promise<void> {
  console.log('📚 Generating initial documentation...');
  
  const managementSystem = getComponentManagementSystem();
  const docsPath = path.resolve(process.cwd(), 'docs');
  
  // Ensure docs directory exists
  if (!fs.existsSync(docsPath)) {
    fs.mkdirSync(docsPath, { recursive: true });
  }
  
  const updater = createDocumentationUpdater(managementSystem, docsPath);
  
  try {
    await updater.updateAllDocumentation();
    console.log('✅ Documentation generated successfully');
    
    console.log('\n📄 Generated files:');
    console.log(`  - ${path.join(docsPath, 'component-implementation-status.md')}`);
    console.log(`  - ${path.join(docsPath, 'component-reference.md')}`);
    console.log(`  - ${path.join(docsPath, 'vanos-implementation-roadmap.md')}`);
    
  } catch (error) {
    console.error('❌ Error generating documentation:', error.message);
    throw error;
  }
}

/**
 * Create CLI scripts in package.json
 */
async function setupCLIScripts(): Promise<void> {
  console.log('⚙️ Setting up CLI scripts...');
  
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.log('⚠️ package.json not found, skipping CLI setup');
    return;
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    // Add component management scripts
    packageJson.scripts['component-manager'] = 'ts-node src/shared/cli/ComponentManagerCLI.ts';
    packageJson.scripts['component-status'] = 'npm run component-manager status';
    packageJson.scripts['component-check'] = 'npm run component-manager check --all';
    packageJson.scripts['component-docs'] = 'npm run component-manager docs --all';
    packageJson.scripts['component-setup'] = 'ts-node src/shared/scripts/setupComponentManagement.ts';
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ CLI scripts added to package.json');
    
    console.log('\n🚀 Available commands:');
    console.log('  npm run component-manager status    # Show implementation status');
    console.log('  npm run component-manager check     # Run quality checks');
    console.log('  npm run component-manager docs      # Update documentation');
    console.log('  npm run component-status            # Quick status check');
    console.log('  npm run component-check             # Quick quality check');
    console.log('  npm run component-docs              # Quick doc update');
    
  } catch (error) {
    console.error('❌ Error setting up CLI scripts:', error.message);
    // Don't throw - this is not critical
  }
}

/**
 * Display setup summary
 */
async function displaySetupSummary(): Promise<void> {
  console.log('\n📊 Setup Summary');
  console.log('================');
  
  const managementSystem = getComponentManagementSystem();
  const report = managementSystem.generateProgressReport();
  
  console.log(`Total Components: ${report.totalComponents}`);
  console.log(`Completed: ${report.completedComponents} (${report.completionPercentage.toFixed(1)}%)`);
  console.log(`In Progress: ${report.inProgressComponents}`);
  console.log(`Not Started: ${report.notStartedComponents}`);
  
  console.log('\nQuality Metrics:');
  console.log(`  Average Test Coverage: ${report.qualityMetrics.averageTestCoverage.toFixed(1)}%`);
  console.log(`  Components with Documentation: ${report.qualityMetrics.componentsWithDocumentation}`);
  console.log(`  Fully Validated Components: ${report.qualityMetrics.componentsWithFullValidation}`);
  
  if (report.blockedComponents.length > 0) {
    console.log(`\n⚠️ Blocked Components: ${report.blockedComponents.length}`);
    report.blockedComponents.slice(0, 3).forEach(component => {
      console.log(`  - ${component.componentType} (depends on: ${component.dependencies.join(', ')})`);
    });
    if (report.blockedComponents.length > 3) {
      console.log(`  ... and ${report.blockedComponents.length - 3} more`);
    }
  }
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Review generated documentation in docs/ folder');
  console.log('2. Use "npm run component-manager status" to check current status');
  console.log('3. Use "npm run component-manager update" to update component status');
  console.log('4. Use "npm run component-manager docs" to regenerate documentation');
  console.log('5. Set up automated documentation updates in CI/CD pipeline');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  console.log('🚀 Setting up Component Management System\n');
  
  try {
    await initializeComponentStatus();
    await runInitialQualityChecks();
    await generateInitialDocumentation();
    await setupCLIScripts();
    await displaySetupSummary();
    
    console.log('\n✅ Component Management System setup completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error during setup:', error);
    process.exit(1);
  });
}

export {
  initializeComponentStatus,
  runInitialQualityChecks,
  generateInitialDocumentation,
  setupCLIScripts,
  displaySetupSummary,
  main as setupComponentManagement
};
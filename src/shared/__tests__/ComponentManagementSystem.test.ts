/**
 * Tests for Component Management System
 */

import {
  ComponentManagementSystem,
  ImplementationStatus,
  Priority,
  QualityCheckType,
  ComponentImplementationRecord,
  QualityCheckResult,
  ChecklistItem,
  ComponentChecklist,
  ImplementationProgressReport
} from '../services/ComponentManagementSystem';

import { ComponentType, ComponentCategory } from '../types/openWAMComponents';

describe('Component Management System', () => {
  let managementSystem: ComponentManagementSystem;

  beforeEach(() => {
    managementSystem = new ComponentManagementSystem();
  });

  describe('Initialization', () => {
    test('should initialize with all component types', () => {
      const allRecords = managementSystem.getAllImplementationRecords();
      expect(allRecords.length).toBeGreaterThan(0);
      
      // Check that all component types are represented
      const componentTypes = allRecords.map(record => record.componentType);
      expect(componentTypes).toContain(ComponentType.PIPE);
      expect(componentTypes).toContain(ComponentType.SENSOR);
      expect(componentTypes).toContain(ComponentType.CONTROLLER);
    });

    test('should set correct initial status for implemented components', () => {
      const pipeRecord = managementSystem.getImplementationRecord(ComponentType.PIPE);
      expect(pipeRecord).toBeDefined();
      expect(pipeRecord?.status).toBe(ImplementationStatus.COMPLETED);
    });

    test('should set correct initial status for unimplemented components', () => {
      // Find a component that should not be implemented
      const allRecords = managementSystem.getAllImplementationRecords();
      const unimplementedRecord = allRecords.find(r => r.status === ImplementationStatus.NOT_STARTED);
      expect(unimplementedRecord).toBeDefined();
    });

    test('should assign correct priorities', () => {
      const sensorRecord = managementSystem.getImplementationRecord(ComponentType.SENSOR);
      expect(sensorRecord?.priority).toBe(Priority.HIGH);
      
      const pipeRecord = managementSystem.getImplementationRecord(ComponentType.PIPE);
      expect(pipeRecord?.priority).toBe(Priority.HIGH);
    });

    test('should create checklists for all components', () => {
      const pipeChecklist = managementSystem.getChecklist(ComponentType.PIPE);
      expect(pipeChecklist).toBeDefined();
      expect(pipeChecklist?.items.length).toBeGreaterThan(0);
      
      // Check required checklist items
      const requiredItems = pipeChecklist?.items.filter(item => item.required);
      expect(requiredItems?.length).toBeGreaterThan(0);
    });
  });

  describe('Implementation Status Management', () => {
    test('should update implementation status', () => {
      const componentType = ComponentType.SENSOR;
      const initialRecord = managementSystem.getImplementationRecord(componentType);
      const initialStatus = initialRecord?.status;

      managementSystem.updateImplementationStatus(
        componentType,
        ImplementationStatus.IN_PROGRESS,
        'test-user',
        'Starting implementation'
      );

      const updatedRecord = managementSystem.getImplementationRecord(componentType);
      expect(updatedRecord?.status).toBe(ImplementationStatus.IN_PROGRESS);
      expect(updatedRecord?.assignee).toBe('test-user');
      expect(updatedRecord?.notes.length).toBeGreaterThan(0);
      expect(updatedRecord?.lastUpdated).toBeInstanceOf(Date);
    });

    test('should set implementation date when completed', () => {
      const componentType = ComponentType.TABLE_1D;
      
      // First set to not started, then to completed to trigger the date setting
      managementSystem.updateImplementationStatus(
        componentType,
        ImplementationStatus.NOT_STARTED
      );
      
      managementSystem.updateImplementationStatus(
        componentType,
        ImplementationStatus.COMPLETED
      );

      const record = managementSystem.getImplementationRecord(componentType);
      expect(record?.implementationDate).toBeInstanceOf(Date);
    });

    test('should run quality checks when completed', () => {
      const componentType = ComponentType.CONTROLLER;
      
      managementSystem.updateImplementationStatus(
        componentType,
        ImplementationStatus.COMPLETED
      );

      const record = managementSystem.getImplementationRecord(componentType);
      expect(record?.qualityChecks.length).toBeGreaterThan(0);
    });

    test('should update test status', () => {
      const componentType = ComponentType.PID_CONTROLLER;
      
      managementSystem.updateTestStatus(
        componentType,
        ImplementationStatus.TESTED,
        85
      );

      const record = managementSystem.getImplementationRecord(componentType);
      expect(record?.testStatus).toBe(ImplementationStatus.TESTED);
      
      const testCheck = record?.qualityChecks.find(check => check.type === QualityCheckType.UNIT_TESTS);
      expect(testCheck?.coverage).toBe(85);
    });

    test('should update documentation status', () => {
      const componentType = ComponentType.CONTROL_VALVE;
      
      managementSystem.updateDocumentationStatus(
        componentType,
        ImplementationStatus.DOCUMENTED
      );

      const record = managementSystem.getImplementationRecord(componentType);
      expect(record?.documentationStatus).toBe(ImplementationStatus.DOCUMENTED);
    });

    test('should throw error for invalid component type', () => {
      expect(() => {
        managementSystem.updateImplementationStatus(
          'INVALID_TYPE' as ComponentType,
          ImplementationStatus.COMPLETED
        );
      }).toThrow();
    });
  });

  describe('Record Filtering', () => {
    beforeEach(() => {
      // Set up some test data
      managementSystem.updateImplementationStatus(ComponentType.SENSOR, ImplementationStatus.COMPLETED);
      managementSystem.updateImplementationStatus(ComponentType.TABLE_1D, ImplementationStatus.IN_PROGRESS);
      managementSystem.updateImplementationStatus(ComponentType.CONTROLLER, ImplementationStatus.NOT_STARTED);
    });

    test('should filter records by status', () => {
      const completedRecords = managementSystem.getRecordsByStatus(ImplementationStatus.COMPLETED);
      expect(completedRecords.length).toBeGreaterThan(0);
      expect(completedRecords.every(r => r.status === ImplementationStatus.COMPLETED)).toBe(true);

      const inProgressRecords = managementSystem.getRecordsByStatus(ImplementationStatus.IN_PROGRESS);
      expect(inProgressRecords.some(r => r.componentType === ComponentType.TABLE_1D)).toBe(true);
    });

    test('should filter records by priority', () => {
      const highPriorityRecords = managementSystem.getRecordsByPriority(Priority.HIGH);
      expect(highPriorityRecords.length).toBeGreaterThan(0);
      expect(highPriorityRecords.every(r => r.priority === Priority.HIGH)).toBe(true);
    });

    test('should filter records by category', () => {
      const controlRecords = managementSystem.getRecordsByCategory(ComponentCategory.CONTROL);
      expect(controlRecords.length).toBeGreaterThan(0);
      expect(controlRecords.every(r => r.category === ComponentCategory.CONTROL)).toBe(true);
    });
  });

  describe('Quality Verification', () => {
    test('should run quality checks for implemented component', () => {
      const componentType = ComponentType.PIPE;
      const results = managementSystem.runQualityChecks(componentType);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(result => result.checkedAt instanceof Date)).toBe(true);
      
      // Should have all quality check types
      const checkTypes = results.map(r => r.type);
      expect(checkTypes).toContain(QualityCheckType.TYPE_DEFINITIONS);
      expect(checkTypes).toContain(QualityCheckType.PROPERTY_SCHEMA);
      expect(checkTypes).toContain(QualityCheckType.DEFAULT_VALUES);
    });

    test('should return failure for non-existent component', () => {
      // Create a component type that doesn't have a definition
      const results = managementSystem.runQualityChecks('NON_EXISTENT' as ComponentType);
      
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('fail');
      expect(results[0].message).toContain('Component definition not found');
    });

    test('should run quality checks for all completed components', () => {
      // Mark some components as completed
      managementSystem.updateImplementationStatus(ComponentType.PIPE, ImplementationStatus.COMPLETED);
      managementSystem.updateImplementationStatus(ComponentType.SENSOR, ImplementationStatus.COMPLETED);
      
      const allResults = managementSystem.runAllQualityChecks();
      
      expect(allResults.size).toBeGreaterThan(0);
      expect(allResults.has(ComponentType.PIPE)).toBe(true);
    });

    test('should get quality check results for component', () => {
      const componentType = ComponentType.CONSTANT_VOLUME_PLENUM;
      
      // First run quality checks
      managementSystem.runQualityChecks(componentType);
      
      // Then get results
      const results = managementSystem.getQualityCheckResults(componentType);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Checklist Management', () => {
    test('should create checklist with required items', () => {
      const checklist = managementSystem.getChecklist(ComponentType.PIPE);
      
      expect(checklist).toBeDefined();
      expect(checklist?.items.length).toBeGreaterThan(0);
      
      // Should have required items
      const requiredItems = checklist?.items.filter(item => item.required);
      expect(requiredItems?.length).toBeGreaterThan(0);
      
      // Should have specific quality check types
      const itemTypes = checklist?.items.map(item => item.type);
      expect(itemTypes).toContain(QualityCheckType.TYPE_DEFINITIONS);
      expect(itemTypes).toContain(QualityCheckType.PROPERTY_SCHEMA);
    });

    test('should mark checklist item as completed', () => {
      const componentType = ComponentType.SENSOR;
      const itemId = 'type-definitions';
      
      managementSystem.markChecklistItemCompleted(
        componentType,
        itemId,
        'test-user',
        'Completed via test'
      );

      const checklist = managementSystem.getChecklist(componentType);
      const item = checklist?.items.find(item => item.id === itemId);
      
      expect(item?.completed).toBe(true);
      expect(item?.completedBy).toBe('test-user');
      expect(item?.completedAt).toBeInstanceOf(Date);
      expect(item?.notes).toBe('Completed via test');
    });

    test('should update completion percentage', () => {
      const componentType = ComponentType.TABLE_1D;
      const checklist = managementSystem.getChecklist(componentType);
      const initialPercentage = checklist?.completionPercentage || 0;
      
      // Mark first item as completed
      const firstItem = checklist?.items[0];
      if (firstItem) {
        managementSystem.markChecklistItemCompleted(componentType, firstItem.id);
        
        const updatedChecklist = managementSystem.getChecklist(componentType);
        expect(updatedChecklist?.completionPercentage).toBeGreaterThan(initialPercentage);
      }
    });

    test('should throw error for invalid checklist item', () => {
      expect(() => {
        managementSystem.markChecklistItemCompleted(
          ComponentType.CONTROLLER,
          'invalid-item-id'
        );
      }).toThrow();
    });
  });

  describe('Progress Reporting', () => {
    beforeEach(() => {
      // Set up test data
      managementSystem.updateImplementationStatus(ComponentType.PIPE, ImplementationStatus.COMPLETED);
      managementSystem.updateImplementationStatus(ComponentType.SENSOR, ImplementationStatus.COMPLETED);
      managementSystem.updateImplementationStatus(ComponentType.TABLE_1D, ImplementationStatus.IN_PROGRESS);
      managementSystem.updateTestStatus(ComponentType.PIPE, ImplementationStatus.TESTED, 90);
      managementSystem.updateDocumentationStatus(ComponentType.SENSOR, ImplementationStatus.DOCUMENTED);
    });

    test('should generate comprehensive progress report', () => {
      const report = managementSystem.generateProgressReport();
      
      expect(report.totalComponents).toBeGreaterThan(0);
      expect(report.completedComponents).toBeGreaterThan(0);
      expect(report.completionPercentage).toBeGreaterThanOrEqual(0);
      expect(report.completionPercentage).toBeLessThanOrEqual(100);
      
      expect(report.categoryBreakdown).toBeDefined();
      expect(report.priorityBreakdown).toBeDefined();
      expect(report.qualityMetrics).toBeDefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    test('should calculate category breakdown correctly', () => {
      const report = managementSystem.generateProgressReport();
      
      // Should have all categories
      expect(report.categoryBreakdown[ComponentCategory.PIPES]).toBeDefined();
      expect(report.categoryBreakdown[ComponentCategory.CONTROL]).toBeDefined();
      
      // Each category should have total, completed, and percentage
      Object.values(report.categoryBreakdown).forEach(categoryData => {
        expect(categoryData.total).toBeGreaterThanOrEqual(0);
        expect(categoryData.completed).toBeGreaterThanOrEqual(0);
        expect(categoryData.percentage).toBeGreaterThanOrEqual(0);
        expect(categoryData.percentage).toBeLessThanOrEqual(100);
      });
    });

    test('should calculate priority breakdown correctly', () => {
      const report = managementSystem.generateProgressReport();
      
      // Should have all priorities
      expect(report.priorityBreakdown[Priority.HIGH]).toBeDefined();
      expect(report.priorityBreakdown[Priority.MEDIUM]).toBeDefined();
      expect(report.priorityBreakdown[Priority.LOW]).toBeDefined();
      
      // Each priority should have total, completed, and percentage
      Object.values(report.priorityBreakdown).forEach(priorityData => {
        expect(priorityData.total).toBeGreaterThanOrEqual(0);
        expect(priorityData.completed).toBeGreaterThanOrEqual(0);
        expect(priorityData.percentage).toBeGreaterThanOrEqual(0);
        expect(priorityData.percentage).toBeLessThanOrEqual(100);
      });
    });

    test('should calculate quality metrics', () => {
      const report = managementSystem.generateProgressReport();
      
      expect(report.qualityMetrics.averageTestCoverage).toBeGreaterThanOrEqual(0);
      expect(report.qualityMetrics.componentsWithDocumentation).toBeGreaterThanOrEqual(0);
      expect(report.qualityMetrics.componentsWithFullValidation).toBeGreaterThanOrEqual(0);
    });

    test('should identify blocked components', () => {
      const report = managementSystem.generateProgressReport();
      
      expect(Array.isArray(report.blockedComponents)).toBe(true);
      
      // Blocked components should have incomplete dependencies
      report.blockedComponents.forEach(component => {
        expect(component.dependencies.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Data Export', () => {
    test('should export implementation data', () => {
      const exportData = managementSystem.exportImplementationData();
      
      expect(exportData.records).toBeDefined();
      expect(exportData.checklists).toBeDefined();
      expect(exportData.report).toBeDefined();
      
      expect(Array.isArray(exportData.records)).toBe(true);
      expect(Array.isArray(exportData.checklists)).toBe(true);
      expect(exportData.records.length).toBeGreaterThan(0);
    });

    test('should include all necessary data in export', () => {
      const exportData = managementSystem.exportImplementationData();
      
      // Check records structure
      const firstRecord = exportData.records[0];
      expect(firstRecord.componentType).toBeDefined();
      expect(firstRecord.status).toBeDefined();
      expect(firstRecord.priority).toBeDefined();
      expect(firstRecord.lastUpdated).toBeInstanceOf(Date);
      
      // Check checklists structure
      if (exportData.checklists.length > 0) {
        const firstChecklist = exportData.checklists[0];
        expect(firstChecklist.componentType).toBeDefined();
        expect(firstChecklist.items).toBeDefined();
        expect(firstChecklist.completionPercentage).toBeDefined();
      }
      
      // Check report structure
      expect(exportData.report.totalComponents).toBeDefined();
      expect(exportData.report.completionPercentage).toBeDefined();
      expect(exportData.report.categoryBreakdown).toBeDefined();
    });
  });

  describe('Quality Check Implementations', () => {
    test('should check type definitions correctly', () => {
      const componentType = ComponentType.PIPE;
      const results = managementSystem.runQualityChecks(componentType);
      
      const typeDefCheck = results.find(r => r.type === QualityCheckType.TYPE_DEFINITIONS);
      expect(typeDefCheck).toBeDefined();
      expect(typeDefCheck?.status).toBe('pass'); // Pipe should have complete type definitions
    });

    test('should check property schema correctly', () => {
      const componentType = ComponentType.CONSTANT_VOLUME_PLENUM;
      const results = managementSystem.runQualityChecks(componentType);
      
      const schemaCheck = results.find(r => r.type === QualityCheckType.PROPERTY_SCHEMA);
      expect(schemaCheck).toBeDefined();
      expect(['pass', 'warning', 'fail']).toContain(schemaCheck?.status);
    });

    test('should check default values correctly', () => {
      const componentType = ComponentType.VALVE_4T;
      const results = managementSystem.runQualityChecks(componentType);
      
      const defaultsCheck = results.find(r => r.type === QualityCheckType.DEFAULT_VALUES);
      expect(defaultsCheck).toBeDefined();
      expect(['pass', 'warning', 'fail']).toContain(defaultsCheck?.status);
    });

    test('should check OpenWAM compliance correctly', () => {
      const componentType = ComponentType.ENGINE_BLOCK;
      const results = managementSystem.runQualityChecks(componentType);
      
      const complianceCheck = results.find(r => r.type === QualityCheckType.OPENWAM_COMPLIANCE);
      expect(complianceCheck).toBeDefined();
      expect(['pass', 'warning', 'fail']).toContain(complianceCheck?.status);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing component gracefully', () => {
      const record = managementSystem.getImplementationRecord('INVALID' as ComponentType);
      expect(record).toBeUndefined();
    });

    test('should handle missing checklist gracefully', () => {
      const checklist = managementSystem.getChecklist('INVALID' as ComponentType);
      expect(checklist).toBeUndefined();
    });

    test('should handle quality check errors gracefully', () => {
      const results = managementSystem.runQualityChecks('INVALID' as ComponentType);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].status).toBe('fail');
    });
  });

  describe('Integration with Component Library', () => {
    test('should correctly identify implemented components', () => {
      const pipeRecord = managementSystem.getImplementationRecord(ComponentType.PIPE);
      expect(pipeRecord?.status).toBe(ImplementationStatus.COMPLETED);
    });

    test('should correctly categorize components', () => {
      const sensorRecord = managementSystem.getImplementationRecord(ComponentType.SENSOR);
      expect(sensorRecord?.category).toBe(ComponentCategory.CONTROL);
      
      const pipeRecord = managementSystem.getImplementationRecord(ComponentType.PIPE);
      expect(pipeRecord?.category).toBe(ComponentCategory.PIPES);
    });

    test('should map OpenWAM classes correctly', () => {
      const pipeRecord = managementSystem.getImplementationRecord(ComponentType.PIPE);
      expect(pipeRecord?.openWAMClass).toBe('TTubo');
      
      const sensorRecord = managementSystem.getImplementationRecord(ComponentType.SENSOR);
      expect(sensorRecord?.openWAMClass).toBe('TSensor');
    });
  });
});
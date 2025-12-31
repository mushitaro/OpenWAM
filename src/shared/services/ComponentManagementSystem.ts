/**
 * Component Management System
 * Tracks component implementation status, manages checklists, and automates quality verification
 */

import {
  ComponentType,
  ComponentCategory,
  ComponentDefinition,
  ValidationResult
} from '../types/openWAMComponents';

import { componentDefinitions } from '../components/componentDefinitions';
import { componentLibrary } from '../components/componentLibrary';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Implementation status levels
 */
export enum ImplementationStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  TESTED = 'tested',
  DOCUMENTED = 'documented',
  DEPRECATED = 'deprecated'
}

/**
 * Priority levels for component implementation
 */
export enum Priority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

/**
 * Quality check types
 */
export enum QualityCheckType {
  TYPE_DEFINITIONS = 'type_definitions',
  PROPERTY_SCHEMA = 'property_schema',
  DEFAULT_VALUES = 'default_values',
  VALIDATION_RULES = 'validation_rules',
  CONNECTION_RULES = 'connection_rules',
  UNIT_TESTS = 'unit_tests',
  INTEGRATION_TESTS = 'integration_tests',
  DOCUMENTATION = 'documentation',
  OPENWAM_COMPLIANCE = 'openwam_compliance'
}

/**
 * Component implementation tracking record
 */
export interface ComponentImplementationRecord {
  componentType: ComponentType;
  category: ComponentCategory;
  openWAMClass: string;
  status: ImplementationStatus;
  priority: Priority;
  implementationDate?: Date;
  assignee?: string;
  testStatus: ImplementationStatus;
  documentationStatus: ImplementationStatus;
  qualityChecks: QualityCheckResult[];
  dependencies: ComponentType[];
  estimatedEffort: number; // in days
  actualEffort?: number; // in days
  notes: string[];
  lastUpdated: Date;
}

/**
 * Quality check result
 */
export interface QualityCheckResult {
  type: QualityCheckType;
  status: 'pass' | 'fail' | 'warning' | 'not_run';
  message: string;
  details?: any;
  checkedAt: Date;
  coverage?: number; // for test coverage
}

/**
 * Implementation checklist item
 */
export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  type: QualityCheckType;
  required: boolean;
  completed: boolean;
  completedAt?: Date;
  completedBy?: string;
  notes?: string;
}

/**
 * Component implementation checklist
 */
export interface ComponentChecklist {
  componentType: ComponentType;
  items: ChecklistItem[];
  completionPercentage: number;
  lastUpdated: Date;
}

/**
 * Implementation progress report
 */
export interface ImplementationProgressReport {
  totalComponents: number;
  completedComponents: number;
  inProgressComponents: number;
  notStartedComponents: number;
  completionPercentage: number;
  categoryBreakdown: Record<ComponentCategory, {
    total: number;
    completed: number;
    percentage: number;
  }>;
  priorityBreakdown: Record<Priority, {
    total: number;
    completed: number;
    percentage: number;
  }>;
  qualityMetrics: {
    averageTestCoverage: number;
    componentsWithDocumentation: number;
    componentsWithFullValidation: number;
  };
  upcomingDeadlines: ComponentImplementationRecord[];
  blockedComponents: ComponentImplementationRecord[];
  generatedAt: Date;
}

// ============================================================================
// COMPONENT MANAGEMENT SYSTEM CLASS
// ============================================================================

export class ComponentManagementSystem {
  private implementationRecords: Map<ComponentType, ComponentImplementationRecord> = new Map();
  private checklists: Map<ComponentType, ComponentChecklist> = new Map();
  private qualityRules: Map<QualityCheckType, (component: ComponentDefinition) => QualityCheckResult> = new Map();

  constructor() {
    this.initializeImplementationRecords();
    this.initializeQualityRules();
    this.generateChecklists();
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize implementation records for all known components
   */
  private initializeImplementationRecords(): void {
    // Get all possible component types from the enum
    const allComponentTypes = Object.values(ComponentType);
    
    allComponentTypes.forEach(componentType => {
      if (!this.implementationRecords.has(componentType)) {
        const definition = componentLibrary.getComponent(componentType);
        const record: ComponentImplementationRecord = {
          componentType,
          category: this.getCategoryForComponent(componentType),
          openWAMClass: this.getOpenWAMClassForComponent(componentType),
          status: definition ? ImplementationStatus.COMPLETED : ImplementationStatus.NOT_STARTED,
          priority: this.calculatePriority(componentType),
          testStatus: ImplementationStatus.NOT_STARTED,
          documentationStatus: ImplementationStatus.NOT_STARTED,
          qualityChecks: [],
          dependencies: this.getDependencies(componentType),
          estimatedEffort: this.estimateEffort(componentType),
          notes: [],
          lastUpdated: new Date()
        };

        this.implementationRecords.set(componentType, record);
      }
    });
  }

  /**
   * Initialize quality check rules
   */
  private initializeQualityRules(): void {
    this.qualityRules.set(QualityCheckType.TYPE_DEFINITIONS, this.checkTypeDefinitions.bind(this));
    this.qualityRules.set(QualityCheckType.PROPERTY_SCHEMA, this.checkPropertySchema.bind(this));
    this.qualityRules.set(QualityCheckType.DEFAULT_VALUES, this.checkDefaultValues.bind(this));
    this.qualityRules.set(QualityCheckType.VALIDATION_RULES, this.checkValidationRules.bind(this));
    this.qualityRules.set(QualityCheckType.CONNECTION_RULES, this.checkConnectionRules.bind(this));
    this.qualityRules.set(QualityCheckType.UNIT_TESTS, this.checkUnitTests.bind(this));
    this.qualityRules.set(QualityCheckType.INTEGRATION_TESTS, this.checkIntegrationTests.bind(this));
    this.qualityRules.set(QualityCheckType.DOCUMENTATION, this.checkDocumentation.bind(this));
    this.qualityRules.set(QualityCheckType.OPENWAM_COMPLIANCE, this.checkOpenWAMCompliance.bind(this));
  }

  /**
   * Generate checklists for all components
   */
  private generateChecklists(): void {
    this.implementationRecords.forEach((record, componentType) => {
      if (!this.checklists.has(componentType)) {
        this.checklists.set(componentType, this.createChecklist(componentType));
      }
    });
  }

  // ============================================================================
  // IMPLEMENTATION TRACKING
  // ============================================================================

  /**
   * Update component implementation status
   */
  updateImplementationStatus(
    componentType: ComponentType,
    status: ImplementationStatus,
    assignee?: string,
    notes?: string
  ): void {
    const record = this.implementationRecords.get(componentType);
    if (!record) {
      throw new Error(`Component ${componentType} not found in tracking system`);
    }

    const previousStatus = record.status;
    record.status = status;
    record.lastUpdated = new Date();

    if (assignee) {
      record.assignee = assignee;
    }

    if (notes) {
      record.notes.push(`${new Date().toISOString()}: ${notes}`);
    }

    if (status === ImplementationStatus.COMPLETED && previousStatus !== ImplementationStatus.COMPLETED) {
      record.implementationDate = new Date();
    }
    
    // Automatically run quality checks for completed components
    if (status === ImplementationStatus.COMPLETED) {
      this.runQualityChecks(componentType);
    }

    // Update checklist
    this.updateChecklistProgress(componentType);
  }

  /**
   * Update test status for a component
   */
  updateTestStatus(
    componentType: ComponentType,
    status: ImplementationStatus,
    coverage?: number
  ): void {
    const record = this.implementationRecords.get(componentType);
    if (!record) {
      throw new Error(`Component ${componentType} not found in tracking system`);
    }

    record.testStatus = status;
    record.lastUpdated = new Date();

    // Update quality check results
    if (coverage !== undefined) {
      let testCheck = record.qualityChecks.find(check => check.type === QualityCheckType.UNIT_TESTS);
      if (!testCheck) {
        // Create new test check if it doesn't exist
        testCheck = {
          type: QualityCheckType.UNIT_TESTS,
          status: 'not_run',
          message: 'Unit tests not yet implemented',
          coverage: 0,
          checkedAt: new Date()
        };
        record.qualityChecks.push(testCheck);
      }
      
      testCheck.coverage = coverage;
      testCheck.status = coverage >= 80 ? 'pass' : coverage >= 60 ? 'warning' : 'fail';
      testCheck.message = `Test coverage: ${coverage}%`;
      testCheck.checkedAt = new Date();
    }

    this.updateChecklistProgress(componentType);
  }

  /**
   * Update documentation status for a component
   */
  updateDocumentationStatus(
    componentType: ComponentType,
    status: ImplementationStatus
  ): void {
    const record = this.implementationRecords.get(componentType);
    if (!record) {
      throw new Error(`Component ${componentType} not found in tracking system`);
    }

    record.documentationStatus = status;
    record.lastUpdated = new Date();

    this.updateChecklistProgress(componentType);
  }

  /**
   * Get implementation record for a component
   */
  getImplementationRecord(componentType: ComponentType): ComponentImplementationRecord | undefined {
    return this.implementationRecords.get(componentType);
  }

  /**
   * Get all implementation records
   */
  getAllImplementationRecords(): ComponentImplementationRecord[] {
    return Array.from(this.implementationRecords.values());
  }

  /**
   * Get implementation records by status
   */
  getRecordsByStatus(status: ImplementationStatus): ComponentImplementationRecord[] {
    return Array.from(this.implementationRecords.values())
      .filter(record => record.status === status);
  }

  /**
   * Get implementation records by priority
   */
  getRecordsByPriority(priority: Priority): ComponentImplementationRecord[] {
    return Array.from(this.implementationRecords.values())
      .filter(record => record.priority === priority);
  }

  /**
   * Get implementation records by category
   */
  getRecordsByCategory(category: ComponentCategory): ComponentImplementationRecord[] {
    return Array.from(this.implementationRecords.values())
      .filter(record => record.category === category);
  }

  // ============================================================================
  // QUALITY VERIFICATION
  // ============================================================================

  /**
   * Run all quality checks for a component
   */
  runQualityChecks(componentType: ComponentType): QualityCheckResult[] {
    const definition = componentLibrary.getComponent(componentType);
    if (!definition) {
      return [{
        type: QualityCheckType.TYPE_DEFINITIONS,
        status: 'fail',
        message: 'Component definition not found',
        checkedAt: new Date()
      }];
    }

    const results: QualityCheckResult[] = [];
    
    this.qualityRules.forEach((checkFunction, checkType) => {
      try {
        const result = checkFunction(definition);
        results.push(result);
      } catch (error) {
        results.push({
          type: checkType,
          status: 'fail',
          message: `Quality check failed: ${error instanceof Error ? error.message : String(error)}`,
          checkedAt: new Date()
        });
      }
    });

    // Update implementation record
    const record = this.implementationRecords.get(componentType);
    if (record) {
      record.qualityChecks = results;
      record.lastUpdated = new Date();
    }

    return results;
  }

  /**
   * Run quality checks for all components
   */
  runAllQualityChecks(): Map<ComponentType, QualityCheckResult[]> {
    const results = new Map<ComponentType, QualityCheckResult[]>();
    
    this.implementationRecords.forEach((record, componentType) => {
      if (record.status === ImplementationStatus.COMPLETED) {
        const checkResults = this.runQualityChecks(componentType);
        results.set(componentType, checkResults);
      }
    });

    return results;
  }

  /**
   * Get quality check results for a component
   */
  getQualityCheckResults(componentType: ComponentType): QualityCheckResult[] {
    const record = this.implementationRecords.get(componentType);
    return record?.qualityChecks || [];
  }

  // ============================================================================
  // CHECKLIST MANAGEMENT
  // ============================================================================

  /**
   * Create implementation checklist for a component
   */
  private createChecklist(componentType: ComponentType): ComponentChecklist {
    const items: ChecklistItem[] = [
      {
        id: 'type-definitions',
        title: 'TypeScript型定義完備',
        description: 'Complete TypeScript type definitions',
        type: QualityCheckType.TYPE_DEFINITIONS,
        required: true,
        completed: false
      },
      {
        id: 'property-schema',
        title: 'プロパティスキーマ定義',
        description: 'Property schema definition with validation',
        type: QualityCheckType.PROPERTY_SCHEMA,
        required: true,
        completed: false
      },
      {
        id: 'default-values',
        title: 'デフォルト値設定',
        description: 'Default property values configuration',
        type: QualityCheckType.DEFAULT_VALUES,
        required: true,
        completed: false
      },
      {
        id: 'validation-rules',
        title: 'バリデーションルール実装',
        description: 'Property validation rules implementation',
        type: QualityCheckType.VALIDATION_RULES,
        required: true,
        completed: false
      },
      {
        id: 'connection-rules',
        title: '接続ルール定義',
        description: 'Component connection rules definition',
        type: QualityCheckType.CONNECTION_RULES,
        required: true,
        completed: false
      },
      {
        id: 'unit-tests',
        title: '単体テスト作成（80%以上カバレッジ）',
        description: 'Unit tests with 80%+ coverage',
        type: QualityCheckType.UNIT_TESTS,
        required: false,
        completed: false
      },
      {
        id: 'integration-tests',
        title: '統合テスト作成',
        description: 'Integration tests creation',
        type: QualityCheckType.INTEGRATION_TESTS,
        required: false,
        completed: false
      },
      {
        id: 'documentation',
        title: '日本語ドキュメント作成',
        description: 'Japanese documentation creation',
        type: QualityCheckType.DOCUMENTATION,
        required: true,
        completed: false
      },
      {
        id: 'openwam-compliance',
        title: 'OpenWAM準拠性確認',
        description: 'OpenWAM compliance verification',
        type: QualityCheckType.OPENWAM_COMPLIANCE,
        required: true,
        completed: false
      }
    ];

    return {
      componentType,
      items,
      completionPercentage: 0,
      lastUpdated: new Date()
    };
  }

  /**
   * Update checklist progress based on quality checks
   */
  private updateChecklistProgress(componentType: ComponentType): void {
    const checklist = this.checklists.get(componentType);
    const record = this.implementationRecords.get(componentType);
    
    if (!checklist || !record) {
      return;
    }

    // Update checklist items based on quality check results
    record.qualityChecks.forEach(qualityCheck => {
      const item = checklist.items.find(item => item.type === qualityCheck.type);
      if (item) {
        item.completed = qualityCheck.status === 'pass';
        if (item.completed) {
          item.completedAt = qualityCheck.checkedAt;
        }
      }
    });

    // Update completion percentage
    const totalItems = checklist.items.length;
    const completedItems = checklist.items.filter(item => item.completed).length;
    checklist.completionPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
    checklist.lastUpdated = new Date();
  }

  /**
   * Get checklist for a component
   */
  getChecklist(componentType: ComponentType): ComponentChecklist | undefined {
    return this.checklists.get(componentType);
  }

  /**
   * Mark checklist item as completed
   */
  markChecklistItemCompleted(
    componentType: ComponentType,
    itemId: string,
    completedBy?: string,
    notes?: string
  ): void {
    const checklist = this.checklists.get(componentType);
    if (!checklist) {
      throw new Error(`Checklist for ${componentType} not found`);
    }

    const item = checklist.items.find(item => item.id === itemId);
    if (!item) {
      throw new Error(`Checklist item ${itemId} not found`);
    }

    item.completed = true;
    item.completedAt = new Date();
    item.completedBy = completedBy;
    item.notes = notes;

    this.updateChecklistProgress(componentType);
  }

  // ============================================================================
  // REPORTING
  // ============================================================================

  /**
   * Generate comprehensive implementation progress report
   */
  generateProgressReport(): ImplementationProgressReport {
    const allRecords = this.getAllImplementationRecords();
    
    const totalComponents = allRecords.length;
    const completedComponents = allRecords.filter(r => r.status === ImplementationStatus.COMPLETED).length;
    const inProgressComponents = allRecords.filter(r => r.status === ImplementationStatus.IN_PROGRESS).length;
    const notStartedComponents = allRecords.filter(r => r.status === ImplementationStatus.NOT_STARTED).length;

    // Category breakdown
    const categoryBreakdown: Record<ComponentCategory, any> = {} as any;
    Object.values(ComponentCategory).forEach(category => {
      const categoryRecords = allRecords.filter(r => r.category === category);
      const categoryCompleted = categoryRecords.filter(r => r.status === ImplementationStatus.COMPLETED).length;
      
      categoryBreakdown[category] = {
        total: categoryRecords.length,
        completed: categoryCompleted,
        percentage: categoryRecords.length > 0 ? (categoryCompleted / categoryRecords.length) * 100 : 0
      };
    });

    // Priority breakdown
    const priorityBreakdown: Record<Priority, any> = {} as any;
    Object.values(Priority).forEach(priority => {
      const priorityRecords = allRecords.filter(r => r.priority === priority);
      const priorityCompleted = priorityRecords.filter(r => r.status === ImplementationStatus.COMPLETED).length;
      
      priorityBreakdown[priority] = {
        total: priorityRecords.length,
        completed: priorityCompleted,
        percentage: priorityRecords.length > 0 ? (priorityCompleted / priorityRecords.length) * 100 : 0
      };
    });

    // Quality metrics
    const completedRecords = allRecords.filter(r => r.status === ImplementationStatus.COMPLETED);
    const testCoverages = completedRecords
      .map(r => r.qualityChecks.find(q => q.type === QualityCheckType.UNIT_TESTS)?.coverage)
      .filter(coverage => coverage !== undefined) as number[];
    
    const averageTestCoverage = testCoverages.length > 0 
      ? testCoverages.reduce((sum, coverage) => sum + coverage, 0) / testCoverages.length 
      : 0;

    const componentsWithDocumentation = completedRecords.filter(r => 
      r.documentationStatus === ImplementationStatus.COMPLETED
    ).length;

    const componentsWithFullValidation = completedRecords.filter(r =>
      r.qualityChecks.every(q => q.status === 'pass')
    ).length;

    return {
      totalComponents,
      completedComponents,
      inProgressComponents,
      notStartedComponents,
      completionPercentage: totalComponents > 0 ? (completedComponents / totalComponents) * 100 : 0,
      categoryBreakdown,
      priorityBreakdown,
      qualityMetrics: {
        averageTestCoverage,
        componentsWithDocumentation,
        componentsWithFullValidation
      },
      upcomingDeadlines: [], // TODO: Implement deadline tracking
      blockedComponents: allRecords.filter(r => r.dependencies.some(dep => 
        this.implementationRecords.get(dep)?.status !== ImplementationStatus.COMPLETED
      )),
      generatedAt: new Date()
    };
  }

  /**
   * Export implementation data for external analysis
   */
  exportImplementationData(): {
    records: ComponentImplementationRecord[];
    checklists: ComponentChecklist[];
    report: ImplementationProgressReport;
  } {
    return {
      records: this.getAllImplementationRecords(),
      checklists: Array.from(this.checklists.values()),
      report: this.generateProgressReport()
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getCategoryForComponent(componentType: ComponentType): ComponentCategory {
    const definition = componentLibrary.getComponent(componentType);
    if (definition) {
      return definition.category;
    }

    // Fallback category determination based on component type
    if (componentType.includes('Pipe') || componentType === ComponentType.PIPE) {
      return ComponentCategory.PIPES;
    } else if (componentType.includes('CC') || componentType.includes('Boundary')) {
      return ComponentCategory.BOUNDARIES;
    } else if (componentType.includes('Plenum') || componentType.includes('Turbine')) {
      return ComponentCategory.PLENUMS;
    } else if (componentType.includes('Valve') || componentType.includes('CD')) {
      return ComponentCategory.VALVES;
    } else if (componentType.includes('Engine') || componentType.includes('Cylinder')) {
      return ComponentCategory.ENGINE;
    } else if (componentType.includes('Sensor') || componentType.includes('Controller') || componentType.includes('Table')) {
      return ComponentCategory.CONTROL;
    } else if (componentType.includes('DPF')) {
      return ComponentCategory.DPF;
    } else {
      return ComponentCategory.EXTERNAL;
    }
  }

  private getOpenWAMClassForComponent(componentType: ComponentType): string {
    const definition = componentLibrary.getComponent(componentType);
    return definition?.openWAMClass || componentType;
  }

  private calculatePriority(componentType: ComponentType): Priority {
    // VANOS control components are high priority
    const vanosComponents = [
      ComponentType.SENSOR,
      ComponentType.TABLE_1D,
      ComponentType.CONTROLLER,
      ComponentType.PID_CONTROLLER,
      ComponentType.CONTROL_VALVE,
      ComponentType.PIPE_TO_PLENUM
    ];

    if (vanosComponents.includes(componentType)) {
      return Priority.HIGH;
    }

    // Basic engine components are high priority
    const basicComponents = [
      ComponentType.PIPE,
      ComponentType.ENGINE_BLOCK,
      ComponentType.CYLINDER_4T,
      ComponentType.OPEN_END_ATMOSPHERE,
      ComponentType.CLOSED_END,
      ComponentType.CONSTANT_VOLUME_PLENUM
    ];

    if (basicComponents.includes(componentType)) {
      return Priority.HIGH;
    }

    // Advanced components are medium priority
    const advancedComponents = [
      ComponentType.VARIABLE_VOLUME_PLENUM,
      ComponentType.SIMPLE_TURBINE,
      ComponentType.VALVE_4T,
      ComponentType.BUTTERFLY_VALVE
    ];

    if (advancedComponents.includes(componentType)) {
      return Priority.MEDIUM;
    }

    // Everything else is low priority
    return Priority.LOW;
  }

  private getDependencies(componentType: ComponentType): ComponentType[] {
    // Define component dependencies
    const dependencies: Record<ComponentType, ComponentType[]> = {
      [ComponentType.CONTROLLER]: [ComponentType.SENSOR, ComponentType.TABLE_1D],
      [ComponentType.PID_CONTROLLER]: [ComponentType.CONTROLLER],
      [ComponentType.CONTROL_VALVE]: [ComponentType.PID_CONTROLLER],
      [ComponentType.CYLINDER_4T]: [ComponentType.ENGINE_BLOCK],
      [ComponentType.CYLINDER_2T]: [ComponentType.ENGINE_BLOCK],
      [ComponentType.PIPE_TO_PLENUM]: [ComponentType.PIPE, ComponentType.CONSTANT_VOLUME_PLENUM]
    } as any;

    return dependencies[componentType] || [];
  }

  private estimateEffort(componentType: ComponentType): number {
    // Estimate implementation effort in days
    const effortMap: Record<ComponentType, number> = {
      [ComponentType.SENSOR]: 3,
      [ComponentType.TABLE_1D]: 2,
      [ComponentType.CONTROLLER]: 4,
      [ComponentType.PID_CONTROLLER]: 3,
      [ComponentType.CONTROL_VALVE]: 4,
      [ComponentType.PIPE_TO_PLENUM]: 3,
      [ComponentType.PIPE]: 5,
      [ComponentType.ENGINE_BLOCK]: 4,
      [ComponentType.CYLINDER_4T]: 5,
      [ComponentType.CONSTANT_VOLUME_PLENUM]: 3
    } as any;

    return effortMap[componentType] || 2;
  }

  // ============================================================================
  // QUALITY CHECK IMPLEMENTATIONS
  // ============================================================================

  private checkTypeDefinitions(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    // Check if component has proper type definition
    if (!component.type) {
      issues.push('Missing component type');
    }

    // Check if properties are properly typed
    if (!component.defaultProperties || typeof component.defaultProperties !== 'object') {
      issues.push('Missing or invalid default properties');
    }

    // Check if property schema exists
    if (!component.propertySchema || Object.keys(component.propertySchema).length === 0) {
      issues.push('Missing property schema');
    }

    return {
      type: QualityCheckType.TYPE_DEFINITIONS,
      status: issues.length === 0 ? 'pass' : 'fail',
      message: issues.length === 0 ? 'Type definitions are complete' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkPropertySchema(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    if (!component.propertySchema) {
      return {
        type: QualityCheckType.PROPERTY_SCHEMA,
        status: 'fail',
        message: 'Property schema is missing',
        checkedAt: new Date()
      };
    }

    // Check each property in schema
    Object.entries(component.propertySchema).forEach(([key, schema]) => {
      if (!schema.type) {
        issues.push(`Property ${key} missing type`);
      }
      if (!schema.label) {
        issues.push(`Property ${key} missing label`);
      }
      if (schema.required === undefined) {
        issues.push(`Property ${key} missing required flag`);
      }
      if (!schema.validation || !Array.isArray(schema.validation)) {
        issues.push(`Property ${key} missing validation rules`);
      }
    });

    return {
      type: QualityCheckType.PROPERTY_SCHEMA,
      status: issues.length === 0 ? 'pass' : 'fail',
      message: issues.length === 0 ? 'Property schema is complete' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkDefaultValues(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    if (!component.defaultProperties) {
      return {
        type: QualityCheckType.DEFAULT_VALUES,
        status: 'fail',
        message: 'Default properties are missing',
        checkedAt: new Date()
      };
    }

    // Check if all schema properties have default values
    if (component.propertySchema) {
      Object.keys(component.propertySchema).forEach(key => {
        const nestedKeys = key.split('.');
        let value: any = component.defaultProperties;
        
        for (const nestedKey of nestedKeys) {
          if (value && typeof value === 'object' && nestedKey in value) {
            value = value[nestedKey];
          } else {
            value = null;
            break;
          }
        }

        if (value === null || value === undefined) {
          issues.push(`Missing default value for ${key}`);
        }
      });
    }

    return {
      type: QualityCheckType.DEFAULT_VALUES,
      status: issues.length === 0 ? 'pass' : 'fail',
      message: issues.length === 0 ? 'Default values are complete' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkValidationRules(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    if (!component.propertySchema) {
      return {
        type: QualityCheckType.VALIDATION_RULES,
        status: 'fail',
        message: 'Property schema is missing',
        checkedAt: new Date()
      };
    }

    // Check validation rules for each property
    Object.entries(component.propertySchema).forEach(([key, schema]) => {
      if (!schema.validation || schema.validation.length === 0) {
        if (schema.required || schema.type === 'number') {
          issues.push(`Property ${key} should have validation rules`);
        }
      }
    });

    return {
      type: QualityCheckType.VALIDATION_RULES,
      status: issues.length === 0 ? 'pass' : issues.length <= 2 ? 'warning' : 'fail',
      message: issues.length === 0 ? 'Validation rules are adequate' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkConnectionRules(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    // Check if component has connection rules defined
    if (!component.connectionRules || component.connectionRules.length === 0) {
      // Only require connection rules for components that have nodes
      if (component.nodes && component.nodes.length > 0) {
        issues.push('Component has nodes but no connection rules defined');
      }
    }

    // Check if nodes are properly defined
    if (component.nodes) {
      component.nodes.forEach((node, index) => {
        if (!node.id) {
          issues.push(`Node ${index} missing ID`);
        }
        if (!node.type) {
          issues.push(`Node ${index} missing type`);
        }
        if (!node.allowedConnections) {
          issues.push(`Node ${index} missing allowed connections`);
        }
      });
    }

    return {
      type: QualityCheckType.CONNECTION_RULES,
      status: issues.length === 0 ? 'pass' : 'warning',
      message: issues.length === 0 ? 'Connection rules are defined' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkUnitTests(component: ComponentDefinition): QualityCheckResult {
    // This would integrate with actual test runner to get real coverage
    // For now, return a placeholder result
    return {
      type: QualityCheckType.UNIT_TESTS,
      status: 'not_run',
      message: 'Unit tests not yet implemented',
      coverage: 0,
      checkedAt: new Date()
    };
  }

  private checkIntegrationTests(component: ComponentDefinition): QualityCheckResult {
    // This would integrate with actual test runner
    return {
      type: QualityCheckType.INTEGRATION_TESTS,
      status: 'not_run',
      message: 'Integration tests not yet implemented',
      checkedAt: new Date()
    };
  }

  private checkDocumentation(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    if (!component.description || component.description.length < 10) {
      issues.push('Component description is too short or missing');
    }

    // Check if property schema has proper descriptions
    if (component.propertySchema) {
      Object.entries(component.propertySchema).forEach(([key, schema]) => {
        if (!schema.description || schema.description.length < 5) {
          issues.push(`Property ${key} needs better description`);
        }
      });
    }

    return {
      type: QualityCheckType.DOCUMENTATION,
      status: issues.length === 0 ? 'pass' : issues.length <= 3 ? 'warning' : 'fail',
      message: issues.length === 0 ? 'Documentation is adequate' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }

  private checkOpenWAMCompliance(component: ComponentDefinition): QualityCheckResult {
    const issues: string[] = [];

    // Check if OpenWAM class is specified
    if (!component.openWAMClass) {
      issues.push('OpenWAM class not specified');
    }

    // Check if component type matches OpenWAM naming convention
    if (component.openWAMClass && !component.openWAMClass.startsWith('T')) {
      issues.push('OpenWAM class should start with T (e.g., TTubo, TDeposito)');
    }

    // Check category alignment
    const categoryClassMap: Record<ComponentCategory, string[]> = {
      [ComponentCategory.PIPES]: ['TTubo', 'TConcentrico'],
      [ComponentCategory.BOUNDARIES]: ['TCC'],
      [ComponentCategory.PLENUMS]: ['TDep', 'TTurbina', 'TVenturi'],
      [ComponentCategory.VALVES]: ['TCD', 'TValvula', 'TLamina', 'TMariposa'],
      [ComponentCategory.ENGINE]: ['TBloque', 'TCilindro'],
      [ComponentCategory.CONTROL]: ['TSensor', 'TController', 'TTable', 'TPID'],
      [ComponentCategory.DPF]: ['TDPF'],
      [ComponentCategory.TURBOCHARGER]: ['TCompresor', 'TEje'],
      [ComponentCategory.EXTERNAL]: []
    };

    const expectedPrefixes = categoryClassMap[component.category] || [];
    if (expectedPrefixes.length > 0 && component.openWAMClass) {
      const hasValidPrefix = expectedPrefixes.some(prefix => 
        component.openWAMClass!.startsWith(prefix)
      );
      if (!hasValidPrefix) {
        issues.push(`OpenWAM class ${component.openWAMClass} doesn't match category ${component.category}`);
      }
    }

    return {
      type: QualityCheckType.OPENWAM_COMPLIANCE,
      status: issues.length === 0 ? 'pass' : 'warning',
      message: issues.length === 0 ? 'OpenWAM compliance verified' : `Issues found: ${issues.join(', ')}`,
      details: { issues },
      checkedAt: new Date()
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global component management system instance
 */
export const componentManagementSystem = new ComponentManagementSystem();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the global component management system instance
 */
export function getComponentManagementSystem(): ComponentManagementSystem {
  return componentManagementSystem;
}

/**
 * Quick access to run quality checks for a component
 */
export function runComponentQualityChecks(componentType: ComponentType): QualityCheckResult[] {
  return componentManagementSystem.runQualityChecks(componentType);
}

/**
 * Quick access to get implementation progress report
 */
export function getImplementationProgressReport(): ImplementationProgressReport {
  return componentManagementSystem.generateProgressReport();
}

/**
 * Quick access to update component status
 */
export function updateComponentStatus(
  componentType: ComponentType,
  status: ImplementationStatus,
  assignee?: string,
  notes?: string
): void {
  componentManagementSystem.updateImplementationStatus(componentType, status, assignee, notes);
}
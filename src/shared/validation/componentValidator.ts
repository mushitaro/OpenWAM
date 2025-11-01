/**
 * OpenWAM Component Validation System
 * Based on OpenWAM connection rules and constraints
 */

import {
  ComponentType,
  ComponentCategory,
  BoundaryConditionType,
  ValveType,
  ModelComponent,
  Connection,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ConnectionRule,
  ConnectionCondition,
  EngineModel,
  ComponentProperties,
  PropertyDefinition,
  PropertySchema
} from '../types/openWAMComponents';

import { getComponentDefinition } from '../components/componentDefinitions';

// ============================================================================
// CONNECTION RULES
// ============================================================================

/**
 * OpenWAM connection rules based on source code analysis
 */
export const connectionRules: ConnectionRule[] = [
  // Pipe connections
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },
  
  // Pipe to boundary conditions
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.OPEN_END_ATMOSPHERE,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.OPEN_END_ATMOSPHERE,
    toPortType: 'connection',
    isAllowed: true
  },
  // Reverse connections (atmosphere to pipe)
  {
    fromType: ComponentType.OPEN_END_ATMOSPHERE,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },
  {
    fromType: ComponentType.OPEN_END_ATMOSPHERE,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.CLOSED_END,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.CLOSED_END,
    toPortType: 'connection',
    isAllowed: true
  },
  // Reverse connections (closed end to pipe)
  {
    fromType: ComponentType.CLOSED_END,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },
  {
    fromType: ComponentType.CLOSED_END,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true
  },
  
  // Pipe to plenum connections
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.CONSTANT_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.CONSTANT_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: true
  },
  
  // Valve connections (valves can connect pipes and plenums)
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.FIXED_CD_VALVE,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.FIXED_CD_VALVE,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.CONSTANT_VOLUME_PLENUM,
    fromPortType: 'inlet',
    toType: ComponentType.FIXED_CD_VALVE,
    toPortType: 'connection',
    isAllowed: true
  }
];

// ============================================================================
// COMPONENT VALIDATOR CLASS
// ============================================================================

export class ComponentValidator {
  private rules: ConnectionRule[];
  
  constructor(customRules?: ConnectionRule[]) {
    this.rules = customRules || connectionRules;
  }

  /**
   * Validate a single connection between components
   */
  validateConnection(
    fromComponent: ModelComponent,
    fromPort: string,
    toComponent: ModelComponent,
    toPort: string
  ): ValidationResult {
    const errors: ValidationError[] = [];
    
    // 1. Find applicable connection rule
    const rule = this.findConnectionRule(fromComponent.type, fromPort, toComponent.type, toPort);
    
    if (!rule || !rule.isAllowed) {
      errors.push({
        type: 'connection',
        componentId: fromComponent.id,
        message: `Connection from ${fromComponent.type}:${fromPort} to ${toComponent.type}:${toPort} is not allowed`,
        severity: 'error'
      });
      return { isValid: false, errors };
    }
    
    // 2. Validate connection conditions
    if (rule.conditions) {
      const conditionErrors = this.validateConnectionConditions(
        rule.conditions, 
        fromComponent, 
        toComponent
      );
      errors.push(...conditionErrors);
    }
    
    // 3. Check for circular references
    if (this.hasCircularReference(fromComponent, toComponent)) {
      errors.push({
        type: 'connection',
        componentId: fromComponent.id,
        message: 'Circular reference detected in connection',
        severity: 'error'
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate an entire engine model
   */
  validateModel(model: EngineModel): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // 1. Validate all connections
    model.connections.forEach(connection => {
      const fromComponent = model.components.find(c => c.id === connection.fromComponent);
      const toComponent = model.components.find(c => c.id === connection.toComponent);
      
      if (!fromComponent || !toComponent) {
        errors.push({
          type: 'connection',
          componentId: connection.fromComponent,
          message: 'Connection references non-existent component',
          severity: 'error'
        });
        return;
      }
      
      const result = this.validateConnection(
        fromComponent,
        connection.fromPort,
        toComponent,
        connection.toPort
      );
      
      errors.push(...result.errors);
    });
    
    // 2. Find isolated components
    const isolatedComponents = this.findIsolatedComponents(model);
    isolatedComponents.forEach(component => {
      warnings.push({
        type: 'isolation',
        componentId: component.id,
        message: `Component ${component.type} is not connected to any other components`
      });
    });
    
    // 3. Validate component properties
    model.components.forEach(component => {
      const propertyErrors = this.validateComponentProperties(component);
      errors.push(...propertyErrors);
    });
    
    // 4. Validate OpenWAM-specific constraints
    const openWAMErrors = this.validateOpenWAMConstraints(model);
    errors.push(...openWAMErrors);
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate component properties against schema
   */
  validateComponentProperties(component: ModelComponent): ValidationError[] {
    const errors: ValidationError[] = [];
    const definition = getComponentDefinition(component.type);
    
    if (!definition) {
      errors.push({
        type: 'property',
        componentId: component.id,
        message: `Unknown component type: ${component.type}`,
        severity: 'error'
      });
      return errors;
    }
    
    const schema = definition.propertySchema;
    
    // Validate each property
    Object.entries(schema).forEach(([propertyName, propertyDef]) => {
      const value = (component.properties as any)[propertyName];
      
      // Check required properties
      if (propertyDef.required && (value === undefined || value === null)) {
        errors.push({
          type: 'property',
          componentId: component.id,
          message: `Required property '${propertyName}' is missing`,
          severity: 'error'
        });
        return;
      }
      
      // Validate property value
      if (value !== undefined && value !== null) {
        const propertyErrors = this.validatePropertyValue(
          component.id,
          propertyName,
          value,
          propertyDef
        );
        errors.push(...propertyErrors);
      }
    });
    
    return errors;
  }

  /**
   * Validate a single property value
   */
  private validatePropertyValue(
    componentId: string,
    propertyName: string,
    value: any,
    definition: PropertyDefinition
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // Type validation
    if (!this.validatePropertyType(value, definition.type)) {
      errors.push({
        type: 'property',
        componentId,
        message: `Property '${propertyName}' must be of type ${definition.type}`,
        severity: 'error'
      });
      return errors;
    }
    
    // Validation rules
    definition.validation.forEach(rule => {
      const isValid = this.validateRule(value, rule);
      if (!isValid) {
        errors.push({
          type: 'property',
          componentId,
          message: `Property '${propertyName}': ${rule.message}`,
          severity: 'error'
        });
      }
    });
    
    return errors;
  }

  /**
   * Validate property type
   */
  private validatePropertyType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'select':
        return true; // Select values are validated by options
      default:
        return true;
    }
  }

  /**
   * Validate a single validation rule
   */
  private validateRule(value: any, rule: any): boolean {
    switch (rule.type) {
      case 'min':
        return typeof value === 'number' && value >= rule.value;
      case 'max':
        return typeof value === 'number' && value <= rule.value;
      case 'range':
        return typeof value === 'number' && 
               value >= rule.value[0] && 
               value <= rule.value[1];
      case 'pattern':
        return typeof value === 'string' && 
               new RegExp(rule.value).test(value);
      case 'custom':
        return rule.validator ? rule.validator(value) : true;
      default:
        return true;
    }
  }

  /**
   * Find connection rule for given component types and ports
   */
  private findConnectionRule(
    fromType: ComponentType,
    fromPort: string,
    toType: ComponentType,
    toPort: string
  ): ConnectionRule | undefined {
    return this.rules.find(rule =>
      rule.fromType === fromType &&
      rule.fromPortType === fromPort &&
      rule.toType === toType &&
      rule.toPortType === toPort
    );
  }

  /**
   * Validate connection conditions
   */
  private validateConnectionConditions(
    conditions: ConnectionCondition[],
    fromComponent: ModelComponent,
    toComponent: ModelComponent
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    conditions.forEach(condition => {
      const isValid = this.evaluateCondition(condition, fromComponent, toComponent);
      if (!isValid) {
        errors.push({
          type: 'connection',
          componentId: fromComponent.id,
          message: condition.message,
          severity: 'error'
        });
      }
    });
    
    return errors;
  }

  /**
   * Evaluate a connection condition
   */
  private evaluateCondition(
    condition: ConnectionCondition,
    fromComponent: ModelComponent,
    toComponent: ModelComponent
  ): boolean {
    const fromValue = (fromComponent.properties as any)[condition.property];
    const toValue = (toComponent.properties as any)[condition.property];
    
    switch (condition.operator) {
      case 'equals':
        return fromValue === condition.value || toValue === condition.value;
      case 'greater':
        return (fromValue > condition.value) || (toValue > condition.value);
      case 'less':
        return (fromValue < condition.value) || (toValue < condition.value);
      case 'range':
        const [min, max] = condition.value;
        return (fromValue >= min && fromValue <= max) || 
               (toValue >= min && toValue <= max);
      default:
        return true;
    }
  }

  /**
   * Check for circular references in connections
   */
  private hasCircularReference(
    fromComponent: ModelComponent,
    toComponent: ModelComponent
  ): boolean {
    // Simple check - in a more complex implementation, this would
    // traverse the entire connection graph
    return fromComponent.id === toComponent.id;
  }

  /**
   * Find components that are not connected to any other components
   */
  private findIsolatedComponents(model: EngineModel): ModelComponent[] {
    const connectedComponentIds = new Set<string>();
    
    model.connections.forEach(connection => {
      connectedComponentIds.add(connection.fromComponent);
      connectedComponentIds.add(connection.toComponent);
    });
    
    return model.components.filter(component => 
      !connectedComponentIds.has(component.id)
    );
  }

  /**
   * Validate OpenWAM-specific constraints
   */
  private validateOpenWAMConstraints(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // 1. Check for unique pipe numbers
    const pipeComponents = model.components.filter(c => c.type === ComponentType.PIPE);
    const pipeNumbers = pipeComponents.map(c => (c.properties as any).numeroTubo);
    const duplicatePipeNumbers = pipeNumbers.filter((num, index) => 
      pipeNumbers.indexOf(num) !== index
    );
    
    if (duplicatePipeNumbers.length > 0) {
      errors.push({
        type: 'model',
        componentId: '',
        message: `Duplicate pipe numbers found: ${duplicatePipeNumbers.join(', ')}`,
        severity: 'error'
      });
    }
    
    // 2. Check for unique plenum numbers
    const plenumComponents = model.components.filter(c => {
      const definition = getComponentDefinition(c.type);
      return definition?.category === ComponentCategory.PLENUMS;
    });
    const plenumNumbers = plenumComponents.map(c => (c.properties as any).numeroDeposito);
    const duplicatePlenumNumbers = plenumNumbers.filter((num, index) => 
      plenumNumbers.indexOf(num) !== index
    );
    
    if (duplicatePlenumNumbers.length > 0) {
      errors.push({
        type: 'model',
        componentId: '',
        message: `Duplicate plenum numbers found: ${duplicatePlenumNumbers.join(', ')}`,
        severity: 'error'
      });
    }
    
    // 3. Validate node number consistency
    const nodeValidationErrors = this.validateNodeNumbers(model);
    errors.push(...nodeValidationErrors);
    
    return errors;
  }

  /**
   * Validate node number consistency across the model
   */
  private validateNodeNumbers(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodeConnections = new Map<number, string[]>();
    
    // Collect all node connections
    model.components.forEach(component => {
      if (component.type === ComponentType.PIPE) {
        const props = component.properties as any;
        const leftNode = props.nodoIzq;
        const rightNode = props.nodoDer;
        
        if (!nodeConnections.has(leftNode)) {
          nodeConnections.set(leftNode, []);
        }
        if (!nodeConnections.has(rightNode)) {
          nodeConnections.set(rightNode, []);
        }
        
        nodeConnections.get(leftNode)!.push(component.id);
        nodeConnections.get(rightNode)!.push(component.id);
      }
    });
    
    // Check for nodes with too many connections
    nodeConnections.forEach((componentIds, nodeNumber) => {
      if (componentIds.length > 3) {
        errors.push({
          type: 'model',
          componentId: componentIds[0],
          message: `Node ${nodeNumber} has too many connections (${componentIds.length}). Maximum is 3.`,
          severity: 'error'
        });
      }
    });
    
    return errors;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a default validator instance
 */
export function createValidator(): ComponentValidator {
  return new ComponentValidator();
}

/**
 * Quick validation function for a single connection
 */
export function validateConnection(
  fromComponent: ModelComponent,
  fromPort: string,
  toComponent: ModelComponent,
  toPort: string
): ValidationResult {
  const validator = createValidator();
  return validator.validateConnection(fromComponent, fromPort, toComponent, toPort);
}

/**
 * Quick validation function for an entire model
 */
export function validateModel(model: EngineModel): ValidationResult {
  const validator = createValidator();
  return validator.validateModel(model);
}
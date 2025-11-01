/**
 * OpenWAM Connection Rules Engine
 * Advanced connection validation based on OpenWAM node system and boundary conditions
 */

import {
  ComponentType,
  ComponentCategory,
  BoundaryConditionType,
  ValveType,
  PlenumType,
  ModelComponent,
  Connection,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ConnectionRule,
  ConnectionCondition,
  EngineModel
} from '../types/openWAMComponents';

import { getComponentDefinition } from '../components/componentDefinitions';

// ============================================================================
// ADVANCED CONNECTION RULES
// ============================================================================

/**
 * Comprehensive OpenWAM connection rules based on source code analysis
 */
export const advancedConnectionRules: ConnectionRule[] = [
  // ========== PIPE CONNECTIONS ==========
  
  // Pipe to Pipe (direct connection)
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true,
    conditions: [
      {
        property: 'dExtTramo',
        operator: 'equals',
        value: 'compatible_diameter',
        message: 'Pipe diameters must be compatible for direct connection'
      }
    ]
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },

  // ========== BOUNDARY CONDITIONS ==========
  
  // Open End Atmosphere (nmOpenEndAtmosphere = 0)
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

  // Closed End (nmClosedEnd = 3)
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

  // Anechoic End (nmAnechoicEnd = 4)
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.ANECHOIC_END,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.ANECHOIC_END,
    toPortType: 'connection',
    isAllowed: true
  },

  // ========== PIPE TO PLENUM CONNECTIONS ==========
  
  // Pipe to Constant Volume Plenum
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
  {
    fromType: ComponentType.CONSTANT_VOLUME_PLENUM,
    fromPortType: 'inlet',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },
  {
    fromType: ComponentType.CONSTANT_VOLUME_PLENUM,
    fromPortType: 'inlet',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true
  },

  // Pipe to Variable Volume Plenum
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'left',
    toType: ComponentType.VARIABLE_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: true
  },
  {
    fromType: ComponentType.PIPE,
    fromPortType: 'right',
    toType: ComponentType.VARIABLE_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: true
  },

  // ========== VALVE CONNECTIONS ==========
  
  // Fixed CD Valve connections
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
    fromType: ComponentType.FIXED_CD_VALVE,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'left',
    isAllowed: true
  },
  {
    fromType: ComponentType.FIXED_CD_VALVE,
    fromPortType: 'connection',
    toType: ComponentType.PIPE,
    toPortType: 'right',
    isAllowed: true
  },
  {
    fromType: ComponentType.CONSTANT_VOLUME_PLENUM,
    fromPortType: 'inlet',
    toType: ComponentType.FIXED_CD_VALVE,
    toPortType: 'connection',
    isAllowed: true
  },
  {
    fromType: ComponentType.FIXED_CD_VALVE,
    fromPortType: 'connection',
    toType: ComponentType.CONSTANT_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: true
  },

  // ========== FORBIDDEN CONNECTIONS ==========
  
  // Plenum to Plenum direct connection (not allowed without valve)
  {
    fromType: ComponentType.CONSTANT_VOLUME_PLENUM,
    fromPortType: 'inlet',
    toType: ComponentType.CONSTANT_VOLUME_PLENUM,
    toPortType: 'inlet',
    isAllowed: false
  },

  // Boundary to Boundary connections (not allowed)
  {
    fromType: ComponentType.OPEN_END_ATMOSPHERE,
    fromPortType: 'connection',
    toType: ComponentType.CLOSED_END,
    toPortType: 'connection',
    isAllowed: false
  },
  {
    fromType: ComponentType.OPEN_END_ATMOSPHERE,
    fromPortType: 'connection',
    toType: ComponentType.OPEN_END_ATMOSPHERE,
    toPortType: 'connection',
    isAllowed: false
  }
];

// ============================================================================
// NODE SYSTEM VALIDATION
// ============================================================================

/**
 * OpenWAM node system validator
 * Based on the node numbering system used in OpenWAM
 */
export class NodeSystemValidator {
  private nodeConnections: Map<number, Set<string>> = new Map();
  private componentNodes: Map<string, { leftNode?: number; rightNode?: number }> = new Map();

  /**
   * Build node connection map from model
   */
  buildNodeMap(model: EngineModel): void {
    this.nodeConnections.clear();
    this.componentNodes.clear();

    // Process pipe components to extract node information
    model.components.forEach(component => {
      if (component.type === ComponentType.PIPE) {
        const props = component.properties as any;
        const leftNode = props.nodoIzq;
        const rightNode = props.nodoDer;

        // Store component node mapping
        this.componentNodes.set(component.id, {
          leftNode,
          rightNode
        });

        // Add to node connections
        if (!this.nodeConnections.has(leftNode)) {
          this.nodeConnections.set(leftNode, new Set());
        }
        if (!this.nodeConnections.has(rightNode)) {
          this.nodeConnections.set(rightNode, new Set());
        }

        this.nodeConnections.get(leftNode)!.add(component.id);
        this.nodeConnections.get(rightNode)!.add(component.id);
      }
    });
  }

  /**
   * Validate node system constraints
   */
  validateNodeSystem(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];
    this.buildNodeMap(model);

    // Check for node connection limits (max 3 connections per node in OpenWAM)
    this.nodeConnections.forEach((componentIds, nodeNumber) => {
      if (componentIds.size > 3) {
        errors.push({
          type: 'model',
          componentId: Array.from(componentIds)[0],
          message: `Node ${nodeNumber} has ${componentIds.size} connections. OpenWAM allows maximum 3 connections per node.`,
          severity: 'error'
        });
      }
    });

    // Check for duplicate node numbers within same component
    model.components.forEach(component => {
      if (component.type === ComponentType.PIPE) {
        const props = component.properties as any;
        if (props.nodoIzq === props.nodoDer) {
          errors.push({
            type: 'property',
            componentId: component.id,
            message: `Pipe ${component.id} has same node number (${props.nodoIzq}) for left and right ends.`,
            severity: 'error'
          });
        }
      }
    });

    // Check for orphaned nodes (nodes with only one connection)
    this.nodeConnections.forEach((componentIds, nodeNumber) => {
      if (componentIds.size === 1) {
        const componentId = Array.from(componentIds)[0];
        const component = model.components.find(c => c.id === componentId);
        
        // Only warn if it's not connected to a boundary condition
        const hasValidTermination = model.connections.some(conn => {
          const fromComp = model.components.find(c => c.id === conn.fromComponent);
          const toComp = model.components.find(c => c.id === conn.toComponent);
          
          return (fromComp?.id === componentId || toComp?.id === componentId) &&
                 (this.isBoundaryCondition(fromComp?.type) || this.isBoundaryCondition(toComp?.type));
        });

        if (!hasValidTermination) {
          errors.push({
            type: 'model',
            componentId: componentId,
            message: `Node ${nodeNumber} has only one connection and no boundary condition. This may cause simulation issues.`,
            severity: 'warning' as any
          });
        }
      }
    });

    return errors;
  }

  /**
   * Check if component type is a boundary condition
   */
  private isBoundaryCondition(componentType?: ComponentType): boolean {
    if (!componentType) return false;
    
    const boundaryTypes = [
      ComponentType.OPEN_END_ATMOSPHERE,
      ComponentType.CLOSED_END,
      ComponentType.ANECHOIC_END,
      ComponentType.PULSE_END,
      ComponentType.INJECTION_END
    ];

    return boundaryTypes.includes(componentType);
  }

  /**
   * Get node connections for a specific node
   */
  getNodeConnections(nodeNumber: number): string[] {
    return Array.from(this.nodeConnections.get(nodeNumber) || []);
  }

  /**
   * Check if two components share a node
   */
  shareNode(componentId1: string, componentId2: string): boolean {
    const nodes1 = this.componentNodes.get(componentId1);
    const nodes2 = this.componentNodes.get(componentId2);

    if (!nodes1 || !nodes2) return false;

    return (nodes1.leftNode === nodes2.leftNode) ||
           (nodes1.leftNode === nodes2.rightNode) ||
           (nodes1.rightNode === nodes2.leftNode) ||
           (nodes1.rightNode === nodes2.rightNode);
  }
}

// ============================================================================
// CIRCULAR REFERENCE DETECTION
// ============================================================================

/**
 * Circular reference detector for component connections
 */
export class CircularReferenceDetector {
  private visited: Set<string> = new Set();
  private recursionStack: Set<string> = new Set();
  private adjacencyList: Map<string, string[]> = new Map();

  /**
   * Build adjacency list from model connections
   */
  buildAdjacencyList(model: EngineModel): void {
    this.adjacencyList.clear();

    // Initialize adjacency list
    model.components.forEach(component => {
      this.adjacencyList.set(component.id, []);
    });

    // Add connections
    model.connections.forEach(connection => {
      const fromList = this.adjacencyList.get(connection.fromComponent) || [];
      fromList.push(connection.toComponent);
      this.adjacencyList.set(connection.fromComponent, fromList);
    });
  }

  /**
   * Detect circular references using DFS
   */
  detectCircularReferences(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];
    this.buildAdjacencyList(model);
    this.visited.clear();
    this.recursionStack.clear();

    // Check each component for circular references
    model.components.forEach(component => {
      if (!this.visited.has(component.id)) {
        const circularPath = this.dfsDetectCycle(component.id);
        if (circularPath.length > 0) {
          errors.push({
            type: 'connection',
            componentId: component.id,
            message: `Circular reference detected in connection path: ${circularPath.join(' -> ')}`,
            severity: 'error'
          });
        }
      }
    });

    return errors;
  }

  /**
   * DFS-based cycle detection
   */
  private dfsDetectCycle(componentId: string, path: string[] = []): string[] {
    this.visited.add(componentId);
    this.recursionStack.add(componentId);
    path.push(componentId);

    const neighbors = this.adjacencyList.get(componentId) || [];
    
    for (const neighbor of neighbors) {
      if (!this.visited.has(neighbor)) {
        const cyclePath = this.dfsDetectCycle(neighbor, [...path]);
        if (cyclePath.length > 0) {
          return cyclePath;
        }
      } else if (this.recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        return path.slice(cycleStart).concat([neighbor]);
      }
    }

    this.recursionStack.delete(componentId);
    return [];
  }
}

// ============================================================================
// DUPLICATE CONNECTION DETECTOR
// ============================================================================

/**
 * Duplicate connection detector
 */
export class DuplicateConnectionDetector {
  /**
   * Detect duplicate connections in model
   */
  detectDuplicateConnections(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];
    const connectionSignatures = new Set<string>();

    model.connections.forEach(connection => {
      // Create normalized signature (bidirectional)
      const signature1 = `${connection.fromComponent}:${connection.fromPort}-${connection.toComponent}:${connection.toPort}`;
      const signature2 = `${connection.toComponent}:${connection.toPort}-${connection.fromComponent}:${connection.fromPort}`;

      if (connectionSignatures.has(signature1) || connectionSignatures.has(signature2)) {
        errors.push({
          type: 'connection',
          componentId: connection.fromComponent,
          message: `Duplicate connection detected between ${connection.fromComponent} and ${connection.toComponent}`,
          severity: 'error'
        });
      } else {
        connectionSignatures.add(signature1);
      }
    });

    return errors;
  }
}

// ============================================================================
// ADVANCED CONNECTION RULES ENGINE
// ============================================================================

/**
 * Advanced connection rules engine with comprehensive validation
 */
export class AdvancedConnectionRulesEngine {
  private rules: ConnectionRule[];
  private nodeValidator: NodeSystemValidator;
  private circularDetector: CircularReferenceDetector;
  private duplicateDetector: DuplicateConnectionDetector;

  constructor(customRules?: ConnectionRule[]) {
    this.rules = customRules || advancedConnectionRules;
    this.nodeValidator = new NodeSystemValidator();
    this.circularDetector = new CircularReferenceDetector();
    this.duplicateDetector = new DuplicateConnectionDetector();
  }

  /**
   * Comprehensive model validation
   */
  validateModel(model: EngineModel): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Basic connection rule validation
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

      const connectionErrors = this.validateConnection(
        fromComponent,
        connection.fromPort,
        toComponent,
        connection.toPort
      );
      errors.push(...connectionErrors.errors);
    });

    // 2. Node system validation
    const nodeErrors = this.nodeValidator.validateNodeSystem(model);
    errors.push(...nodeErrors.filter(e => e.severity === 'error'));
    warnings.push(...nodeErrors.filter(e => e.severity === 'warning').map(e => ({
      type: e.type as any,
      componentId: e.componentId,
      message: e.message
    })));

    // 3. Circular reference detection
    const circularErrors = this.circularDetector.detectCircularReferences(model);
    errors.push(...circularErrors);

    // 4. Duplicate connection detection
    const duplicateErrors = this.duplicateDetector.detectDuplicateConnections(model);
    errors.push(...duplicateErrors);

    // 5. OpenWAM-specific validations
    const openWAMErrors = this.validateOpenWAMSpecificRules(model);
    errors.push(...openWAMErrors);

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate a single connection
   */
  validateConnection(
    fromComponent: ModelComponent,
    fromPort: string,
    toComponent: ModelComponent,
    toPort: string
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Find applicable rule
    const rule = this.findConnectionRule(fromComponent.type, fromPort, toComponent.type, toPort);

    if (!rule) {
      errors.push({
        type: 'connection',
        componentId: fromComponent.id,
        message: `No connection rule found for ${fromComponent.type}:${fromPort} to ${toComponent.type}:${toPort}`,
        severity: 'error'
      });
      return { isValid: false, errors };
    }

    if (!rule.isAllowed) {
      errors.push({
        type: 'connection',
        componentId: fromComponent.id,
        message: `Connection from ${fromComponent.type}:${fromPort} to ${toComponent.type}:${toPort} is not allowed`,
        severity: 'error'
      });
      return { isValid: false, errors };
    }

    // Validate conditions
    if (rule.conditions) {
      const conditionErrors = this.validateConnectionConditions(
        rule.conditions,
        fromComponent,
        toComponent
      );
      errors.push(...conditionErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Find connection rule
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
   * Evaluate connection condition
   */
  private evaluateCondition(
    condition: ConnectionCondition,
    fromComponent: ModelComponent,
    toComponent: ModelComponent
  ): boolean {
    // Implementation depends on specific condition types
    // For now, return true for basic compatibility
    return true;
  }

  /**
   * Validate OpenWAM-specific rules
   */
  private validateOpenWAMSpecificRules(model: EngineModel): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for required boundary conditions
    const pipeComponents = model.components.filter(c => c.type === ComponentType.PIPE);
    const boundaryComponents = model.components.filter(c => 
      this.nodeValidator['isBoundaryCondition'](c.type)
    );

    if (pipeComponents.length > 0 && boundaryComponents.length === 0) {
      errors.push({
        type: 'model',
        componentId: '',
        message: 'Model contains pipes but no boundary conditions. At least one boundary condition is required.',
        severity: 'error'
      });
    }

    // Check for minimum model requirements
    if (model.components.length === 0) {
      errors.push({
        type: 'model',
        componentId: '',
        message: 'Model is empty. At least one component is required.',
        severity: 'error'
      });
    }

    return errors;
  }

  /**
   * Add custom connection rule
   */
  addRule(rule: ConnectionRule): void {
    this.rules.push(rule);
  }

  /**
   * Get all connection rules
   */
  getRules(): ConnectionRule[] {
    return [...this.rules];
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create advanced connection rules engine
 */
export function createAdvancedRulesEngine(): AdvancedConnectionRulesEngine {
  return new AdvancedConnectionRulesEngine();
}

/**
 * Quick validation with advanced rules
 */
export function validateModelWithAdvancedRules(model: EngineModel): ValidationResult {
  const engine = createAdvancedRulesEngine();
  return engine.validateModel(model);
}
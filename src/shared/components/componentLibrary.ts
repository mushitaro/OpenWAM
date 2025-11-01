/**
 * OpenWAM Component Library Manager
 * Manages the complete library of OpenWAM components
 */

import {
  ComponentLibrary,
  ComponentDefinition,
  ComponentCategory,
  ComponentType,
  ModelTemplate,
  ConnectionRule,
  EngineModel,
  ModelComponent
} from '../types/openWAMComponents';

import {
  componentDefinitions,
  getComponentDefinition,
  getComponentsByCategory,
  getAvailableCategories
} from './componentDefinitions';

import { connectionRules } from '../validation/componentValidator';
import { advancedConnectionRules } from '../validation/connectionRulesEngine';

// ============================================================================
// COMPONENT TEMPLATES
// ============================================================================

/**
 * Predefined model templates for common engine configurations
 */
const modelTemplates: ModelTemplate[] = [
  {
    id: 'simple-pipe',
    name: 'Simple Pipe',
    description: 'Basic pipe with open ends',
    category: 'Basic',
    thumbnail: 'simple-pipe-thumb.png',
    model: {
      components: [
        {
          id: 'pipe-1',
          type: ComponentType.PIPE,
          position: { x: 100, y: 100 },
          rotation: 0,
          properties: {
            id: 'pipe-1',
            numeroTubo: 1,
            nodoIzq: 1,
            nodoDer: 2,
            nin: 10,
            longitudTotal: 1.0,
            mallado: 0.1,
            nTramos: 1,
            tipoMallado: 1,
            friccion: 0.02,
            tipoTransCal: 2,
            coefAjusFric: 1.0,
            coefAjusTC: 1.0,
            espesorPrin: 0.002,
            densidadPrin: 7800,
            calEspPrin: 460,
            conductPrin: 50,
            tRefrigerante: 353,
            tipRefrig: 'air',
            tini: 300,
            pini: 1.0,
            velMedia: 0.0,
            lTramo: [1.0],
            dExtTramo: [0.05],
            numCapas: 1,
            capas: [{
              esPrincipal: true,
              esFluida: false,
              density: 7800,
              calorEspecifico: 460,
              conductividad: 50,
              espesor: 0.002,
              emisividadInterior: 0.8,
              emisividadExterior: 0.8
            }]
          }
        },
        {
          id: 'atmosphere-1',
          type: ComponentType.OPEN_END_ATMOSPHERE,
          position: { x: 50, y: 100 },
          rotation: 0,
          properties: {
            id: 'atmosphere-1',
            tipoCC: 0,
            numeroCC: 1
          }
        },
        {
          id: 'atmosphere-2',
          type: ComponentType.OPEN_END_ATMOSPHERE,
          position: { x: 250, y: 100 },
          rotation: 0,
          properties: {
            id: 'atmosphere-2',
            tipoCC: 0,
            numeroCC: 2
          }
        }
      ],
      connections: [
        {
          id: 'conn-1',
          fromComponent: 'atmosphere-1',
          fromPort: 'connection',
          toComponent: 'pipe-1',
          toPort: 'left',
          isValid: true
        },
        {
          id: 'conn-2',
          fromComponent: 'pipe-1',
          fromPort: 'right',
          toComponent: 'atmosphere-2',
          toPort: 'connection',
          isValid: true
        }
      ],
      metadata: {
        name: 'Simple Pipe Model',
        description: 'Basic pipe with atmospheric boundary conditions',
        created: new Date(),
        modified: new Date(),
        version: '1.0'
      },
      validationResult: {
        isValid: true,
        errors: []
      }
    }
  },
  {
    id: 'pipe-plenum',
    name: 'Pipe with Plenum',
    description: 'Pipe connected to a plenum chamber',
    category: 'Basic',
    thumbnail: 'pipe-plenum-thumb.png',
    model: {
      components: [
        {
          id: 'pipe-1',
          type: ComponentType.PIPE,
          position: { x: 100, y: 100 },
          rotation: 0,
          properties: {
            id: 'pipe-1',
            numeroTubo: 1,
            nodoIzq: 1,
            nodoDer: 2,
            nin: 10,
            longitudTotal: 0.5,
            mallado: 0.05,
            nTramos: 1,
            tipoMallado: 1,
            friccion: 0.02,
            tipoTransCal: 1,
            coefAjusFric: 1.0,
            coefAjusTC: 1.0,
            espesorPrin: 0.002,
            densidadPrin: 7800,
            calEspPrin: 460,
            conductPrin: 50,
            tRefrigerante: 353,
            tipRefrig: 'air',
            tini: 300,
            pini: 1.0,
            velMedia: 0.0,
            lTramo: [0.5],
            dExtTramo: [0.04],
            numCapas: 1,
            capas: [{
              esPrincipal: true,
              esFluida: false,
              density: 7800,
              calorEspecifico: 460,
              conductividad: 50,
              espesor: 0.002,
              emisividadInterior: 0.8,
              emisividadExterior: 0.8
            }]
          }
        },
        {
          id: 'plenum-1',
          type: ComponentType.CONSTANT_VOLUME_PLENUM,
          position: { x: 200, y: 100 },
          rotation: 0,
          properties: {
            id: 'plenum-1',
            numeroDeposito: 1,
            volumen0: 0.002,
            tipoDeposito: 0,
            temperature: 300,
            pressure: 1.0,
            masa0: 0.002
          }
        },
        {
          id: 'atmosphere-1',
          type: ComponentType.OPEN_END_ATMOSPHERE,
          position: { x: 50, y: 100 },
          rotation: 0,
          properties: {
            id: 'atmosphere-1',
            tipoCC: 0,
            numeroCC: 1
          }
        }
      ],
      connections: [
        {
          id: 'conn-1',
          fromComponent: 'atmosphere-1',
          fromPort: 'connection',
          toComponent: 'pipe-1',
          toPort: 'left',
          isValid: true
        },
        {
          id: 'conn-2',
          fromComponent: 'pipe-1',
          fromPort: 'right',
          toComponent: 'plenum-1',
          toPort: 'inlet',
          isValid: true
        }
      ],
      metadata: {
        name: 'Pipe-Plenum Model',
        description: 'Pipe connected to plenum chamber',
        created: new Date(),
        modified: new Date(),
        version: '1.0'
      },
      validationResult: {
        isValid: true,
        errors: []
      }
    }
  }
];

// ============================================================================
// COMPONENT LIBRARY CLASS
// ============================================================================

export class OpenWAMComponentLibrary implements ComponentLibrary {
  public readonly categories: ComponentCategory[];
  public readonly components: ComponentDefinition[];
  public readonly connectionRules: ConnectionRule[];
  public readonly templates: ModelTemplate[];

  constructor() {
    this.categories = getAvailableCategories();
    this.components = componentDefinitions;
    this.connectionRules = [...connectionRules, ...advancedConnectionRules];
    this.templates = modelTemplates;
  }

  /**
   * Get component definition by type
   */
  getComponent(type: ComponentType): ComponentDefinition | undefined {
    return getComponentDefinition(type);
  }

  /**
   * Get all components in a category
   */
  getComponentsByCategory(category: ComponentCategory): ComponentDefinition[] {
    return getComponentsByCategory(category);
  }

  /**
   * Search components by name or description
   */
  searchComponents(query: string): ComponentDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.components.filter(component =>
      component.name.toLowerCase().includes(lowerQuery) ||
      component.description.toLowerCase().includes(lowerQuery) ||
      component.type.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get components that can connect to a specific component type and port
   */
  getCompatibleComponents(
    componentType: ComponentType,
    portType: string
  ): ComponentDefinition[] {
    const compatibleTypes = new Set<ComponentType>();

    // Find all connection rules that allow connection from the given component/port
    this.connectionRules.forEach(rule => {
      if (rule.fromType === componentType && rule.fromPortType === portType && rule.isAllowed) {
        compatibleTypes.add(rule.toType);
      }
      if (rule.toType === componentType && rule.toPortType === portType && rule.isAllowed) {
        compatibleTypes.add(rule.fromType);
      }
    });

    return this.components.filter(component => 
      compatibleTypes.has(component.type)
    );
  }

  /**
   * Get model template by ID
   */
  getTemplate(id: string): ModelTemplate | undefined {
    return this.templates.find(template => template.id === id);
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: string): ModelTemplate[] {
    return this.templates.filter(template => template.category === category);
  }

  /**
   * Get all template categories
   */
  getTemplateCategories(): string[] {
    return Array.from(new Set(this.templates.map(template => template.category)));
  }

  /**
   * Create a new component instance with default properties
   */
  createComponentInstance(
    type: ComponentType,
    id: string,
    position: { x: number; y: number }
  ): ModelComponent | undefined {
    const definition = this.getComponent(type);
    if (!definition) {
      return undefined;
    }

    return {
      id,
      type,
      position,
      rotation: 0,
      properties: {
        ...definition.defaultProperties,
        id
      }
    };
  }

  /**
   * Validate if two components can be connected
   */
  canConnect(
    fromType: ComponentType,
    fromPort: string,
    toType: ComponentType,
    toPort: string
  ): boolean {
    return this.connectionRules.some(rule =>
      rule.fromType === fromType &&
      rule.fromPortType === fromPort &&
      rule.toType === toType &&
      rule.toPortType === toPort &&
      rule.isAllowed
    );
  }

  /**
   * Get connection rule between two component types and ports
   */
  getConnectionRule(
    fromType: ComponentType,
    fromPort: string,
    toType: ComponentType,
    toPort: string
  ): ConnectionRule | undefined {
    return this.connectionRules.find(rule =>
      rule.fromType === fromType &&
      rule.fromPortType === fromPort &&
      rule.toType === toType &&
      rule.toPortType === toPort
    );
  }

  /**
   * Add a custom component definition
   */
  addCustomComponent(definition: ComponentDefinition): void {
    // Check if component already exists
    const existingIndex = this.components.findIndex(c => c.type === definition.type);
    if (existingIndex >= 0) {
      // Replace existing definition
      this.components[existingIndex] = definition;
    } else {
      // Add new definition
      this.components.push(definition);
      
      // Add category if it doesn't exist
      if (!this.categories.includes(definition.category)) {
        this.categories.push(definition.category);
      }
    }
  }

  /**
   * Add a custom connection rule
   */
  addConnectionRule(rule: ConnectionRule): void {
    // Check if rule already exists
    const existingIndex = this.connectionRules.findIndex(r =>
      r.fromType === rule.fromType &&
      r.fromPortType === rule.fromPortType &&
      r.toType === rule.toType &&
      r.toPortType === rule.toPortType
    );

    if (existingIndex >= 0) {
      // Replace existing rule
      this.connectionRules[existingIndex] = rule;
    } else {
      // Add new rule
      this.connectionRules.push(rule);
    }
  }

  /**
   * Add a custom model template
   */
  addTemplate(template: ModelTemplate): void {
    // Check if template already exists
    const existingIndex = this.templates.findIndex(t => t.id === template.id);
    if (existingIndex >= 0) {
      // Replace existing template
      this.templates[existingIndex] = template;
    } else {
      // Add new template
      this.templates.push(template);
    }
  }

  /**
   * Export library configuration
   */
  exportLibrary(): ComponentLibrary {
    return {
      categories: [...this.categories],
      components: [...this.components],
      connectionRules: [...this.connectionRules],
      templates: [...this.templates]
    };
  }

  /**
   * Import library configuration
   */
  importLibrary(library: Partial<ComponentLibrary>): void {
    if (library.components) {
      library.components.forEach(component => {
        this.addCustomComponent(component);
      });
    }

    if (library.connectionRules) {
      library.connectionRules.forEach(rule => {
        this.addConnectionRule(rule);
      });
    }

    if (library.templates) {
      library.templates.forEach(template => {
        this.addTemplate(template);
      });
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global component library instance
 */
export const componentLibrary = new OpenWAMComponentLibrary();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the global component library instance
 */
export function getComponentLibrary(): OpenWAMComponentLibrary {
  return componentLibrary;
}

/**
 * Quick access to component definition
 */
export function getComponent(type: ComponentType): ComponentDefinition | undefined {
  return componentLibrary.getComponent(type);
}

/**
 * Quick access to create component instance
 */
export function createComponent(
  type: ComponentType,
  id: string,
  position: { x: number; y: number }
): ModelComponent | undefined {
  return componentLibrary.createComponentInstance(type, id, position);
}

/**
 * Quick check if two components can be connected
 */
export function canConnect(
  fromType: ComponentType,
  fromPort: string,
  toType: ComponentType,
  toPort: string
): boolean {
  return componentLibrary.canConnect(fromType, fromPort, toType, toPort);
}
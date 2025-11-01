/**
 * OpenWAM Input File Generator
 * Based on actual OpenWAM source code analysis from TOpenWAM::ReadInputData
 */

import {
  EngineModel,
  ModelComponent,
  ComponentType,
  PipeProperties,
  PlenumProperties,
  ValveProperties,
  BoundaryProperties,
  EngineProperties,
  CompressorProperties,
  ComponentProperties,
  BoundaryConditionType,
  ValveType,
  PlenumType,
  CompressorModel,
  EngineType,
  HeatTransferType,
  MeshType
} from '../types/openWAMComponents';

/**
 * OpenWAM input file generation configuration
 */
export interface OpenWAMGenerationConfig {
  version?: number;
  independent?: boolean;
  angleIncrement?: number;
  simulationDuration?: number;
  ambientPressure?: number;
  ambientTemperature?: number;
  speciesCalculationType?: number;
  gammaCalculationType?: number;
  engineType?: EngineType;
  modelingType?: number;
  hasEGR?: boolean;
  hasFuel?: boolean;
  fuelType?: number;
  cyclesWithoutThermalInertia?: number;
  atmosphericComposition?: number[];
}

/**
 * Default configuration for OpenWAM generation
 */
const DEFAULT_CONFIG: Required<OpenWAMGenerationConfig> = {
  version: 2200,
  independent: false,
  angleIncrement: 1.0,
  simulationDuration: 720.0,
  ambientPressure: 101325.0,
  ambientTemperature: 293.15,
  speciesCalculationType: 0, // Simple calculation
  gammaCalculationType: 0,   // Constant gamma
  engineType: EngineType.FOUR_STROKE,
  modelingType: 0,           // Steady state
  hasEGR: false,
  hasFuel: true,
  fuelType: 0,               // Diesel
  cyclesWithoutThermalInertia: 0,
  atmosphericComposition: [0.0, 0.0, 1.0] // Simple: [burned gases, fuel, air]
};

/**
 * OpenWAM Input File Generator
 * Generates .wam files based on visual engine models
 */
export class OpenWAMGenerator {
  private config: Required<OpenWAMGenerationConfig>;

  constructor(config: Partial<OpenWAMGenerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate complete OpenWAM input file from engine model
   */
  generateInputFile(model: EngineModel): string {
    let content = '';

    // 1. Version and independence flag
    content += this.generateHeader();

    // 2. General data
    content += this.generateGeneralData(model);

    // 3. Engine data (if exists)
    content += this.generateEngineData(model);

    // 4. Pipe data
    content += this.generatePipeData(model);

    // 5. DPF data (if enabled)
    content += this.generateDPFData(model);

    // 6. Concentric elements data (if enabled)
    content += this.generateConcentricData(model);

    // 7. Valve data
    content += this.generateValveData(model);

    // 8. Plenum data
    content += this.generatePlenumData(model);

    // 9. Compressor data
    content += this.generateCompressorData(model);

    // 10. Boundary conditions data
    content += this.generateBoundaryConditions(model);

    // 11. Turbocharger axis data
    content += this.generateTurbochargerAxisData(model);

    // 12. Sensor data
    content += this.generateSensorData(model);

    // 13. Controller data
    content += this.generateControllerData(model);

    // 14. Output data
    content += this.generateOutputData(model);

    // 15. DLL calculation flag
    content += this.generateDLLFlag(model);

    return content;
  }

  /**
   * Generate file header (version and independence flag)
   */
  private generateHeader(): string {
    let section = '';
    section += `${this.config.version}\n`;
    section += `${this.config.independent ? 1 : 0}\n`;
    return section;
  }

  /**
   * Generate general data section
   */
  private generateGeneralData(model: EngineModel): string {
    let section = '';

    // Angle increment and simulation duration
    section += `${this.config.angleIncrement} ${this.config.simulationDuration}\n`;

    // Ambient conditions
    section += `${this.config.ambientPressure} ${this.config.ambientTemperature}\n`;

    // Species calculation and gamma calculation types
    section += `${this.config.speciesCalculationType} ${this.config.gammaCalculationType}\n`;

    // Engine block existence flag
    const hasEngine = this.hasEngineBlock(model);
    section += `${hasEngine ? 1 : 0}\n`;

    if (hasEngine) {
      // Engine type, modeling type, EGR flag
      const engineTypeNum = this.config.engineType === EngineType.TWO_STROKE ? 1 : 2;
      section += `${engineTypeNum} ${this.config.modelingType} ${this.config.hasEGR ? 1 : 0}\n`;

      // Cycles without thermal inertia (for transient calculations)
      if (this.config.modelingType !== 0) {
        section += `${this.config.cyclesWithoutThermalInertia}\n`;
      }
    }

    // Fuel data
    section += `${this.config.hasFuel ? 1 : 0}\n`;
    if (this.config.hasFuel) {
      section += `${this.config.fuelType}\n`;
    }

    // Atmospheric composition
    this.config.atmosphericComposition.forEach((fraction, index) => {
      if (index < this.config.atmosphericComposition.length - 1) {
        section += `${fraction} `;
      } else {
        section += `${fraction}\n`;
      }
    });

    return section;
  }

  /**
   * Generate engine data section
   */
  private generateEngineData(model: EngineModel): string {
    // Engine data is handled by the engine component itself
    // This section is typically empty as the engine reads its own data
    return '';
  }

  /**
   * Generate pipe data section
   */
  private generatePipeData(model: EngineModel): string {
    const pipes = this.getComponentsByType(model, ComponentType.PIPE);
    let section = `${pipes.length}\n`;

    pipes.forEach((pipe) => {
      const props = pipe.properties as PipeProperties;
      
      // Basic data: number, left node, right node, cells, class, length, mesh size
      section += `${props.numeroTubo} ${props.nodoIzq} ${props.nodoDer} `;
      section += `${props.nin} 1 ${props.longitudTotal} ${props.mallado}\n`;

      // Geometry data: sections number, mesh type
      section += `${props.nTramos} ${props.tipoMallado}\n`;

      // Each section length and diameter
      for (let i = 0; i < props.nTramos; i++) {
        section += `${props.lTramo[i]} ${props.dExtTramo[i]}\n`;
      }

      // Heat transfer and friction characteristics
      section += `${props.tipoTransCal} ${props.coefAjusFric} ${props.coefAjusTC}\n`;

      // Wall material properties
      section += `${props.espesorPrin} ${props.densidadPrin} `;
      section += `${props.calEspPrin} ${props.conductPrin}\n`;

      // Coolant data
      const coolantType = props.tipRefrig === 'air' ? 0 : 1;
      section += `${props.tRefrigerante} ${coolantType}\n`;

      // Initial conditions
      section += `${props.tini} ${props.pini} ${props.velMedia}\n`;

      // Wall layers data
      section += `${props.numCapas}\n`;
      props.capas.forEach(layer => {
        section += `${layer.espesor} ${layer.density} `;
        section += `${layer.calorEspecifico} ${layer.conductividad}\n`;
      });
    });

    return section;
  }

  /**
   * Generate DPF data section
   */
  private generateDPFData(model: EngineModel): string {
    const dpfComponents = this.getComponentsByType(model, ComponentType.DPF);
    let section = `${dpfComponents.length}\n`;

    // DPF data generation would go here
    // For now, return basic structure
    return section;
  }

  /**
   * Generate concentric elements data section
   */
  private generateConcentricData(model: EngineModel): string {
    const concentricComponents = this.getComponentsByType(model, ComponentType.CONCENTRIC_PIPE);
    let section = `${concentricComponents.length}\n`;

    // Concentric elements data generation would go here
    return section;
  }

  /**
   * Generate valve data section
   */
  private generateValveData(model: EngineModel): string {
    const valves = this.getValveComponents(model);
    let section = `${valves.length}\n`;

    valves.forEach((valve) => {
      const props = valve.properties as ValveProperties;
      
      // Valve type number
      section += `${this.getValveTypeNumber(props.tipoValvula)}\n`;

      // Valve type specific data
      section += this.generateSpecificValveData(valve);
    });

    return section;
  }

  /**
   * Generate plenum data section
   */
  private generatePlenumData(model: EngineModel): string {
    const plenums = this.getPlenumComponents(model);
    const turbines = plenums.filter(p => this.isTurbineType(p));
    const venturis = plenums.filter(p => this.isVenturiType(p));
    const directionalUnions = plenums.filter(p => this.isDirectionalUnionType(p));

    let section = `${plenums.length}\n`;
    section += `${turbines.length} ${venturis.length} ${directionalUnions.length}\n`;

    plenums.forEach((plenum) => {
      const props = plenum.properties as PlenumProperties;
      
      // Plenum type number
      section += `${this.getPlenumTypeNumber(props.tipoDeposito)}\n`;

      // Type-specific additional data
      if (this.isTurbineType(plenum)) {
        section += `${props.turbineNumber || 1}\n`;
      } else if (this.isVenturiType(plenum)) {
        section += `${props.venturiNumber || 1}\n`;
      }

      // Basic plenum data
      section += this.generateBasicPlenumData(props);

      // Type-specific detailed data
      section += this.generateSpecificPlenumData(plenum);
    });

    return section;
  }

  /**
   * Generate compressor data section
   */
  private generateCompressorData(model: EngineModel): string {
    const compressors = this.getCompressorComponents(model);
    let section = `${compressors.length}\n`;

    compressors.forEach((compressor) => {
      const props = compressor.properties as CompressorProperties;
      
      // Compressor model type
      section += `${props.modeloCompresor}\n`;

      // Model-specific data
      section += this.generateSpecificCompressorData(compressor);
    });

    return section;
  }

  /**
   * Generate boundary conditions data section
   */
  private generateBoundaryConditions(model: EngineModel): string {
    const boundaries = this.getBoundaryComponents(model);
    
    // Count different types for WAMer compatibility
    const counts = this.countBoundaryTypes(boundaries);
    
    let section = `${boundaries.length}\n`;
    section += `${counts.simpleNodes} ${counts.pulses} ${counts.plenumNodes} `;
    section += `${counts.pressureLosses} ${counts.volumetricCompressors} `;
    section += `${counts.injectionEnds} ${counts.plenumConnections} `;
    section += `${counts.compressorInlets} ${counts.staticPressureInlets}\n`;

    boundaries.forEach((boundary) => {
      const props = boundary.properties as BoundaryProperties;
      
      // Boundary condition type
      section += `${props.tipoCC}\n`;

      // Type-specific data
      section += this.generateSpecificBoundaryData(boundary);
    });

    return section;
  }

  /**
   * Generate turbocharger axis data section
   */
  private generateTurbochargerAxisData(model: EngineModel): string {
    const axes = this.getComponentsByType(model, ComponentType.TURBO_AXIS);
    let section = `${axes.length}\n`;

    // Turbocharger axis data generation would go here
    return section;
  }

  /**
   * Generate sensor data section
   */
  private generateSensorData(model: EngineModel): string {
    const sensors = this.getComponentsByType(model, ComponentType.SENSOR);
    let section = `${sensors.length}\n`;

    // Sensor data generation would go here
    return section;
  }

  /**
   * Generate controller data section
   */
  private generateControllerData(model: EngineModel): string {
    const controllers = this.getControllerComponents(model);
    let section = `${controllers.length}\n`;

    // Controller data generation would go here
    return section;
  }

  /**
   * Generate output data section
   */
  private generateOutputData(model: EngineModel): string {
    // Output configuration - basic structure
    let section = '';
    section += '1\n'; // Number of output files
    section += '0\n'; // Output type
    return section;
  }

  /**
   * Generate DLL calculation flag
   */
  private generateDLLFlag(model: EngineModel): string {
    return '0\n'; // No DLL calculations by default
  }

  // Helper methods

  private hasEngineBlock(model: EngineModel): boolean {
    return this.getComponentsByType(model, ComponentType.ENGINE_BLOCK).length > 0;
  }

  private getComponentsByType(model: EngineModel, type: ComponentType): ModelComponent[] {
    return model.components.filter(c => c.type === type);
  }

  private getValveComponents(model: EngineModel): ModelComponent[] {
    const valveTypes = [
      ComponentType.FIXED_CD_VALVE,
      ComponentType.VALVE_4T,
      ComponentType.REED_VALVE,
      ComponentType.ROTARY_DISC_VALVE,
      ComponentType.PORT_2T_VALVE,
      ComponentType.CONTROL_VALVE,
      ComponentType.WASTEGATE_VALVE,
      ComponentType.TURBINE_STATOR_VALVE,
      ComponentType.TURBINE_ROTOR_VALVE,
      ComponentType.EXTERNAL_CALC_VALVE,
      ComponentType.BUTTERFLY_VALVE
    ];
    return model.components.filter(c => valveTypes.includes(c.type));
  }

  private getPlenumComponents(model: EngineModel): ModelComponent[] {
    const plenumTypes = [
      ComponentType.CONSTANT_VOLUME_PLENUM,
      ComponentType.VARIABLE_VOLUME_PLENUM,
      ComponentType.SIMPLE_TURBINE,
      ComponentType.TWIN_TURBINE,
      ComponentType.VENTURI,
      ComponentType.DIRECTIONAL_UNION
    ];
    return model.components.filter(c => plenumTypes.includes(c.type));
  }

  private getCompressorComponents(model: EngineModel): ModelComponent[] {
    const compressorTypes = [
      ComponentType.COMPRESSOR_DEP,
      ComponentType.COMPRESSOR_TUB_DEP,
      ComponentType.COMPRESSOR_TUBES
    ];
    return model.components.filter(c => compressorTypes.includes(c.type));
  }

  private getBoundaryComponents(model: EngineModel): ModelComponent[] {
    const boundaryTypes = [
      ComponentType.OPEN_END_ATMOSPHERE,
      ComponentType.OPEN_END_RESERVOIR,
      ComponentType.CLOSED_END,
      ComponentType.ANECHOIC_END,
      ComponentType.PULSE_END,
      ComponentType.INJECTION_END,
      ComponentType.PRESSURE_LOSS,
      ComponentType.PIPES_CONNECTION,
      ComponentType.PIPE_TO_PLENUM,
      ComponentType.BRANCH,
      ComponentType.VOLUMETRIC_COMPRESSOR_BC,
      ComponentType.COMPRESSOR_INLET_BC,
      ComponentType.UNION_BETWEEN_PLENUMS_BC,
      ComponentType.COMPRESSOR_BC,
      ComponentType.VARIABLE_PRESSURE_BC,
      ComponentType.CFD_CONNECTION_BC,
      ComponentType.EXTERNAL_CONNECTION_BC
    ];
    return model.components.filter(c => boundaryTypes.includes(c.type));
  }

  private getControllerComponents(model: EngineModel): ModelComponent[] {
    const controllerTypes = [
      ComponentType.PID_CONTROLLER,
      ComponentType.TABLE_1D,
      ComponentType.CONTROLLER,
      ComponentType.DECISOR,
      ComponentType.GAIN
    ];
    return model.components.filter(c => controllerTypes.includes(c.type));
  }

  private isTurbineType(component: ModelComponent): boolean {
    return component.type === ComponentType.SIMPLE_TURBINE || 
           component.type === ComponentType.TWIN_TURBINE;
  }

  private isVenturiType(component: ModelComponent): boolean {
    return component.type === ComponentType.VENTURI;
  }

  private isDirectionalUnionType(component: ModelComponent): boolean {
    return component.type === ComponentType.DIRECTIONAL_UNION;
  }

  private getValveTypeNumber(type: ValveType): number {
    const typeMap: Partial<Record<ValveType, number>> = {
      [ValveType.FIXED_CD]: 0,
      [ValveType.VALVE_4T]: 1,
      [ValveType.REED_VALVE]: 2,
      [ValveType.ROTARY_DISC]: 3,
      [ValveType.PORT_2T]: 4,
      [ValveType.CONTROL_VALVE]: 5,
      [ValveType.WASTEGATE]: 6,
      [ValveType.TURBINE_STATOR]: 7,
      [ValveType.TURBINE_ROTOR]: 8,
      [ValveType.EXTERNAL_CALC]: 9,
      [ValveType.BUTTERFLY_VALVE]: 10
    };
    return typeMap[type] || 0;
  }

  private getPlenumTypeNumber(type: PlenumType): number {
    const typeMap: Partial<Record<PlenumType, number>> = {
      [PlenumType.CONSTANT_VOLUME]: 0,
      [PlenumType.VARIABLE_VOLUME]: 1,
      [PlenumType.SIMPLE_TURBINE]: 2,
      [PlenumType.TWIN_TURBINE]: 3,
      [PlenumType.VENTURI]: 4,
      [PlenumType.DIRECTIONAL_UNION]: 5
    };
    return typeMap[type] || 0;
  }

  private generateSpecificValveData(valve: ModelComponent): string {
    // Generate valve-specific data based on valve type
    // This would contain the detailed valve parameters
    return ''; // Placeholder
  }

  private generateBasicPlenumData(props: PlenumProperties): string {
    let section = '';
    section += `${props.numeroDeposito}\n`;
    section += `${props.volumen0}\n`;
    section += `${props.temperature} ${props.pressure}\n`;
    section += `${props.masa0}\n`;
    return section;
  }

  private generateSpecificPlenumData(plenum: ModelComponent): string {
    // Generate plenum-specific data based on plenum type
    return ''; // Placeholder
  }

  private generateSpecificCompressorData(compressor: ModelComponent): string {
    // Generate compressor-specific data based on compressor model
    return ''; // Placeholder
  }

  private generateSpecificBoundaryData(boundary: ModelComponent): string {
    // Generate boundary condition specific data
    return ''; // Placeholder
  }

  private countBoundaryTypes(boundaries: ModelComponent[]): {
    simpleNodes: number;
    pulses: number;
    plenumNodes: number;
    pressureLosses: number;
    volumetricCompressors: number;
    injectionEnds: number;
    plenumConnections: number;
    compressorInlets: number;
    staticPressureInlets: number;
  } {
    // Count different boundary condition types for WAMer compatibility
    return {
      simpleNodes: 0,
      pulses: 0,
      plenumNodes: 0,
      pressureLosses: 0,
      volumetricCompressors: 0,
      injectionEnds: 0,
      plenumConnections: 0,
      compressorInlets: 0,
      staticPressureInlets: 0
    };
  }
}
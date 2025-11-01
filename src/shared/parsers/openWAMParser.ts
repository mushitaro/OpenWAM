/**
 * OpenWAM File Parser
 * Parses existing .wam files and converts them to visual models
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
  MeshType,
  WallLayer,
  Connection
} from '../types/openWAMComponents';

/**
 * Parsed OpenWAM file data structure
 */
export interface ParsedOpenWAMData {
  version: number;
  independent: boolean;
  generalData: GeneralData;
  engineData?: EngineData;
  pipes: PipeData[];
  dpfs: DPFData[];
  concentrics: ConcentricData[];
  valves: ValveData[];
  plenums: PlenumData[];
  compressors: CompressorData[];
  boundaries: BoundaryData[];
  axes: AxisData[];
  sensors: SensorData[];
  controllers: ControllerData[];
  outputConfig: OutputConfig;
  hasDLL: boolean;
}

export interface GeneralData {
  angleIncrement: number;
  simulationDuration: number;
  ambientPressure: number;
  ambientTemperature: number;
  speciesCalculationType: number;
  gammaCalculationType: number;
  hasEngine: boolean;
  engineType?: EngineType;
  modelingType?: number;
  hasEGR?: boolean;
  hasFuel: boolean;
  fuelType?: number;
  cyclesWithoutThermalInertia?: number;
  atmosphericComposition: number[];
}

export interface EngineData {
  type: EngineType;
  geometry: {
    nCilin: number;
    carrera: number;
    diametro: number;
    biela: number;
    vcc: number;
    relaCompresion: number;
  };
  combustible: 'diesel' | 'gasoline';
}

export interface PipeData {
  numeroTubo: number;
  nodoIzq: number;
  nodoDer: number;
  nin: number;
  longitudTotal: number;
  mallado: number;
  nTramos: number;
  tipoMallado: MeshType;
  lTramo: number[];
  dExtTramo: number[];
  tipoTransCal: HeatTransferType;
  coefAjusFric: number;
  coefAjusTC: number;
  espesorPrin: number;
  densidadPrin: number;
  calEspPrin: number;
  conductPrin: number;
  tRefrigerante: number;
  tipRefrig: 'air' | 'water';
  tini: number;
  pini: number;
  velMedia: number;
  numCapas: number;
  capas: WallLayer[];
}

export interface DPFData {
  id: number;
  // DPF specific properties
}

export interface ConcentricData {
  id: number;
  numDucts: number;
  // Concentric specific properties
}

export interface ValveData {
  type: ValveType;
  id: number;
  // Valve specific properties
}

export interface PlenumData {
  type: PlenumType;
  numeroDeposito: number;
  volumen0: number;
  temperature: number;
  pressure: number;
  masa0: number;
  turbineNumber?: number;
  venturiNumber?: number;
  // Type-specific properties
}

export interface CompressorData {
  type: CompressorModel;
  id: number;
  // Compressor specific properties
}

export interface BoundaryData {
  type: BoundaryConditionType;
  id: number;
  // Boundary specific properties
}

export interface AxisData {
  id: number;
  // Axis specific properties
}

export interface SensorData {
  id: number;
  // Sensor specific properties
}

export interface ControllerData {
  id: number;
  // Controller specific properties
}

export interface OutputConfig {
  numFiles: number;
  outputType: number;
}

/**
 * OpenWAM File Parser
 * Parses .wam files using fscanf patterns from OpenWAM source code
 */
export class OpenWAMParser {
  private lines: string[];
  private currentLine: number;

  constructor() {
    this.lines = [];
    this.currentLine = 0;
  }

  /**
   * Parse OpenWAM file content and return structured data
   */
  parseFile(content: string): ParsedOpenWAMData {
    this.lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    this.currentLine = 0;

    const data: ParsedOpenWAMData = {
      version: 0,
      independent: false,
      generalData: {} as GeneralData,
      pipes: [],
      dpfs: [],
      concentrics: [],
      valves: [],
      plenums: [],
      compressors: [],
      boundaries: [],
      axes: [],
      sensors: [],
      controllers: [],
      outputConfig: { numFiles: 0, outputType: 0 },
      hasDLL: false
    };

    try {
      // Parse header
      this.parseHeader(data);

      // Parse general data
      this.parseGeneralData(data);

      // Parse engine data (if exists)
      if (data.generalData.hasEngine) {
        this.parseEngineData(data);
      }

      // Parse pipes
      this.parsePipes(data);

      // Parse DPF (if enabled)
      this.parseDPF(data);

      // Parse concentric elements (if enabled)
      this.parseConcentric(data);

      // Parse valves
      this.parseValves(data);

      // Parse plenums
      this.parsePlenums(data);

      // Parse compressors
      this.parseCompressors(data);

      // Parse boundary conditions
      this.parseBoundaries(data);

      // Parse turbocharger axes
      this.parseAxes(data);

      // Parse sensors
      this.parseSensors(data);

      // Parse controllers
      this.parseControllers(data);

      // Parse output configuration
      this.parseOutput(data);

      // Parse DLL flag
      this.parseDLLFlag(data);

    } catch (error) {
      throw new Error(`OpenWAM parsing error at line ${this.currentLine + 1}: ${error}`);
    }

    return data;
  }

  /**
   * Convert parsed data to visual engine model
   */
  convertToEngineModel(data: ParsedOpenWAMData): EngineModel {
    const model: EngineModel = {
      components: [],
      connections: [],
      metadata: {
        name: 'Imported OpenWAM Model',
        description: `Imported from OpenWAM version ${data.version}`,
        created: new Date(),
        modified: new Date(),
        version: '1.0'
      },
      validationResult: {
        isValid: true,
        errors: [],
        warnings: []
      }
    };

    // Convert components
    this.convertPipesToComponents(data.pipes, model);
    this.convertPlenumToComponents(data.plenums, model);
    this.convertValvesToComponents(data.valves, model);
    this.convertBoundariesToComponents(data.boundaries, model);
    this.convertCompressorsToComponents(data.compressors, model);

    // Generate connections based on node relationships
    this.generateConnections(data, model);

    // Auto-arrange components
    this.autoArrangeComponents(model);

    return model;
  }

  // Parsing methods

  private parseHeader(data: ParsedOpenWAMData): void {
    data.version = this.readInt();
    data.independent = this.readInt() === 1;
  }

  private parseGeneralData(data: ParsedOpenWAMData): void {
    const generalData: GeneralData = {
      angleIncrement: this.readFloat(),
      simulationDuration: this.readFloat(),
      ambientPressure: this.readFloat(),
      ambientTemperature: this.readFloat(),
      speciesCalculationType: this.readInt(),
      gammaCalculationType: this.readInt(),
      hasEngine: this.readInt() === 1,
      hasFuel: false,
      atmosphericComposition: []
    };

    if (generalData.hasEngine) {
      const engineTypeNum = this.readInt();
      generalData.engineType = engineTypeNum === 1 ? EngineType.TWO_STROKE : EngineType.FOUR_STROKE;
      generalData.modelingType = this.readInt();
      generalData.hasEGR = this.readInt() === 1;

      if (generalData.modelingType !== 0) {
        generalData.cyclesWithoutThermalInertia = this.readInt();
      }
    }

    // Fuel data
    generalData.hasFuel = this.readInt() === 1;
    if (generalData.hasFuel) {
      generalData.fuelType = this.readInt();
    }

    // Atmospheric composition
    const numSpecies = this.getSpeciesNumber(generalData);
    generalData.atmosphericComposition = [];
    for (let i = 0; i < numSpecies - 1; i++) {
      generalData.atmosphericComposition.push(this.readFloat());
    }

    data.generalData = generalData;
  }

  private parseEngineData(data: ParsedOpenWAMData): void {
    // Engine data is typically read by the engine component itself
    // For now, we'll skip this section as it's handled separately
  }

  private parsePipes(data: ParsedOpenWAMData): void {
    const numPipes = this.readInt();
    
    for (let i = 0; i < numPipes; i++) {
      const pipe: PipeData = {
        numeroTubo: this.readInt(),
        nodoIzq: this.readInt(),
        nodoDer: this.readInt(),
        nin: this.readInt(),
        longitudTotal: 0,
        mallado: 0,
        nTramos: 0,
        tipoMallado: MeshType.DISTANCE,
        lTramo: [],
        dExtTramo: [],
        tipoTransCal: HeatTransferType.INTAKE_PIPE,
        coefAjusFric: 0,
        coefAjusTC: 0,
        espesorPrin: 0,
        densidadPrin: 0,
        calEspPrin: 0,
        conductPrin: 0,
        tRefrigerante: 0,
        tipRefrig: 'air',
        tini: 0,
        pini: 0,
        velMedia: 0,
        numCapas: 0,
        capas: []
      };

      // Skip class number
      this.readInt();
      
      pipe.longitudTotal = this.readFloat();
      pipe.mallado = this.readFloat();

      // Geometry data
      pipe.nTramos = this.readInt();
      pipe.tipoMallado = this.readInt() as MeshType;

      // Section lengths and diameters
      pipe.lTramo = [];
      pipe.dExtTramo = [];
      for (let j = 0; j < pipe.nTramos; j++) {
        pipe.lTramo.push(this.readFloat());
        pipe.dExtTramo.push(this.readFloat());
      }

      // Heat transfer and friction
      pipe.tipoTransCal = this.readInt() as HeatTransferType;
      pipe.coefAjusFric = this.readFloat();
      pipe.coefAjusTC = this.readFloat();

      // Wall properties
      pipe.espesorPrin = this.readFloat();
      pipe.densidadPrin = this.readFloat();
      pipe.calEspPrin = this.readFloat();
      pipe.conductPrin = this.readFloat();

      // Coolant
      pipe.tRefrigerante = this.readFloat();
      const coolantType = this.readInt();
      pipe.tipRefrig = coolantType === 0 ? 'air' : 'water';

      // Initial conditions
      pipe.tini = this.readFloat();
      pipe.pini = this.readFloat();
      pipe.velMedia = this.readFloat();

      // Wall layers
      pipe.numCapas = this.readInt();
      pipe.capas = [];
      for (let j = 0; j < pipe.numCapas; j++) {
        const layer: WallLayer = {
          esPrincipal: j === 0,
          esFluida: false,
          espesor: this.readFloat(),
          density: this.readFloat(),
          calorEspecifico: this.readFloat(),
          conductividad: this.readFloat(),
          emisividadInterior: 0,
          emisividadExterior: 0
        };
        pipe.capas.push(layer);
      }

      data.pipes.push(pipe);
    }
  }

  private parseDPF(data: ParsedOpenWAMData): void {
    // DPF parsing would go here
    // For now, assume no DPF components
    data.dpfs = [];
  }

  private parseConcentric(data: ParsedOpenWAMData): void {
    // Concentric elements parsing would go here
    // For now, assume no concentric components
    data.concentrics = [];
  }

  private parseValves(data: ParsedOpenWAMData): void {
    const numValves = this.readInt();
    
    for (let i = 0; i < numValves; i++) {
      const valveType = this.readInt() as ValveType;
      const valve: ValveData = {
        type: valveType,
        id: i
      };
      
      // Skip valve-specific data for now
      // This would need to be implemented based on valve type
      
      data.valves.push(valve);
    }
  }

  private parsePlenums(data: ParsedOpenWAMData): void {
    const numPlenums = this.readInt();
    const numTurbines = this.readInt();
    const numVenturis = this.readInt();
    const numDirectionalUnions = this.readInt();

    for (let i = 0; i < numPlenums; i++) {
      const plenumType = this.readInt() as PlenumType;
      
      const plenum: PlenumData = {
        type: plenumType,
        numeroDeposito: i + 1,
        volumen0: 0,
        temperature: 0,
        pressure: 0,
        masa0: 0
      };

      // Type-specific data
      if (plenumType === PlenumType.SIMPLE_TURBINE || plenumType === PlenumType.TWIN_TURBINE) {
        plenum.turbineNumber = this.readInt();
      } else if (plenumType === PlenumType.VENTURI) {
        plenum.venturiNumber = this.readInt();
      }

      // Basic plenum data
      plenum.numeroDeposito = this.readInt();
      plenum.volumen0 = this.readFloat();
      plenum.temperature = this.readFloat();
      plenum.pressure = this.readFloat();
      plenum.masa0 = this.readFloat();

      data.plenums.push(plenum);
    }
  }

  private parseCompressors(data: ParsedOpenWAMData): void {
    const numCompressors = this.readInt();
    
    for (let i = 0; i < numCompressors; i++) {
      const compressorType = this.readInt() as CompressorModel;
      
      const compressor: CompressorData = {
        type: compressorType,
        id: i
      };

      // Skip compressor-specific data for now
      
      data.compressors.push(compressor);
    }
  }

  private parseBoundaries(data: ParsedOpenWAMData): void {
    const numBoundaries = this.readInt();
    
    // Skip WAMer compatibility counts
    for (let i = 0; i < 9; i++) {
      this.readInt();
    }

    for (let i = 0; i < numBoundaries; i++) {
      const boundaryType = this.readInt() as BoundaryConditionType;
      
      const boundary: BoundaryData = {
        type: boundaryType,
        id: i
      };

      // Skip boundary-specific data for now
      
      data.boundaries.push(boundary);
    }
  }

  private parseAxes(data: ParsedOpenWAMData): void {
    // Axes parsing would go here
    data.axes = [];
  }

  private parseSensors(data: ParsedOpenWAMData): void {
    // Sensors parsing would go here
    data.sensors = [];
  }

  private parseControllers(data: ParsedOpenWAMData): void {
    // Controllers parsing would go here
    data.controllers = [];
  }

  private parseOutput(data: ParsedOpenWAMData): void {
    data.outputConfig = {
      numFiles: this.readInt(),
      outputType: this.readInt()
    };
  }

  private parseDLLFlag(data: ParsedOpenWAMData): void {
    data.hasDLL = this.readInt() === 1;
  }

  // Conversion methods

  private convertPipesToComponents(pipes: PipeData[], model: EngineModel): void {
    pipes.forEach((pipeData, index) => {
      const component: ModelComponent = {
        id: `pipe_${index}`,
        type: ComponentType.PIPE,
        position: { x: index * 200, y: 100 }, // Auto-arrange
        rotation: 0,
        properties: this.convertPipeDataToProperties(pipeData),
        customName: `Pipe ${pipeData.numeroTubo}`
      };
      model.components.push(component);
    });
  }

  private convertPlenumToComponents(plenums: PlenumData[], model: EngineModel): void {
    plenums.forEach((plenumData, index) => {
      const componentType = this.getPlenumComponentType(plenumData.type);
      const component: ModelComponent = {
        id: `plenum_${index}`,
        type: componentType,
        position: { x: index * 200, y: 300 }, // Auto-arrange
        rotation: 0,
        properties: this.convertPlenumDataToProperties(plenumData),
        customName: `Plenum ${plenumData.numeroDeposito}`
      };
      model.components.push(component);
    });
  }

  private convertValvesToComponents(valves: ValveData[], model: EngineModel): void {
    valves.forEach((valveData, index) => {
      const componentType = this.getValveComponentType(valveData.type);
      const component: ModelComponent = {
        id: `valve_${index}`,
        type: componentType,
        position: { x: index * 200, y: 200 }, // Auto-arrange
        rotation: 0,
        properties: this.convertValveDataToProperties(valveData),
        customName: `Valve ${index + 1}`
      };
      model.components.push(component);
    });
  }

  private convertBoundariesToComponents(boundaries: BoundaryData[], model: EngineModel): void {
    boundaries.forEach((boundaryData, index) => {
      const componentType = this.getBoundaryComponentType(boundaryData.type);
      const component: ModelComponent = {
        id: `boundary_${index}`,
        type: componentType,
        position: { x: index * 200, y: 400 }, // Auto-arrange
        rotation: 0,
        properties: this.convertBoundaryDataToProperties(boundaryData),
        customName: `Boundary ${index + 1}`
      };
      model.components.push(component);
    });
  }

  private convertCompressorsToComponents(compressors: CompressorData[], model: EngineModel): void {
    compressors.forEach((compressorData, index) => {
      const componentType = this.getCompressorComponentType(compressorData.type);
      const component: ModelComponent = {
        id: `compressor_${index}`,
        type: componentType,
        position: { x: index * 200, y: 500 }, // Auto-arrange
        rotation: 0,
        properties: this.convertCompressorDataToProperties(compressorData),
        customName: `Compressor ${index + 1}`
      };
      model.components.push(component);
    });
  }

  private generateConnections(data: ParsedOpenWAMData, model: EngineModel): void {
    // Generate connections based on node relationships from pipes and boundaries
    // This is a simplified implementation - real implementation would need
    // to analyze the node connections from the OpenWAM data
    model.connections = [];
  }

  private autoArrangeComponents(model: EngineModel): void {
    // Simple auto-arrangement - place components in a grid
    const componentsPerRow = 5;
    const spacing = 200;

    model.components.forEach((component, index) => {
      const row = Math.floor(index / componentsPerRow);
      const col = index % componentsPerRow;
      component.position = {
        x: col * spacing + 100,
        y: row * spacing + 100
      };
    });
  }

  // Helper methods

  private readInt(): number {
    if (this.currentLine >= this.lines.length) {
      throw new Error('Unexpected end of file');
    }
    const values = this.lines[this.currentLine].split(/\s+/);
    if (values.length === 0) {
      this.currentLine++;
      return this.readInt();
    }
    const value = parseInt(values[0]);
    // Remove the consumed value
    this.lines[this.currentLine] = values.slice(1).join(' ');
    if (this.lines[this.currentLine].trim() === '') {
      this.currentLine++;
    }
    return value;
  }

  private readFloat(): number {
    if (this.currentLine >= this.lines.length) {
      throw new Error('Unexpected end of file');
    }
    const values = this.lines[this.currentLine].split(/\s+/);
    if (values.length === 0) {
      this.currentLine++;
      return this.readFloat();
    }
    const value = parseFloat(values[0]);
    // Remove the consumed value
    this.lines[this.currentLine] = values.slice(1).join(' ');
    if (this.lines[this.currentLine].trim() === '') {
      this.currentLine++;
    }
    return value;
  }

  private getSpeciesNumber(generalData: GeneralData): number {
    if (generalData.speciesCalculationType === 1) { // Complete calculation
      return generalData.hasFuel ? 10 : 9;
    } else { // Simple calculation
      return generalData.hasFuel ? 4 : 3;
    }
  }

  private convertPipeDataToProperties(pipeData: PipeData): PipeProperties {
    return {
      id: `pipe_${pipeData.numeroTubo}`,
      numeroTubo: pipeData.numeroTubo,
      nodoIzq: pipeData.nodoIzq,
      nodoDer: pipeData.nodoDer,
      nin: pipeData.nin,
      longitudTotal: pipeData.longitudTotal,
      mallado: pipeData.mallado,
      nTramos: pipeData.nTramos,
      tipoMallado: pipeData.tipoMallado,
      friccion: 0.02, // Default value
      tipoTransCal: pipeData.tipoTransCal,
      coefAjusFric: pipeData.coefAjusFric,
      coefAjusTC: pipeData.coefAjusTC,
      espesorPrin: pipeData.espesorPrin,
      densidadPrin: pipeData.densidadPrin,
      calEspPrin: pipeData.calEspPrin,
      conductPrin: pipeData.conductPrin,
      tRefrigerante: pipeData.tRefrigerante,
      tipRefrig: pipeData.tipRefrig,
      tini: pipeData.tini,
      pini: pipeData.pini,
      velMedia: pipeData.velMedia,
      lTramo: pipeData.lTramo,
      dExtTramo: pipeData.dExtTramo,
      numCapas: pipeData.numCapas,
      capas: pipeData.capas
    };
  }

  private convertPlenumDataToProperties(plenumData: PlenumData): PlenumProperties {
    return {
      id: `plenum_${plenumData.numeroDeposito}`,
      numeroDeposito: plenumData.numeroDeposito,
      volumen0: plenumData.volumen0,
      tipoDeposito: plenumData.type,
      temperature: plenumData.temperature,
      pressure: plenumData.pressure,
      masa0: plenumData.masa0,
      turbineNumber: plenumData.turbineNumber,
      venturiNumber: plenumData.venturiNumber
    };
  }

  private convertValveDataToProperties(valveData: ValveData): ValveProperties {
    return {
      id: `valve_${valveData.id}`,
      tipoValvula: valveData.type,
      tubo: 0,
      nodo: 0,
      tipo: 0,
      valvula: valveData.id,
      sentido: 0,
      diametroTubo: 0.05 // Default value
    };
  }

  private convertBoundaryDataToProperties(boundaryData: BoundaryData): BoundaryProperties {
    return {
      id: `boundary_${boundaryData.id}`,
      tipoCC: boundaryData.type,
      numeroCC: boundaryData.id
    };
  }

  private convertCompressorDataToProperties(compressorData: CompressorData): CompressorProperties {
    return {
      id: `compressor_${compressorData.id}`,
      numeroCompresor: compressorData.id,
      eje: 0,
      depRotor: 0,
      depStator: 0,
      modeloCompresor: compressorData.type
    };
  }

  private getPlenumComponentType(type: PlenumType): ComponentType {
    const typeMap: Partial<Record<PlenumType, ComponentType>> = {
      [PlenumType.CONSTANT_VOLUME]: ComponentType.CONSTANT_VOLUME_PLENUM,
      [PlenumType.VARIABLE_VOLUME]: ComponentType.VARIABLE_VOLUME_PLENUM,
      [PlenumType.SIMPLE_TURBINE]: ComponentType.SIMPLE_TURBINE,
      [PlenumType.TWIN_TURBINE]: ComponentType.TWIN_TURBINE,
      [PlenumType.VENTURI]: ComponentType.VENTURI,
      [PlenumType.DIRECTIONAL_UNION]: ComponentType.DIRECTIONAL_UNION
    };
    return typeMap[type] || ComponentType.CONSTANT_VOLUME_PLENUM;
  }

  private getValveComponentType(type: ValveType): ComponentType {
    const typeMap: Partial<Record<ValveType, ComponentType>> = {
      [ValveType.FIXED_CD]: ComponentType.FIXED_CD_VALVE,
      [ValveType.VALVE_4T]: ComponentType.VALVE_4T,
      [ValveType.REED_VALVE]: ComponentType.REED_VALVE,
      [ValveType.ROTARY_DISC]: ComponentType.ROTARY_DISC_VALVE,
      [ValveType.PORT_2T]: ComponentType.PORT_2T_VALVE,
      [ValveType.CONTROL_VALVE]: ComponentType.CONTROL_VALVE,
      [ValveType.WASTEGATE]: ComponentType.WASTEGATE_VALVE,
      [ValveType.TURBINE_STATOR]: ComponentType.TURBINE_STATOR_VALVE,
      [ValveType.TURBINE_ROTOR]: ComponentType.TURBINE_ROTOR_VALVE,
      [ValveType.EXTERNAL_CALC]: ComponentType.EXTERNAL_CALC_VALVE,
      [ValveType.BUTTERFLY_VALVE]: ComponentType.BUTTERFLY_VALVE
    };
    return typeMap[type] || ComponentType.FIXED_CD_VALVE;
  }

  private getBoundaryComponentType(type: BoundaryConditionType): ComponentType {
    const typeMap: Partial<Record<BoundaryConditionType, ComponentType>> = {
      [BoundaryConditionType.OPEN_END_ATMOSPHERE]: ComponentType.OPEN_END_ATMOSPHERE,
      [BoundaryConditionType.OPEN_END_RESERVOIR]: ComponentType.OPEN_END_RESERVOIR,
      [BoundaryConditionType.CLOSED_END]: ComponentType.CLOSED_END,
      [BoundaryConditionType.ANECHOIC_END]: ComponentType.ANECHOIC_END,
      [BoundaryConditionType.INCIDENT_PRESSURE_WAVE]: ComponentType.PULSE_END,
      [BoundaryConditionType.INJECTION_END]: ComponentType.INJECTION_END,
      [BoundaryConditionType.LINEAR_PRESSURE_LOSS]: ComponentType.PRESSURE_LOSS,
      [BoundaryConditionType.QUADRATIC_PRESSURE_LOSS]: ComponentType.PRESSURE_LOSS,
      [BoundaryConditionType.PIPES_CONNECTION]: ComponentType.PIPES_CONNECTION,
      [BoundaryConditionType.PIPE_TO_PLENUM_CONNECTION]: ComponentType.PIPE_TO_PLENUM,
      [BoundaryConditionType.BRANCH]: ComponentType.BRANCH,
      [BoundaryConditionType.VOLUMETRIC_COMPRESSOR]: ComponentType.VOLUMETRIC_COMPRESSOR_BC,
      [BoundaryConditionType.COMPRESSOR_INLET]: ComponentType.COMPRESSOR_INLET_BC,
      [BoundaryConditionType.UNION_BETWEEN_PLENUMS]: ComponentType.UNION_BETWEEN_PLENUMS_BC,
      [BoundaryConditionType.COMPRESSOR_BC]: ComponentType.COMPRESSOR_BC,
      [BoundaryConditionType.VARIABLE_PRESSURE]: ComponentType.VARIABLE_PRESSURE_BC,
      [BoundaryConditionType.CFD_CONNECTION]: ComponentType.CFD_CONNECTION_BC,
      [BoundaryConditionType.EXTERNAL_CONNECTION]: ComponentType.EXTERNAL_CONNECTION_BC
    };
    return typeMap[type] || ComponentType.OPEN_END_ATMOSPHERE;
  }

  private getCompressorComponentType(type: CompressorModel): ComponentType {
    const typeMap: Partial<Record<CompressorModel, ComponentType>> = {
      [CompressorModel.ORIGINAL]: ComponentType.COMPRESSOR_TUB_DEP,
      [CompressorModel.PLENUMS]: ComponentType.COMPRESSOR_DEP,
      [CompressorModel.PIPES]: ComponentType.COMPRESSOR_TUBES
    };
    return typeMap[type] || ComponentType.COMPRESSOR_TUB_DEP;
  }
}
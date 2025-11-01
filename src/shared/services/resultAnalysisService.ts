import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../server/utils/logger';

export interface TimeSeriesData {
  time: number[];
  values: number[];
  unit?: string;
  label?: string;
}

export interface ComponentData {
  componentId: string;
  componentType: string;
  pressure?: TimeSeriesData;
  temperature?: TimeSeriesData;
  velocity?: TimeSeriesData;
  massFlow?: TimeSeriesData;
  density?: TimeSeriesData;
}

export interface SimulationResults {
  metadata: {
    simulationId: number;
    projectId: number;
    startTime: Date;
    endTime?: Date;
    duration?: number; // in seconds
    engineSpeed?: number; // RPM
    cycles?: number;
    timeStep?: number;
  };
  components: ComponentData[];
  globalData: {
    time: number[];
    engineTorque?: TimeSeriesData;
    enginePower?: TimeSeriesData;
    fuelConsumption?: TimeSeriesData;
    airFlow?: TimeSeriesData;
    exhaustTemperature?: TimeSeriesData;
  };
  statistics: PerformanceMetrics;
}

export interface PerformanceMetrics {
  // Engine performance
  maxTorque?: number;
  maxPower?: number;
  meanEffectivePressure?: number;
  volumetricEfficiency?: number;
  thermalEfficiency?: number;
  
  // Flow characteristics
  maxPressure?: number;
  minPressure?: number;
  pressureAmplitude?: number;
  maxVelocity?: number;
  meanVelocity?: number;
  
  // Temperature characteristics
  maxTemperature?: number;
  minTemperature?: number;
  meanTemperature?: number;
  
  // Fuel consumption
  specificFuelConsumption?: number; // g/kWh
  fuelFlowRate?: number; // kg/h
  
  // Emissions (if available)
  noxEmissions?: number;
  coEmissions?: number;
  hcEmissions?: number;
  particulateEmissions?: number;
}

export interface DataPoint {
  x: number;
  y: number;
  label?: string;
}

export interface ChartData {
  datasets: {
    label: string;
    data: DataPoint[];
    borderColor?: string;
    backgroundColor?: string;
    componentId?: string;
    unit?: string;
  }[];
  xAxis: {
    label: string;
    unit: string;
    min?: number;
    max?: number;
  };
  yAxis: {
    label: string;
    unit: string;
    min?: number;
    max?: number;
  };
}

export class ResultAnalysisService {
  
  /**
   * Parse OpenWAM output files and extract simulation results
   */
  async parseSimulationResults(
    simulationId: number,
    projectId: number,
    outputDirectory: string
  ): Promise<SimulationResults> {
    logger.info(`Parsing simulation results for simulation ${simulationId}`);
    
    try {
      // Find all output files
      const outputFiles = await this.findOutputFiles(outputDirectory);
      
      // Initialize results structure
      const results: SimulationResults = {
        metadata: {
          simulationId,
          projectId,
          startTime: new Date()
        },
        components: [],
        globalData: {
          time: []
        },
        statistics: {}
      };
      
      // Parse each output file
      for (const filePath of outputFiles) {
        const fileType = this.identifyFileType(filePath);
        
        switch (fileType) {
          case 'csv':
            await this.parseCSVFile(filePath, results);
            break;
          case 'binary':
            await this.parseBinaryFile(filePath, results);
            break;
          case 'log':
            await this.parseLogFile(filePath, results);
            break;
          case 'summary':
            await this.parseSummaryFile(filePath, results);
            break;
          default:
            logger.warn(`Unknown file type for ${filePath}`);
        }
      }
      
      // Calculate performance metrics
      results.statistics = this.calculatePerformanceMetrics(results);
      
      // Set end time and duration
      results.metadata.endTime = new Date();
      if (results.globalData.time.length > 0) {
        results.metadata.duration = Math.max(...results.globalData.time);
      }
      
      logger.info(`Successfully parsed results for simulation ${simulationId}`);
      return results;
      
    } catch (error: any) {
      logger.error(`Error parsing simulation results for ${simulationId}:`, error);
      throw new Error(`Failed to parse simulation results: ${error.message}`);
    }
  }
  
  /**
   * Find all output files in the directory
   */
  private async findOutputFiles(outputDirectory: string): Promise<string[]> {
    try {
      const files = await fs.readdir(outputDirectory);
      const outputFiles: string[] = [];
      
      for (const file of files) {
        const filePath = path.join(outputDirectory, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          const ext = path.extname(file).toLowerCase();
          // OpenWAM typically outputs .csv, .dat, .txt, .out, .res files
          if (['.csv', '.dat', '.txt', '.out', '.res', '.log'].includes(ext)) {
            outputFiles.push(filePath);
          }
        }
      }
      
      return outputFiles;
    } catch (error: any) {
      logger.error(`Error reading output directory ${outputDirectory}:`, error);
      return [];
    }
  }
  
  /**
   * Identify the type of output file based on name and content
   */
  private identifyFileType(filePath: string): string {
    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(fileName);
    
    // Common OpenWAM output file patterns
    if (ext === '.csv' || fileName.includes('results') || fileName.includes('data')) {
      return 'csv';
    }
    if (ext === '.dat' || ext === '.res' || fileName.includes('binary')) {
      return 'binary';
    }
    if (ext === '.log' || fileName.includes('log')) {
      return 'log';
    }
    if (fileName.includes('summary') || fileName.includes('report')) {
      return 'summary';
    }
    
    return 'unknown';
  }
  
  /**
   * Parse CSV output files (most common OpenWAM output format)
   */
  private async parseCSVFile(filePath: string, results: SimulationResults): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        logger.warn(`CSV file ${filePath} has insufficient data`);
        return;
      }
      
      // Parse header to identify columns
      const headers = this.parseCSVLine(lines[0]);
      const dataLines = lines.slice(1);
      
      // Initialize data arrays
      const columnData: { [key: string]: number[] } = {};
      headers.forEach(header => {
        columnData[header] = [];
      });
      
      // Parse data rows
      for (const line of dataLines) {
        const values = this.parseCSVLine(line);
        if (values.length === headers.length) {
          headers.forEach((header, index) => {
            const value = parseFloat(values[index]);
            if (!isNaN(value)) {
              columnData[header].push(value);
            }
          });
        }
      }
      
      // Extract time series data
      this.extractTimeSeriesData(columnData, results);
      
    } catch (error: any) {
      logger.error(`Error parsing CSV file ${filePath}:`, error);
    }
  }
  
  /**
   * Parse binary output files (OpenWAM binary format)
   */
  private async parseBinaryFile(filePath: string, results: SimulationResults): Promise<void> {
    try {
      const buffer = await fs.readFile(filePath);
      
      // OpenWAM binary format parsing (simplified)
      // This would need to be implemented based on actual OpenWAM binary format
      logger.info(`Parsing binary file ${filePath} (format-specific implementation needed)`);
      
      // For now, skip binary parsing and log a warning
      logger.warn(`Binary file parsing not yet implemented for ${filePath}`);
      
    } catch (error: any) {
      logger.error(`Error parsing binary file ${filePath}:`, error);
    }
  }
  
  /**
   * Parse log files for metadata and error information
   */
  private async parseLogFile(filePath: string, results: SimulationResults): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // Extract metadata from log
      for (const line of lines) {
        // Engine speed
        const rpmMatch = line.match(/engine\s+speed[:\s]+(\d+(?:\.\d+)?)\s*rpm/i);
        if (rpmMatch) {
          results.metadata.engineSpeed = parseFloat(rpmMatch[1]);
        }
        
        // Number of cycles
        const cyclesMatch = line.match(/cycles[:\s]+(\d+)/i);
        if (cyclesMatch) {
          results.metadata.cycles = parseInt(cyclesMatch[1]);
        }
        
        // Time step
        const timeStepMatch = line.match(/time\s+step[:\s]+(\d+(?:\.\d+)?)/i);
        if (timeStepMatch) {
          results.metadata.timeStep = parseFloat(timeStepMatch[1]);
        }
      }
      
    } catch (error: any) {
      logger.error(`Error parsing log file ${filePath}:`, error);
    }
  }
  
  /**
   * Parse summary files for performance metrics
   */
  private async parseSummaryFile(filePath: string, results: SimulationResults): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // Extract performance metrics from summary
      for (const line of lines) {
        // Torque
        const torqueMatch = line.match(/torque[:\s]+(\d+(?:\.\d+)?)/i);
        if (torqueMatch) {
          results.statistics.maxTorque = parseFloat(torqueMatch[1]);
        }
        
        // Power
        const powerMatch = line.match(/power[:\s]+(\d+(?:\.\d+)?)/i);
        if (powerMatch) {
          results.statistics.maxPower = parseFloat(powerMatch[1]);
        }
        
        // Fuel consumption
        const fuelMatch = line.match(/fuel\s+consumption[:\s]+(\d+(?:\.\d+)?)/i);
        if (fuelMatch) {
          results.statistics.specificFuelConsumption = parseFloat(fuelMatch[1]);
        }
      }
      
    } catch (error: any) {
      logger.error(`Error parsing summary file ${filePath}:`, error);
    }
  }
  
  /**
   * Parse CSV line handling quoted values
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }
  
  /**
   * Extract time series data from parsed CSV columns
   */
  private extractTimeSeriesData(columnData: { [key: string]: number[] }, results: SimulationResults): void {
    const headers = Object.keys(columnData);
    
    // Find time column
    const timeColumn = headers.find(h => 
      h.toLowerCase().includes('time') || 
      h.toLowerCase().includes('angle') ||
      h.toLowerCase() === 't'
    );
    
    if (timeColumn && columnData[timeColumn]) {
      results.globalData.time = columnData[timeColumn];
    }
    
    // Process each data column
    headers.forEach(header => {
      const lowerHeader = header.toLowerCase();
      const data = columnData[header];
      
      if (!data || data.length === 0 || header === timeColumn) {
        return;
      }
      
      // Identify data type and component
      const componentMatch = header.match(/^([^_]+)_(.+)$/);
      let componentId = 'global';
      let dataType = lowerHeader;
      
      if (componentMatch) {
        componentId = componentMatch[1];
        dataType = componentMatch[2].toLowerCase();
      }
      
      // Create time series data
      const timeSeriesData: TimeSeriesData = {
        time: results.globalData.time,
        values: data,
        label: header,
        unit: this.inferUnit(dataType)
      };
      
      // Add to appropriate component or global data
      if (componentId === 'global') {
        this.addGlobalData(dataType, timeSeriesData, results);
      } else {
        this.addComponentData(componentId, dataType, timeSeriesData, results);
      }
    });
  }
  
  /**
   * Add data to global results
   */
  private addGlobalData(dataType: string, data: TimeSeriesData, results: SimulationResults): void {
    if (dataType.includes('torque')) {
      results.globalData.engineTorque = data;
    } else if (dataType.includes('power')) {
      results.globalData.enginePower = data;
    } else if (dataType.includes('fuel')) {
      results.globalData.fuelConsumption = data;
    } else if (dataType.includes('air') && dataType.includes('flow')) {
      results.globalData.airFlow = data;
    } else if (dataType.includes('exhaust') && dataType.includes('temp')) {
      results.globalData.exhaustTemperature = data;
    }
  }
  
  /**
   * Add data to component results
   */
  private addComponentData(componentId: string, dataType: string, data: TimeSeriesData, results: SimulationResults): void {
    let component = results.components.find(c => c.componentId === componentId);
    
    if (!component) {
      component = {
        componentId,
        componentType: this.inferComponentType(componentId)
      };
      results.components.push(component);
    }
    
    // Assign data based on type
    if (dataType.includes('pressure') || dataType.includes('press')) {
      component.pressure = data;
    } else if (dataType.includes('temperature') || dataType.includes('temp')) {
      component.temperature = data;
    } else if (dataType.includes('velocity') || dataType.includes('vel')) {
      component.velocity = data;
    } else if (dataType.includes('mass') && dataType.includes('flow')) {
      component.massFlow = data;
    } else if (dataType.includes('density') || dataType.includes('rho')) {
      component.density = data;
    }
  }
  
  /**
   * Infer unit from data type
   */
  private inferUnit(dataType: string): string {
    const lowerType = dataType.toLowerCase();
    
    if (lowerType.includes('pressure')) return 'Pa';
    if (lowerType.includes('temperature')) return 'K';
    if (lowerType.includes('velocity')) return 'm/s';
    if (lowerType.includes('mass') && lowerType.includes('flow')) return 'kg/s';
    if (lowerType.includes('density')) return 'kg/m³';
    if (lowerType.includes('torque')) return 'Nm';
    if (lowerType.includes('power')) return 'W';
    if (lowerType.includes('time')) return 's';
    if (lowerType.includes('angle')) return 'deg';
    if (lowerType.includes('fuel')) return 'kg/h';
    
    return '';
  }
  
  /**
   * Infer component type from component ID
   */
  private inferComponentType(componentId: string): string {
    const lowerComponentId = componentId.toLowerCase();
    
    if (lowerComponentId.includes('pipe') || lowerComponentId.includes('tubo')) return 'pipe';
    if (lowerComponentId.includes('cylinder') || lowerComponentId.includes('cil')) return 'cylinder';
    if (lowerComponentId.includes('plenum') || lowerComponentId.includes('dep')) return 'plenum';
    if (lowerComponentId.includes('valve') || lowerComponentId.includes('val')) return 'valve';
    if (lowerComponentId.includes('compressor') || lowerComponentId.includes('comp')) return 'compressor';
    if (lowerComponentId.includes('turbine') || lowerComponentId.includes('turb')) return 'turbine';
    
    return 'unknown';
  }
  
  /**
   * Calculate performance metrics from simulation data
   */
  private calculatePerformanceMetrics(results: SimulationResults): PerformanceMetrics {
    const metrics: PerformanceMetrics = {};
    
    try {
      // Engine performance metrics
      if (results.globalData.engineTorque?.values) {
        metrics.maxTorque = Math.max(...results.globalData.engineTorque.values);
      }
      
      if (results.globalData.enginePower?.values) {
        metrics.maxPower = Math.max(...results.globalData.enginePower.values);
      }
      
      // Flow characteristics from all components
      const allPressures: number[] = [];
      const allVelocities: number[] = [];
      const allTemperatures: number[] = [];
      
      results.components.forEach(component => {
        if (component.pressure?.values) {
          allPressures.push(...component.pressure.values);
        }
        if (component.velocity?.values) {
          allVelocities.push(...component.velocity.values);
        }
        if (component.temperature?.values) {
          allTemperatures.push(...component.temperature.values);
        }
      });
      
      // Pressure statistics
      if (allPressures.length > 0) {
        metrics.maxPressure = Math.max(...allPressures);
        metrics.minPressure = Math.min(...allPressures);
        metrics.pressureAmplitude = metrics.maxPressure - metrics.minPressure;
      }
      
      // Velocity statistics
      if (allVelocities.length > 0) {
        metrics.maxVelocity = Math.max(...allVelocities);
        metrics.meanVelocity = allVelocities.reduce((a, b) => a + b, 0) / allVelocities.length;
      }
      
      // Temperature statistics
      if (allTemperatures.length > 0) {
        metrics.maxTemperature = Math.max(...allTemperatures);
        metrics.minTemperature = Math.min(...allTemperatures);
        metrics.meanTemperature = allTemperatures.reduce((a, b) => a + b, 0) / allTemperatures.length;
      }
      
      // Fuel consumption metrics
      if (results.globalData.fuelConsumption?.values) {
        const fuelValues = results.globalData.fuelConsumption.values;
        metrics.fuelFlowRate = fuelValues.reduce((a, b) => a + b, 0) / fuelValues.length;
        
        // Calculate specific fuel consumption (simplified)
        if (metrics.maxPower && metrics.maxPower > 0) {
          metrics.specificFuelConsumption = (metrics.fuelFlowRate * 1000) / (metrics.maxPower / 1000); // g/kWh
        }
      }
      
    } catch (error: any) {
      logger.error('Error calculating performance metrics:', error);
    }
    
    return metrics;
  }
  
  /**
   * Prepare chart data for visualization
   */
  prepareChartData(
    results: SimulationResults,
    dataType: 'pressure' | 'temperature' | 'velocity' | 'massFlow' | 'torque' | 'power',
    componentIds?: string[]
  ): ChartData {
    const datasets: ChartData['datasets'] = [];
    
    // Color palette for different components
    const colors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
      '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
    ];
    
    let colorIndex = 0;
    
    // Global data
    if (dataType === 'torque' && results.globalData.engineTorque) {
      datasets.push({
        label: 'Engine Torque',
        data: results.globalData.engineTorque.values.map((value, index) => ({
          x: results.globalData.time[index] || index,
          y: value
        })),
        borderColor: colors[colorIndex % colors.length],
        backgroundColor: colors[colorIndex % colors.length] + '20',
        unit: results.globalData.engineTorque.unit
      });
      colorIndex++;
    }
    
    if (dataType === 'power' && results.globalData.enginePower) {
      datasets.push({
        label: 'Engine Power',
        data: results.globalData.enginePower.values.map((value, index) => ({
          x: results.globalData.time[index] || index,
          y: value
        })),
        borderColor: colors[colorIndex % colors.length],
        backgroundColor: colors[colorIndex % colors.length] + '20',
        unit: results.globalData.enginePower.unit
      });
      colorIndex++;
    }
    
    // Component data
    const componentsToShow = componentIds 
      ? results.components.filter(c => componentIds.includes(c.componentId))
      : results.components;
    
    componentsToShow.forEach(component => {
      let data: TimeSeriesData | undefined;
      let label: string;
      
      switch (dataType) {
        case 'pressure':
          data = component.pressure;
          label = `${component.componentId} Pressure`;
          break;
        case 'temperature':
          data = component.temperature;
          label = `${component.componentId} Temperature`;
          break;
        case 'velocity':
          data = component.velocity;
          label = `${component.componentId} Velocity`;
          break;
        case 'massFlow':
          data = component.massFlow;
          label = `${component.componentId} Mass Flow`;
          break;
        default:
          return;
      }
      
      if (data && data.values.length > 0) {
        datasets.push({
          label,
          data: data.values.map((value, index) => ({
            x: data.time[index] || index,
            y: value
          })),
          borderColor: colors[colorIndex % colors.length],
          backgroundColor: colors[colorIndex % colors.length] + '20',
          componentId: component.componentId,
          unit: data.unit
        });
        colorIndex++;
      }
    });
    
    // Determine axis labels and units
    const xAxis = {
      label: 'Time',
      unit: 's'
    };
    
    const yAxisConfig = this.getYAxisConfig(dataType);
    
    return {
      datasets,
      xAxis,
      yAxis: yAxisConfig
    };
  }
  
  /**
   * Get Y-axis configuration for different data types
   */
  private getYAxisConfig(dataType: string): ChartData['yAxis'] {
    switch (dataType) {
      case 'pressure':
        return { label: 'Pressure', unit: 'Pa' };
      case 'temperature':
        return { label: 'Temperature', unit: 'K' };
      case 'velocity':
        return { label: 'Velocity', unit: 'm/s' };
      case 'massFlow':
        return { label: 'Mass Flow', unit: 'kg/s' };
      case 'torque':
        return { label: 'Torque', unit: 'Nm' };
      case 'power':
        return { label: 'Power', unit: 'W' };
      default:
        return { label: 'Value', unit: '' };
    }
  }
  
  /**
   * Parse simulation results from content string
   */
  parseResultsFromContent(content: string): SimulationResults {
    const results: SimulationResults = {
      metadata: {
        simulationId: 0,
        projectId: 0,
        startTime: new Date()
      },
      components: [],
      globalData: {
        time: []
      },
      statistics: {}
    };

    try {
      // Try to parse as CSV first
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length >= 2) {
        const headers = this.parseCSVLine(lines[0]);
        const dataLines = lines.slice(1);
        
        const columnData: { [key: string]: number[] } = {};
        headers.forEach(header => {
          columnData[header] = [];
        });
        
        for (const line of dataLines) {
          const values = this.parseCSVLine(line);
          if (values.length === headers.length) {
            headers.forEach((header, index) => {
              const value = parseFloat(values[index]);
              if (!isNaN(value)) {
                columnData[header].push(value);
              }
            });
          }
        }
        
        this.extractTimeSeriesData(columnData, results);
      }
      
      results.statistics = this.calculatePerformanceMetrics(results);
      results.metadata.endTime = new Date();
      
    } catch (error: any) {
      logger.error('Error parsing simulation results:', error);
    }

    return results;
  }

  /**
   * Parse CSV results from content string
   */
  parseCSVResults(content: string): any {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('Invalid CSV format');
    }

    const headers = this.parseCSVLine(lines[0]);
    const data: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const row: any = {};
        headers.forEach((header, index) => {
          const value = parseFloat(values[index]);
          row[header] = isNaN(value) ? values[index] : value;
        });
        data.push(row);
      }
    }

    return {
      headers,
      data,
      rowCount: data.length
    };
  }

  /**
   * Export simulation results to CSV format
   */
  exportToCSV(results: SimulationResults): string {
    const lines: string[] = [];
    
    // Create header
    const headers = ['Time'];
    
    // Add global data headers
    if (results.globalData.engineTorque) headers.push('Engine_Torque');
    if (results.globalData.enginePower) headers.push('Engine_Power');
    if (results.globalData.fuelConsumption) headers.push('Fuel_Consumption');
    if (results.globalData.airFlow) headers.push('Air_Flow');
    if (results.globalData.exhaustTemperature) headers.push('Exhaust_Temperature');
    
    // Add component data headers
    results.components.forEach(component => {
      if (component.pressure) headers.push(`${component.componentId}_Pressure`);
      if (component.temperature) headers.push(`${component.componentId}_Temperature`);
      if (component.velocity) headers.push(`${component.componentId}_Velocity`);
      if (component.massFlow) headers.push(`${component.componentId}_MassFlow`);
      if (component.density) headers.push(`${component.componentId}_Density`);
    });
    
    lines.push(headers.join(','));
    
    // Add data rows
    const timeLength = results.globalData.time.length;
    for (let i = 0; i < timeLength; i++) {
      const row: string[] = [];
      
      // Time
      row.push(results.globalData.time[i]?.toString() || '');
      
      // Global data
      if (results.globalData.engineTorque) {
        row.push(results.globalData.engineTorque.values[i]?.toString() || '');
      }
      if (results.globalData.enginePower) {
        row.push(results.globalData.enginePower.values[i]?.toString() || '');
      }
      if (results.globalData.fuelConsumption) {
        row.push(results.globalData.fuelConsumption.values[i]?.toString() || '');
      }
      if (results.globalData.airFlow) {
        row.push(results.globalData.airFlow.values[i]?.toString() || '');
      }
      if (results.globalData.exhaustTemperature) {
        row.push(results.globalData.exhaustTemperature.values[i]?.toString() || '');
      }
      
      // Component data
      results.components.forEach(component => {
        if (component.pressure) {
          row.push(component.pressure.values[i]?.toString() || '');
        }
        if (component.temperature) {
          row.push(component.temperature.values[i]?.toString() || '');
        }
        if (component.velocity) {
          row.push(component.velocity.values[i]?.toString() || '');
        }
        if (component.massFlow) {
          row.push(component.massFlow.values[i]?.toString() || '');
        }
        if (component.density) {
          row.push(component.density.values[i]?.toString() || '');
        }
      });
      
      lines.push(row.join(','));
    }
    
    return lines.join('\n');
  }

  /**
   * Compare multiple simulation results
   */
  compareSimulations(results: SimulationResults[]): {
    comparison: { [metric: string]: { [simulationId: number]: number } };
    recommendations: string[];
  } {
    const comparison: { [metric: string]: { [simulationId: number]: number } } = {};
    const recommendations: string[] = [];
    
    // Compare key metrics
    const metrics = ['maxTorque', 'maxPower', 'maxPressure', 'maxTemperature', 'fuelFlowRate'];
    
    metrics.forEach(metric => {
      comparison[metric] = {};
      results.forEach(result => {
        const value = (result.statistics as any)[metric];
        if (value !== undefined) {
          comparison[metric][result.metadata.simulationId] = value;
        }
      });
    });
    
    // Generate recommendations based on comparison
    if (comparison.maxTorque && Object.keys(comparison.maxTorque).length > 1) {
      const torqueValues = Object.values(comparison.maxTorque);
      const maxTorque = Math.max(...torqueValues);
      const bestSimId = Object.keys(comparison.maxTorque).find(
        id => comparison.maxTorque[parseInt(id)] === maxTorque
      );
      
      if (bestSimId) {
        recommendations.push(`Simulation ${bestSimId} achieved the highest torque (${maxTorque.toFixed(2)} Nm)`);
      }
    }
    
    return { comparison, recommendations };
  }
}

// Export singleton instance
export const resultAnalysisService = new ResultAnalysisService();
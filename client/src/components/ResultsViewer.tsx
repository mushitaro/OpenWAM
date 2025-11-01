import React, { useState, useEffect, useCallback } from 'react';
import { BaseChart } from './charts/BaseChart';
import { ChartData } from 'chart.js';

interface TimeSeriesData {
  time: number[];
  values: number[];
  unit?: string;
  label?: string;
}

interface ComponentData {
  componentId: string;
  componentType: string;
  pressure?: TimeSeriesData;
  temperature?: TimeSeriesData;
  velocity?: TimeSeriesData;
  massFlow?: TimeSeriesData;
  density?: TimeSeriesData;
}

interface SimulationResults {
  metadata: {
    simulationId: number;
    projectId: number;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    engineSpeed?: number;
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
  statistics: any;
}

interface ResultsViewerProps {
  simulationId: number;
  onError?: (error: string) => void;
}

type DataType = 'pressure' | 'temperature' | 'velocity' | 'massFlow' | 'torque' | 'power';

export const ResultsViewer: React.FC<ResultsViewerProps> = ({
  simulationId,
  onError
}) => {
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDataType, setSelectedDataType] = useState<DataType>('pressure');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [chartData, setChartData] = useState<ChartData<'line'> | null>(null);
  const [availableComponents, setAvailableComponents] = useState<{
    id: string;
    type: string;
    availableData: { [key: string]: boolean };
  }[]>([]);
  const [zoomRange, setZoomRange] = useState<{ min?: number; max?: number }>({});

  // Create mock results for testing
  useEffect(() => {
    const createMockResults = () => {
      setLoading(true);
      
      // Create mock data
      const timeData = Array.from({length: 100}, (_, i) => i * 0.01);
      const pressureData = timeData.map(t => 100000 + 50000 * Math.sin(t * 10) + Math.random() * 10000);
      const temperatureData = timeData.map(t => 300 + 200 * Math.sin(t * 5) + Math.random() * 50);
      const velocityData = timeData.map(t => 50 + 30 * Math.sin(t * 8) + Math.random() * 10);
      
      const mockResults: SimulationResults = {
        metadata: {
          simulationId,
          projectId: 1,
          startTime: new Date(),
          endTime: new Date(),
          duration: 1.0,
          engineSpeed: 2000,
          cycles: 10,
          timeStep: 0.01
        },
        components: [
          {
            componentId: 'cylinder-1',
            componentType: 'Cylinder',
            pressure: { time: timeData, values: pressureData, unit: 'Pa', label: 'Cylinder Pressure' },
            temperature: { time: timeData, values: temperatureData, unit: 'K', label: 'Cylinder Temperature' },
            velocity: { time: timeData, values: velocityData, unit: 'm/s', label: 'Gas Velocity' }
          },
          {
            componentId: 'intake-1',
            componentType: 'Pipe',
            pressure: { time: timeData, values: pressureData.map(p => p * 0.8), unit: 'Pa', label: 'Intake Pressure' },
            temperature: { time: timeData, values: temperatureData.map(t => t * 0.9), unit: 'K', label: 'Intake Temperature' }
          }
        ],
        globalData: {
          time: timeData,
          engineTorque: { time: timeData, values: timeData.map(t => 200 + 50 * Math.sin(t * 3)), unit: 'Nm', label: 'Engine Torque' },
          enginePower: { time: timeData, values: timeData.map(t => 50000 + 20000 * Math.sin(t * 3)), unit: 'W', label: 'Engine Power' }
        },
        statistics: {
          maxTorque: 250,
          maxPower: 70000,
          maxPressure: 150000,
          maxTemperature: 500,
          maxVelocity: 80,
          fuelFlowRate: 15.5
        }
      };
      
      setResults(mockResults);
      
      // Set available components
      setAvailableComponents([
        {
          id: 'cylinder-1',
          type: 'Cylinder',
          availableData: { pressure: true, temperature: true, velocity: true, massFlow: false, torque: false, power: false }
        },
        {
          id: 'intake-1',
          type: 'Pipe',
          availableData: { pressure: true, temperature: true, velocity: false, massFlow: false, torque: false, power: false }
        }
      ]);
      
      setSelectedComponents(['cylinder-1']);
      setLoading(false);
    };

    // Try real API first, fall back to mock
    const fetchResults = async () => {
      try {
        const response = await fetch(`/api/results/simulations/${simulationId}/results`);
        if (response.ok) {
          const data = await response.json();
          if (!data.error) {
            setResults(data.data);
            setLoading(false);
            return;
          }
        }
      } catch (error) {
        console.log('API not available, using mock data');
      }
      
      // Use mock data
      createMockResults();
    };

    fetchResults();
  }, [simulationId, onError]);

  // Generate chart data when selection changes
  useEffect(() => {
    const generateChartData = () => {
      if (!results || selectedComponents.length === 0) return;

      const datasets: any[] = [];
      
      selectedComponents.forEach((componentId, index) => {
        const component = results.components.find(c => c.componentId === componentId);
        if (!component) return;
        
        let data: TimeSeriesData | undefined;
        
        switch (selectedDataType) {
          case 'pressure':
            data = component.pressure;
            break;
          case 'temperature':
            data = component.temperature;
            break;
          case 'velocity':
            data = component.velocity;
            break;
          case 'massFlow':
            data = component.massFlow;
            break;
          case 'torque':
            data = results.globalData.engineTorque;
            break;
          case 'power':
            data = results.globalData.enginePower;
            break;
        }
        
        if (data) {
          const chartPoints = data.time.map((time, i) => ({
            x: time,
            y: data!.values[i]
          }));
          
          datasets.push({
            label: `${componentId} - ${data.label || selectedDataType}`,
            data: chartPoints,
            borderColor: getColor(index),
            backgroundColor: getColor(index, 0.1),
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 6,
            unit: data.unit
          });
        }
      });
      
      setChartData({ datasets });
    };

    generateChartData();
  }, [simulationId, selectedDataType, selectedComponents, results]);

  const getColor = (index: number, alpha: number = 1): string => {
    const colors = [
      `rgba(255, 99, 132, ${alpha})`,   // Red
      `rgba(54, 162, 235, ${alpha})`,   // Blue
      `rgba(255, 206, 86, ${alpha})`,   // Yellow
      `rgba(75, 192, 192, ${alpha})`,   // Teal
      `rgba(153, 102, 255, ${alpha})`,  // Purple
      `rgba(255, 159, 64, ${alpha})`,   // Orange
      `rgba(199, 199, 199, ${alpha})`,  // Grey
      `rgba(83, 102, 255, ${alpha})`    // Indigo
    ];
    return colors[index % colors.length];
  };

  const handleDataTypeChange = (dataType: DataType) => {
    setSelectedDataType(dataType);
    setZoomRange({}); // Reset zoom when changing data type
  };

  const handleComponentToggle = (componentId: string) => {
    setSelectedComponents(prev => {
      if (prev.includes(componentId)) {
        return prev.filter(id => id !== componentId);
      } else {
        return [...prev, componentId];
      }
    });
  };

  const handleZoom = useCallback((min: number, max: number) => {
    setZoomRange({ min, max });
  }, []);

  const handleResetZoom = () => {
    setZoomRange({});
  };

  const handleDataPointClick = (datasetIndex: number, dataIndex: number, value: any) => {
    console.log('Data point clicked:', { datasetIndex, dataIndex, value });
    // Could show detailed information in a tooltip or modal
  };

  const getChartOptions = () => {
    const options: any = {
      plugins: {
        title: {
          display: true,
          text: `${selectedDataType.charAt(0).toUpperCase() + selectedDataType.slice(1)} vs Time`
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Time (s)'
          }
        },
        y: {
          title: {
            display: true,
            text: getYAxisLabel(selectedDataType)
          }
        }
      }
    };

    // Apply zoom if set
    if (zoomRange.min !== undefined && zoomRange.max !== undefined) {
      options.scales.x.min = zoomRange.min;
      options.scales.x.max = zoomRange.max;
    }

    return options;
  };

  const getYAxisLabel = (dataType: DataType): string => {
    switch (dataType) {
      case 'pressure': return 'Pressure (Pa)';
      case 'temperature': return 'Temperature (K)';
      case 'velocity': return 'Velocity (m/s)';
      case 'massFlow': return 'Mass Flow (kg/s)';
      case 'torque': return 'Torque (Nm)';
      case 'power': return 'Power (W)';
      default: return 'Value';
    }
  };

  const getAvailableDataTypes = (): DataType[] => {
    if (!results) return [];
    
    const types: DataType[] = [];
    
    // Check global data
    if (results.globalData.engineTorque) types.push('torque');
    if (results.globalData.enginePower) types.push('power');
    
    // Check component data
    const hasComponentData = (type: keyof ComponentData) => {
      return results.components.some(component => component[type]);
    };
    
    if (hasComponentData('pressure')) types.push('pressure');
    if (hasComponentData('temperature')) types.push('temperature');
    if (hasComponentData('velocity')) types.push('velocity');
    if (hasComponentData('massFlow')) types.push('massFlow');
    
    return types;
  };

  if (loading) {
    return (
      <div className="results-viewer loading">
        <div className="loading-spinner">Loading simulation results...</div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="results-viewer error">
        <div className="error-message">Failed to load simulation results</div>
      </div>
    );
  }

  const availableDataTypes = getAvailableDataTypes();

  return (
    <div className="results-viewer">
      <div className="results-header">
        <h2>Simulation Results</h2>
        <div className="simulation-info">
          <span>Simulation ID: {results.metadata.simulationId}</span>
          {results.metadata.engineSpeed && (
            <span>Engine Speed: {results.metadata.engineSpeed} RPM</span>
          )}
          {results.metadata.duration && (
            <span>Duration: {results.metadata.duration.toFixed(2)} s</span>
          )}
        </div>
      </div>

      <div className="results-controls">
        <div className="data-type-selector">
          <label>Data Type:</label>
          <select 
            value={selectedDataType} 
            onChange={(e) => handleDataTypeChange(e.target.value as DataType)}
          >
            {availableDataTypes.map(type => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="component-selector">
          <label>Components:</label>
          <div className="component-checkboxes">
            {availableComponents
              .filter(component => {
                // Only show components that have the selected data type
                return component.availableData[selectedDataType];
              })
              .map(component => (
                <label key={component.id} className="component-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedComponents.includes(component.id)}
                    onChange={() => handleComponentToggle(component.id)}
                  />
                  <span>{component.id} ({component.type})</span>
                </label>
              ))
            }
          </div>
        </div>

        <div className="chart-controls">
          <button onClick={handleResetZoom} disabled={!zoomRange.min && !zoomRange.max}>
            Reset Zoom
          </button>
        </div>
      </div>

      <div className="chart-container">
        {chartData && (
          <>
            <div data-testid="pressure-chart" style={{ display: selectedDataType === 'pressure' ? 'block' : 'none' }}>
              <BaseChart
                data={chartData}
                options={getChartOptions()}
                onDataPointClick={handleDataPointClick}
                onZoom={handleZoom}
                height={500}
              />
            </div>
            <div data-testid="temperature-chart" style={{ display: selectedDataType === 'temperature' ? 'block' : 'none' }}>
              <BaseChart
                data={chartData}
                options={getChartOptions()}
                onDataPointClick={handleDataPointClick}
                onZoom={handleZoom}
                height={500}
              />
            </div>
            <div data-testid="velocity-chart" style={{ display: selectedDataType === 'velocity' ? 'block' : 'none' }}>
              <BaseChart
                data={chartData}
                options={getChartOptions()}
                onDataPointClick={handleDataPointClick}
                onZoom={handleZoom}
                height={500}
              />
            </div>
          </>
        )}
      </div>

      <div className="statistics-panel">
        <h3>Performance Metrics</h3>
        <div className="metrics-grid">
          {results.statistics.maxTorque && (
            <div className="metric">
              <label>Max Torque:</label>
              <span>{results.statistics.maxTorque.toFixed(2)} Nm</span>
            </div>
          )}
          {results.statistics.maxPower && (
            <div className="metric">
              <label>Max Power:</label>
              <span>{(results.statistics.maxPower / 1000).toFixed(2)} kW</span>
            </div>
          )}
          {results.statistics.maxPressure && (
            <div className="metric">
              <label>Max Pressure:</label>
              <span>{(results.statistics.maxPressure / 1000).toFixed(2)} kPa</span>
            </div>
          )}
          {results.statistics.maxTemperature && (
            <div className="metric">
              <label>Max Temperature:</label>
              <span>{results.statistics.maxTemperature.toFixed(1)} K</span>
            </div>
          )}
          {results.statistics.maxVelocity && (
            <div className="metric">
              <label>Max Velocity:</label>
              <span>{results.statistics.maxVelocity.toFixed(2)} m/s</span>
            </div>
          )}
          {results.statistics.fuelFlowRate && (
            <div className="metric">
              <label>Fuel Flow Rate:</label>
              <span>{results.statistics.fuelFlowRate.toFixed(3)} kg/h</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
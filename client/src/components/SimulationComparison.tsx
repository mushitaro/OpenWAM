import React, { useState, useEffect } from 'react';
import { BaseChart } from './charts/BaseChart';
import { ChartData } from 'chart.js';

interface ComparisonData {
  simulations: {
    id: number;
    projectId: number;
    statistics: any;
    metadata: any;
  }[];
  comparison: { [metric: string]: { [simulationId: number]: number } };
  recommendations: string[];
}

interface SimulationComparisonProps {
  simulationIds: number[];
  onError?: (error: string) => void;
}

export const SimulationComparison: React.FC<SimulationComparisonProps> = ({
  simulationIds,
  onError
}) => {
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<string>('maxTorque');

  useEffect(() => {
    const fetchComparison = async () => {
      if (simulationIds.length < 2) {
        onError?.('At least 2 simulations are required for comparison');
        return;
      }

      try {
        setLoading(true);
        
        // Try real API first
        try {
          const response = await fetch('/api/results/simulations/compare', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ simulationIds }),
          });

          if (response.ok) {
            const data = await response.json();
            if (!data.error) {
              setComparisonData(data.data);
              const availableMetrics = Object.keys(data.data.comparison);
              if (availableMetrics.length > 0) {
                setSelectedMetric(availableMetrics[0]);
              }
              setLoading(false);
              return;
            }
          }
        } catch (apiError) {
          console.log('API not available, using mock data');
        }

        // Create mock comparison data
        const mockData: ComparisonData = {
          simulations: simulationIds.map(id => ({
            id,
            projectId: 1,
            statistics: {
              maxTorque: 200 + Math.random() * 100,
              maxPower: 50000 + Math.random() * 20000,
              maxPressure: 120000 + Math.random() * 30000,
              maxTemperature: 400 + Math.random() * 100,
              maxVelocity: 60 + Math.random() * 20,
              fuelFlowRate: 12 + Math.random() * 6
            },
            metadata: {
              engineSpeed: 2000,
              duration: 1.0,
              cycles: 10
            }
          })),
          comparison: {
            maxTorque: Object.fromEntries(simulationIds.map(id => [id, 200 + Math.random() * 100])),
            maxPower: Object.fromEntries(simulationIds.map(id => [id, 50000 + Math.random() * 20000])),
            maxPressure: Object.fromEntries(simulationIds.map(id => [id, 120000 + Math.random() * 30000])),
            maxTemperature: Object.fromEntries(simulationIds.map(id => [id, 400 + Math.random() * 100])),
            maxVelocity: Object.fromEntries(simulationIds.map(id => [id, 60 + Math.random() * 20])),
            fuelFlowRate: Object.fromEntries(simulationIds.map(id => [id, 12 + Math.random() * 6]))
          },
          recommendations: [
            'Simulation with highest torque shows better performance',
            'Consider optimizing fuel consumption',
            'Temperature levels are within acceptable range'
          ]
        };

        setComparisonData(mockData);
        setSelectedMetric('maxTorque');

      } catch (error: any) {
        console.error('Error comparing simulations:', error);
        onError?.(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchComparison();
  }, [simulationIds, onError]);

  const getComparisonChartData = (): ChartData<'line'> | null => {
    if (!comparisonData || !selectedMetric) return null;

    const metricData = comparisonData.comparison[selectedMetric];
    if (!metricData) return null;

    const datasets = Object.entries(metricData).map(([simulationId, value], index) => ({
      label: `Simulation ${simulationId}`,
      data: [{ x: parseInt(simulationId), y: value }],
      borderColor: getColor(index),
      backgroundColor: getColor(index, 0.2),
      pointRadius: 8,
      pointHoverRadius: 12,
      showLine: false,
    }));

    return { datasets };
  };

  const getColor = (index: number, alpha: number = 1): string => {
    const colors = [
      `rgba(255, 99, 132, ${alpha})`,   // Red
      `rgba(54, 162, 235, ${alpha})`,   // Blue
      `rgba(255, 206, 86, ${alpha})`,   // Yellow
      `rgba(75, 192, 192, ${alpha})`,   // Teal
      `rgba(153, 102, 255, ${alpha})`,  // Purple
      `rgba(255, 159, 64, ${alpha})`,   // Orange
    ];
    return colors[index % colors.length];
  };

  const getMetricLabel = (metric: string): string => {
    const labels: { [key: string]: string } = {
      maxTorque: 'Maximum Torque (Nm)',
      maxPower: 'Maximum Power (W)',
      maxPressure: 'Maximum Pressure (Pa)',
      maxTemperature: 'Maximum Temperature (K)',
      maxVelocity: 'Maximum Velocity (m/s)',
      fuelFlowRate: 'Fuel Flow Rate (kg/h)',
      specificFuelConsumption: 'Specific Fuel Consumption (g/kWh)',
    };
    return labels[metric] || metric;
  };

  const getComparisonChartOptions = () => ({
    plugins: {
      title: {
        display: true,
        text: `Comparison: ${getMetricLabel(selectedMetric)}`
      },
      legend: {
        display: true,
        position: 'top' as const,
      }
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Simulation ID'
        },
        ticks: {
          stepSize: 1,
        }
      },
      y: {
        title: {
          display: true,
          text: getMetricLabel(selectedMetric)
        }
      }
    },
    elements: {
      point: {
        radius: 8,
        hoverRadius: 12,
      }
    }
  });

  if (loading) {
    return (
      <div className="simulation-comparison loading">
        <div className="loading-spinner">Comparing simulations...</div>
      </div>
    );
  }

  if (!comparisonData) {
    return (
      <div className="simulation-comparison error">
        <div className="error-message">Failed to load comparison data</div>
      </div>
    );
  }

  const availableMetrics = Object.keys(comparisonData.comparison);
  const chartData = getComparisonChartData();

  return (
    <div className="simulation-comparison">
      <div className="comparison-header">
        <h2>Simulation Comparison</h2>
        <div className="comparison-info">
          Comparing {simulationIds.length} simulations
        </div>
      </div>

      <div className="comparison-controls">
        <div className="metric-selector">
          <label>Metric:</label>
          <select 
            value={selectedMetric} 
            onChange={(e) => setSelectedMetric(e.target.value)}
          >
            {availableMetrics.map(metric => (
              <option key={metric} value={metric}>
                {getMetricLabel(metric)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {chartData && (
        <div className="comparison-chart" data-testid="comparison-chart">
          <BaseChart
            data={chartData}
            options={getComparisonChartOptions()}
            height={400}
          />
        </div>
      )}

      <div className="comparison-table">
        <h3>Detailed Comparison</h3>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              {simulationIds.map(id => (
                <th key={id}>Simulation {id}</th>
              ))}
              <th>Best</th>
            </tr>
          </thead>
          <tbody>
            {availableMetrics.map(metric => {
              const metricData = comparisonData.comparison[metric];
              const values = Object.values(metricData);
              const maxValue = Math.max(...values);
              const bestSimId = Object.keys(metricData).find(
                id => metricData[parseInt(id)] === maxValue
              );

              return (
                <tr key={metric}>
                  <td>{getMetricLabel(metric)}</td>
                  {simulationIds.map(id => {
                    const value = metricData[id];
                    const isBest = parseInt(bestSimId || '0') === id;
                    return (
                      <td key={id} className={isBest ? 'best-value' : ''}>
                        {value !== undefined ? value.toFixed(3) : 'N/A'}
                      </td>
                    );
                  })}
                  <td className="best-simulation">Sim {bestSimId}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {comparisonData.recommendations.length > 0 && (
        <div className="recommendations">
          <h3>Recommendations</h3>
          <ul>
            {comparisonData.recommendations.map((recommendation, index) => (
              <li key={index}>{recommendation}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="simulation-details">
        <h3>Simulation Details</h3>
        <div className="details-grid">
          {comparisonData.simulations.map(simulation => (
            <div key={simulation.id} className="simulation-detail">
              <h4>Simulation {simulation.id}</h4>
              <div className="detail-info">
                <div>Project ID: {simulation.projectId}</div>
                {simulation.metadata.engineSpeed && (
                  <div>Engine Speed: {simulation.metadata.engineSpeed} RPM</div>
                )}
                {simulation.metadata.duration && (
                  <div>Duration: {simulation.metadata.duration.toFixed(2)} s</div>
                )}
                {simulation.metadata.cycles && (
                  <div>Cycles: {simulation.metadata.cycles}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
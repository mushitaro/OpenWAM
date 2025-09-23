import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import './components.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const SimulationChart = ({ data }) => {
  // If there's no data, display a placeholder message
  if (!data || !data.output || !data.output.crank_angle || !data.output.pressure) {
    return (
      <div className="chart-placeholder">
        <p>Run a simulation to see the results.</p>
      </div>
    );
  }

  // Prepare the data for the chart from the simulation results
  const chartData = {
    labels: data.output.crank_angle,
    datasets: [
      {
        label: 'Cylinder Pressure (bar)',
        data: data.output.pressure,
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        pointRadius: 1, // Make points smaller for a cleaner look
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 1000, // Add a subtle animation
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'In-Cylinder Pressure vs. Crank Angle',
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Crank Angle (°)',
        },
      },
      y: {
        title: {
          display: true,
          text: 'Pressure (bar)',
        },
      },
    },
  };

  return (
    <div className="simulation-chart">
      <Line options={options} data={chartData} />
    </div>
  );
};

export default SimulationChart;

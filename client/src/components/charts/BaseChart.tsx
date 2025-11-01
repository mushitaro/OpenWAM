import React, { useRef, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  ChartOptions,
  ChartData,
  InteractionItem,
  ChartEvent
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

export interface BaseChartProps {
  data: ChartData<'line'>;
  options?: Partial<ChartOptions<'line'>>;
  onDataPointClick?: (datasetIndex: number, dataIndex: number, value: any) => void;
  onZoom?: (min: number, max: number) => void;
  height?: number;
  className?: string;
}

export const BaseChart: React.FC<BaseChartProps> = ({
  data,
  options = {},
  onDataPointClick,
  onZoom,
  height = 400,
  className = ''
}) => {
  const chartRef = useRef<ChartJS<'line'>>(null);

  const defaultOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          padding: 20,
        }
      },
      title: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        callbacks: {
          label: function(context) {
            const dataset = context.dataset;
            const value = context.parsed.y;
            const unit = (dataset as any).unit || '';
            return `${dataset.label}: ${value.toFixed(3)} ${unit}`;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        display: true,
        title: {
          display: true,
          text: 'Time (s)'
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        }
      },
      y: {
        type: 'linear',
        display: true,
        title: {
          display: true,
          text: 'Value'
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        }
      }
    },
    elements: {
      line: {
        tension: 0.1,
        borderWidth: 2,
      },
      point: {
        radius: 0,
        hoverRadius: 6,
        hitRadius: 10,
      }
    },
    onClick: (event: ChartEvent, elements: InteractionItem[]) => {
      if (elements.length > 0 && onDataPointClick) {
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        const dataIndex = element.index;
        const value = data.datasets[datasetIndex].data[dataIndex];
        onDataPointClick(datasetIndex, dataIndex, value);
      }
    }
  };

  // Merge default options with provided options
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    plugins: {
      ...defaultOptions.plugins,
      ...options.plugins,
    },
    scales: {
      ...defaultOptions.scales,
      ...options.scales,
    }
  };

  // Add zoom functionality
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onZoom) return;

    let isZooming = false;
    let startX = 0;
    let endX = 0;

    const handleMouseDown = (event: MouseEvent) => {
      const rect = chart.canvas.getBoundingClientRect();
      startX = event.clientX - rect.left;
      isZooming = true;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isZooming) return;
      const rect = chart.canvas.getBoundingClientRect();
      endX = event.clientX - rect.left;
      // Could add visual feedback here
    };

    const handleMouseUp = () => {
      if (!isZooming) return;
      isZooming = false;

      if (Math.abs(endX - startX) > 10) { // Minimum drag distance
        const canvasPosition = ChartJS.helpers.getRelativePosition({ x: startX, y: 0 }, chart);
        const canvasPosition2 = ChartJS.helpers.getRelativePosition({ x: endX, y: 0 }, chart);
        
        const dataX = chart.scales.x.getValueForPixel(canvasPosition.x);
        const dataX2 = chart.scales.x.getValueForPixel(canvasPosition2.x);
        
        if (dataX !== null && dataX2 !== null) {
          const min = Math.min(dataX, dataX2);
          const max = Math.max(dataX, dataX2);
          onZoom(min, max);
        }
      }
    };

    const canvas = chart.canvas;
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onZoom]);

  return (
    <div className={`chart-container ${className}`} style={{ height: `${height}px` }}>
      <Line
        ref={chartRef}
        data={data}
        options={mergedOptions}
      />
    </div>
  );
};
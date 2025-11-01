import { render, screen, fireEvent } from '@testing-library/react'
import { ResultsViewer } from '../ResultsViewer'

// Mock Chart.js
jest.mock('react-chartjs-2', () => ({
  Line: ({ data, options }: any) => (
    <div data-testid="line-chart">
      <div data-testid="chart-data">{JSON.stringify(data)}</div>
      <div data-testid="chart-options">{JSON.stringify(options)}</div>
    </div>
  ),
  Bar: ({ data, options }: any) => (
    <div data-testid="bar-chart">
      <div data-testid="chart-data">{JSON.stringify(data)}</div>
    </div>
  ),
}))

describe('ResultsViewer', () => {
  const mockResults = {
    id: 'sim-1',
    projectId: 1,
    status: 'completed' as const,
    inputFilePath: '/test/input.wam',
    outputFilePath: '/test/output.csv',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    completedAt: new Date('2024-01-01T10:05:00Z'),
    progress: 100,
    data: {
      timeData: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      pressureData: {
        'Node 1': [101325, 102000, 101800, 102200, 101900, 102100],
        'Node 2': [101325, 101500, 101400, 101600, 101450, 101550]
      },
      temperatureData: {
        'Node 1': [293, 295, 294, 296, 295, 295.5],
        'Node 2': [293, 294, 293.5, 294.5, 294, 294.2]
      },
      velocityData: {
        'Pipe 1': [0, 10, 8, 12, 9, 11],
        'Pipe 2': [0, 8, 6, 10, 7, 9]
      }
    },
    statistics: {
      maxPressure: 102200,
      minPressure: 101325,
      avgPressure: 101725,
      maxTemperature: 296,
      minTemperature: 293,
      avgTemperature: 294.5,
      maxVelocity: 12,
      minVelocity: 0,
      avgVelocity: 8.5
    }
  }

  const mockOnExport = jest.fn()
  const mockOnCompare = jest.fn()

  beforeEach(() => {
    mockOnExport.mockClear()
    mockOnCompare.mockClear()
  })

  test('renders simulation results', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    expect(screen.getByText('シミュレーション結果')).toBeInTheDocument()
    expect(screen.getByText('完了')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  test('displays pressure chart by default', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    expect(screen.getByText('圧力 (Pa)')).toBeInTheDocument()
  })

  test('switches between different chart types', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    // Switch to temperature
    fireEvent.click(screen.getByText('温度'))
    expect(screen.getByText('温度 (K)')).toBeInTheDocument()
    
    // Switch to velocity
    fireEvent.click(screen.getByText('速度'))
    expect(screen.getByText('速度 (m/s)')).toBeInTheDocument()
  })

  test('shows statistics panel', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    expect(screen.getByText('統計情報')).toBeInTheDocument()
    expect(screen.getByText('102200')).toBeInTheDocument() // max pressure
    expect(screen.getByText('101325')).toBeInTheDocument() // min pressure
  })

  test('handles export button click', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    const exportButton = screen.getByText('エクスポート')
    fireEvent.click(exportButton)
    
    expect(mockOnExport).toHaveBeenCalledWith(mockResults.id, 'csv')
  })

  test('handles compare button click', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    const compareButton = screen.getByText('比較')
    fireEvent.click(compareButton)
    
    expect(mockOnCompare).toHaveBeenCalledWith(mockResults.id)
  })

  test('shows loading state when results are null', () => {
    render(
      <ResultsViewer
        results={null}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    expect(screen.getByText('結果を読み込み中...')).toBeInTheDocument()
  })

  test('shows error state for failed simulation', () => {
    const failedResults = {
      ...mockResults,
      status: 'failed' as const,
      errorMessage: 'Simulation failed due to convergence issues'
    }
    
    render(
      <ResultsViewer
        results={failedResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    expect(screen.getByText('失敗')).toBeInTheDocument()
    expect(screen.getByText('Simulation failed due to convergence issues')).toBeInTheDocument()
  })

  test('allows data filtering', () => {
    render(
      <ResultsViewer
        results={mockResults}
        onExport={mockOnExport}
        onCompare={mockOnCompare}
      />
    )
    
    // Should have node selection checkboxes
    expect(screen.getByText('Node 1')).toBeInTheDocument()
    expect(screen.getByText('Node 2')).toBeInTheDocument()
    
    // Uncheck Node 2
    const node2Checkbox = screen.getByLabelText('Node 2')
    fireEvent.click(node2Checkbox)
    
    // Chart should update (this would be tested with more detailed chart content)
  })
})
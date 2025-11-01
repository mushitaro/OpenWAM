import { render, screen, fireEvent } from '@testing-library/react'
import { PropertiesPanel } from '../PropertiesPanel'
import { ComponentType } from '../../../../src/shared/types/openWAMComponents'

describe('PropertiesPanel', () => {
  const mockComponent = {
    id: 'pipe-1',
    type: ComponentType.PIPE,
    position: { x: 100, y: 100 },
    rotation: 0,
    properties: {
      numeroTubo: 1,
      nodoIzq: 1,
      nodoDer: 2,
      nin: 10,
      longitudTotal: 1.0,
      mallado: 0.1,
      nTramos: 1,
      tipoMallado: 'distance',
      friccion: 0.02,
      tipoTransCal: 1,
      coefAjusFric: 1.0,
      coefAjusTC: 1.0,
      espesorPrin: 0.002,
      densidadPrin: 7800,
      calEspPrin: 460,
      conductPrin: 50,
      tRefrigerante: 293,
      tipRefrig: 'air',
      tini: 293,
      pini: 101325,
      velMedia: 0,
      lTramo: [1.0],
      dExtTramo: [0.05],
      numCapas: 1,
      capas: []
    }
  }

  const mockOnPropertyChange = jest.fn()
  const mockOnClose = jest.fn()

  beforeEach(() => {
    mockOnPropertyChange.mockClear()
    mockOnClose.mockClear()
  })

  test('renders component properties', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    expect(screen.getByText('プロパティ')).toBeInTheDocument()
    expect(screen.getByText('1Dパイプ')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument() // numeroTubo
  })

  test('handles property changes', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    const input = screen.getByDisplayValue('1') // numeroTubo input
    fireEvent.change(input, { target: { value: '2' } })
    
    expect(mockOnPropertyChange).toHaveBeenCalledWith('numeroTubo', 2)
  })

  test('validates property values', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    const ninInput = screen.getByDisplayValue('10') // nin input
    fireEvent.change(ninInput, { target: { value: '-1' } })
    
    // Should show validation error
    expect(screen.getByText('値は1以上である必要があります')).toBeInTheDocument()
  })

  test('shows property descriptions', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    // Should show help text for properties
    expect(screen.getByText('パイプ番号')).toBeInTheDocument()
    expect(screen.getByText('計算セル数')).toBeInTheDocument()
  })

  test('handles close button', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    const closeButton = screen.getByTitle('閉じる')
    fireEvent.click(closeButton)
    
    expect(mockOnClose).toHaveBeenCalled()
  })

  test('renders different property types correctly', () => {
    render(
      <PropertiesPanel
        component={mockComponent}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    // Number input
    expect(screen.getByDisplayValue('1.0')).toBeInTheDocument() // longitudTotal
    
    // Select input
    expect(screen.getByDisplayValue('distance')).toBeInTheDocument() // tipoMallado
    
    // Boolean would be rendered as checkbox if present
  })

  test('shows no component selected message when component is null', () => {
    render(
      <PropertiesPanel
        component={null}
        onPropertyChange={mockOnPropertyChange}
        onClose={mockOnClose}
      />
    )
    
    expect(screen.getByText('コンポーネントが選択されていません')).toBeInTheDocument()
  })
})
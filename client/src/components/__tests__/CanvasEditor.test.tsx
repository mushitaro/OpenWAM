import { render, screen, fireEvent } from '@testing-library/react'
import { CanvasEditor } from '../CanvasEditor'
import { ComponentType } from '../../../../src/shared/types/openWAMComponents'

// Mock Konva
jest.mock('react-konva', () => ({
  Stage: ({ children, ...props }: any) => <div data-testid="konva-stage" {...props}>{children}</div>,
  Layer: ({ children, ...props }: any) => <div data-testid="konva-layer" {...props}>{children}</div>,
  Rect: (props: any) => <div data-testid="konva-rect" {...props} />,
  Circle: (props: any) => <div data-testid="konva-circle" {...props} />,
  Text: (props: any) => <div data-testid="konva-text" {...props}>{props.text}</div>,
  Group: ({ children, ...props }: any) => <div data-testid="konva-group" {...props}>{children}</div>,
}))

describe('CanvasEditor', () => {
  const mockProps = {
    components: [],
    connections: [],
    selectedComponent: null,
    onComponentAdd: jest.fn(),
    onComponentSelect: jest.fn(),
    onComponentMove: jest.fn(),
    onComponentDelete: jest.fn(),
    onConnectionCreate: jest.fn(),
    onConnectionDelete: jest.fn(),
    draggedComponentType: null,
  }

  beforeEach(() => {
    Object.values(mockProps).forEach(mock => {
      if (typeof mock === 'function') {
        mock.mockClear()
      }
    })
  })

  test('renders canvas stage', () => {
    render(<CanvasEditor {...mockProps} />)
    
    expect(screen.getByTestId('konva-stage')).toBeInTheDocument()
    expect(screen.getByTestId('konva-layer')).toBeInTheDocument()
  })

  test('handles component drop', () => {
    const props = {
      ...mockProps,
      draggedComponentType: ComponentType.PIPE
    }
    
    render(<CanvasEditor {...props} />)
    
    const stage = screen.getByTestId('konva-stage')
    
    // Simulate drop event
    fireEvent.click(stage)
    
    expect(mockProps.onComponentAdd).toHaveBeenCalledWith(
      ComponentType.PIPE,
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number)
      })
    )
  })

  test('renders components on canvas', () => {
    const components = [
      {
        id: 'pipe-1',
        type: ComponentType.PIPE,
        position: { x: 100, y: 100 },
        rotation: 0,
        properties: {}
      }
    ]
    
    render(<CanvasEditor {...mockProps} components={components} />)
    
    // Should render component shape
    expect(screen.getByTestId('konva-group')).toBeInTheDocument()
  })

  test('handles component selection', () => {
    const components = [
      {
        id: 'pipe-1',
        type: ComponentType.PIPE,
        position: { x: 100, y: 100 },
        rotation: 0,
        properties: {}
      }
    ]
    
    render(<CanvasEditor {...mockProps} components={components} />)
    
    const componentGroup = screen.getByTestId('konva-group')
    fireEvent.click(componentGroup)
    
    expect(mockProps.onComponentSelect).toHaveBeenCalledWith('pipe-1')
  })

  test('shows grid when enabled', () => {
    render(<CanvasEditor {...mockProps} showGrid={true} />)
    
    // Grid should be rendered (multiple rect elements for grid lines)
    const rects = screen.getAllByTestId('konva-rect')
    expect(rects.length).toBeGreaterThan(0)
  })

  test('handles zoom controls', () => {
    render(<CanvasEditor {...mockProps} />)
    
    const zoomInButton = screen.getByTitle('ズームイン')
    const zoomOutButton = screen.getByTitle('ズームアウト')
    const resetZoomButton = screen.getByTitle('ズームリセット')
    
    expect(zoomInButton).toBeInTheDocument()
    expect(zoomOutButton).toBeInTheDocument()
    expect(resetZoomButton).toBeInTheDocument()
    
    fireEvent.click(zoomInButton)
    fireEvent.click(zoomOutButton)
    fireEvent.click(resetZoomButton)
  })
})
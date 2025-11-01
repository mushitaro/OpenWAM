import { render, screen, fireEvent } from '@testing-library/react'
import { ComponentPalette } from '../ComponentPalette'
import { ComponentType, ComponentCategory } from '../../../../src/shared/types/openWAMComponents'

describe('ComponentPalette', () => {
  const mockOnComponentSelect = jest.fn()

  beforeEach(() => {
    mockOnComponentSelect.mockClear()
  })

  test('renders component categories', () => {
    render(<ComponentPalette onComponentSelect={mockOnComponentSelect} />)
    
    expect(screen.getByText('パイプ')).toBeInTheDocument()
    expect(screen.getByText('境界条件')).toBeInTheDocument()
    expect(screen.getByText('プレナム')).toBeInTheDocument()
    expect(screen.getByText('バルブ')).toBeInTheDocument()
  })

  test('shows components when category is expanded', () => {
    render(<ComponentPalette onComponentSelect={mockOnComponentSelect} />)
    
    // Click on pipes category
    fireEvent.click(screen.getByText('パイプ'))
    
    // Should show pipe component
    expect(screen.getByText('1Dパイプ')).toBeInTheDocument()
  })

  test('calls onComponentSelect when component is clicked', () => {
    render(<ComponentPalette onComponentSelect={mockOnComponentSelect} />)
    
    // Expand pipes category
    fireEvent.click(screen.getByText('パイプ'))
    
    // Click on pipe component
    fireEvent.click(screen.getByText('1Dパイプ'))
    
    expect(mockOnComponentSelect).toHaveBeenCalledWith(ComponentType.PIPE)
  })

  test('filters components based on search', () => {
    render(<ComponentPalette onComponentSelect={mockOnComponentSelect} />)
    
    const searchInput = screen.getByPlaceholderText('コンポーネントを検索...')
    fireEvent.change(searchInput, { target: { value: 'パイプ' } })
    
    expect(screen.getByText('1Dパイプ')).toBeInTheDocument()
  })

  test('shows no results when search has no matches', () => {
    render(<ComponentPalette onComponentSelect={mockOnComponentSelect} />)
    
    const searchInput = screen.getByPlaceholderText('コンポーネントを検索...')
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    
    expect(screen.getByText('該当するコンポーネントが見つかりません')).toBeInTheDocument()
  })
})
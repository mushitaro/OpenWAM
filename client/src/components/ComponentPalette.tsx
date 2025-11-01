import React, { useState } from 'react';
import { ComponentCategory, ComponentType } from '../types';

// Helper function to get test ID for components
const getComponentTestId = (componentType: ComponentType): string => {
  const testIdMap: Record<ComponentType, string> = {
    [ComponentType.PIPE]: 'add-pipe',
    [ComponentType.CONCENTRIC_PIPE]: 'add-concentric-pipe',
    [ComponentType.OPEN_END_ATMOSPHERE]: 'add-atmosphere',
    [ComponentType.CLOSED_END]: 'add-closed-end',
    [ComponentType.ANECHOIC_END]: 'add-anechoic-end',
    [ComponentType.BRANCH]: 'add-branch',
    [ComponentType.CONSTANT_VOLUME_PLENUM]: 'add-plenum',
    [ComponentType.VARIABLE_VOLUME_PLENUM]: 'add-variable-plenum',
    [ComponentType.SIMPLE_TURBINE]: 'add-turbine',
    [ComponentType.FIXED_CD_VALVE]: 'add-valve',
    [ComponentType.VALVE_4T]: 'add-4t-valve',
    [ComponentType.REED_VALVE]: 'add-reed-valve',
    [ComponentType.BUTTERFLY_VALVE]: 'add-butterfly-valve',
    [ComponentType.ENGINE_BLOCK]: 'add-engine',
    [ComponentType.CYLINDER_4T]: 'add-4t-cylinder',
    [ComponentType.CYLINDER_2T]: 'add-2t-cylinder',
    [ComponentType.DPF]: 'add-dpf',
    // Add more mappings as needed
  } as Record<ComponentType, string>;
  
  return testIdMap[componentType] || `add-${componentType.toLowerCase()}`;
};

// Category icons mapping - Simple geometric icons
const getCategoryIcon = (category: ComponentCategory): string => {
  const iconMap: Record<ComponentCategory, string> = {
    [ComponentCategory.PIPES]: '━',
    [ComponentCategory.BOUNDARIES]: '□',
    [ComponentCategory.PLENUMS]: '○',
    [ComponentCategory.VALVES]: '◇',
    [ComponentCategory.TURBOCHARGER]: '◐',
    [ComponentCategory.ENGINE]: '▣',
    [ComponentCategory.CONTROL]: '⚙',
    [ComponentCategory.DPF]: '◈',
    [ComponentCategory.EXTERNAL]: '⬡'
  };
  return iconMap[category] || '■';
};

interface ComponentPaletteProps {
  onAddComponent: (componentType: string, position: { x: number; y: number }) => void;
}

// Clean, minimal component definitions
const componentCategories = [
  {
    category: ComponentCategory.PIPES,
    name: 'パイプ',
    components: [
      { type: ComponentType.PIPE, name: '1Dパイプ' },
      { type: ComponentType.CONCENTRIC_PIPE, name: '同心円パイプ' }
    ]
  },
  {
    category: ComponentCategory.BOUNDARIES,
    name: '境界条件',
    components: [
      { type: ComponentType.OPEN_END_ATMOSPHERE, name: '開放端（大気）' },
      { type: ComponentType.CLOSED_END, name: '閉端' },
      { type: ComponentType.ANECHOIC_END, name: '無反射端' },
      { type: ComponentType.BRANCH, name: '分岐' }
    ]
  },
  {
    category: ComponentCategory.PLENUMS,
    name: 'プレナム',
    components: [
      { type: ComponentType.CONSTANT_VOLUME_PLENUM, name: '定容積プレナム' },
      { type: ComponentType.VARIABLE_VOLUME_PLENUM, name: '可変容積プレナム' },
      { type: ComponentType.SIMPLE_TURBINE, name: 'シンプルタービン' }
    ]
  },
  {
    category: ComponentCategory.VALVES,
    name: 'バルブ',
    components: [
      { type: ComponentType.FIXED_CD_VALVE, name: '固定CDバルブ' },
      { type: ComponentType.VALVE_4T, name: '4Tバルブ' },
      { type: ComponentType.REED_VALVE, name: 'リードバルブ' },
      { type: ComponentType.BUTTERFLY_VALVE, name: 'バタフライバルブ' }
    ]
  },
  {
    category: ComponentCategory.ENGINE,
    name: 'エンジン',
    components: [
      { type: ComponentType.ENGINE_BLOCK, name: 'エンジンブロック' },
      { type: ComponentType.CYLINDER_4T, name: '4Tシリンダー' },
      { type: ComponentType.CYLINDER_2T, name: '2Tシリンダー' }
    ]
  },
  {
    category: ComponentCategory.DPF,
    name: 'DPF',
    components: [
      { type: ComponentType.DPF, name: 'ディーゼル微粒子フィルター' }
    ]
  }
];

const ComponentPalette: React.FC<ComponentPaletteProps> = ({ onAddComponent }) => {
  const [selectedCategory, setSelectedCategory] = useState<ComponentCategory | null>(null);
  const [selectedComponentType, setSelectedComponentType] = useState<string | null>(null);

  const toggleCategory = (category: ComponentCategory) => {
    setSelectedCategory(selectedCategory === category ? null : category);
    // Only reset component selection when closing category, not when opening
    if (selectedCategory === category) {
      setSelectedComponentType(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, componentType: string) => {
    e.dataTransfer.setData('componentType', componentType);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleComponentClick = (componentType: string) => {
    // Check if connection mode is active
    const connectionMode = (window as any).connectionMode;
    if (connectionMode) {
      // In connection mode, don't add components
      console.log('Connection mode active, component addition disabled');
      return;
    }
    
    setSelectedComponentType(componentType);
    // Store selected component type globally for canvas to use
    (window as any).selectedComponentType = componentType;
    
    // Add component directly using the prop
    const defaultPosition = { 
      x: 100 + Math.random() * 200, 
      y: 100 + Math.random() * 200 
    };
    onAddComponent(componentType, defaultPosition);
    
    // Keep the component selected for multiple additions
    // Don't clear selectedComponentType to allow consecutive additions
  };

  return (
    <div 
      data-testid="component-palette"
      style={{
        position: 'fixed',
        top: '50%',
        left: '20px',
        transform: 'translateY(-50%)',
        zIndex: 1000,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start'
      }}
    >
      {/* Category Buttons - Floating like zoom controls */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        backgroundColor: '#ffffff',
        borderRadius: '6px',
        padding: '6px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        border: '1px solid #e2e8f0'
      }}>
        {componentCategories.map(category => (
          <div
            key={category.category}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              backgroundColor: selectedCategory === category.category ? '#2563eb' : '#ffffff',
              border: `1px solid ${selectedCategory === category.category ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              transition: 'all 0.2s ease',
              boxShadow: selectedCategory === category.category ? '0 1px 3px rgba(37, 99, 235, 0.3)' : 'none'
            }}
            onClick={() => toggleCategory(category.category)}
            onMouseEnter={(e) => {
              if (selectedCategory !== category.category) {
                e.currentTarget.style.backgroundColor = '#f8fafc';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedCategory !== category.category) {
                e.currentTarget.style.backgroundColor = '#ffffff';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
            data-testid={`component-palette-${category.category}`}
            title={category.name}
          >
            <span style={{
              color: selectedCategory === category.category ? '#ffffff' : '#64748b',
              fontWeight: '500'
            }}>
              {getCategoryIcon(category.category)}
            </span>
          </div>
        ))}
      </div>
      
      {/* Component Selection Panel - Appears to the right */}
      {selectedCategory && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '6px',
          padding: '12px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          minWidth: '180px',
          maxWidth: '220px'
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#64748b',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            {componentCategories.find(cat => cat.category === selectedCategory)?.name}
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            {componentCategories
              .find(cat => cat.category === selectedCategory)
              ?.components.map(component => (
                <div
                  key={component.type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, component.type)}
                  onClick={() => handleComponentClick(component.type)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 10px',
                    backgroundColor: selectedComponentType === component.type ? '#f1f5f9' : '#ffffff',
                    border: `1px solid ${selectedComponentType === component.type ? '#2563eb' : 'transparent'}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s ease',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedComponentType !== component.type) {
                      e.currentTarget.style.backgroundColor = '#f8fafc';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedComponentType !== component.type) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                      e.currentTarget.style.borderColor = 'transparent';
                    }
                  }}
                  data-testid={getComponentTestId(component.type)}
                >
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: selectedComponentType === component.type ? '#2563eb' : '#94a3b8',
                    borderRadius: '2px',
                    transition: 'background-color 0.2s ease',
                    flexShrink: 0
                  }} />
                  <span style={{
                    color: selectedComponentType === component.type ? '#0f172a' : '#64748b',
                    fontWeight: selectedComponentType === component.type ? '500' : '400',
                    lineHeight: '1.3',
                    flex: 1
                  }}>
                    {component.name}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ComponentPalette;
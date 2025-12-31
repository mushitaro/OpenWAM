import React, { useState, useEffect } from 'react';
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
    [ComponentType.SENSOR]: 'add-sensor',
    [ComponentType.TABLE_1D]: 'add-table-1d',
    [ComponentType.CONTROLLER]: 'add-controller',
    [ComponentType.PID_CONTROLLER]: 'add-pid-controller',
    [ComponentType.CONTROL_VALVE]: 'add-control-valve',
    [ComponentType.PIPE_TO_PLENUM]: 'add-pipe-to-plenum',
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

// Comprehensive component definitions with detailed Japanese descriptions
const componentCategories = [
  {
    category: ComponentCategory.PIPES,
    name: 'パイプ',
    description: '1次元ガス流動計算用パイプ要素',
    components: [
      { 
        type: ComponentType.PIPE, 
        name: '1Dパイプ',
        description: '基本的な1次元パイプ - 圧力波伝播と熱伝達を計算'
      },
      { 
        type: ComponentType.CONCENTRIC_PIPE, 
        name: '同心円パイプ',
        description: '二重管構造のパイプ - 内管と外管の熱交換を考慮'
      }
    ]
  },
  {
    category: ComponentCategory.BOUNDARIES,
    name: '境界条件',
    description: 'パイプ端部の境界条件設定',
    components: [
      { 
        type: ComponentType.OPEN_END_ATMOSPHERE, 
        name: '開放端（大気）',
        description: '大気圧に開放された端部 - 圧力波が部分反射'
      },
      { 
        type: ComponentType.CLOSED_END, 
        name: '閉端',
        description: '完全に閉じられた端部 - 圧力波が完全反射'
      },
      { 
        type: ComponentType.ANECHOIC_END, 
        name: '無反射端',
        description: '無反射境界 - 圧力波を完全吸収（反射なし）'
      },
      { 
        type: ComponentType.BRANCH, 
        name: '分岐',
        description: '3方向分岐 - 1本のパイプを2本に分岐または合流'
      }
    ]
  },
  {
    category: ComponentCategory.PLENUMS,
    name: 'プレナム',
    description: '0次元容積要素（チャンバー、タンク等）',
    components: [
      { 
        type: ComponentType.CONSTANT_VOLUME_PLENUM, 
        name: '定容積プレナム',
        description: '一定容積のチャンバー - エアクリーナー、サージタンク等'
      },
      { 
        type: ComponentType.VARIABLE_VOLUME_PLENUM, 
        name: '可変容積プレナム',
        description: '時間変化する容積 - ピストン運動等による容積変化'
      },
      { 
        type: ComponentType.SIMPLE_TURBINE, 
        name: 'シンプルタービン',
        description: 'ターボチャージャー用タービン - マップベース性能計算'
      }
    ]
  },
  {
    category: ComponentCategory.VALVES,
    name: 'バルブ',
    description: '流量制御・調整用バルブ要素',
    components: [
      { 
        type: ComponentType.FIXED_CD_VALVE, 
        name: '固定CDバルブ',
        description: '固定流量係数バルブ - オリフィス、絞り等'
      },
      { 
        type: ComponentType.VALVE_4T, 
        name: '4Tバルブ',
        description: '4ストロークエンジン用バルブ - カム駆動開閉'
      },
      { 
        type: ComponentType.REED_VALVE, 
        name: 'リードバルブ',
        description: '2ストローク用リードバルブ - 圧力差による自動開閉'
      },
      { 
        type: ComponentType.BUTTERFLY_VALVE, 
        name: 'バタフライバルブ',
        description: 'スロットルバルブ - 吸気量制御用'
      }
    ]
  },
  {
    category: ComponentCategory.ENGINE,
    name: 'エンジン',
    description: 'エンジン本体構成要素',
    components: [
      { 
        type: ComponentType.ENGINE_BLOCK, 
        name: 'エンジンブロック',
        description: 'エンジン本体 - 基本諸元とクランクシャフト定義'
      },
      { 
        type: ComponentType.CYLINDER_4T, 
        name: '4Tシリンダー',
        description: '4ストロークシリンダー - 吸気・圧縮・燃焼・排気'
      },
      { 
        type: ComponentType.CYLINDER_2T, 
        name: '2Tシリンダー',
        description: '2ストロークシリンダー - ポート制御ガス交換'
      }
    ]
  },
  {
    category: ComponentCategory.CONTROL,
    name: '制御システム',
    description: 'VANOS制御システム用コンポーネント',
    components: [
      { 
        type: ComponentType.SENSOR, 
        name: 'センサー',
        description: 'カム・クランクポジションセンサー - VANOS制御用位置検出'
      },
      { 
        type: ComponentType.TABLE_1D, 
        name: '1Dテーブル',
        description: 'VANOSマップテーブル - エンジン回転数に応じたタイミング制御'
      },
      { 
        type: ComponentType.CONTROLLER, 
        name: 'コントローラー',
        description: 'VANOS制御ロジック - センサー入力とテーブル参照による制御判定'
      },
      { 
        type: ComponentType.PID_CONTROLLER, 
        name: 'PIDコントローラー',
        description: 'PID制御器 - 精密なVANOSタイミング制御'
      },
      { 
        type: ComponentType.CONTROL_VALVE, 
        name: '制御バルブ',
        description: '油圧制御バルブ - VANOS機構の油圧アクチュエーター'
      },
      { 
        type: ComponentType.PIPE_TO_PLENUM, 
        name: 'パイプ-プレナム接続',
        description: 'パイプとプレナムの直接接続 - 油圧回路用'
      }
    ]
  },
  {
    category: ComponentCategory.DPF,
    name: 'DPF',
    description: '排気後処理装置',
    components: [
      { 
        type: ComponentType.DPF, 
        name: 'ディーゼル微粒子フィルター',
        description: 'DPF - ディーゼル排気中の粒子状物質を捕集'
      }
    ]
  }
];

const ComponentPalette: React.FC<ComponentPaletteProps> = ({ onAddComponent }) => {
  const [selectedCategory, setSelectedCategory] = useState<ComponentCategory | null>(null);
  const [selectedComponentType, setSelectedComponentType] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState(false);

  // Monitor connection mode changes
  useEffect(() => {
    const checkConnectionMode = () => {
      const currentConnectionMode = (window as any).connectionMode || false;
      if (currentConnectionMode !== connectionMode) {
        setConnectionMode(currentConnectionMode);
        if (currentConnectionMode) {
          // Close palette when connection mode is activated
          setSelectedCategory(null);
          setSelectedComponentType(null);
        }
      }
    };

    // Check immediately
    checkConnectionMode();

    // Set up interval to check connection mode changes
    const interval = setInterval(checkConnectionMode, 100);

    return () => clearInterval(interval);
  }, [connectionMode]);

  const toggleCategory = (category: ComponentCategory) => {
    // Check if connection mode is active
    const connectionMode = (window as any).connectionMode;
    if (connectionMode) {
      return;
    }
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
      // In connection mode, don't add components and close palette
      setSelectedCategory(null);
      return;
    }
    
    setSelectedComponentType(componentType);
    // Store selected component type globally for canvas to use
    (window as any).selectedComponentType = componentType;
    
    // Add component directly using the prop
    // Use more predictable positions for better testing
    const componentCount = (window as any).componentCount || 0;
    (window as any).componentCount = componentCount + 1;
    
    const defaultPosition = { 
      x: 200 + (componentCount * 150), // Spread components horizontally
      y: 200 
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
        zIndex: connectionMode ? -1 : 10, // Hide behind canvas in connection mode
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex', // Always show palette
        gap: '12px',
        alignItems: 'flex-start',
        pointerEvents: connectionMode ? 'none' : 'auto' // Disable in connection mode
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
        border: '1px solid #e2e8f0',
        pointerEvents: connectionMode ? 'none' : 'auto' // Disable in connection mode
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
          minWidth: '240px',
          maxWidth: '280px',
          pointerEvents: connectionMode ? 'none' : 'auto' // Disable in connection mode
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#64748b',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            {componentCategories.find(cat => cat.category === selectedCategory)?.name}
          </div>
          <div style={{
            fontSize: '10px',
            color: '#94a3b8',
            marginBottom: '8px',
            lineHeight: '1.3'
          }}>
            {componentCategories.find(cat => cat.category === selectedCategory)?.description}
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
                    flexDirection: 'column',
                    padding: '8px 10px',
                    backgroundColor: selectedComponentType === component.type ? '#f1f5f9' : '#ffffff',
                    border: `1px solid ${selectedComponentType === component.type ? '#2563eb' : 'transparent'}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s ease',
                    gap: '4px'
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
                  title={component.description}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
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
                  {component.description && (
                    <div style={{
                      fontSize: '10px',
                      color: '#94a3b8',
                      lineHeight: '1.2',
                      marginLeft: '24px',
                      display: selectedComponentType === component.type ? 'block' : 'none'
                    }}>
                      {component.description}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ComponentPalette;
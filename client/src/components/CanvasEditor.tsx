import React, { useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line } from 'react-konva';
import Konva from 'konva';
import { EngineModel, ModelComponent } from '../types';
import ComponentShape from './ComponentShape';

interface CanvasEditorProps {
  model: EngineModel;
  selectedComponentId: string | null;
  onSelectComponent: (componentId: string | null) => void;
  onUpdateComponent: (componentId: string, updates: Partial<ModelComponent>) => void;
  onDeleteComponent: (componentId: string) => void;
  onAddConnection?: (connection: any) => void;
}

const CanvasEditor: React.FC<CanvasEditorProps> = ({
  model,
  selectedComponentId,
  onSelectComponent,
  onUpdateComponent,
  onDeleteComponent,
  onAddConnection
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  const [connectionMode, setConnectionMode] = useState(false);
  
  // Expose connection mode and handler globally
  React.useEffect(() => {
    (window as any).connectionMode = connectionMode;
    (window as any).handleAddConnection = (connection: any) => {
      if (onAddConnection) {
        onAddConnection(connection);
      } else {
        // Fallback: add to model directly
        model.connections.push(connection);
        console.log('Connection added to model:', connection);
      }
    };
  }, [connectionMode, onAddConnection, model]);
  const [firstConnectionPoint, setFirstConnectionPoint] = useState<{componentId: string, port: string} | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);

  // Handle canvas resize
  React.useEffect(() => {
    const handleResize = () => {
      const container = stageRef.current?.container();
      if (container) {
        const containerRect = container.getBoundingClientRect();
        setStageSize({
          width: containerRect.width,
          height: containerRect.height
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle component drop from palette
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const componentType = e.dataTransfer.getData('componentType');
    
    if (componentType && stageRef.current) {
      const stage = stageRef.current;
      const pointerPosition = stage.getPointerPosition();
      
      if (pointerPosition) {
        // Convert screen coordinates to stage coordinates
        const stagePosition = {
          x: pointerPosition.x,
          y: pointerPosition.y
        };
        
        // Call the parent's add component handler
        if (typeof (window as any).handleAddComponent === 'function') {
          (window as any).handleAddComponent(componentType, stagePosition);
        }
      }
    }
  }, []);

  // Handle canvas click to add selected component
  const handleCanvasClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage();
    
    if (clickedOnEmpty) {
      // In connection mode, don't add components
      if (connectionMode) {
        return;
      }
      
      // Check if there's a selected component type
      const selectedComponentType = (window as any).selectedComponentType;
      
      if (selectedComponentType && stageRef.current) {
        const stage = stageRef.current;
        const pointerPosition = stage.getPointerPosition();
        
        if (pointerPosition) {
          // Add component at click position
          if (typeof (window as any).handleAddComponent === 'function') {
            (window as any).handleAddComponent(selectedComponentType, pointerPosition);
          }
          
          // Keep selected component type for multiple additions
          // Don't clear selectedComponentType to allow consecutive additions
        }
      } else {
        // No component selected, just deselect current component
        onSelectComponent(null);
      }
    }
  }, [onSelectComponent, connectionMode]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Handle component drag
  const handleComponentDragStart = useCallback((componentId: string) => {
    setDraggedComponent(componentId);
  }, []);

  const handleComponentDragEnd = useCallback((componentId: string, newPosition: { x: number; y: number }) => {
    setDraggedComponent(null);
    onUpdateComponent(componentId, { position: newPosition });
  }, [onUpdateComponent]);

  // Handle component selection
  const handleComponentClick = useCallback((componentId: string) => {
    console.log('handleComponentClick called:', componentId);
    onSelectComponent(componentId);
  }, [onSelectComponent]);

  // Check if connection is valid based on OpenWAM rules
  const isValidConnection = useCallback((fromComponentId: string, toComponentId: string) => {
    const fromComponent = model.components.find(c => c.id === fromComponentId);
    const toComponent = model.components.find(c => c.id === toComponentId);
    
    if (!fromComponent || !toComponent) return false;
    
    // OpenWAM connection rules
    const fromType = fromComponent.type;
    const toType = toComponent.type;
    
    // Engine Block and Cylinder relationship: Engine Block contains cylinders, they don't connect directly
    if ((fromType === 'TBloqueMotor' && (toType === 'TCilindro4T' || toType === 'TCilindro2T')) ||
        (toType === 'TBloqueMotor' && (fromType === 'TCilindro4T' || fromType === 'TCilindro2T'))) {
      return false; // Engine blocks contain cylinders, they don't connect via pipes
    }
    
    // Cylinders connect to pipes, not directly to other cylinders
    if ((fromType === 'TCilindro4T' || fromType === 'TCilindro2T') && 
        (toType === 'TCilindro4T' || toType === 'TCilindro2T')) {
      return false; // Cylinders don't connect directly to each other
    }
    
    // Engine blocks don't connect directly to other engine blocks
    if (fromType === 'TBloqueMotor' && toType === 'TBloqueMotor') {
      return false;
    }
    
    return true; // All other connections are valid
  }, [model.components]);

  // Handle connection point clicks
  const handleConnectionPointClick = useCallback((componentId: string, port: string) => {
    if (!connectionMode) return;
    
    if (!firstConnectionPoint) {
      // First click - select starting point
      setFirstConnectionPoint({ componentId, port });
      console.log('Selected first connection point:', componentId, port);
    } else {
      // Second click - create connection
      if (firstConnectionPoint.componentId !== componentId) {
        // Check if connection is valid according to OpenWAM rules
        if (!isValidConnection(firstConnectionPoint.componentId, componentId)) {
          const fromComponent = model.components.find(c => c.id === firstConnectionPoint.componentId);
          const toComponent = model.components.find(c => c.id === componentId);
          
          if (fromComponent && toComponent) {
            if ((fromComponent.type === 'TBloqueMotor' && (toComponent.type === 'TCilindro4T' || toComponent.type === 'TCilindro2T')) ||
                (toComponent.type === 'TBloqueMotor' && (fromComponent.type === 'TCilindro4T' || fromComponent.type === 'TCilindro2T'))) {
              setConnectionFeedback('エンジンブロックとシリンダーは親子関係です。パイプ経由で接続してください');
            } else if ((fromComponent.type === 'TCilindro4T' || fromComponent.type === 'TCilindro2T') && 
                       (toComponent.type === 'TCilindro4T' || toComponent.type === 'TCilindro2T')) {
              setConnectionFeedback('シリンダー同士は直接接続できません。パイプ経由で接続してください');
            } else {
              setConnectionFeedback('この接続は無効です');
            }
          }
        } else {
          // Check for duplicate connections
          const existingConnection = model.connections.find(conn => 
            (conn.fromComponent === firstConnectionPoint.componentId && 
             conn.fromPort === firstConnectionPoint.port &&
             conn.toComponent === componentId && 
             conn.toPort === port) ||
            (conn.fromComponent === componentId && 
             conn.fromPort === port &&
             conn.toComponent === firstConnectionPoint.componentId && 
             conn.toPort === firstConnectionPoint.port)
          );
          
          if (!existingConnection) {
            const connectionId = `connection_${Date.now()}`;
            const newConnection = {
              id: connectionId,
              fromComponent: firstConnectionPoint.componentId,
              fromPort: firstConnectionPoint.port,
              toComponent: componentId,
              toPort: port,
              isValid: true
            };
            
            // Add connection to model (we need to pass this up to the parent)
            if (typeof (window as any).handleAddConnection === 'function') {
              (window as any).handleAddConnection(newConnection);
              console.log('Connection added to model:', newConnection);
              setConnectionFeedback('接続が作成されました');
            } else {
              console.error('handleAddConnection function not found');
            }
            
            console.log('Created connection:', newConnection);
          } else {
            console.log('Connection already exists, skipping duplicate');
            setConnectionFeedback('この接続は既に存在します');
          }
        }
      } else {
        setConnectionFeedback('同じコンポーネント内では接続できません');
      }
      
      // Reset first connection point but keep connection mode active
      setFirstConnectionPoint(null);
      // Don't turn off connection mode - let users make multiple connections
      
      // Clear feedback after 2 seconds
      setTimeout(() => setConnectionFeedback(null), 2000);
    }
  }, [connectionMode, firstConnectionPoint, model.connections, isValidConnection]);

  // Handle keyboard events
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedComponentId) {
        onDeleteComponent(selectedComponentId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedComponentId, onDeleteComponent]);

  // Render connections
  const renderConnections = () => {
    return model.connections.map(connection => {
      const fromComponent = model.components.find(c => c.id === connection.fromComponent);
      const toComponent = model.components.find(c => c.id === connection.toComponent);
      
      if (!fromComponent || !toComponent) return null;

      // Calculate connection line points based on component dimensions
      const fromPos = fromComponent.position;
      const toPos = toComponent.position;
      
      // Get component dimensions dynamically
      const getComponentWidth = (type: string) => {
        switch (type) {
          case 'TTubo': return 100;
          case 'TDepVolCte': 
          case 'TDepVolVariable': return 60;
          case 'TBloqueMotor': return 90;
          case 'TCilindro4T':
          case 'TCilindro2T': return 40;
          default: return 80;
        }
      };
      
      const getComponentHeight = (type: string) => {
        switch (type) {
          case 'TTubo': return 20;
          case 'TDepVolCte': 
          case 'TDepVolVariable': return 60;
          case 'TBloqueMotor': return 50;
          case 'TCilindro4T':
          case 'TCilindro2T': return 60;
          default: return 40;
        }
      };
      
      const fromWidth = getComponentWidth(fromComponent.type);
      const fromHeight = getComponentHeight(fromComponent.type);
      const toWidth = getComponentWidth(toComponent.type);
      const toHeight = getComponentHeight(toComponent.type);
      
      // Calculate port positions
      const fromX = connection.fromPort === 'right' ? fromPos.x + fromWidth + 4 : fromPos.x - 4;
      const fromY = fromPos.y + fromHeight / 2;
      const toX = connection.toPort === 'right' ? toPos.x + toWidth + 4 : toPos.x - 4;
      const toY = toPos.y + toHeight / 2;
      
      const points = [fromX, fromY, toX, toY];

      return (
        <Line
          key={connection.id}
          points={points}
          stroke={connection.isValid ? '#2563eb' : '#ef4444'}
          strokeWidth={2}
          dash={connection.isValid ? [] : [4, 4]}
          data-testid="canvas-connection"
          lineCap="round"
        />
      );
    });
  };

  // Modern grid background
  const renderGrid = () => {
    const gridSize = 25;
    const lines = [];
    
    // Major grid lines (every 5th line)
    const majorGridSize = gridSize * 5;
    
    // Vertical major lines
    for (let i = 0; i < stageSize.width; i += majorGridSize) {
      lines.push(
        <Line
          key={`vmajor${i}`}
          points={[i, 0, i, stageSize.height]}
          stroke="rgba(52, 152, 219, 0.3)"
          strokeWidth={1}
          data-testid="canvas-grid"
        />
      );
    }
    
    // Horizontal major lines
    for (let i = 0; i < stageSize.height; i += majorGridSize) {
      lines.push(
        <Line
          key={`hmajor${i}`}
          points={[0, i, stageSize.width, i]}
          stroke="rgba(52, 152, 219, 0.3)"
          strokeWidth={1}
          data-testid="canvas-grid"
        />
      );
    }
    
    // Minor grid lines
    for (let i = 0; i < stageSize.width; i += gridSize) {
      if (i % majorGridSize !== 0) {
        lines.push(
          <Line
            key={`v${i}`}
            points={[i, 0, i, stageSize.height]}
            stroke="rgba(149, 165, 166, 0.2)"
            strokeWidth={0.5}
            data-testid="canvas-grid"
          />
        );
      }
    }
    
    for (let i = 0; i < stageSize.height; i += gridSize) {
      if (i % majorGridSize !== 0) {
        lines.push(
          <Line
            key={`h${i}`}
            points={[0, i, stageSize.width, i]}
            stroke="rgba(149, 165, 166, 0.2)"
            strokeWidth={0.5}
            data-testid="canvas-grid"
          />
        );
      }
    }
    
    return lines;
  };

  return (
    <div 
      className="canvas-container"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%',
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }}
      data-testid="canvas-editor"
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onClick={handleCanvasClick}
        onTap={handleCanvasClick}
      >
        <Layer>
          {/* Grid background */}
          {showGrid && renderGrid()}
          
          {/* Connections */}
          {renderConnections()}
          
          {/* Components */}
          {model.components.map(component => (
            <ComponentShape
              key={component.id}
              component={component}
              isSelected={component.id === selectedComponentId}
              isDragging={component.id === draggedComponent}
              onDragStart={() => handleComponentDragStart(component.id)}
              onDragEnd={(newPosition) => handleComponentDragEnd(component.id, newPosition)}
              onClick={() => handleComponentClick(component.id)}
              onConnectionPointClick={handleConnectionPointClick}
              connectionMode={connectionMode}
              firstConnectionPoint={firstConnectionPoint}
            />
          ))}
        </Layer>
      </Stage>
      
      {/* Clean canvas controls */}
      <div style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 2000
      }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          border: '1px solid #e2e8f0'
        }}>
          <button
            data-testid="zoom-in-button"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: '#ffffff',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f8fafc';
              (e.target as HTMLElement).style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#ffffff';
              (e.target as HTMLElement).style.borderColor = '#e2e8f0';
            }}
            onClick={() => {
              // TODO: Implement zoom in
              console.log('Zoom in');
            }}
            title="ズームイン"
          >
            +
          </button>
          
          <button
            data-testid="zoom-out-button"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: '#ffffff',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f8fafc';
              (e.target as HTMLElement).style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#ffffff';
              (e.target as HTMLElement).style.borderColor = '#e2e8f0';
            }}
            onClick={() => {
              // TODO: Implement zoom out
              console.log('Zoom out');
            }}
            title="ズームアウト"
          >
            −
          </button>
          
          <button
            data-testid="zoom-reset-button"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: '#ffffff',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f8fafc';
              (e.target as HTMLElement).style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#ffffff';
              (e.target as HTMLElement).style.borderColor = '#e2e8f0';
            }}
            onClick={() => {
              // TODO: Implement zoom reset
              console.log('Zoom reset');
            }}
            title="ズームリセット"
          >
            ⌂
          </button>
          
          <button
            data-testid="toggle-grid-button"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: showGrid ? '#2563eb' : '#ffffff',
              color: showGrid ? '#ffffff' : '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!showGrid) {
                (e.target as HTMLElement).style.backgroundColor = '#f8fafc';
                (e.target as HTMLElement).style.borderColor = '#cbd5e1';
              }
            }}
            onMouseLeave={(e) => {
              if (!showGrid) {
                (e.target as HTMLElement).style.backgroundColor = '#ffffff';
                (e.target as HTMLElement).style.borderColor = '#e2e8f0';
              }
            }}
            onClick={() => {
              setShowGrid(!showGrid);
            }}
            title={showGrid ? 'グリッドを非表示' : 'グリッドを表示'}
          >
            ⊞
          </button>
          
          <button
            data-testid="connection-tool"
            style={{
              width: '32px',
              height: '32px',
              backgroundColor: connectionMode ? '#2563eb' : '#ffffff',
              color: connectionMode ? '#ffffff' : '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!connectionMode) {
                (e.target as HTMLElement).style.backgroundColor = '#f8fafc';
                (e.target as HTMLElement).style.borderColor = '#cbd5e1';
              }
            }}
            onMouseLeave={(e) => {
              if (!connectionMode) {
                (e.target as HTMLElement).style.backgroundColor = '#ffffff';
                (e.target as HTMLElement).style.borderColor = '#e2e8f0';
              }
            }}
            onClick={() => {
              setConnectionMode(!connectionMode);
              setFirstConnectionPoint(null);
              console.log('Connection mode:', !connectionMode);
            }}
            title={connectionMode ? '接続モードを終了' : '接続モードを開始'}
          >
            ⟷
            {firstConnectionPoint && (
              <div style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                width: '8px',
                height: '8px',
                backgroundColor: '#ef4444',
                borderRadius: '50%',
                border: '1px solid white'
              }} />
            )}
          </button>
        </div>
      </div>

      {/* Clean canvas info panel */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        backgroundColor: '#ffffff',
        color: '#64748b',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: '500',
        pointerEvents: 'none',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: '1px solid #e2e8f0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontWeight: '500', fontSize: '12px', color: '#0f172a' }}>
            キャンバス {stageSize.width} × {stageSize.height}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#64748b' }}>
          <span>{model.components.length} コンポーネント</span>
          <span>{model.connections.length} 接続</span>
        </div>
        
        {connectionMode && (
          <div style={{ 
            marginTop: '8px',
            padding: '6px 8px',
            backgroundColor: '#f1f5f9',
            borderRadius: '4px',
            color: '#2563eb',
            fontSize: '11px',
            fontWeight: '500'
          }}>
            {firstConnectionPoint ? '接続先を選択' : '接続元を選択'}
          </div>
        )}
        
        {connectionFeedback && (
          <div style={{ 
            marginTop: '8px',
            padding: '6px 8px',
            backgroundColor: connectionFeedback.includes('作成') ? '#f0fdf4' : '#fef2f2',
            borderRadius: '4px',
            color: connectionFeedback.includes('作成') ? '#16a34a' : '#dc2626',
            fontSize: '11px',
            fontWeight: '500'
          }}>
            {connectionFeedback}
          </div>
        )}
        
        {selectedComponentId && (
          <div style={{ 
            marginTop: '8px',
            padding: '6px 8px',
            backgroundColor: '#fefce8',
            borderRadius: '4px',
            color: '#ca8a04',
            fontSize: '11px',
            fontWeight: '500'
          }}>
            選択: {model.components.find(c => c.id === selectedComponentId)?.customName || 'コンポーネント'}
          </div>
        )}
      </div>


    </div>
  );
};

export default CanvasEditor;
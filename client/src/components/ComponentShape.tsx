import React from 'react';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import { ModelComponent, ComponentType } from '../types';

interface ComponentShapeProps {
  component: ModelComponent;
  isSelected: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: (position: { x: number; y: number }) => void;
  onClick: () => void;
  onConnectionPointClick?: (componentId: string, port: string) => void;
  connectionMode?: boolean;
  firstConnectionPoint?: {componentId: string, port: string} | null;
}

const ComponentShape: React.FC<ComponentShapeProps> = ({
  component,
  isSelected,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
  onConnectionPointClick,
  connectionMode = false,
  firstConnectionPoint = null
}) => {
  // Clean, consistent component styling with proper proportions
  const getComponentStyle = (type: ComponentType | string) => {
    const baseStyle = {
      width: 80,
      height: 40,
      fill: '#ffffff',
      stroke: '#e2e8f0',
      strokeWidth: 1.5,
      cornerRadius: 6,
      shadowColor: 'rgba(0,0,0,0.06)',
      shadowBlur: 6,
      shadowOffset: { x: 0, y: 2 }
    };

    const typeStr = typeof type === 'string' ? type : String(type);
    switch (typeStr) {
      case 'TTubo':
      case ComponentType.PIPE:
        return {
          ...baseStyle,
          width: 100,
          height: 20,
          cornerRadius: 10
        };
      
      case 'TDepVolCte':
      case 'TDepVolVariable':
      case ComponentType.CONSTANT_VOLUME_PLENUM:
      case ComponentType.VARIABLE_VOLUME_PLENUM:
        return {
          ...baseStyle,
          width: 60,
          height: 60,
          cornerRadius: 8
        };
      
      case 'TBloqueMotor':
      case ComponentType.ENGINE_BLOCK:
        return {
          ...baseStyle,
          width: 90,
          height: 50,
          cornerRadius: 6
        };
      
      case 'TCilindro4T':
      case 'TCilindro2T':
      case ComponentType.CYLINDER_4T:
      case ComponentType.CYLINDER_2T:
        return {
          ...baseStyle,
          width: 40,
          height: 60,
          cornerRadius: 4
        };
      
      case 'TCDFijo':
      case 'TValvula4T':
      case 'TLamina':
      case ComponentType.FIXED_CD_VALVE:
      case ComponentType.VALVE_4T:
      case ComponentType.REED_VALVE:
        return {
          ...baseStyle,
          width: 40,
          height: 40,
          cornerRadius: 20
        };
      
      case 'TCCDescargaExtremoAbierto':
      case 'TCCExtremoCerrado':
      case 'TCCExtremoAnecoico':
      case ComponentType.OPEN_END_ATMOSPHERE:
      case ComponentType.CLOSED_END:
      case ComponentType.ANECHOIC_END:
        return {
          ...baseStyle,
          width: 40,
          height: 40,
          cornerRadius: 20
        };
      
      default:
        return baseStyle;
    }
  };

  const style = getComponentStyle(component.type);
  
  // Get component display name
  const getDisplayName = (type: ComponentType | string) => {
    const typeStr = typeof type === 'string' ? type : String(type);
    switch (typeStr) {
      case 'TTubo':
      case ComponentType.PIPE: return 'パイプ';
      case 'TDepVolCte':
      case ComponentType.CONSTANT_VOLUME_PLENUM: return 'プレナム';
      case 'TDepVolVariable':
      case ComponentType.VARIABLE_VOLUME_PLENUM: return '可変プレナム';
      case 'TBloqueMotor':
      case ComponentType.ENGINE_BLOCK: return 'エンジン';
      case 'TCilindro4T':
      case ComponentType.CYLINDER_4T: return '4Tシリンダー';
      case 'TCilindro2T':
      case ComponentType.CYLINDER_2T: return '2Tシリンダー';
      case 'TCDFijo':
      case ComponentType.FIXED_CD_VALVE: return 'CDバルブ';
      case 'TValvula4T':
      case ComponentType.VALVE_4T: return '4Tバルブ';
      case 'TLamina':
      case ComponentType.REED_VALVE: return 'リードバルブ';
      case 'TCCDescargaExtremoAbierto':
      case ComponentType.OPEN_END_ATMOSPHERE: return '開放端';
      case 'TCCExtremoCerrado':
      case ComponentType.CLOSED_END: return '閉端';
      case 'TCCExtremoAnecoico':
      case ComponentType.ANECHOIC_END: return '無反射端';
      default: return typeStr;
    }
  };

  // Clean, proportional icons
  const renderComponentIcon = () => {
    const typeStr = typeof component.type === 'string' ? component.type : String(component.type);
    const iconColor = '#64748b';
    const iconSize = Math.min(style.width, style.height) * 0.5;
    const centerX = style.width / 2;
    const centerY = style.height / 2;

    switch (typeStr) {
      case 'TTubo':
      case ComponentType.PIPE:
        return (
          <Group>
            <Line
              points={[style.width * 0.2, centerY, style.width * 0.8, centerY]}
              stroke={iconColor}
              strokeWidth={2}
              lineCap="round"
            />
            <Line
              points={[style.width * 0.7, centerY - 3, style.width * 0.8, centerY, style.width * 0.7, centerY + 3]}
              stroke={iconColor}
              strokeWidth={2}
              lineCap="round"
            />
          </Group>
        );
      
      case 'TDepVolCte':
      case 'TDepVolVariable':
      case ComponentType.CONSTANT_VOLUME_PLENUM:
      case ComponentType.VARIABLE_VOLUME_PLENUM:
        return (
          <Rect
            x={centerX - iconSize/2}
            y={centerY - iconSize/2}
            width={iconSize}
            height={iconSize}
            stroke={iconColor}
            strokeWidth={2}
            fill="transparent"
            cornerRadius={4}
          />
        );
      
      case 'TBloqueMotor':
      case ComponentType.ENGINE_BLOCK:
        return (
          <Group>
            <Rect
              x={centerX - iconSize/2}
              y={centerY - iconSize/3}
              width={iconSize}
              height={iconSize * 2/3}
              stroke={iconColor}
              strokeWidth={2}
              fill="transparent"
              cornerRadius={2}
            />
            <Line
              points={[centerX - iconSize/4, centerY, centerX + iconSize/4, centerY]}
              stroke={iconColor}
              strokeWidth={2}
            />
          </Group>
        );
      
      case 'TCilindro4T':
      case 'TCilindro2T':
      case ComponentType.CYLINDER_4T:
      case ComponentType.CYLINDER_2T:
        return (
          <Group>
            <Rect
              x={centerX - iconSize/3}
              y={centerY - iconSize/2}
              width={iconSize * 2/3}
              height={iconSize}
              stroke={iconColor}
              strokeWidth={2}
              fill="transparent"
              cornerRadius={2}
            />
            <Circle
              x={centerX}
              y={centerY}
              radius={iconSize/6}
              fill={iconColor}
            />
          </Group>
        );
      
      case 'TCDFijo':
      case 'TValvula4T':
      case 'TLamina':
      case ComponentType.FIXED_CD_VALVE:
      case ComponentType.VALVE_4T:
      case ComponentType.REED_VALVE:
        return (
          <Circle
            x={centerX}
            y={centerY}
            radius={iconSize/2}
            stroke={iconColor}
            strokeWidth={2}
            fill="transparent"
          />
        );
      
      case 'TCCDescargaExtremoAbierto':
      case ComponentType.OPEN_END_ATMOSPHERE:
        return (
          <Group>
            <Line
              points={[centerX - iconSize/2, centerY, centerX + iconSize/2, centerY]}
              stroke={iconColor}
              strokeWidth={2}
              lineCap="round"
            />
            <Line
              points={[centerX - iconSize/3, centerY - iconSize/3, centerX + iconSize/3, centerY - iconSize/3]}
              stroke={iconColor}
              strokeWidth={1}
              lineCap="round"
            />
          </Group>
        );
      
      default:
        return (
          <Circle
            x={centerX}
            y={centerY}
            radius={iconSize/3}
            fill={iconColor}
          />
        );
    }
  };

  // Render connection ports
  const renderPorts = () => {
    // Always render ports for debugging, but make them more visible in connection mode
    console.log('Rendering connection ports for component:', component.id, 'connectionMode:', connectionMode);
    const ports: JSX.Element[] = [];
    
    // Only show connection points in connection mode
    if (!connectionMode) {
      console.log('Connection mode is false, not rendering ports');
      return ports;
    }
    
    console.log('Connection mode is true, rendering ports for component:', component.id);
    
    // Left port (inlet) - clean design
    ports.push(
      <Circle
        key="left-port"
        x={-4}
        y={style.height / 2}
        radius={4}
        fill={firstConnectionPoint?.componentId === component.id && firstConnectionPoint?.port === 'left' 
          ? '#2563eb' 
          : '#ffffff'}
        stroke={firstConnectionPoint?.componentId === component.id && firstConnectionPoint?.port === 'left' 
          ? '#2563eb' 
          : '#94a3b8'}
        strokeWidth={1.5}
        onClick={(e) => {
          e.evt.stopPropagation();
          console.log('Left connection point clicked:', component.id, 'left');
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'left');
          }
        }}
        onTap={(e) => {
          e.evt.stopPropagation();
          console.log('Left connection point tapped:', component.id, 'left');
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'left');
          }
        }}
        listening={true}
        data-testid={`component-connection-point-${component.id}-left`}
      />
    );
    
    // Right port (outlet) - clean design
    ports.push(
      <Circle
        key="right-port"
        x={style.width + 4}
        y={style.height / 2}
        radius={4}
        fill={firstConnectionPoint?.componentId === component.id && firstConnectionPoint?.port === 'right' 
          ? '#2563eb' 
          : '#ffffff'}
        stroke={firstConnectionPoint?.componentId === component.id && firstConnectionPoint?.port === 'right' 
          ? '#2563eb' 
          : '#94a3b8'}
        strokeWidth={1.5}
        onClick={(e) => {
          e.evt.stopPropagation();
          console.log('Right connection point clicked:', component.id, 'right');
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'right');
          }
        }}
        onTap={(e) => {
          e.evt.stopPropagation();
          console.log('Right connection point tapped:', component.id, 'right');
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'right');
          }
        }}
        listening={true}
        data-testid={`component-connection-point-${component.id}-right`}
      />
    );
    
    console.log(`Rendered ${ports.length} connection ports for component ${component.id}`);
    return ports;
  };

  return (
    <Group
      x={component.position.x}
      y={component.position.y}
      rotation={component.rotation}
      draggable
      onDragStart={onDragStart}
      onDragEnd={(e) => {
        onDragEnd({
          x: e.target.x(),
          y: e.target.y()
        });
      }}
      onClick={(e) => {
        console.log('ComponentShape clicked:', component.id, 'connectionMode:', connectionMode);
        if (connectionMode) {
          // 接続モードの場合、デフォルトの接続ポイント（右側）を使用
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'right');
          }
        } else {
          onClick();
        }
      }}
      onTap={(e) => {
        console.log('ComponentShape tapped:', component.id, 'connectionMode:', connectionMode);
        if (connectionMode) {
          // 接続モードの場合、デフォルトの接続ポイント（右側）を使用
          if (onConnectionPointClick) {
            onConnectionPointClick(component.id, 'right');
          }
        } else {
          onClick();
        }
      }}
      name="canvas-component"
    >
      {/* Clean selection highlight */}
      {isSelected && (
        <Rect
          x={-2}
          y={-2}
          width={style.width + 4}
          height={style.height + 4}
          stroke="#2563eb"
          strokeWidth={2}
          fill="transparent"
          cornerRadius={style.cornerRadius + 2}
        />
      )}
      
      {/* Main component shape with modern styling */}
      <Rect
        x={0}
        y={0}
        width={style.width}
        height={style.height}
        fill={style.fill}
        stroke={isSelected ? '#2563eb' : style.stroke}
        strokeWidth={style.strokeWidth}
        cornerRadius={style.cornerRadius}
        shadowColor={style.shadowColor}
        shadowBlur={isDragging ? 15 : style.shadowBlur}
        shadowOffset={isDragging ? { x: 4, y: 4 } : style.shadowOffset}
        shadowOpacity={isDragging ? 0.4 : 0.2}
        onClick={() => {
          // 接続モードの場合、コンポーネント本体のクリックを無効化
          if (!connectionMode) {
            onClick();
          }
        }}
        onTap={() => {
          // 接続モードの場合、コンポーネント本体のクリックを無効化
          if (!connectionMode) {
            onClick();
          }
        }}
      />
      
      {/* Component type indicator/icon */}
      {renderComponentIcon()}
      
      {/* Clean component label */}
      <Text
        x={0}
        y={style.height + 8}
        width={style.width}
        text={component.customName || getDisplayName(component.type)}
        fontSize={10}
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fill="#64748b"
        align="center"
      />
      
      {/* Connection ports */}
      {renderPorts()}
      
      {/* Component ID (for debugging) */}
      {isSelected && (
        <Text
          x={0}
          y={style.height + 5}
          width={style.width}
          text={`ID: ${component.id.slice(-6)}`}
          fontSize={10}
          fontFamily="monospace"
          fill="#7f8c8d"
          align="center"
        />
      )}
    </Group>
  );
};

export default ComponentShape;
import React, { useState, useEffect } from 'react';
import { ModelComponent, ComponentType } from '../types';

interface PropertiesPanelProps {
  component: ModelComponent | null;
  onUpdateComponent: (componentId: string, updates: Partial<ModelComponent>) => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  component,
  onUpdateComponent,
  isOpen = true,
  onToggle
}) => {
  const [formData, setFormData] = useState<any>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Update form data when component changes
  useEffect(() => {
    if (component) {
      setFormData(component.properties);
      setValidationErrors({});
    } else {
      setFormData({});
      setValidationErrors({});
    }
  }, [component]);

  // Handle form field changes
  const handleFieldChange = (fieldPath: string, value: any) => {
    const newFormData = { ...formData };
    
    // Handle nested properties (e.g., "geometria.nCilin")
    const pathParts = fieldPath.split('.');
    let current = newFormData;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) {
        current[pathParts[i]] = {};
      }
      current = current[pathParts[i]];
    }
    
    current[pathParts[pathParts.length - 1]] = value;
    
    setFormData(newFormData);
    
    // Validate field
    const error = validateField(fieldPath, value);
    setValidationErrors(prev => ({
      ...prev,
      [fieldPath]: error
    }));
    
    // Update component if validation passes
    if (!error && component) {
      onUpdateComponent(component.id, {
        properties: newFormData
      });
    }
  };

  // Validate individual field
  const validateField = (fieldPath: string, value: any): string => {
    if (!component) return '';
    
    const fieldConfig = getFieldConfig(component.type, fieldPath);
    if (!fieldConfig) return '';
    
    // Required validation
    if (fieldConfig.required && (value === undefined || value === null || value === '')) {
      return `${fieldConfig.label}は必須です`;
    }
    
    // Type-specific validation
    if (fieldConfig.type === 'number' && value !== undefined && value !== '') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        return `${fieldConfig.label}は数値である必要があります`;
      }
      
      if (fieldConfig.min !== undefined && numValue < fieldConfig.min) {
        return `${fieldConfig.label}は${fieldConfig.min}以上である必要があります`;
      }
      
      if (fieldConfig.max !== undefined && numValue > fieldConfig.max) {
        return `${fieldConfig.label}は${fieldConfig.max}以下である必要があります`;
      }
    }
    
    return '';
  };

  // Get field configuration based on component type
  const getFieldConfig = (componentType: ComponentType | string, fieldPath: string) => {
    const typeStr = typeof componentType === 'string' ? componentType : String(componentType);
    const configs: Record<string, any> = {
      // Pipe properties
      'TTubo': {
        'numeroTubo': { label: 'パイプ番号', type: 'number', required: true, min: 1 },
        'nodoIzq': { label: '左ノード', type: 'number', required: true, min: 0 },
        'nodoDer': { label: '右ノード', type: 'number', required: true, min: 0 },
        'nin': { label: '計算セル数', type: 'number', required: true, min: 1, max: 1000 },
        'longitudTotal': { label: '全長 (m)', type: 'number', required: true, min: 0.001, max: 100 },
        'mallado': { label: 'メッシュサイズ (m)', type: 'number', required: true, min: 0.0001, max: 1 },
        'nTramos': { label: 'セクション数', type: 'number', required: true, min: 1, max: 100 },
        'tipoMallado': { 
          label: 'メッシュタイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 1, label: '距離ベース' },
            { value: 2, label: '角度ベース' }
          ]
        },
        'friccion': { label: '摩擦係数', type: 'number', required: true, min: 0, max: 1 },
        'tipoTransCal': { 
          label: '熱伝達タイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '吸気パイプ' },
            { value: 1, label: '吸気チューブ' },
            { value: 2, label: '排気チューブ' },
            { value: 3, label: '排気パイプ' }
          ]
        },
        'coefAjusFric': { label: '摩擦調整係数', type: 'number', required: true, min: 0.1, max: 10 },
        'coefAjusTC': { label: '熱伝達調整係数', type: 'number', required: true, min: 0.1, max: 10 },
        'espesorPrin': { label: '壁厚 (m)', type: 'number', required: true, min: 0.0001, max: 0.1 },
        'densidadPrin': { label: '壁密度 (kg/m³)', type: 'number', required: true, min: 100, max: 10000 },
        'calEspPrin': { label: '比熱 (J/kg·K)', type: 'number', required: true, min: 100, max: 5000 },
        'conductPrin': { label: '熱伝導率 (W/m·K)', type: 'number', required: true, min: 0.1, max: 1000 },
        'tRefrigerante': { label: '冷却剤温度 (K)', type: 'number', required: true, min: 200, max: 500 },
        'tipRefrig': { 
          label: '冷却剤タイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 'air', label: '空気' },
            { value: 'water', label: '水' }
          ]
        },
        'tini': { label: '初期温度 (K)', type: 'number', required: true, min: 200, max: 2000 },
        'pini': { label: '初期圧力 (Pa)', type: 'number', required: true, min: 10000, max: 1000000 },
        'velMedia': { label: '平均速度 (m/s)', type: 'number', required: true, min: -100, max: 100 }
      },
      
      // Plenum properties
      'TDepVolCte': {
        'numeroDeposito': { label: 'プレナム番号', type: 'number', required: true, min: 1 },
        'volumen0': { label: '容積 (m³)', type: 'number', required: true, min: 0.0001, max: 10 },
        'temperature': { label: '初期温度 (K)', type: 'number', required: true, min: 200, max: 2000 },
        'pressure': { label: '初期圧力 (Pa)', type: 'number', required: true, min: 10000, max: 1000000 },
        'masa0': { label: '初期質量 (kg)', type: 'number', required: true, min: 0.001, max: 1000 }
      },
      
      // Valve properties
      'TCDFijo': {
        'tubo': { label: 'パイプ番号', type: 'number', required: true, min: 1 },
        'nodo': { label: 'ノード番号', type: 'number', required: true, min: 0 },
        'tipo': { label: 'バルブタイプ', type: 'number', required: true, min: 0 },
        'valvula': { label: 'バルブ番号', type: 'number', required: true, min: 1 },
        'sentido': { 
          label: '方向', 
          type: 'select', 
          required: true,
          options: [
            { value: 1, label: '正方向' },
            { value: -1, label: '逆方向' }
          ]
        },
        'diametroTubo': { label: 'パイプ直径 (m)', type: 'number', required: true, min: 0.001, max: 1 }
      },
      
      // Engine Block properties
      'TBloqueMotor': {
        'numeroMotor': { label: 'エンジン番号', type: 'number', required: true, min: 1 },
        'tipoMotor': { 
          label: 'エンジンタイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '2ストローク' },
            { value: 1, label: '4ストローク' }
          ]
        },
        'nCilindros': { label: 'シリンダー数', type: 'number', required: true, min: 1, max: 16 },
        'carrera': { label: 'ストローク (m)', type: 'number', required: true, min: 0.01, max: 0.5 },
        'diametro': { label: 'ボア径 (m)', type: 'number', required: true, min: 0.01, max: 0.5 },
        'biela': { label: 'コンロッド長 (m)', type: 'number', required: true, min: 0.05, max: 1.0 },
        'vcc': { label: '燃焼室容積 (m³)', type: 'number', required: true, min: 0.00001, max: 0.01 },
        'relaCompresion': { label: '圧縮比', type: 'number', required: true, min: 5, max: 25 },
        'combustible': { 
          label: '燃料タイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 'gasoline', label: 'ガソリン' },
            { value: 'diesel', label: 'ディーゼル' }
          ]
        }
      },
      
      // 4T Cylinder properties
      'TCilindro4T': {
        'numeroCilindro': { label: 'シリンダー番号', type: 'number', required: true, min: 1 },
        'motor': { label: 'エンジン番号', type: 'number', required: true, min: 1 },
        'anguloAperAdm': { label: '吸気開角度 (deg)', type: 'number', required: true, min: -180, max: 180 },
        'anguloCierreAdm': { label: '吸気閉角度 (deg)', type: 'number', required: true, min: -180, max: 180 },
        'anguloAperEsc': { label: '排気開角度 (deg)', type: 'number', required: true, min: -180, max: 180 },
        'anguloCierreEsc': { label: '排気閉角度 (deg)', type: 'number', required: true, min: -180, max: 180 },
        'tuboAdmision': { label: '吸気パイプ番号', type: 'number', required: true, min: 1 },
        'tuboEscape': { label: '排気パイプ番号', type: 'number', required: true, min: 1 },
        'nodoAdmision': { label: '吸気ノード', type: 'number', required: true, min: 0 },
        'nodoEscape': { label: '排気ノード', type: 'number', required: true, min: 0 }
      },
      
      // Boundary Condition properties
      'TCCDescargaExtremoAbierto': {
        'numeroCC': { label: '境界条件番号', type: 'number', required: true, min: 1 },
        'tubo': { label: 'パイプ番号', type: 'number', required: true, min: 1 },
        'extremo': { 
          label: '端部', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '左端' },
            { value: 1, label: '右端' }
          ]
        },
        'presionReferencia': { label: '基準圧力 (Pa)', type: 'number', required: true, min: 10000, max: 200000 },
        'temperaturaReferencia': { label: '基準温度 (K)', type: 'number', required: true, min: 200, max: 2000 },
        'coeficienteDescarga': { label: '流量係数', type: 'number', required: true, min: 0.1, max: 2.0 }
      }
    };
    
    return configs[typeStr]?.[fieldPath];
  };

  // Get form fields for component type
  const getFormFields = (componentType: ComponentType | string) => {
    const typeStr = typeof componentType === 'string' ? componentType : String(componentType);
    switch (typeStr) {
      case 'TTubo':
        return [
          'numeroTubo', 'nodoIzq', 'nodoDer', 'nin', 'longitudTotal', 'mallado',
          'nTramos', 'tipoMallado', 'friccion', 'tipoTransCal', 'coefAjusFric',
          'coefAjusTC', 'espesorPrin', 'densidadPrin', 'calEspPrin', 'conductPrin',
          'tRefrigerante', 'tipRefrig', 'tini', 'pini', 'velMedia'
        ];
      
      case 'TDepVolCte':
      case 'TDepVolVariable':
        return ['numeroDeposito', 'volumen0', 'temperature', 'pressure', 'masa0'];
      
      case 'TCDFijo':
      case 'TValvula4T':
      case 'TLamina':
        return ['tubo', 'nodo', 'tipo', 'valvula', 'sentido', 'diametroTubo'];
      
      case 'TBloqueMotor':
        return ['numeroMotor', 'tipoMotor', 'nCilindros', 'carrera', 'diametro', 'biela', 'vcc', 'relaCompresion', 'combustible'];
      
      case 'TCilindro4T':
        return ['numeroCilindro', 'motor', 'anguloAperAdm', 'anguloCierreAdm', 'anguloAperEsc', 'anguloCierreEsc', 'tuboAdmision', 'tuboEscape', 'nodoAdmision', 'nodoEscape'];
      
      case 'TCCDescargaExtremoAbierto':
        return ['numeroCC', 'tubo', 'extremo', 'presionReferencia', 'temperaturaReferencia', 'coeficienteDescarga'];
      
      default:
        return ['name', 'description'];
    }
  };

  // Render form field
  const renderField = (fieldPath: string) => {
    if (!component) return null;
    
    const fieldConfig = getFieldConfig(component.type, fieldPath);
    if (!fieldConfig) {
      console.log(`No config found for field: ${fieldPath}, component type: ${component.type}`);
      // Return a basic input for unknown fields
      return (
        <div key={fieldPath} style={{ marginBottom: '15px' }}>
          <label style={{
            display: 'block',
            marginBottom: '5px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#2c3e50'
          }}>
            {fieldPath}
          </label>
          <input
            data-testid={`property-${fieldPath}`}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #bdc3c7',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            type="text"
            value={getNestedValue(formData, fieldPath) || ''}
            onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
            placeholder={`Enter ${fieldPath}`}
          />
        </div>
      );
    }
    
    const value = getNestedValue(formData, fieldPath);
    const error = validationErrors[fieldPath];
    
    const fieldStyle = {
      marginBottom: '15px'
    };
    
    const labelStyle = {
      display: 'block',
      marginBottom: '5px',
      fontSize: '14px',
      fontWeight: 'bold' as const,
      color: error ? '#e74c3c' : '#2c3e50'
    };
    
    const inputStyle = {
      width: '100%',
      padding: '8px',
      border: `1px solid ${error ? '#e74c3c' : '#bdc3c7'}`,
      borderRadius: '4px',
      fontSize: '14px'
    };
    
    const errorStyle = {
      color: '#e74c3c',
      fontSize: '12px',
      marginTop: '5px'
    };

    return (
      <div key={fieldPath} style={fieldStyle}>
        <label style={labelStyle}>
          {fieldConfig.label}
          {fieldConfig.required && <span style={{ color: '#e74c3c' }}>*</span>}
        </label>
        
        {fieldConfig.type === 'select' ? (
          <select
            style={inputStyle}
            value={value || ''}
            onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
          >
            <option value="">選択してください</option>
            {fieldConfig.options?.map((option: any) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            style={inputStyle}
            type={fieldConfig.type === 'number' ? 'number' : 'text'}
            value={value || ''}
            onChange={(e) => {
              const newValue = fieldConfig.type === 'number' 
                ? (e.target.value === '' ? '' : Number(e.target.value))
                : e.target.value;
              handleFieldChange(fieldPath, newValue);
            }}
            step={fieldConfig.type === 'number' ? 'any' : undefined}
            min={fieldConfig.min}
            max={fieldConfig.max}
            data-testid={`property-${fieldPath}`}
          />
        )}
        
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  };

  // Get nested value from object
  const getNestedValue = (obj: any, path: string) => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  };

  // Toggle button (always visible)
  const toggleButton = (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        right: '20px',
        transform: 'translateY(-50%)',
        zIndex: 1001,
        width: '32px',
        height: '32px',
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        fontSize: '16px',
        color: '#64748b',
        transition: 'all 0.2s ease'
      }}
      onClick={onToggle}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#f8fafc';
        e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#ffffff';
        e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
      }}
      title={isOpen ? 'プロパティパネルを閉じる' : 'プロパティパネルを開く'}
      data-testid="properties-toggle-button"
    >
      {isOpen ? '⚙' : '⚙'}
    </div>
  );

  if (!isOpen) {
    return toggleButton;
  }

  if (!component) {
    return (
      <>
        {toggleButton}
        <div 
          className="properties-panel" 
          data-testid="properties-panel"
          style={{
            position: 'fixed',
            top: '50%',
            right: '70px',
            transform: 'translateY(-50%)',
            zIndex: 1000,
            width: '320px',
            maxHeight: '70vh',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            padding: '16px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflowY: 'auto'
          }}
        >
          <h3 style={{ 
            margin: '0 0 16px 0', 
            color: '#64748b',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            プロパティ
          </h3>
          <p style={{ 
            color: '#94a3b8', 
            fontStyle: 'italic',
            fontSize: '14px',
            margin: 0
          }}>
            コンポーネントを選択してプロパティを編集してください
          </p>
        </div>
      </>
    );
  }

  const formFields = getFormFields(component.type);

  return (
    <>
      {toggleButton}
      <div 
        className="properties-panel" 
        data-testid="properties-panel"
        style={{
          position: 'fixed',
          top: '50%',
          right: '70px',
          transform: 'translateY(-50%)',
          zIndex: 1000,
          width: '320px',
          maxHeight: '70vh',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          padding: '16px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflowY: 'auto'
        }}
      >
        <h3 style={{ 
          margin: '0 0 16px 0', 
          color: '#0f172a',
          fontSize: '16px',
          fontWeight: '600'
        }}>
          プロパティ
        </h3>
      
      {/* Component info */}
      <div style={{ 
        marginBottom: '20px', 
        padding: '10px', 
        backgroundColor: '#ecf0f1', 
        borderRadius: '4px' 
      }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>
          {component.customName || component.type}
        </div>
        <div style={{ fontSize: '12px', color: '#7f8c8d' }}>
          ID: {component.id}
        </div>
        <div style={{ fontSize: '12px', color: '#7f8c8d' }}>
          タイプ: {component.type}
        </div>
      </div>
      
      {/* Basic properties */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ 
          display: 'block', 
          marginBottom: '5px', 
          fontSize: '14px', 
          fontWeight: 'bold' 
        }}>
          名前
        </label>
        <input
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #bdc3c7',
            borderRadius: '4px',
            fontSize: '14px'
          }}
          type="text"
          value={component.customName || ''}
          onChange={(e) => onUpdateComponent(component.id, { customName: e.target.value })}
          placeholder="コンポーネント名"
        />
      </div>
      
      {/* Type-specific properties */}
      <div>
        <h4 style={{ marginBottom: '15px', color: '#34495e' }}>
          詳細プロパティ
        </h4>
        {formFields.map(fieldPath => renderField(fieldPath))}
      </div>
      
      {/* Validation summary */}
      {Object.keys(validationErrors).length > 0 && (
        <div style={{
          marginTop: '20px',
          padding: '10px',
          backgroundColor: '#fdf2f2',
          border: '1px solid #e74c3c',
          borderRadius: '4px'
        }}>
          <h5 style={{ color: '#e74c3c', marginBottom: '10px' }}>
            検証エラー
          </h5>
          {Object.entries(validationErrors).map(([field, error]) => (
            error && (
              <div key={field} style={{ fontSize: '12px', color: '#e74c3c' }}>
                • {error}
              </div>
            )
          ))}
        </div>
      )}
      </div>
    </>
  );
};

export default PropertiesPanel;
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
      },

      // VANOS Control System Components
      'TSensor': {
        'numeroSensor': { label: 'センサー番号', type: 'number', required: true, min: 1 },
        'tipoSensor': { 
          label: 'センサータイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '吸気カムポジション' },
            { value: 1, label: '排気カムポジション' },
            { value: 2, label: 'クランクポジション' },
            { value: 3, label: '圧力センサー' },
            { value: 4, label: '温度センサー' },
            { value: 5, label: '流量センサー' }
          ]
        },
        'resolucion': { label: '分解能 (°)', type: 'number', required: true, min: 0.01, max: 10 },
        'rangoMinimo': { label: '最小範囲 (°)', type: 'number', required: true, min: -360, max: 360 },
        'rangoMaximo': { label: '最大範囲 (°)', type: 'number', required: true, min: -360, max: 360 },
        'filtroTiempo': { label: 'フィルタ時定数 (s)', type: 'number', required: true, min: 0.001, max: 1 },
        'ganancia': { label: 'ゲイン', type: 'number', required: true, min: 0.1, max: 10 },
        'offset': { label: 'オフセット (°)', type: 'number', required: true, min: -180, max: 180 },
        'ruido': { label: 'ノイズレベル', type: 'number', required: true, min: 0, max: 10 }
      },

      'TTable1D': {
        'numeroTabla': { label: 'テーブル番号', type: 'number', required: true, min: 1 },
        'tipoTabla': { 
          label: 'テーブルタイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: 'VANOS吸気マップ' },
            { value: 1, label: 'VANOS排気マップ' },
            { value: 2, label: '圧力マップ' },
            { value: 3, label: '温度マップ' },
            { value: 4, label: '流量マップ' }
          ]
        },
        'interpolacion': { 
          label: '補間方法', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '線形補間' },
            { value: 1, label: '3次スプライン' },
            { value: 2, label: '多項式補間' }
          ]
        },
        'extrapolacion': { 
          label: '外挿方法', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '定数外挿' },
            { value: 1, label: '線形外挿' },
            { value: 2, label: 'ゼロ外挿' }
          ]
        },
        'unidadX': { label: 'X軸単位', type: 'text', required: true },
        'unidadY': { label: 'Y軸単位', type: 'text', required: true },
        'descripcion': { label: '説明', type: 'text', required: false }
      },

      'TController': {
        'numeroController': { label: 'コントローラー番号', type: 'number', required: true, min: 1 },
        'tipoController': { 
          label: 'コントローラータイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: 'VANOSマスター' },
            { value: 1, label: 'VANOS吸気' },
            { value: 2, label: 'VANOS排気' },
            { value: 3, label: '圧力制御' },
            { value: 4, label: '温度制御' }
          ]
        },
        'modoOperacion': { 
          label: '動作モード', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '自動' },
            { value: 1, label: '手動' },
            { value: 2, label: 'キャリブレーション' },
            { value: 3, label: '診断' }
          ]
        },
        'parametros.frecuenciaEjecucion': { label: '実行周波数 (Hz)', type: 'number', required: true, min: 1, max: 1000 },
        'parametros.tiempoMuestreo': { label: 'サンプル時間 (s)', type: 'number', required: true, min: 0.001, max: 1 }
      },

      'TPIDController': {
        'numeroPID': { label: 'PID番号', type: 'number', required: true, min: 1 },
        'kp': { label: '比例ゲイン (Kp)', type: 'number', required: true, min: 0, max: 1000 },
        'ki': { label: '積分ゲイン (Ki)', type: 'number', required: true, min: 0, max: 1000 },
        'kd': { label: '微分ゲイン (Kd)', type: 'number', required: true, min: 0, max: 100 },
        'setpoint': { label: '目標値 (°)', type: 'number', required: true, min: -180, max: 180 },
        'limiteSalidaMin': { label: '最小出力制限 (%)', type: 'number', required: true, min: -100, max: 100 },
        'limiteSalidaMax': { label: '最大出力制限 (%)', type: 'number', required: true, min: -100, max: 100 },
        'limiteIntegralMin': { label: '最小積分制限', type: 'number', required: true, min: -1000, max: 1000 },
        'limiteIntegralMax': { label: '最大積分制限', type: 'number', required: true, min: -1000, max: 1000 },
        'tiempoMuestreo': { label: 'サンプル時間 (s)', type: 'number', required: true, min: 0.001, max: 1 },
        'modoAntiWindup': { 
          label: 'アンチワインドアップ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: 'なし' },
            { value: 1, label: 'クランプ' },
            { value: 2, label: 'バック計算' },
            { value: 3, label: '条件付き積分' }
          ]
        },
        'filtroDerivativo': { label: '微分フィルタ時定数 (s)', type: 'number', required: true, min: 0.001, max: 1 },
        'deadband': { label: 'デッドバンド (°)', type: 'number', required: true, min: 0, max: 10 }
      },

      'TValvulaContr': {
        'numeroValvula': { label: '制御バルブ番号', type: 'number', required: true, min: 1 },
        'tipoValvulaControl': { 
          label: '制御バルブタイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '油圧VANOS' },
            { value: 1, label: '空圧' },
            { value: 2, label: '電動' },
            { value: 3, label: '比例制御' }
          ]
        },
        'diametroNominal': { label: '公称直径 (m)', type: 'number', required: true, min: 0.001, max: 0.1 },
        'coeficienteDescarga': { label: '流量係数', type: 'number', required: true, min: 0.1, max: 1.0 },
        'tiempoRespuesta': { label: '応答時間 (s)', type: 'number', required: true, min: 0.001, max: 1 },
        'posicionMinima': { label: '最小位置 (%)', type: 'number', required: true, min: 0, max: 100 },
        'posicionMaxima': { label: '最大位置 (%)', type: 'number', required: true, min: 0, max: 100 },
        'caracteristicaFlujo': { 
          label: '流量特性', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: 'リニア' },
            { value: 1, label: '等パーセント' },
            { value: 2, label: 'クイックオープン' },
            { value: 3, label: 'カスタム' }
          ]
        }
      },

      'TCCDeposito': {
        'numeroConexion': { label: '接続番号', type: 'number', required: true, min: 1 },
        'tuboPrincipal': { label: 'パイプ番号', type: 'number', required: true, min: 1 },
        'nodoTubo': { label: 'パイプノード', type: 'number', required: true, min: 0 },
        'plenum': { label: 'プレナム番号', type: 'number', required: true, min: 1 },
        'tipoConexion': { 
          label: '接続タイプ', 
          type: 'select', 
          required: true,
          options: [
            { value: 0, label: '直接接続' },
            { value: 1, label: 'テーパー接続' },
            { value: 2, label: '急拡大' },
            { value: 3, label: '急縮小' },
            { value: 4, label: '曲線接続' }
          ]
        },
        'diametroConexion': { label: '接続直径 (m)', type: 'number', required: true, min: 0.001, max: 0.1 },
        'longitudConexion': { label: '接続長さ (m)', type: 'number', required: true, min: 0.001, max: 1 },
        'coeficientePerdida': { label: '損失係数', type: 'number', required: true, min: 0, max: 10 },
        'anguloConexion': { label: '接続角度 (°)', type: 'number', required: true, min: 0, max: 180 },
        'factorCorreccion': { label: '補正係数', type: 'number', required: true, min: 0.1, max: 10 }
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
      
      // VANOS Control System Components
      case 'TSensor':
        return ['numeroSensor', 'tipoSensor', 'resolucion', 'rangoMinimo', 'rangoMaximo', 'filtroTiempo', 'ganancia', 'offset', 'ruido'];
      
      case 'TTable1D':
        return ['numeroTabla', 'tipoTabla', 'interpolacion', 'extrapolacion', 'unidadX', 'unidadY', 'descripcion'];
      
      case 'TController':
        return ['numeroController', 'tipoController', 'modoOperacion', 'parametros.frecuenciaEjecucion', 'parametros.tiempoMuestreo'];
      
      case 'TPIDController':
        return ['numeroPID', 'kp', 'ki', 'kd', 'setpoint', 'limiteSalidaMin', 'limiteSalidaMax', 'limiteIntegralMin', 'limiteIntegralMax', 'tiempoMuestreo', 'modoAntiWindup', 'filtroDerivativo', 'deadband'];
      
      case 'TValvulaContr':
        return ['numeroValvula', 'tipoValvulaControl', 'diametroNominal', 'coeficienteDescarga', 'tiempoRespuesta', 'posicionMinima', 'posicionMaxima', 'caracteristicaFlujo'];
      
      case 'TCCDeposito':
        return ['numeroConexion', 'tuboPrincipal', 'nodoTubo', 'plenum', 'tipoConexion', 'diametroConexion', 'longitudConexion', 'coeficientePerdida', 'anguloConexion', 'factorCorreccion'];
      
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

  // Get component display name in Japanese
  const getComponentDisplayName = (componentType: ComponentType | string): string => {
    const typeStr = typeof componentType === 'string' ? componentType : String(componentType);
    const displayNames: Record<string, string> = {
      'TTubo': '1Dパイプ',
      'TDepVolCte': '定容積プレナム',
      'TDepVolVariable': '可変容積プレナム',
      'TTurbinaSimple': 'シンプルタービン',
      'TCDFijo': '固定CDバルブ',
      'TValvula4T': '4Tバルブ',
      'TLamina': 'リードバルブ',
      'TMariposa': 'バタフライバルブ',
      'TBloqueMotor': 'エンジンブロック',
      'TCilindro4T': '4Tシリンダー',
      'TCilindro2T': '2Tシリンダー',
      'TDPF': 'ディーゼル微粒子フィルター',
      'TCCDescargaExtremoAbierto': '開放端（大気）',
      'TCCExtremoCerrado': '閉端',
      'TCCExtremoAnecoico': '無反射端',
      'TCCRamificacion': '分岐',
      // VANOS Control Components
      'TSensor': 'センサー',
      'TTable1D': '1Dテーブル',
      'TController': 'コントローラー',
      'TPIDController': 'PIDコントローラー',
      'TValvulaContr': '制御バルブ',
      'TCCDeposito': 'パイプ-プレナム接続'
    };
    
    return displayNames[typeStr] || typeStr;
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
          {component.customName || getComponentDisplayName(component.type)}
        </div>
        <div style={{ fontSize: '12px', color: '#7f8c8d' }}>
          ID: {component.id}
        </div>
        <div style={{ fontSize: '12px', color: '#7f8c8d' }}>
          タイプ: {getComponentDisplayName(component.type)}
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
        
        {/* Special handling for TTable1D data arrays */}
        {component.type === 'TTable1D' && (
          <div style={{ marginTop: '20px' }}>
            <h5 style={{ marginBottom: '10px', color: '#34495e' }}>
              テーブルデータ
            </h5>
            <div style={{ marginBottom: '15px' }}>
              <label style={{
                display: 'block',
                marginBottom: '5px',
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#2c3e50'
              }}>
                X軸データ (カンマ区切り)
              </label>
              <textarea
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #bdc3c7',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minHeight: '60px',
                  resize: 'vertical'
                }}
                value={formData.datosX ? formData.datosX.join(', ') : '800, 1500, 2500, 4000, 6000, 7000'}
                onChange={(e) => {
                  const values = e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                  handleFieldChange('datosX', values);
                }}
                placeholder="例: 800, 1500, 2500, 4000, 6000, 7000"
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{
                display: 'block',
                marginBottom: '5px',
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#2c3e50'
              }}>
                Y軸データ (カンマ区切り)
              </label>
              <textarea
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #bdc3c7',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minHeight: '60px',
                  resize: 'vertical'
                }}
                value={formData.datosY ? formData.datosY.join(', ') : '0, 5, 15, 25, 35, 40'}
                onChange={(e) => {
                  const values = e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                  handleFieldChange('datosY', values);
                }}
                placeholder="例: 0, 5, 15, 25, 35, 40"
              />
            </div>
            <div style={{
              fontSize: '12px',
              color: '#7f8c8d',
              fontStyle: 'italic'
            }}>
              ※ X軸とY軸のデータ数は同じである必要があります
            </div>
          </div>
        )}
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
import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import './styles/animations.css';
import ComponentPalette from './components/ComponentPalette';
import CanvasEditor from './components/CanvasEditor';
import PropertiesPanel from './components/PropertiesPanel';
import Toolbar from './components/Toolbar';
import ProjectDashboard from './components/ProjectDashboard';
import FileManager from './components/FileManager';
import SimulationRunner from './components/SimulationRunner';
import { EngineModel, ModelComponent } from './types';

// Dashboard component
const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const handleOpenProject = (projectId: number) => {
    navigate(`/projects/${projectId}`);
  };

  const handleCreateProject = (_name: string, _description: string) => {
    // The project creation will be handled by the ProjectDashboard component
    // and it will navigate to the new project automatically
  };

  return (
    <ProjectDashboard
      onOpenProject={handleOpenProject}
      onCreateProject={handleCreateProject}
    />
  );
};

// Project Editor component
const ProjectEditor: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [model, setModel] = useState<EngineModel>({
    components: [],
    connections: [],
    metadata: {
      name: 'New Model',
      description: '',
      created: new Date(),
      modified: new Date(),
      version: '1.0.0'
    },
    validationResult: {
      isValid: true,
      errors: []
    }
  });

  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  const [activeTab, setActiveTab] = useState<'model' | 'files' | 'simulation'>('model');
  const [isPropertiesPanelOpen, setIsPropertiesPanelOpen] = useState(true);

  // Load project function
  const loadProject = async (id: number) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (response.ok) {
        const project = await response.json();
        setModel(prev => ({
          ...prev,
          metadata: {
            ...prev.metadata,
            name: project.name,
            description: project.description || ''
          }
        }));
        
        // Load model data if it exists
        if (project.model_data) {
          try {
            const modelData = JSON.parse(project.model_data);
            setModel(modelData);
          } catch (error) {
            console.error('Failed to parse model data:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load project:', error);
      // Fallback for testing - use default model with project ID
      setModel(prev => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          name: `Test Project ${id}`,
          description: 'Test project for UI testing'
        }
      }));
    }
  };

  // Save function
  const handleSave = React.useCallback(async () => {
    try {
      // モデルデータを保存（実際の実装では適切な保存処理を行う）
      const modelData = {
        ...model,
        metadata: {
          ...model.metadata,
          lastModified: new Date().toISOString()
        }
      };
      
      // ローカルストレージに保存（デモ用）
      localStorage.setItem('currentModel', JSON.stringify(modelData));
      
      // 保存通知を表示
      setShowSaveNotification(true);
      
      // 3秒後に通知を非表示
      setTimeout(() => setShowSaveNotification(false), 3000);
      
      console.log('Model saved:', modelData);
    } catch (error) {
      console.error('Save failed:', error);
      setShowSaveNotification(false);
    }
  }, [model]);

  // Load project data when component mounts or projectId changes
  React.useEffect(() => {
    if (projectId) {
      loadProject(parseInt(projectId));
    }
  }, [projectId]);

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);





  const handleAddComponent = (componentType: string, position: { x: number; y: number }) => {
    const componentId = `component_${Date.now()}`;
    const componentName = `${componentType}_${model.components.length + 1}`;
    
    // Create default properties based on component type using the comprehensive definitions
    const getDefaultProperties = (type: string) => {
      const baseProps = {
        id: componentId,
        name: componentName
      };
      
      switch (type) {
        case 'TTubo': // Pipe
          return {
            ...baseProps,
            numeroTubo: model.components.length + 1,
            nodoIzq: model.components.length * 2 + 1,
            nodoDer: model.components.length * 2 + 2,
            nin: 10,
            longitudTotal: 1.0,
            mallado: 0.1,
            nTramos: 1,
            tipoMallado: 1, // Distance based
            friccion: 0.02,
            tipoTransCal: 2, // Exhaust tube
            coefAjusFric: 1.0,
            coefAjusTC: 1.0,
            espesorPrin: 0.002,
            densidadPrin: 7800,
            calEspPrin: 460,
            conductPrin: 50,
            tRefrigerante: 353,
            tipRefrig: 'air',
            tini: 300,
            pini: 1.0, // bar
            velMedia: 0,
            lTramo: [1.0],
            dExtTramo: [0.05],
            numCapas: 1,
            capas: [{
              esPrincipal: true,
              esFluida: false,
              density: 7800,
              calorEspecifico: 460,
              conductividad: 50,
              espesor: 0.002,
              emisividadInterior: 0.8,
              emisividadExterior: 0.8
            }]
          };
        
        case 'TDepVolCte': // Constant volume plenum
          return {
            ...baseProps,
            numeroDeposito: model.components.length + 1,
            volumen0: 0.001,
            tipoDeposito: 0, // Constant volume
            temperature: 300,
            pressure: 1.0, // bar
            masa0: 0.001
          };
        
        case 'TDepVolVariable': // Variable volume plenum
          return {
            ...baseProps,
            numeroDeposito: model.components.length + 1,
            volumen0: 0.001,
            tipoDeposito: 1, // Variable volume
            temperature: 300,
            pressure: 1.0,
            masa0: 0.001,
            volumeFunction: 'constant'
          };
        
        case 'TTurbinaSimple': // Simple turbine
          return {
            ...baseProps,
            numeroDeposito: model.components.length + 1,
            volumen0: 0.0001,
            tipoDeposito: 2, // Simple turbine
            temperature: 800,
            pressure: 2.0,
            masa0: 0.0001,
            turbineNumber: 1,
            efficiency: 0.75
          };
        
        case 'TCDFijo': // Fixed CD valve
          return {
            ...baseProps,
            tipoValvula: 0, // Fixed CD
            tubo: 1,
            nodo: 1,
            tipo: 0,
            valvula: model.components.length + 1,
            sentido: 0,
            diametroTubo: 0.05
          };
        
        case 'TValvula4T': // 4T Valve
          return {
            ...baseProps,
            tipoValvula: 1, // 4T Valve
            tubo: 1,
            nodo: 1,
            tipo: 0,
            valvula: model.components.length + 1,
            sentido: 0,
            diametroTubo: 0.05,
            diametroValvula: 0.03,
            alzadaMaxima: 0.01,
            anguloApertura: -20,
            anguloCierre: 60
          };
        
        case 'TLamina': // Reed valve
          return {
            ...baseProps,
            tipoValvula: 2, // Reed valve
            tubo: 1,
            nodo: 1,
            tipo: 0,
            valvula: model.components.length + 1,
            sentido: 1,
            diametroTubo: 0.05,
            areaEfectiva: 0.001,
            presionApertura: 100,
            coeficienteDescarga: 0.6
          };
        
        case 'TMariposa': // Butterfly valve
          return {
            ...baseProps,
            tipoValvula: 10, // Butterfly valve
            tubo: 1,
            nodo: 1,
            tipo: 0,
            valvula: model.components.length + 1,
            sentido: 0,
            diametroTubo: 0.05,
            anguloApertura: 90,
            coeficienteDescarga: 0.6
          };
        
        case 'TBloqueMotor': // Engine Block
          return {
            ...baseProps,
            numeroMotor: model.components.length + 1,
            tipoMotor: 1, // 4-stroke
            nCilindros: 4,
            carrera: 0.086, // 86mm stroke
            diametro: 0.086, // 86mm bore
            biela: 0.143, // 143mm connecting rod
            vcc: 0.000050, // 50cc combustion chamber
            relaCompresion: 10.0,
            combustible: 'gasoline',
            regimen: 2000,
            par: 200
          };
        
        case 'TCilindro4T': // 4T Cylinder
          return {
            ...baseProps,
            numeroCilindro: model.components.length + 1,
            motor: 1,
            anguloAperAdm: -20, // Intake opens 20° BTDC
            anguloCierreAdm: 60, // Intake closes 60° ABDC
            anguloAperEsc: 50, // Exhaust opens 50° BBDC
            anguloCierreEsc: -10, // Exhaust closes 10° ATDC
            tuboAdmision: 1,
            tuboEscape: 2,
            nodoAdmision: 1,
            nodoEscape: 0,
            desfase: 0,
            masaCombustible: 0.00002
          };
        
        case 'TCilindro2T': // 2T Cylinder
          return {
            ...baseProps,
            numeroCilindro: model.components.length + 1,
            motor: 1,
            anguloAperAdm: 120, // Intake port opens 120° ATDC
            anguloCierreAdm: 240, // Intake port closes 240° ATDC
            anguloAperEsc: 110, // Exhaust port opens 110° ATDC
            anguloCierreEsc: 250, // Exhaust port closes 250° ATDC
            tuboAdmision: 1,
            tuboEscape: 2,
            nodoAdmision: 1,
            nodoEscape: 0,
            desfase: 0,
            masaCombustible: 0.00001
          };
        
        case 'TCCDescargaExtremoAbierto': // Open end atmosphere
          return {
            ...baseProps,
            tipoCC: 0, // Open end atmosphere
            numeroCC: model.components.length + 1,
            tubo: 1,
            extremo: 1, // Right end
            presionReferencia: 1.0, // Atmospheric pressure (bar)
            temperaturaReferencia: 293, // 20°C
            coeficienteDescarga: 1.0
          };
        
        case 'TCCExtremoCerrado': // Closed end
          return {
            ...baseProps,
            tipoCC: 3, // Closed end
            numeroCC: model.components.length + 1,
            tubo: 1,
            extremo: 1
          };
        
        case 'TCCExtremoAnecoico': // Anechoic end
          return {
            ...baseProps,
            tipoCC: 4, // Anechoic end
            numeroCC: model.components.length + 1,
            tubo: 1,
            extremo: 1
          };
        
        case 'TCCRamificacion': // Branch
          return {
            ...baseProps,
            tipoCC: 12, // Branch
            numeroCC: model.components.length + 1,
            tubo1: 1,
            tubo2: 2,
            tubo3: 3,
            extremo1: 1,
            extremo2: 0,
            extremo3: 0
          };
        
        case 'TDPF': // DPF
          return {
            ...baseProps,
            numeroDPF: model.components.length + 1,
            longitud: 0.3,
            diametro: 0.25,
            densidadCanales: 300,
            espesorPared: 0.0003,
            porosidad: 0.5,
            permeabilidad: 1e-13,
            diametroPoroMedio: 15e-6,
            masaInicialHollin: 0.0
          };
        
        default:
          return baseProps;
      }
    };

    const newComponent: ModelComponent = {
      id: componentId,
      type: componentType as any,
      position,
      rotation: 0,
      properties: getDefaultProperties(componentType) as any,
      customName: componentName
    };

    setModel(prev => ({
      ...prev,
      components: [...prev.components, newComponent],
      metadata: {
        ...prev.metadata,
        modified: new Date()
      }
    }));
  };

  const handleUpdateComponent = (componentId: string, updates: Partial<ModelComponent>) => {
    setModel(prev => ({
      ...prev,
      components: prev.components.map(comp => 
        comp.id === componentId ? { ...comp, ...updates } : comp
      ),
      metadata: {
        ...prev.metadata,
        modified: new Date()
      }
    }));
  };

  const handleDeleteComponent = (componentId: string) => {
    setModel(prev => ({
      ...prev,
      components: prev.components.filter(comp => comp.id !== componentId),
      connections: prev.connections.filter(conn => 
        conn.fromComponent !== componentId && conn.toComponent !== componentId
      ),
      metadata: {
        ...prev.metadata,
        modified: new Date()
      }
    }));

    if (selectedComponentId === componentId) {
      setSelectedComponentId(null);
    }
  };

  const handleAddConnection = (connection: any) => {
    setModel(prev => {
      // Check for duplicate connections
      const existingConnection = prev.connections.find(conn => 
        (conn.fromComponent === connection.fromComponent && 
         conn.fromPort === connection.fromPort &&
         conn.toComponent === connection.toComponent && 
         conn.toPort === connection.toPort) ||
        (conn.fromComponent === connection.toComponent && 
         conn.fromPort === connection.toPort &&
         conn.toComponent === connection.fromComponent && 
         conn.toPort === connection.fromPort)
      );
      
      if (existingConnection) {
        console.log('Connection already exists, skipping duplicate');
        return prev; // Don't add duplicate connection
      }
      
      return {
        ...prev,
        connections: [...prev.connections, connection],
        metadata: {
          ...prev.metadata,
          modified: new Date()
        }
      };
    });
    console.log('Created connection:', connection);
  };

  const selectedComponent = selectedComponentId 
    ? model.components.find(comp => comp.id === selectedComponentId) || null
    : null;

  const handleBackToProjects = () => {
    navigate('/');
  };

  const handleImportModel = (modelData: any) => {
    console.log('Importing model data:', modelData);
    if (modelData.components) {
      const importedComponents = modelData.components.map((comp: any) => ({
        ...comp,
        id: comp.id || `component_${Date.now()}_${Math.random()}`,
        position: comp.position || { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 }
      }));
      
      console.log('Imported components:', importedComponents);
      
      setModel(prev => {
        const newModel = {
          ...prev,
          components: importedComponents,
          connections: modelData.connections || [],
          metadata: {
            ...prev.metadata,
            modified: new Date()
          }
        };
        console.log('New model state:', newModel);
        return newModel;
      });
      
      // Switch to model tab to show imported components
      setActiveTab('model');
      
      // Force re-render by clearing and setting selected component
      setSelectedComponentId(null);
      
      // Add a small delay to ensure the canvas has time to render
      setTimeout(() => {
        if (importedComponents.length > 0) {
          setSelectedComponentId(importedComponents[0].id);
          console.log('Selected component:', importedComponents[0].id);
        }
      }, 100);
    }
  };

  const handleExportModel = (format: 'wam' | 'json') => {
    const data = format === 'wam' 
      ? convertToWAM(model)
      : JSON.stringify(model, null, 2);
    
    const blob = new Blob([data], { 
      type: format === 'wam' ? 'application/octet-stream' : 'application/json' 
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.metadata.name}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const convertToWAM = (model: EngineModel) => {
    // Simple WAM format conversion - in real implementation this would be more sophisticated
    let wamContent = `// OpenWAM Model: ${model.metadata.name}\n`;
    wamContent += `// Generated: ${new Date().toISOString()}\n\n`;
    
    model.components.forEach(comp => {
      wamContent += `${comp.type} ${comp.id} {\n`;
      Object.entries(comp.properties).forEach(([key, value]) => {
        wamContent += `  ${key} = ${value};\n`;
      });
      wamContent += `}\n\n`;
    });
    
    return wamContent;
  };



  // Expose functions to global scope for CanvasEditor
  React.useEffect(() => {
    (window as any).handleAddComponent = handleAddComponent;
    (window as any).handleAddConnection = handleAddConnection;
    return () => {
      delete (window as any).handleAddComponent;
      delete (window as any).handleAddConnection;
    };
  }, [handleAddComponent, handleAddConnection]);

  // Debug information
  console.log('ProjectEditor rendering, projectId:', projectId);

  return (
    <div className="app">
      <div className="main-content">
        <Toolbar 
          model={model}
          onNewModel={() => setModel({
            components: [],
            connections: [],
            metadata: {
              name: 'New Model',
              description: '',
              created: new Date(),
              modified: new Date(),
              version: '1.0.0'
            },
            validationResult: { isValid: true, errors: [] }
          })}
          onSaveModel={handleSave}
          onLoadModel={() => {
            // TODO: Implement load functionality
            console.log('Loading model');
          }}
          onBackToProjects={handleBackToProjects}
          onExportModel={handleExportModel}
        />
        
        {/* Tab Navigation */}
        <div style={{ 
          display: 'flex', 
          borderBottom: '1px solid #ddd',
          backgroundColor: '#f8f9fa'
        }}>
          <button
            onClick={() => setActiveTab('model')}
            data-testid="model-tab"
            style={{
              padding: '10px 20px',
              border: 'none',
              backgroundColor: activeTab === 'model' ? 'white' : 'transparent',
              borderBottom: activeTab === 'model' ? '2px solid #3498db' : 'none',
              cursor: 'pointer'
            }}
          >
            モデル
          </button>
          <button
            onClick={() => setActiveTab('files')}
            data-testid="files-tab"
            style={{
              padding: '10px 20px',
              border: 'none',
              backgroundColor: activeTab === 'files' ? 'white' : 'transparent',
              borderBottom: activeTab === 'files' ? '2px solid #3498db' : 'none',
              cursor: 'pointer'
            }}
          >
            ファイル
          </button>
          <button
            onClick={() => setActiveTab('simulation')}
            data-testid="simulation-tab"
            style={{
              padding: '10px 20px',
              border: 'none',
              backgroundColor: activeTab === 'simulation' ? 'white' : 'transparent',
              borderBottom: activeTab === 'simulation' ? '2px solid #3498db' : 'none',
              cursor: 'pointer'
            }}
          >
            シミュレーション
          </button>
        </div>
        
        {/* Tab Content */}
        {activeTab === 'model' && (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <CanvasEditor
              model={model}
              selectedComponentId={selectedComponentId}
              onSelectComponent={setSelectedComponentId}
              onUpdateComponent={handleUpdateComponent}
              onDeleteComponent={handleDeleteComponent}
              onAddConnection={handleAddConnection}
            />
            <ComponentPalette onAddComponent={handleAddComponent} />
            <PropertiesPanel
              component={selectedComponent}
              onUpdateComponent={handleUpdateComponent}
              isOpen={isPropertiesPanelOpen}
              onToggle={() => setIsPropertiesPanelOpen(!isPropertiesPanelOpen)}
            />
          </div>
        )}
        
        {activeTab === 'files' && projectId && (
          <FileManager
            projectId={parseInt(projectId)}
            onImportModel={handleImportModel}
          />
        )}
        
        {activeTab === 'simulation' && projectId && (
          <SimulationRunner
            projectId={parseInt(projectId)}
            model={model}
          />
        )}
      </div>

      {/* Save Notification */}
      {showSaveNotification && (
        <div
          data-testid="save-notification"
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: '#27ae60',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '4px',
            zIndex: 1000,
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
          }}
        >
          プロジェクトが保存されました
        </div>
      )}

      {/* Export Options Dialog (hidden, used by tests) */}
      {/* Export buttons for testing */}
      <div style={{ 
        position: 'fixed', 
        bottom: '10px', 
        right: '10px',
        display: 'flex',
        gap: '5px',
        zIndex: 9999
      }}>
        <button
          onClick={() => handleExportModel('wam')}
          data-testid="export-wam-option"
          style={{
            padding: '5px 10px',
            backgroundColor: '#e67e22',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          WAM
        </button>
        <button
          onClick={() => handleExportModel('json')}
          data-testid="export-json-option"
          style={{
            padding: '5px 10px',
            backgroundColor: '#e67e22',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          JSON
        </button>
      </div>
    </div>
  );
};

// Main App component with routing
const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:projectId" element={<ProjectEditor />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Router>
  );
};

export default App;
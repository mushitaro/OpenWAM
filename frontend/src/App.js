import React, { useState } from 'react';
import './App.css';
import BMWE46M3Dashboard from './components/BMWE46M3Dashboard';
import SimulationControl from './components/SimulationControl';
import PythonSimulationControl from './components/PythonSimulationControl';
import SimulationChart from './components/SimulationChart';

function App() {
  const [currentView, setCurrentView] = useState('bmw-e46-m3');
  const [simulationData, setSimulationData] = useState(null);
  const [error, setError] = useState(null);
  const [isPythonSimRunning, setIsPythonSimRunning] = useState(false);

  /**
   * Handler to run the Python simulation with the given parameters.
   * @param {object} params - The parameters for the simulation.
   */
  const handleRunPythonSimulation = async (params) => {
    console.log('App: Running Python simulation with params:', params);
    setError(null);
    setIsPythonSimRunning(true);

    try {
      const response = await fetch('http://localhost:5001/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const results = await response.json();
      console.log('App: Received Python simulation results:', results);
      setSimulationData(results);

    } catch (err) {
      console.error('App: Python simulation failed:', err);
      setError(`Python simulation failed: ${err.message}`);
      setSimulationData(null); // Clear old data on error
    } finally {
      setIsPythonSimRunning(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>OpenWAM Interactive Engine Simulation</h1>
        <nav style={{ marginTop: '10px' }}>
          <button 
            onClick={() => setCurrentView('bmw-e46-m3')}
            style={{ 
              margin: '0 10px', 
              padding: '8px 16px',
              backgroundColor: currentView === 'bmw-e46-m3' ? '#007bff' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            BMW E46 M3 VANOS
          </button>
          <button 
            onClick={() => setCurrentView('general')}
            style={{ 
              margin: '0 10px', 
              padding: '8px 16px',
              backgroundColor: currentView === 'general' ? '#007bff' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            General Simulation
          </button>
        </nav>
      </header>
      <main className="App-main">
        {currentView === 'bmw-e46-m3' ? (
          <BMWE46M3Dashboard />
        ) : (
          <>
            <div className="controls-container">
              <PythonSimulationControl
                onRunSimulation={handleRunPythonSimulation}
                isRunning={isPythonSimRunning}
              />
            </div>
            <div className="chart-container">
              <h2>Simulation Output</h2>
              {error && <p className="error-message">{error}</p>}
              <SimulationChart data={simulationData} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;

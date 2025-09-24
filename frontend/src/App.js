import React, { useState, useEffect } from 'react';
import './App.css';
import SimulationControl from './components/SimulationControl';
import PythonSimulationControl from './components/PythonSimulationControl';
import SimulationChart from './components/SimulationChart';
import { initWasm, runSimulation } from './services/wasmService';

function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [simulationData, setSimulationData] = useState(null);
  const [error, setError] = useState(null);
  const [isPythonSimRunning, setIsPythonSimRunning] = useState(false);

  // Initialize the WebAssembly module when the component mounts
  useEffect(() => {
    initWasm()
      .then(() => {
        setIsWasmReady(true);
        console.log('WASM module is ready.');
      })
      .catch(err => {
        console.error("WASM Initialization failed:", err);
        setError("Failed to load the simulation engine. Please refresh the page.");
      });
  }, []); // The empty dependency array ensures this runs only once.

  /**
   * Handler to run the WASM simulation with the given parameters.
   * @param {object} params - The parameters for the simulation.
   */
  const handleRunWasmSimulation = (params) => {
    if (!isWasmReady) {
      console.error('handleRunWasmSimulation called before WASM is ready.');
      setError("Simulation engine is not ready. Please wait.");
      return;
    }
    console.log('App: Running WASM simulation with params:', params);
    setError(null); // Clear previous errors

    const results = runSimulation(params);

    if (results) {
      console.log('App: Received WASM simulation results:', results);
      setSimulationData(results);
    } else {
      console.error('App: WASM Simulation returned no results.');
      setError('An error occurred during the WASM simulation. Check the console for details.');
      setSimulationData(null); // Clear old data on error
    }
  };

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
      </header>
      <main className="App-main">
        <div className="controls-container">
          <h2>WASM Simulation</h2>
          <SimulationControl
            onRunSimulation={handleRunWasmSimulation}
            isWasmReady={isWasmReady}
          />
          <hr />
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
      </main>
    </div>
  );
}

export default App;

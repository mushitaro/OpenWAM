import React, { useState, useEffect } from 'react';
import './App.css';
import SimulationControl from './components/SimulationControl';
import SimulationChart from './components/SimulationChart';
import { initWasm, runSimulation } from './services/wasmService';

function App() {
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [simulationData, setSimulationData] = useState(null);
  const [error, setError] = useState(null);

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
   * Handler to run the simulation with the given parameters.
   * @param {object} params - The parameters for the simulation.
   */
  const handleRunSimulation = (params) => {
    if (!isWasmReady) {
      console.error('handleRunSimulation called before WASM is ready.');
      setError("Simulation engine is not ready. Please wait.");
      return;
    }
    console.log('App: Running simulation with params:', params);
    setError(null); // Clear previous errors

    const results = runSimulation(params);

    if (results) {
      console.log('App: Received simulation results:', results);
      setSimulationData(results);
    } else {
      console.error('App: Simulation returned no results.');
      setError('An error occurred during the simulation. Check the console for details.');
      setSimulationData(null); // Clear old data on error
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>OpenWAM Interactive Engine Simulation</h1>
      </header>
      <main className="App-main">
        <div className="controls-container">
          <h2>Simulation Controls</h2>
          <SimulationControl
            onRunSimulation={handleRunSimulation}
            isWasmReady={isWasmReady}
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

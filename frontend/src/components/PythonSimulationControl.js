import React, { useState } from 'react';
import './components.css';

const PythonSimulationControl = ({ onRunSimulation, isRunning }) => {
  const [rpm, setRpm] = useState(2000);
  const [injectedMass, setInjectedMass] = useState(20e-6);
  const [compressionRatio, setCompressionRatio] = useState(10.5);
  const [combustionStartAngle, setCombustionStartAngle] = useState(-10);
  const [intakePipeLength, setIntakePipeLength] = useState(0.4);
  const [exhaustPipeLength, setExhaustPipeLength] = useState(0.8);

  const handleRunClick = () => {
    const params = {
      engine: {
        rpm: rpm,
        fuel: {
          injected_mass_per_cycle: injectedMass,
        },
        cylinder: {
          compression_ratio: compressionRatio,
        },
        combustion: {
          start_angle: combustionStartAngle,
        },
      },
      intake_pipe: {
        length: intakePipeLength,
      },
      exhaust_pipe: {
        length: exhaustPipeLength,
      },
    };
    onRunSimulation(params);
  };

  return (
    <div className="simulation-control python-control">
      <h3>Advanced Python Simulation</h3>
      <div className="control-item">
        <label>Engine Speed (RPM): {rpm}</label>
        <input type="range" min="1000" max="8000" step="250" value={rpm} onChange={(e) => setRpm(Number(e.target.value))} />
      </div>
      <div className="control-item">
        <label>Injected Fuel (kg): {injectedMass.toExponential(2)}</label>
        <input type="range" min="10e-6" max="50e-6" step="1e-6" value={injectedMass} onChange={(e) => setInjectedMass(Number(e.target.value))} />
      </div>
      <div className="control-item">
        <label>Compression Ratio: {compressionRatio}</label>
        <input type="range" min="8" max="14" step="0.1" value={compressionRatio} onChange={(e) => setCompressionRatio(Number(e.target.value))} />
      </div>
      <div className="control-item">
        <label>Combustion Start Angle: {combustionStartAngle}</label>
        <input type="range" min="-30" max="10" step="1" value={combustionStartAngle} onChange={(e) => setCombustionStartAngle(Number(e.target.value))} />
      </div>
      <div className="control-item">
        <label>Intake Pipe Length (m): {intakePipeLength}</label>
        <input type="range" min="0.1" max="1.0" step="0.05" value={intakePipeLength} onChange={(e) => setIntakePipeLength(Number(e.target.value))} />
      </div>
      <div className="control-item">
        <label>Exhaust Pipe Length (m): {exhaustPipeLength}</label>
        <input type="range" min="0.2" max="1.5" step="0.05" value={exhaustPipeLength} onChange={(e) => setExhaustPipeLength(Number(e.target.value))} />
      </div>
      <button onClick={handleRunClick} disabled={isRunning}>
        {isRunning ? 'Running Python Sim...' : 'Run Python Simulation'}
      </button>
    </div>
  );
};

export default PythonSimulationControl;

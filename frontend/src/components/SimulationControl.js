import React, { useState } from 'react';
import './components.css';

const SimulationControl = ({ onRunSimulation, isWasmReady }) => {
  const [rpm, setRpm] = useState(2000);
  const [vvtAngle, setVvtAngle] = useState(0);
  const [numCycles, setNumCycles] = useState(5);
  const [bore, setBore] = useState(0.086);
  const [stroke, setStroke] = useState(0.086);
  const [compressionRatio, setCompressionRatio] = useState(9.5);

  const handleRunClick = () => {
    // Construct the parameter object based on the C++ wrapper's expectations
    const params = {
      engine_speed: rpm,
      valves: {
        vvt_angle: vvtAngle,
      },
      simulation: {
        num_cycles: numCycles,
      },
      cylinder: {
        bore: bore,
        stroke: stroke,
        compression_ratio: compressionRatio,
      }
    };
    onRunSimulation(params);
  };

  return (
    <div className="simulation-control">
      <div className="control-item">
        <label htmlFor="rpm">Engine Speed (RPM): {rpm}</label>
        <input
          type="range"
          id="rpm"
          name="rpm"
          min="1000"
          max="8000"
          step="250"
          value={rpm}
          onChange={(e) => setRpm(Number(e.target.value))}
        />
      </div>
      <div className="control-item">
        <label htmlFor="vvt">VVT Intake Angle (°): {vvtAngle}</label>
        <input
          type="range"
          id="vvt"
          name="vvt"
          min="-20"
          max="20"
          step="1"
          value={vvtAngle}
          onChange={(e) => setVvtAngle(Number(e.target.value))}
        />
      </div>
      <div className="control-item">
        <label htmlFor="numCycles">Number of Cycles: {numCycles}</label>
        <input
          type="range"
          id="numCycles"
          name="numCycles"
          min="1"
          max="20"
          step="1"
          value={numCycles}
          onChange={(e) => setNumCycles(Number(e.target.value))}
        />
      </div>
      <div className="control-item">
        <label htmlFor="bore">Cylinder Bore (m): {bore}</label>
        <input
          type="range"
          id="bore"
          name="bore"
          min="0.05"
          max="0.12"
          step="0.001"
          value={bore}
          onChange={(e) => setBore(Number(e.target.value))}
        />
      </div>
      <div className="control-item">
        <label htmlFor="stroke">Cylinder Stroke (m): {stroke}</label>
        <input
          type="range"
          id="stroke"
          name="stroke"
          min="0.05"
          max="0.12"
          step="0.001"
          value={stroke}
          onChange={(e) => setStroke(Number(e.target.value))}
        />
      </div>
      <div className="control-item">
        <label htmlFor="compressionRatio">Compression Ratio: {compressionRatio}</label>
        <input
          type="range"
          id="compressionRatio"
          name="compressionRatio"
          min="8"
          max="14"
          step="0.1"
          value={compressionRatio}
          onChange={(e) => setCompressionRatio(Number(e.target.value))}
        />
      </div>
      <button onClick={handleRunClick} disabled={!isWasmReady}>
        {isWasmReady ? 'Run Simulation' : 'Loading Engine...'}
      </button>
    </div>
  );
};

export default SimulationControl;

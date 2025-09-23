import React, { useState } from 'react';
import './components.css';

const SimulationControl = ({ onRunSimulation, isWasmReady }) => {
  const [rpm, setRpm] = useState(2000);
  const [vvtAngle, setVvtAngle] = useState(0);

  const handleRunClick = () => {
    // Construct the parameter object based on the C++ wrapper's expectations
    const params = {
      engine_speed: rpm,
      valves: {
        vvt_angle: vvtAngle,
      },
      // Hardcode other necessary parameters for now
      // These will be replaced with more UI controls later
      simulation: {
        num_cycles: 5,
      },
      cylinder: {
        bore: 0.086,
        stroke: 0.086,
        compression_ratio: 9.5,
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
      <button onClick={handleRunClick} disabled={!isWasmReady}>
        {isWasmReady ? 'Run Simulation' : 'Loading Engine...'}
      </button>
    </div>
  );
};

export default SimulationControl;

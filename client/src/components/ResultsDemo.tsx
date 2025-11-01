import React, { useState } from 'react';
import { ResultsViewer } from './ResultsViewer';
import { SimulationComparison } from './SimulationComparison';

export const ResultsDemo: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'viewer' | 'comparison'>('viewer');
  const [simulationId, setSimulationId] = useState<number>(1);
  const [comparisonIds, setComparisonIds] = useState<string>('1,2');
  const [error, setError] = useState<string>('');

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setTimeout(() => setError(''), 5000); // Clear error after 5 seconds
  };

  const getComparisonIdsArray = (): number[] => {
    return comparisonIds
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
  };

  return (
    <div className="results-demo">
      <div className="demo-header">
        <h1>OpenWAM Results Visualization Demo</h1>
        <div className="tab-buttons">
          <button 
            className={activeTab === 'viewer' ? 'active' : ''}
            onClick={() => setActiveTab('viewer')}
          >
            Results Viewer
          </button>
          <button 
            className={activeTab === 'comparison' ? 'active' : ''}
            onClick={() => setActiveTab('comparison')}
          >
            Simulation Comparison
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="demo-content">
        {activeTab === 'viewer' && (
          <div className="viewer-tab">
            <div className="demo-controls">
              <label>
                Simulation ID:
                <input
                  type="number"
                  value={simulationId}
                  onChange={(e) => setSimulationId(parseInt(e.target.value) || 1)}
                  min="1"
                />
              </label>
            </div>
            <ResultsViewer 
              simulationId={simulationId}
              onError={handleError}
            />
          </div>
        )}

        {activeTab === 'comparison' && (
          <div className="comparison-tab">
            <div className="demo-controls">
              <label>
                Simulation IDs (comma-separated):
                <input
                  type="text"
                  value={comparisonIds}
                  onChange={(e) => setComparisonIds(e.target.value)}
                  placeholder="1,2,3"
                />
              </label>
            </div>
            <SimulationComparison 
              simulationIds={getComparisonIdsArray()}
              onError={handleError}
            />
          </div>
        )}
      </div>
    </div>
  );
};
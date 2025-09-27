import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import VANOSRPMAnalyzer from './VANOSRPMAnalyzer';
import AdvancedVANOSAnalyzer from './AdvancedVANOSAnalyzer';
import VANOSTableAnalyzer from './VANOSTableAnalyzer';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const BMWE46M3Dashboard = () => {
  const [currentTab, setCurrentTab] = useState('simulation');
  const [simulationData, setSimulationData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // シミュレーションパラメータ
  const [rpm, setRpm] = useState(4000);
  const [load, setLoad] = useState(75);
  const [intakeVanosAdjust, setIntakeVanosAdjust] = useState(0);
  const [exhaustVanosAdjust, setExhaustVanosAdjust] = useState(0);

  const runSingleSimulation = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:5001/bmw-e46-m3/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rpm: rpm,
          load: load,
          vanos_modifications: {
            intake: intakeVanosAdjust,
            exhaust: exhaustVanosAdjust
          }
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        setSimulationData(result);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('シミュレーション実行中にエラーが発生しました: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const runVanosComparison = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const vanosChangesList = [
        { name: 'Stock', changes: null },
        { name: '+10° Intake Advance', changes: { intake: 10 } },
        { name: '+20° Intake Advance', changes: { intake: 20 } },
        { name: '-10° Exhaust Retard', changes: { exhaust: -10 } },
        { name: 'Custom', changes: { intake: intakeVanosAdjust, exhaust: exhaustVanosAdjust } }
      ];

      const response = await fetch('http://localhost:5001/bmw-e46-m3/compare-vanos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rpm: rpm,
          load: load,
          vanos_changes_list: vanosChangesList
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        setComparisonData(result);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('比較シミュレーション実行中にエラーが発生しました: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 圧力-体積図のデータ準備
  const preparePVDiagramData = (data) => {
    if (!data || !data.data) return null;

    const { volume, pressure } = data.data;
    
    return {
      datasets: [{
        label: 'P-V Diagram',
        data: volume.map((v, i) => ({ x: v * 1000000, y: pressure[i] / 1000 })), // L, kPa
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        fill: false,
        tension: 0.1
      }]
    };
  };

  // 充填空気量のデータ準備
  const prepareAirMassData = (data) => {
    if (!data || !data.data) return null;

    const { crank_angle, air_mass_trapped } = data.data;
    
    return {
      labels: crank_angle.map(angle => angle.toFixed(1)),
      datasets: [{
        label: 'Trapped Air Mass (g)',
        data: air_mass_trapped.map(mass => mass * 1000), // g
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        fill: false,
        tension: 0.1
      }]
    };
  };

  // 体積効率比較データ準備
  const prepareVEComparisonData = (compData) => {
    if (!compData || !compData.summary) return null;

    const labels = Object.keys(compData.summary);
    const veData = labels.map(label => compData.summary[label].volumetric_efficiency);
    const airMassData = labels.map(label => compData.summary[label].air_mass_trapped_grams);

    return {
      labels: labels,
      datasets: [
        {
          label: 'Volumetric Efficiency',
          data: veData,
          backgroundColor: 'rgba(54, 162, 235, 0.5)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          yAxisID: 'y'
        },
        {
          label: 'Air Mass Trapped (g)',
          data: airMassData,
          backgroundColor: 'rgba(255, 206, 86, 0.5)',
          borderColor: 'rgba(255, 206, 86, 1)',
          borderWidth: 1,
          yAxisID: 'y1'
        }
      ]
    };
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'BMW E46 M3 Engine Simulation'
      },
    },
  };

  const pvChartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'P-V Diagram'
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Volume (L)'
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Pressure (kPa)'
        }
      }
    }
  };

  const comparisonChartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'VANOS Settings Comparison'
      },
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Volumetric Efficiency'
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Air Mass (g)'
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>BMW E46 M3 VANOS Simulator</h1>
      <p>S54エンジンのVANOS角変更による充填空気量の変化を可視化</p>

      {/* タブナビゲーション */}
      <div style={{ marginBottom: '20px', borderBottom: '2px solid #dee2e6' }}>
        <nav style={{ display: 'flex', gap: '0' }}>
          <button 
            onClick={() => setCurrentTab('simulation')}
            style={{ 
              padding: '12px 24px',
              backgroundColor: currentTab === 'simulation' ? '#007bff' : 'transparent',
              color: currentTab === 'simulation' ? 'white' : '#007bff',
              border: '2px solid #007bff',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginBottom: '-2px'
            }}
          >
            ポイントシミュレーション
          </button>
          <button 
            onClick={() => setCurrentTab('rpm-analysis')}
            style={{ 
              padding: '12px 24px',
              backgroundColor: currentTab === 'rpm-analysis' ? '#28a745' : 'transparent',
              color: currentTab === 'rpm-analysis' ? 'white' : '#28a745',
              border: '2px solid #28a745',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginBottom: '-2px',
              marginLeft: '4px'
            }}
          >
            RPM分析（基本）
          </button>
          <button 
            onClick={() => setCurrentTab('advanced-analysis')}
            style={{ 
              padding: '12px 24px',
              backgroundColor: currentTab === 'advanced-analysis' ? '#dc3545' : 'transparent',
              color: currentTab === 'advanced-analysis' ? 'white' : '#dc3545',
              border: '2px solid #dc3545',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginBottom: '-2px',
              marginLeft: '4px'
            }}
          >
            高度な分析
          </button>
          <button 
            onClick={() => setCurrentTab('vanos-table')}
            style={{ 
              padding: '12px 24px',
              backgroundColor: currentTab === 'vanos-table' ? '#6f42c1' : 'transparent',
              color: currentTab === 'vanos-table' ? 'white' : '#6f42c1',
              border: '2px solid #6f42c1',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginBottom: '-2px',
              marginLeft: '4px'
            }}
          >
            VANOSテーブル分析
          </button>
        </nav>
      </div>

      {/* タブコンテンツ */}
      {currentTab === 'rpm-analysis' ? (
        <VANOSRPMAnalyzer />
      ) : currentTab === 'advanced-analysis' ? (
        <AdvancedVANOSAnalyzer />
      ) : currentTab === 'vanos-table' ? (
        <VANOSTableAnalyzer />
      ) : (
        <div>

      {/* コントロールパネル */}
      <div style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px' 
      }}>
        <h3>シミュレーション設定</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          <div>
            <label>エンジン回転数 (RPM):</label>
            <input
              type="number"
              value={rpm}
              onChange={(e) => setRpm(parseInt(e.target.value))}
              min="1000"
              max="8000"
              step="100"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>負荷 (%):</label>
            <input
              type="number"
              value={load}
              onChange={(e) => setLoad(parseInt(e.target.value))}
              min="20"
              max="100"
              step="5"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>インテークVANOS調整 (°):</label>
            <input
              type="number"
              value={intakeVanosAdjust}
              onChange={(e) => setIntakeVanosAdjust(parseInt(e.target.value))}
              min="-20"
              max="40"
              step="1"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>エキゾーストVANOS調整 (°):</label>
            <input
              type="number"
              value={exhaustVanosAdjust}
              onChange={(e) => setExhaustVanosAdjust(parseInt(e.target.value))}
              min="-30"
              max="10"
              step="1"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
        </div>
        
        <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
          <button 
            onClick={runSingleSimulation} 
            disabled={loading}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#007bff', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? '実行中...' : 'シミュレーション実行'}
          </button>
          <button 
            onClick={runVanosComparison} 
            disabled={loading}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#28a745', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? '実行中...' : 'VANOS設定比較'}
          </button>
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div style={{ 
          backgroundColor: '#f8d7da', 
          color: '#721c24', 
          padding: '10px', 
          borderRadius: '4px', 
          marginBottom: '20px' 
        }}>
          エラー: {error}
        </div>
      )}

      {/* シミュレーション結果 */}
      {simulationData && (
        <div style={{ marginBottom: '30px' }}>
          <h3>シミュレーション結果</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <h4>P-V図</h4>
              {preparePVDiagramData(simulationData) && (
                <Line data={preparePVDiagramData(simulationData)} options={pvChartOptions} />
              )}
            </div>
            <div>
              <h4>充填空気量</h4>
              {prepareAirMassData(simulationData) && (
                <Line data={prepareAirMassData(simulationData)} options={chartOptions} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 比較結果 */}
      {comparisonData && (
        <div>
          <h3>VANOS設定比較結果</h3>
          <div style={{ marginBottom: '20px' }}>
            {prepareVEComparisonData(comparisonData) && (
              <Line data={prepareVEComparisonData(comparisonData)} options={comparisonChartOptions} />
            )}
          </div>
          
          {/* サマリーテーブル */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>設定</th>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>体積効率</th>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>変化率 (%)</th>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>充填空気量 (g)</th>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>変化量 (g)</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.summary && Object.entries(comparisonData.summary).map(([name, data]) => (
                  <tr key={name}>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>{name}</td>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                      {data.volumetric_efficiency.toFixed(3)}
                    </td>
                    <td style={{ 
                      padding: '10px', 
                      border: '1px solid #ddd',
                      color: data.volumetric_efficiency_change_percent > 0 ? 'green' : 
                             data.volumetric_efficiency_change_percent < 0 ? 'red' : 'black'
                    }}>
                      {data.volumetric_efficiency_change_percent > 0 ? '+' : ''}
                      {data.volumetric_efficiency_change_percent.toFixed(1)}%
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                      {data.air_mass_trapped_grams.toFixed(2)}
                    </td>
                    <td style={{ 
                      padding: '10px', 
                      border: '1px solid #ddd',
                      color: data.air_mass_change_grams > 0 ? 'green' : 
                             data.air_mass_change_grams < 0 ? 'red' : 'black'
                    }}>
                      {data.air_mass_change_grams > 0 ? '+' : ''}
                      {data.air_mass_change_grams.toFixed(2)}g
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};

export default BMWE46M3Dashboard;
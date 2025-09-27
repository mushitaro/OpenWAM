import React, { useState, useEffect, useCallback } from 'react';
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const VANOSRPMAnalyzer = () => {
  const [sweepData, setSweepData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // 分析パラメータ
  const [rpmMin, setRpmMin] = useState(2000);
  const [rpmMax, setRpmMax] = useState(6000);
  const [rpmStep, setRpmStep] = useState(500);
  const [tps, setTps] = useState(50);
  
  // VANOS調整パラメータ
  const [intakeAdjust, setIntakeAdjust] = useState(0);
  const [exhaustAdjust, setExhaustAdjust] = useState(0);
  
  // デバウンス用のタイマー
  const [debounceTimer, setDebounceTimer] = useState(null);

  const runRPMSweep = useCallback(async () => {
    console.log('Starting RPM sweep analysis...', { rpmMin, rpmMax, rpmStep, tps, intakeAdjust, exhaustAdjust });
    setLoading(true);
    setError(null);
    
    try {
      // タイムアウト設定（30秒）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch('http://localhost:5001/bmw-e46-m3/rpm-sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rpm_min: rpmMin,
          rpm_max: rpmMax,
          rpm_step: rpmStep,
          tps: tps,
          baseline_vanos: null, // DME制御テーブルをベースライン
          modified_vanos: {
            intake: intakeAdjust,
            exhaust: exhaustAdjust
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const result = await response.json();
      
      if (result.success) {
        console.log('RPM sweep completed successfully:', result);
        setSweepData(result);
      } else {
        console.error('RPM sweep API error:', result.error);
        setError(result.error);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('分析がタイムアウトしました。RPM範囲を狭くするか、ステップを大きくしてください。');
      } else if (err.message.includes('Failed to fetch')) {
        setError('APIサーバーに接続できません。サーバーが起動しているか確認してください。');
      } else {
        setError('RPMスイープ分析中にエラーが発生しました: ' + err.message);
      }
      console.error('RPM Sweep Error:', err);
    } finally {
      setLoading(false);
    }
  }, [rpmMin, rpmMax, rpmStep, tps, intakeAdjust, exhaustAdjust]);

  // VANOS調整時のデバウンス処理
  useEffect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    const timer = setTimeout(() => {
      runRPMSweep();
    }, 1000); // 1000ms後に実行（処理負荷軽減）
    
    setDebounceTimer(timer);
    
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [intakeAdjust, exhaustAdjust, runRPMSweep]);

  // 初回実行は無効化（手動実行のみ）
  // useEffect(() => {
  //   runRPMSweep();
  // }, [rpmMin, rpmMax, rpmStep, tps]);

  // 体積効率グラフのデータ準備
  const prepareVEChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: 'ベースライン（DME制御テーブル）',
          data: baseline.volumetric_efficiency,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5
        },
        {
          label: `変更後（I:${intakeAdjust >= 0 ? '+' : ''}${intakeAdjust}°, E:${exhaustAdjust >= 0 ? '+' : ''}${exhaustAdjust}°）`,
          data: modified.volumetric_efficiency,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5
        }
      ]
    };
  };

  // 充填空気量グラフのデータ準備
  const prepareAirMassChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: 'ベースライン（DME制御テーブル）',
          data: baseline.air_mass_trapped.map(mass => mass * 1000), // g
          borderColor: 'rgb(54, 162, 235)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5
        },
        {
          label: `変更後（I:${intakeAdjust >= 0 ? '+' : ''}${intakeAdjust}°, E:${exhaustAdjust >= 0 ? '+' : ''}${exhaustAdjust}°）`,
          data: modified.air_mass_trapped.map(mass => mass * 1000), // g
          borderColor: 'rgb(255, 206, 86)',
          backgroundColor: 'rgba(255, 206, 86, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5
        }
      ]
    };
  };

  // VANOS角度グラフのデータ準備
  const prepareVANOSChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: 'インテークVANOS（ベースライン）',
          data: baseline.intake_vanos,
          borderColor: 'rgb(153, 102, 255)',
          backgroundColor: 'rgba(153, 102, 255, 0.2)',
          fill: false,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'インテークVANOS（変更後）',
          data: modified.intake_vanos,
          borderColor: 'rgb(255, 159, 64)',
          backgroundColor: 'rgba(255, 159, 64, 0.2)',
          fill: false,
          tension: 0.4,
          borderDash: [5, 5],
          yAxisID: 'y'
        },
        {
          label: 'エキゾーストVANOS（ベースライン）',
          data: baseline.exhaust_vanos,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: false,
          tension: 0.4,
          yAxisID: 'y1'
        },
        {
          label: 'エキゾーストVANOS（変更後）',
          data: modified.exhaust_vanos,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: false,
          tension: 0.4,
          borderDash: [5, 5],
          yAxisID: 'y1'
        }
      ]
    };
  };

  const chartOptions = {
    responsive: true,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'RPM vs 体積効率'
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'エンジン回転数 (RPM)'
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: '体積効率'
        },
        min: 0.6,
        max: 1.0
      }
    }
  };

  const airMassChartOptions = {
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      title: {
        display: true,
        text: 'RPM vs 充填空気量'
      }
    },
    scales: {
      ...chartOptions.scales,
      y: {
        display: true,
        title: {
          display: true,
          text: '充填空気量 (g)'
        }
      }
    }
  };

  const vanosChartOptions = {
    responsive: true,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'RPM vs VANOS角度'
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'エンジン回転数 (RPM)'
        }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'インテークVANOS角度 (°)'
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'エキゾーストVANOS角度 (°)'
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h2>BMW E46 M3 VANOS RPM分析</h2>
      <p>エンジン回転数に対するVANOS角度変更の効果をリアルタイムで分析</p>

      {/* 分析設定パネル */}
      <div style={{ 
        backgroundColor: '#f8f9fa', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #dee2e6'
      }}>
        <h3>分析設定</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
          <div>
            <label>RPM範囲 開始:</label>
            <input
              type="number"
              value={rpmMin}
              onChange={(e) => setRpmMin(parseInt(e.target.value))}
              min="600"
              max="7800"
              step="100"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>RPM範囲 終了:</label>
            <input
              type="number"
              value={rpmMax}
              onChange={(e) => setRpmMax(parseInt(e.target.value))}
              min="600"
              max="7800"
              step="100"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>RPMステップ:</label>
            <input
              type="number"
              value={rpmStep}
              onChange={(e) => setRpmStep(parseInt(e.target.value))}
              min="50"
              max="500"
              step="50"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
          <div>
            <label>スロットル開度 (TPS %):</label>
            <input
              type="number"
              value={tps}
              onChange={(e) => setTps(parseInt(e.target.value))}
              min="0.15"
              max="85"
              step="5"
              style={{ width: '100%', padding: '5px' }}
            />
          </div>
        </div>

        {/* VANOS調整スライダー */}
        <h4>VANOS角度調整（リアルタイム）</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label>インテークVANOS調整: {intakeAdjust >= 0 ? '+' : ''}{intakeAdjust}°</label>
            <input
              type="range"
              min="-30"
              max="30"
              step="1"
              value={intakeAdjust}
              onChange={(e) => setIntakeAdjust(parseInt(e.target.value))}
              style={{ width: '100%', margin: '10px 0' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
              <span>-30°</span>
              <span>0°</span>
              <span>+30°</span>
            </div>
          </div>
          <div>
            <label>エキゾーストVANOS調整: {exhaustAdjust >= 0 ? '+' : ''}{exhaustAdjust}°</label>
            <input
              type="range"
              min="-20"
              max="20"
              step="1"
              value={exhaustAdjust}
              onChange={(e) => setExhaustAdjust(parseInt(e.target.value))}
              style={{ width: '100%', margin: '10px 0' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
              <span>-20°</span>
              <span>0°</span>
              <span>+20°</span>
            </div>
          </div>
        </div>

        <button 
          onClick={runRPMSweep} 
          disabled={loading}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#007bff', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: '10px'
          }}
        >
          {loading ? '分析中...' : '分析実行'}
        </button>
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

      {/* ローディング表示 */}
      {loading && (
        <div style={{ 
          textAlign: 'center', 
          padding: '20px',
          backgroundColor: '#e3f2fd',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <div>分析中...</div>
          <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
            RPM範囲: {rpmMin}-{rpmMax} ({Math.ceil((rpmMax - rpmMin) / rpmStep)} ポイント)
          </div>
        </div>
      )}

      {/* 分析結果グラフ */}
      {sweepData && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
              <h4>体積効率 vs RPM</h4>
              {prepareVEChartData() && (
                <Line data={prepareVEChartData()} options={chartOptions} />
              )}
            </div>
            <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
              <h4>充填空気量 vs RPM</h4>
              {prepareAirMassChartData() && (
                <Line data={prepareAirMassChartData()} options={airMassChartOptions} />
              )}
            </div>
          </div>
          
          <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
            <h4>VANOS角度 vs RPM</h4>
            {prepareVANOSChartData() && (
              <Line data={prepareVANOSChartData()} options={vanosChartOptions} />
            )}
          </div>

          {/* 数値サマリー */}
          <div style={{ marginTop: '20px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
            <h4>分析サマリー</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
              <div>
                <strong>体積効率改善:</strong><br/>
                最大: {sweepData.modified && sweepData.baseline ? 
                  `${((Math.max(...sweepData.modified.volumetric_efficiency) - Math.max(...sweepData.baseline.volumetric_efficiency)) * 100).toFixed(2)}%` : 'N/A'}
              </div>
              <div>
                <strong>平均体積効率:</strong><br/>
                ベースライン: {sweepData.baseline ? 
                  (sweepData.baseline.volumetric_efficiency.reduce((a, b) => a + b, 0) / sweepData.baseline.volumetric_efficiency.length).toFixed(3) : 'N/A'}<br/>
                変更後: {sweepData.modified ? 
                  (sweepData.modified.volumetric_efficiency.reduce((a, b) => a + b, 0) / sweepData.modified.volumetric_efficiency.length).toFixed(3) : 'N/A'}
              </div>
              <div>
                <strong>最適RPM範囲:</strong><br/>
                {sweepData.modified && sweepData.baseline ? 
                  `${sweepData.baseline.rpm[sweepData.modified.volumetric_efficiency.indexOf(Math.max(...sweepData.modified.volumetric_efficiency))]} RPM付近` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VANOSRPMAnalyzer;
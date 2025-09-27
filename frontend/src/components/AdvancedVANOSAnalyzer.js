import React, { useState, useEffect, useCallback, Fragment } from 'react';
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

const AdvancedVANOSAnalyzer = () => {
  const [sweepData, setSweepData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // 分析パラメータ
  const [rpmMin, setRpmMin] = useState(2000);
  const [rpmMax, setRpmMax] = useState(6000);
  const [rpmStep, setRpmStep] = useState(500);
  const [tps, setTps] = useState(50);
  
  // RPMポイント別VANOS調整
  const [rpmSpecificVanos, setRpmSpecificVanos] = useState({});
  const [selectedRpm, setSelectedRpm] = useState(null);
  
  // 表示オプション
  const [showAbsolute, setShowAbsolute] = useState(true);
  const [showDifference, setShowDifference] = useState(true);
  const [showOverlap, setShowOverlap] = useState(true);

  // RPM範囲からRPMポイントを生成
  const getRpmPoints = useCallback(() => {
    const points = [];
    for (let rpm = rpmMin; rpm <= rpmMax; rpm += rpmStep) {
      points.push(rpm);
    }
    return points;
  }, [rpmMin, rpmMax, rpmStep]);

  // RPMポイント別VANOS調整の初期化
  useEffect(() => {
    const rpmPoints = getRpmPoints();
    const newRpmSpecificVanos = {};
    
    rpmPoints.forEach(rpm => {
      if (!rpmSpecificVanos[rpm]) {
        newRpmSpecificVanos[rpm] = { intake: 0, exhaust: 0 };
      } else {
        newRpmSpecificVanos[rpm] = rpmSpecificVanos[rpm];
      }
    });
    
    setRpmSpecificVanos(newRpmSpecificVanos);
  }, [rpmMin, rpmMax, rpmStep]);

  const runRPMSweep = useCallback(async () => {
    console.log('Starting advanced RPM sweep analysis...', { rpmMin, rpmMax, rpmStep, tps, rpmSpecificVanos });
    setLoading(true);
    setError(null);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒タイムアウト
      
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
          baseline_vanos: null,
          modified_vanos: null,
          rpm_specific_vanos: rpmSpecificVanos
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const result = await response.json();
      
      if (result.success) {
        console.log('Advanced RPM sweep completed successfully:', result);
        setSweepData(result);
      } else {
        console.error('Advanced RPM sweep API error:', result.error);
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
      console.error('Advanced RPM Sweep Error:', err);
    } finally {
      setLoading(false);
    }
  }, [rpmMin, rpmMax, rpmStep, tps, rpmSpecificVanos]);

  // RPMポイント別VANOS調整
  const updateRpmSpecificVanos = (rpm, type, value) => {
    setRpmSpecificVanos(prev => ({
      ...prev,
      [rpm]: {
        ...prev[rpm],
        [type]: parseInt(value)
      }
    }));
  };

  // 体積効率グラフ（絶対値）
  const prepareVEAbsoluteChartData = () => {
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
          pointRadius: 4,
          pointHoverRadius: 6
        },
        {
          label: '変更後',
          data: modified.volumetric_efficiency,
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    };
  };

  // 体積効率変化量グラフ
  const prepareVEDifferenceChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    const differences = modified.volumetric_efficiency.map((ve, i) => 
      ((ve - baseline.volumetric_efficiency[i]) / baseline.volumetric_efficiency[i]) * 100
    );
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: '体積効率変化率 (%)',
          data: differences,
          borderColor: 'rgb(255, 159, 64)',
          backgroundColor: 'rgba(255, 159, 64, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    };
  };

  // バルブオーバーラップグラフ
  const prepareOverlapChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: 'ベースライン オーバーラップ',
          data: baseline.valve_overlap,
          borderColor: 'rgb(153, 102, 255)',
          backgroundColor: 'rgba(153, 102, 255, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
        },
        {
          label: '変更後 オーバーラップ',
          data: modified.valve_overlap,
          borderColor: 'rgb(255, 206, 86)',
          backgroundColor: 'rgba(255, 206, 86, 0.2)',
          fill: false,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    };
  };

  // 充填空気量変化量グラフ
  const prepareAirMassDifferenceChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    const differences = modified.air_mass_trapped.map((mass, i) => 
      (mass - baseline.air_mass_trapped[i]) * 1000 // g
    );
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: '充填空気量変化 (g)',
          data: differences,
          borderColor: 'rgb(54, 162, 235)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
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
        }
      }
    }
  };

  const differenceChartOptions = {
    ...chartOptions,
    scales: {
      ...chartOptions.scales,
      y: {
        display: true,
        title: {
          display: true,
          text: '変化率 (%)'
        }
      }
    }
  };

  const overlapChartOptions = {
    ...chartOptions,
    scales: {
      ...chartOptions.scales,
      y: {
        display: true,
        title: {
          display: true,
          text: 'バルブオーバーラップ (°)'
        }
      }
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      <h2>高度なVANOS分析</h2>
      <p>RPMポイント別のVANOS調整と詳細な効果分析</p>

      {/* 基本設定パネル */}
      <div style={{ 
        backgroundColor: '#f8f9fa', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #dee2e6'
      }}>
        <h3>基本設定</h3>
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
              min="100"
              max="1000"
              step="100"
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

        {/* 表示オプション */}
        <h4>表示オプション</h4>
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
          <label>
            <input
              type="checkbox"
              checked={showAbsolute}
              onChange={(e) => setShowAbsolute(e.target.checked)}
            />
            絶対値グラフ
          </label>
          <label>
            <input
              type="checkbox"
              checked={showDifference}
              onChange={(e) => setShowDifference(e.target.checked)}
            />
            変化量グラフ
          </label>
          <label>
            <input
              type="checkbox"
              checked={showOverlap}
              onChange={(e) => setShowOverlap(e.target.checked)}
            />
            バルブオーバーラップ
          </label>
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
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '分析中...' : '分析実行'}
        </button>
      </div>

      {/* RPMポイント別VANOS調整テーブル */}
      <div style={{ 
        backgroundColor: '#fff3cd', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #ffeaa7'
      }}>
        <h3>RPMポイント別VANOS調整テーブル</h3>
        <p>各RPMポイントでVANOS角度を直接編集できます（DME制御テーブルからの調整値）</p>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse', 
            backgroundColor: 'white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <th style={{ 
                  padding: '12px', 
                  border: '1px solid #dee2e6', 
                  fontWeight: 'bold',
                  minWidth: '100px'
                }}>
                  RPM
                </th>
                <th style={{ 
                  padding: '12px', 
                  border: '1px solid #dee2e6', 
                  fontWeight: 'bold',
                  minWidth: '150px'
                }}>
                  インテークVANOS調整 (°)
                </th>
                <th style={{ 
                  padding: '12px', 
                  border: '1px solid #dee2e6', 
                  fontWeight: 'bold',
                  minWidth: '150px'
                }}>
                  エキゾーストVANOS調整 (°)
                </th>
                <th style={{ 
                  padding: '12px', 
                  border: '1px solid #dee2e6', 
                  fontWeight: 'bold',
                  minWidth: '100px'
                }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {getRpmPoints().map(rpm => (
                <tr key={rpm} style={{ 
                  backgroundColor: selectedRpm === rpm ? '#e3f2fd' : 'white',
                  '&:hover': { backgroundColor: '#f5f5f5' }
                }}>
                  <td style={{ 
                    padding: '10px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    color: '#495057'
                  }}>
                    {rpm}
                  </td>
                  <td style={{ padding: '8px', border: '1px solid #dee2e6' }}>
                    <input
                      type="number"
                      value={rpmSpecificVanos[rpm]?.intake || 0}
                      onChange={(e) => updateRpmSpecificVanos(rpm, 'intake', e.target.value)}
                      min="-30"
                      max="30"
                      step="1"
                      style={{ 
                        width: '100%', 
                        padding: '6px', 
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        textAlign: 'center',
                        fontSize: '14px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px', border: '1px solid #dee2e6' }}>
                    <input
                      type="number"
                      value={rpmSpecificVanos[rpm]?.exhaust || 0}
                      onChange={(e) => updateRpmSpecificVanos(rpm, 'exhaust', e.target.value)}
                      min="-20"
                      max="20"
                      step="1"
                      style={{ 
                        width: '100%', 
                        padding: '6px', 
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        textAlign: 'center',
                        fontSize: '14px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center' }}>
                    <button
                      onClick={() => updateRpmSpecificVanos(rpm, 'intake', 0) || updateRpmSpecificVanos(rpm, 'exhaust', 0)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      リセット
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* 一括操作ボタン */}
        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              const newVanos = {};
              getRpmPoints().forEach(rpm => {
                newVanos[rpm] = { intake: 0, exhaust: 0 };
              });
              setRpmSpecificVanos(newVanos);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            全てリセット
          </button>
          <button
            onClick={() => {
              const newVanos = {};
              getRpmPoints().forEach(rpm => {
                newVanos[rpm] = { intake: 10, exhaust: -5 };
              });
              setRpmSpecificVanos(newVanos);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            プリセット1 (I:+10°, E:-5°)
          </button>
          <button
            onClick={() => {
              const newVanos = {};
              getRpmPoints().forEach(rpm => {
                newVanos[rpm] = { intake: -10, exhaust: 10 };
              });
              setRpmSpecificVanos(newVanos);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            プリセット2 (I:-10°, E:+10°)
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
          {/* 絶対値グラフ */}
          {showAbsolute && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                <h4>体積効率 vs RPM（絶対値）</h4>
                {prepareVEAbsoluteChartData() && (
                  <Line data={prepareVEAbsoluteChartData()} options={chartOptions} />
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                <h4>充填空気量 vs RPM（絶対値）</h4>
                {sweepData && (
                  <Line data={{
                    labels: sweepData.baseline.rpm.map(rpm => rpm.toString()),
                    datasets: [
                      {
                        label: 'ベースライン',
                        data: sweepData.baseline.air_mass_trapped.map(mass => mass * 1000),
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        fill: false,
                        tension: 0.4
                      },
                      {
                        label: '変更後',
                        data: sweepData.modified.air_mass_trapped.map(mass => mass * 1000),
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        fill: false,
                        tension: 0.4
                      }
                    ]
                  }} options={{
                    ...chartOptions,
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
                  }} />
                )}
              </div>
            </div>
          )}

          {/* 変化量グラフ */}
          {showDifference && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                <h4>体積効率変化率 vs RPM</h4>
                {prepareVEDifferenceChartData() && (
                  <Line data={prepareVEDifferenceChartData()} options={differenceChartOptions} />
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                <h4>充填空気量変化 vs RPM</h4>
                {prepareAirMassDifferenceChartData() && (
                  <Line data={prepareAirMassDifferenceChartData()} options={{
                    ...differenceChartOptions,
                    scales: {
                      ...differenceChartOptions.scales,
                      y: {
                        display: true,
                        title: {
                          display: true,
                          text: '変化量 (g)'
                        }
                      }
                    }
                  }} />
                )}
              </div>
            </div>
          )}

          {/* バルブオーバーラップ分析 */}
          {showOverlap && (
            <div>
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6', marginBottom: '20px' }}>
                <h4>バルブオーバーラップ vs RPM</h4>
                {prepareOverlapChartData() && (
                  <Line data={prepareOverlapChartData()} options={overlapChartOptions} />
                )}
              </div>
              
              {/* オーバーラップ詳細テーブル */}
              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6', marginBottom: '20px' }}>
                <h4>バルブオーバーラップ詳細（クランク角基準）</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>RPM</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>設定</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>オーバーラップ期間</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>開始角度</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>終了角度</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>インテーク開度期間</th>
                        <th style={{ padding: '10px', border: '1px solid #dee2e6' }}>エキゾースト開度期間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sweepData.baseline.rpm.map((rpm, i) => (
                        <Fragment key={`${rpm}-group`}>
                          <tr style={{ backgroundColor: '#e8f5e8' }}>
                            <td rowSpan="2" style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 'bold', verticalAlign: 'middle' }}>
                              {rpm}
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 'bold' }}>
                              ベースライン
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.baseline.valve_overlap_details[i]?.duration?.toFixed(1) || 'N/A'}°
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.baseline.valve_overlap_details[i]?.start_angle?.toFixed(1) || 'N/A'}°
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.baseline.valve_overlap_details[i]?.end_angle?.toFixed(1) || 'N/A'}°
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.baseline.valve_overlap_details[i]?.intake_timing ? 
                                `${sweepData.baseline.valve_overlap_details[i].intake_timing.opening.toFixed(1)}° ～ ${sweepData.baseline.valve_overlap_details[i].intake_timing.closing.toFixed(1)}°` : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.baseline.valve_overlap_details[i]?.exhaust_timing ? 
                                `${sweepData.baseline.valve_overlap_details[i].exhaust_timing.opening.toFixed(1)}° ～ ${sweepData.baseline.valve_overlap_details[i].exhaust_timing.closing.toFixed(1)}°` : 'N/A'}
                            </td>
                          </tr>
                          <tr style={{ backgroundColor: '#ffe8e8' }}>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6', fontWeight: 'bold' }}>
                              変更後
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.modified.valve_overlap_details[i]?.duration?.toFixed(1) || 'N/A'}°
                              <span style={{ 
                                marginLeft: '5px', 
                                fontSize: '12px',
                                color: (sweepData.modified.valve_overlap_details[i]?.duration || 0) > (sweepData.baseline.valve_overlap_details[i]?.duration || 0) ? 'red' : 'green'
                              }}>
                                ({(() => {
                                  const diff = ((sweepData.modified.valve_overlap_details[i]?.duration || 0) - (sweepData.baseline.valve_overlap_details[i]?.duration || 0));
                                  return (diff >= 0 ? '+' : '') + diff.toFixed(1);
                                })()}°)
                              </span>
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.modified.valve_overlap_details[i]?.start_angle?.toFixed(1) || 'N/A'}°
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.modified.valve_overlap_details[i]?.end_angle?.toFixed(1) || 'N/A'}°
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.modified.valve_overlap_details[i]?.intake_timing ? 
                                `${sweepData.modified.valve_overlap_details[i].intake_timing.opening.toFixed(1)}° ～ ${sweepData.modified.valve_overlap_details[i].intake_timing.closing.toFixed(1)}°` : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', border: '1px solid #dee2e6' }}>
                              {sweepData.modified.valve_overlap_details[i]?.exhaust_timing ? 
                                `${sweepData.modified.valve_overlap_details[i].exhaust_timing.opening.toFixed(1)}° ～ ${sweepData.modified.valve_overlap_details[i].exhaust_timing.closing.toFixed(1)}°` : 'N/A'}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedVANOSAnalyzer;
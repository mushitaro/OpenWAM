import React, { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import ValveTimingChart from './ValveTimingChart';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const VANOSTableAnalyzer = () => {
  const [intakeTable, setIntakeTable] = useState([]);
  const [exhaustTable, setExhaustTable] = useState([]);
  const [modifiedIntakeTable, setModifiedIntakeTable] = useState([]);
  const [modifiedExhaustTable, setModifiedExhaustTable] = useState([]);
  const [overlapAnalysis, setOverlapAnalysis] = useState([]);
  const [sweepData, setSweepData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // 設定
  const [tps, setTps] = useState(45.00);
  const [isBaselineFromModified, setIsBaselineFromModified] = useState(false);

  // DME制御VANOSテーブルを取得
  const loadVanosTable = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5001/bmw-e46-m3/vanos-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tps: tps }),
      });

      const result = await response.json();
      
      if (result.success) {
        setIntakeTable(result.intake_table);
        setExhaustTable(result.exhaust_table);
        setOverlapAnalysis(result.overlap_analysis);
        
        // 初期値としてDME制御テーブルをコピー
        if (modifiedIntakeTable.length === 0) {
          setModifiedIntakeTable(result.intake_table.map(item => ({...item})));
        }
        if (modifiedExhaustTable.length === 0) {
          setModifiedExhaustTable(result.exhaust_table.map(item => ({...item})));
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('VANOSテーブル取得中にエラーが発生しました: ' + err.message);
    }
  }, [tps, modifiedIntakeTable.length, modifiedExhaustTable.length]);

  // 初回読み込み
  useEffect(() => {
    loadVanosTable();
  }, [tps]);

  // RPMスイープ分析実行
  const runRPMSweep = useCallback(async () => {
    console.log('Starting VANOS table analysis...');
    setLoading(true);
    setError(null);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      // RPMポイント別VANOS設定を作成
      const rpmSpecificVanos = {};
      
      // インテークVANOS調整
      modifiedIntakeTable.forEach(item => {
        const baselineItem = intakeTable.find(v => v.rpm === item.rpm);
        if (baselineItem) {
          if (!rpmSpecificVanos[item.rpm]) rpmSpecificVanos[item.rpm] = {};
          rpmSpecificVanos[item.rpm].intake = item.vanos_angle - baselineItem.vanos_angle;
        }
      });
      
      // エキゾーストVANOS調整
      modifiedExhaustTable.forEach(item => {
        const baselineItem = exhaustTable.find(v => v.rpm === item.rpm);
        if (baselineItem) {
          if (!rpmSpecificVanos[item.rpm]) rpmSpecificVanos[item.rpm] = {};
          rpmSpecificVanos[item.rpm].exhaust = item.vanos_angle - baselineItem.vanos_angle;
        }
      });
      
      const response = await fetch('http://localhost:5001/bmw-e46-m3/rpm-sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rpm_min: Math.min(...intakeTable.map(v => v.rpm), ...exhaustTable.map(v => v.rpm)),
          rpm_max: Math.max(...intakeTable.map(v => v.rpm), ...exhaustTable.map(v => v.rpm)),
          rpm_step: 500,
          tps: tps,
          baseline_vanos: isBaselineFromModified ? rpmSpecificVanos : null,
          modified_vanos: null,
          rpm_specific_vanos: isBaselineFromModified ? {} : rpmSpecificVanos
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const result = await response.json();
      
      if (result.success) {
        console.log('VANOS table analysis completed successfully:', result);
        setSweepData(result);
      } else {
        console.error('VANOS table analysis API error:', result.error);
        setError(result.error);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('分析がタイムアウトしました。');
      } else if (err.message.includes('Failed to fetch')) {
        setError('APIサーバーに接続できません。');
      } else {
        setError('分析中にエラーが発生しました: ' + err.message);
      }
      console.error('VANOS Table Analysis Error:', err);
    } finally {
      setLoading(false);
    }
  }, [intakeTable, exhaustTable, modifiedIntakeTable, modifiedExhaustTable, tps, isBaselineFromModified]);

  // VANOS角度を更新
  const updateIntakeVanos = (rpm, value) => {
    setModifiedIntakeTable(prev => 
      prev.map(item => 
        item.rpm === rpm 
          ? { ...item, vanos_angle: parseFloat(value) || 0 }
          : item
      )
    );
  };

  const updateExhaustVanos = (rpm, value) => {
    setModifiedExhaustTable(prev => 
      prev.map(item => 
        item.rpm === rpm 
          ? { ...item, vanos_angle: parseFloat(value) || 0 }
          : item
      )
    );
  };

  // ベースラインを変更後の値に置き換え
  const replaceBaselineWithModified = () => {
    setIntakeTable([...modifiedIntakeTable]);
    setExhaustTable([...modifiedExhaustTable]);
    setIsBaselineFromModified(true);
  };

  // DME制御テーブルにリセット
  const resetToOriginalTable = () => {
    loadVanosTable();
    setIsBaselineFromModified(false);
  };

  // グラフデータ準備
  const prepareVEChartData = () => {
    if (!sweepData) return null;

    const { baseline, modified } = sweepData;
    
    return {
      labels: baseline.rpm.map(rpm => rpm.toString()),
      datasets: [
        {
          label: isBaselineFromModified ? 'ベースライン（前回変更後）' : 'ベースライン（DME制御テーブル）',
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

  // 変化量グラフ
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

  // バルブタイミングとオーバーラップの可視化（参考スクリプト方式）
  const prepareValveTimingChartData = () => {
    if (!overlapAnalysis || overlapAnalysis.length === 0) return null;

    const datasets = [];
    
    // 各RPMポイントでのバルブリフトカーブを計算
    overlapAnalysis.forEach((item, index) => {
      const rpm = item.rpm;
      const overlap = item.overlap_details;
      
      if (overlap && overlap.intake_timing && overlap.exhaust_timing) {
        // 参考スクリプトに基づく正確なバルブリフトカーブの計算
        const calculateValveLiftCurve = (maxLift, duration, maxLiftAngle, direction) => {
          const crankAngles = Array.from({length: 721}, (_, i) => i - 360); // -360 to 360
          const startAngle = maxLiftAngle - duration / 2;
          
          return crankAngles.map(angle => {
            // 参考スクリプトと同じ計算
            const adjustedAngle = direction === 'intake' ? angle : -angle;
            if (adjustedAngle >= startAngle && adjustedAngle <= startAngle + duration) {
              return maxLift * Math.sin(Math.PI * (adjustedAngle - startAngle) / duration);
            }
            return 0;
          });
        };
        
        // インテークとエキゾーストのVANOS角度を取得
        const intakeMaxLiftAngle = overlap.intake_timing.max_lift_angle_atdc;
        const exhaustMaxLiftAngle = overlap.exhaust_timing.max_lift_angle_abdc; // 正の値のまま使用
        
        const maxLift = 11.8; // BMW S54の最大リフト
        const duration = 260;
        
        const intakeLiftCurve = calculateValveLiftCurve(maxLift, duration, intakeMaxLiftAngle, 'intake');
        const exhaustLiftCurve = calculateValveLiftCurve(maxLift, duration, exhaustMaxLiftAngle, 'exhaust');
        
        // 散布図でバルブリフトカーブを表示
        // インテークバルブリフトカーブ（青色の点）
        const intakePoints = [];
        for (let i = 0; i < intakeLiftCurve.length; i++) {
          if (intakeLiftCurve[i] > 0.1) {
            intakePoints.push({
              x: rpm,
              y: i - 360
            });
          }
        }
        
        if (intakePoints.length > 0) {
          datasets.push({
            label: index === 0 ? 'インテークバルブ開度期間' : '',
            data: intakePoints,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgb(54, 162, 235)',
            borderWidth: 1,
            pointRadius: 2,
            pointHoverRadius: 4,
            showLine: false,
            type: 'scatter'
          });
        }
        
        // エキゾーストバルブリフトカーブ（赤色の点）
        const exhaustPoints = [];
        for (let i = 0; i < exhaustLiftCurve.length; i++) {
          if (exhaustLiftCurve[i] > 0.1) {
            exhaustPoints.push({
              x: rpm,
              y: i - 360
            });
          }
        }
        
        if (exhaustPoints.length > 0) {
          datasets.push({
            label: index === 0 ? 'エキゾーストバルブ開度期間' : '',
            data: exhaustPoints,
            backgroundColor: 'rgba(255, 99, 132, 0.6)',
            borderColor: 'rgb(255, 99, 132)',
            borderWidth: 1,
            pointRadius: 2,
            pointHoverRadius: 4,
            showLine: false,
            type: 'scatter'
          });
        }
        
        // オーバーラップ期間（紫色の点、強調）
        const overlapPoints = [];
        for (let i = 0; i < intakeLiftCurve.length; i++) {
          if (intakeLiftCurve[i] > 0.1 && exhaustLiftCurve[i] > 0.1) {
            overlapPoints.push({
              x: rpm,
              y: i - 360
            });
          }
        }
        
        if (overlapPoints.length > 0) {
          datasets.push({
            label: index === 0 ? 'オーバーラップ期間' : '',
            data: overlapPoints,
            backgroundColor: 'rgba(153, 102, 255, 0.8)',
            borderColor: 'rgb(153, 102, 255)',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            showLine: false,
            type: 'scatter'
          });
        }
      }
    });

    return {
      datasets: datasets
    };
  };

  // オーバーラップ期間の折れ線グラフ
  const prepareOverlapDurationChartData = () => {
    if (!overlapAnalysis || overlapAnalysis.length === 0) return null;

    return {
      labels: overlapAnalysis.map(item => item.rpm.toString()),
      datasets: [
        {
          label: 'オーバーラップ期間 (°)',
          data: overlapAnalysis.map(item => item.overlap_details?.duration || 0),
          borderColor: 'rgb(153, 102, 255)',
          backgroundColor: 'rgba(153, 102, 255, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: 'rgb(153, 102, 255)',
          pointBorderColor: 'white',
          pointBorderWidth: 2
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

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      <h2>VANOSテーブル分析</h2>
      <p>DME制御VANOSテーブルをベースに全RPMポイントでの効果を分析</p>

      {/* 基本設定 */}
      <div style={{ 
        backgroundColor: '#f8f9fa', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #dee2e6'
      }}>
        <h3>設定</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '15px' }}>
          <div>
            <label>スロットル開度 (TPS %):</label>
            <select
              value={tps}
              onChange={(e) => setTps(parseFloat(e.target.value))}
              style={{ width: '120px', padding: '5px', marginLeft: '10px' }}
            >
              <option value={0.15}>0.15%</option>
              <option value={0.40}>0.40%</option>
              <option value={0.80}>0.80%</option>
              <option value={1.20}>1.20%</option>
              <option value={1.60}>1.60%</option>
              <option value={2.40}>2.40%</option>
              <option value={4.80}>4.80%</option>
              <option value={7.60}>7.60%</option>
              <option value={11.00}>11.00%</option>
              <option value={15.00}>15.00%</option>
              <option value={20.00}>20.00%</option>
              <option value={25.00}>25.00%</option>
              <option value={30.00}>30.00%</option>
              <option value={45.00}>45.00%</option>
              <option value={65.00}>65.00%</option>
              <option value={85.00}>85.00%</option>
            </select>
          </div>
          <button 
            onClick={loadVanosTable}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: '#6c757d', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            テーブル更新
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
          <button 
            onClick={replaceBaselineWithModified}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#28a745', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            変更後をベースラインに設定
          </button>
          <button 
            onClick={resetToOriginalTable}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#dc3545', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            DME制御テーブルにリセット
          </button>
        </div>
      </div>

      {/* VANOSテーブル編集（横並び） */}
      <div style={{ 
        backgroundColor: '#fff3cd', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #ffeaa7'
      }}>
        <h3>VANOSテーブル編集 (TPS: {tps}%)</h3>
        <p>DME制御テーブルの値を直接編集して効果を分析できます</p>
        
        <div style={{ overflowX: 'auto' }}>
          {/* インテークVANOSテーブル */}
          <div style={{ marginBottom: '30px' }}>
            <h4 style={{ color: '#28a745', marginBottom: '10px' }}>インテークVANOS - バルブ全開角度 (° ATDC)</h4>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse', 
              backgroundColor: 'white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '10px'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#e8f5e8' }}>
                  <th style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 'bold', minWidth: '80px' }}>
                    RPM
                  </th>
                  {intakeTable.map(item => (
                    <th key={`intake-rpm-${item.rpm}`} style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      fontWeight: 'bold',
                      minWidth: '80px',
                      fontSize: '12px'
                    }}>
                      {item.rpm}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    DME制御値
                  </td>
                  {intakeTable.map(item => (
                    <td key={`intake-baseline-${item.rpm}`} style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6',
                      textAlign: 'center',
                      backgroundColor: '#e8f5e8',
                      fontSize: '12px'
                    }}>
                      {item.vanos_angle.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    変更後
                  </td>
                  {intakeTable.map(item => {
                    const modifiedItem = modifiedIntakeTable.find(m => m.rpm === item.rpm) || item;
                    return (
                      <td key={`intake-modified-${item.rpm}`} style={{ 
                        padding: '4px', 
                        border: '1px solid #dee2e6'
                      }}>
                        <input
                          type="number"
                          value={modifiedItem.vanos_angle.toFixed(1)}
                          onChange={(e) => updateIntakeVanos(item.rpm, e.target.value)}
                          step="0.1"
                          style={{ 
                            width: '100%', 
                            padding: '4px', 
                            border: '1px solid #ced4da',
                            borderRadius: '3px',
                            textAlign: 'center',
                            fontSize: '11px'
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    調整量
                  </td>
                  {intakeTable.map(item => {
                    const modifiedItem = modifiedIntakeTable.find(m => m.rpm === item.rpm) || item;
                    const adjust = modifiedItem.vanos_angle - item.vanos_angle;
                    return (
                      <td key={`intake-adjust-${item.rpm}`} style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        textAlign: 'center',
                        color: adjust > 0 ? 'red' : adjust < 0 ? 'blue' : 'black',
                        fontWeight: 'bold',
                        fontSize: '12px'
                      }}>
                        {adjust >= 0 ? '+' : ''}{adjust.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* エキゾーストVANOSテーブル */}
          <div style={{ marginBottom: '30px' }}>
            <h4 style={{ color: '#dc3545', marginBottom: '10px' }}>エキゾーストVANOS - バルブ全開角度 (° ABDC)</h4>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse', 
              backgroundColor: 'white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '10px'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#ffe8e8' }}>
                  <th style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 'bold', minWidth: '80px' }}>
                    RPM
                  </th>
                  {exhaustTable.map(item => (
                    <th key={`exhaust-rpm-${item.rpm}`} style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6', 
                      fontWeight: 'bold',
                      minWidth: '80px',
                      fontSize: '12px'
                    }}>
                      {item.rpm}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    DME制御値
                  </td>
                  {exhaustTable.map(item => (
                    <td key={`exhaust-baseline-${item.rpm}`} style={{ 
                      padding: '8px', 
                      border: '1px solid #dee2e6',
                      textAlign: 'center',
                      backgroundColor: '#ffe8e8',
                      fontSize: '12px'
                    }}>
                      {item.vanos_angle.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    変更後
                  </td>
                  {exhaustTable.map(item => {
                    const modifiedItem = modifiedExhaustTable.find(m => m.rpm === item.rpm) || item;
                    return (
                      <td key={`exhaust-modified-${item.rpm}`} style={{ 
                        padding: '4px', 
                        border: '1px solid #dee2e6'
                      }}>
                        <input
                          type="number"
                          value={modifiedItem.vanos_angle.toFixed(1)}
                          onChange={(e) => updateExhaustVanos(item.rpm, e.target.value)}
                          step="0.1"
                          style={{ 
                            width: '100%', 
                            padding: '4px', 
                            border: '1px solid #ced4da',
                            borderRadius: '3px',
                            textAlign: 'center',
                            fontSize: '11px'
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={{ 
                    padding: '8px', 
                    border: '1px solid #dee2e6',
                    fontWeight: 'bold',
                    backgroundColor: '#f8f9fa'
                  }}>
                    調整量
                  </td>
                  {exhaustTable.map(item => {
                    const modifiedItem = modifiedExhaustTable.find(m => m.rpm === item.rpm) || item;
                    const adjust = modifiedItem.vanos_angle - item.vanos_angle;
                    return (
                      <td key={`exhaust-adjust-${item.rpm}`} style={{ 
                        padding: '8px', 
                        border: '1px solid #dee2e6',
                        textAlign: 'center',
                        color: adjust > 0 ? 'red' : adjust < 0 ? 'blue' : 'black',
                        fontWeight: 'bold',
                        fontSize: '12px'
                      }}>
                        {adjust >= 0 ? '+' : ''}{adjust.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* バルブタイミング・オーバーラップ分析 */}
          <div>
            <h4 style={{ color: '#6f42c1', marginBottom: '10px' }}>バルブタイミング・オーバーラップ分析</h4>
            
            {/* バルブタイミングのロウソクチャート風表示 */}
            <div style={{ 
              backgroundColor: 'white',
              padding: '15px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '20px'
            }}>
              <h5>バルブタイミングとオーバーラップ分析（散布図）</h5>
              {prepareValveTimingChartData() && (
                <Line 
                  data={prepareValveTimingChartData()} 
                  options={{
                    responsive: true,
                    interaction: {
                      mode: 'index',
                      intersect: false,
                    },
                    plugins: {
                      legend: {
                        position: 'top',
                        labels: {
                          filter: function(legendItem, chartData) {
                            // 重複するラベルを除去（空文字列のラベルを除外）
                            return legendItem.text !== '';
                          }
                        }
                      },
                      title: {
                        display: true,
                        text: 'バルブタイミングとオーバーラップ vs RPM（散布図）'
                      },
                      tooltip: {
                        callbacks: {
                          title: function(context) {
                            return `${context[0].parsed.x} RPM`;
                          },
                          label: function(context) {
                            const yValue = context.parsed.y;
                            return `${context.dataset.label}: ${yValue.toFixed(1)}°`;
                          }
                        }
                      }
                    },
                    scales: {
                      x: {
                        type: 'linear',
                        display: true,
                        min: 500,
                        max: 8000,
                        title: {
                          display: true,
                          text: 'エンジン回転数 (RPM)'
                        }
                      },
                      y: {
                        display: true,
                        min: -360,
                        max: 360,
                        title: {
                          display: true,
                          text: 'クランク角度 (°)'
                        },
                        ticks: {
                          stepSize: 60,
                          callback: function(value) {
                            // 角度を0-720範囲に変換してラベル表示
                            const displayValue = value < 0 ? value + 720 : value;
                            const labels = {
                              0: '0°/720° (TDC)',
                              60: '60°',
                              120: '120°',
                              180: '180° (BDC)',
                              240: '240°',
                              300: '300°',
                              360: '360° (TDC)',
                              420: '420°',
                              480: '480°',
                              540: '540° (BDC)',
                              600: '600°',
                              660: '660°',
                              720: '0°/720° (TDC)'
                            };
                            return labels[displayValue] || displayValue + '°';
                          }
                        },
                        grid: {
                          color: function(context) {
                            const value = context.tick.value;
                            // TDC（0度）を最も強調
                            if (value === 0) {
                              return 'rgba(255, 0, 0, 0.9)'; // TDC - 最も濃い赤
                            } else if (value === 180 || value === -180) {
                              return 'rgba(0, 0, 255, 0.6)'; // BDC - 青
                            } else if (value === 360 || value === -360) {
                              return 'rgba(255, 0, 0, 0.6)'; // TDC - 赤
                            }
                            return 'rgba(0, 0, 0, 0.1)';
                          },
                          lineWidth: function(context) {
                            const value = context.tick.value;
                            if (value === 0) {
                              return 4; // 中心のTDCを最も太く
                            } else if (value === 180 || value === -180) {
                              return 2; // BDCを中太
                            } else if (value === 360 || value === -360) {
                              return 3; // 上下のTDCを太く
                            }
                            return 1;
                          }
                        }
                      }
                    },
                  }}
                />
              )}
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                <p><strong>読み方:</strong></p>
                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                  <li><span style={{color: '#36a2eb'}}>●</span> 青い点: インテークバルブ開度期間（sin関数カーブで計算）</li>
                  <li><span style={{color: '#ff6384'}}>●</span> 赤い点: エキゾーストバルブ開度期間（sin関数カーブで計算）</li>
                  <li><span style={{color: '#9966ff'}}>●</span> 紫の点: オーバーラップ期間（両バルブが同時に開いている角度）</li>
                  <li>中央の太い赤線: TDC（上死点、0°）- オーバーラップ発生位置</li>
                  <li>上下の赤線: TDC（上死点、±360°）</li>
                  <li>青線: BDC（下死点、±180°）</li>
                  <li>各点がバルブが開いている角度を表示</li>
                  <li>参考スクリプトに基づくsin関数カーブでの正確な計算</li>
                  <li>TPSプルダウンでDME制御データの16ポイントから選択可能</li>
                </ul>
              </div>
            </div>

            {/* オーバーラップ期間の折れ線グラフ */}
            <div style={{ 
              backgroundColor: 'white',
              padding: '15px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <h5>オーバーラップ期間の変化</h5>
              {prepareOverlapDurationChartData() && (
                <Line 
                  data={prepareOverlapDurationChartData()} 
                  options={{
                    responsive: true,
                    plugins: {
                      legend: {
                        position: 'top',
                      },
                      title: {
                        display: true,
                        text: 'オーバーラップ期間 vs RPM'
                      }
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
                          text: 'オーバーラップ期間 (°)'
                        },
                        beginAtZero: true
                      }
                    },
                  }}
                />
              )}
            </div>
          </div>
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
              <h4>体積効率変化率 vs RPM</h4>
              {prepareVEDifferenceChartData() && (
                <Line data={prepareVEDifferenceChartData()} options={{
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
                }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VANOSTableAnalyzer;
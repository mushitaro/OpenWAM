import React from 'react';

const ValveTimingChart = ({ overlapAnalysis }) => {
  if (!overlapAnalysis || overlapAnalysis.length === 0) {
    return <div>データがありません</div>;
  }

  const chartWidth = 800;
  const chartHeight = 400;
  const margin = { top: 40, right: 40, bottom: 60, left: 80 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;

  // RPM範囲
  const rpmMin = Math.min(...overlapAnalysis.map(item => item.rpm));
  const rpmMax = Math.max(...overlapAnalysis.map(item => item.rpm));
  
  // 角度範囲（TDC基準）
  const angleMin = -200;
  const angleMax = 200;

  // スケール関数
  const xScale = (rpm) => margin.left + ((rpm - rpmMin) / (rpmMax - rpmMin)) * plotWidth;
  const yScale = (angle) => margin.top + ((angleMax - angle) / (angleMax - angleMin)) * plotHeight;

  // バルブタイミングバーの幅
  const barWidth = plotWidth / overlapAnalysis.length * 0.6;

  return (
    <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
      <h5>バルブタイミング・オーバーラップ（ロウソクチャート風）</h5>
      
      <svg width={chartWidth} height={chartHeight} style={{ border: '1px solid #eee' }}>
        {/* 背景グリッド */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f0f0f0" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width={chartWidth} height={chartHeight} fill="url(#grid)" />
        
        {/* TDC基準線（赤い横線） */}
        <line 
          x1={margin.left} 
          y1={yScale(0)} 
          x2={margin.left + plotWidth} 
          y2={yScale(0)} 
          stroke="red" 
          strokeWidth="2" 
          strokeDasharray="5,5"
        />
        <text 
          x={margin.left - 10} 
          y={yScale(0) + 5} 
          textAnchor="end" 
          fontSize="12" 
          fill="red"
          fontWeight="bold"
        >
          TDC (0°)
        </text>

        {/* Y軸ラベル */}
        <text 
          x={20} 
          y={chartHeight / 2} 
          textAnchor="middle" 
          fontSize="14" 
          fill="#333"
          transform={`rotate(-90, 20, ${chartHeight / 2})`}
        >
          クランク角度 (° TDC基準)
        </text>

        {/* X軸ラベル */}
        <text 
          x={chartWidth / 2} 
          y={chartHeight - 10} 
          textAnchor="middle" 
          fontSize="14" 
          fill="#333"
        >
          エンジン回転数 (RPM)
        </text>

        {/* Y軸目盛り */}
        {[-150, -100, -50, 0, 50, 100, 150].map(angle => (
          <g key={`y-tick-${angle}`}>
            <line 
              x1={margin.left - 5} 
              y1={yScale(angle)} 
              x2={margin.left} 
              y2={yScale(angle)} 
              stroke="#333" 
            />
            <text 
              x={margin.left - 10} 
              y={yScale(angle) + 4} 
              textAnchor="end" 
              fontSize="10" 
              fill="#333"
            >
              {angle}°
            </text>
          </g>
        ))}

        {/* バルブタイミングバー */}
        {overlapAnalysis.map((item, index) => {
          const x = xScale(item.rpm);
          const overlap = item.overlap_details;
          
          if (!overlap) return null;

          const intakeTop = yScale(overlap.intake_timing?.closing || 0);
          const intakeBottom = yScale(overlap.intake_timing?.opening || 0);
          const intakeHeight = intakeBottom - intakeTop;

          const exhaustTop = yScale(overlap.exhaust_timing?.closing || 0);
          const exhaustBottom = yScale(overlap.exhaust_timing?.opening || 0);
          const exhaustHeight = exhaustBottom - exhaustTop;

          const overlapTop = yScale(overlap.end_angle || 0);
          const overlapBottom = yScale(overlap.start_angle || 0);
          const overlapHeight = overlapBottom - overlapTop;

          return (
            <g key={`valve-timing-${item.rpm}`}>
              {/* インテークバルブ（緑） */}
              <rect
                x={x - barWidth/3}
                y={intakeTop}
                width={barWidth/4}
                height={intakeHeight}
                fill="rgba(40, 167, 69, 0.7)"
                stroke="rgb(40, 167, 69)"
                strokeWidth="1"
              />
              
              {/* エキゾーストバルブ（赤） */}
              <rect
                x={x}
                y={exhaustTop}
                width={barWidth/4}
                height={exhaustHeight}
                fill="rgba(220, 53, 69, 0.7)"
                stroke="rgb(220, 53, 69)"
                strokeWidth="1"
              />
              
              {/* オーバーラップ（紫、太い） */}
              {overlap.duration > 0 && (
                <rect
                  x={x + barWidth/3}
                  y={overlapTop}
                  width={barWidth/6}
                  height={overlapHeight}
                  fill="rgba(153, 102, 255, 0.9)"
                  stroke="rgb(153, 102, 255)"
                  strokeWidth="2"
                />
              )}

              {/* RPMラベル */}
              <text 
                x={x} 
                y={chartHeight - margin.bottom + 15} 
                textAnchor="middle" 
                fontSize="10" 
                fill="#333"
                transform={`rotate(-45, ${x}, ${chartHeight - margin.bottom + 15})`}
              >
                {item.rpm}
              </text>

              {/* オーバーラップ期間ラベル */}
              {overlap.duration > 0 && (
                <text 
                  x={x} 
                  y={overlapTop - 5} 
                  textAnchor="middle" 
                  fontSize="9" 
                  fill="#6f42c1"
                  fontWeight="bold"
                >
                  {overlap.duration.toFixed(1)}°
                </text>
              )}
            </g>
          );
        })}

        {/* 凡例 */}
        <g transform={`translate(${margin.left}, 20)`}>
          <rect x="0" y="0" width="15" height="10" fill="rgba(40, 167, 69, 0.7)" stroke="rgb(40, 167, 69)" />
          <text x="20" y="8" fontSize="12" fill="#333">インテークバルブ</text>
          
          <rect x="120" y="0" width="15" height="10" fill="rgba(220, 53, 69, 0.7)" stroke="rgb(220, 53, 69)" />
          <text x="140" y="8" fontSize="12" fill="#333">エキゾーストバルブ</text>
          
          <rect x="250" y="0" width="15" height="10" fill="rgba(153, 102, 255, 0.9)" stroke="rgb(153, 102, 255)" />
          <text x="270" y="8" fontSize="12" fill="#333">オーバーラップ</text>
        </g>
      </svg>
      
      <div style={{ marginTop: '15px', fontSize: '12px', color: '#666' }}>
        <p><strong>読み方:</strong></p>
        <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
          <li>縦棒の長さ = バルブ開度期間</li>
          <li>縦棒の位置 = TDC（上死点）からの角度</li>
          <li>紫の縦棒 = オーバーラップ期間（両バルブが同時に開いている）</li>
          <li>赤い点線 = TDC（上死点、0度）</li>
          <li>負の値 = 上死点より前（BTDC）、正の値 = 上死点より後（ATDC）</li>
        </ul>
      </div>
    </div>
  );
};

export default ValveTimingChart;
import { useState, useMemo } from 'react';
import { fmtTime, getTimestampSeconds } from '../../lib/date-utils';
import type { TradePoint } from '../../types';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip as ChartTooltip,
  Filler,
  type ChartOptions,
  type ChartData,
  type ActiveElement,
  type ChartEvent,
} from 'chart.js';

ChartJS.register(LinearScale, PointElement, LineElement, ChartTooltip, Filler);

export function ConsensusChart({ trades, rangeMin, rangeMax }: {
  trades: TradePoint[]; rangeMin: number; rangeMax: number;
}) {
  const [clickedTrade, setClickedTrade] = useState<TradePoint | null>(null);
  const defaultVal = (rangeMin + rangeMax) / 2;

  const withT = useMemo(() => {
    return trades.filter(t => {
      const secs = getTimestampSeconds(t.createdAt);
      return t.consensus != null && secs != null;
    }).map(t => ({ ...t, _ts: getTimestampSeconds(t.createdAt)! }));
  }, [trades]);

  if (withT.length === 0) {
    return <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No trades yet</div>;
  }

  const tFirst = withT[0]._ts;
  const tLast = withT[withT.length - 1]._ts;
  const span = Math.max(tLast - tFirst, 60);
  const tMin = (tFirst - span * 0.08) * 1000;
  const tMax = (tLast + span * 0.04) * 1000;

  const pts: Array<{ t: number; y: number; trade: (typeof withT)[0] | null }> = [
    { t: tMin, y: defaultVal, trade: null },
    ...withT.map(t => ({ t: t._ts * 1000, y: t.consensus!, trade: t })),
  ];

  const gridColor = 'rgba(0,0,0,0.08)';
  const tickColor = '#666';

  const minSpan = (rangeMax - rangeMin) * 0.1;
  const allYVals = pts.map(p => p.y);
  const dataMin = Math.min(...allYVals);
  const dataMax = Math.max(...allYVals);
  const dataCenter = (dataMin + dataMax) / 2;
  const dataHalf = Math.max((dataMax - dataMin) / 2, minSpan / 2);
  const yMin = Math.max(rangeMin, dataCenter - dataHalf - minSpan * 0.5);
  const yMax = Math.min(rangeMax, dataCenter + dataHalf + minSpan * 0.5);

  const chartData: ChartData<'line'> = {
    datasets: [{
      data: pts.map(p => ({ x: p.t, y: p.y })),
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)',
      fill: true,
      tension: 0.2,
      pointBackgroundColor: pts.map(p =>
        p.trade?.direction === 'lower' ? '#ef4444' :
        p.trade?.direction === 'higher' ? '#22c55e' : 'transparent'
      ),
      pointBorderColor: pts.map(p => p.trade ? '#fff' : 'transparent'),
      pointBorderWidth: 1.5,
      pointRadius: pts.map(p => p.trade ? 5 : 0),
      pointHoverRadius: pts.map(p => p.trade ? 7 : 0),
    }],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear',
        min: tMin,
        max: tMax,
        grid: { color: gridColor },
        ticks: {
          callback: (val) => fmtTime((val as number) / 1000),
          maxTicksLimit: 4,
          color: tickColor,
          font: { size: 10 },
        },
      },
      y: {
        min: yMin,
        max: yMax,
        grid: { color: gridColor },
        ticks: { maxTicksLimit: 5, color: tickColor, font: { size: 10 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        titleColor: '#1a1a1a',
        bodyColor: '#4a4a4a',
        borderColor: '#e0e0e0',
        borderWidth: 1,
        callbacks: {
          title: (items) => { const x = items[0]?.parsed?.x; return x != null ? fmtTime(x / 1000) : ''; },
          label: (item) => {
            const p = pts[item.dataIndex];
            if (!p.trade) return `Consensus: ${item.parsed.y}`;
            const dir = p.trade.direction === 'higher' ? '▲ Higher' : '▼ Lower';
            const tradeCost = p.trade.cost ?? 0;
            const costStr = tradeCost > 0 ? `cost $${tradeCost}` : `proceeds $${-tradeCost}`;
            return [`${dir}  →  ${item.parsed.y}`, p.trade.agentId ?? '', `${p.trade.shares} shares · ${costStr}`];
          },
        },
      },
    },
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
      if (elements.length > 0) {
        const p = pts[elements[0].index];
        setClickedTrade(prev => prev === p.trade ? null : p.trade);
      } else {
        setClickedTrade(null);
      }
    },
  };

  return (
    <div>
      <div style={{ height: '150px', position: 'relative', cursor: 'crosshair' }}>
        <Line key={`${withT.length}-${tFirst}-${tLast}`} data={chartData} options={options} redraw />
      </div>
      {clickedTrade && (
        <div style={{ margin: '0.35rem 0', padding: '0.35rem 0.6rem', background: 'var(--bg-color)', border: `2px solid ${clickedTrade.direction === 'higher' ? '#22c55e' : '#ef4444'}`, borderRadius: 'var(--radius-md)', fontSize: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: clickedTrade.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)', fontWeight: 700 }}>
            {clickedTrade.direction === 'higher' ? '▲ Higher' : '▼ Lower'}
          </span>
          <span style={{ fontFamily: 'monospace' }}>{clickedTrade.agentId}</span>
          <span>{clickedTrade.shares} shares</span>
          <span>{(clickedTrade.cost ?? 0) > 0 ? `cost $${clickedTrade.cost}` : `proceeds $${-(clickedTrade.cost ?? 0)}`}</span>
          <span>→ <strong>{clickedTrade.consensus}</strong></span>
          <span style={{ color: 'var(--text-secondary)' }}>{(() => { const s = getTimestampSeconds(clickedTrade.createdAt); return s != null ? fmtTime(s) : ''; })()}</span>
          <button onClick={() => setClickedTrade(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1, borderRadius: '6px', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useImpersonation } from '../hooks/useImpersonation';
import { api } from '../lib/api';
import { useInspectMode } from '../hooks/useInspectMode';
import { formatTargetDateDisplay, endOfPeriod } from '../lib/date-utils';
import type { Market, Metric, Position } from '../types';
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

// --- Minimal LMSR math for live preview (mirrors backend amm.ts) ---
function lmsrCost(q0: number, q1: number, b: number): number {
  const max = Math.max(q0, q1);
  return b * (max / b + Math.log(Math.exp((q0 - max) / b) + Math.exp((q1 - max) / b)));
}

function previewTrade(prob: number, liquidity: number, direction: 'higher' | 'lower', amount: number) {
  // Reconstruct implied shares from current probability (shift so qLower=0)
  const b = liquidity;
  const p = Math.max(0.001, Math.min(0.999, prob));
  const q1 = b * Math.log(p / (1 - p)); // qHigher, qLower=0
  const q0 = 0;

  // Binary search for shares that cost ~amount
  let lo = 0, hi = amount * 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const cost = direction === 'higher'
      ? lmsrCost(q0, q1 + mid, b) - lmsrCost(q0, q1, b)
      : lmsrCost(q0 + mid, q1, b) - lmsrCost(q0, q1, b);
    if (cost < amount) lo = mid; else hi = mid;
  }
  const shares = Math.round(lo * 100) / 100;

  const newQ0 = direction === 'lower' ? q0 + shares : q0;
  const newQ1 = direction === 'higher' ? q1 + shares : q1;
  const diff = newQ1 - newQ0;
  const newProb = 1 / (1 + Math.exp(-diff / b));

  return { shares, newProb };
}

// --- Types ---
interface LiquidityEvent {
  id: string;
  amount: number;
  totalLiquidity: number;
  type: 'initial' | 'injection';
  createdAt: { _seconds: number } | null;
}

// --- SVG line chart ---
interface TradePoint {
  consensus: number | null;
  createdAt: { _seconds: number } | null;
  agentId?: string;
  direction?: 'higher' | 'lower';
  shares?: number;
  cost?: number;
}

const marketTradesCache = new Map<string, TradePoint[]>();
const marketLiquidityEventsCache = new Map<string, LiquidityEvent[]>();
const marketPositionsCache = new Map<string, Position[]>();

function fmtTime(secs: number) {
  return new Date(secs * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function positionsCacheKey(marketId: string, agentId: string) {
  return `${marketId}:${agentId}`;
}

function getTimestampSeconds(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === 'object') {
    const o = ts as Record<string, unknown>;
    const s = o._seconds ?? o.seconds;
    return typeof s === 'number' ? s : null;
  }
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

function ConsensusChart({ trades, rangeMin, rangeMax }: {
  trades: TradePoint[]; rangeMin: number; rangeMax: number;
}) {
  const { isDark } = useDarkMode();
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

  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tickColor = isDark ? '#b0b0b0' : '#666';

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
      pointBorderColor: pts.map(p => p.trade ? (isDark ? '#222' : '#fff') : 'transparent'),
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
        min: rangeMin,
        max: rangeMax,
        grid: { color: gridColor },
        ticks: { maxTicksLimit: 5, color: tickColor, font: { size: 10 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? '#2a2a2a' : '#fff',
        titleColor: isDark ? '#e0e0e0' : '#1a1a1a',
        bodyColor: isDark ? '#b0b0b0' : '#4a4a4a',
        borderColor: isDark ? '#3a3a3a' : '#e0e0e0',
        borderWidth: 1,
        callbacks: {
          title: (items) => { const x = items[0]?.parsed?.x; return x != null ? fmtTime(x / 1000) : ''; },
          label: (item) => {
            const p = pts[item.dataIndex];
            if (!p.trade) return `Consensus: ${item.parsed.y}`;
            const dir = p.trade.direction === 'higher' ? '▲ Higher' : '▼ Lower';
            const costStr = (p.trade.cost ?? 0) > 0 ? `cost ${p.trade.cost}` : `proceeds ${-(p.trade.cost ?? 0)}`;
            return [`${dir}  →  ${item.parsed.y}`, p.trade.agentId ?? '', `${p.trade.shares} shares · ${costStr} credits`];
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
        <div style={{ margin: '0.35rem 0', padding: '0.35rem 0.6rem', background: 'var(--bg-color)', border: `2px solid ${clickedTrade.direction === 'higher' ? '#22c55e' : '#ef4444'}`, borderRadius: '0.375rem', fontSize: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: clickedTrade.direction === 'higher' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
            {clickedTrade.direction === 'higher' ? '▲ Higher' : '▼ Lower'}
          </span>
          <span style={{ fontFamily: 'monospace' }}>{clickedTrade.agentId}</span>
          <span>{clickedTrade.shares} shares</span>
          <span>{(clickedTrade.cost ?? 0) > 0 ? `cost ${clickedTrade.cost}` : `proceeds ${-(clickedTrade.cost ?? 0)}`} credits</span>
          <span>→ <strong>{clickedTrade.consensus}</strong></span>
          <span style={{ color: 'var(--text-secondary)' }}>{(() => { const s = getTimestampSeconds(clickedTrade.createdAt); return s != null ? fmtTime(s) : ''; })()}</span>
          <button onClick={() => setClickedTrade(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>
  );
}

// --- Probability slider ---
function ProbabilitySlider({ probability, rangeMin, rangeMax, previewProb }: {
  probability: number; rangeMin: number; rangeMax: number; previewProb?: number;
}) {
  const pct = probability * 100;
  const prevPct = previewProb !== undefined ? previewProb * 100 : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '120px' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'right' }}>{rangeMin}</span>
      <div style={{ flex: 1, height: '8px', background: 'var(--border-color)', borderRadius: '4px', position: 'relative' }}>
        {/* Preview fill (ghost) */}
        {prevPct !== undefined && (
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${prevPct}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '4px', opacity: 0.25 }} />
        )}
        {/* Current fill */}
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '4px' }} />
        {/* Thumb */}
        <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '3px', height: '14px', background: 'var(--text-color)', borderRadius: '2px', transform: 'translateX(-50%)' }} />
        {/* Preview thumb */}
        {prevPct !== undefined && prevPct !== pct && (
          <div style={{ position: 'absolute', left: `${prevPct}%`, top: '-3px', width: '2px', height: '14px', background: 'var(--accent-color, #3b82f6)', borderRadius: '2px', transform: 'translateX(-50%)', opacity: 0.6 }} />
        )}
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px' }}>{rangeMax}</span>
    </div>
  );
}

function formatTimeRemaining(targetDate: string): string {
  const end = new Date(endOfPeriod(targetDate) + 'T23:59:59');
  const diffMs = end.getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const d = Math.floor(diffMs / 86400000);
  const h = Math.floor((diffMs % 86400000) / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (d > 30) { const mo = Math.floor(d / 30); return `${mo}mo ${d % 30}d`; }
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

const inputStyle = { padding: '0.4rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', width: '80px' } as const;
const labelStyle = { display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' } as const;

// --- Trading panel ---
function TradingPanel({ market, agentId, user, onTrade, onError }: {
  market: Market; agentId: string; user: import('firebase/auth').User;
  onTrade: () => void; onError: (msg: string) => void;
}) {
  const [tradeAmount, setTradeAmount] = useState('');
  const [liqAmount, setLiqAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [lastResult, setLastResult] = useState<{ direction: string; shares: number; cost: number; consensus: number } | null>(null);
  const [trades, setTrades] = useState<TradePoint[]>([]);
  const [liquidityEvents, setLiquidityEvents] = useState<LiquidityEvent[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [sellInputs, setSellInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    const cachedTrades = marketTradesCache.get(market.id);
    const cachedLiquidityEvents = marketLiquidityEventsCache.get(market.id);
    const cachedPositions = marketPositionsCache.get(positionsCacheKey(market.id, agentId));

    if (cachedTrades) setTrades(cachedTrades);
    if (cachedLiquidityEvents) setLiquidityEvents(cachedLiquidityEvents);
    if (cachedPositions) setPositions(cachedPositions);

    setTradesLoading(!cachedTrades);
    api.getMarketTrades(user, market.id)
      .then(data => {
        marketTradesCache.set(market.id, data);
        setTrades(data);
      })
      .catch(() => {})
      .finally(() => setTradesLoading(false));
    api.getMarketLiquidityEvents(user, market.id)
      .then(data => {
        marketLiquidityEventsCache.set(market.id, data);
        setLiquidityEvents(data);
      })
      .catch(() => {});
    api.getPositions(user, market.id, agentId).then(data => {
      marketPositionsCache.set(positionsCacheKey(market.id, agentId), data);
      setPositions(data);
    }).catch(() => {});
  }, [user, market.id, agentId]);

  // Live preview
  const amount = parseFloat(tradeAmount);
  const preview = useMemo(() => {
    if (isNaN(amount) || amount <= 0 || !market.probability) return null;
    const higher = previewTrade(market.probability, market.liquidity, 'higher', amount);
    const lower = previewTrade(market.probability, market.liquidity, 'lower', amount);
    return { higher, lower };
  }, [amount, market.probability, market.liquidity]);

  const refreshPositions = () => api.getPositions(user, market.id, agentId).then(data => {
    marketPositionsCache.set(positionsCacheKey(market.id, agentId), data);
    setPositions(data);
  }).catch(() => {});

  const handleBetDirection = async (direction: 'higher' | 'lower') => {
    if (isNaN(amount) || amount <= 0) return;
    setTrading(true);
    const result = await api.trade(user, { marketId: market.id, direction, amount, agentId })
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: result.cost, consensus: result.consensus });
      setTradeAmount('');
      setTrades(prev => {
        const next = [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 }, agentId, direction, shares: result.shares, cost: result.cost }];
        marketTradesCache.set(market.id, next);
        return next;
      });
      api.getMarketTrades(user, market.id).then(data => {
        marketTradesCache.set(market.id, data);
        setTrades(data);
      }).catch(() => {});
      refreshPositions();
      onTrade();
    }
  };

  const handleSell = async (direction: 'higher' | 'lower') => {
    const sellShares = parseFloat(sellInputs[direction] || '');
    if (isNaN(sellShares) || sellShares <= 0) return;
    setTrading(true);
    const result = await api.trade(user, { marketId: market.id, direction, sellShares, agentId })
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: -result.proceeds, consensus: result.consensus });
      setSellInputs(prev => ({ ...prev, [direction]: '' }));
      setTrades(prev => {
        const next = [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 }, agentId, direction, shares: result.shares, cost: -result.proceeds }];
        marketTradesCache.set(market.id, next);
        return next;
      });
      refreshPositions();
      onTrade();
    }
  };

  const handleLiquidity = async () => {
    const a = parseFloat(liqAmount);
    if (isNaN(a) || a <= 0) return;
    const result = await api.injectLiquidity(user, market.id, a).catch((e: Error) => { onError(e.message); return null; });
    if (result) {
      setLiqAmount('');
      api.getMarketLiquidityEvents(user, market.id).then(data => {
        marketLiquidityEventsCache.set(market.id, data);
        setLiquidityEvents(data);
      }).catch(() => {});
      onTrade();
    }
  };

  const previewConsensus = (dir: 'higher' | 'lower') => {
    if (!preview) return null;
    const p = dir === 'higher' ? preview.higher.newProb : preview.lower.newProb;
    return Math.round((market.rangeMin + p * (market.rangeMax - market.rangeMin)) * 100) / 100;
  };
  const previewShares = (dir: 'higher' | 'lower') => preview ? (dir === 'higher' ? preview.higher.shares : preview.lower.shares) : null;

  return (
    <div style={{ padding: '0.75rem 0.5rem 0.5rem' }}>
      {/* Consensus chart + trade log */}
      {!tradesLoading && (
        <div style={{ marginBottom: '0.75rem', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: '0.375rem', padding: '0.5rem 0.5rem 0' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', paddingLeft: '0.25rem' }}>
            Consensus history
          </div>
          <ConsensusChart
            trades={trades}
            rangeMin={market.rangeMin}
            rangeMax={market.rangeMax}
          />
          {(trades.length > 0 || liquidityEvents.length > 0) && (() => {
            type LogEntry =
              | { kind: 'trade'; ts: number; data: TradePoint }
              | { kind: 'liquidity'; ts: number; data: LiquidityEvent };
            const entries: LogEntry[] = [
              ...trades.filter(t => t.consensus != null).flatMap(t => { const ts = getTimestampSeconds(t.createdAt); return ts != null ? [{ kind: 'trade' as const, ts, data: t }] : []; }),
              ...liquidityEvents.flatMap(e => { const ts = getTimestampSeconds(e.createdAt); return ts != null ? [{ kind: 'liquidity' as const, ts, data: e }] : []; }),
            ].sort((a, b) => b.ts - a.ts);
            return (
              <div style={{ marginTop: '0.5rem', maxHeight: '160px', overflowY: 'auto', borderTop: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #f8f9fa)' }}>
                      {['Time', 'Agent', 'Dir', 'Shares', 'Cost', 'Consensus'].map(h => (
                        <th key={h} style={{ padding: '0.2rem 0.4rem', textAlign: h === 'Dir' ? 'center' : ['Shares', 'Cost', 'Consensus'].includes(h) ? 'right' : 'left', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, i) => entry.kind === 'trade' ? (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', fontFamily: 'monospace', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.data.agentId ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: entry.data.direction === 'higher' ? '#22c55e' : '#ef4444' }}>{entry.data.direction === 'higher' ? '▲' : '▼'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{entry.data.shares ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{entry.data.cost ?? '—'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{entry.data.consensus}</td>
                      </tr>
                    ) : (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', opacity: 0.8 }}>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(entry.ts)}</td>
                        <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-secondary)' }}>admin</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'center', color: '#3b82f6' }}>{entry.data.type === 'initial' ? 'init' : '+liq'}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)' }}>—</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: '#3b82f6', fontFamily: 'monospace' }}>+{entry.data.amount}</td>
                        <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>b={entry.data.totalLiquidity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* Trade controls */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Amount (credits)</label>
          <input
            type="number" value={tradeAmount}
            onChange={e => setTradeAmount(e.target.value)}
            placeholder="50"
            style={{ ...inputStyle, width: '90px' }}
            min="1"
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
              {preview ? `~${previewShares('lower')} shares → ${previewConsensus('lower')}` : '\u00a0'}
            </div>
            <button
              className="btn-small"
              disabled={trading || !tradeAmount}
              onClick={() => handleBetDirection('lower')}
              style={{ background: '#ef4444', color: '#fff', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}
            >
              {trading ? '…' : '▼ Lower'}
            </button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
              {preview ? `~${previewShares('higher')} shares → ${previewConsensus('higher')}` : '\u00a0'}
            </div>
            <button
              className="btn-small"
              disabled={trading || !tradeAmount}
              onClick={() => handleBetDirection('higher')}
              style={{ background: '#22c55e', color: '#fff', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}
            >
              {trading ? '…' : '▲ Higher'}
            </button>
          </div>
        </div>

        {lastResult && (
          <div style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', background: 'var(--bg-secondary, #f0f4ff)', borderRadius: '0.375rem', borderLeft: `3px solid ${lastResult.direction === 'higher' ? '#22c55e' : '#ef4444'}` }}>
            <strong>{lastResult.direction === 'higher' ? '▲' : '▼'} {lastResult.shares} shares</strong>
            {' '}{lastResult.cost < 0 ? `sold for ${-lastResult.cost}` : `for ${lastResult.cost}`} credits → consensus <strong>{lastResult.consensus}</strong>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Add liquidity (b={market.liquidity})</label>
            <input type="number" value={liqAmount} onChange={e => setLiqAmount(e.target.value)} placeholder="+" style={{ ...inputStyle, width: '60px' }} />
          </div>
          <button className="btn-small" onClick={handleLiquidity} style={{ padding: '0.4rem 0.6rem' }}>Inject</button>
        </div>
      </div>

      {/* Sell controls */}
      {positions.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>Sell position:</span>
          {positions.map(pos => (
            <div key={pos.direction} style={{ display: 'flex', gap: '0.25rem', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>{pos.direction === 'higher' ? '▲' : '▼'} {pos.shares} shares</label>
                <input
                  type="number"
                  value={sellInputs[pos.direction] || ''}
                  onChange={e => setSellInputs(prev => ({ ...prev, [pos.direction]: e.target.value }))}
                  placeholder="shares"
                  style={{ ...inputStyle, width: '70px' }}
                  min="0.01"
                  max={pos.shares}
                />
              </div>
              <button
                className="btn-small"
                disabled={trading || !sellInputs[pos.direction]}
                onClick={() => handleSell(pos.direction)}
                style={{ padding: '0.5rem 0.75rem', background: 'var(--text-secondary)', color: '#fff' }}
              >
                {trading ? '…' : 'Sell'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Hook watcher status ---
function HookStatus() {
  const [status, setStatus] = useState<{ active: boolean; lastPolledAt?: string; intervalMs?: number } | null>(null);
  const [secsAgo, setSecsAgo] = useState(0);
  const lastPolledRef = useRef<number>(0);

  useEffect(() => {
    api.getHooksStatus().then(s => {
      setStatus(s);
      if (s.lastPolledAt) lastPolledRef.current = new Date(s.lastPolledAt).getTime();
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(() => {
      setSecsAgo(Math.floor((Date.now() - lastPolledRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status?.active]);

  if (!status) return null;

  const intervalSecs = (status.intervalMs || 60000) / 1000;
  const remaining = Math.max(0, intervalSecs - secsAgo);

  return (
    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: status.active ? '#22c55e' : '#ef4444',
        display: 'inline-block',
        animation: status.active ? 'pulse 2s infinite' : 'none',
      }} />
      {status.active ? `Hooks: ${remaining}s` : 'Hooks: offline'}
    </span>
  );
}

// --- Main page ---
export function MarketsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const { agentId: impersonatedId } = useImpersonation();
  const { inspectTask } = useInspectMode();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveResult, setResolveResult] = useState('');
  const [refreshResult, setRefreshResult] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(id); }, []);
  // Track per-market preview for slider ghost
  const [hoverDir, setHoverDir] = useState<Record<string, 'higher' | 'lower' | undefined>>({});

  const [filterText, setFilterText] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const filteredMarkets = useMemo(() => {
    let result = showInactive ? markets : markets.filter(m => m.active);
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(m => m.metricName.toLowerCase().includes(q));
    }
    return result;
  }, [markets, filterText, showInactive]);

  const [metricId, setMetricId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    // Skip cache when inspecting — conditional markets are task-specific
    if (!inspectTask) {
      const cachedMkts = sessionStorage.getItem('cache:markets');
      const cachedMets = sessionStorage.getItem('cache:metrics');
      if (cachedMkts) { setMarkets(JSON.parse(cachedMkts)); setLoading(false); }
      if (cachedMets) setMetrics(JSON.parse(cachedMets));
    }
    const [mkts, mets] = await Promise.all([
      api.getMarkets(user, inspectTask?.id).catch((e: Error) => { setError(e.message); return null; }),
      api.getMetrics(user).catch(() => null),
    ]);
    if (mkts) {
      setMarkets(mkts);
      if (!inspectTask) sessionStorage.setItem('cache:markets', JSON.stringify(mkts));
    }
    if (mets) {
      setMetrics(mets);
      if (!inspectTask) sessionStorage.setItem('cache:metrics', JSON.stringify(mets));
    }
    setLoading(false);
  }, [user, inspectTask]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!user || !metricId || !targetDate) return;
    setCreating(true);
    setError('');
    const result = await api.createMarket(user, metricId, targetDate).catch((e: Error) => { setError(e.message); return null; });
    setCreating(false);
    if (result) { setMetricId(''); setTargetDate(''); load(); }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    setError('');
    await api.deleteMarket(user, id).catch((e: Error) => { setError(e.message); });
    load();
  };

  const handleVoid = async (id: string) => {
    if (!user) return;
    setError('');
    const result = await api.voidMarket(user, id).catch((e: Error) => { setError(e.message); return null; });
    if (result) { setResolveResult(`Market voided. Refunded ${result.refunded} credits.`); load(); }
  };

  const handleResolveOne = async (id: string) => {
    if (!user) return;
    setError('');
    const result = await api.resolveMarket(user, id).catch((e: Error) => { setError(e.message); return null; });
    if (result?.resolved) { setResolveResult(`Market resolved. Total payout: ${result.totalPayout} credits.`); load(); }
  };

  const handleResolve = async () => {
    if (!user) return;
    setResolveResult('');
    const result = await api.resolvePredictions(user).catch((e: Error) => { setError(e.message); return null; });
    if (result) { setResolveResult(`Resolved ${result.resolved} markets. Total payout: ${result.totalPayout} credits.`); load(); }
  };

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshResult('');
    const result = await api.refreshMarkets(user).catch((e: Error) => { setError(e.message); return null; });
    if (result) {
      const parts = [];
      if (result.created > 0) parts.push(`${result.created} created`);
      if (result.voided > 0) parts.push(`${result.voided} voided`);
      setRefreshResult(parts.length > 0 ? `Markets refreshed: ${parts.join(', ')}.` : 'Markets up to date.');
      load();
    }
  };

  if (authLoading) return <div className="loading">Loading...</div>;
  if (!user) { navigate('/', { replace: true }); return null; }

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' } as const;

  return (
    <>
      <div className="header">
        <img src="/logo.png" alt="Telarchy" style={{ height: '5.25rem' }} />
        <nav className="header-nav">
          <Link to="/metrics" className="nav-link">Metrics</Link>
          <Link to="/agents" className="nav-link">Agents</Link>
          <Link to="/markets" className="nav-link active">Markets</Link>
          <Link to="/tasks" className="nav-link">Tasks</Link>
        </nav>
        <div className="header-actions">
          <HookStatus />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Acting as: <strong>{impersonatedId}</strong></span>
          <button className="btn" onClick={handleRefresh}>Refresh Markets</button>
          <button className="btn" onClick={handleResolve}>Resolve Markets</button>
        </div>
      </div>
      <div className="container">
        {error && <div className="message error show">{error}</div>}
        {resolveResult && <div className="message success show">{resolveResult}</div>}
        {refreshResult && <div className="message success show">{refreshResult}</div>}

        <div className="section" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Metric</label>
            <select value={metricId} onChange={e => setMetricId(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}>
              <option value="">Select metric...</option>
              {metrics.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Target Date</label>
            <input type="date" value={targetDate} min={tomorrow} onChange={e => setTargetDate(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
          </div>
          <button className="btn" onClick={handleCreate} disabled={creating || !metricId || !targetDate}>
            {creating ? 'Creating...' : 'Create Market'}
          </button>
        </div>

        {loading ? (
          <div className="loading">Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No markets.</p></div>
        ) : (
          <div className="section">
            <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="text"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                placeholder="Search metrics..."
                style={{ padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '0.85rem', width: '200px' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={thStyle}>Metric</th>
                  <th style={thStyle}>Target Date</th>
                  <th style={thStyle}>Consensus</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Range</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Trades</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {filteredMarkets.map(m => (
                  <React.Fragment key={m.id}>
                    <tr
                      style={{ borderBottom: expandedIds.includes(m.id) ? 'none' : '1px solid var(--border-color)', cursor: 'pointer', opacity: m.active ? 1 : 0.5 }}
                      onClick={() => setExpandedIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                        {m.metricName}
                        {!m.active && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--border-color)', borderRadius: '0.25rem', padding: '0.1rem 0.35rem', verticalAlign: 'middle' }}>inactive</span>}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                        {formatTargetDateDisplay(m.targetDate)}
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: formatTimeRemaining(m.targetDate) === 'expired' ? 'var(--delete-color, #ef4444)' : 'var(--text-secondary)', opacity: 0.8 }}>
                          {formatTimeRemaining(m.targetDate)}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <ProbabilitySlider
                            probability={m.probability}
                            rangeMin={m.rangeMin}
                            rangeMax={m.rangeMax}
                            previewProb={hoverDir[m.id] ? previewTrade(m.probability, m.liquidity, hoverDir[m.id]!, 50).newProb : undefined}
                          />
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, minWidth: '42px' }}>{m.consensus ?? '—'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {m.rangeMin}–{m.rangeMax}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{m.tradeCount}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn-small" style={{ color: 'var(--accent-color, #3b82f6)', marginRight: '0.25rem' }}
                          onClick={(e) => { e.stopPropagation(); handleResolveOne(m.id); }}>Resolve</button>
                        {m.tradeCount === 0 ? (
                          <button className="btn-small" style={{ color: 'var(--delete-color, #ef4444)' }}
                            onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}>Delete</button>
                        ) : (
                          <button className="btn-small" style={{ color: 'var(--text-secondary)' }}
                            onClick={(e) => { e.stopPropagation(); handleVoid(m.id); }}>Void</button>
                        )}
                      </td>
                    </tr>
                    {expandedIds.includes(m.id) && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={6} style={{ padding: '0 0.5rem 0.75rem' }}>
                          {m.active ? (
                            <TradingPanel
                              market={m}
                              agentId={impersonatedId}
                              user={user}
                              onTrade={() => { load(); }}
                              onError={setError}
                            />
                          ) : (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>Betting is disabled on inactive markets. This market will resolve at its target date.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

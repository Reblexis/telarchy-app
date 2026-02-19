import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useImpersonation } from '../hooks/useImpersonation';
import { api } from '../lib/api';
import { formatTargetDateDisplay, endOfPeriod } from '../lib/date-utils';
import type { Market, Metric, Position } from '../types';

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

// --- SVG line chart ---
interface TradePoint { consensus: number | null; createdAt: { _seconds: number } | null }

function ConsensusChart({ trades, rangeMin, rangeMax }: {
  trades: TradePoint[]; rangeMin: number; rangeMax: number;
}) {
  const defaultVal = (rangeMin + rangeMax) / 2;
  const pts = useMemo(() => {
    const withConsensus = trades.filter(t => t.consensus != null);
    const base = [{ x: 0, y: defaultVal }];
    if (withConsensus.length === 0) return [...base, { x: 1, y: defaultVal }];
    return [...base, ...withConsensus.map((t, i) => ({ x: i + 1, y: t.consensus! }))];
  }, [trades, rangeMin, rangeMax]);

  if (pts.length < 2) return null;

  const W = 400, H = 80, PAD = 8;
  const yMin = rangeMin, yMax = rangeMax;
  const xScale = (i: number) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const yScale = (v: number) => H - PAD - ((v - yMin) / (yMax - yMin)) * (H - 2 * PAD);

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '80px', display: 'block' }}>
        {/* Range grid lines */}
        <line x1={PAD} y1={yScale(rangeMin)} x2={W - PAD} y2={yScale(rangeMin)} stroke="var(--border-color)" strokeWidth="0.5" />
        <line x1={PAD} y1={yScale(rangeMax)} x2={W - PAD} y2={yScale(rangeMax)} stroke="var(--border-color)" strokeWidth="0.5" />
        <line x1={PAD} y1={yScale((rangeMin + rangeMax) / 2)} x2={W - PAD} y2={yScale((rangeMin + rangeMax) / 2)} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3,3" />
        {/* Labels */}
        <text x={W - PAD + 2} y={yScale(rangeMax) + 4} fontSize="7" fill="var(--text-secondary)">{rangeMax}</text>
        <text x={W - PAD + 2} y={yScale(rangeMin) + 4} fontSize="7" fill="var(--text-secondary)">{rangeMin}</text>
        {/* Fill area under line */}
        <path
          d={`${path} L${xScale(pts.length - 1).toFixed(1)},${yScale(rangeMin).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(rangeMin).toFixed(1)} Z`}
          fill="var(--accent-color, #3b82f6)" fillOpacity="0.08"
        />
        {/* Line */}
        <path d={path} fill="none" stroke="var(--accent-color, #3b82f6)" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Endpoint dot */}
        <circle cx={xScale(last.x)} cy={yScale(last.y)} r="3" fill="var(--accent-color, #3b82f6)" />
        {/* Current value label */}
        <text x={xScale(last.x)} y={yScale(last.y) - 5} fontSize="8" fill="var(--accent-color, #3b82f6)" textAnchor="middle" fontWeight="bold">
          {last.y}
        </text>
      </svg>
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
  const [tradesLoading, setTradesLoading] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [sellInputs, setSellInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getMarketTrades(user, market.id)
      .then(data => { setTrades(data); setTradesLoading(false); })
      .catch(() => setTradesLoading(false));
    api.getPositions(user, market.id).then(setPositions).catch(() => {});
  }, [user, market.id]);

  // Live preview
  const amount = parseFloat(tradeAmount);
  const preview = useMemo(() => {
    if (isNaN(amount) || amount <= 0 || !market.probability) return null;
    const higher = previewTrade(market.probability, market.liquidity, 'higher', amount);
    const lower = previewTrade(market.probability, market.liquidity, 'lower', amount);
    return { higher, lower };
  }, [amount, market.probability, market.liquidity]);

  const refreshPositions = () => api.getPositions(user, market.id).then(setPositions).catch(() => {});

  const handleBetDirection = async (direction: 'higher' | 'lower') => {
    if (isNaN(amount) || amount <= 0) return;
    setTrading(true);
    const result = await api.trade(user, { marketId: market.id, direction, amount, agentId })
      .catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setLastResult({ direction, shares: result.shares, cost: result.cost, consensus: result.consensus });
      setTradeAmount('');
      setTrades(prev => [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 } }]);
      api.getMarketTrades(user, market.id).then(data => setTrades(data)).catch(() => {});
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
      setTrades(prev => [...prev, { consensus: result.consensus, createdAt: { _seconds: Date.now() / 1000 } }]);
      refreshPositions();
      onTrade();
    }
  };

  const handleLiquidity = async () => {
    const a = parseFloat(liqAmount);
    if (isNaN(a) || a <= 0) return;
    const result = await api.injectLiquidity(user, market.id, a).catch((e: Error) => { onError(e.message); return null; });
    if (result) { setLiqAmount(''); onTrade(); }
  };

  const previewConsensus = (dir: 'higher' | 'lower') => {
    if (!preview) return null;
    const p = dir === 'higher' ? preview.higher.newProb : preview.lower.newProb;
    return Math.round((market.rangeMin + p * (market.rangeMax - market.rangeMin)) * 100) / 100;
  };
  const previewShares = (dir: 'higher' | 'lower') => preview ? (dir === 'higher' ? preview.higher.shares : preview.lower.shares) : null;

  return (
    <div style={{ padding: '0.75rem 0.5rem 0.5rem' }}>
      {/* Consensus chart */}
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
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const { agentId: impersonatedId } = useImpersonation();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveResult, setResolveResult] = useState('');
  const [refreshResult, setRefreshResult] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(id); }, []);
  // Track per-market preview for slider ghost
  const [hoverDir, setHoverDir] = useState<Record<string, 'higher' | 'lower' | undefined>>({});

  const [metricId, setMetricId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const [mkts, mets] = await Promise.all([
      api.getMarkets(user).catch((e: Error) => { setError(e.message); return null; }),
      api.getMetrics(user).catch(() => null),
    ]);
    if (mkts) setMarkets(mkts);
    if (mets) setMetrics(mets);
    setLoading(false);
  }, [user]);

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
    if (result) { setRefreshResult(`Created ${result.created} markets.`); load(); }
  };

  if (authLoading || !user) return <div className="loading">Loading...</div>;

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' } as const;

  return (
    <>
      <div className="header">
        <h1>Markets</h1>
        <nav className="header-nav">
          <Link to="/metrics" className="nav-link">Metrics</Link>
          <Link to="/agents" className="nav-link">Agents</Link>
          <Link to="/markets" className="nav-link active">Markets</Link>
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
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No active markets.</p></div>
        ) : (
          <div className="section">
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
                {markets.map(m => (
                  <React.Fragment key={m.id}>
                    <tr
                      style={{ borderBottom: expandedId === m.id ? 'none' : '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{m.metricName}</td>
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
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        {m.tradeCount === 0 ? (
                          <button className="btn-small" style={{ color: 'var(--delete-color, #ef4444)' }}
                            onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}>Delete</button>
                        ) : (
                          <button className="btn-small" style={{ color: 'var(--text-secondary)' }}
                            onClick={(e) => { e.stopPropagation(); handleVoid(m.id); }}>Void</button>
                        )}
                      </td>
                    </tr>
                    {expandedId === m.id && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={6} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <TradingPanel
                            market={m}
                            agentId={impersonatedId}
                            user={user}
                            onTrade={() => { load(); }}
                            onError={setError}
                          />
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

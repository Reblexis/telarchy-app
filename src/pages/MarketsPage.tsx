import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { Market, Metric, Agent } from '../types';

const inputStyle = { padding: '0.4rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', width: '80px' } as const;
const labelStyle = { display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' } as const;

function ProbabilitySlider({ probability, rangeMin, rangeMax }: { probability: number; rangeMin: number; rangeMax: number }) {
  const pct = probability * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '120px' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'right' }}>{rangeMin}</span>
      <div style={{ flex: 1, height: '8px', background: 'var(--border-color)', borderRadius: '4px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: 'var(--accent-color, #3b82f6)', borderRadius: '4px' }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '3px', height: '14px', background: 'var(--text-color)', borderRadius: '2px', transform: 'translateX(-50%)' }} />
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '28px' }}>{rangeMax}</span>
    </div>
  );
}

function TradingPanel({ market, agents, user, onTrade, onError }: {
  market: Market; agents: Agent[]; user: import('firebase/auth').User;
  onTrade: () => void; onError: (msg: string) => void;
}) {
  const [tradeAgent, setTradeAgent] = useState('');
  const [tradeAmount, setTradeAmount] = useState('');
  const [liqAmount, setLiqAmount] = useState('');
  const [tradeResult, setTradeResult] = useState('');
  const [trading, setTrading] = useState(false);

  const doTrade = async (body: Record<string, unknown>) => {
    setTrading(true);
    setTradeResult('');
    const result = await api.trade(user, body).catch((e: Error) => { onError(e.message); return null; });
    setTrading(false);
    if (result) {
      setTradeResult(`Cost: ${result.cost} | Consensus: ${result.consensus}`);
      setTradeAmount('');
      onTrade();
    }
  };

  const handleBetDirection = (direction: 'higher' | 'lower') => {
    const a = parseFloat(tradeAmount);
    if (isNaN(a) || a <= 0) return;
    doTrade({ marketId: market.id, direction, amount: a, ...(tradeAgent ? { agentId: tradeAgent } : {}) });
  };

  const handleLiquidity = async () => {
    const a = parseFloat(liqAmount);
    if (isNaN(a) || a <= 0) return;
    const result = await api.injectLiquidity(user, market.id, a).catch((e: Error) => { onError(e.message); return null; });
    if (result) {
      setLiqAmount('');
      setTradeResult(`Liquidity: ${result.liquidity}`);
      onTrade();
    }
  };

  return (
    <div style={{ padding: '0.75rem 0.5rem', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: '0.375rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div>
        <label style={labelStyle}>Agent</label>
        <select value={tradeAgent} onChange={e => setTradeAgent(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
          <option value="">Select agent...</option>
          {agents.filter(a => a.role === 'agent' || a.role === 'admin').map(a => (
            <option key={a.id} value={a.id}>{a.id} ({a.balance})</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Amount</label>
        <input type="number" value={tradeAmount} onChange={e => setTradeAmount(e.target.value)} placeholder="credits" style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <button className="btn-small" disabled={trading || !tradeAgent || !tradeAmount} onClick={() => handleBetDirection('lower')}
          style={{ background: '#ef4444', color: '#fff', padding: '0.4rem 0.6rem' }}>Lower</button>
        <button className="btn-small" disabled={trading || !tradeAgent || !tradeAmount} onClick={() => handleBetDirection('higher')}
          style={{ background: '#22c55e', color: '#fff', padding: '0.4rem 0.6rem' }}>Higher</button>
      </div>
      <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '0.75rem', display: 'flex', gap: '0.25rem', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Liquidity (b={market.liquidity})</label>
          <input type="number" value={liqAmount} onChange={e => setLiqAmount(e.target.value)} placeholder="add" style={{ ...inputStyle, width: '60px' }} />
        </div>
        <button className="btn-small" onClick={handleLiquidity} style={{ padding: '0.4rem 0.6rem' }}>Inject</button>
      </div>
      {tradeResult && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{tradeResult}</span>}
    </div>
  );
}

export function MarketsPage() {
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveResult, setResolveResult] = useState('');
  const [refreshResult, setRefreshResult] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [metricId, setMetricId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const [mkts, mets, ags] = await Promise.all([
      api.getMarkets(user).catch((e: Error) => { setError(e.message); return null; }),
      api.getMetrics(user).catch(() => null),
      api.getAgents(user).catch(() => null),
    ]);
    if (mkts) setMarkets(mkts);
    if (mets) setMetrics(mets);
    if (ags) setAgents(ags);
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
    if (result) { setRefreshResult(`Created ${result.created} markets from formula consensus references.`); load(); }
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
                  <th style={thStyle}>Probability</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Consensus</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Range</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Trades</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {markets.map(m => (
                  <React.Fragment key={m.id}>
                    <tr style={{ borderBottom: expandedId === m.id ? 'none' : '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{m.metricName}</td>
                      <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>{formatTargetDateDisplay(m.targetDate)}</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <ProbabilitySlider probability={m.probability} rangeMin={m.rangeMin} rangeMax={m.rangeMax} />
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{m.consensus ?? '—'}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {m.rangeMin}–{m.rangeMax}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{m.tradeCount}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        {m.tradeCount === 0 && (
                          <button className="btn-small" style={{ color: 'var(--delete-color, #ef4444)' }}
                            onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}>Delete</button>
                        )}
                      </td>
                    </tr>
                    {expandedId === m.id && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={7} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <TradingPanel market={m} agents={agents} user={user} onTrade={load} onError={setError} />
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

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { api } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';
import type { Market, Metric } from '../types';

function ProbabilityBar({ probabilities, rangeMin, rangeMax }: { probabilities: number[]; rangeMin: number; rangeMax: number }) {
  if (!probabilities || probabilities.length === 0) return null;
  const step = (rangeMax - rangeMin) / probabilities.length;
  const maxProb = Math.max(...probabilities, 0.01);
  return (
    <div style={{ display: 'flex', gap: '1px', alignItems: 'flex-end', height: '32px' }}>
      {probabilities.map((p, i) => (
        <div key={i} title={`${(rangeMin + i * step).toFixed(0)}-${(rangeMin + (i + 1) * step).toFixed(0)}: ${(p * 100).toFixed(1)}%`}
          style={{
            flex: 1, background: 'var(--accent-color, #3b82f6)', borderRadius: '2px 2px 0 0', opacity: 0.3 + 0.7 * (p / maxProb),
            height: `${Math.max(2, (p / maxProb) * 100)}%`, minWidth: '4px',
          }} />
      ))}
    </div>
  );
}

export function MarketsPage() {
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveResult, setResolveResult] = useState('');
  const [refreshResult, setRefreshResult] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create market form
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
    if (result) {
      setMetricId('');
      setTargetDate('');
      load();
    }
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
    if (result) {
      setResolveResult(`Resolved ${result.resolved} markets. Total payout: ${result.totalPayout} credits.`);
      load();
    }
  };

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshResult('');
    const result = await api.refreshMarkets(user).catch((e: Error) => { setError(e.message); return null; });
    if (result) {
      setRefreshResult(`Created ${result.created} markets from formula consensus references.`);
      load();
    }
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

        {/* Create market form */}
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
                  <th style={thStyle}>Distribution</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Consensus</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Range</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Trades</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {markets.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                    onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{m.metricName}</td>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>{formatTargetDateDisplay(m.targetDate)}</td>
                    <td style={{ padding: '0.75rem 0.5rem', width: '120px' }}>
                      <ProbabilityBar probabilities={m.bucketProbabilities} rangeMin={m.rangeMin} rangeMax={m.rangeMax} />
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{m.consensus ?? '—'}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {m.rangeMin}-{m.rangeMax}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{m.tradeCount}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      {m.tradeCount === 0 && (
                        <button className="btn-small" style={{ color: 'var(--delete-color, #ef4444)' }}
                          onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

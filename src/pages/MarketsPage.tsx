import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { useInspectMode } from '../hooks/useInspectMode';
import { previewTrade } from '../lib/amm';
import { formatTargetDateDisplay, formatTimeRemaining, endOfPeriod } from '../lib/date-utils';
import { HookStatus } from '../components/HookStatus';
import { MarketActivityPanel } from '../components/MarketActivityPanel';
import { ProbabilitySlider } from '../components/ProbabilitySlider';
import type { Market, MarketStatus, Metric } from '../types';

export function MarketsPage() {
  const { user } = useAuth();
  const { inspectTask } = useInspectMode();
  const { workspace } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, Metric>>(new Map());
  const [mainMarketsMap, setMainMarketsMap] = useState<Map<string, Market>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveResult, setResolveResult] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(id); }, []);
  const [hoverDir, setHoverDir] = useState<Record<string, 'higher' | 'lower' | undefined>>({});

  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<MarketStatus | 'all'>('open');
  const [bulkLiqAmount, setBulkLiqAmount] = useState('');
  const [bulkLiqResult, setBulkLiqResult] = useState('');
  const statusCounts = useMemo(() => {
    const counts: Record<MarketStatus | 'all', number> = { all: markets.length, open: 0, resolved: 0, voided: 0, closed: 0 };
    for (const m of markets) counts[m.status]++;
    return counts;
  }, [markets]);
  const filteredMarkets = useMemo(() => {
    let result = statusFilter === 'all' ? markets : markets.filter(m => m.status === statusFilter);
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(m => m.metricName.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => endOfPeriod(a.targetDate).localeCompare(endOfPeriod(b.targetDate)));
  }, [markets, filterText, statusFilter]);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    if (!inspectTask) {
      const cachedMkts = cacheGet<Market[]>('markets');
      if (cachedMkts) { setMarkets(cachedMkts); setLoading(false); }
    }
    const mkts = await api.getMarkets(inspectTask?.id, undefined, { includeResolved: true }).catch((e: Error) => { setError(e.message); return null; });
    if (inspectTask) {
      api.getMarkets().then((mains: Market[]) => {
        const map = new Map<string, Market>();
        for (const m of mains) map.set(`${m.metricId}:${m.targetDate}`, m);
        setMainMarketsMap(map);
      }).catch((e: Error) => setError(e.message));
    } else {
      setMainMarketsMap(new Map());
    }
    if (mkts) {
      setMarkets(mkts);
      if (!inspectTask) cacheSet('markets', mkts);
    }
    api.getStatus().then((status: { metrics: Metric[] }) => {
      const map = new Map<string, Metric>();
      for (const m of status.metrics) map.set(m.id, m);
      setMetricsMap(map);
    }).catch(() => {});
    setLoading(false);
  }, [user, inspectTask]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!user) return;
    setError('');
    await api.deleteMarket(id).catch((e: Error) => { setError(e.message); });
    load();
  };

  const handleVoid = async (id: string) => {
    if (!user) return;
    setError('');
    const result = await api.voidMarket(id).catch((e: Error) => { setError(e.message); return null; });
    if (result) { setResolveResult(`Market cancelled. Refunded $${result.refunded}.`); load(); }
  };

  const handleResolveOne = async (id: string) => {
    if (!user) return;
    setError('');
    const result = await api.resolveMarket(id).catch((e: Error) => { setError(e.message); return null; });
    if (result?.resolved) { setResolveResult(`Market closed. Total payout: $${result.totalPayout}.`); load(); }
  };

  const handleBulkLiquidity = async () => {
    if (!user) return;
    const a = parseFloat(bulkLiqAmount);
    if (isNaN(a) || a <= 0) return;
    setError('');
    setBulkLiqResult('');
    const result = await api.injectLiquidityBulk(a, inspectTask?.id).catch((e: Error) => { setError(e.message); return null; });
    if (result) {
      setBulkLiqAmount('');
      setBulkLiqResult(`Funded ${a} into ${result.markets} markets (total: ${result.totalCost.toFixed(6)} credits).`);
      load();
    }
  };

  if (!user) return null;

  const thStyle = { padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' } as const;

  return (
    <div className="container">
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <HookStatus />
          </div>
        )}
        {error && <div className="message error show">{error}</div>}
        {resolveResult && <div className="message success show">{resolveResult}</div>}
        {bulkLiqResult && <div className="message success show">{bulkLiqResult}</div>}

        {loading ? (
          <div className="loading">Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No markets.</p></div>
        ) : (
          <div className="section">
            <div className="filter-bar">
              <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Search metrics..."
                style={{ width: '200px', height: '30px', fontSize: '0.85rem' }} />
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {(['open', 'resolved', 'voided', 'closed', 'all'] as const).map(s => (
                  <button key={s} className="btn-small"
                    style={{ fontWeight: statusFilter === s ? 600 : 400, opacity: statusFilter === s ? 1 : 0.6, textTransform: 'capitalize' }}
                    onClick={() => setStatusFilter(s)}>
                    {s} ({statusCounts[s]})
                  </button>
                ))}
              </div>
              {isAdmin && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {(() => {
                    const activeCount = markets.filter(m => m.active).length;
                    const a = parseFloat(bulkLiqAmount);
                    const total = !isNaN(a) && a > 0 ? a * activeCount : null;
                    return <>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', margin: 0 }}>
                        Fund all ({activeCount}):
                      </label>
                      <input type="number" value={bulkLiqAmount} onChange={e => setBulkLiqAmount(e.target.value)} placeholder="amount"
                        style={{ width: '80px', height: '30px', fontSize: '0.85rem' }} />
                      <button className="btn-small" onClick={handleBulkLiquidity} disabled={!bulkLiqAmount || parseFloat(bulkLiqAmount) <= 0}>
                        {total !== null ? `Fund (${total} credits)` : 'Fund'}
                      </button>
                    </>;
                  })()}
                </div>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={thStyle}>Metric</th>
                  <th style={thStyle}>Target Date</th>
                  <th style={thStyle}>Prediction</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {filteredMarkets.map(m => (
                  <React.Fragment key={m.id}>
                    <tr
                      style={{ borderBottom: expandedIds.includes(m.id) ? 'none' : '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => setExpandedIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                        {m.metricName}
                        {m.status !== 'open' && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 500, color: m.status === 'resolved' ? 'var(--success-text, #22c55e)' : m.status === 'voided' ? 'var(--warning-text, #f59e0b)' : 'var(--text-secondary)', background: 'var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.1rem 0.35rem', verticalAlign: 'middle' }}>{m.status}</span>}
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
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, minWidth: '42px' }}>{m.consensus ?? '-'}</span>
                          {inspectTask && (() => {
                            const main = mainMarketsMap.get(`${m.metricId}:${m.targetDate}`);
                            if (!main || m.consensus === null || main.consensus === null) return null;
                            const delta = m.consensus - main.consensus;
                            if (Math.abs(delta) < 0.005) return null;
                            return (
                              <span style={{ fontSize: '0.72rem', color: delta > 0 ? 'var(--success-text)' : 'var(--error-text)', fontFamily: 'monospace' }}>
                                {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
                                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.2rem' }}>({main.consensus})</span>
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isAdmin && <>
                          <button className="btn-small" style={{ color: 'var(--accent-color, #3b82f6)', marginRight: '0.25rem' }}
                            onClick={(e) => { e.stopPropagation(); handleResolveOne(m.id); }}>Close</button>
                          {m.tradeCount === 0 ? (
                            <button className="btn-small" style={{ color: 'var(--delete-color, #ef4444)' }}
                              onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}>Delete</button>
                          ) : (
                            <button className="btn-small" style={{ color: 'var(--text-secondary)' }}
                              onClick={(e) => { e.stopPropagation(); handleVoid(m.id); }}>Cancel</button>
                          )}
                        </>}
                      </td>
                    </tr>
                    {expandedIds.includes(m.id) && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={4} style={{ padding: '0 0.5rem 0.75rem' }}>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                            {m.status === 'open' ? 'Trading is performed in the marketplace.' :
                             m.status === 'resolved' ? `Resolved at ${m.actualValue?.toFixed(2) ?? 'N/A'} on ${m.resolvedAt ? new Date(m.resolvedAt).toLocaleDateString() : 'unknown'}.` :
                             m.status === 'voided' ? 'This market was cancelled. All positions were refunded at cost.' :
                             'Trading is halted (metric no longer schedules this target date), but positions are retained and will resolve normally when the target date passes.'}
                          </p>
                          <MarketActivityPanel
                            market={m}
                            onError={setError}
                            metricValue={metricsMap.get(m.metricId)?.total}
                            isAdmin={isAdmin}
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
  );
}

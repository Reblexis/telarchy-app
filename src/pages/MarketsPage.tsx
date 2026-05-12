import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { useInspectMode } from '../hooks/useInspectMode';
import { previewTrade } from '../lib/amm';
import { formatTargetDateDisplay, formatTimeRemaining, endOfPeriod } from '../lib/date-utils';
import { useSortableRows } from '../lib/sort';
import { HookStatus } from '../components/HookStatus';
import { TradingPanel } from '../components/TradingPanel';
import { MarketComments } from '../components/MarketComments';
import { ProbabilitySlider } from '../components/ProbabilitySlider';
import { InspectIndicator } from '../components/InspectIndicator';
import type { Market, MarketStatus, Metric } from '../types';

type SortKey = 'metric' | 'target' | 'prediction';

const SORT_LABELS: Record<SortKey, string> = {
  target: 'Target date',
  metric: 'Metric',
  prediction: 'Prediction',
};

export function MarketsPage() {
  const { user } = useAuth();
  const { inspectProposal } = useInspectMode();
  const { workspace } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';
  const [markets, setMarkets] = useState<Market[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, Metric>>(new Map());
  const [mainMarketsMap, setMainMarketsMap] = useState<Map<string, Market>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(id); }, []);
  const [hoverDir] = useState<Record<string, 'higher' | 'lower' | undefined>>({});

  const [searchParams] = useSearchParams();
  const [filterText, setFilterText] = useState(() => searchParams.get('q') ?? '');
  const [targetFilter, setTargetFilter] = useState(() => searchParams.get('target') ?? '');
  const [statusFilter, setStatusFilter] = useState<MarketStatus | 'all'>(() => searchParams.get('target') ? 'all' : 'open');
  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    const t = searchParams.get('target') ?? '';
    setFilterText(q);
    setTargetFilter(t);
    if (t) setStatusFilter('all');
  }, [searchParams]);
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
    if (targetFilter) {
      result = result.filter(m => m.targetDate === targetFilter);
    }
    return result;
  }, [markets, filterText, targetFilter, statusFilter]);

  const { sorted: sortedMarkets, sort: marketSort, toggle: toggleMarketSort } = useSortableRows<Market, SortKey>(
    filteredMarkets,
    {
      metric: m => m.metricName.toLowerCase(),
      target: m => endOfPeriod(m.targetDate),
      prediction: m => m.consensus ?? -Infinity,
    },
    { key: 'target', dir: 'asc' },
  );

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    if (!inspectProposal) {
      const cachedMkts = cacheGet<Market[]>('markets');
      if (cachedMkts) { setMarkets(cachedMkts); setLoading(false); }
    }
    const mkts = await api.getMarkets(inspectProposal?.id, undefined, { includeResolved: true }).catch((e: Error) => { setError(e.message); return null; });
    if (inspectProposal) {
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
      if (!inspectProposal) cacheSet('markets', mkts);
    }
    api.getStatus().then((status: { metrics: Metric[] }) => {
      const map = new Map<string, Metric>();
      for (const m of status.metrics) map.set(m.id, m);
      setMetricsMap(map);
    }).catch((e: Error) => { console.error('Failed to load metric status', e); });
    setLoading(false);
  }, [user, inspectProposal]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!targetFilter || markets.length === 0) return;
    const matches = markets.filter(m => m.targetDate === targetFilter && (!filterText || m.metricName.toLowerCase().includes(filterText.toLowerCase())));
    if (matches.length === 0) return;
    setExpandedIds(prev => {
      const next = new Set(prev);
      for (const m of matches) next.add(m.id);
      return Array.from(next);
    });
  }, [targetFilter, filterText, markets]);

  const handleBulkLiquidity = async () => {
    if (!user) return;
    const a = parseFloat(bulkLiqAmount);
    if (isNaN(a) || a <= 0) return;
    setError('');
    setBulkLiqResult('');
    const result = await api.injectLiquidityBulk(a, inspectProposal?.id).catch((e: Error) => { setError(e.message); return null; });
    if (result) {
      setBulkLiqAmount('');
      setBulkLiqResult(`Funded ${a} into ${result.markets} markets (total: ${result.totalCost.toFixed(6)} credits).`);
      load();
    }
  };

  if (!user) return null;

  const activeCount = markets.filter(m => m.active).length;
  const bulkAmountParsed = parseFloat(bulkLiqAmount);
  const bulkTotal = !isNaN(bulkAmountParsed) && bulkAmountParsed > 0 ? bulkAmountParsed * activeCount : null;

  return (
    <div className="container">
      <div className="section-header">
        <div className="section-header-row">
          <h2>Markets</h2>
          <InspectIndicator />
        </div>
        <p className="section-subtitle">
          Prediction markets for this workspace's metrics. Tap a market to view its trade history and place orders.
        </p>
      </div>

      {isAdmin && <div style={{ marginBottom: '1rem' }}><HookStatus /></div>}
      {error && <div className="message error show">{error}</div>}
      {bulkLiqResult && <div className="message success show">{bulkLiqResult}</div>}

      {loading ? (
        <div className="loading">Loading markets...</div>
      ) : markets.length === 0 ? (
        <div className="section">
          <p className="section-subtitle">No markets yet. Markets appear here once metrics have target dates to forecast.</p>
        </div>
      ) : (
        <div className="section">
          <div className="markets-toolbar">
            <div className="markets-filter-row">
              <input
                type="text"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                placeholder="Search metrics..."
                className="markets-search"
              />
              {targetFilter && (
                <span className="markets-target-pill">
                  Target: {formatTargetDateDisplay(targetFilter)}
                  <button type="button" onClick={() => setTargetFilter('')} aria-label="Clear target filter">×</button>
                </span>
              )}
              <div className="markets-chips">
                {(['open', 'resolved', 'voided', 'closed', 'all'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`markets-chip${statusFilter === s ? ' active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    <span style={{ textTransform: 'capitalize' }}>{s}</span>
                    <span className="markets-chip-count">{statusCounts[s]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="markets-filter-row">
              <div className="markets-sort">
                <span className="markets-sort-label">Sort</span>
                {(Object.keys(SORT_LABELS) as SortKey[]).map(key => {
                  const isActive = marketSort.key === key;
                  const arrow = isActive ? (marketSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`markets-sort-btn${isActive ? ' active' : ''}`}
                      onClick={() => toggleMarketSort(key)}
                    >
                      {SORT_LABELS[key]}{arrow}
                    </button>
                  );
                })}
              </div>
            </div>

            {isAdmin && (
              <div className="markets-admin-row">
                <label>Fund all open markets ({activeCount}):</label>
                <input
                  type="number"
                  value={bulkLiqAmount}
                  onChange={e => setBulkLiqAmount(e.target.value)}
                  placeholder="amount"
                />
                <button
                  className="btn-small"
                  onClick={handleBulkLiquidity}
                  disabled={!bulkLiqAmount || bulkAmountParsed <= 0}
                >
                  {bulkTotal !== null ? `Fund (${bulkTotal} credits)` : 'Fund'}
                </button>
              </div>
            )}
          </div>

          {sortedMarkets.length === 0 ? (
            <div className="markets-empty">No markets match the current filters.</div>
          ) : (
            <div className="markets-list">
              {sortedMarkets.map(m => {
                const expanded = expandedIds.includes(m.id);
                const timeRemaining = m.status === 'open' ? formatTimeRemaining(m.targetDate) : null;
                const expired = timeRemaining === 'expired';
                const main = inspectProposal ? mainMarketsMap.get(`${m.metricId}:${m.targetDate}`) : null;
                const delta = main && m.consensus !== null && main.consensus !== null && Math.abs(m.consensus - main.consensus) >= 0.005
                  ? m.consensus - main.consensus
                  : null;

                return (
                  <div
                    key={m.id}
                    className={`market-card${expanded ? ' expanded' : ''}`}
                    onClick={() => setExpandedIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                  >
                    <div className="market-card-head">
                      <div className="market-head-name">
                        <span className="market-metric-name">{m.metricName}</span>
                        <span className={`market-status-badge market-status-${m.status}`}>{m.status}</span>
                      </div>

                      <div className="market-head-target">
                        <span>{formatTargetDateDisplay(m.targetDate)}</span>
                        {timeRemaining && (
                          <>
                            <span className="dot">·</span>
                            <span className={`time-remaining${expired ? ' expired' : ''}`}>{timeRemaining}</span>
                          </>
                        )}
                      </div>

                      <div className="market-head-prediction">
                        <div className="slider-wrap">
                          <ProbabilitySlider
                            probability={m.probability}
                            rangeMin={m.rangeMin}
                            rangeMax={m.rangeMax}
                            previewProb={hoverDir[m.id] ? previewTrade(m.probability, m.liquidity, hoverDir[m.id]!, 50).newProb : undefined}
                            fullWidth
                          />
                        </div>
                        <span className="market-consensus">{m.consensus ?? '-'}</span>
                        {delta !== null && main && main.consensus !== null && (
                          <span className={`market-delta ${delta > 0 ? 'pos' : 'neg'}`}>
                            {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
                            <span className="market-delta-baseline">({main.consensus})</span>
                          </span>
                        )}
                      </div>

                    </div>

                    {expanded && (
                      <div className="market-card-expanded" onClick={e => e.stopPropagation()}>
                        <TradingPanel
                          market={m}
                          showLiquidityControls={isAdmin}
                          metricValue={metricsMap.get(m.metricId)?.total}
                          onTrade={() => { void load(); }}
                          onError={setError}
                        />
                        <MarketComments marketId={m.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

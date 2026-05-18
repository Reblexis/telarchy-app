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
import { FirstSeenHint } from '../components/FirstSeenHint';
import type { Market, MarketStatus, Metric, Proposal } from '../types';

type SortKey = 'metric' | 'target' | 'prediction';
type MarketKind = 'baseline' | 'conditional' | 'all';

const SORT_LABELS: Record<SortKey, string> = {
  target: 'Target date',
  metric: 'Metric',
  prediction: 'Prediction',
};

const KIND_LABELS: Record<MarketKind, string> = {
  baseline: 'Baseline',
  conditional: 'Conditional',
  all: 'All',
};

export function MarketsPage() {
  const { user } = useAuth();
  const { inspectProposal, setInspectProposal } = useInspectMode();
  const { workspace, allWorkspaces, switchWorkspace } = useWorkspace(!!user);
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

  const [searchParams, setSearchParams] = useSearchParams();
  const [filterText, setFilterText] = useState(() => searchParams.get('q') ?? '');
  const [targetFilter, setTargetFilter] = useState(() => searchParams.get('target') ?? '');
  const [statusFilter, setStatusFilter] = useState<MarketStatus | 'all'>(() =>
    searchParams.get('target') || searchParams.get('marketId') ? 'all' : 'open',
  );
  const [kindFilter, setKindFilter] = useState<MarketKind>(() => {
    const raw = searchParams.get('kind');
    return raw === 'conditional' || raw === 'all' ? raw : 'baseline';
  });
  const [proposalsById, setProposalsById] = useState<Map<string, Proposal>>(new Map());
  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    const t = searchParams.get('target') ?? '';
    setFilterText(q);
    setTargetFilter(t);
    if (t || searchParams.get('marketId')) setStatusFilter('all');
    const rawKind = searchParams.get('kind');
    setKindFilter(rawKind === 'conditional' || rawKind === 'all' ? rawKind : 'baseline');
  }, [searchParams]);

  // Deep-link handoff from /participants/:id (and any other source): if
  // ?workspace=<id> names a workspace the user belongs to and it isn't the
  // active one, switch to it and reload at the same URL so ?marketId=<id>
  // resolves against the right workspace's markets.
  useEffect(() => {
    const targetWs = searchParams.get('workspace');
    if (!targetWs || !workspace) return;
    if (targetWs === workspace.workspaceId) {
      const next = new URLSearchParams(searchParams);
      next.delete('workspace');
      setSearchParams(next, { replace: true });
      return;
    }
    if (allWorkspaces.some(w => w.id === targetWs)) {
      const next = new URLSearchParams(searchParams);
      next.delete('workspace');
      switchWorkspace(targetWs, `/markets?${next.toString()}`);
    }
  }, [searchParams, workspace, allWorkspaces, switchWorkspace, setSearchParams]);

  useEffect(() => {
    const marketId = searchParams.get('marketId');
    if (!marketId || markets.length === 0) return;
    if (!markets.find(m => m.id === marketId)) return;
    setExpandedIds(prev => (prev.includes(marketId) ? prev : [...prev, marketId]));
    const next = new URLSearchParams(searchParams);
    next.delete('marketId');
    setSearchParams(next, { replace: true });
    requestAnimationFrame(() => {
      const el = document.getElementById(`market-${marketId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [searchParams, markets, setSearchParams]);
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
    // Cache only the default view (no inspect, baseline kind) — other views
    // are too varied to cache usefully and showing a stale conditional list
    // would be misleading.
    const isDefaultView = !inspectProposal && kindFilter === 'baseline';
    if (isDefaultView) {
      const cachedMkts = cacheGet<Market[]>('markets');
      if (cachedMkts) { setMarkets(cachedMkts); setLoading(false); }
    }
    // includeResolved=true returns open + closed + resolved but excludes
    // voided (which are noise here — refunded duplicates / cancelled
    // conditional markets). To inspect voided rows, hit the API directly.
    const mkts = await api.getMarkets(inspectProposal?.id, undefined, { includeResolved: true, kind: kindFilter })
      .catch((e: Error) => { setError(e.message); return null; });
    if (inspectProposal) {
      // Use includeResolved=true so the conditional-vs-baseline comparison
      // still works when the baseline market at a target date has already
      // closed or resolved.
      api.getMarkets(undefined, undefined, { includeResolved: true }).then((mains: Market[]) => {
        const map = new Map<string, Market>();
        for (const m of mains) map.set(`${m.metricId}:${m.targetDate}`, m);
        setMainMarketsMap(map);
      }).catch((e: Error) => setError(e.message));
    } else {
      setMainMarketsMap(new Map());
    }
    if (mkts) {
      setMarkets(mkts);
      if (isDefaultView) cacheSet('markets', mkts);
    }
    api.getStatus().then((status: { metrics: Metric[] }) => {
      const map = new Map<string, Metric>();
      for (const m of status.metrics) map.set(m.id, m);
      setMetricsMap(map);
    }).catch((e: Error) => { console.error('Failed to load metric status', e); });
    setLoading(false);
  }, [user, inspectProposal, kindFilter]);

  // Fetch proposal titles when we'll be showing conditional rows so each
  // gets a readable "from X" chip instead of a UUID. Inspect mode already
  // pins to one proposal so the chip is redundant there.
  useEffect(() => {
    if (inspectProposal || kindFilter === 'baseline') return;
    api.getProposals().then((rows: Proposal[]) => {
      setProposalsById(new Map(rows.map(p => [p.id, p])));
    }).catch((e: Error) => { console.error('Failed to load proposals for market chips', e); });
  }, [inspectProposal, kindFilter]);

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

  const setKindFilterAndUrl = useCallback((next: MarketKind) => {
    setKindFilter(next);
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      if (next === 'baseline') sp.delete('kind');
      else sp.set('kind', next);
      return sp;
    }, { replace: true });
  }, [setSearchParams]);

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

            {!inspectProposal && (
              <div className="markets-filter-row">
                <span className="markets-sort-label">Kind</span>
                <div className="markets-chips">
                  {(['baseline', 'conditional', 'all'] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`markets-chip${kindFilter === k ? ' active' : ''}`}
                      onClick={() => setKindFilterAndUrl(k)}
                      title={
                        k === 'baseline' ? 'Live markets that aren\'t tied to a proposal.'
                        : k === 'conditional' ? 'Markets attached to a proposal — what the metric would look like if the proposal is approved.'
                        : 'Both baseline and conditional in one list.'
                      }
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
              <FirstSeenHint
                hintKey="markets-list"
                target=".market-card"
                title="Trade a forecast"
                body={
                  <>
                    Every priced market across every proposal is here. Click a card
                    to expand it, then place a trade to put your forecast on the
                    record. Correct forecasts earn credits; wrong ones cost them.
                  </>
                }
              />
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
                    id={`market-${m.id}`}
                    className={`market-card${expanded ? ' expanded' : ''}`}
                    onClick={() => setExpandedIds(prev => prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id])}
                  >
                    <div className="market-card-head">
                      <div className="market-head-name">
                        <span className="market-metric-name">{m.metricName}</span>
                        <span className={`market-status-badge market-status-${m.status}`}>{m.status}</span>
                        {!inspectProposal && m.proposalId && (() => {
                          const prop = proposalsById.get(m.proposalId);
                          const label = prop ? prop.title : `proposal ${m.proposalId.slice(0, 8)}…`;
                          return (
                            <button
                              type="button"
                              className="market-proposal-chip"
                              title="Conditional market — click to enter the proposal lens."
                              onClick={e => {
                                e.stopPropagation();
                                setInspectProposal({ id: m.proposalId!, title: prop?.title ?? m.proposalId! });
                              }}
                            >
                              from {label}
                            </button>
                          );
                        })()}
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

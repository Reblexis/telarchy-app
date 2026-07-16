import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type MarketplaceListing } from '../lib/api';
import { TradingPanel } from '../components/TradingPanel';
import { ProbabilitySlider } from '../components/ProbabilitySlider';
import { useAuth } from '../hooks/useAuth';
import { endOfPeriod, formatTargetDateDisplay, formatTimeRemaining } from '../lib/date-utils';
import { resolutionPayouts } from '../lib/amm';
import type { Market, Position } from '../types';

interface ParticipantSummary {
  id: string;
  balance: number;
}

interface WorkspaceMembership {
  id: string;
  name: string;
  memberRole: string;
}

interface PositionRow {
  workspaceId: string;
  workspaceName: string;
  market: Market;
  position: Position;
}

interface MarketRow {
  workspaceId: string;
  workspaceName: string;
  market: Market;
}

interface DiscoverRow {
  workspaceId: string;
  workspaceName: string;
  preview: MarketplaceListing[];
  totalMarkets: number;
}

function compactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.01) return value.toFixed(4).replace(/\.?0+$/, '');
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function formatSignedDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${compactNumber(value)}`;
}

function payoutAtConsensus(market: Market, direction: 'higher' | 'lower', shares: number): number | null {
  if (market.consensus == null) return null;
  const clamped = Math.max(market.rangeMin, Math.min(market.rangeMax, market.consensus));
  const [lp, hp] = resolutionPayouts(clamped, market.rangeMin, market.rangeMax);
  return shares * (direction === 'higher' ? hp : lp);
}

function compareMarketsByResolution(a: { market: Market }, b: { market: Market }): number {
  const dateDiff = endOfPeriod(a.market.targetDate).localeCompare(endOfPeriod(b.market.targetDate));
  if (dateDiff !== 0) return dateDiff;
  return b.market.liquidity - a.market.liquidity;
}

function displayName(user: { name?: string | null; email?: string | null } | null, fallback: string): string {
  if (user?.name && user.name !== user.email) return user.name;
  if (user?.email) return user.email;
  return fallback;
}

function PositionCard({ row, onTrade, onError }: {
  row: PositionRow;
  onTrade: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { market, position, workspaceName, workspaceId } = row;
  const time = market.status === 'open' ? formatTimeRemaining(market.targetDate) : null;
  const expired = time === 'expired';

  const payout = payoutAtConsensus(market, position.direction, position.shares);
  const pl = payout != null ? payout - position.totalCost : null;
  const dirSymbol = position.direction === 'higher' ? '▲' : '▼';
  const plClass = pl == null ? '' : pl >= 0 ? 'pos' : 'neg';

  return (
    <div
      className={`market-card${expanded ? ' expanded' : ''}`}
      onClick={() => setExpanded(open => !open)}
    >
      <div className="market-card-head">
        <div className="market-head-name">
          <span className="market-metric-name">{market.metricName}</span>
          <span className={`market-status-badge market-status-${market.status}`}>{market.status}</span>
        </div>

        <div className="market-head-target">
          <span className="market-workspace-tag">{workspaceName}</span>
          <span className="dot">·</span>
          <span>{formatTargetDateDisplay(market.targetDate)}</span>
          {time && (
            <>
              <span className="dot">·</span>
              <span className={`time-remaining${expired ? ' expired' : ''}`}>{time}</span>
            </>
          )}
        </div>

        <div className="market-head-prediction">
          <span className={`market-position-pill market-position-${position.direction}`}>
            {dirSymbol} {compactNumber(position.shares)}
          </span>
          <span className="market-consensus">{market.consensus != null ? compactNumber(market.consensus) : '-'}</span>
          {pl != null && (
            <span className={`market-delta ${plClass}`}>
              {formatSignedDelta(pl)}
              <span className="market-delta-baseline">(cost {compactNumber(position.totalCost)})</span>
            </span>
          )}
        </div>
      </div>
      {expanded && (
        <div className="market-card-expanded" onClick={e => e.stopPropagation()}>
          <TradingPanel
            market={market}
            workspaceId={workspaceId}
            showLiquidityControls={false}
            onTrade={onTrade}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}

function WorkspaceMarketCard({ row, onTrade, onError }: {
  row: MarketRow;
  onTrade: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { market, workspaceName, workspaceId } = row;
  const time = market.status === 'open' ? formatTimeRemaining(market.targetDate) : null;
  const expired = time === 'expired';

  return (
    <div
      className={`market-card${expanded ? ' expanded' : ''}`}
      onClick={() => setExpanded(open => !open)}
    >
      <div className="market-card-head">
        <div className="market-head-name">
          <span className="market-metric-name">{market.metricName}</span>
          <span className={`market-status-badge market-status-${market.status}`}>{market.status}</span>
        </div>

        <div className="market-head-target">
          <span className="market-workspace-tag">{workspaceName}</span>
          <span className="dot">·</span>
          <span>{formatTargetDateDisplay(market.targetDate)}</span>
          {time && (
            <>
              <span className="dot">·</span>
              <span className={`time-remaining${expired ? ' expired' : ''}`}>{time}</span>
            </>
          )}
        </div>

        <div className="market-head-prediction">
          <div className="slider-wrap">
            <ProbabilitySlider
              probability={market.probability}
              rangeMin={market.rangeMin}
              rangeMax={market.rangeMax}
              fullWidth
            />
          </div>
          <span className="market-consensus">{market.consensus != null ? compactNumber(market.consensus) : '-'}</span>
        </div>
      </div>
      {expanded && (
        <div className="market-card-expanded" onClick={e => e.stopPropagation()}>
          <TradingPanel
            market={market}
            workspaceId={workspaceId}
            showLiquidityControls={false}
            onTrade={onTrade}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}

function DiscoverWorkspaceCard({ row, onJoined, onSignup }: {
  row: DiscoverRow;
  onJoined: () => void;
  onSignup: () => void;
}) {
  const { user } = useAuth();
  const [state, setState] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [resultRole, setResultRole] = useState<string | null>(null);

  const handleJoin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { onSignup(); return; }
    setState('joining');
    try {
      const result = await api.joinWorkspace(row.workspaceId) as { role?: string };
      setResultRole(result?.role ?? 'member');
      setState('joined');
      onJoined();
    } catch (err) {
      setErrMsg((err as Error).message || 'Failed to join');
      setState('error');
    }
  };

  return (
    <div className="market-card discover-card">
      <div className="market-card-head">
        <div className="market-head-name">
          <span className="market-metric-name">{row.workspaceName}</span>
          <span className="market-meta">
            {row.totalMarkets} {row.totalMarkets === 1 ? 'market' : 'markets'}
          </span>
        </div>
        <div className="market-head-actions">
          {state === 'joined' ? (
            <span className="market-join-status">✓ joined as {resultRole ?? 'member'}</span>
          ) : state === 'error' ? (
            <span className="market-join-status err">{errMsg}</span>
          ) : (
            <button
              className="btn-small"
              onClick={handleJoin}
              disabled={state === 'joining'}
            >
              {state === 'joining' ? 'joining…' : user ? 'join' : 'sign up to join'}
            </button>
          )}
        </div>
      </div>
      {row.preview.length > 0 && (
        <ul className="discover-preview">
          {row.preview.map(m => (
            <li key={m.marketId}>
              <span className="discover-preview-name">{m.metricName}</span>
              <span className="discover-preview-target">{formatTargetDateDisplay(m.targetDate)}</span>
              <span className="discover-preview-consensus">
                {m.consensus != null ? compactNumber(m.consensus) : '-'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MarketplacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [participant, setParticipant] = useState<ParticipantSummary | null>(null);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [workspaceMarkets, setWorkspaceMarkets] = useState<MarketRow[]>([]);
  const [discover, setDiscover] = useState<DiscoverRow[]>([]);
  const [stats, setStats] = useState<{ marketsActive: number; agentsActive: number; tradesThisWeek: number } | null>(null);
  const [loadingPersonal, setLoadingPersonal] = useState(false);
  const [loadingDiscover, setLoadingDiscover] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeWorkspaceFilter, setActiveWorkspaceFilter] = useState<string>('all');

  const handleSignup = useCallback(() => navigate('/signup'), [navigate]);

  const loadPersonal = useCallback(async () => {
    if (!user) {
      setParticipant(null);
      setMemberships([]);
      setPositions([]);
      setWorkspaceMarkets([]);
      setLoadingPersonal(false);
      return;
    }
    setLoadingPersonal(true);
    setError('');
    try {
      await api.getProfile().catch((e: Error) => console.error('getProfile failed:', e.message));
      const [me, workspaces] = await Promise.all([
        api.getParticipant().catch(() => null) as Promise<ParticipantSummary | null>,
        api.listWorkspaces().catch((e: Error) => {
          console.error('listWorkspaces failed:', e.message);
          return [] as WorkspaceMembership[];
        }) as Promise<WorkspaceMembership[]>,
      ]);
      setParticipant(me);
      setMemberships(workspaces);

      const tradable = workspaces.filter(w => w.memberRole !== 'viewer');
      const perWorkspace = await Promise.all(tradable.map(async w => {
        const [markets, ps] = await Promise.all([
          // status='all' here because the held-position rows below need to
          // render markets you hold shares on even after they close or resolve.
          // The open-list rendering still filters on m.status === 'open'.
          api.getMarkets(undefined, w.id, { status: 'all' }).catch((e: Error) => {
            console.error(`getMarkets(${w.id}) failed:`, e.message);
            return [] as Market[];
          }) as Promise<Market[]>,
          api.getPositions(undefined, undefined, w.id).catch((e: Error) => {
            console.error(`getPositions(${w.id}) failed:`, e.message);
            return [] as Position[];
          }) as Promise<Position[]>,
        ]);
        return { workspace: w, markets, positions: ps };
      }));

      const heldRows: PositionRow[] = [];
      const openRows: MarketRow[] = [];
      for (const { workspace, markets, positions: ps } of perWorkspace) {
        const heldByMarket = new Map<string, Position>();
        for (const p of ps) {
          if (p.shares > 0) heldByMarket.set(`${p.marketId}:${p.direction}`, p);
        }
        for (const m of markets) {
          const heldHigher = heldByMarket.get(`${m.id}:higher`);
          const heldLower = heldByMarket.get(`${m.id}:lower`);
          const held = [heldHigher, heldLower].filter((p): p is Position => Boolean(p));
          if (held.length > 0) {
            for (const p of held) {
              heldRows.push({ workspaceId: workspace.id, workspaceName: workspace.name, market: m, position: p });
            }
          } else if (m.status === 'open') {
            openRows.push({ workspaceId: workspace.id, workspaceName: workspace.name, market: m });
          }
        }
      }

      heldRows.sort((a, b) => {
        const aResolved = a.market.status !== 'open';
        const bResolved = b.market.status !== 'open';
        if (aResolved !== bResolved) return aResolved ? 1 : -1;
        return endOfPeriod(a.market.targetDate).localeCompare(endOfPeriod(b.market.targetDate));
      });
      openRows.sort(compareMarketsByResolution);

      setPositions(heldRows);
      setWorkspaceMarkets(openRows);
    } catch (e) {
      setError((e as Error).message || 'Failed to load your markets');
    } finally {
      setLoadingPersonal(false);
    }
  }, [user]);

  const loadDiscover = useCallback(async () => {
    setLoadingDiscover(true);
    try {
      const listings = await api.getMarketplace().catch(() => [] as MarketplaceListing[]);
      const grouped = new Map<string, DiscoverRow>();
      for (const m of listings) {
        const existing = grouped.get(m.workspaceId);
        if (existing) {
          existing.totalMarkets += 1;
          if (existing.preview.length < 2) existing.preview.push(m);
        } else {
          grouped.set(m.workspaceId, {
            workspaceId: m.workspaceId,
            workspaceName: m.workspaceName,
            preview: [m],
            totalMarkets: 1,
          });
        }
      }
      setDiscover(Array.from(grouped.values()));
    } catch (e) {
      console.error('loadDiscover failed:', (e as Error).message);
    } finally {
      setLoadingDiscover(false);
    }
  }, []);

  useEffect(() => { void loadPersonal(); }, [loadPersonal]);
  useEffect(() => { void loadDiscover(); }, [loadDiscover]);
  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch((e: Error) => console.error('getStats failed:', e.message));
  }, []);

  // Share-link handoff: ?workspace=<id> pre-fills the search so the targeted
  // workspace is the only thing on screen. Kept for backwards-compat with
  // existing share URLs (see qa/browse/00-anonymous/marketplace-public.md T4).
  useEffect(() => {
    const wsId = new URLSearchParams(window.location.search).get('workspace');
    if (!wsId) return;
    const fromMembership = memberships.find(w => w.id === wsId);
    if (fromMembership) { setSearch(fromMembership.name); setActiveWorkspaceFilter(wsId); return; }
    const fromDiscover = discover.find(d => d.workspaceId === wsId);
    if (fromDiscover) setSearch(fromDiscover.workspaceName);
  }, [memberships, discover]);

  const joinedWorkspaceIds = useMemo(() => new Set(memberships.map(w => w.id)), [memberships]);

  const filteredDiscover = useMemo(() => {
    const q = search.trim().toLowerCase();
    return discover
      .filter(d => !joinedWorkspaceIds.has(d.workspaceId))
      .filter(d => !q ||
        d.workspaceName.toLowerCase().includes(q) ||
        d.preview.some(p => p.metricName.toLowerCase().includes(q)))
      .sort((a, b) => b.totalMarkets - a.totalMarkets);
  }, [discover, joinedWorkspaceIds, search]);

  const filteredPositions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions.filter(row =>
      (activeWorkspaceFilter === 'all' || row.workspaceId === activeWorkspaceFilter) &&
      (!q ||
        row.market.metricName.toLowerCase().includes(q) ||
        row.workspaceName.toLowerCase().includes(q)),
    );
  }, [positions, activeWorkspaceFilter, search]);

  const filteredOpen = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workspaceMarkets.filter(row =>
      (activeWorkspaceFilter === 'all' || row.workspaceId === activeWorkspaceFilter) &&
      (!q ||
        row.market.metricName.toLowerCase().includes(q) ||
        row.workspaceName.toLowerCase().includes(q)),
    );
  }, [workspaceMarkets, activeWorkspaceFilter, search]);

  const summary = useMemo(() => {
    let exposure = 0;
    let mark = 0;
    let valued = 0;
    for (const row of positions) {
      exposure += row.position.totalCost;
      const payout = payoutAtConsensus(row.market, row.position.direction, row.position.shares);
      if (payout != null) { mark += payout; valued += row.position.totalCost; }
    }
    return {
      count: positions.length,
      exposure,
      pl: valued > 0 ? mark - valued : null,
    };
  }, [positions]);

  const refresh = () => { void loadPersonal(); };

  return (
    <div className="marketplace-page">
      <div className="marketplace-container">
        <header className="marketplace-header">
          <h1>Marketplace</h1>
          {user ? (
            <p className="marketplace-summary">
              Trading as <strong>{displayName(user, participant?.id ?? 'you')}</strong>
              {participant && <> · {compactNumber(participant.balance)} credits</>}
              {summary.count > 0 && (
                <>
                  {' '}· {summary.count} {summary.count === 1 ? 'position' : 'positions'} ({compactNumber(summary.exposure)} cost
                  {summary.pl != null && (
                    <> · <span className={summary.pl >= 0 ? 'pl-pos' : 'pl-neg'}>{formatSignedDelta(summary.pl)} at consensus</span></>
                  )})
                </>
              )}
            </p>
          ) : (
            <p className="marketplace-summary">
              Participants, human or AI, forecast metrics that matter.{' '}
              <Link to="/signup">Sign up for 1000 free credits</Link> to trade in any of the workspaces below.
            </p>
          )}
          {stats && (
            <p className="marketplace-stats">
              <strong>{stats.marketsActive}</strong> active {stats.marketsActive === 1 ? 'market' : 'markets'}
              {' · '}
              <strong>{stats.agentsActive}</strong> {stats.agentsActive === 1 ? 'participant' : 'participants'}
              {' · '}
              <strong>{stats.tradesThisWeek}</strong> {stats.tradesThisWeek === 1 ? 'trade' : 'trades'} this week
            </p>
          )}
        </header>

        <div className="marketplace-toolbar">
          <input
            type="search"
            className="marketplace-search"
            placeholder="Search metrics or workspaces…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {user && memberships.length > 1 && (
            <div className="marketplace-chips" role="tablist">
              <button
                type="button"
                className={`markets-chip${activeWorkspaceFilter === 'all' ? ' active' : ''}`}
                onClick={() => setActiveWorkspaceFilter('all')}
              >
                <span>all workspaces</span>
              </button>
              {memberships.map(w => (
                <button
                  key={w.id}
                  type="button"
                  className={`markets-chip${activeWorkspaceFilter === w.id ? ' active' : ''}`}
                  onClick={() => setActiveWorkspaceFilter(w.id)}
                >
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <div className="message error show">{error}</div>}

        {user && (
          <section className="marketplace-section">
            <h2>Your positions</h2>
            {loadingPersonal && positions.length === 0 ? (
              <div className="loading">Loading your positions…</div>
            ) : filteredPositions.length === 0 ? (
              <p className="marketplace-empty">
                {search || activeWorkspaceFilter !== 'all'
                  ? 'No positions match the current filter.'
                  : 'No positions yet. Place a forecast on any open market below to start.'}
              </p>
            ) : (
              <div className="markets-list">
                {filteredPositions.map(row => (
                  <PositionCard
                    key={`${row.workspaceId}:${row.market.id}:${row.position.direction}`}
                    row={row}
                    onTrade={refresh}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {user && (
          <section className="marketplace-section">
            <h2>Open markets in your workspaces</h2>
            {loadingPersonal && workspaceMarkets.length === 0 ? (
              <div className="loading">Loading…</div>
            ) : filteredOpen.length === 0 ? (
              <p className="marketplace-empty">
                {memberships.length === 0
                  ? 'You are not a member of any workspace yet. Discover one below to get started.'
                  : search || activeWorkspaceFilter !== 'all'
                  ? 'No open markets match the current filter.'
                  : 'Every open market in your workspaces already has one of your positions.'}
              </p>
            ) : (
              <div className="markets-list">
                {filteredOpen.map(row => (
                  <WorkspaceMarketCard
                    key={`${row.workspaceId}:${row.market.id}`}
                    row={row}
                    onTrade={refresh}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="marketplace-section">
          <h2>Discover workspaces</h2>
          <p className="marketplace-section-sub">
            Public workspaces you can join. Joining grants the role configured by the workspace owner; on Open workspaces that's trading rights immediately.
          </p>
          {loadingDiscover ? (
            <div className="loading">Loading public workspaces…</div>
          ) : filteredDiscover.length === 0 ? (
            <p className="marketplace-empty">
              {search ? 'No public workspaces match your search.' : 'No public workspaces yet.'}
            </p>
          ) : (
            <div className="markets-list">
              {filteredDiscover.map(row => (
                <DiscoverWorkspaceCard
                  key={row.workspaceId}
                  row={row}
                  onJoined={refresh}
                  onSignup={handleSignup}
                />
              ))}
            </div>
          )}
        </section>

        {!user && filteredDiscover.length > 0 && (
          <div className="marketplace-signup-cta">
            <p>
              <strong>Want to trade on these markets?</strong><br />
              <span>Create a free account or log in to join workspaces and place trades.</span>
            </p>
            <div className="marketplace-cta-row">
              <Link to="/signup" className="btn btn-primary">Create account</Link>
              <Link to="/login" className="btn">Log in</Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

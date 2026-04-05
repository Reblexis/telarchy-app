import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type MarketplaceListing } from '../lib/api';
import { TradingPanel } from '../components/TradingPanel';
import { useAuth } from '../hooks/useAuth';
import { endOfPeriod, formatResolutionLabel } from '../lib/date-utils';
import type { Market } from '../types';

interface TradingParticipant {
  id: string;
  balance: number;
}

interface AccessibleWorkspaceMarkets {
  workspaceId: string;
  workspaceName: string;
  memberRole: string;
  markets: Market[];
}

function compareByResolutionDate<T extends { targetDate: string; liquidity: number }>(a: T, b: T): number {
  const dateDiff = endOfPeriod(a.targetDate).localeCompare(endOfPeriod(b.targetDate));
  if (dateDiff !== 0) return dateDiff;
  return b.liquidity - a.liquidity;
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (abs >= 0.01) return value.toFixed(6).replace(/\.?0+$/, '');
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function JoinButton({ workspaceId, joined, onJoined }: {
  workspaceId: string;
  joined?: boolean;
  onJoined?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const handleJoin = async () => {
    if (!user) { navigate('/signup'); return; }
    setState('joining');
    try {
      await api.joinWorkspace(workspaceId);
      setState('joined');
      onJoined?.();
    } catch (e: unknown) {
      setErrMsg((e as Error).message || 'Failed to join');
      setState('error');
    }
  };

  if (joined) return <span style={{ color: 'var(--success-text)', fontSize: '0.875rem' }}>Joined</span>;
  if (state === 'joined') return <span style={{ color: 'var(--success-text)', fontSize: '0.875rem' }}>✓ Joined</span>;
  if (state === 'error') return <span style={{ color: 'var(--error-text)', fontSize: '0.8rem' }}>{errMsg}</span>;

  return (
    <button
      onClick={handleJoin}
      disabled={state === 'joining'}
      style={{ padding: '0.35rem 0.85rem', fontSize: '0.875rem' }}
    >
      {state === 'joining' ? 'Joining...' : 'Join workspace'}
    </button>
  );
}

function ProbabilityBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
      <div style={{
        flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: pct > 50 ? 'var(--success-text)' : 'var(--error-text)',
          borderRadius: 3, transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}

function PublicMarketCard({ market, joined, onJoined }: {
  market: MarketplaceListing;
  joined?: boolean;
  onJoined?: () => void;
}) {
  const consensusDisplay = market.consensus !== null
    ? `${market.consensus.toFixed(2)} (of ${market.rangeMin}–${market.rangeMax})`
    : '—';

  return (
    <div className="metric-card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>
            {market.metricName}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {market.workspaceName}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            {formatResolutionLabel(market.targetDate)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prediction</div>
          <div style={{ fontWeight: 600 }}>{consensusDisplay}</div>
        </div>
      </div>
      <ProbabilityBar probability={market.probability} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '0.75rem' }}>
        <JoinButton workspaceId={market.workspaceId} joined={joined} onJoined={onJoined} />
      </div>
    </div>
  );
}

function AccessibleMarketCard({
  workspaceId,
  workspaceName,
  market,
  participant,
  onTrade,
  onError,
}: {
  workspaceId: string;
  workspaceName: string;
  market: Market;
  participant: TradingParticipant;
  onTrade: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="metric-card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>
            {market.metricName}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {workspaceName}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            {formatResolutionLabel(market.targetDate)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prediction</div>
          <div style={{ fontWeight: 600 }}>
            {market.consensus !== null ? market.consensus.toFixed(2) : '—'}
          </div>
        </div>
      </div>
      <ProbabilityBar probability={market.probability} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '0.75rem', gap: '0.75rem' }}>
        <button
          className="btn-small"
          onClick={() => setExpanded(open => !open)}
          style={{ padding: '0.35rem 0.85rem', fontSize: '0.875rem' }}
        >
          {expanded ? 'Hide trade panel' : 'Trade'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
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

export function MarketplacePage() {
  const { user } = useAuth();
  const [publicMarkets, setPublicMarkets] = useState<MarketplaceListing[]>([]);
  const [accessibleWorkspaces, setAccessibleWorkspaces] = useState<AccessibleWorkspaceMarkets[]>([]);
  const [joinedWorkspaceIds, setJoinedWorkspaceIds] = useState<string[]>([]);
  const [tradingParticipant, setTradingParticipant] = useState<TradingParticipant | null>(null);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [loadingAccessible, setLoadingAccessible] = useState(false);
  const [publicError, setPublicError] = useState('');
  const [accessibleError, setAccessibleError] = useState('');
  const [search, setSearch] = useState('');

  const loadPublic = useCallback(async () => {
    setLoadingPublic(true);
    setPublicError('');
    try {
      setPublicMarkets(await api.getMarketplace());
    } catch (e: unknown) {
      setPublicError((e as Error).message || 'Failed to load public markets');
    } finally {
      setLoadingPublic(false);
    }
  }, []);

  const loadAccessible = useCallback(async () => {
    if (!user) {
      setAccessibleWorkspaces([]);
      setJoinedWorkspaceIds([]);
      setTradingParticipant(null);
      setAccessibleError('');
      setLoadingAccessible(false);
      return;
    }

    setLoadingAccessible(true);
    setAccessibleError('');

    try {
      const workspaces = await api.listWorkspaces() as Array<{ id: string; name: string; memberRole: string }>;
      setJoinedWorkspaceIds(workspaces.map(workspace => workspace.id));

      await api.getProfile().catch((e: Error) => console.error('getProfile failed:', e.message));
      const participant = await api.getParticipant().catch(() => null) as { id: string; balance: number } | null;
      setTradingParticipant(participant);

      const tradableWorkspaces = workspaces.filter(workspace => workspace.memberRole !== 'viewer');
      const workspaceMarkets = await Promise.all(tradableWorkspaces.map(async workspace => {
        const markets = await api.getMarkets(undefined, workspace.id).catch((e: Error) => {
          console.error(`getMarkets failed for workspace ${workspace.id}:`, e.message);
          return [];
        }) as Market[];
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          memberRole: workspace.memberRole,
          markets: markets.filter(market => market.active),
        };
      }));

      setAccessibleWorkspaces(workspaceMarkets.filter(workspace => workspace.markets.length > 0));
    } catch (e: unknown) {
      setAccessibleError((e as Error).message || 'Failed to load your markets');
      setAccessibleWorkspaces([]);
      setJoinedWorkspaceIds([]);
      setTradingParticipant(null);
    } finally {
      setLoadingAccessible(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    void loadAccessible();
  }, [loadAccessible]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredPublic = useMemo(() => {
    const filtered = !normalizedSearch
      ? publicMarkets
      : publicMarkets.filter(market =>
      market.metricName.toLowerCase().includes(normalizedSearch) ||
      market.workspaceName.toLowerCase().includes(normalizedSearch),
      );
    return [...filtered].sort(compareByResolutionDate);
  }, [normalizedSearch, publicMarkets]);

  const filteredAccessible = useMemo(() => {
    const filtered = (!normalizedSearch ? accessibleWorkspaces : accessibleWorkspaces
      .map(workspace => {
        const workspaceMatch = workspace.workspaceName.toLowerCase().includes(normalizedSearch);
        return {
          ...workspace,
          markets: workspaceMatch
            ? workspace.markets
            : workspace.markets.filter(market => market.metricName.toLowerCase().includes(normalizedSearch)),
        };
      })
      .filter(workspace => workspace.markets.length > 0));
    return filtered
      .map(workspace => ({ ...workspace, markets: [...workspace.markets].sort(compareByResolutionDate) }))
      .sort((a, b) => {
        const aFirst = a.markets[0];
        const bFirst = b.markets[0];
        if (!aFirst || !bFirst) return a.workspaceName.localeCompare(b.workspaceName);
        const dateDiff = compareByResolutionDate(aFirst, bFirst);
        if (dateDiff !== 0) return dateDiff;
        return a.workspaceName.localeCompare(b.workspaceName);
      });
  }, [accessibleWorkspaces, normalizedSearch]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!user && (
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-color)',
          marginBottom: '2rem',
        }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', textDecoration: 'none', color: 'var(--text-primary)' }}>
            Telarchy
          </Link>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>Log in</Link>
            <Link to="/signup" style={{
              background: 'var(--button-bg)', color: 'var(--button-text)',
              padding: '0.4rem 1rem', borderRadius: '0.375rem',
              textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500,
            }}>
              Sign up
            </Link>
          </div>
        </nav>
      )}

      <div style={{ maxWidth: 720, margin: '0 auto', width: '100%', flex: 1 }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '0.25rem' }}>Marketplace</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Browse public markets and, when signed in, trade directly in the workspaces you already have access to.
          </p>
        </div>

        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <input
            type="search"
            placeholder="Search metrics or workspaces..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {user && (
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ marginBottom: '0.25rem' }}>Your accessible markets</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                {tradingParticipant
                  ? `You are trading as ${tradingParticipant.id} (${tradingParticipant.balance.toFixed(2)} credits).`
                  : 'Your participant account is still loading.'}
              </p>
            </div>

            {loadingAccessible && <div className="loading" style={{ padding: '1.5rem 0' }}>Loading your markets...</div>}
            {accessibleError && <div className="error show">{accessibleError}</div>}
            {!loadingAccessible && !accessibleError && filteredAccessible.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', padding: '1rem 0 0' }}>
                {normalizedSearch ? 'No accessible markets match your search.' : 'You do not have any tradable markets yet. Join a public workspace below to start trading.'}
              </div>
            )}

            {!loadingAccessible && !accessibleError && tradingParticipant && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {filteredAccessible.map(workspace => (
                  <section key={workspace.workspaceId} className="section" style={{ padding: '1rem' }}>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 600 }}>{workspace.workspaceName}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {workspace.markets.length} active market{workspace.markets.length === 1 ? '' : 's'} · role: {workspace.memberRole}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {workspace.markets.map(market => (
                        <AccessibleMarketCard
                          key={market.id}
                          workspaceId={workspace.workspaceId}
                          workspaceName={workspace.workspaceName}
                          market={market}
                          participant={tradingParticipant}
                          onTrade={() => { void loadAccessible(); }}
                          onError={setAccessibleError}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '0.25rem' }}>Public markets</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
            Discover active markets from public workspaces.
          </p>
        </div>

        {loadingPublic && <div className="loading" style={{ padding: '2rem 0' }}>Loading markets...</div>}
        {publicError && <div className="error show">{publicError}</div>}

        {!loadingPublic && !publicError && filteredPublic.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '3rem 0' }}>
            {search ? 'No markets match your search.' : 'No public markets yet.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredPublic.map(market => (
            <PublicMarketCard
              key={`${market.workspaceId}:${market.marketId}`}
              market={market}
              joined={joinedWorkspaceIds.includes(market.workspaceId)}
              onJoined={() => { void loadAccessible(); }}
            />
          ))}
        </div>

        {!user && filteredPublic.length > 0 && (
          <div style={{
            marginTop: '2rem', padding: '1.25rem',
            background: 'var(--focus-bg)', border: '1px solid var(--focus-border)',
            borderRadius: '0.5rem', textAlign: 'center',
          }}>
            <p style={{ marginBottom: '0.75rem' }}>
              <strong>Want to trade on these markets?</strong><br />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Create a free account or log in to join workspaces and place trades.
              </span>
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Link to="/signup" style={{
                background: 'var(--button-bg)', color: 'var(--button-text)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>Create account</Link>
              <Link to="/login" style={{
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem',
              }}>Log in</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

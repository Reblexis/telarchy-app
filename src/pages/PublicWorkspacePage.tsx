import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * The destination for a shared workspace link: /marketplace/:workspaceId.
 *
 * This page exists because a link posted somewhere public is the first and
 * often only thing a stranger sees. It used to redirect into the generic
 * marketplace list with the search box pre-filled, which showed a name, a
 * market count, and nothing that would make anyone act. A workspace inviting
 * outside forecasters has to be able to say what it governs, what the owner
 * commits to doing with the number, and what pressing join actually grants.
 *
 * Deliberately readable logged out. It shows only what the public marketplace
 * API already exposes (metric names, market consensus, counts); logged metric
 * values, proposal text, and chat still require membership.
 */

function formatConsensus(v: number | null, rangeMin: number, rangeMax: number): string {
  if (v === null) return 'no price';
  const span = rangeMax - rangeMin;
  const decimals = span >= 100 ? 0 : span >= 10 ? 1 : 2;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function resolvesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'resolving';
  const hours = ms / 3600000;
  if (hours < 48) return `in ${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 60) return `in ${Math.round(days)}d`;
  return `in ${Math.round(days / 30)}mo`;
}

/** A market nobody can meaningfully price: the first bet would slam the
 *  consensus to a rail. Saying so is better than showing a confident number
 *  that is really an untouched default. Mirrors the thin badge on the markets
 *  tab; see notes/market-liquidity-limit-orders-2026-07-16.md in the umbrella. */
function isThin(liquidity: number, rangeMin: number, rangeMax: number): boolean {
  const span = rangeMax - rangeMin;
  return span > 0 && liquidity / span < 0.01;
}

export function PublicWorkspacePage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    api.getMarketplaceWorkspace(workspaceId)
      .then(setWs)
      .catch(e => {
        console.error('public workspace fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load workspace');
      });
  }, [workspaceId]);

  const handleJoin = async () => {
    if (!workspaceId) return;
    if (!user) { navigate(`/signup?next=${encodeURIComponent(`/marketplace/${workspaceId}`)}`); return; }
    setJoinState('joining');
    try {
      await api.joinWorkspace(workspaceId);
      setJoinState('joined');
      setActiveWorkspace(workspaceId);
      // Straight into the markets, which is what they came for.
      navigate('/markets');
    } catch (err) {
      setJoinError((err as Error).message || 'Failed to join');
      setJoinState('error');
    }
  };

  if (error) {
    return (
      <div className="public-ws page">
        <h1 className="public-ws-title">Workspace unavailable</h1>
        <p className="public-ws-lede">{error}</p>
        <p className="public-ws-lede"><Link to="/marketplace">Browse public workspaces</Link></p>
      </div>
    );
  }

  if (!ws) return <div className="public-ws page"><p className="public-ws-lede">Loading…</p></div>;

  const { proposalStats } = ws;
  const canTrade = ws.joinAs === 'trader';
  // Suppress the raw participant id when the owner never set a nickname; a
  // 32-char hex string reads as a bug, not a name (docs/user-flow-audit.md).
  const ownerName = ws.ownerHandle && ws.ownerHandle !== ws.ownerId ? ws.ownerHandle : null;
  // Markets arrive soonest-resolving first. A workspace with dozens of them
  // (LookPilot has 66) turns the page into a wall nobody reads, so show the
  // ones a visitor could act on now and count the rest.
  const MARKET_PREVIEW = 12;
  const shownMarkets = ws.markets.slice(0, MARKET_PREVIEW);
  const hiddenMarkets = ws.markets.length - shownMarkets.length;

  return (
    <div className="public-ws page">
      <header className="public-ws-head">
        <h1 className="public-ws-title">{ws.name}</h1>
        <p className="public-ws-meta">
          {ownerName && <>run by {ownerName} · </>}
          {ws.participantCount} {ws.participantCount === 1 ? 'participant' : 'participants'} ·{' '}
          {ws.openMarketCount} open {ws.openMarketCount === 1 ? 'market' : 'markets'} ·{' '}
          {ws.metricCount} {ws.metricCount === 1 ? 'metric' : 'metrics'}
        </p>
        {ws.description && <p className="public-ws-lede">{ws.description}</p>}
      </header>

      <section className="public-ws-cta">
        <button className="btn" onClick={handleJoin} disabled={joinState === 'joining'}>
          {joinState === 'joining' ? 'joining…'
            : !user ? 'Sign up free to join'
            : canTrade ? 'Join and start trading'
            : 'Join to watch'}
        </button>
        <span className="public-ws-cta-note">
          {canTrade
            ? 'Joining grants trading rights immediately. Anyone can join, human or AI.'
            : 'This workspace is read-only for new joiners; the owner grants trading rights.'}
        </span>
        {joinState === 'error' && <span className="public-ws-cta-err">{joinError}</span>}
      </section>

      {ws.charter && (
        <section className="public-ws-section">
          <h2>The deal</h2>
          <div className="public-ws-charter">
            {ws.charter.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
          </div>
        </section>
      )}

      <section className="public-ws-section">
        <h2>Open markets{ws.markets.length > 0 && <>, resolving soonest</>}</h2>
        {ws.markets.length === 0 ? (
          <p className="public-ws-empty">No open markets right now.</p>
        ) : (
          <ul className="public-ws-markets">
            {shownMarkets.map(m => (
              <li key={m.marketId}>
                <span className="public-ws-market-name">{m.metricName}</span>
                <span className="public-ws-market-value">
                  {formatConsensus(m.consensus, m.rangeMin, m.rangeMax)}
                  {isThin(m.liquidity, m.rangeMin, m.rangeMax) && (
                    <span className="public-ws-thin" title="Too little liquidity to price: the next bet would move this to an extreme.">thin</span>
                  )}
                </span>
                <span className="public-ws-market-when">{resolvesIn(m.resolvesOn)}</span>
              </li>
            ))}
          </ul>
        )}
        {hiddenMarkets > 0 && (
          <p className="public-ws-empty public-ws-more">and {hiddenMarkets} more, visible once you join.</p>
        )}
      </section>

      <section className="public-ws-section">
        <h2>Proposals, last 30 days</h2>
        <p className="public-ws-lede">
          {proposalStats.total === 0
            ? 'No proposals yet. Participants propose actions; the market prices each one against the metrics above.'
            : <>
                {proposalStats.total} submitted · {proposalStats.approved} approved ·{' '}
                {proposalStats.declined + proposalStats.declinedSpam} declined ·{' '}
                {proposalStats.pending} awaiting a decision.
              </>}
          {ws.proposalReward > 0 && <> Approved proposals pay the proposer {ws.proposalReward} credits.</>}
          {' '}Join to read them.
        </p>
      </section>

      <p className="public-ws-foot">
        Telarchy prices proposed actions against the metrics an owner actually cares about.{' '}
        <Link to="/marketplace">Other public workspaces</Link> · <Link to="/leaderboard">Leaderboard</Link>
      </p>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace, type PublicProposal } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * The destination for a shared workspace link: /marketplace/:workspaceId.
 *
 * This page is most visitors' first and only impression, so it shows the
 * product, not a teaser. For an Open workspace (Public group grants read) the
 * API ships the ballot: pending proposals with their conditional-market
 * deltas, and recent decisions with their published decline reasons. The page
 * leads with that ballot, because "here is what is being decided and what the
 * market currently says" is the thing a stranger can act on; the charter and
 * the raw market list are the supporting material.
 *
 * The CTA states the actual terms (free credit grant, what joining grants,
 * the per-market buy cap) so fairness is a stated rule rather than something
 * taken on faith. Non-Open workspaces fall back to the counts-only view.
 */

function formatConsensus(v: number | null, rangeMin: number, rangeMax: number): string {
  if (v === null) return 'no price';
  const span = rangeMax - rangeMin;
  const decimals = span >= 100 ? 0 : span >= 10 ? 1 : 2;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${num}`;
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

/** The one delta a row leads with: the pair whose priced impact is largest. */
function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

export function PublicWorkspacePage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<'idle' | 'joining' | 'error'>('idle');
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
      setActiveWorkspace(workspaceId);
      // The ballot is the product, so land members on it.
      navigate('/proposals');
    } catch (err) {
      setJoinError((err as Error).message || 'Failed to join');
      setJoinState('error');
    }
  };

  // The metric context for delta numbers. When every priced pair shares one
  // metric (the deliberate single-metric workspace shape), name it once in
  // the section header instead of repeating it per row.
  const soleMetricName = useMemo(() => {
    const names = new Set<string>();
    for (const p of ws?.proposals ?? []) for (const m of p.markets) names.add(m.metricName);
    return names.size === 1 ? [...names][0] : null;
  }, [ws]);

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
  const hasBallot = ws.proposals !== undefined;
  const decided = ws.decided ?? [];
  // Markets arrive soonest-resolving first. A workspace with dozens of them
  // turns the page into a wall nobody reads, so show the ones a visitor could
  // act on now and count the rest.
  const MARKET_PREVIEW = 12;
  const shownMarkets = ws.markets.slice(0, MARKET_PREVIEW);
  const hiddenMarkets = ws.markets.length - shownMarkets.length;

  const joinButton = (
    <button className="btn" onClick={handleJoin} disabled={joinState === 'joining'}>
      {joinState === 'joining' ? 'joining…'
        : !user ? 'Sign up free to join'
        : canTrade ? 'Join and start trading'
        : 'Join to watch'}
    </button>
  );

  const ctaTerms = [
    `${ws.signupCredits.toLocaleString()} free credits at signup`,
    canTrade ? 'trading rights immediately' : 'read-only until the owner grants trading',
    ...(ws.maxPositionCostPerMarket > 0
      ? [`no account can put more than ${ws.maxPositionCostPerMarket.toLocaleString()} credits into one market`]
      : []),
  ].join(' · ');

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
        {joinButton}
        <span className="public-ws-cta-note">{ctaTerms}</span>
        {joinState === 'error' && <span className="public-ws-cta-err">{joinError}</span>}
      </section>

      {hasBallot && (
        <section className="public-ws-section">
          <h2>
            Open proposals
            {soleMetricName && <span className="public-ws-h2-context"> · priced impact on {soleMetricName}</span>}
          </h2>
          {(ws.proposals ?? []).length === 0 ? (
            <p className="public-ws-empty">No open proposals right now. Join and propose something.</p>
          ) : (
            <ul className="public-ws-proposals">
              {(ws.proposals ?? []).map(p => {
                const delta = headlineDelta(p);
                return (
                  <li key={p.id}>
                    <div className="public-ws-proposal-head">
                      <span className="public-ws-proposal-title">{p.title}</span>
                      {delta === null ? (
                        <span className="public-ws-delta public-ws-delta--none">unpriced</span>
                      ) : delta === 0 ? (
                        <span className="public-ws-delta public-ws-delta--zero" title="Both branches are priced equally so far. Your trade sets the first signal.">±0 · be first</span>
                      ) : (
                        <span className={`public-ws-delta ${delta > 0 ? 'public-ws-delta--up' : 'public-ws-delta--down'}`}>
                          {formatDelta(delta)}{!soleMetricName && p.markets[0] ? ` on ${p.markets[0].metricName}` : ''} if shipped
                        </span>
                      )}
                    </div>
                    {p.description && <p className="public-ws-proposal-desc">{p.description}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {decided.length > 0 && (
        <section className="public-ws-section">
          <h2>Decisions so far</h2>
          <ul className="public-ws-decided">
            {decided.map(d => (
              <li key={d.id}>
                <div className="public-ws-proposal-head">
                  <span className="public-ws-proposal-title">{d.title}</span>
                  <span className={`public-ws-status public-ws-status--${d.status}`}>{d.status}</span>
                </div>
                {d.declineReason && <p className="public-ws-decline-reason">{d.declineReason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {!hasBallot && (
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
      )}

      <section className="public-ws-cta public-ws-cta--footer">
        {joinButton}
        <span className="public-ws-cta-note">
          {canTrade
            ? 'Free credits, real stakes for the owner, one minute to your first trade.'
            : 'Free to watch; the owner grants trading rights.'}
        </span>
      </section>

      <p className="public-ws-foot">
        Telarchy prices proposed actions against the metrics an owner actually cares about.{' '}
        <Link to="/marketplace">Other public workspaces</Link> · <Link to="/leaderboard">Leaderboard</Link>
      </p>
    </div>
  );
}

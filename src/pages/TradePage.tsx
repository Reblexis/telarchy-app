import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { MetricYearChart } from '../components/MetricYearChart';
import { TradeTicket, type TicketPosition } from '../components/TradeTicket';
import { FloorModal } from '../components/FloorModal';
import { useAnimatedNumber } from '../lib/useAnimatedNumber';
import { JobsBoard, splitAsk } from '../components/JobsBoard';
import { FloorComments } from '../components/FloorComments';
import { LeaderboardRail } from '../components/FloorRails';
import { AccountMenu } from '../components/AccountMenu';
import { DiscordButton } from '../components/DiscordButton';
import { ManifoldButton } from '../components/ManifoldButton';
import { ReportButton } from '../components/ReportButton';
import { Logo } from '../components/Logo';
import type { LeaderboardEntry, LimitOrder } from '../lib/api';

/**
 * telarchy.com/<slug>: the market and one action, nothing else (owner
 * decision, 2026-08-09: the poster stays free of explanatory context).
 * Composition: headline ("<metric> @ <settle date>"), price, the
 * Manifold-style step chart, and exactly one action: a "Make your call"
 * pill into signup when anonymous, the trade ticket (TradeTicket: pick a
 * side, pick an amount, one confirm) when signed in. The workspace
 * description, settle fineprint, ballot, charter, decided list, pitch and
 * footer are NOT rendered; the API still ships them, so each returns as a
 * render change.
 *
 * /marketplace/:idOrSlug still resolves here and canonicalizes to /<slug>.
 * A signed-in visitor on an Open workspace is joined silently; membership is
 * bookkeeping, not a decision.
 */

function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDelta(delta: number, unit = ''): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${unit}${num}`;
}

// The currency lives in the metric name's parenthetical tail ("LookPilot
// revenue (monthly, USD)"): display-only inference, so metrics without a
// currency in the tail stay bare numbers and nothing new enters the API.
// The day the market settles, from its target period: '2026' and
// '2026-12' both end on 31 December 2026. Shown in the title (owner
// direction 2026-08-10: "@ 31 December 2026"); the END of the period, so
// the year boundary never reads a day late.
function settleDayOf(targetDate: string): string | null {
  const m = targetDate.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 12;
  const day = m[3] ? Number(m[3]) : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

export function TradePage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [positions, setPositions] = useState<TicketPosition[]>([]);
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [ticketPreview, setTicketPreview] = useState<{ direction: 'higher' | 'lower'; newProb: number } | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  // Selecting a job switches the ONE market view to that job's conditional
  // market (owner decision 2026-08-09: no second market underneath). null
  // means the baseline market is showing.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // Which world the one view is showing (owner decision 2026-08-10: both
  // branches are on the page; the toggle picks which one the ticket trades,
  // and the chart draws the other as a quiet second line).
  const [branch, setBranch] = useState<'approved' | 'declined'>('approved');
  const [condHistory, setCondHistory] = useState<{
    approved: Array<{ at: string; consensus: number | null }>;
    declined: Array<{ at: string; consensus: number | null }>;
  } | null>(null);
  // The price straight from a trade response, so the headline moves before
  // the reload lands. Keyed by market so it never leaks across a switch.
  const [livePrice, setLivePrice] = useState<{ marketId: string; value: number } | null>(null);
  // The bet dialog (owner direction 2026-08-10, after Manifold): the floor
  // shows two buttons; composing the bet happens in a modal. null = closed,
  // 'manage' = opened from the position summary with no side preset.
  const [betModal, setBetModal] = useState<'higher' | 'lower' | 'manage' | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const joinTried = useRef(false);
  // The owner's decision controls (owner ask 2026-08-11: approve from the
  // floor). manage capability on this workspace reveals them on a selected
  // job; everyone else never sees the bar.
  const [canManage, setCanManage] = useState(false);
  const [declineReason, setDeclineReason] = useState<string | null>(null); // null = decline not open
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideErr, setDecideErr] = useState('');

  const reload = () => {
    if (!idOrSlug) return;
    api.getMarketplaceWorkspace(idOrSlug)
      .then(setWs)
      .catch(e => {
        console.error('trade page fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load workspace');
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [idOrSlug]);

  // Canonical URL is the root-level slug; shared /marketplace/<x> links
  // keep working and quietly become /<slug>.
  useEffect(() => {
    if (!ws?.slug) return;
    if (location.pathname.startsWith('/marketplace/')) {
      navigate(`/${ws.slug}`, { replace: true });
    }
  }, [ws, location.pathname, navigate]);

  // Silent join on an Open workspace; idempotent server-side.
  useEffect(() => {
    if (!ws || !user || joinTried.current) return;
    if (ws.joinAs !== 'trader') return;
    joinTried.current = true;
    api.joinWorkspace(ws.workspaceId)
      .then(() => {
        setActiveWorkspace(ws.workspaceId);
        setJoined(true);
      })
      .catch(e => console.error('silent join failed:', e));
  }, [ws, user]);

  const loadLeaders = () => {
    api.getLeaderboard(5)
      .then(r => setLeaders(r.participants ?? []))
      .catch(e => console.error('leaderboard fetch failed:', e));
  };
  useEffect(loadLeaders, []);

  // Once joined (the workspace header is set), ask who we are HERE: an
  // owner/admin membership reveals the decision bar on selected jobs.
  useEffect(() => {
    if (!user || !joined) return;
    api.getProfile()
      .then(p => setCanManage((p as { authRole?: string }).authRole === 'admin'))
      .catch(e => console.error('profile fetch failed:', e));
  }, [user, joined]);

  const decide = async (action: 'approve' | 'decline') => {
    if (!selectedJobId || !ws) return;
    setDecideErr('');
    setDecideBusy(true);
    try {
      if (action === 'approve') {
        await api.approveProposal(selectedJobId);
      } else {
        await api.declineProposal(selectedJobId, (declineReason ?? '').trim());
      }
      setDeclineReason(null);
      setSelectedJobId(null);
      reload();
    } catch (e) {
      setDecideErr((e as Error).message || 'Could not record the decision');
    } finally {
      setDecideBusy(false);
    }
  };

  const hero = ws?.markets[0] ?? null;
  const unit = hero ? currencyOf(hero.metricName) : '';
  const metricLabel = hero ? hero.metricName.replace(/\s*\(.*\)\s*$/, '') : '';
  const selectedJob = ws?.proposals?.find(p => p.id === selectedJobId) ?? null;
  const pair = selectedJob?.markets[0] ?? null;
  // The selected branch's market id/price shape, and the other branch's for
  // the chart's second line. A branch market can exist without a price
  // (liquidity 0: the proposer could not fund the subsidy before the
  // auto-fund fallback existed); its honest prior is the baseline call, not
  // a vanished chart.
  const branchShape = (b: 'approved' | 'declined') => {
    if (!pair) return null;
    const marketId = b === 'approved' ? pair.approvedMarketId : pair.declinedMarketId;
    if (!marketId) return null;
    return {
      marketId,
      consensus: (b === 'approved' ? pair.approvedConsensus : pair.declinedConsensus) ?? hero?.consensus ?? null,
      probability: (b === 'approved' ? pair.approvedProbability : pair.declinedProbability) ?? hero?.probability ?? 0.5,
      liquidity: ((b === 'approved' ? pair.approvedLiquidity : pair.declinedLiquidity) ?? 0) > 0
        ? ((b === 'approved' ? pair.approvedLiquidity : pair.declinedLiquidity) as number)
        : (hero?.liquidity ?? 1),
      rangeMin: pair.rangeMin,
      rangeMax: pair.rangeMax,
      history: condHistory?.[b] ?? [],
    };
  };
  // The one market the page is showing and the ticket is trading: the
  // baseline, or the selected branch of the selected job.
  const active = branchShape(branch) ?? (hero
    ? {
        marketId: hero.marketId,
        consensus: hero.consensus,
        probability: hero.probability,
        liquidity: hero.liquidity,
        rangeMin: hero.rangeMin,
        rangeMax: hero.rangeMax,
        history: ws?.marketHistory ?? [],
      }
    : null);
  const otherBranch = pair ? branchShape(branch === 'approved' ? 'declined' : 'approved') : null;
  const activeMarketId = active?.marketId ?? null;

  // Both branches' own histories, fetched when a job is selected so the
  // main chart keeps meaning something after the switch. Selecting a job
  // always starts in the approved world.
  useEffect(() => {
    setCondHistory(null);
    setBranch('approved');
    setDescExpanded(false);
    const aid = pair?.approvedMarketId;
    const did = pair?.declinedMarketId;
    if (!aid || !ws) return;
    let cancelled = false;
    const slug = ws.slug || ws.workspaceId;
    Promise.all([
      api.getPublicMarketHistory(slug, aid),
      did ? api.getPublicMarketHistory(slug, did) : Promise.resolve([]),
    ])
      .then(([a, d]) => { if (!cancelled) setCondHistory({ approved: a, declined: d }); })
      .catch(e => console.error('conditional history fetch failed:', e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair?.approvedMarketId, pair?.declinedMarketId, ws]);

  const refreshMoney = () => {
    if (activeMarketId && ws) {
      api.getPositions(activeMarketId, undefined, ws.workspaceId)
        .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
          setPositions((rows ?? []).filter(r => r.shares > 1e-9)))
        .catch(e => console.error('positions fetch failed:', e));
      api.getLimitOrders(activeMarketId, ws.workspaceId)
        .then(rows => setOrders(rows ?? []))
        .catch(e => console.error('limit orders fetch failed:', e));
    }
    api.getParticipant()
      .then(pt => setBalance((pt as { balance?: number }).balance ?? null))
      .catch(e => console.error('participant fetch failed:', e));
  };
  // Positions belong to the market on screen, so they refetch on a switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPositions([]); setOrders([]); if (joined) refreshMoney(); }, [joined, activeMarketId]);

  // Live updates (owner ask 2026-08-11: the market updates in real time
  // for viewers and traders). The floor polls every few seconds so a
  // price move, a filled limit order, or a new job appears without a
  // reload. A ref holds the latest closures so the interval never runs a
  // stale one. Paused while the tab is hidden; a fresh pull the instant it
  // comes back, so returning to the tab is never stale.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => { reload(); loadLeaders(); if (joined) refreshMoney(); };
  useEffect(() => {
    const tick = () => { if (typeof document === 'undefined' || !document.hidden) pollRef.current(); };
    const interval = setInterval(tick, 5000);
    const onVisible = () => { if (!document.hidden) pollRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // The ticket owns busy/error/flash UI state; the page owns the money
  // plumbing. Errors propagate by throwing so the ticket can show them
  // where the finger is.
  const doTrade = async (body: Record<string, unknown>) => {
    if (!ws) return;
    const r = await api.trade(body, ws.workspaceId) as { consensus?: number | null };
    if (typeof r.consensus === 'number' && typeof body.marketId === 'string') {
      setLivePrice({ marketId: body.marketId, value: r.consensus });
    }
    refreshMoney();
    reload();
    if (pair?.approvedMarketId) {
      const slug = ws.slug || ws.workspaceId;
      Promise.all([
        api.getPublicMarketHistory(slug, pair.approvedMarketId),
        pair.declinedMarketId ? api.getPublicMarketHistory(slug, pair.declinedMarketId) : Promise.resolve([]),
      ])
        .then(([a, d]) => setCondHistory({ approved: a, declined: d }))
        .catch(e => console.error('conditional history refresh failed:', e));
    }
  };
  const placeTrade = async (direction: 'higher' | 'lower', amount: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction, amount });
  };
  const sellPosition = async (p: TicketPosition, shares: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction: p.direction, sellShares: Math.min(p.shares, shares) });
  };
  // A resting order changes no price today, so it refreshes the money but
  // does not touch the chart's history.
  const placeLimit = async (direction: 'higher' | 'lower', limitValue: number, budgetCredits: number) => {
    if (!activeMarketId || !ws) return;
    await api.placeLimitOrder({ marketId: activeMarketId, direction, limitValue, budgetCredits }, ws.workspaceId);
    refreshMoney();
  };
  const cancelLimit = async (id: string) => {
    if (!ws) return;
    await api.cancelLimitOrder(id, ws.workspaceId);
    refreshMoney();
  };

  // The prediction's own movement: for the baseline, the call vs the call
  // after its first trade. For a job, the chip shows the impact itself
  // (approved minus declined), which is the one number the job is about,
  // and it stays the same whichever branch is on screen.
  const marketOpen = pair
    ? null
    : ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const jobImpact = pair && pair.approvedConsensus !== null && pair.declinedConsensus !== null
    ? pair.approvedConsensus - pair.declinedConsensus
    : null;
  const consensus = (livePrice && livePrice.marketId === activeMarketId ? livePrice.value : null)
    ?? active?.consensus ?? null;
  // The number rolls to its new value (trade, branch switch, job select)
  // instead of teleporting; everything downstream (chart, ticket) uses the
  // true value, only the headline shows the tween.
  const shownConsensus = useAnimatedNumber(consensus);
  // The composed bet's impact, projected from probability space onto the
  // metric's range so the chart can draw where the call would move.
  const chartPreview = active && ticketPreview
    ? { direction: ticketPreview.direction, value: active.rangeMin + ticketPreview.newProb * (active.rangeMax - active.rangeMin) }
    : null;

  // Year chart: the hero metric's REAL value over the calendar year (solid),
  // continued to where the market sees it settling (dashed, to the resolve
  // date). The x-axis is the year, not the trading timeline, so this is its
  // own chart below the market poster, drawn in the same visual family.
  const heroActualHistory = useMemo(() => {
    return (ws?.heroHistory ?? [])
      .filter(p => p.at && Number.isFinite(p.value))
      .slice()
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [ws?.heroHistory]);

  if (error) {
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <section className="pubws-status">
            <p className="pubws-pitch">{error}</p>
            <p className="pubws-pitch"><Link to="/">Back to Telarchy</Link></p>
          </section>
        </main>
      </div>
    );
  }

  if (!ws) {
    // The loading screen is the market's own motif (the amber call dot,
    // rippling) where the market is about to appear; no spinner, no text.
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <div className="pubws-loading" role="status" aria-label="Loading">
            <span className="pubws-loading-dot" />
          </div>
        </main>
      </div>
    );
  }

  const canTrade = ws.joinAs === 'trader';
  const trading = !!user && joined && canTrade;

  return (
    <div className="pubws pubws--center">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="pubws-main pubws-main--floor">
        <LeaderboardRail entries={leaders} />
        <div className="pubws-center">
        {hero && active && consensus !== null && (
          <section className="pubws-instrument" aria-label="The market">
            {/* Selecting a job re-points this one view at its conditional
                market; the condition is stated above the same headline so
                the page never grows a second market. */}
            {/* The whole title: what is being predicted, as of when. The
                metric's parenthetical unit tail is trimmed for display only
                (the full name stays in the API); renaming the metric itself
                would void the live market by the definition-change invariant.
                With a job selected the title becomes the actual question the
                conditional market prices, naming who gets paid and how much,
                because that is the whole bet. */}
            {selectedJob ? (
              <>
                <button className="pubws-back" onClick={() => setSelectedJobId(null)}>
                  ← {metricLabel}
                </button>
                <h1 className="pubws-instrument-title pubws-question pubws-enter pubws-enter--1">
                  What is {metricLabel} if{' '}
                  {selectedJob.proposedByName ?? 'someone'}{' '}
                  {/* The phrase IS the world: green "is paid" in the
                      approved branch, red "is not paid" in the declined one,
                      and clicking it flips to the other world (owner
                      direction 2026-08-10). Both phrases share one grid
                      cell, so the headline sizes to the longer one and
                      never reflows on a switch, whatever the ask's width. */}
                  <WorldWord
                    branch={branch}
                    approvedText={splitAsk(selectedJob.title).ask !== null
                      ? `is paid $${splitAsk(selectedJob.title).ask}`
                      : 'does'}
                    declinedText={splitAsk(selectedJob.title).ask !== null
                      ? `is not paid $${splitAsk(selectedJob.title).ask}`
                      : 'does not do'}
                    onToggle={pair?.declinedMarketId
                      ? () => setBranch(b => (b === 'approved' ? 'declined' : 'approved'))
                      : null}
                  />
                  {splitAsk(selectedJob.title).ask !== null ? ' to do:' : ':'}
                  {' '}
                  <span className="pubws-question-task">{splitAsk(selectedJob.title).rest}</span>
                </h1>
                {selectedJob.description && (
                  <>
                    <p className={`pubws-details pubws-enter pubws-enter--1${descExpanded ? '' : ' is-clamped'}`}>
                      {selectedJob.description}
                    </p>
                    {selectedJob.description.length > 220 && (
                      <button className="pubws-details-more" onClick={() => setDescExpanded(v => !v)}>
                        {descExpanded ? 'less' : 'more'}
                      </button>
                    )}
                  </>
                )}
                {/* The owner's press, on the floor itself (owner ask
                    2026-08-11). Approve is the money verb, green; decline
                    asks for the reason the charter promises to publish. */}
                {canManage && (
                  <div className="pubws-ownerbar pubws-enter pubws-enter--1">
                    {declineReason === null ? (
                      <>
                        <button
                          className="pubws-decide pubws-decide--approve"
                          disabled={decideBusy}
                          onClick={() => void decide('approve')}
                        >
                          {decideBusy ? 'Deciding…' : splitAsk(selectedJob.title).ask !== null
                            ? `Approve, pay $${splitAsk(selectedJob.title).ask}`
                            : 'Approve'}
                        </button>
                        <button
                          className="pubws-decide pubws-decide--decline"
                          disabled={decideBusy}
                          onClick={() => setDeclineReason('')}
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          className="pubws-decide-reason"
                          value={declineReason}
                          onChange={e => setDeclineReason(e.target.value)}
                          placeholder="Why not, published on the job"
                          aria-label="Decline reason"
                          autoFocus
                        />
                        <button
                          className="pubws-decide pubws-decide--decline"
                          disabled={decideBusy || declineReason.trim().length === 0}
                          onClick={() => void decide('decline')}
                        >
                          {decideBusy ? 'Deciding…' : 'Confirm decline'}
                        </button>
                        <button className="pubws-decide" onClick={() => { setDeclineReason(null); setDecideErr(''); }}>
                          Cancel
                        </button>
                      </>
                    )}
                    {decideErr && <p className="ticket-err">{decideErr}</p>}
                  </div>
                )}
              </>
            ) : (
              /* The metric name carries its own horizon ("net 2026"), so a
                 settle date beside it was redundant and, at the year
                 boundary, off by a day: the 2026 period ends at the instant
                 January 1 begins. */
              <h1 className="pubws-instrument-title pubws-enter pubws-enter--1">
                {metricLabel}
                {settleDayOf(hero.targetDate) && (
                  <span className="pubws-settle"> @ {settleDayOf(hero.targetDate)}</span>
                )}
              </h1>
            )}
            <div className="pubws-headline pubws-enter pubws-enter--2">
              <span className="pubws-price">{unit}{formatValue(shownConsensus ?? consensus)}</span>
              {!selectedJob && marketOpen !== null && consensus !== marketOpen && (
                <span key={`open-${Math.round(consensus - marketOpen)}`} className={`pubws-delta-chip ${consensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {consensus >= marketOpen ? '▲' : '▼'} {formatDelta(consensus - marketOpen, unit)}
                  {' '}since open
                </span>
              )}
              {/* The impact is the job's one number, so it is always said:
                  priced, zero-so-far, or not yet priced. Silence read as a
                  broken page. */}
              {selectedJob && (
                jobImpact === null ? (
                  <span className="pubws-delta-chip">impact not yet priced</span>
                ) : jobImpact === 0 ? (
                  <span className="pubws-delta-chip">±{unit}0 impact so far</span>
                ) : (
                  <span key={`imp-${Math.round(jobImpact)}`} className={`pubws-delta-chip ${jobImpact >= 0 ? 'is-up' : 'is-down'}`}>
                    {jobImpact >= 0 ? '▲' : '▼'} {formatDelta(jobImpact, unit)} impact
                  </span>
                )
              )}
            </div>
            {/* A market nobody has traded yet has no replayed history, which
                used to mean no chart at all: selecting a fresh job showed a
                price and blank space. A market always has a call, so fall
                back to that single point and let the chart hold it. */}
            {/* Every proposal branches into two worlds and both are on the
                page (owner decision 2026-08-10): the toggle picks which one
                the ticket trades, the chart draws the other as a quiet
                second line, and the gap between the lines is the impact. */}
            {selectedJob && pair?.declinedMarketId && (
              <div className="pubws-branch pubws-enter pubws-enter--2" role="group" aria-label="Branch">
                <button
                  className={`pubws-branch-opt pubws-branch-opt--approved${branch === 'approved' ? ' is-active' : ''}`}
                  aria-pressed={branch === 'approved'}
                  onClick={() => setBranch('approved')}
                >
                  if approved
                </button>
                <button
                  className={`pubws-branch-opt pubws-branch-opt--declined${branch === 'declined' ? ' is-active' : ''}`}
                  aria-pressed={branch === 'declined'}
                  onClick={() => setBranch('declined')}
                >
                  if declined
                </button>
              </div>
            )}
            <div className="pubws-enter pubws-enter--3">
              <MarketChart
                key={active.marketId}
                series={active.history.length > 0
                  ? active.history
                  : [{ at: new Date().toISOString(), consensus }]}
                consensus={consensus}
                unit={unit}
                note={settleDayOf(hero.targetDate) ? `resolves ${settleDayOf(hero.targetDate)}` : undefined}
                preview={chartPreview}
                orders={orders.map(o => ({ id: o.id, direction: o.direction, limitValue: o.limitValue }))}
                secondary={selectedJob && otherBranch && otherBranch.consensus !== null
                  ? {
                      series: otherBranch.history,
                      consensus: otherBranch.consensus,
                      label: branch === 'approved' ? 'if declined' : 'if approved',
                      tone: branch === 'approved' ? 'lower' : 'higher',
                    }
                  : null}
              />
            </div>
          </section>
        )}

        {active && (trading || (canTrade && !user && !authLoading)) ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Place a trade">
            {/* Prominent, Manifold-style (owner direction 2026-08-10):
                the two filled verbs ARE the floor's call to action, green
                up first like the reference. The dialog they open keeps its
                own side pills for switching. */}
            <div className="pubws-bet" role="group" aria-label="Bet">
              <button className="pubws-bet-btn pubws-bet-btn--higher" onClick={() => setBetModal('higher')}>Bet Higher ↑</button>
              <button className="pubws-bet-btn pubws-bet-btn--lower" onClick={() => setBetModal('lower')}>Bet Lower ↓</button>
            </div>
            {/* The held position stays visible on the floor; managing it
                (selling, cancelling orders) happens in the same dialog. */}
            {(positions.length > 0 || orders.length > 0) && (
              <button className="pubws-pos-summary" onClick={() => setBetModal('manage')}>
                {positions.map(p => `${p.direction === 'higher' ? '▲' : '▼'} ${fmtShares(p.shares)} ${p.direction}`).join(' · ')}
                {positions.length > 0 && orders.length > 0 ? ' · ' : ''}
                {orders.length > 0 ? `${orders.length} resting order${orders.length > 1 ? 's' : ''}` : ''}
                {' '}→ manage
              </button>
            )}
            {/* The conversation under whatever the one view shows: the
                baseline market's thread, or the selected job's (owner ask
                2026-08-11). */}
            {idOrSlug && (
              <FloorComments
                idOrSlug={idOrSlug}
                subject={selectedJob ? { proposalId: selectedJob.id } : hero ? { marketId: hero.marketId } : {}}
                canPost={!!user && joined}
                onRequireSignup={() => navigate('/signup')}
              />
            )}
          </section>
        ) : null}



        {/* Two questions, two sections (owner direction 2026-08-10):
            "What is this market?" is the metric's stored definition,
            verbatim, because it is the settlement text and changing it
            voids the market. "What is LookPilot?" is the product in its
            own words plus the primary sources; know the company, trade it
            better. */}
        <section className="pubws-know pubws-enter pubws-enter--3" aria-label="What is this market">
          <h2 className="pubws-know-head">What is this market?</h2>
          {/* A human explanation first (owner direction 2026-08-10: "describe
              it normally, no weird jabber"), the exact settlement text
              beneath it. The explainer talks mechanics, so it never
              paraphrases the definition and cannot drift from it. */}
          <p className="pubws-know-what">
            A prediction market on LookPilot&rsquo;s 2026 profit. The big
            number is what traders currently believe the year will end at.
            Think it&rsquo;s too low? Bet Higher. Too high? Bet Lower. The
            closer the real year-end number lands to your side, the more you
            win.
          </p>
          {ws.heroMetricDescription && (
            <p className="pubws-metric-desc">
              Exactly what counts: {ws.heroMetricDescription}
            </p>
          )}
          {/* The metric itself over the year: what it has actually done so
              far (solid) and where the market sees it settling (dashed).
              Lives here, under the definition, because it shows the thing
              the market is about, not the market's own price. */}
          {active && hero && hero.resolvesOn && (consensus ?? hero.consensus) != null && heroActualHistory.length >= 1 && (
            <div style={{ marginTop: '1.25rem' }}>
              <div className="pubws-settle" style={{ textAlign: 'center', marginBottom: '0.1rem' }}>
                {metricLabel}: actual so far, and where the market sees it landing
                {settleDayOf(hero.targetDate) ? ` @ ${settleDayOf(hero.targetDate)}` : ''}
              </div>
              <MetricYearChart
                history={heroActualHistory}
                forecastValue={(consensus ?? hero.consensus) as number}
                forecastAt={hero.resolvesOn}
                unit={unit}
              />
            </div>
          )}
        </section>
        <section className="pubws-know pubws-enter pubws-enter--3" aria-label="What is LookPilot">
          <h2 className="pubws-know-head">What is LookPilot?</h2>
          <p className="pubws-know-what">
            LookPilot is a webcam head tracker for flight, trucking and racing
            sims, the best-reviewed one on Steam: look around in the game by
            moving your head, no hardware, $14.99 once.
          </p>
          <div className="pubws-know-grid">
            <a href="https://lookpilot.app/data-room/" target="_blank" rel="noreferrer">
              <span className="pubws-know-name">data room</span>
              <span className="pubws-know-desc">the official numbers this market settles on</span>
            </a>
            <a href="https://store.steampowered.com/app/3326890/LookPilot/" target="_blank" rel="noreferrer">
              <span className="pubws-know-name">steam page</span>
              <span className="pubws-know-desc">the product, as players see it</span>
            </a>
            <a href="https://steamdb.info/app/3326890/" target="_blank" rel="noreferrer">
              <span className="pubws-know-name">steamdb</span>
              <span className="pubws-know-desc">third-party sales estimates</span>
            </a>
          </div>
        </section>
        </div>
        {/* The jobs board IS the right rail (owner direction 2026-08-10:
            jobs where the activity log was). The log's information lives
            on in the chart and the board itself; the rail slot goes to the
            thing a visitor can act on. */}
        {ws.proposals !== undefined && hero ? (
          <aside className="pubws-rail pubws-rail--right" aria-label="Jobs">
            <JobsBoard
              proposals={ws.proposals}
              unit={unit}
              selectedId={selectedJobId}
              onSelect={id => setSelectedJobId(cur => (cur === id ? null : id))}
              signedIn={!!user}
              onRequireSignup={() => navigate('/signup')}
              onPropose={async (title, description, askUsd) => {
                // Anonymous proposers go through the signup door; the board
                // itself is public information (Open workspace ballot).
                // Payment details come from the account (owner decision
                // 2026-08-10): the server reads and snapshots them.
                if (!user) { navigate('/signup'); return; }
                await api.createProposal({ title, description, liquiditySubsidy: 250, askUsd });
                reload();
              }}
            />
          </aside>
        ) : (
          <aside className="pubws-rail pubws-rail--right" aria-hidden="true" />
        )}
      </main>

      {betModal && active && (
        <FloorModal onClose={() => setBetModal(null)} label="Place a trade">
          <TradeTicket
            probability={active.probability}
            liquidity={active.liquidity}
            positions={trading ? positions : []}
            onTrade={placeTrade}
            onSell={sellPosition}
            balance={balance}
            onPreview={setTicketPreview}
            unit={unit}
            consensus={consensus}
            rangeMin={active.rangeMin}
            rangeMax={active.rangeMax}
            orders={trading ? orders : []}
            onPlaceLimit={trading ? placeLimit : async () => {}}
            onCancelLimit={trading ? cancelLimit : undefined}
            onRequireSignup={trading ? undefined : () => navigate('/signup')}
            initialDir={betModal === 'manage' ? undefined : betModal}
            onClose={() => setBetModal(null)}
          />
        </FloorModal>
      )}

      {/* Below the floor: why this exists, in three drawings and three
          sentences (owner direction 2026-08-10: about section under the
          main view, strong visuals, minimal text). The drawings reuse the
          chart's own vocabulary: the step line, the branch pair, the
          priced gap; nothing here is decoration from outside the product. */}
      <section className="pubws-about" aria-label="About Telarchy">
        <div className="pubws-about-beat">
          <svg viewBox="0 0 120 48" aria-hidden="true">
            <path className="ab-line" d="M6,40 L36,40 L36,28 L66,28 L66,14 L106,14" />
            <circle className="ab-dot" cx="106" cy="14" r="3.5" />
          </svg>
          <p>A real company, run in the open. One number says how it is going.</p>
        </div>
        <div className="pubws-about-beat">
          <svg viewBox="0 0 120 48" aria-hidden="true">
            <path className="ab-line" d="M6,24 L46,24" />
            <path className="ab-up" d="M46,24 L106,10" />
            <path className="ab-down" d="M46,24 L106,38" />
            <circle className="ab-dot ab-dot--up" cx="106" cy="10" r="3.5" />
            <circle className="ab-dot ab-dot--down" cx="106" cy="38" r="3.5" />
          </svg>
          <p>Anyone proposes a job with a price. Participants, human or AI, bet on both worlds: done, and not done.</p>
        </div>
        <div className="pubws-about-beat">
          <svg viewBox="0 0 120 48" aria-hidden="true">
            <line className="ab-gap" x1="60" y1="12" x2="60" y2="36" />
            <circle className="ab-dot ab-dot--up" cx="60" cy="12" r="3.5" />
            <circle className="ab-dot ab-dot--down" cx="60" cy="36" r="3.5" />
            <path className="ab-check" d="M78,22 L84,28 L96,14" />
          </svg>
          <p>The gap between those worlds is a calibrated number. The owner approves on it, and pays for outcomes, not promises.</p>
        </div>
        {/* The door is an email box, not a "waitlist" (owner direction
            2026-08-10): anyone who wants their own numbers run this way
            gets set up within days, so the copy promises contact, not a
            queue. One field, zero friction. */}
        <SetupForm />
      </section>
    </div>
  );
}

function TopBar({ user, ready }: { user: boolean; ready: boolean }) {
  const navigate = useNavigate();
  return (
    <nav className="pubws-topbar">
      <Link to="/" className="pubws-logolink" aria-label="Telarchy">
        {/* Same lockup treatment as the landing nav (3rem), so the page
            reads as the same site. */}
        <Logo variant="lockup" height="3rem" />
      </Link>
      <div className="pubws-topbar-right">
        <ManifoldButton signedIn={user} onRequireSignup={() => navigate('/signup')} />
        <DiscordButton />
        <ReportButton />
        {/* Rendered only after the session check settles: while it is
            pending, user is still null, and a signed-in visitor would see
            "Log in" flash and vanish. Anonymous visitors get it fading in. */}
        {ready && (user
          ? <div className="pubws-fade"><AccountMenu /></div>
          : <Link to="/login" className="pubws-login pubws-fade">Log in</Link>)}
      </div>
    </nav>
  );
}

/**
 * The paid / not-paid phrase in the conditional headline, as the world
 * toggle itself. Both phrases occupy the same grid cell (the button sizes
 * to the longer one, so any text length is layout-stable); the active one
 * stands, the other waits below it, and a click crossfades them and
 * re-points the whole view at the other branch.
 */
function WorldWord({ branch, approvedText, declinedText, onToggle }: {
  branch: 'approved' | 'declined';
  approvedText: string;
  declinedText: string;
  onToggle: (() => void) | null;
}) {
  const inner = (
    <>
      <span className="pubws-world-opt pubws-world-opt--approved" aria-hidden={branch !== 'approved'}>{approvedText}</span>
      <span className="pubws-world-opt pubws-world-opt--declined" aria-hidden={branch !== 'declined'}>{declinedText}</span>
    </>
  );
  if (!onToggle) {
    return <span className={`pubws-world pubws-world--${branch}`}>{inner}</span>;
  }
  return (
    <button
      type="button"
      className={`pubws-world pubws-world--${branch} pubws-world--live`}
      onClick={onToggle}
      aria-label={`Switch to the world where this job is ${branch === 'approved' ? 'declined' : 'approved'}`}
    >
      {inner}
    </button>
  );
}

/** One email in, one promise out: we set you up, no queue language. */
function SetupForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong');
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <p className="pubws-setup-done">Got it. We will get back to you within a few days.</p>;
  }
  return (
    <form className="pubws-setup" onSubmit={e => void submit(e)}>
      <p className="pubws-setup-lead">Want this for your own numbers, a company or a personal goal?</p>
      <div className="pubws-setup-row">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          aria-label="Your email"
        />
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Get set up'}</button>
      </div>
      {error && <p className="pubws-setup-err">{error}</p>}
    </form>
  );
}

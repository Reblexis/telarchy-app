import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { TradeTicket, type TicketPosition } from '../components/TradeTicket';
import { JobsBoard, splitAsk } from '../components/JobsBoard';
import { ActivityRail, LeaderboardRail, type ActivityItem } from '../components/FloorRails';
import { AccountMenu } from '../components/AccountMenu';
import { Logo } from '../components/Logo';
import type { LeaderboardEntry } from '../lib/api';

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
function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

function settleDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function timeAgo(at: string | Date): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
  const [balance, setBalance] = useState<number | null>(null);
  const [ticketPreview, setTicketPreview] = useState<{ direction: 'higher' | 'lower'; newProb: number } | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  // Evidence series: the workspace's market-less metrics (units, active
  // users, tracking hours, review percentage), synced by the same daily
  // pipe as the traded number. Signed-in only, like the rest of the desk.
  const [evidence, setEvidence] = useState<Array<{ id: string; name: string; value: number }>>([]);
  // Selecting a job switches the ONE market view to that job's conditional
  // market (owner decision 2026-08-09: no second market underneath). null
  // means the baseline market is showing.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [condHistory, setCondHistory] = useState<Array<{ at: string; consensus: number | null }> | null>(null);
  // The price straight from a trade response, so the headline moves before
  // the reload lands. Keyed by market so it never leaks across a switch.
  const [livePrice, setLivePrice] = useState<{ marketId: string; value: number } | null>(null);
  const joinTried = useRef(false);

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

  useEffect(() => {
    api.getLeaderboard(5)
      .then(r => setLeaders(r.participants ?? []))
      .catch(e => console.error('leaderboard fetch failed:', e));
  }, []);

  const hero = ws?.markets[0] ?? null;
  const unit = hero ? currencyOf(hero.metricName) : '';
  const metricLabel = hero ? hero.metricName.replace(/\s*\(.*\)\s*$/, '') : '';
  const selectedJob = ws?.proposals?.find(p => p.id === selectedJobId) ?? null;
  const pair = selectedJob?.markets[0] ?? null;
  // The one market the page is showing and the ticket is trading: the
  // baseline, or the selected job's approved branch.
  const active = pair && pair.approvedMarketId
    ? {
        marketId: pair.approvedMarketId,
        consensus: pair.approvedConsensus,
        probability: pair.approvedProbability ?? 0.5,
        liquidity: pair.approvedLiquidity ?? 1,
        rangeMin: pair.rangeMin,
        rangeMax: pair.rangeMax,
        history: condHistory ?? [],
      }
    : hero
      ? {
          marketId: hero.marketId,
          consensus: hero.consensus,
          probability: hero.probability,
          liquidity: hero.liquidity,
          rangeMin: hero.rangeMin,
          rangeMax: hero.rangeMax,
          history: ws?.marketHistory ?? [],
        }
      : null;
  const activeMarketId = active?.marketId ?? null;

  // The conditional branch's own history, fetched when a job is selected so
  // the main chart keeps meaning something after the switch.
  useEffect(() => {
    setCondHistory(null);
    const mid = pair?.approvedMarketId;
    if (!mid || !ws) return;
    let cancelled = false;
    api.getPublicMarketHistory(ws.slug || ws.workspaceId, mid)
      .then(h => { if (!cancelled) setCondHistory(h); })
      .catch(e => console.error('conditional history fetch failed:', e));
    return () => { cancelled = true; };
  }, [pair?.approvedMarketId, ws]);

  const refreshMoney = () => {
    if (activeMarketId && ws) {
      api.getPositions(activeMarketId, undefined, ws.workspaceId)
        .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
          setPositions((rows ?? []).filter(r => r.shares > 1e-9)))
        .catch(e => console.error('positions fetch failed:', e));
    }
    api.getParticipant()
      .then(pt => setBalance((pt as { balance?: number }).balance ?? null))
      .catch(e => console.error('participant fetch failed:', e));
  };
  useEffect(() => {
    if (!joined || !ws) return;
    api.getMetrics()
      .then(r => {
        const list = (Array.isArray(r) ? r : (r as { metrics?: unknown[] })?.metrics ?? []) as Array<{ id: string; name: string; value: number }>;
        // Cap hard: the row is a glance, and a workspace with many metrics
        // (a personal one viewed via its slug, say) must not flood the desk.
        setEvidence(list.filter(m => m.id !== hero?.metricId && typeof m.value === 'number').slice(0, 6));
      })
      .catch(e => console.error('evidence fetch failed:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, ws?.workspaceId]);

  // Positions belong to the market on screen, so they refetch on a switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPositions([]); if (joined) refreshMoney(); }, [joined, activeMarketId]);

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
      api.getPublicMarketHistory(ws.slug || ws.workspaceId, pair.approvedMarketId)
        .then(setCondHistory)
        .catch(e => console.error('conditional history refresh failed:', e));
    }
  };
  const placeTrade = async (direction: 'higher' | 'lower', amount: number) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction, amount });
  };
  const sellPosition = async (p: TicketPosition) => {
    if (!activeMarketId) return;
    await doTrade({ marketId: activeMarketId, direction: p.direction, sellShares: p.shares });
  };

  // The prediction's own movement: for the baseline, the call vs the call
  // after its first trade; for a conditional, the impact itself (approved
  // minus declined), which is the one number a job is about.
  const marketOpen = pair
    ? pair.declinedConsensus
    : ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const consensus = (livePrice && livePrice.marketId === activeMarketId ? livePrice.value : null)
    ?? active?.consensus ?? null;
  // The desk facts: the real value the market predicts against, and its
  // freshness. Intent-gated (signed-in only): the anonymous poster stays
  // free of context, but a trader deciding Higher or Lower needs the
  // anchor and proof it is being kept current.
  const lastActual = ws?.heroHistory?.length ? ws.heroHistory[ws.heroHistory.length - 1] : null;
  // The composed bet's impact, projected from probability space onto the
  // metric's range so the chart can draw where the call would move.
  const chartPreview = active && ticketPreview
    ? { direction: ticketPreview.direction, value: active.rangeMin + ticketPreview.newProb * (active.rangeMax - active.rangeMin) }
    : null;

  // The action log, composed from the public payload: new jobs, decisions,
  // and the market's own movement. Newest first, capped so the rail stays
  // a glance, not a feed.
  const activity = useMemo<ActivityItem[]>(() => {
    if (!ws) return [];
    const items: ActivityItem[] = [];
    for (const p of ws.proposals ?? []) {
      const t = new Date(p.createdAt).getTime();
      if (Number.isFinite(t)) items.push({ at: t, kind: 'proposal', text: `new job · ${p.title}` });
    }
    for (const d of ws.decided ?? []) {
      const t = d.resolvedAt ? new Date(d.resolvedAt).getTime() : NaN;
      if (Number.isFinite(t)) items.push({ at: t, kind: d.status, text: `${d.status} · ${d.title}` });
    }
    const traded = (ws.marketHistory ?? []).filter(pt => pt.consensus !== null);
    for (const pt of traded.slice(1).slice(-8)) {
      const t = new Date(pt.at).getTime();
      if (Number.isFinite(t)) items.push({ at: t, kind: 'trade', text: `market moved to ${unit}${formatValue(pt.consensus as number)}` });
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 12);
  }, [ws, unit]);

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
                  ← {metricLabel} @ {settleDate(hero.resolvesOn)}
                </button>
                <h1 className="pubws-instrument-title pubws-question pubws-enter pubws-enter--1">
                  What is {metricLabel} @ {settleDate(pair?.resolvesOn ?? hero.resolvesOn)} if{' '}
                  {selectedJob.proposedByName ?? 'someone'}
                  {splitAsk(selectedJob.title).ask !== null
                    ? ` is paid $${splitAsk(selectedJob.title).ask} to do:`
                    : ' does:'}
                  {' '}
                  <span className="pubws-question-task">{splitAsk(selectedJob.title).rest}</span>
                </h1>
                {selectedJob.description && (
                  <p className="pubws-details pubws-enter pubws-enter--1">{selectedJob.description}</p>
                )}
              </>
            ) : (
              <h1 className="pubws-instrument-title pubws-enter pubws-enter--1">
                {metricLabel}
                {' '}
                <span className="pubws-instrument-when">@ {settleDate(hero.resolvesOn)}</span>
              </h1>
            )}
            <div className="pubws-headline pubws-enter pubws-enter--2">
              <span className="pubws-price">{unit}{formatValue(consensus)}</span>
              {marketOpen !== null && consensus !== marketOpen && (
                <span className={`pubws-delta-chip ${consensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {consensus >= marketOpen ? '▲' : '▼'} {formatDelta(consensus - marketOpen, unit)}
                  {' '}{selectedJob ? 'impact' : 'since open'}
                </span>
              )}
            </div>
            {active.history.length > 0 && (
              <div className="pubws-enter pubws-enter--3">
                <MarketChart
                  key={active.marketId}
                  series={active.history}
                  consensus={consensus}
                  unit={unit}
                  preview={chartPreview}
                />
              </div>
            )}
          </section>
        )}

        {trading && active ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Place a trade">
            {/* Two facts only: the anchor and its freshness. The trade
                pulse lives in the activity rail; it does not need a second
                home here. */}
            {lastActual && (
              <div className="pubws-facts">
                <span>Actual {unit}{formatValue(lastActual.value)}</span>
                {lastActual.at && <span className="pubws-facts-sep">·</span>}
                {lastActual.at && <span>updated {timeAgo(lastActual.at)}</span>}
              </div>
            )}
            <TradeTicket
              probability={active.probability}
              liquidity={active.liquidity}
              positions={positions}
              balance={balance}
              onTrade={placeTrade}
              onSell={sellPosition}
              onPreview={setTicketPreview}
            />
          </section>
        ) : null}

        {/* Paid-jobs round 1 (charter 2026-08-09): the proposal side is a
            jobs board. Signed-in only; the anonymous poster stays clean. */}
        {trading && ws.proposals !== undefined && hero && (
          <JobsBoard
            proposals={ws.proposals}
            unit={unit}
            selectedId={selectedJobId}
            onSelect={id => setSelectedJobId(cur => (cur === id ? null : id))}
            onPropose={async (title, description, askUsd) => {
              await api.createProposal({ title, description, liquiditySubsidy: 20, askUsd });
              reload();
            }}
          />
        )}

        {/* Evidence: the numbers a forecaster prices against, one quiet
            mono line. Names carry the meaning; values stay compact. */}
        {trading && evidence.length > 0 && (
          <section className="pubws-evidence" aria-label="Evidence">
            {evidence.map(m => (
              <span key={m.id} className="pubws-evidence-item">
                <span className="pubws-evidence-value">
                  {m.value >= 10_000
                    ? `${(m.value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`
                    : m.value.toLocaleString('en-US', { maximumFractionDigits: m.value < 100 ? 1 : 0 })}
                  {/percent|%/i.test(m.name) ? '%' : ''}
                </span>
                {' '}
                {m.name.replace(/\s*\(.*\)\s*$/, '').toLowerCase()}
              </span>
            ))}
          </section>
        )}

        {canTrade && !user && !authLoading && active ? (
          /* Newcomers get the same ticket in demo mode: they can compose a
             bet and watch its impact ghost onto the chart; the confirm is
             the signup door. The ticket is the pitch. */
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Try a trade">
            <TradeTicket
              probability={active.probability}
              liquidity={active.liquidity}
              positions={[]}
              balance={null}
              onTrade={async () => {}}
              onSell={async () => {}}
              onPreview={setTicketPreview}
              onRequireSignup={() => navigate('/signup')}
            />
          </section>
        ) : null}
        </div>
        <ActivityRail items={activity} />
      </main>
    </div>
  );
}

function TopBar({ user, ready }: { user: boolean; ready: boolean }) {
  return (
    <nav className="pubws-topbar">
      <Link to="/" className="pubws-logolink" aria-label="Telarchy">
        {/* Same lockup treatment as the landing nav (3rem), so the page
            reads as the same site. */}
        <Logo variant="lockup" height="3rem" />
      </Link>
      {/* Rendered only after the session check settles: while it is
          pending, user is still null, and a signed-in visitor would see
          "Log in" flash and vanish. Anonymous visitors get it fading in. */}
      {ready && (user
        ? <div className="pubws-fade"><AccountMenu /></div>
        : <Link to="/login" className="pubws-login pubws-fade">Log in</Link>)}
    </nav>
  );
}

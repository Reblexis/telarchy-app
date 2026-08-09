import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { TradeTicket, type TicketPosition } from '../components/TradeTicket';
import { Logo } from '../components/Logo';

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
  const [heroConsensus, setHeroConsensus] = useState<number | null>(null);
  const [positions, setPositions] = useState<TicketPosition[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [ticketPreview, setTicketPreview] = useState<{ direction: 'higher' | 'lower'; newProb: number } | null>(null);
  const joinTried = useRef(false);

  const reload = () => {
    if (!idOrSlug) return;
    api.getMarketplaceWorkspace(idOrSlug)
      .then(w => { setWs(w); setHeroConsensus(w.markets[0]?.consensus ?? null); })
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

  const heroMarketId = ws?.markets[0]?.marketId ?? null;
  const refreshMoney = () => {
    if (heroMarketId && ws) {
      api.getPositions(heroMarketId, undefined, ws.workspaceId)
        .then((rows: Array<{ direction: 'higher' | 'lower'; shares: number; totalCost: number }>) =>
          setPositions((rows ?? []).filter(r => r.shares > 1e-9)))
        .catch(e => console.error('positions fetch failed:', e));
    }
    api.getParticipant()
      .then(pt => setBalance((pt as { balance?: number }).balance ?? null))
      .catch(e => console.error('participant fetch failed:', e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (joined) refreshMoney(); }, [joined, heroMarketId]);

  // The ticket owns busy/error/flash UI state; the page owns the money
  // plumbing. Errors propagate by throwing so the ticket can show them
  // where the finger is.
  const doTrade = async (body: Record<string, unknown>) => {
    if (!ws) return;
    const r = await api.trade(body, ws.workspaceId) as { consensus?: number | null };
    if (typeof r.consensus === 'number' && body.marketId === heroMarketId) setHeroConsensus(r.consensus);
    refreshMoney();
    reload();
  };
  const placeTrade = async (direction: 'higher' | 'lower', amount: number) => {
    if (!heroMarketId) return;
    await doTrade({ marketId: heroMarketId, direction, amount });
  };
  const sellPosition = async (p: TicketPosition) => {
    if (!heroMarketId) return;
    await doTrade({ marketId: heroMarketId, direction: p.direction, sellShares: p.shares });
  };

  const hero = ws?.markets[0] ?? null;
  const unit = hero ? currencyOf(hero.metricName) : '';
  // The prediction's own movement: current call vs the call after the
  // market's first trade. About the market, not the metric.
  const marketOpen = ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const consensus = heroConsensus ?? hero?.consensus ?? null;
  // The desk facts: the real value the market predicts against, and its
  // freshness. Intent-gated (signed-in only): the anonymous poster stays
  // free of context, but a trader deciding Higher or Lower needs the
  // anchor and proof it is being kept current.
  const lastActual = ws?.heroHistory?.length ? ws.heroHistory[ws.heroHistory.length - 1] : null;
  // The composed bet's impact, projected from probability space onto the
  // metric's range so the chart can draw where the call would move.
  const chartPreview = hero && ticketPreview
    ? { direction: ticketPreview.direction, value: hero.rangeMin + ticketPreview.newProb * (hero.rangeMax - hero.rangeMin) }
    : null;

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
      <main className="pubws-main">
        {hero && consensus !== null && (
          <section className="pubws-instrument" aria-label="The market">
            {/* The whole title: what is being predicted, as of when. The
                metric's parenthetical unit tail is trimmed for display only
                (the full name stays in the API); renaming the metric itself
                would void the live market by the definition-change invariant. */}
            <h1 className="pubws-instrument-title pubws-enter pubws-enter--1">
              {hero.metricName.replace(/\s*\(.*\)\s*$/, '')}
              {' '}
              <span className="pubws-instrument-when">@ {settleDate(hero.resolvesOn)}</span>
            </h1>
            <div className="pubws-headline pubws-enter pubws-enter--2">
              <span className="pubws-price">{unit}{formatValue(consensus)}</span>
              {marketOpen !== null && consensus !== marketOpen && (
                <span className={`pubws-delta-chip ${consensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {consensus >= marketOpen ? '▲' : '▼'} {formatDelta(consensus - marketOpen, unit)} since open
                </span>
              )}
            </div>
            {(ws.marketHistory?.length ?? 0) > 0 && (
              <div className="pubws-enter pubws-enter--3">
                <MarketChart series={ws.marketHistory!} consensus={consensus} unit={unit} preview={chartPreview} />
              </div>
            )}
          </section>
        )}

        {trading && hero ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Place a trade">
            {lastActual && (
              <div className="pubws-facts">
                <span>Actual {unit}{formatValue(lastActual.value)}</span>
                {lastActual.at && <span className="pubws-facts-sep">·</span>}
                {lastActual.at && <span>updated {timeAgo(lastActual.at)}</span>}
                {(ws.tradesThisWeek ?? 0) > 0 && <span className="pubws-facts-sep">·</span>}
                {(ws.tradesThisWeek ?? 0) > 0 && <span>{ws.tradesThisWeek} trades this week</span>}
              </div>
            )}
            <TradeTicket
              probability={hero.probability}
              liquidity={hero.liquidity}
              positions={positions}
              balance={balance}
              onTrade={placeTrade}
              onSell={sellPosition}
              onPreview={setTicketPreview}
            />
          </section>
        ) : canTrade && !user && !authLoading && hero ? (
          /* Newcomers get the same ticket in demo mode: they can compose a
             bet and watch its impact ghost onto the chart; the confirm is
             the signup door. The ticket is the pitch. */
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Try a trade">
            <TradeTicket
              probability={hero.probability}
              liquidity={hero.liquidity}
              positions={[]}
              balance={null}
              onTrade={async () => {}}
              onSell={async () => {}}
              onPreview={setTicketPreview}
              onRequireSignup={() => navigate('/signup')}
            />
          </section>
        ) : null}
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
      {ready && !user && <Link to="/login" className="pubws-login pubws-fade">Log in</Link>}
    </nav>
  );
}

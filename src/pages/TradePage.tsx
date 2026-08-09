import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { Logo } from '../components/Logo';

/**
 * telarchy.com/<slug>: the market, and only what a newcomer needs (owner
 * decision, 2026-08-09). The composition answers a first-time visitor's
 * three questions in order and nothing else:
 *   1. What am I looking at? The headline ("<metric> @ <settle date>") and
 *      the hook line under it (the workspace's own one-sentence description,
 *      owner-authored via the API, hidden when empty).
 *   2. Is it real? The settle fineprint under the fold ("Settles <date> on
 *      the real number.").
 *   3. What can I do? Exactly one action: "Make your call" into signup when
 *      anonymous; the amount + Lower/Higher tradebar (position and sell once
 *      held) when signed in. No payout preview, no ballot, no charter; those
 *      stay in the API and return as render changes.
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

interface HeroPosition { direction: 'higher' | 'lower'; shares: number; totalCost: number }

export function TradePage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [amount, setAmount] = useState('25');
  const [tradeErr, setTradeErr] = useState('');
  const [tradeBusy, setTradeBusy] = useState<string | null>(null);
  const [heroConsensus, setHeroConsensus] = useState<number | null>(null);
  const [positions, setPositions] = useState<HeroPosition[]>([]);
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
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (joined) refreshMoney(); }, [joined, heroMarketId]);

  const doTrade = async (body: Record<string, unknown>, busyKey: string) => {
    if (!ws) return;
    setTradeErr('');
    setTradeBusy(busyKey);
    try {
      const r = await api.trade(body, ws.workspaceId) as { consensus?: number | null };
      if (typeof r.consensus === 'number' && body.marketId === heroMarketId) setHeroConsensus(r.consensus);
      refreshMoney();
      reload();
    } catch (e) {
      setTradeErr((e as Error).message || 'Trade failed');
    } finally {
      setTradeBusy(null);
    }
  };

  const amountNum = Math.max(0, parseFloat(amount) || 0);
  const heroTrade = (direction: 'higher' | 'lower') => {
    if (!heroMarketId || amountNum <= 0) return;
    void doTrade({ marketId: heroMarketId, direction, amount: amountNum }, `hero-${direction}`);
  };
  const sellPosition = (p: HeroPosition) => {
    if (!heroMarketId) return;
    void doTrade({ marketId: heroMarketId, direction: p.direction, sellShares: p.shares }, `sell-${p.direction}`);
  };

  const hero = ws?.markets[0] ?? null;
  const unit = hero ? currencyOf(hero.metricName) : '';
  // The prediction's own movement: current call vs the call after the
  // market's first trade. About the market, not the metric.
  const marketOpen = ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const consensus = heroConsensus ?? hero?.consensus ?? null;

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
            {/* The hook: the workspace's own one-sentence description. It is
                what tells a stranger the number below is a live forecast by
                traders, not a measurement. */}
            {ws.description && (
              <p className="pubws-hook pubws-enter pubws-enter--1">{ws.description}</p>
            )}
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
                <MarketChart series={ws.marketHistory!} consensus={consensus} unit={unit} />
              </div>
            )}
          </section>
        )}

        {trading ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Place a trade">
            <div className="pubws-tradebar">
              <label className="pubws-amount">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  aria-label="Credits to spend"
                />
                <span>cr</span>
              </label>
              <button
                className="pubws-dir pubws-dir--lower"
                disabled={tradeBusy !== null || amountNum <= 0}
                onClick={() => heroTrade('lower')}
              >
                {tradeBusy === 'hero-lower' ? '…' : '▼ Lower'}
              </button>
              <button
                className="pubws-dir pubws-dir--higher"
                disabled={tradeBusy !== null || amountNum <= 0}
                onClick={() => heroTrade('higher')}
              >
                {tradeBusy === 'hero-higher' ? '…' : '▲ Higher'}
              </button>
            </div>
            {positions.length > 0 && (
              <div className="pubws-position">
                {positions.map(p => (
                  <span key={p.direction}>
                    you hold {p.shares.toFixed(1)} sh {p.direction}
                    {' '}
                    <button className="pubws-sell" disabled={tradeBusy !== null} onClick={() => sellPosition(p)}>
                      {tradeBusy === `sell-${p.direction}` ? 'selling…' : 'sell'}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {tradeErr && <p className="pubws-joinerr">{tradeErr}</p>}
          </section>
        ) : canTrade && !user && !authLoading ? (
          <section className="pubws-act pubws-enter pubws-enter--3" aria-label="Join and trade">
            <Link to="/signup" className="pubws-cta">Make your call</Link>
          </section>
        ) : null}

        {hero && (
          <p className="pubws-settle pubws-enter pubws-enter--3">
            Settles {settleDate(hero.resolvesOn)} on the real number.
          </p>
        )}
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

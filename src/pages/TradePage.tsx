import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { previewTrade } from '../lib/amm';
import { MarketChart } from '../components/MarketChart';

/**
 * telarchy.com/<slug>: the market, and nothing else (owner decision,
 * 2026-08-09: minimal first, add more later). The page renders exactly one
 * object, the prediction: label, price, the Manifold-style step chart of the
 * market's call, a one-line caption, and the single action (join when logged
 * out, trade when in). The ballot, charter, decided list, pitch and footer
 * are deliberately NOT rendered in this phase; the API still ships them, so
 * bringing each back is a render change, not a feature.
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

function formatDelta(delta: number): string {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${num}`;
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
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
    api.getParticipant()
      .then((p: { balance?: number }) => setBalance(p.balance ?? null))
      .catch(e => console.error('balance fetch failed:', e));
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
  // The prediction's own movement: current call vs the call after the
  // market's first trade. About the market, not the metric.
  const marketOpen = ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const displayConsensus = heroConsensus ?? hero?.consensus ?? null;

  if (error) {
    return (
      <div className="pubws">
        <TopBar user={!!user} balance={balance} />
        <main className="pubws-main">
          <p className="pubws-pitch">{error}</p>
          <p className="pubws-pitch"><Link to="/">Back to Telarchy</Link></p>
        </main>
      </div>
    );
  }

  if (!ws) {
    return (
      <div className="pubws">
        <TopBar user={!!user} balance={balance} />
        <main className="pubws-main"><p className="pubws-pitch">Loading…</p></main>
      </div>
    );
  }

  const canTrade = ws.joinAs === 'trader';
  const trading = !!user && joined && canTrade;

  return (
    <div className="pubws">
      <TopBar user={!!user} balance={balance} />
      <main className="pubws-main">
        {hero && displayConsensus !== null && (
          <section className="pubws-instrument" aria-label="The market">
            <div className="pubws-instrument-label">
              market&rsquo;s bet · {hero.metricName}
            </div>
            <div className="pubws-headline">
              <span className="pubws-price">{formatValue(displayConsensus)}</span>
              {marketOpen !== null && displayConsensus !== marketOpen && (
                <span className={`pubws-delta-chip ${displayConsensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {displayConsensus >= marketOpen ? '▲' : '▼'} {formatDelta(displayConsensus - marketOpen)} since open
                </span>
              )}
            </div>
            {(ws.marketHistory?.length ?? 0) > 0 && (
              <MarketChart series={ws.marketHistory!} consensus={displayConsensus} />
            )}
            <div className="pubws-instrument-sub">
              settles {settleDate(hero.resolvesOn)}
              {(ws.tradesThisWeek ?? 0) > 0 && <> · {ws.tradesThisWeek} trades this week</>}
            </div>
          </section>
        )}

        {trading ? (
          <section className="pubws-act" aria-label="Place a trade">
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
            {hero && amountNum > 0 && (() => {
              const up = previewTrade(hero.probability, hero.liquidity, 'higher', amountNum).shares;
              const down = previewTrade(hero.probability, hero.liquidity, 'lower', amountNum).shares;
              return (
                <p className="pubws-fineprint">
                  {amountNum} cr pays up to <span className="pubws-pay">{formatValue(up)}</span> on higher
                  {' '}· <span className="pubws-pay">{formatValue(down)}</span> on lower
                </p>
              );
            })()}
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
        ) : (
          <section className="pubws-act">
            <button
              className="pubws-cta"
              onClick={() => {
                if (!user) navigate(`/signup?next=${encodeURIComponent(`/${ws.slug ?? idOrSlug}`)}`);
              }}
              disabled={!!user && !canTrade}
            >
              {!user ? (canTrade ? 'Join free and move the number' : 'Join free and watch') : 'Read-only workspace'}
            </button>
            <p className="pubws-fineprint">
              {ws.signupCredits.toLocaleString()} free credits · play money
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function TopBar({ user, balance }: { user: boolean; balance: number | null }) {
  return (
    <nav className="pubws-topbar">
      <Link to="/" className="pubws-wordmark">Telarchy</Link>
      {user ? (
        <span className="pubws-topbar-me">
          {balance !== null && <span className="pubws-balance">{balance.toFixed(0)} cr</span>}
          <Link to="/account" className="pubws-login">Account</Link>
        </span>
      ) : (
        <Link to="/login" className="pubws-login">Log in</Link>
      )}
    </nav>
  );
}

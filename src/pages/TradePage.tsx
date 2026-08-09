import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace, type PublicProposal } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { previewTrade } from '../lib/amm';
import { MarketChart } from '../components/MarketChart';
import { linkify } from '../lib/linkify';

/**
 * The trading floor at telarchy.com/<slug> (owner decision, 2026-08-08):
 * trading is the default thing this site does, so a workspace's root-level
 * page is not a teaser for an app, it IS the app for traders. One page,
 * three states of the same layout:
 *
 * - Logged out: the poster (name, one-line claim, the instrument, one CTA).
 * - Logged in on an Open workspace: membership happens silently (joining is
 *   bookkeeping, not a decision a trader should be asked to make), and the
 *   poster grows controls: an amount + Lower/Higher pair under the
 *   instrument, your position with one-tap sell, an inline propose form, and
 *   per-branch trading inside expanded ballot rows. The page never navigates
 *   away to "the app"; there is no app for traders beyond this.
 * - Management lives behind /manage and the namespaced console routes;
 *   nothing here links to it.
 *
 * /marketplace/:idOrSlug still renders this page for already-shared links and
 * canonicalizes the URL to /<slug> once the payload arrives.
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

function headlineDelta(p: PublicProposal): number | null {
  const deltas = p.markets.map(m => m.delta).filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), deltas[0]);
}

/** Count-up for the hero price: the tick sliding to the market's call is the
 *  page's one load animation. Skipped under prefers-reduced-motion. */
function useCountUp(target: number | null, from: number | null): number | null {
  const [value, setValue] = useState<number | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (target === null || done.current) return;
    done.current = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || from === null || from === target) { setValue(target); return; }
    const t0 = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      setValue(from + (target - from) * ease);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, from]);
  return value ?? target;
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
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [pTitle, setPTitle] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pErr, setPErr] = useState('');
  const [pBusy, setPBusy] = useState(false);
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

  // Canonical URL is the root-level slug. Links shared as
  // /marketplace/<id-or-slug> keep working and quietly become /<slug>.
  useEffect(() => {
    if (!ws?.slug) return;
    if (location.pathname.startsWith('/marketplace/')) {
      navigate(`/${ws.slug}`, { replace: true });
    }
  }, [ws, location.pathname, navigate]);

  // Membership is bookkeeping, not a decision: a signed-in visitor on an Open
  // workspace is joined silently and the page grows its controls. Idempotent
  // on the backend (alreadyMember), so no membership pre-check is needed.
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

  // Balance + hero position, once trading is possible and after every trade.
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
      if (body.proposalId) reload();
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

  const branchTrade = (proposal: PublicProposal, branch: 'approved' | 'declined', direction: 'higher' | 'lower') => {
    const pair = proposal.markets[0];
    if (!pair || amountNum <= 0) return;
    void doTrade({
      metricName: pair.metricName,
      targetDate: pair.targetDate,
      proposalId: proposal.id,
      branch,
      direction,
      amount: amountNum,
    }, `${proposal.id}-${branch}-${direction}`);
  };

  const submitProposal = async () => {
    if (!pTitle.trim()) { setPErr('Give it a title.'); return; }
    setPErr('');
    setPBusy(true);
    try {
      // The listing stake seeds the proposal's own markets (20 cr per branch)
      // so a fresh proposal is priceable the moment it appears, instead of
      // spawning the dead b=0 pair the UX audit caught. It is an LP position,
      // not a fee: refunded pro-rata when the markets resolve or void.
      await api.createProposal({ title: pTitle.trim(), description: pDesc.trim(), liquiditySubsidy: 20 });
      setPTitle(''); setPDesc(''); setProposeOpen(false);
      reload();
    } catch (e) {
      setPErr((e as Error).message || 'Failed to submit');
    } finally {
      setPBusy(false);
    }
  };

  const soleMetricName = useMemo(() => {
    const names = new Set<string>();
    for (const p of ws?.proposals ?? []) for (const m of p.markets) names.add(m.metricName);
    return names.size === 1 ? [...names][0] : null;
  }, [ws]);

  const hero = ws?.markets[0] ?? null;
  // The prediction's own change: current call vs the call after the market's
  // first trade (its open). This is about the market, not the metric.
  const marketOpen = ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const displayConsensus = heroConsensus ?? hero?.consensus ?? null;
  const mid = hero ? (hero.rangeMin + hero.rangeMax) / 2 : null;
  const shown = useCountUp(hero?.consensus ?? null, mid);
  const liveShown = heroConsensus !== null && heroConsensus !== hero?.consensus ? displayConsensus : shown;
  if (error) {
    return (
      <div className="pubws">
        <TopBar user={!!user} balance={balance} />
        <main className="pubws-main">
          <h1 className="pubws-name">Workspace unavailable</h1>
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
  const proposals = ws.proposals ?? [];
  const decided = (ws.decided ?? []).filter(d => d.status === 'declined' ? d.declineReason : true);

  return (
    <div className="pubws">
      <TopBar user={!!user} balance={balance} />
      <main className="pubws-main">
        <header className="pubws-hero">
          <h1 className="pubws-name">{ws.name}</h1>
          {ws.description && <p className="pubws-pitch">{linkify(ws.description)}</p>}
        </header>

        {hero && displayConsensus !== null && (
          <section className="pubws-instrument" aria-label="The market's current call">
            <div className="pubws-instrument-label">
              market&rsquo;s bet · {hero.metricName}
            </div>
            <div className="pubws-headline">
              <span className="pubws-price">{liveShown !== null ? formatValue(liveShown) : '–'}</span>
              {marketOpen !== null && displayConsensus !== null && displayConsensus !== marketOpen && (
                <span className={`pubws-delta-chip ${displayConsensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {displayConsensus >= marketOpen ? '▲' : '▼'} {formatDelta(displayConsensus - marketOpen)} since open
                </span>
              )}
            </div>
            {(ws.marketHistory?.length ?? 0) > 0 && (
              <MarketChart
                series={ws.marketHistory!}
                consensus={displayConsensus}
              />
            )}
            <div className="pubws-instrument-sub">
              settles {settleDate(hero.resolvesOn)}
              {ws.markets.length > 1 && <> · one of {ws.markets.length} open markets</>}
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
            {canTrade && (
              <p className="pubws-mechanism">
                propose <span className="pubws-arrow">→</span> everyone bets <span className="pubws-arrow">→</span> the winner ships
              </p>
            )}
          </section>
        )}

        {(proposals.length > 0 || trading) && ws.proposals !== undefined && (
          <section className="pubws-section">
            <h2 className="pubws-h2">
              On the ballot
              {soleMetricName && <span className="pubws-h2-context"> · priced impact on {soleMetricName}</span>}
            </h2>
            {proposals.length === 0 ? (
              <p className="pubws-empty">Nothing on the ballot yet. Yours could be first.</p>
            ) : (
              <ul className="pubws-ballot">
                {proposals.map(p => {
                  const delta = headlineDelta(p);
                  const expanded = openProposal === p.id;
                  const pair = p.markets[0];
                  return (
                    <li key={p.id} className={expanded ? 'is-open' : ''}>
                      <button className="pubws-ballot-row" onClick={() => setOpenProposal(expanded ? null : p.id)}>
                        <span className="pubws-ballot-title">{p.title}</span>
                        {delta === null || delta === 0
                          ? <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                          : <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{formatDelta(delta)}</span>}
                      </button>
                      {expanded && (
                        <div className="pubws-ballot-detail">
                          {p.description && <p className="pubws-proposal-desc">{p.description}</p>}
                          {pair && (
                            <div className="pubws-branches">
                              <BranchRow
                                label="if it ships"
                                consensus={pair.approvedConsensus}
                                busyPrefix={`${p.id}-approved`}
                                tradeBusy={tradeBusy}
                                trading={trading}
                                onTrade={dir => branchTrade(p, 'approved', dir)}
                              />
                              <BranchRow
                                label="if it doesn't"
                                consensus={pair.declinedConsensus}
                                busyPrefix={`${p.id}-declined`}
                                tradeBusy={tradeBusy}
                                trading={trading}
                                onTrade={dir => branchTrade(p, 'declined', dir)}
                              />
                            </div>
                          )}
                          {p.proposedByName && <p className="pubws-proposal-meta">proposed by {p.proposedByName}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {trading && (
              proposeOpen ? (
                <div className="pubws-propose">
                  <input
                    value={pTitle}
                    onChange={e => setPTitle(e.target.value)}
                    placeholder="What should they do?"
                    maxLength={120}
                    aria-label="Proposal title"
                  />
                  <textarea
                    value={pDesc}
                    onChange={e => setPDesc(e.target.value)}
                    placeholder="Why it moves the number (optional)"
                    rows={3}
                    aria-label="Proposal description"
                  />
                  <div className="pubws-propose-row">
                    <button className="pubws-cta pubws-cta--small" disabled={pBusy} onClick={() => void submitProposal()}>
                      {pBusy ? 'Submitting…' : 'Put it on the ballot · 40 cr stake'}
                    </button>
                    <button className="pubws-ghost" onClick={() => setProposeOpen(false)}>Cancel</button>
                  </div>
                  <p className="pubws-proposal-meta">
                    The stake seeds your proposal&rsquo;s own market so it is priceable immediately; it is a liquidity position, refunded pro-rata at resolution, not a fee.
                  </p>
                  {pErr && <p className="pubws-joinerr">{pErr}</p>}
                </div>
              ) : (
                <button className="pubws-ghost pubws-propose-open" onClick={() => setProposeOpen(true)}>
                  + Propose something
                </button>
              )
            )}
          </section>
        )}

        {decided.length > 0 && (
          <section className="pubws-section">
            <h2 className="pubws-h2">Decided</h2>
            <ul className="pubws-decided">
              {decided.map(d => (
                <li key={d.id}>
                  <div className="pubws-decided-head">
                    <span className="pubws-ballot-title">{d.title}</span>
                    <span className={`pubws-verdict pubws-verdict--${d.status}`}>{d.status === 'approved' ? 'shipped' : 'declined'}</span>
                  </div>
                  {d.declineReason && <p className="pubws-reason">{d.declineReason}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {ws.charter && (
          <details className="pubws-deal">
            <summary>The full deal</summary>
            <div className="pubws-deal-body">
              {ws.charter.split('\n\n').map((para, i) => <p key={i}>{linkify(para)}</p>)}
            </div>
          </details>
        )}

        <footer className="pubws-foot">
          Priced on <Link to="/">Telarchy</Link> · <Link to="/leaderboard">leaderboard</Link> · <Link to="/terms">terms</Link>
        </footer>
      </main>
    </div>
  );
}

function BranchRow({ label, consensus, busyPrefix, tradeBusy, trading, onTrade }: {
  label: string;
  consensus: number | null;
  busyPrefix: string;
  tradeBusy: string | null;
  trading: boolean;
  onTrade: (dir: 'higher' | 'lower') => void;
}) {
  return (
    <div className="pubws-branch">
      <span className="pubws-branch-label">{label}</span>
      <span className="pubws-branch-value">{consensus !== null ? formatValue(consensus) : '–'}</span>
      {trading && (
        <span className="pubws-branch-btns">
          <button className="pubws-dir pubws-dir--lower pubws-dir--mini" disabled={tradeBusy !== null} onClick={() => onTrade('lower')}>
            {tradeBusy === `${busyPrefix}-lower` ? '…' : '▼'}
          </button>
          <button className="pubws-dir pubws-dir--higher pubws-dir--mini" disabled={tradeBusy !== null} onClick={() => onTrade('higher')}>
            {tradeBusy === `${busyPrefix}-higher` ? '…' : '▲'}
          </button>
        </span>
      )}
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

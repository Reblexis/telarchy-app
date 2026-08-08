import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace, type PublicProposal } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * The share-link landing: /marketplace/:idOrSlug, rendered standalone (no app
 * shell). One screen answers a stranger's three questions in order: what is
 * this (name + one line), what is at stake (the market's call, rendered as an
 * instrument over its real range), and what do I do (one button). The
 * mechanism is three numbered lines; the full charter folds away until asked
 * for. Everything else on the old page (meta counts, empty sections, a second
 * CTA box, a markets table for a single market) was complexity a first-time
 * visitor paid for and never spent.
 *
 * The number is deliberately the largest element on the page, larger than the
 * product's own name: the product's claim is that a market price, not a
 * pitch, decides what ships. The range rail under it is the one signature
 * element, and it encodes the true mechanism (an LMSR market over
 * [rangeMin, rangeMax] whose consensus is the tick).
 */

function formatValue(v: number): string {
  const abs = Math.abs(v);
  // A big price wears no decimals: "6,672", not "6,672.0". Precision only
  // where the number is genuinely small.
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCompact(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
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
 *  page's one motion moment. Skipped entirely under prefers-reduced-motion. */
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

export function PublicWorkspacePage() {
  const { workspaceId: idOrSlug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<'idle' | 'joining' | 'error'>('idle');
  const [joinError, setJoinError] = useState('');
  const autoJoined = useRef(false);

  useEffect(() => {
    if (!idOrSlug) return;
    api.getMarketplaceWorkspace(idOrSlug)
      .then(setWs)
      .catch(e => {
        console.error('public workspace fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load workspace');
      });
  }, [idOrSlug]);

  const handleJoin = async (target?: PublicWorkspace) => {
    const w = target ?? ws;
    if (!w) return;
    if (!user) {
      navigate(`/signup?next=${encodeURIComponent(`/marketplace/${idOrSlug}?join=1`)}`);
      return;
    }
    setJoinState('joining');
    try {
      await api.joinWorkspace(w.workspaceId);
      setActiveWorkspace(w.workspaceId);
      navigate((w.proposals?.length ?? 0) > 0 ? '/proposals' : '/markets');
    } catch (err) {
      setJoinError((err as Error).message || 'Failed to join');
      setJoinState('error');
    }
  };

  useEffect(() => {
    if (!ws || !user || autoJoined.current) return;
    if (searchParams.get('join') !== '1') return;
    autoJoined.current = true;
    handleJoin(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, user, searchParams]);

  // The instrument reads the soonest-resolving market (the list arrives in
  // that order). The count-up starts from the range midpoint: the untouched
  // LMSR prior, i.e. what the number was before anyone priced it.
  const hero = ws?.markets[0] ?? null;
  const consensus = hero?.consensus ?? null;
  const mid = hero ? (hero.rangeMin + hero.rangeMax) / 2 : null;
  const shown = useCountUp(consensus, mid);
  const tickPct = hero && shown !== null && hero.rangeMax > hero.rangeMin
    ? Math.min(100, Math.max(0, ((shown - hero.rangeMin) / (hero.rangeMax - hero.rangeMin)) * 100))
    : 50;

  const soleMetricName = useMemo(() => {
    const names = new Set<string>();
    for (const p of ws?.proposals ?? []) for (const m of p.markets) names.add(m.metricName);
    return names.size === 1 ? [...names][0] : null;
  }, [ws]);

  if (error) {
    return (
      <div className="pubws">
        <TopBar />
        <main className="pubws-main">
          <h1 className="pubws-name">Workspace unavailable</h1>
          <p className="pubws-pitch">{error}</p>
          <p className="pubws-pitch"><Link to="/marketplace">Browse public workspaces</Link></p>
        </main>
      </div>
    );
  }

  if (!ws) {
    return (
      <div className="pubws">
        <TopBar />
        <main className="pubws-main"><p className="pubws-pitch">Loading…</p></main>
      </div>
    );
  }

  const canTrade = ws.joinAs === 'trader';
  const proposals = ws.proposals ?? [];
  const decided = (ws.decided ?? []).filter(d => d.status === 'declined' ? d.declineReason : true);

  return (
    <div className="pubws">
      <TopBar />
      <main className="pubws-main">
        <header className="pubws-hero">
          <h1 className="pubws-name">{ws.name}</h1>
          {ws.description && <p className="pubws-pitch">{ws.description}</p>}
        </header>

        {hero && consensus !== null && (
          <section className="pubws-instrument" aria-label="The market's current call">
            <div className="pubws-instrument-label">
              the market&rsquo;s call · {hero.metricName}
            </div>
            <div className="pubws-price">{shown !== null ? formatValue(shown) : '–'}</div>
            <div className="pubws-rail" role="img" aria-label={`Market range ${hero.rangeMin} to ${hero.rangeMax}, current consensus ${formatValue(consensus)}`}>
              <span className="pubws-rail-min">{formatCompact(hero.rangeMin)}</span>
              <span className="pubws-rail-track"><span className="pubws-rail-tick" style={{ left: `${tickPct}%` }} /></span>
              <span className="pubws-rail-max">{formatCompact(hero.rangeMax)}</span>
            </div>
            <div className="pubws-instrument-sub">
              settles {settleDate(hero.resolvesOn)}
              {ws.markets.length > 1 && <> · one of {ws.markets.length} open markets</>}
            </div>
          </section>
        )}

        <section className="pubws-act">
          <button className="pubws-cta" onClick={() => handleJoin()} disabled={joinState === 'joining'}>
            {joinState === 'joining' ? 'Joining…'
              : !user ? (canTrade ? 'Join free and move the number' : 'Join free and watch')
              : canTrade ? 'Join and start trading'
              : 'Join to watch'}
          </button>
          <p className="pubws-fineprint">
            {ws.signupCredits.toLocaleString()} free credits · play money, cash never involved
          </p>
          {joinState === 'error' && <p className="pubws-joinerr">{joinError}</p>}
        </section>

        {proposals.length > 0 && (
          <section className="pubws-section">
            <h2 className="pubws-h2">On the ballot{soleMetricName && <span className="pubws-h2-note"> · priced impact on {soleMetricName}</span>}</h2>
            <ul className="pubws-ballot">
              {proposals.map(p => {
                const delta = headlineDelta(p);
                return (
                  <li key={p.id}>
                    <span className="pubws-ballot-title">{p.title}</span>
                    {delta === null || delta === 0
                      ? <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                      : <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{formatDelta(delta)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {canTrade && (
          <section className="pubws-section">
            <h2 className="pubws-h2">How it works</h2>
            <ol className="pubws-steps">
              <li><span className="pubws-step-n">1</span>Propose what the owner should do next.</li>
              <li><span className="pubws-step-n">2</span>Everyone bets on what each idea does to the number above.</li>
              <li><span className="pubws-step-n">3</span>The highest-priced idea ships, or the owner publishes why not.</li>
            </ol>
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
              {ws.charter.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
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

function TopBar() {
  return (
    <nav className="pubws-topbar">
      <Link to="/" className="pubws-wordmark">Telarchy</Link>
      <Link to="/login" className="pubws-login">Log in</Link>
    </nav>
  );
}

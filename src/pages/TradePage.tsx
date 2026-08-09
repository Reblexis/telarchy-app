import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setActiveWorkspace, type PublicWorkspace } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { MarketChart } from '../components/MarketChart';
import { Logo } from '../components/Logo';

/**
 * telarchy.com/<slug>: the market, and nothing else (owner decision,
 * 2026-08-09: minimal first, add more later). The page renders exactly one
 * object, the prediction: the headline ("<metric> @ <settle date>"), the
 * price, and the Manifold-style step chart of the market's call. That is
 * the whole page; it is view-only in this phase. No trade controls, no CTA,
 * no captions; an anonymous visitor additionally gets "Log in" in the top
 * bar. The tradebar, ballot, charter, decided list, pitch and footer are
 * deliberately NOT rendered; the API still ships what it shipped, so
 * bringing each back is a render change, not a feature.
 *
 * /marketplace/:idOrSlug still resolves here and canonicalizes to /<slug>.
 * A signed-in visitor on an Open workspace is joined silently; membership is
 * bookkeeping, not a decision, and it means every account that has seen the
 * page is already a member the day trading turns back on.
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

export function TradePage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joinTried = useRef(false);

  useEffect(() => {
    if (!idOrSlug) return;
    api.getMarketplaceWorkspace(idOrSlug)
      .then(setWs)
      .catch(e => {
        console.error('trade page fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load workspace');
      });
  }, [idOrSlug]);

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
      .then(() => setActiveWorkspace(ws.workspaceId))
      .catch(e => console.error('silent join failed:', e));
  }, [ws, user]);

  const hero = ws?.markets[0] ?? null;
  // The prediction's own movement: current call vs the call after the
  // market's first trade. About the market, not the metric.
  const marketOpen = ws?.marketHistory?.length ? ws.marketHistory.find(p => p.consensus !== null)?.consensus ?? null : null;
  const consensus = hero?.consensus ?? null;

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
    // The loading screen is the brand mark breathing where the market is
    // about to appear; no spinner, no text, no layout shift.
    return (
      <div className="pubws pubws--center">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="pubws-main">
          <div className="pubws-loading" role="status" aria-label="Loading">
            <Logo variant="mark" height="2.4rem" />
          </div>
        </main>
      </div>
    );
  }

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
            <div className="pubws-instrument-label pubws-enter pubws-enter--1">
              {hero.metricName.replace(/\s*\(.*\)\s*$/, '')} @ {settleDate(hero.resolvesOn)}
            </div>
            <div className="pubws-headline pubws-enter pubws-enter--2">
              <span className="pubws-price">{formatValue(consensus)}</span>
              {marketOpen !== null && consensus !== marketOpen && (
                <span className={`pubws-delta-chip ${consensus >= marketOpen ? 'is-up' : 'is-down'}`}>
                  {consensus >= marketOpen ? '▲' : '▼'} {formatDelta(consensus - marketOpen)} since open
                </span>
              )}
            </div>
            {(ws.marketHistory?.length ?? 0) > 0 && (
              <div className="pubws-enter pubws-enter--3">
                <MarketChart series={ws.marketHistory!} consensus={consensus} />
              </div>
            )}
          </section>
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

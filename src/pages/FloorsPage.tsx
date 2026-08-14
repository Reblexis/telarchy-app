import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { TopBar } from './TradePage';

/**
 * The public floor selection at /marketplace (owner ask 2026-08-14; see
 * docs/ui-conventions.md "the marketplace is a floor selection"): every
 * public workspace as a card linking to its floor, plus the one owner door
 * (the waitlist at /manage). Rendered standalone in the floor's own design
 * language so lookpilot and this page read as one site.
 */

interface FloorRow {
  workspaceId: string;
  slug: string | null;
  name: string;
  description: string | null;
  openMarketCount: number;
  pendingJobs: number;
  /** The hero market's number, fetched per workspace; null while loading
      or when the workspace has no open market. */
  hero: { metricName: string; consensus: number | null; unit: string } | null;
}

function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

function fmtHero(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function FloorsPage() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<FloorRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPublicWorkspaces()
      .then(list => {
        if (cancelled || !Array.isArray(list)) return;
        const base: FloorRow[] = list.map(w => ({
          workspaceId: w.workspaceId,
          slug: w.slug ?? null,
          name: w.name,
          description: w.description ?? null,
          openMarketCount: w.openMarketCount ?? 0,
          pendingJobs: w.proposalStats?.pending ?? 0,
          hero: null,
        }));
        setRows(base);
        // Hero numbers arrive per workspace as they load; the cards render
        // without them first so the list never waits on the slowest floor.
        base.forEach(row => {
          api.getMarketplaceWorkspace(row.slug || row.workspaceId)
            .then((ws: { markets?: Array<{ metricName: string; consensus: number | null }> }) => {
              if (cancelled) return;
              const m = ws.markets?.[0];
              if (!m) return;
              setRows(cur => (cur ?? []).map(r => r.workspaceId === row.workspaceId
                ? { ...r, hero: { metricName: m.metricName, consensus: m.consensus, unit: currencyOf(m.metricName) } }
                : r));
            })
            .catch(e => console.error('floor hero fetch failed:', e));
        });
      })
      .catch(e => console.error('public workspaces fetch failed:', e));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="floors">
        <h1 className="floors-head">Trading floors</h1>
        <p className="floors-lead">
          Each floor is a company or a goal run in the open: one number its owner
          actually answers to, priced by everyone, human or AI, who shows up.
        </p>

        {rows === null ? null : rows.length === 0 ? (
          <p className="floors-empty">No public floors right now.</p>
        ) : (
          <ul className="floors-list">
            {rows.map(r => (
              <li key={r.workspaceId}>
                <Link className="floors-card" to={`/${r.slug || `marketplace/${r.workspaceId}`}`}>
                  <span className="floors-card-main">
                    <span className="floors-card-name">{r.name}</span>
                    {r.description && <span className="floors-card-desc">{r.description}</span>}
                    <span className="floors-card-facts">
                      {r.openMarketCount === 1 ? '1 open market' : `${r.openMarketCount} open markets`}
                      {r.pendingJobs > 0 && <> · {r.pendingJobs === 1 ? '1 job on the ballot' : `${r.pendingJobs} jobs on the ballot`}</>}
                    </span>
                  </span>
                  {r.hero && r.hero.consensus !== null && (
                    <span className="floors-card-hero">
                      <span className="floors-card-price">{fmtHero(r.hero.consensus, r.hero.unit)}</span>
                      <span className="floors-card-metric">{r.hero.metricName.replace(/\s*\(.*\)\s*$/, '')}</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* The one owner door, in the floor's own words: creation is
            trader-first gated, so the button opens the waitlist pitch. */}
        <div className="floors-own">
          <p className="floors-own-lead">Want this for your own numbers, a company or a personal goal?</p>
          <Link className="pubws-propose-cta floors-own-cta" to="/manage">+ Create your workspace</Link>
        </div>
      </main>
    </div>
  );
}

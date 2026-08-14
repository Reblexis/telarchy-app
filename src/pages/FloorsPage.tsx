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
  /** The hero market's number and its trade history, fetched per
      workspace; null while loading or when the workspace has no open
      market. */
  hero: { metricName: string; consensus: number | null; unit: string; history: Array<{ at: string; consensus: number | null }> } | null;
}

function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

function fmtHero(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * A miniature of the floor's own poster: the hero market's real step line
 * ending in the live call dot. Same semantics as the big chart, at glance
 * size: the call holds between trades (step, then extended to the right
 * edge), and an untraded market draws its held call as a flat line. No
 * axes; the card's price label is the only numeral.
 */
function FloorSpark({ history, consensus }: { history: Array<{ at: string; consensus: number | null }>; consensus: number }) {
  const W = 132, H = 34, PAD = 4;
  const pts = history
    .filter(p => p.consensus !== null)
    .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const vals = [...pts.map(p => p.v), consensus];
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const spanV = vMax - vMin || Math.abs(vMax) * 0.1 || 1;
  const t0 = pts[0]?.t ?? 0;
  const t1 = Math.max(pts[pts.length - 1]?.t ?? 1, t0 + 1);
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2 - 6);
  const y = (v: number) => PAD + (1 - (v - vMin) / spanV) * (H - PAD * 2);
  const seq = pts.length > 0 ? [...pts, { t: t1, v: consensus }] : [{ t: t0, v: consensus }, { t: t1, v: consensus }];
  let d = `M${x(seq[0].t).toFixed(1)},${y(seq[0].v).toFixed(1)}`;
  for (let i = 1; i < seq.length; i++) {
    d += ` L${x(seq[i].t).toFixed(1)},${y(seq[i - 1].v).toFixed(1)} L${x(seq[i].t).toFixed(1)},${y(seq[i].v).toFixed(1)}`;
  }
  const endX = x(t1), endY = y(consensus);
  return (
    <svg className="floors-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} className="floors-spark-line" />
      <circle cx={endX} cy={endY} r="3" className="floors-spark-dot" />
    </svg>
  );
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
            .then((ws: { markets?: Array<{ metricName: string; consensus: number | null }>; marketHistory?: Array<{ at: string; consensus: number | null }> }) => {
              if (cancelled) return;
              const m = ws.markets?.[0];
              if (!m) return;
              setRows(cur => (cur ?? []).map(r => r.workspaceId === row.workspaceId
                ? { ...r, hero: { metricName: m.metricName, consensus: m.consensus, unit: currencyOf(m.metricName), history: ws.marketHistory ?? [] } }
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
                      <FloorSpark history={r.hero.history} consensus={r.hero.consensus} />
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

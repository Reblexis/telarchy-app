import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ghost, LoadingStatus } from '../components/Ghosts';
import { Bars, Drop, Page, People, short } from '../components/MarketFacts';
import { CreateWorkspaceDialog } from '../components/OwnerDialogs';
import { useAuth } from '../hooks/useAuth';
import type { HomeListing, HomePayload, PrizeSeason, PublicWorkspace } from '../lib/api';
import { api } from '../lib/api';
import { buildHorizonViews, priceSeriesOf, primaryHorizonOf } from '../lib/floor-horizons';
import { dropInline, readInline } from '../lib/inline-data';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { TopBar } from './TradePage';

/** The server plants the home payload in the served HTML under this id
 *  (docs/ui-conventions.md, "While a page loads"). */
const INLINE_HOME = 'telarchy-home';

/**
 * The marketplace at /marketplace (owner direction 2026-08-14, Viktor,
 * replacing the two-door lobby of the same day; see docs/ui-conventions.md
 * "the marketplace"). Three complaints drove this pass: the doors did not
 * show the market at all, nothing said what a listing IS, and the page read
 * as a fixed pair of buttons rather than a marketplace that grows.
 *
 * So: a card grid that reads the same with two listings or twenty, each card
 * carrying the market itself (the hero market's real trade history as a step
 * line ending on the live call), the owner's one-line description, and the
 * activity behind it. The last cell is always the big plus: adding your own
 * number is part of the marketplace, not a footnote under it.
 *
 * User-facing copy here says MARKET, never "floor" (owner 2026-08-14:
 * "what the hell is floor, no one will understand that"). "Floor" survives
 * only as internal vocabulary in component and class names.
 *
 * Nothing here reaches the old console UI, for anyone, admin included.
 */

interface Listing {
  workspaceId: string;
  slug: string | null;
  name: string;
  /** The owner's one-liner: what this market is, in their words. */
  description: string | null;
  pendingJobs: number;
  /** Fills in per workspace as each payload lands, so the grid never waits
   *  on the slowest listing. */
  hero: {
    metricName: string;
    consensus: number | null;
    unit: string;
    settles: string | null;
    history: Array<{ at: string; consensus: number | null }>;
  } | null;
  participants: number | null;
  tradesThisWeek: number | null;
  /** Credits actually in the pools of the open markets, summed; null until
   *  the payload lands. Never the LMSR parameter (docs/ui-conventions.md,
   *  "The marketplace"). The grid orders on it. */
  liquidity: number | null;
  /** Set for the caller's own floors: 'unlisted' | 'private' badges the card
   *  "Yours · not public yet"; a public own floor is a card like any other. */
  mineVisibility?: string;
}

/** Credits in the pools of the open markets, summed. An empty market list
 *  is "nothing to say" rather than zero, so the card stays quiet. */
function poolLiquidityOf(ws: { markets?: Array<{ pool?: number }> }): number | null {
  const markets = ws.markets ?? [];
  if (markets.length === 0) return null;
  return markets.reduce((sum, m) => sum + (m.pool ?? 0), 0);
}

/** Deepest liquidity first; cards without it yet, and ties, keep their
 *  arrival order (Array.prototype.sort is stable). */
function byLiquidity(a: Listing, b: Listing): number {
  return (b.liquidity ?? -1) - (a.liquidity ?? -1);
}

/** "31 December 2026" -> "31 Dec", the caption's short form; the full day is
 *  the hover title. */
function shortDay(day: string): string {
  return day.replace(/^(\d+) ([A-Za-z]{3})[A-Za-z]* \d{4}$/, '$1 $2');
}

function fmtHero(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * The market itself, at glance size: a miniature of the floor's own poster
 * chart, with the same held-call semantics (the call holds flat between
 * trades, so the line steps and then runs to the right edge; an untraded
 * market draws one flat line). No axes: the card's price is the only
 * numeral, and the dot marks where the market stands now.
 */
function MarketSpark({
  history,
  consensus,
}: {
  history: Array<{ at: string; consensus: number | null }>;
  consensus: number;
}) {
  const W = 260,
    H = 72,
    PAD = 8;
  const pts = history
    .filter(p => p.consensus !== null)
    .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  // Robust y domain, the same 5th-95th percentile rule the poster chart
  // uses: one wild print (a market briefly taken to 150k) must not flatten
  // every real move into a straight line. The live call always widens the
  // domain rather than being clipped, and the padding keeps a quiet market
  // drawing through the middle instead of along the box's edge.
  const sorted = [...pts.map(p => p.v)].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
  const lo = sorted.length ? Math.min(quantile(0.05), consensus) : consensus;
  const hi = sorted.length ? Math.max(quantile(0.95), consensus) : consensus;
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.35;
  const vMin = lo - pad,
    vMax = hi + pad;
  const spanV = vMax - vMin;
  // Excursions past the domain draw at the edge instead of off the card.
  const clamp = (v: number) => Math.max(vMin, Math.min(vMax, v));
  const t0 = pts[0]?.t ?? 0;
  const t1 = Math.max(pts[pts.length - 1]?.t ?? 1, t0 + 1);
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2 - 6);
  const y = (v: number) => PAD + (1 - (clamp(v) - vMin) / spanV) * (H - PAD * 2);
  const seq =
    pts.length > 0
      ? [...pts, { t: t1, v: consensus }]
      : [
          { t: t0, v: consensus },
          { t: t1, v: consensus },
        ];
  let d = `M${x(seq[0].t).toFixed(1)},${y(seq[0].v).toFixed(1)}`;
  for (let i = 1; i < seq.length; i++) {
    d += ` L${x(seq[i].t).toFixed(1)},${y(seq[i - 1].v).toFixed(1)} L${x(seq[i].t).toFixed(1)},${y(seq[i].v).toFixed(1)}`;
  }
  // The same path closed along the baseline, so the card carries a little
  // weight without a second colour.
  const area = `${d} L${x(t1).toFixed(1)},${H - PAD} L${x(seq[0].t).toFixed(1)},${H - PAD} Z`;
  return (
    <svg className="mkt-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} className="mkt-spark-area" />
      <path d={d} className="mkt-spark-line" />
      <circle cx={x(t1)} cy={y(consensus)} r="3" className="mkt-spark-dot" />
    </svg>
  );
}

/**
 * The activity behind a market as the market page's facts row: icons and
 * bare numbers, meaning on hover (docs/ui-conventions.md, "The
 * marketplace"). Counts arrive per card on their own request, so a fact
 * that has not landed yet is left out rather than shown as zero.
 */
function ActivityFacts({ r }: { r: Listing }) {
  return (
    <span className="mkt-cell-activity pubws-facts" aria-label="Market facts">
      {r.participants !== null && (
        <span title={`${r.participants} participant${r.participants === 1 ? '' : 's'}`}>
          <People /> {short(r.participants)}
        </span>
      )}
      {r.liquidity !== null && (
        <span title={`${short(r.liquidity)} credits in the pools of its open markets, which winnings come out of`}>
          <Drop /> {short(r.liquidity)}
        </span>
      )}
      {r.tradesThisWeek !== null && (
        <span title={`${r.tradesThisWeek} trades this week`}>
          <Bars /> {short(r.tradesThisWeek)}
        </span>
      )}
      {r.pendingJobs > 0 && (
        <span title={`${r.pendingJobs} proposal${r.pendingJobs === 1 ? '' : 's'} priced now`}>
          <Page /> {short(r.pendingJobs)}
        </span>
      )}
    </span>
  );
}

/**
 * The listing tile: the last cell of the grid, and the only interactive one.
 * Cell B of the floor canvas (owner pick 2026-09-04, docs/ui-conventions.md,
 * "The marketplace"): the mono label "Your own numbers", the owner's
 * sentence in the display face, the mechanism in one line, then the door.
 * The headline above the board stays trader-first; this cell is where the
 * company-facing sentence lives.
 *
 * "Create your own" opens the create-floor dialog and lands the owner on
 * their empty floor, where the first metric is one more dialog away (owner
 * ask 2026-08-28, replacing the 2026-08-26 email field: creation is
 * self-serve now, so the honest promise on the front page is a floor in a
 * minute, not contact within days; notes/decisions/ui-conventions.md).
 * Signed out, the same button is the door to signing up, because a floor
 * needs an owner to belong to.
 *
 * Dual-scope on purpose. A person governing their own goal is as welcome as a
 * company (AGENTS.md, "Scope"), and the tile is the one place on the home page
 * where a visitor decides which side they are on.
 */
function ListYourNumberCell() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const arrow = (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  );

  return (
    <div className="mkt-cell mkt-cell--new">
      <span className="mkt-new-label">Your own numbers</span>
      <span className="mkt-new-title">See what a decision does to your numbers before you say yes.</span>
      <span className="mkt-new-sub">
        List your metrics. Traders, people or bots, price each proposal against them, and you decide on the price.
      </span>
      {user || loading ? (
        <button type="button" className="mkt-new-cta" disabled={loading} onClick={() => setCreating(true)}>
          Create your own {arrow}
        </button>
      ) : (
        <Link className="mkt-new-cta" to="/signup">
          Create your own {arrow}
        </Link>
      )}
      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} onCreated={path => navigate(path)} />}
    </div>
  );
}

/**
 * The prize season, on the front door.
 *
 * The home page said nothing about the season until 2026-08-21, which made the
 * contest useless as the recruiting mechanism it is meant to be: every post
 * pointing at telarchy.com landed on a page whose only calls to action were
 * owner-facing ("List your own number"), so a trader who arrived had nowhere
 * to go.
 *
 * One line and a link, the same rule the market rail and the leaderboard
 * follow: the season owns /season, and no other surface grows a second copy of
 * it. What earns its place here is the clock, the money, and a door.
 */
function SeasonDoor({ season }: { season: PrizeSeason | null }) {
  const clock = useSeasonClock(season);
  if (!season || !clock) return null;

  return (
    <section className="mkt-season" aria-label={season.name}>
      <p className="mkt-season-clock">
        <span className="mkt-season-name">{season.name}</span>
        {clock.headline}
      </p>
      <p className="mkt-season-line">
        ${season.poolUsd.toLocaleString()} in real money, split among the traders in proportion to their profit. Free to
        enter, no purchase, no stake.
      </p>
      <Link className="mkt-season-cta" to="/season">
        {clock.entryOpen ? 'Enter the season' : 'See the season'}
      </Link>
    </section>
  );
}

/** The season strip's ghost: the same hairlines, grey bars where the words go. */
function SeasonGhost() {
  return (
    <div className="mkt-season mkt-season--ghost" aria-hidden="true">
      <Ghost w={60} h={9} />
      <Ghost w={150} h={11} />
      <Ghost w="40%" h={10} />
      <Ghost w={120} h={28} r={999} style={{ marginLeft: 'auto' }} />
    </div>
  );
}

/** A cell's ghost: the same geometry, grey bars where the words go. */
function GhostCell() {
  return (
    <div className="mkt-ghost" aria-hidden="true">
      <div className="mkt-ghost-head">
        <Ghost w="46%" h={18} />
      </div>
      <Ghost w="52%" h={10} />
      <Ghost w="34%" h={30} style={{ marginTop: 6 }} />
      <Ghost w="88%" h={11} style={{ marginTop: 6 }} />
      <Ghost w="62%" h={11} />
      <Ghost w="100%" h={44} r={6} style={{ marginTop: 'auto' }} />
      <Ghost w="40%" h={9} />
    </div>
  );
}

/** What a cell shows, derived from the floor payload the same way the floor
 *  itself does, so a cell and the page it links to never name different
 *  numbers. The furthest-resolving market is the cell's number (owner
 *  direction 2026-08-16). */
function fromFloor(ws: PublicWorkspace): Pick<Listing, 'hero' | 'participants' | 'tradesThisWeek' | 'liquidity'> {
  const m = primaryHorizonOf(buildHorizonViews(ws));
  return {
    participants: ws.participantCount ?? null,
    tradesThisWeek: ws.tradesThisWeek ?? null,
    liquidity: poolLiquidityOf(ws),
    hero: m
      ? {
          metricName: m.metricName,
          consensus: m.consensus,
          unit: m.unit,
          settles: m.settleDay,
          history: priceSeriesOf(m.marketId, ws, {}),
        }
      : null,
  };
}

function listingOf(w: HomeListing): Listing {
  return {
    workspaceId: w.workspaceId,
    slug: w.slug ?? null,
    name: w.name,
    description: w.description ?? null,
    pendingJobs: w.proposalStats?.pending ?? 0,
    hero: null,
    participants: null,
    tradesThisWeek: null,
    liquidity: null,
    ...(w.floor ? fromFloor(w.floor) : {}),
  };
}

export function FloorsPage() {
  const { user, loading: authLoading } = useAuth();
  // A full document load already carries the payload (the server inlines
  // it); read it once, on mount, and drop it so a client-side return to
  // this page fetches instead of painting a stale copy.
  const [inline] = useState(() => readInline<HomePayload>(INLINE_HOME));
  const [listings, setListings] = useState<Listing[] | null>(() => (inline ? inline.listings.map(listingOf) : null));
  const [season, setSeason] = useState<PrizeSeason | null>(() => (inline ? pickCurrentSeason(inline.seasons) : null));

  useEffect(() => {
    dropInline(INLINE_HOME);
    if (inline) return;
    let cancelled = false;
    api
      .getHome()
      .then(home => {
        if (cancelled) return;
        setListings(cur => {
          const fresh = home.listings.map(listingOf);
          // Own not-yet-public floors may already be in the grid; keep them.
          const own = (cur ?? []).filter(r => r.mineVisibility && !fresh.some(f => f.workspaceId === r.workspaceId));
          return [...own, ...fresh];
        });
        setSeason(pickCurrentSeason(home.seasons));
      })
      .catch(e => console.error('home fetch failed:', e));
    return () => {
      cancelled = true;
    };
  }, [inline]);

  // The caller's own not-yet-public floors join the grid, first, among the
  // others, badged "Yours · not public yet" (owner decision 2026-08-28:
  // everything public by default; what is not public yet is still not hidden
  // from the person it belongs to). They are not in the public payload, so
  // each fetches its own floor and shows a ghost spark until it lands.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .listWorkspaces()
      .then(list => {
        if (cancelled || !Array.isArray(list)) return;
        const mine = (
          list as Array<{
            id: string;
            name: string;
            slug?: string | null;
            description?: string | null;
            visibility?: string;
          }>
        )
          .filter(w => w.visibility !== 'public')
          .map(w => ({
            workspaceId: w.id,
            slug: null,
            name: w.name,
            description: w.description ?? null,
            pendingJobs: 0,
            hero: null,
            participants: null,
            tradesThisWeek: null,
            liquidity: null,
            mineVisibility: w.visibility ?? 'private',
          }));
        if (mine.length === 0) return;
        setListings(cur => [
          ...mine.filter(m => !(cur ?? []).some(r => r.workspaceId === m.workspaceId)),
          ...(cur ?? []),
        ]);
        mine.forEach(row => {
          api
            .getMarketplaceWorkspace(row.workspaceId)
            .then(ws => {
              if (cancelled) return;
              setListings(cur =>
                (cur ?? []).map(r => (r.workspaceId === row.workspaceId ? { ...r, ...fromFloor(ws) } : r)),
              );
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const busy = listings === null;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} busy={busy} />
      <main className="mkt">
        <div className="mkt-glow" aria-hidden="true" />
        {/* No page title (owner direction 2026-08-20): the sentence IS the
            opening, and the board under it is the evidence. Plain words, no
            "bet" and no "priced" (approved proposal on the Telarchy floor,
            2026-09-04; notes/decisions/ui-conventions.md). */}
        <h1 className="mkt-thesis">Forecast a company's metrics. Get paid when you're right.</h1>
        <p className="mkt-lead">
          Revenue, users, active traders, updated by the people running them. Forecast free, human or AI, or list your
          own number and see the forecast before you decide.
        </p>

        {busy ? <SeasonGhost /> : <SeasonDoor season={season} />}

        {/* While the payload is on its way the board is drawn as ghosts in
            the real geometry (docs/ui-conventions.md, "While a page loads").
            Never a dot, never a spinner, never a blank. */}
        <div className="mkt-board">
          {busy ? (
            <>
              <GhostCell />
              <GhostCell />
              <GhostCell />
              <LoadingStatus />
            </>
          ) : (
            <>
              {[...listings].sort(byLiquidity).map((r, i) => (
                <Link
                  key={r.workspaceId}
                  className="mkt-cell pubws-rise"
                  style={{ animationDelay: `${i * 60}ms` }}
                  to={`/${r.slug || `marketplace/${r.workspaceId}`}`}
                >
                  <span className="mkt-cell-head">
                    <span className="mkt-cell-name">{r.name}</span>
                    {r.mineVisibility && <span className="mkt-cell-mine">Yours · not public yet</span>}
                  </span>
                  {r.hero && (
                    <span className="mkt-cell-caption">
                      <span className="mkt-cell-metric">{r.hero.metricName.replace(/\s*\(.*\)\s*$/, '')}</span>
                      {r.hero.settles && (
                        <>
                          {' · '}
                          <span className="mkt-cell-settles" title={`settles ${r.hero.settles}`}>
                            settles {shortDay(r.hero.settles)}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                  {r.hero?.consensus != null && (
                    <span className="mkt-cell-price">{fmtHero(r.hero.consensus, r.hero.unit)}</span>
                  )}
                  {r.description && <span className="mkt-cell-desc">{r.description}</span>}
                  {/* The chart slot keeps its height either way, so nothing
                      jumps when a late number arrives. */}
                  <span className="mkt-cell-chart">
                    {r.hero?.consensus != null ? (
                      <MarketSpark history={r.hero.history} consensus={r.hero.consensus} />
                    ) : (
                      <Ghost w="100%" h={44} r={6} className="mkt-spark-ghost" />
                    )}
                  </span>
                  <span className="mkt-cell-facts">
                    <ActivityFacts r={r} />
                  </span>
                </Link>
              ))}

              {/* The last cell of the board, never a footnote: a marketplace
                  is somewhere you can also list. */}
              <ListYourNumberCell />
            </>
          )}
        </div>

        {/* The quiet doors (owner ask 2026-08-21): who runs this and how to
            reach them, findable from the front page without competing with
            the markets above. */}
        <footer className="pubws-foot">
          <Link to="/forecast">Forecasters</Link> · <Link to="/for-agents">Agent builders</Link> ·{' '}
          <Link to="/owners">Owners</Link> · <Link to="/about">About</Link> · <Link to="/contact">Contact</Link> ·{' '}
          <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          {/* Set VITE_PUBLIC_REPO_URL once the source is public; until then no link. */}
          {import.meta.env.VITE_PUBLIC_REPO_URL ? (
            <>
              {' '}
              ·{' '}
              <a href={import.meta.env.VITE_PUBLIC_REPO_URL} rel="noopener">
                Source
              </a>
            </>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

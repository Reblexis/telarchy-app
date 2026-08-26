import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { PrizeSeason } from '../lib/api';
import { api } from '../lib/api';
import { buildHorizonViews, priceSeriesOf, primaryHorizonOf } from '../lib/floor-horizons';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { TopBar } from './TradePage';

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
 * The activity behind a market, as one line. Built by joining the facts that
 * exist rather than by chaining separators: counts arrive per card on their
 * own request, and a fact that has not landed yet must not leave a leading
 * "·" hanging in the footer.
 */
function activityLine(r: Listing): string {
  const parts: string[] = [];
  if (r.participants !== null) {
    parts.push(r.participants === 1 ? '1 participant' : `${r.participants} participants`);
  }
  if (r.tradesThisWeek) parts.push(`${r.tradesThisWeek} trades this week`);
  if (r.pendingJobs > 0) {
    parts.push(r.pendingJobs === 1 ? '1 contract priced now' : `${r.pendingJobs} contracts priced now`);
  }
  return parts.join(' · ');
}

/**
 * The listing tile: the last cell of the grid, and the only interactive one.
 *
 * "Get set up" opens an email field IN PLACE and posts it to /api/waitlist
 * (docs/ui-conventions.md, "the marketplace"). The tile has led to Otto's
 * setup door at /manage since 2026-08-24; the owner sent it back to the email
 * on 2026-08-26 ("make get setup up lead to filling in email only again.. not
 * otto yet", notes/decisions/ui-conventions.md). The setup conversation is
 * still being hardened, and the first floors are set up with a person, so the
 * honest promise on the front page is contact within days, not a chat that
 * may not finish the job. Never queue language: an address here is a request
 * that gets answered, not a place in line.
 *
 * Dual-scope on purpose. A person governing their own goal is as welcome as a
 * company (AGENTS.md, "Scope"), and the tile is the one place on the home page
 * where a visitor decides which side they are on.
 */
function ListYourNumberCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Already listed counts as success: the client resolves a 409.
      await api.joinWaitlist({ email, source: 'marketplace' });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mkt-card mkt-card--new">
      <span className="mkt-new-mark" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <line x1="50" y1="22" x2="50" y2="78" />
          <line x1="22" y1="50" x2="78" y2="50" />
        </svg>
      </span>
      <span className="mkt-new-title">List your own number</span>
      <span className="mkt-new-sub">
        A company, a project, or something you are running yourself. Leave an email and we set it up with you.
      </span>
      {done ? (
        <p className="pubws-setup-done">Got it. We will get back to you within a few days.</p>
      ) : open ? (
        <form className="mkt-new-form" onSubmit={e => void submit(e)}>
          <div className="pubws-setup-row">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              aria-label="Your email"
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Get set up'}
            </button>
          </div>
          {error && <p className="pubws-setup-err">{error}</p>}
        </form>
      ) : (
        <button type="button" className="mkt-new-cta" onClick={() => setOpen(true)}>
          Get set up
        </button>
      )}
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
function SeasonDoor() {
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getSeasons()
      .then(r => {
        if (!cancelled) setSeason(pickCurrentSeason(r.seasons));
      })
      .catch(e => console.error('seasons fetch failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);
  const clock = useSeasonClock(season);
  if (!season || !clock) return null;

  return (
    <section className="mkt-season" aria-label={season.name}>
      <p className="mkt-season-clock">
        <span className="mkt-season-name">{season.name}</span>
        {clock.headline}
      </p>
      <p className="mkt-season-line">
        ${season.poolUsd.toLocaleString()} in real money to the traders whose profit grows the most. Free to enter, no
        purchase and no stake.
      </p>
      <Link className="mkt-season-cta" to="/season">
        {clock.entryOpen ? 'Enter the season' : 'See the season'}
      </Link>
    </section>
  );
}

export function FloorsPage() {
  const { user, loading: authLoading } = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicWorkspaces()
      .then(list => {
        if (cancelled || !Array.isArray(list)) return;
        const base: Listing[] = list.map(w => ({
          workspaceId: w.workspaceId,
          slug: w.slug ?? null,
          name: w.name,
          description: w.description ?? null,
          pendingJobs: w.proposalStats?.pending ?? 0,
          hero: null,
          participants: null,
          tradesThisWeek: null,
        }));
        setListings(base);
        base.forEach(row => {
          api
            .getMarketplaceWorkspace(row.slug || row.workspaceId)
            .then(ws => {
              if (cancelled) return;
              // The furthest-resolving market is the card's number (owner
              // direction 2026-08-16): LookPilot's card leads with net 2026,
              // not with the few hundred dollars this week has earned so
              // far. Lists arrive soonest-first.
              // The card leads with the DECISION horizon, and takes it from
              // the same model the floor uses, so a card and the page it links
              // to can never name different numbers.
              const m = primaryHorizonOf(buildHorizonViews(ws));
              setListings(cur =>
                (cur ?? []).map(r =>
                  r.workspaceId === row.workspaceId
                    ? {
                        ...r,
                        participants: ws.participantCount ?? null,
                        tradesThisWeek: ws.tradesThisWeek ?? null,
                        hero: m
                          ? {
                              metricName: m.metricName,
                              consensus: m.consensus,
                              unit: m.unit,
                              settles: m.settleDay,
                              history: priceSeriesOf(m.marketId, ws, {}),
                            }
                          : r.hero,
                      }
                    : r,
                ),
              );
            })
            .catch(e => console.error('market fetch failed:', e));
        });
      })
      .catch(e => console.error('public workspaces fetch failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="mkt">
        {/* No page title (owner direction 2026-08-20). This is the home page
            now, and "Marketplace" was a label for the furniture rather than a
            thing to read: what the visitor needs first is what any of this is.
            So the sentence IS the opening, set in the display face, and the
            cards under it are the evidence.

            The mechanism, said once, in the terms of the thing on screen:
            every listing is one number someone is trying to move, and the way
            to move it is a paid job the market prices before the owner pays
            for it. */}
        <h1 className="mkt-thesis">Every market here is one number someone is trying to move.</h1>
        <p className="mkt-lead">
          Anyone, human or AI, can propose a paid job that would move it, and the market prices the job before the owner
          decides.
        </p>

        <SeasonDoor />

        {/* Same loading motif as a market page (owner ask 2026-08-14): the
            call dot rippling where the thing is about to appear. No spinner,
            no text, and never a blank page. */}
        {listings === null ? (
          <div className="mkt-loading pubws-loading" role="status" aria-label="Loading">
            <span className="pubws-loading-dot" />
          </div>
        ) : (
          <div className="mkt-grid">
            {listings.map(r => (
              <Link key={r.workspaceId} className="mkt-card" to={`/${r.slug || `marketplace/${r.workspaceId}`}`}>
                <span className="mkt-card-head">
                  <span className="mkt-card-name">{r.name}</span>
                  {r.hero?.consensus != null && (
                    <span className="mkt-card-price">{fmtHero(r.hero.consensus, r.hero.unit)}</span>
                  )}
                </span>
                {r.hero && <span className="mkt-card-metric">{r.hero.metricName.replace(/\s*\(.*\)\s*$/, '')}</span>}
                {r.description && <span className="mkt-card-desc">{r.description}</span>}
                {/* Each card's number and history arrive on their own
                    request, so the chart slot carries the same rippling dot
                    until this market's payload lands. The slot keeps its
                    height either way, so nothing jumps when it does. */}
                <span className="mkt-card-chart">
                  {r.hero?.consensus != null ? (
                    <MarketSpark history={r.hero.history} consensus={r.hero.consensus} />
                  ) : (
                    <span className="mkt-card-loading pubws-loading" role="status" aria-label="Loading">
                      <span className="pubws-loading-dot" />
                    </span>
                  )}
                </span>
                {/* When it settles leads the footer: it is the one fact that
                    tells a visitor whether this market is worth their time
                    today. Activity follows it. */}
                <span className="mkt-card-facts">
                  {r.hero?.settles && <span className="mkt-card-settles">settles {r.hero.settles}</span>}
                  <span className="mkt-card-activity">{activityLine(r)}</span>
                </span>
              </Link>
            ))}

            {/* The last cell of the grid, never a footnote: a marketplace is
                somewhere you can also list. It takes the email right here
                (owner direction 2026-08-14) instead of sending people to
                another page to find the field. */}
            <ListYourNumberCard />
          </div>
        )}

        {/* The data-room footnote was removed on 2026-08-20 (owner direction).
            /data-room still serves; nothing on this page points at it. */}

        {/* The quiet doors (owner ask 2026-08-21): who runs this and how to
            reach them, findable from the front page without competing with
            the markets above. */}
        <footer className="pubws-foot">
          <Link to="/about">About</Link> · <Link to="/contact">Contact</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/privacy">Privacy</Link>
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

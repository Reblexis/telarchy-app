import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AudienceViz } from '../components/AudienceViz';
import { Ghost, GhostRows, LoadingStatus } from '../components/Ghosts';
import { deltaAt, fmtDelta, pendingBallot, poolOf, splitAsk } from '../components/JobsBoard';
import { PageTopBar } from '../components/PageTopBar';
import { AUDIENCE_PAGES, type AudienceBlock, type AudiencePage as PageData } from '../content/audiencePages.generated';
import { api, type PublicProposal, type PublicWorkspace } from '../lib/api';
import { withBase } from '../lib/base-path';
import { buildHorizonViews, primaryHorizonOf } from '../lib/floor-horizons';

/**
 * The audience pages: /forecast, /for-agents, /owners and the four
 * /compare/* pages. One component, seven routes, copy from
 * docs/audience-pages.md through scripts/build-audience-pages.mjs; nothing
 * on this file is prose. The pages argue a side of the market to a cold
 * visitor from a search or an AI answer (owner, 2026-08-27: say why here,
 * not what this is), so they are left-aligned poster pages in the .pubws
 * language with one extra shape, the side-by-side table.
 */

const FORECASTER_ROUTES = [
  '/forecast',
  '/for-agents',
  '/compare/manifold',
  '/compare/polymarket',
  '/compare/metaculus',
];
const OWNER_ROUTES = ['/owners', '/compare/futarchy-fi'];

/** API links leave the router (the catalog is served by the backend); everything else is a route. */
function isApiLink(h: string): boolean {
  return h.startsWith('/api');
}

function Block({ block }: { block: AudienceBlock }) {
  switch (block.kind) {
    case 'h2':
      return <h2 className="pubws-h2 pubws-aud-h2">{block.text}</h2>;
    case 'p':
      return (
        <p className="pubws-aud-p">
          {block.lead ? <strong className="pubws-aud-lead">{block.lead} </strong> : null}
          {block.text}
        </p>
      );
    case 'ol':
      return (
        <ol className="pubws-steps">
          {block.items.map((item, i) => (
            <li key={item}>
              <span className="pubws-step-n">{i + 1}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      );
    case 'ul':
      return (
        <ul className="pubws-aud-ul">
          {block.items.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="pubws-aud-scroll">
          <table className="pubws-aud-table">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={`${i}-${h}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map(row => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={`${i}-${cell}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'viz':
      return <AudienceViz name={block.name} />;
    // The board directives are placed by the board layout; a document page
    // carrying one shows the catch line as a paragraph and nothing for the
    // live blocks, which only a board draws.
    case 'catch':
      return <p className="pubws-aud-p">{block.text}</p>;
    case 'live':
    case 'show':
      return null;
    case 'code':
      return (
        <pre className="pubws-aud-code">
          <code>{block.text}</code>
        </pre>
      );
    case 'faq':
      return (
        <dl className="pubws-aud-faq">
          {block.items.map(({ q, a }) => (
            <div key={q} className="pubws-aud-qa">
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

const SIBLING_LABELS: Record<string, string> = {
  '/forecast': 'For forecasters',
  '/for-agents': 'For agent builders',
  '/compare/manifold': 'vs Manifold',
  '/compare/polymarket': 'vs Polymarket',
  '/compare/metaculus': 'vs Metaculus',
  '/owners': 'For owners',
  '/compare/futarchy-fi': 'vs Futarchy.fi',
};

function Siblings({ current }: { current: string }) {
  const name = (r: string) => SIBLING_LABELS[r] ?? r;
  const group = (label: string, routes: string[]) => (
    <p className="pubws-aud-sibs">
      <span className="pubws-contact-label">{label}</span>
      {routes.map(r =>
        r === current ? (
          <span key={r} className="pubws-aud-sib pubws-aud-sib--here">
            {name(r)}
          </span>
        ) : (
          <Link key={r} to={r} className="pubws-aud-sib">
            {name(r)}
          </Link>
        ),
      )}
    </p>
  );
  return (
    <section className="pubws-section pubws-aud-nav">
      {group('Forecasters', FORECASTER_ROUTES)}
      {group('Owners', OWNER_ROUTES)}
    </section>
  );
}

/** One call to action, routed the way the base-path rules require. */
function ActionLink({ action, className }: { action: { label: string; href: string }; className: string }) {
  return isApiLink(action.href) ? (
    <a href={withBase(action.href)} className={className}>
      {action.label}
    </a>
  ) : (
    <Link to={action.href} className={className}>
      {action.label}
    </Link>
  );
}

/** The footer and sibling links every audience page ends on, board or document. */
function Foot({ route }: { route: string }) {
  return (
    <>
      <Siblings current={route} />
      <footer className="pubws-foot">
        Telarchy is built by Viktor Cihal. Questions: <a href="mailto:support@telarchy.com">support@telarchy.com</a>.
        <br />
        <Link to="/">Open the app</Link> · <a href={withBase('/api/help')}>Read the API catalog</a> ·{' '}
        <Link to="/legal/season-0">Read the Season 0 rules</Link> · <Link to="/about">About</Link>
      </footer>
    </>
  );
}

/**
 * The routes laid out as a board rather than a document
 * (docs/audience-pages.md, "/owners is laid out as a board"): the copy is
 * the same copy, in the language of the home page. Only /owners today.
 */
const BOARD_ROUTES = new Set(['/owners']);

/** The page's blocks, cut at every H2: what the board lays out row by row. */
interface Section {
  heading: string;
  blocks: AudienceBlock[];
}
function sections(blocks: AudienceBlock[]): { lead: AudienceBlock[]; sections: Section[] } {
  const lead: AudienceBlock[] = [];
  const out: Section[] = [];
  for (const b of blocks) {
    if (b.kind === 'h2') out.push({ heading: b.text, blocks: [] });
    else if (out.length === 0) lead.push(b);
    else out[out.length - 1].blocks.push(b);
  }
  return { lead, sections: out };
}

type Para = { kind: 'p'; lead?: string; text: string };
const firstPara = (s: Section | undefined) => s?.blocks.find(b => b.kind === 'p') as Para | undefined;

const Arrow = () => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M2 7h10M8 3l4 4-4 4" />
  </svg>
);

/** A quiet accent link with an arrow, routed the way the base-path rules require. */
function QuietLink({ action }: { action: { label: string; href: string } }) {
  return isApiLink(action.href) ? (
    <a href={withBase(action.href)} className="own-quiet">
      {action.label} <Arrow />
    </a>
  ) : (
    <Link to={action.href} className="own-quiet">
      {action.label} <Arrow />
    </Link>
  );
}

/**
 * One hairline strip of three live figures from GET /api/marketplace/stats:
 * open markets, forecasters, forecasts this week. Ghosts while they load
 * (docs/ui-conventions.md, "While a page loads"); nothing at all if the
 * request fails, because a strip of dashes argues against the page.
 */
function LiveStrip() {
  const [stats, setStats] = useState<{ marketsActive: number; agentsActive: number; tradesThisWeek: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getStats()
      .then(s => {
        if (live) setStats(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  if (failed) return null;
  const figures: [string, number | null][] = [
    ['open markets', stats?.marketsActive ?? null],
    ['forecasters, human or AI', stats?.agentsActive ?? null],
    ['forecasts this week', stats?.tradesThisWeek ?? null],
  ];
  return (
    <section className="own-live" aria-label="Telarchy right now">
      {figures.map(([label, n]) => (
        <div key={label} className="own-live-fig">
          {n === null ? (
            <Ghost w="3.2rem" h="1.6rem" />
          ) : (
            <span className="own-live-n">{n.toLocaleString('en-US')}</span>
          )}
          <span className="own-live-label own-caption">{label}</span>
        </div>
      ))}
      {stats === null ? <LoadingStatus /> : null}
    </section>
  );
}

/** The floor the product moment shows: Telarchy's own. */
const SHOW_FLOOR = 'telarchy';
const SHOW_ROWS = 6;

/**
 * The product, zoomed on one moment: the proposals column of Telarchy's own
 * floor, live. The pending proposals in the floor's order (`pendingBallot`,
 * the same function the floor sorts with), at most six, each the title, the
 * impact figure in the direction colour (the primary horizon's delta, the
 * one the floor opens on, formatted as the floor formats it), the credits
 * behind it, the proposer. The bottom fades to the page so it reads as a
 * crop, and the whole panel is one link to the floor. Ghosts while loading;
 * nothing rendered if the request fails or the floor has no ballot.
 */
function ProposalsShot() {
  const [ws, setWs] = useState<PublicWorkspace | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api
      .getMarketplaceWorkspace(SHOW_FLOOR)
      .then(w => {
        if (live) setWs(w);
      })
      .catch(() => {
        if (live) setWs(null);
      });
    return () => {
      live = false;
    };
  }, []);
  const label = "Proposals on Telarchy's own floor, live";
  if (ws === undefined) {
    return (
      <Link to={`/${SHOW_FLOOR}`} className="own-shot" aria-label={label}>
        <span className="own-shot-head own-caption">Proposals</span>
        <GhostRows n={SHOW_ROWS} />
        <span className="own-shot-fade" aria-hidden="true" />
        <LoadingStatus />
      </Link>
    );
  }
  if (ws === null || !ws.proposals) return null;
  const hero = primaryHorizonOf(buildHorizonViews(ws));
  const unit = hero?.unit ?? '';
  const impactOf = (p: PublicProposal) => (hero ? deltaAt(p, hero.targetDate, hero.metricId) : null);
  const rows = pendingBallot(ws.proposals, impactOf).slice(0, SHOW_ROWS);
  return (
    <Link to={`/${SHOW_FLOOR}`} className="own-shot" aria-label={label}>
      <span className="own-shot-head own-caption">
        <span>Proposals</span>
        <span>{hero ? `impact by ${hero.label}` : 'impact'}</span>
      </span>
      <span className="own-shot-rows">
        {rows.map(p => {
          const delta = impactOf(p);
          const { rest } = splitAsk(p.title);
          return (
            <span key={p.id} className="own-shot-row">
              <span className="own-shot-main">
                {/* The number leads, as on the floor: it is how a person names a proposal. */}
                {p.number ? <span className="own-shot-num">#{p.number}</span> : null}
                <span className="own-shot-title">{rest}</span>
                {p.proposedByName ? <span className="own-shot-by">by {p.proposedByName}</span> : null}
              </span>
              <span className="own-shot-impact">
                {delta === null ? (
                  <span className="pubws-ballot-delta pubws-ballot-delta--open">open</span>
                ) : delta === 0 ? (
                  <span className="pubws-ballot-delta pubws-ballot-delta--open">±{unit}0</span>
                ) : (
                  <span className={`pubws-ballot-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
                    {fmtDelta(delta, unit)}
                  </span>
                )}
                <span className="own-shot-pool">{Math.round(poolOf(p)).toLocaleString()}</span>
              </span>
            </span>
          );
        })}
      </span>
      <span className="own-shot-fade" aria-hidden="true" />
    </Link>
  );
}

/**
 * /owners as a board (docs/audience-pages.md, "/owners is laid out as a
 * board"; owner ask 2026-09-04, redrawn 2026-09-05: the picture a visitor
 * looks at is the product, zoomed on one moment). The hero with its catch
 * line; the live strip; the product moment beside the section that explains
 * it; the meeting-and-floor pair as two cells of one row; one drawing at
 * full width; "What you keep" beside the FAQ; one closing row. The words
 * are the doc's words, unchanged; only the shape differs.
 */
function BoardPage({ page, route }: { page: PageData; route: string }) {
  const { lead, sections: all } = sections(page.blocks);
  const leadText = lead.find(b => b.kind === 'p') as Para | undefined;
  const catchLine = page.blocks.find(b => b.kind === 'catch') as { text: string } | undefined;
  const live = lead.find(b => b.kind === 'live') as { name: string } | undefined;
  const show = all.find(s => s.blocks.some(b => b.kind === 'show'));
  const pair = all.find(s => s.blocks.some(b => b.kind === 'table'));
  const viz = all.find(s => s.blocks.some(b => b.kind === 'viz'));
  const keep = all.find(s => s.blocks.some(b => b.kind === 'ul'));
  const faq = all.find(s => s.blocks.some(b => b.kind === 'faq'));
  const [primary, ...secondary] = page.cta;
  const table = pair?.blocks.find(b => b.kind === 'table') as
    | { head: string[]; rows: string[][]; leads?: (string | null)[][] }
    | undefined;
  const ul = keep?.blocks.find(b => b.kind === 'ul') as { items: string[]; leads?: (string | null)[] } | undefined;
  const ol = show?.blocks.find(b => b.kind === 'ol') as { items: string[] } | undefined;
  const showP = firstPara(show);
  const vizP = firstPara(viz);
  const vizName = (viz?.blocks.find(b => b.kind === 'viz') as { name: string } | undefined)?.name;
  const restOf = (cell: string, leadOf: string | null | undefined) =>
    leadOf && cell.startsWith(leadOf) ? cell.slice(leadOf.length).trim() : cell;
  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main pubws-aud own">
        <div className="mkt-glow" aria-hidden="true" />
        <header className="own-hero">
          <h1 className="mkt-thesis own-h1">{page.h1}</h1>
          {leadText ? <p className="mkt-lead">{leadText.text}</p> : null}
          {primary ? (
            <p className="own-hero-cta">
              <ActionLink action={primary} className="mkt-season-cta own-pill" />
              {secondary.map(c => (
                <QuietLink key={c.href} action={c} />
              ))}
            </p>
          ) : null}
          {catchLine ? <p className="own-catch own-caption">{catchLine.text}</p> : null}
        </header>

        {live?.name === 'marketplace-stats' ? <LiveStrip /> : null}

        {show ? (
          <section className="own-show">
            <div className="own-show-copy">
              <h2 className="own-label">{show.heading}</h2>
              {showP?.lead ? <p className="own-cell-title">{showP.lead}</p> : null}
              {showP ? <p className="own-cell-rest">{showP.text}</p> : null}
              {ol ? (
                <ol className="own-steps">
                  {ol.items.map((item, i) => (
                    <li key={item} className="own-step">
                      <span className="own-step-n">{i + 1}</span>
                      <p>{item}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <ProposalsShot />
          </section>
        ) : null}

        {pair && table ? (
          <section className="own-pair-section">
            <h2 className="own-label">{pair.heading}</h2>
            <div className="own-pair">
              {table.head.map((h, i) => {
                const cell = table.rows[0]?.[i] ?? '';
                const cellLead = table.leads?.[0]?.[i] ?? null;
                return (
                  <article key={h} className="own-pair-cell">
                    <h3 className="own-label">{h}</h3>
                    {cellLead ? <p className="own-cell-title">{cellLead}</p> : null}
                    <p className="own-cell-rest">{restOf(cell, cellLead)}</p>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {viz && vizName ? (
          <section className="own-viz">
            <h2 className="own-label">{viz.heading}</h2>
            {vizP?.lead ? <p className="own-cell-title">{vizP.lead}</p> : null}
            {vizP?.text ? <p className="own-cell-rest">{vizP.text}</p> : null}
            <AudienceViz name={vizName} />
          </section>
        ) : null}

        <section className="own-two">
          {keep && ul ? (
            <div className="own-col">
              <h2 className="own-label">{keep.heading}</h2>
              <ul className="own-keeps">
                {ul.items.map((item, i) => {
                  const itemLead = ul.leads?.[i] ?? null;
                  return (
                    <li key={item} className="own-keep">
                      {itemLead ? <span className="own-keep-lead">{itemLead}</span> : null}
                      {itemLead ? ' ' : null}
                      <span className="own-keep-text">{restOf(item, itemLead)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {faq ? (
            <div className="own-col">
              <h2 className="own-label">{faq.heading}</h2>
              <dl className="own-faq">
                {(faq.blocks.find(b => b.kind === 'faq') as { items: { q: string; a: string }[] }).items.map(
                  ({ q, a }) => (
                    <div key={q} className="own-qa">
                      <dt className="own-q">{q}</dt>
                      <dd className="own-a">{a}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          ) : null}
        </section>

        {page.cta.length > 0 ? (
          <div className="own-close">
            <p className="own-close-row">
              {page.cta.map((c, i) =>
                i === 0 ? (
                  <ActionLink key={c.href} action={c} className="mkt-season-cta own-pill" />
                ) : (
                  <QuietLink key={c.href} action={c} />
                ),
              )}
            </p>
            {catchLine ? <p className="own-catch own-caption">{catchLine.text}</p> : null}
          </div>
        ) : null}
        <Foot route={route} />
      </main>
    </div>
  );
}

export function AudiencePage({ route }: { route: string }) {
  const page: PageData | undefined = AUDIENCE_PAGES.find(p => p.route === route);
  if (!page) return null;
  if (BOARD_ROUTES.has(route)) return <BoardPage page={page} route={route} />;
  const isCompare = route.startsWith('/compare/');
  const primary = page.cta[0];
  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main pubws-aud">
        <header className="pubws-hero pubws-hero--left">
          <p className="pubws-h2">{isCompare ? 'Side by side' : page.audience}</p>
          <h1 className="pubws-name">{page.h1}</h1>
        </header>
        {/* The action belongs where the reader decides, not only after the
            whole argument. A cold visitor from a search landed on 1,100 words
            with the only button at 90% of the page (design audit,
            2026-08-30), which asks them to finish reading before they may
            act. The same primary action repeats at the foot for anyone who
            did read to the end. */}
        {primary ? (
          <p className="pubws-aud-lead-cta">
            <ActionLink action={primary} className="pubws-cta pubws-cta--small" />
          </p>
        ) : null}

        <section className="pubws-section pubws-story">
          {page.blocks.map((b, i) => (
            <Block key={`${b.kind}-${i}`} block={b} />
          ))}
        </section>
        {page.cta.length > 0 ? (
          <p className="pubws-aud-cta">
            {page.cta.map((c, i) => (
              <ActionLink key={c.href} action={c} className={i === 0 ? 'pubws-cta' : 'pubws-aud-link'} />
            ))}
          </p>
        ) : null}
        <Foot route={route} />
      </main>
    </div>
  );
}

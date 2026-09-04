import { Link } from 'react-router-dom';
import { AudienceViz } from '../components/AudienceViz';
import { PageTopBar } from '../components/PageTopBar';
import { AUDIENCE_PAGES, type AudienceBlock, type AudiencePage as PageData } from '../content/audiencePages.generated';
import { withBase } from '../lib/base-path';

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

/** The page's blocks, cut at every H2: what the board lays out cell by cell. */
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

/**
 * /owners as a board (docs/audience-pages.md, "/owners is laid out as a
 * board"; owner ask 2026-09-04, from the floor canvas). The H1 is the hero
 * with the lead and ONE pill under it; the sections that carry a drawing
 * are three cells of one hairline-ruled row; "Setting up" and the FAQ sit
 * side by side as two hairline lists; the CTA line is one closing row. The
 * words are the doc's words, unchanged; only the shape differs.
 */
function BoardPage({ page, route }: { page: PageData; route: string }) {
  const { lead, sections: all } = sections(page.blocks);
  const leadText = lead.find(b => b.kind === 'p') as { text: string } | undefined;
  const cells = all.filter(s => s.blocks.some(b => b.kind === 'viz'));
  const steps = all.find(s => s.blocks.some(b => b.kind === 'ol'));
  const faq = all.find(s => s.blocks.some(b => b.kind === 'faq'));
  const primary = page.cta[0];
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
            </p>
          ) : null}
        </header>

        <section className="own-board">
          {cells.map(cell => {
            const p = cell.blocks.find(b => b.kind === 'p') as { lead?: string; text: string } | undefined;
            const viz = cell.blocks.find(b => b.kind === 'viz') as { name: string };
            const rest = cell.blocks.filter(b => b.kind === 'p' && b !== p) as { lead?: string; text: string }[];
            return (
              <article key={cell.heading} className="own-cell">
                <h2 className="own-cell-label">{cell.heading}</h2>
                {p?.lead ? <p className="own-cell-title">{p.lead}</p> : null}
                <AudienceViz name={viz.name} />
                {p ? (
                  <p className="own-cell-rest">
                    {p.text}
                    {rest.map(r => ` ${r.lead ? `${r.lead} ` : ''}${r.text}`)}
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="own-two">
          {steps ? (
            <div className="own-col">
              <h2 className="own-label">{steps.heading}</h2>
              <ol className="own-steps">
                {(steps.blocks.find(b => b.kind === 'ol') as { items: string[] }).items.map((item, i) => (
                  <li key={item} className="own-step">
                    <span className="own-step-n">{i + 1}</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ol>
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
          <p className="own-close">
            {page.cta.map((c, i) =>
              i === 0 ? (
                <ActionLink key={c.href} action={c} className="mkt-season-cta own-pill" />
              ) : isApiLink(c.href) ? (
                <a key={c.href} href={withBase(c.href)} className="own-quiet">
                  {c.label} {arrow}
                </a>
              ) : (
                <Link key={c.href} to={c.href} className="own-quiet">
                  {c.label} {arrow}
                </Link>
              ),
            )}
          </p>
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

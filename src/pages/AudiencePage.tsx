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

export function AudiencePage({ route }: { route: string }) {
  const page: PageData | undefined = AUDIENCE_PAGES.find(p => p.route === route);
  if (!page) return null;
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
        <Siblings current={route} />
        <footer className="pubws-foot">
          Telarchy is built by Viktor Cihal. Questions: <a href="mailto:support@telarchy.com">support@telarchy.com</a>.
          <br />
          <Link to="/">Open the app</Link> · <a href={withBase('/api/help')}>Read the API catalog</a> ·{' '}
          <Link to="/legal/season-0">Read the Season 0 rules</Link> · <Link to="/about">About</Link>
        </footer>
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { api, type GuideCategory, type GuideSection } from '../lib/api';
import { withBase } from '../lib/base-path';

/**
 * telarchy.com/guides: the human door to the guides the API serves at
 * /api/guides.
 *
 * The guides existed as content (docs/guides/*.md, served as markdown) and
 * were advertised in the sitemap, robots.txt, llms.txt and the site's own
 * footer copy, but no route rendered them: /guides fell through to the
 * workspace slug route and a visitor was told "There is no market at this
 * address" (found by a crawl of the live site, 2026-08-30). This page is the
 * missing surface, in the same .pubws poster language as /about: an index
 * grouped by category, and one guide per route rendered from the same
 * markdown an agent reads.
 */

function useGuideIndex() {
  const [sections, setSections] = useState<GuideSection[] | null>(null);
  const [categories, setCategories] = useState<GuideCategory[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .getGuides()
      .then(s => {
        if (alive) setSections(s);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    // The index groups by category id; the titles a reader should see live
    // behind /api/guides/_categories. A failure here is not fatal: the id is
    // a poor heading but still a heading.
    api
      .getGuideCategories()
      .then(c => {
        if (alive) setCategories(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { sections, categories, failed };
}

function Foot() {
  return (
    <footer className="pubws-foot">
      <Link to="/">The live markets</Link> · <Link to="/about">About</Link> · <Link to="/contact">Contact</Link> ·{' '}
      <Link to="/terms">Terms</Link>
    </footer>
  );
}

/** One guide, rendered from the markdown the API serves. */
function OneGuide({ section }: { section: string }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { sections } = useGuideIndex();
  const meta = sections?.find(s => s.id === section);

  useEffect(() => {
    let alive = true;
    setBody(null);
    setFailed(false);
    api
      .getGuide(section)
      .then(t => {
        if (alive) setBody(t);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [section]);

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        <p className="pubws-h2">
          <Link to="/guides">All guides</Link>
        </p>
        {failed ? (
          <>
            <h1 className="pubws-name">That guide is not here</h1>
            <p className="pubws-pitch">
              The address does not match a guide. <Link to="/guides">The index</Link> lists every one of them.
            </p>
          </>
        ) : (
          <div className="pubws-doc" style={{ opacity: body ? 1 : 0.5, transition: 'opacity 0.1s' }}>
            {body ? <ReactMarkdown>{body}</ReactMarkdown> : <p>{meta?.title ?? 'Loading the guide'}</p>}
          </div>
        )}
        <Foot />
      </main>
    </div>
  );
}

/** The index: every guide, in the order the API returns them. */
function GuideIndex() {
  const { sections, categories, failed } = useGuideIndex();
  // The API returns sections already ordered by category then order, so the
  // grouping below preserves that order rather than imposing its own.
  const byCategory: Array<{ category: string; items: GuideSection[] }> = [];
  for (const s of sections ?? []) {
    const last = byCategory[byCategory.length - 1];
    if (last && last.category === s.category) last.items.push(s);
    else byCategory.push({ category: s.category, items: [s] });
  }

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        <header className="pubws-hero pubws-hero--left">
          <h1 className="pubws-name">Guides</h1>
          <p className="pubws-pitch">
            How the markets, the credits and the proposals work, for people and for the agents they build.
          </p>
        </header>

        {failed ? (
          <section className="pubws-section pubws-story">
            <p>
              The guides did not load. They are also served as plain markdown at{' '}
              <a href={withBase('/api/guides')}>/api/guides</a>.
            </p>
          </section>
        ) : (
          byCategory.map(group => (
            <section className="pubws-section" key={group.category}>
              <h2 className="pubws-h2">{categories.find(c => c.id === group.category)?.title ?? group.category}</h2>
              <ul className="pubws-contact">
                {group.items.map(s => (
                  <li key={s.id}>
                    <Link to={`/guides/${s.id}`} className="pubws-guide-link">
                      {s.title}
                    </Link>
                    <span className="pubws-guide-desc">{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <section className="pubws-section pubws-story">
          <p>
            Building a participant? Every endpoint is documented at <a href={withBase('/api/help')}>/api/help</a>, no
            account needed to read it.
          </p>
        </section>
        <Foot />
      </main>
    </div>
  );
}

export function GuidesPage() {
  const { section } = useParams<{ section?: string }>();
  return section ? <OneGuide section={section} /> : <GuideIndex />;
}

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, type DataRoomBlock, type DataRoomFeed } from '../lib/api';
import { withBase } from '../lib/base-path';
import { TopBar } from './TradePage';

/**
 * telarchy.com/data-room: Telarchy's own books (owner ask 2026-08-20).
 *
 * The page renders `GET /api/data-room` and nothing else. Prose and figures
 * arrive together in that one response, so a visitor can fetch the same URL and
 * check the page against it; if the two ever disagree, the response is right.
 * Spec: docs/data-room.md.
 *
 * Written in the floor's language (`.pubws` + `.dr-*`): one document column,
 * tiny uppercase section labels, hairlines instead of cards, and hand-rolled
 * SVG for the charts. See docs/ui-conventions.md.
 */

function n(v: number): string {
  return v.toLocaleString('en-US');
}

/** "Aug 19", so a run of days reads as dates rather than as ISO strings. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A figure and what it counts. The page's only large numerals. */
function Figure({ value, label, note }: { value: number | string | null; label: string; note?: string }) {
  return (
    <div className="dr-fig">
      {/* null is refused, not zero: a term that could not be computed says so
          rather than reading as a measurement of nothing. */}
      <span className="dr-fig-n">
        {value === null ? 'not published' : typeof value === 'number' ? n(value) : value}
      </span>
      <span className="dr-fig-l">{label}</span>
      {note && <span className="dr-fig-note">{note}</span>}
    </div>
  );
}

function Figures({ children }: { children: React.ReactNode }) {
  return <div className="dr-figures">{children}</div>;
}

/** One hairline list, with an amber rule behind each count scaled to the
 *  largest row, which answers "which of these is big" without a chart. */
function Rows({ rows }: { rows: Array<{ key: string; left: React.ReactNode; value: number | string }> }) {
  const max = Math.max(1, ...rows.map(r => (typeof r.value === 'number' ? r.value : 0)));
  return (
    <ul className="dr-list">
      {rows.map(r => (
        <li key={r.key} className="dr-row">
          {typeof r.value === 'number' && (
            <span className="dr-bar" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden="true" />
          )}
          <span className="dr-left">{r.left}</span>
          <span className="dr-value">{typeof r.value === 'number' ? n(r.value) : r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A column per day. Days with nothing keep their slot, because a gap in a
 * count of days is information: a week where nothing shipped should look
 * empty, not be quietly compressed away.
 */
function DayBars({ points, label }: { points: Array<{ day: string; value: number }>; label: string }) {
  if (!points.length) return <p className="dr-empty">Nothing recorded yet.</p>;
  const max = Math.max(1, ...points.map(p => p.value));
  const W = 760;
  const H = 130;
  const gap = points.length > 90 ? 0.5 : 2;
  const w = Math.max(1, (W - gap * (points.length - 1)) / points.length);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="dr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="dr-chart-svg">
        {points.map((p, i) => {
          const h = p.value === 0 ? 0 : Math.max(1.5, (p.value / max) * (H - 10));
          return (
            <rect key={p.day} x={i * (w + gap)} y={H - h} width={w} height={h} className="dr-chart-bar">
              <title>{`${dayLabel(p.day)}: ${n(p.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="dr-chart-cap">
        <span>{dayLabel(first.day)}</span>
        <span className="dr-chart-max">peak {n(max)}</span>
        <span>{dayLabel(last.day)}</span>
      </figcaption>
    </figure>
  );
}

/** The metric's readings over time, as one step line. The market's own chart
 *  lives on the floor; this is the number the market settles against. */
function Readings({ points, label }: { points: Array<{ at: string; value: number }>; label: string }) {
  if (points.length < 2) return null;
  const W = 760;
  const H = 120;
  const values = points.map(p => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 8 - ((v - lo) / span) * (H - 16);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${W},${H} L0,${H} Z`;
  return (
    <figure className="dr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="dr-chart-svg">
        <path d={area} className="dr-line-fill" />
        <path d={d} className="dr-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="dr-chart-cap">
        <span>{dayLabel(points[0].at)}</span>
        <span className="dr-chart-max">{n(Math.round(hi))} high</span>
        <span>{dayLabel(points[points.length - 1].at)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * The named changes, newest first. Only the most recent are on screen at
 * first: the log is the longest thing on the page by an order of magnitude,
 * and a reader who wants all of it says so (or reads the feed, which carries
 * every entry either way).
 */
function ChangeLog({ changes }: { changes: Array<{ date: string; subject: string }> }) {
  const [all, setAll] = useState(false);
  const FIRST = 40;
  const shown = all ? changes : changes.slice(0, FIRST);
  return (
    <>
      <ul className="dr-log">
        {shown.map((c, i) => (
          <li key={`${c.date}-${i}`} className="dr-log-row">
            <span className="dr-log-day">{dayLabel(c.date)}</span>
            <span className="dr-log-what">{c.subject}</span>
          </li>
        ))}
      </ul>
      {changes.length > FIRST && (
        <button type="button" className="dr-more" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${n(changes.length)} named changes`}
        </button>
      )}
    </>
  );
}

function Block({ name, feed }: { name: DataRoomBlock; feed: DataRoomFeed }) {
  const e = feed.evidence;

  if (name === 'pulse') {
    return (
      <>
        <Figures>
          <Figure value={e.pulse.weeklyActiveVerifiedTraders} label="weekly active verified traders" />
          <Figure value={e.pulse.tradesThisWeek} label="trades this week" />
          <Figure value={e.pulse.openMarkets} label="open markets" />
          <Figure value={e.pulse.participants} label="participants" />
        </Figures>
        <p className="dr-note">
          The pulse resolves against <code>{e.pulse.source}</code>, which anyone can read.
        </p>
      </>
    );
  }

  if (name === 'market') {
    const floor = e.market;
    if (!floor?.market) return <p className="dr-empty">No open market on this floor right now.</p>;
    const m = floor.market;
    return (
      <>
        <div className="dr-market">
          <span className="dr-market-cap">{m.metricName}</span>
          <span className="dr-market-price">
            {m.consensus === null ? 'not published' : n(Math.round(m.consensus * 100) / 100)}
          </span>
          <span className="dr-market-sub">
            the market&apos;s call · now reading{' '}
            {m.currentValue === null ? 'not published' : n(Math.round(m.currentValue))}
            {' · '}settles {dayLabel(m.resolvesOn)}
          </span>
        </div>
        <Readings points={m.history} label={`${m.metricName} over time`} />
        <p className="dr-note">Every reading of the metric the market settles against, oldest first.</p>
        <Rows
          rows={[
            { key: 'range', left: 'Range the market prices inside', value: `${n(m.rangeMin)} to ${n(m.rangeMax)}` },
            { key: 'liq', left: 'Credits in the pool', value: `${n(Math.round(m.pool))} cr` },
            { key: 'vol', left: 'Traded volume, lifetime', value: `${n(Math.round(m.tradedVolume))} cr` },
          ]}
        />
        <p className="dr-note">
          <Link to={`/${floor.slug ?? 'telarchy'}`}>Trade it on the floor</Link>, or read the raw payload at{' '}
          <code>/api/marketplace/{floor.slug ?? 'telarchy'}</code>.
        </p>
      </>
    );
  }

  if (name === 'traction') {
    const t = e.traction;
    return (
      <>
        <Figures>
          <Figure value={t.participants} label="participants" note="humans and automated, together" />
          <Figure value={t.verifiedParticipants} label="verified profiles" />
          <Figure value={t.trades} label="trades, lifetime" />
          <Figure value={t.creditsTraded} label="credits traded" />
        </Figures>
        <Rows
          rows={[
            { key: 'accounts', left: 'Accounts with an email login', value: t.accounts },
            { key: 'floors', left: 'Public floors', value: t.publicFloors },
            { key: 'open', left: 'Markets open now', value: t.openMarkets },
            { key: 'settled', left: 'Markets already settled', value: t.settledMarkets },
          ]}
        />
      </>
    );
  }

  if (name === 'contracts') {
    const c = e.contracts;
    return (
      <>
        <Rows
          rows={[
            { key: 'proposed', left: 'Proposed', value: c.proposed },
            { key: 'approved', left: 'Approved', value: c.approved },
            { key: 'declined', left: 'Declined, with a written reason', value: c.declined },
            { key: 'pending', left: 'Waiting on a decision', value: c.pending },
            { key: 'withdrawn', left: 'Withdrawn by the proposer', value: c.withdrawn },
          ]}
        />
        <Figures>
          <Figure value={`$${n(c.approvedUsd)}`} label="committed by approving" />
        </Figures>
      </>
    );
  }

  if (name === 'traffic') {
    const t = e.traffic;
    return (
      <>
        <Figures>
          <Figure value={t.visits24h} label="visits, last 24h" />
          <Figure value={t.uniques24h} label="distinct visitors, 24h" />
          <Figure value={t.visits7d} label="visits, last 7 days" />
          <Figure value={t.totalVisits} label="visits, all kept history" />
        </Figures>
        <DayBars points={t.byDay.map(d => ({ day: d.day, value: d.visits }))} label="Visits per day" />
        <p className="dr-note">
          Visits per day, humans only.{' '}
          {t.keptSince ? <>Kept from {dayLabel(t.keptSince)}, the day the rollup started.</> : <>Nothing kept yet.</>}
        </p>
      </>
    );
  }

  if (name === 'shipping') {
    const s = e.shipping;
    return (
      <>
        <Figures>
          <Figure value={s.total} label="changes shipped" />
          <Figure value={s.days.length} label="days with a change" />
          <Figure value={dayLabel(s.builtAt)} label="log generated" />
        </Figures>
        <DayBars points={s.days.map(d => ({ day: d.date, value: d.changes }))} label="Changes shipped per day" />
        <ChangeLog changes={s.changes} />
      </>
    );
  }

  return null;
}

export function DataRoomPage() {
  const { user, loading: authLoading } = useAuth();
  const [feed, setFeed] = useState<DataRoomFeed | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState('');

  useEffect(() => {
    api
      .getDataRoom()
      .then(setFeed)
      .catch(err => {
        console.error('data room failed to load', err);
        setError('The data room could not be loaded. Try again in a moment.');
      });
  }, []);

  const sections = useMemo(() => feed?.doc.sections ?? [], [feed]);

  // Which section the reader is in, so the index says where they are. Cheap
  // scroll math rather than an observer: the page is one column of a dozen
  // anchors and this stays correct while the content grows.
  useEffect(() => {
    if (!sections.length) return;
    const onScroll = () => {
      let current = sections[0].id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections]);

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <div className="dr">
        <header className="dr-head">
          <h1 className="dr-title">Data room</h1>
          <p className="dr-lead">
            Telarchy&apos;s own books: what this is for, what it has done, who showed up, what shipped, and what is
            planned. Every figure is read live from the database that serves this site.
          </p>
          {feed && (
            <p className="dr-stamp">
              Words updated {dayLabel(feed.doc.updatedAt)} · figures generated{' '}
              {new Date(feed.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              <a href={withBase('/api/data-room')} className="dr-stamp-link">
                the same page as JSON
              </a>
            </p>
          )}
        </header>

        {error && <p className="dr-err">{error}</p>}
        {!feed && !error && <p className="dr-empty">Reading the books...</p>}

        {feed && (
          <>
            <nav className="dr-index" aria-label="Sections">
              {sections.map(s => (
                <a key={s.id} href={`#${s.id}`} className={`dr-index-link${active === s.id ? ' is-active' : ''}`}>
                  {s.title}
                </a>
              ))}
            </nav>

            {sections.map(s => (
              <section key={s.id} id={s.id} className="dr-section">
                <h2 className="pubws-h2">{s.title}</h2>
                <div className="dr-prose">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p>{children}</p>,
                      code: ({ children }) => <code className="dr-code">{children}</code>,
                      a: ({ href, children }) => <a href={href?.startsWith('/') ? withBase(href) : href}>{children}</a>,
                    }}
                  >
                    {s.markdown}
                  </ReactMarkdown>
                </div>
                {s.blocks.map(b => (
                  <div key={b} className="dr-block">
                    <Block name={b} feed={feed} />
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

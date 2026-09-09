import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { TimeChart } from '../components/TimeChart';
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
 * A distribution: one bar per row, in the order the feed sorted them, with the
 * line that decides the count drawn across it.
 *
 * The block this belongs to exists because a count ("four are between 40 and
 * 99") throws away the shape, so the drawing has to keep every row: no
 * grouping, no top ten, and a zero keeps its slot. What a tall tail would
 * otherwise cost is the near-threshold detail, which is the part a forecaster
 * is actually pricing, so the axis is capped and every value past it is
 * printed underneath in full. Nothing is clipped in silence.
 */
function Distribution({
  id,
  values,
  threshold,
  cap,
  unit,
  signed,
  caption,
  label,
}: {
  id: string;
  values: number[];
  threshold: number;
  cap: number;
  unit: string;
  signed?: boolean;
  caption: string;
  label: string;
}) {
  if (!values.length) return <p className="dr-empty">Nothing recorded yet.</p>;
  const W = 760;
  const H = 190;
  const PAD = 16;
  const hasNeg = values.some(v => v < 0);
  const top = Math.max(threshold * 1.25, Math.min(cap, Math.max(...values)));
  const bottom = hasNeg ? Math.min(-threshold / 2, Math.max(-cap, Math.min(...values))) : 0;
  const span = top - bottom || 1;
  const plotH = H - PAD * 2;
  const y = (v: number) => PAD + ((top - Math.max(bottom, Math.min(top, v))) / span) * plotH;
  const zeroY = y(0);
  const gap = values.length > 60 ? 1 : 3;
  const w = Math.max(1, (W - gap * (values.length - 1)) / values.length);
  const past = values.filter(v => Math.abs(v) > cap);
  return (
    <figure className={`dr-dist${signed ? ' dr-dist--signed' : ''}`} data-dist={id}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="dr-dist-svg">
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} className="dr-dist-zero" />
        {values.map((v, i) => {
          const x = i * (w + gap);
          const yv = y(v);
          const h = v === 0 ? 1.5 : Math.max(1.5, Math.abs(yv - zeroY));
          const yTop = v < 0 ? zeroY : Math.min(yv, zeroY - 1.5);
          return (
            <rect
              // Position is the identity here: the rows are anonymous numbers.
              key={`${id}-${i}`}
              x={x}
              y={yTop}
              width={w}
              height={h}
              className={`dr-dist-bar${v < 0 ? ' is-down' : ' is-up'}`}
            >
              <title>{`${n(Math.round(v))} ${unit}`}</title>
            </rect>
          );
        })}
        <line x1={0} y1={y(threshold)} x2={W} y2={y(threshold)} className="dr-dist-threshold" />
      </svg>
      <figcaption className="dr-dist-cap">
        <span>{caption}</span>
        <span className="dr-dist-line">{`${n(threshold)} ${unit} counts`}</span>
      </figcaption>
      {past.length > 0 && (
        <p className="dr-dist-over">
          Past the axis: {past.map(v => n(Math.round(v))).join(', ')} {unit}
        </p>
      )}
    </figure>
  );
}

/**
 * One metric's eight weekly readings: the line, then the numbers under it.
 *
 * The numbers are printed because the block replaced a summary ("biggest week
 * +3") and a shape is not a base rate. A week with no reading breaks the line
 * rather than being interpolated across: a week nobody measured and a week
 * nothing happened are different facts, and a smooth line through the gap
 * would state the wrong one.
 */
function WeeklyRate({
  name,
  readings,
  weeks,
  daily,
  events,
}: {
  name: string;
  readings: Array<number | null>;
  weeks: string[];
  daily: Array<{ at: string; value: number }>;
  events: Array<{ at: string; kind: string; label: string }>;
}) {
  const W = 700;
  const H = 40;
  const known = readings.filter((v): v is number => v !== null);
  const max = Math.max(1, ...known);
  const min = Math.min(0, ...known);
  const span = max - min || 1;
  const step = readings.length > 1 ? W / (readings.length - 1) : 0;
  const y = (v: number) => 4 + ((max - v) / span) * (H - 8);

  // One polyline per unbroken run of readings.
  const runs: string[][] = [];
  let run: string[] = [];
  readings.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push(`${i * step},${y(v)}`);
  });
  if (run.length) runs.push(run);

  return (
    <section className="dr-rate">
      <h4 className="dr-rate-name">{name}</h4>
      {/* The line is every DAILY reading, annotated with the dated things the
          owner did; the eight weekly numbers stay printed under it, because a
          shape is not a base rate (docs/data-room.md). */}
      <TimeChart
        series={[{ key: name, label: name, points: daily, kind: 'area' }]}
        events={events}
        label={`${name}, every daily reading`}
        height={170}
      />
      <div className="dr-rate-vals">
        {readings.map((v, i) => (
          <span key={weeks[i] ?? i} className={v === null ? 'is-unread' : undefined}>
            {v === null ? '—' : n(Math.round(v))}
          </span>
        ))}
      </div>
      <div className="dr-rate-cap">
        <span>{dayLabel(weeks[0])}</span>
        <span>the reading at the end of each of the last eight weeks</span>
        <span>{dayLabel(weeks[weeks.length - 1])}</span>
      </div>
    </section>
  );
}

function LapseStrip({ from, lapses }: { from: string; lapses: string[] }) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  return (
    <div className="dr-lapse">
      {days.map(day => {
        const on = lapses.filter(l => l === day).length;
        return (
          <div key={day} className="dr-lapse-day">
            <span className="dr-lapse-dots">
              {Array.from({ length: on }, (_, i) => (
                <span key={`${day}-${i}`} className="dr-lapse-dot" />
              ))}
            </span>
            <span className="dr-lapse-label">{dayLabel(day)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A dated hairline list: the day on the left, the row, and what it is. */
function WhenList({
  id,
  rows,
  empty,
}: {
  id: string;
  rows: Array<{ key: string; when: string; main: React.ReactNode; right?: React.ReactNode }>;
  empty: string;
}) {
  if (!rows.length) return <p className="dr-empty">{empty}</p>;
  return (
    <ul className="dr-when" data-when={id}>
      {rows.map(r => (
        <li key={r.key} className="dr-when-row">
          <span className="dr-when-day">{r.when}</span>
          <span className="dr-when-main">{r.main}</span>
          {r.right !== undefined && <span className="dr-when-right">{r.right}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The outreach list: one square per person, shaded by how far they have got.
 *
 * Squares rather than a count per stage, for the same reason the window
 * draws bars: the shape of a list of thirty is a thing you see, and the count
 * is the shape with the tail thrown away. Nobody is named; a square is a
 * stage (docs/data-room.md, "What is scheduled").
 */
const STAGE_ORDER = ['no', 'draft', 'ready', 'sent', 'replied', 'call', 'workspace', 'activated'];

function StageGrid({ stages }: { stages: string[] }) {
  if (!stages.length) return <p className="dr-empty">Nobody on the list yet.</p>;
  return (
    <div className="dr-stages">
      {stages.map((stage, i) => (
        <span
          key={`${stage}-${i}`}
          className="dr-stage-cell"
          data-stage={stage}
          style={{ opacity: 0.2 + (Math.max(0, STAGE_ORDER.indexOf(stage)) / (STAGE_ORDER.length - 1)) * 0.8 }}
          title={stage}
        />
      ))}
    </div>
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

  if (name === 'funnel') {
    const f = e.funnel;
    const LABEL: Record<string, { left: string; note: string }> = {
      loads: {
        left: 'Page loads',
        note: f.loadsSince ? `counted from ${dayLabel(f.loadsSince)}` : 'from the visit rollup',
      },
      accounts: { left: 'Accounts', note: 'a person or an agent that signed up' },
      verified: { left: 'Verified', note: 'a public Manifold profile anyone can inspect' },
      weeklyActive: { left: 'Traded this week', note: '100+ credits in the trailing seven days' },
    };
    return (
      <>
        <ul className="dr-funnel">
          {f.steps.map(step => (
            <li key={step.id}>
              <span className="dr-funnel-n">{n(step.n)}</span>
              <span className="dr-funnel-t">
                {LABEL[step.id]?.left ?? step.id}
                <em>{LABEL[step.id]?.note}</em>
              </span>
              <span className="dr-funnel-s">
                {step.shareOfAbove === null ? '' : `${(step.shareOfAbove * 100).toFixed(1)}% of the step above`}
              </span>
            </li>
          ))}
        </ul>
        <p className="dr-note">
          Loads count what the visit rollup holds and accounts predate it, so the first percentage is arithmetic between
          two published numbers rather than a claim that those accounts came out of those loads.
        </p>
      </>
    );
  }

  if (name === 'window') {
    const w = e.window;
    return (
      <>
        <h3 className="dr-h3">Traded this week, one bar per verified participant</h3>
        <Distribution
          id="traders"
          values={w.traders.spend}
          threshold={w.traders.threshold}
          cap={500}
          unit="cr"
          caption={`${n(w.traders.spend.length)} verified participants, sorted`}
          label="Credits traded in the trailing seven days, one bar per verified participant"
        />
        <h3 className="dr-h3">When each counted week lapses, one dot per trader</h3>
        <LapseStrip from={w.at} lapses={w.traders.lapses} />
        <h3 className="dr-h3">Marked profit, one bar per participant</h3>
        <Distribution
          id="forecasters"
          values={w.forecasters.profit}
          threshold={w.forecasters.threshold}
          cap={600}
          unit="cr"
          signed
          caption="marked to market, house excluded"
          label="Marked profit per participant, sorted"
        />
        <h3 className="dr-h3">Undecided on an outside floor</h3>
        <WhenList
          id="owners"
          empty="Nothing waiting on a decision."
          rows={w.owners.pending.map((p, i) => ({
            key: `${p.slug ?? 'floor'}-${i}`,
            when: p.decideBy ? dayLabel(p.decideBy) : 'no deadline',
            main: p.title,
            right: p.slug,
          }))}
        />
        <h3 className="dr-h3">On the revenue rail</h3>
        <WhenList
          id="revenue"
          empty="No payment on the rail in the last 30 days."
          rows={w.revenue.payments.map((p, i) => ({
            key: `pay-${i}`,
            when: dayLabel(p.at),
            main: `$${n(p.usd)}`,
            right: p.status,
          }))}
        />
      </>
    );
  }

  if (name === 'rates') {
    const r = e.rates;
    if (!r.metrics.length) return <p className="dr-empty">Nothing recorded yet.</p>;
    return (
      <div className="dr-rates">
        {r.metrics.map(m => (
          <WeeklyRate
            key={m.name}
            name={m.name}
            readings={m.readings}
            weeks={r.weeks}
            daily={m.daily ?? []}
            events={e.events ?? []}
          />
        ))}
      </div>
    );
  }

  if (name === 'events') {
    return (
      <WhenList
        id="events"
        empty="No events recorded yet."
        rows={[...(e.events ?? [])]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((event, i) => ({
            key: `${event.at}-${i}`,
            when: dayLabel(event.at),
            main: event.label,
            right: event.kind,
          }))}
      />
    );
  }

  if (name === 'calendar') {
    const c = e.calendar;
    return (
      <>
        <WhenList
          id="calendar"
          empty="Nothing scheduled."
          rows={c.dates.map((d, i) => ({
            key: `${d.at}-${i}`,
            when: dayLabel(d.at),
            main: d.label,
            right: d.kind,
          }))}
        />
        <h3 className="dr-h3">The outreach list, one square per person</h3>
        <StageGrid stages={c.outreach.stages} />
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
        {t.signupsByDay.length > 0 && (
          <>
            <h3 className="dr-h3">Signups, and the accounts they add up to</h3>
            <TimeChart
              series={[
                {
                  key: 'signups',
                  label: 'Signups that day',
                  points: t.signupsByDay.map(d => ({ at: d.day, value: d.signups })),
                  kind: 'bars',
                },
                {
                  key: 'cumulative',
                  label: 'Accounts, running total',
                  // Defined between its points: a quiet fortnight is not a
                  // hole in the total, it is a flat stretch of it.
                  connect: true,
                  points: t.signupsByDay.map((d, i) => ({
                    at: d.day,
                    value: t.signupsByDay.slice(0, i + 1).reduce((sum, x) => sum + x.signups, 0),
                  })),
                },
              ]}
              events={e.events ?? []}
              label="Signups per day and the running total of accounts"
              height={190}
              caption={
                <span>The running total starts at the first signup this window holds, not at zero accounts.</span>
              }
            />
          </>
        )}
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

  if (name === 'trading') {
    const t = e.trading;
    return (
      <>
        <h3 className="dr-h3">Credits traded, per day</h3>
        {/* A log axis, because one seeding day is three orders of magnitude
            above an ordinary one and a linear axis puts every ordinary day on
            the floor. The axis is labelled in powers and the caption says so. */}
        <TimeChart
          series={[
            {
              key: 'credits',
              label: 'Credits traded',
              points: t.byDay.map(d => ({ at: d.day, value: d.credits })),
              kind: 'area',
            },
          ]}
          events={e.events ?? []}
          label="Credits traded per day"
          height={180}
          scale="log"
          caption={
            <>
              <span>Buys and sells, absolute cost; a redemption is bookkeeping and is not counted.</span>
              <span>log axis</span>
            </>
          }
        />
        <h3 className="dr-h3">Trades placed, per day</h3>
        <TimeChart
          series={[
            {
              key: 'trades',
              label: 'Trades',
              points: t.byDay.map(d => ({ at: d.day, value: d.trades })),
              kind: 'bars',
            },
          ]}
          label="Trades placed per day"
          height={160}
          caption={<span>A day with no trading has no bar: nothing happened, which is not a measurement of none.</span>}
        />
        <h3 className="dr-h3">People trading, per day</h3>
        {/* Its own chart rather than a second line on the one above: ten
            people against a hundred trades on one axis draws the people as a
            flat line on the floor, which answers nothing. */}
        <TimeChart
          series={[
            { key: 'traders', label: 'people trading', points: t.byDay.map(d => ({ at: d.day, value: d.traders })) },
          ]}
          events={e.events ?? []}
          label="Distinct people trading per day"
          height={160}
          caption={<span>Distinct participants who placed at least one trade that day.</span>}
        />
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
        <h3 className="dr-h3">Visits, per day</h3>
        <TimeChart
          series={[
            {
              key: 'visits',
              label: 'Visits',
              points: t.byDay.map(d => ({ at: d.day, value: d.visits })),
              kind: 'area',
            },
          ]}
          events={e.events ?? []}
          label="Visits per day"
          height={180}
          caption={
            <span>
              Humans only.{' '}
              {t.keptSince ? (
                <>Kept from {dayLabel(t.keptSince)}, the day the rollup started.</>
              ) : (
                <>Nothing kept yet.</>
              )}
            </span>
          }
        />
        <h3 className="dr-h3">Distinct visitors, per day</h3>
        {/* Its own chart: thirty people against six hundred loads on one axis
            draws the people as a flat line, and the people are the number
            that matters. */}
        <TimeChart
          series={[
            { key: 'uniques', label: 'Distinct visitors', points: t.byDay.map(d => ({ at: d.day, value: d.uniques })) },
          ]}
          events={e.events ?? []}
          label="Distinct visitors per day"
          height={180}
          caption={<span>Distinct addresses, the same human filter the cockpit uses.</span>}
        />
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
        <TimeChart
          series={[
            {
              key: 'changes',
              label: 'Changes',
              points: s.days.map(d => ({ at: d.date, value: d.changes })),
              kind: 'bars',
            },
          ]}
          label="Changes shipped per day"
          height={170}
        />
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

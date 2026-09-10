import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { RankChart } from '../components/RankChart';
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
 * Drawn as a desk (docs/data-room.md, "The desk"): the site's dark tokens
 * whatever the visitor's theme, a strip of tiles over a ticker of the dated
 * things the owner did, then the document itself in the floor's language
 * (`.pubws` + `.dr-*`) - tiny uppercase labels, hairlines instead of cards,
 * hand-rolled SVG for every drawing. See docs/ui-conventions.md.
 */

/** The three parts the page is ordered into, in the order they run down it.
 *  The server's own list is functions/src/content/data-room.ts; this is the
 *  reader-facing name for each (docs/data-room.md, "One page, three parts"). */
const PARTS = [
  { id: 'numbers', title: 'The numbers' },
  { id: 'place', title: 'The place' },
  { id: 'plan', title: 'The plan' },
];

function n(v: number): string {
  return v.toLocaleString('en-US');
}

/** "Aug 19", so a run of days reads as dates rather than as ISO strings. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const DAY_MS = 86_400_000;
const tOf = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();

/** The running total of accounts, counted DOWN from the published figure.
 *  Signups are kept for sixty days and accounts predate that, so a total
 *  counted up from the first signup in the window ends below the figure
 *  printed beside it (docs/data-room.md, "The desk"). */
function accountsOverTime(
  accounts: number,
  signups: Array<{ day: string; signups: number }>,
): Array<{ at: string; value: number }> {
  let after = 0;
  const out: Array<{ at: string; value: number }> = [];
  for (let i = signups.length - 1; i >= 0; i--) {
    out.unshift({ at: signups[i].day, value: accounts - after });
    after += signups[i].signups;
  }
  return out;
}

/** Trades in the seven days ending on each covered day: what "trades this
 *  week" has been, from the daily rows the page publishes further down. */
function trailingWeek(byDay: Array<{ day: string; trades: number }>): Array<{ at: string; value: number }> {
  return byDay.map(d => {
    const end = tOf(d.day);
    const from = end - 6 * DAY_MS;
    const value = byDay.filter(x => tOf(x.day) >= from && tOf(x.day) <= end).reduce((sum, x) => sum + x.trades, 0);
    return { at: d.day, value };
  });
}

/**
 * The change over the trailing seven days: the newest reading minus the one
 * that stood seven days before it.
 *
 * A series that does not reach back that far returns null and the tile prints
 * no change, rather than a change measured against whatever its first reading
 * happens to be. A reading more than three days older than the target day is
 * not "what stood then" either: it is the same gap the chart breaks a line on.
 */
function weekChange(points: Array<{ at: string; value: number }>): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = tOf(last.at) - 7 * DAY_MS;
  const prior = points.filter(p => tOf(p.at) <= target).pop();
  if (!prior || target - tOf(prior.at) > 3 * DAY_MS) return null;
  return last.value - prior.value;
}

/** Which section draws a block full size, so a tile can link to it. */
function sectionWith(feed: DataRoomFeed, block: string): string | undefined {
  return feed.doc.sections.find(s => s.blocks.includes(block as DataRoomBlock))?.id;
}

/**
 * One tile of the strip: the figure, the seven-day change, and the same
 * series drawn small (docs/data-room.md, "The desk"). The spark is a
 * TimeChart with its axes off, so it answers the pointer like every other
 * drawing on the page.
 */
function Tile({
  label,
  value,
  points,
  href,
  connect,
}: {
  label: string;
  value: string;
  points: Array<{ at: string; value: number }>;
  href?: string;
  /** True for a series defined between its points (a running total). */
  connect?: boolean;
}) {
  const delta = weekChange(points);
  const body = (
    <>
      <span className="dr-tile-label">{label}</span>
      <span className="dr-tile-row">
        <span className="dr-tile-n">{value}</span>
        {delta !== null && (
          <span className={`dr-tile-delta${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`}>
            {delta > 0 ? '+' : ''}
            {n(Math.round(delta))}
            <em>7d</em>
          </span>
        )}
      </span>
      <TimeChart
        series={[{ key: label, label, points, kind: 'area', connect }]}
        label={`${label}, over time`}
        height={52}
        variant="spark"
      />
    </>
  );
  return href ? (
    <a className="dr-tile" href={`#${href}`}>
      {body}
    </a>
  ) : (
    <div className="dr-tile">{body}</div>
  );
}

/**
 * The strip: one tile per number a reader came for, in the order the floor
 * prices them, then trades this week, then accounts. Nothing here is a new
 * figure; every one of them is drawn full size further down the page.
 */
function Strip({ feed }: { feed: DataRoomFeed }) {
  const e = feed.evidence;
  const metrics = (e.rates?.metrics ?? []).filter(m => (m.daily ?? []).length > 0);
  const trades = trailingWeek(e.trading?.byDay ?? []);
  const accounts = accountsOverTime(e.traction?.accounts ?? 0, e.traction?.signupsByDay ?? []);
  const ratesAt = sectionWith(feed, 'rates');
  if (!metrics.length && !trades.length && !accounts.length) return null;
  return (
    <div className="dr-strip">
      {metrics.map(m => {
        const daily = m.daily ?? [];
        return (
          <Tile
            key={m.name}
            label={m.name}
            value={n(Math.round(daily[daily.length - 1].value))}
            points={daily}
            href={ratesAt}
          />
        );
      })}
      {trades.length > 0 && (
        <Tile
          label="Trades this week"
          value={n(e.pulse?.tradesThisWeek ?? trades[trades.length - 1].value)}
          points={trades}
          href={sectionWith(feed, 'trading')}
        />
      )}
      {accounts.length > 0 && (
        <Tile
          label="Accounts"
          value={n(e.traction.accounts)}
          points={accounts}
          connect
          href={sectionWith(feed, 'traction')}
        />
      )}
    </div>
  );
}

/** The ticker: the dated things the owner did, newest first, on one line.
 *  The same rows the events block prints; an empty record draws nothing. */
function Ticker({ events }: { events: Array<{ at: string; kind: string; label: string }> }) {
  if (!events.length) return null;
  return (
    <div className="dr-ticker">
      <span className="dr-ticker-head">What moved it</span>
      <div className="dr-ticker-run">
        {[...events]
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((e, i) => (
            <span key={`${e.at}-${i}`} className="dr-ticker-item">
              <span className="dr-ticker-day">{dayLabel(e.at)}</span>
              {e.label}
            </span>
          ))}
      </div>
    </div>
  );
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

const stageShade = (stage: string) => 0.2 + (Math.max(0, STAGE_ORDER.indexOf(stage)) / (STAGE_ORDER.length - 1)) * 0.8;

function StageGrid({ stages }: { stages: string[] }) {
  if (!stages.length) return <p className="dr-empty">Nobody on the list yet.</p>;
  return (
    <>
      <div className="dr-stages">
        {stages.map((stage, i) => (
          <span
            key={`${stage}-${i}`}
            className="dr-stage-cell"
            data-stage={stage}
            style={{ opacity: stageShade(stage) }}
            title={stage}
          />
        ))}
      </div>
      {/* The ramp is the only thing that tells one square from another, so it
          is named rather than left to a tooltip. */}
      <div className="dr-stage-key">
        {STAGE_ORDER.map(stage => (
          <span key={stage} className="dr-stage-key-item">
            <span className="dr-stage-cell" style={{ opacity: stageShade(stage) }} aria-hidden="true" />
            {stage}
          </span>
        ))}
      </div>
    </>
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
    // The seven days the counted traders lapse over are a series over days,
    // so they are drawn as one, by the same component as every other series
    // (docs/data-room.md, "How the page draws things").
    const lapseDays = Array.from({ length: 8 }, (_, k) => {
      const d = new Date(new Date(`${w.at.slice(0, 10)}T00:00:00Z`).getTime() + k * 86400000);
      return d.toISOString().slice(0, 10);
    });
    return (
      <>
        <h3 className="dr-h3">Traded this week, one bar per verified participant</h3>
        <RankChart
          id="traders"
          values={w.traders.spend}
          threshold={w.traders.threshold}
          cap={500}
          unit="cr"
          label="Credits traded in the trailing seven days, one bar per verified participant"
          caption={<span>{n(w.traders.spend.length)} verified participants, sorted</span>}
        />
        <h3 className="dr-h3">When each counted week lapses</h3>
        <div data-lapse="traders">
          <TimeChart
            series={[
              {
                key: 'lapses',
                label: 'Traders lapsing',
                points: lapseDays.map(day => ({ at: day, value: w.traders.lapses.filter(l => l === day).length })),
                kind: 'bars',
              },
            ]}
            label="When each counted trader falls out of their own week"
            height={150}
            caption={<span>Every counted trader lapses inside the seven days unless they trade again.</span>}
          />
        </div>
        <h3 className="dr-h3">Marked profit, one bar per participant</h3>
        <RankChart
          id="forecasters"
          values={w.forecasters.profit}
          threshold={w.forecasters.threshold}
          cap={600}
          unit="cr"
          signed
          label="Marked profit per participant, sorted"
          caption={<span>marked to market, house excluded</span>}
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
                  // hole in the total, it is a flat stretch of it. Counted
                  // down from the published figure, so the line ends on the
                  // number printed above it (docs/data-room.md).
                  connect: true,
                  points: accountsOverTime(t.accounts, t.signupsByDay),
                },
              ]}
              events={e.events ?? []}
              label="Signups per day and the running total of accounts"
              height={190}
              caption={
                <span>
                  The running total ends on the accounts figure above and is counted back from it: accounts made before
                  this window are its floor, not zero.
                </span>
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
          <Figure value={t.uniques24h} label="distinct addresses, 24h" />
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
              Known crawlers and scanner paths excluded.{' '}
              {t.keptSince ? (
                <>Kept from {dayLabel(t.keptSince)}, the day the rollup started.</>
              ) : (
                <>Nothing kept yet.</>
              )}
            </span>
          }
        />
        <h3 className="dr-h3">Distinct addresses, per day</h3>
        {/* Its own chart: thirty people against six hundred loads on one axis
            draws the people as a flat line, and the people are the number
            that matters. */}
        <TimeChart
          series={[
            {
              key: 'uniques',
              label: 'Distinct addresses',
              points: t.byDay.map(d => ({ at: d.day, value: d.uniques })),
            },
          ]}
          events={e.events ?? []}
          label="Distinct addresses per day"
          height={180}
          caption={<span>Distinct addresses, the same traffic filter the cockpit uses.</span>}
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
    /* The one page on the site that fixes its own palette: it is an
       instrument, and it reads on dark whatever the visitor set
       (docs/ui-conventions.md, "The data room"). The tokens are the site's
       own dark ones, not a second palette. */
    <div className="pubws dr-desk" data-theme="dark">
      <TopBar user={!!user} ready={!authLoading} />
      <div className="dr">
        <header className="dr-head">
          <div className="dr-head-main">
            <h1 className="dr-title">Data room</h1>
            <p className="dr-lead">
              Telarchy&apos;s own books: what this is for, what it has done, who showed up, what shipped, and what is
              planned. Every figure is read live from the database that serves this site.
            </p>
          </div>
          {feed && (
            <p className="dr-stamp">
              <span className="dr-live">
                <span className="dr-live-dot" aria-hidden="true" />
                read live
              </span>
              <span>
                figures generated{' '}
                {new Date(feed.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span>words updated {dayLabel(feed.doc.updatedAt)}</span>
              <a href={withBase('/api/data-room')} className="dr-stamp-link">
                the same page as JSON
              </a>
            </p>
          )}
        </header>

        {feed && <Strip feed={feed} />}
        {feed && <Ticker events={feed.evidence.events ?? []} />}

        {error && <p className="dr-err">{error}</p>}
        {!feed && !error && <p className="dr-empty">Reading the books...</p>}

        {feed && (
          <>
            {/* The index groups the sections under their part, so the page
                navigates like three pages without becoming three
                (docs/data-room.md, "One page, three parts"). A part with no
                sections is not a heading over nothing. */}
            <nav className="dr-index" aria-label="Sections">
              {[
                ...PARTS.map(part => ({
                  ...part,
                  members: sections.filter(s => s.part === part.id),
                })),
                // A section naming no part (an older payload, or one the
                // prose has not placed yet) is still linkable: it goes in a
                // trailing group with no heading rather than out of the index.
                {
                  id: 'unplaced',
                  title: null as string | null,
                  members: sections.filter(s => !PARTS.some(p => p.id === s.part)),
                },
              ]
                .filter(part => part.members.length > 0)
                .map(part => (
                  <span key={part.id} className="dr-index-group">
                    {part.title && <span className="dr-index-part">{part.title}</span>}
                    {part.members.map(s => (
                      <a key={s.id} href={`#${s.id}`} className={`dr-index-link${active === s.id ? ' is-active' : ''}`}>
                        {s.title}
                      </a>
                    ))}
                  </span>
                ))}
            </nav>

            {sections.map(s => (
              <section key={s.id} id={s.id} className={`dr-section${s.blocks.length ? ' has-drawings' : ''}`}>
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

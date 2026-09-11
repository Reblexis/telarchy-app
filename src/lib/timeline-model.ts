/**
 * The geometry of "What is planned" (docs/owner-on-the-floor.md, "What is
 * planned", "The axis"): one time axis, one row per item with its bar on
 * the shared axis under its title, the soonest end on top. Pure functions
 * of a fixed clock so the component only paints.
 *
 * No lanes and no label measurement, on purpose: the column the card lives
 * in is 280px wide, and a label that has to fit next to its bar is a label
 * that gets cut (measured on the branch preview 2026-09-11, revising the
 * lane layout borrowed from vcihal.com/tasks).
 */

export type TimelineKind = 'proposal' | 'decision' | 'book' | 'plan';

export interface TimelineItem {
  kind: TimelineKind;
  id: string;
  title: string;
  /** ISO instant; null means "can be worked on now", drawn from the window's left edge. */
  start: string | null;
  /** ISO instant; null means no due point, listed under the axis rather than drawn. */
  end: string | null;
  /** Where the row goes; a plan item has none and opens its own words. */
  href: string | null;
  done?: boolean;
  description?: string | null;
}

export type Range = 'today' | 'week' | 'month';

const DAY = 864e5;

/**
 * The three windows. "Today" is the local calendar day, because a reader
 * asking "what is happening today" means the day on their clock, not 24
 * hours from now. "Week" and "month" look a little behind now as well as
 * ahead (one day in seven, three in thirty) so a deadline that slipped
 * yesterday is still on the axis, sitting in the shaded past where it
 * belongs, instead of vanishing the moment it is missed.
 */
export function windowFor(range: Range, now: Date | number): { from: number; to: number } {
  const t = typeof now === 'number' ? now : now.getTime();
  if (range === 'today') {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: d.getTime() + DAY };
  }
  if (range === 'week') return { from: t - DAY, to: t + 6 * DAY };
  return { from: t - 3 * DAY, to: t + 27 * DAY };
}

export interface Tick {
  t: number;
  label: string;
}

const fmtDayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * One tick rule per range rather than a pixel-spacing ladder: at 280px a
 * ladder chose weekly ticks for a week and the axis had one date on it.
 * Today: every six hours as a time. Week: every midnight, the day number,
 * the first of a month named. Month: every Monday, day and month. Walking
 * Date fields rather than adding milliseconds keeps a tick at midnight
 * across a DST change.
 */
export function ticksFor(range: Range, from: number, to: number): Tick[] {
  const out: Tick[] = [];
  const d = new Date(from);
  if (range === 'today') {
    d.setMinutes(0, 0, 0);
    d.setHours(Math.floor(d.getHours() / 6) * 6);
  } else {
    d.setHours(0, 0, 0, 0);
    // Back to the Monday on or before `from`; getDay() is 0 on Sunday.
    if (range === 'month') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  }
  let guard = 0;
  while (d.getTime() <= to && guard++ < 400) {
    if (d.getTime() >= from) {
      const label =
        range === 'today' ? fmtTime(d) : range === 'month' || d.getDate() === 1 ? fmtDayMonth(d) : String(d.getDate());
      out.push({ t: d.getTime(), label });
    }
    if (range === 'today') d.setHours(d.getHours() + 6);
    else d.setDate(d.getDate() + (range === 'month' ? 7 : 1));
  }
  return out;
}

/** The mono meta at the end of a title line: what the end IS, then the day.
 *  Today and tomorrow are written as words because "due 11 Sept" makes the
 *  reader look at a calendar for what is in front of them. Null when the
 *  item has no end. */
export function endMeta(item: TimelineItem, now: Date | number): string | null {
  if (!item.end) return null;
  const e = Date.parse(item.end);
  if (Number.isNaN(e)) return null;
  const verb =
    item.kind === 'decision' ? 'decides' : item.kind === 'proposal' ? 'by' : item.kind === 'book' ? 'settles' : 'due';
  const today = new Date(typeof now === 'number' ? now : now.getTime());
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((e - today.getTime()) / DAY);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : fmtDayMonth(new Date(e));
  return `${verb} ${when}`;
}

export interface PlacedRow {
  item: TimelineItem;
  /** Visible extent, clipped to the axis. */
  left: number;
  width: number;
  /** Whether the bar continues past the axis edge. */
  openLeft: boolean;
  openRight: boolean;
  end: number;
}

export interface Layout {
  from: number;
  to: number;
  width: number;
  /** Soonest end first. */
  rows: PlacedRow[];
  undated: TimelineItem[];
  /** Null when now is outside the window. */
  nowX: number | null;
  pastWidth: number;
  ticks: Array<Tick & { x: number }>;
}

/** A ten-minute call is still a bar, not nothing. */
const MIN_BAR_PX = 2;

/**
 * @param items what the API returned
 * @param range which window
 * @param now the clock the window is built around
 * @param widthPx the axis width in pixels
 * @param clock the instant the now-line marks; defaults to `now`, split
 *   out so a test can put now outside the window
 */
export function layout(
  items: TimelineItem[],
  range: Range,
  now: Date | number,
  widthPx: number,
  clock: Date | number = now,
): Layout {
  const { from, to } = windowFor(range, now);
  const width = Math.max(widthPx, 1);
  const span = to - from;
  const toX = (t: number) => ((t - from) / span) * width;

  const undated: TimelineItem[] = [];
  const rows: PlacedRow[] = [];
  for (const it of items) {
    if (it.done) continue;
    if (!it.end) {
      undated.push(it);
      continue;
    }
    const e = Date.parse(it.end);
    // A null start is "can be worked on now": the bar begins at the window's
    // left edge, whichever window is shown.
    const s = it.start ? Date.parse(it.start) : -Infinity;
    if (Number.isNaN(e) || Number.isNaN(s)) continue;
    if (s > to || e < from) continue;
    const x1 = s === -Infinity ? 0 : Math.max(toX(s), 0);
    const x2 = Math.min(toX(e), width);
    rows.push({
      item: it,
      left: x1,
      width: Math.max(x2 - x1, MIN_BAR_PX),
      openLeft: s !== -Infinity && s < from,
      openRight: e > to,
      end: e,
    });
  }
  // The API already sends end ascending; sorting again costs nothing and
  // keeps the rule true whatever the caller hands over.
  rows.sort((a, b) => a.end - b.end);

  const nowT = typeof clock === 'number' ? clock : clock.getTime();
  const nowRaw = toX(nowT);
  const nowX = nowRaw < 0 || nowRaw > width ? null : nowRaw;

  const ticks = ticksFor(range, from, to)
    .map(t => ({ ...t, x: toX(t.t) }))
    .filter(t => t.x >= 0 && t.x <= width);

  return { from, to, width, rows, undated, nowX, pastWidth: Math.max(0, Math.min(nowRaw, width)), ticks };
}

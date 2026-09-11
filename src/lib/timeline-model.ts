/**
 * The geometry of "What is planned" (docs/owner-on-the-floor.md, "What is
 * planned"): one time axis, bars packed into lanes, the soonest deadline on
 * top. Pure functions of a fixed clock so the component only paints.
 *
 * The lane packing, the tick ladder and the label rule are borrowed from
 * vcihal.com/tasks (design record in the telarchy umbrella,
 * notes/floor-timeline-proposal-2026-09-11.md), where they were tuned by
 * living with them; the styling is not.
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
  /** Where the bar goes; a plan item has none and opens its own words. */
  href: string | null;
  done?: boolean;
  description?: string | null;
}

export type Range = 'today' | 'week' | 'month';

const DAY = 864e5;
const HOUR = 36e5;

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

export interface Step {
  u: 'hour' | 'day';
  n: number;
}

/** Coarsest first would be wrong: walk from fine to coarse and stop at the
 *  first rung whose labels still sit at least 52px apart ("13 Aug" is about
 *  42px; tighter than that they touch). */
const STEPS: Step[] = [
  { u: 'hour', n: 1 },
  { u: 'hour', n: 3 },
  { u: 'hour', n: 6 },
  { u: 'hour', n: 12 },
  { u: 'day', n: 1 },
  { u: 'day', n: 7 },
];
const UNIT_MS = { hour: HOUR, day: DAY };
const MIN_TICK_GAP_PX = 52;

export function pickStep(spanMs: number, widthPx: number): Step {
  const perPx = spanMs / Math.max(widthPx, 1);
  for (const s of STEPS) if ((UNIT_MS[s.u] * s.n) / perPx >= MIN_TICK_GAP_PX) return s;
  return STEPS[STEPS.length - 1];
}

export interface Tick {
  t: number;
  label: string;
  /** A tick that also opens a bigger unit: midnight among hours, the first among days. */
  major: boolean;
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtMonth = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Ticks on real calendar boundaries between `from` and `to`. Walking Date
 * fields rather than adding milliseconds keeps a day tick at midnight across
 * a DST change. At midnight an hour tick names the day instead of "00:00",
 * and on the first a day tick names the month, so the axis always says
 * which date its times belong to.
 */
export function tickTimes(from: number, to: number, step: Step): Tick[] {
  const out: Tick[] = [];
  const d = new Date(from);
  if (step.u === 'day') {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setMinutes(0, 0, 0);
    d.setHours(Math.floor(d.getHours() / step.n) * step.n);
  }
  let guard = 0;
  while (d.getTime() <= to && guard++ < 400) {
    if (d.getTime() >= from) {
      const midnight = d.getHours() === 0 && d.getMinutes() === 0;
      const label =
        step.u === 'hour' ? (midnight ? fmtDay(d) : fmtTime(d)) : d.getDate() === 1 ? fmtMonth(d) : fmtDay(d);
      const major = step.u === 'hour' ? midnight : d.getDate() === 1;
      out.push({ t: d.getTime(), label, major });
    }
    if (step.u === 'day') d.setDate(d.getDate() + step.n);
    else d.setHours(d.getHours() + step.n);
  }
  return out;
}

/** The one word a bar's meta prints for its kind, so a reader who cannot
 *  tell the colours apart still knows a book from a proposal. */
export function kindWord(kind: string): string {
  switch (kind) {
    case 'proposal':
      return 'proposal';
    case 'decision':
      return 'decides';
    case 'book':
      return 'book';
    default:
      return 'plan';
  }
}

export interface PlacedBar {
  item: TimelineItem;
  /** Visible extent, clipped to the axis. */
  left: number;
  width: number;
  /** Whether the bar continues past the axis edge. */
  openLeft: boolean;
  openRight: boolean;
  labelInside: boolean;
  labelX: number;
  end: number;
}

export interface Layout {
  from: number;
  to: number;
  width: number;
  /** Lane 0 on top: the lane whose bar ends soonest. */
  lanes: PlacedBar[][];
  undated: TimelineItem[];
  /** Null when now is outside the window. */
  nowX: number | null;
  pastWidth: number;
  ticks: Array<Tick & { x: number }>;
  step: Step;
}

const LABEL_PAD = 16;
const LABEL_GAP = 12;
const LANE_GAP = 6;

/**
 * @param items what the API returned
 * @param range which window
 * @param now the clock the window is built around
 * @param widthPx the axis width in pixels
 * @param measureLabel text width in pixels at the bar's font
 * @param clock the instant the now-line marks; defaults to `now`, split
 *   out so a test can put now outside the window
 */
export function layout(
  items: TimelineItem[],
  range: Range,
  now: Date | number,
  widthPx: number,
  measureLabel: (s: string) => number,
  clock: Date | number = now,
): Layout {
  const { from, to } = windowFor(range, now);
  const width = Math.max(widthPx, 1);
  const span = to - from;
  const toX = (t: number) => ((t - from) / span) * width;

  const undated: TimelineItem[] = [];
  const dated: Array<{ item: TimelineItem; s: number; e: number }> = [];
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
    dated.push({ item: it, s, e });
  }

  // Pixel extents first, label included, then pack. The label only goes
  // inside when the visible bar can hold it; otherwise it sits past the end
  // and occupies the lane too, or the next bar prints straight through it.
  const placed = dated
    .map(({ item, s, e }) => {
      const x1 = s === -Infinity ? 0 : Math.max(toX(s), 0);
      const x2 = Math.min(toX(e), width);
      const tw = measureLabel(item.title);
      const inside = x2 - x1 > tw + LABEL_PAD;
      // A ten-minute call is still a bar, not nothing: two pixels at least.
      const w = Math.max(x2 - x1, 2);
      return {
        bar: {
          item,
          left: x1,
          width: w,
          openLeft: s !== -Infinity && s < from,
          openRight: e > to,
          labelInside: inside,
          labelX: inside ? x1 : x1 + w,
          end: e,
        } as PlacedBar,
        occupyTo: inside ? x2 : x1 + w + tw + LABEL_GAP,
        lane: -1,
      };
    })
    .sort((a, b) => a.bar.left - b.bar.left);

  // Greedy interval packing: a bar only earns its own lane when it overlaps
  // everything already on the lanes above it.
  const laneEnds: number[] = [];
  const laneSoonest: number[] = [];
  for (const p of placed) {
    let lane = laneEnds.findIndex(end => end + LANE_GAP <= p.bar.left);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-Infinity);
      laneSoonest.push(Infinity);
    }
    laneEnds[lane] = p.occupyTo;
    laneSoonest[lane] = Math.min(laneSoonest[lane], p.bar.end);
    p.lane = lane;
  }

  // Packing runs in start order, which buries urgent work: a bar with no
  // start begins at the far left and would always take the top lane. Reorder
  // by soonest end so the top of the axis is what needs attention.
  const order = laneSoonest.map((soonest, i) => ({ soonest, i })).sort((a, b) => a.soonest - b.soonest);
  const lanes: PlacedBar[][] = order.map(() => []);
  const newIndex: number[] = [];
  order.forEach(({ i }, newI) => {
    newIndex[i] = newI;
  });
  for (const p of placed) lanes[newIndex[p.lane]].push(p.bar);

  const nowT = typeof clock === 'number' ? clock : clock.getTime();
  const nowRaw = toX(nowT);
  const nowX = nowRaw < 0 || nowRaw > width ? null : nowRaw;

  const step = pickStep(span, width);
  const ticks = tickTimes(from, to, step)
    .map(t => ({ ...t, x: toX(t.t) }))
    .filter(t => t.x >= 0 && t.x <= width);

  return {
    from,
    to,
    width,
    lanes,
    undated,
    nowX,
    pastWidth: Math.max(0, Math.min(nowRaw, width)),
    ticks,
    step,
  };
}

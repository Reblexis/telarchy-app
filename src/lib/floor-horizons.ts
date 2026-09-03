/**
 * One horizon of a floor, as everything on the page needs it.
 *
 * A floor opens on ONE horizon, the furthest-resolving open market, and a
 * reader can step to the others with the arrows beside the metric's name
 * (owner ask 2026-08-20, reversing the 2026-08-17 direction that removed the
 * second clock as "too confusing": what was confusing was two clocks shown at
 * once, and the reason to bring them back is that a floor with one market
 * gives a trader nothing to do after their first bet). Every surface needs the
 * same handful of facts about whichever one is selected: its market, its price
 * series, its metric's history, where its period starts, and what to call it.
 *
 * Those facts used to be re-derived at each use site from the position of an
 * element in `ws.markets`, and the surfaces disagreed the moment the order
 * changed. All three of these shipped:
 *
 *   - the market chart plotted `ws.marketHistory` (the PRIMARY market's price
 *     replay) under whichever horizon was selected, so the weekly view drew
 *     the year's $77k line and then dropped to the week's $213 call, with a
 *     "-$73,387 since open" chip to match (owner report 2026-08-17);
 *   - the caption read "speed, not the decision" while "end of 2026" was
 *     selected, because it tested `heroIdx === horizons.length - 1` and the
 *     list had been reversed to show the year first (owner report 2026-08-17);
 *   - the impact unit came from `horizons[horizons.length - 1]`, the same
 *     stale convention.
 *
 * So the rule is: NOTHING outside this module decides what a horizon is from
 * its index. `primaryHorizonOf` answers "which one is the real one", and a
 * price series is only ever looked up BY MARKET ID (`priceSeriesOf`), never by
 * position. Reordering the payload, or a workspace growing a second open
 * market, cannot silently re-point a chart at another market's data.
 */

import type { PublicWorkspace } from './api';

export interface HorizonView {
  marketId: string;
  metricId: string;
  /** The metric's display order; the headline tie-breaker (see `primaryHorizonOf`). */
  metricOrder: number | null;
  /** As stored, unit tail included: "LookPilot net 2026 (USD)". */
  metricName: string;
  /** Display name, tail stripped: "LookPilot net 2026". */
  metricLabel: string;
  /** '$' or '' — the tail's currency, display-only. */
  unit: string;
  targetDate: string;
  /** Reader-facing name of the clock: "this week", "end of 2026". */
  label: string;
  /** The day the period ends: "31 December 2026". */
  settleDay: string | null;
  /** The same day, short, for the caption: "31 Dec" (year only when it differs). */
  settleShort: string | null;
  /** Exact settle instant (ISO) from the server. */
  resolvesOn: string | null;
  /** First moment of the settled period (ISO), when the server sent one. */
  periodStart: string | undefined;
  /** Last moment of it. Not the settlement instant once the metric carries a
   *  reporting lag: between the two is the window where the number for the
   *  period is typed and dated into it (docs/guides/sources.md). */
  periodEnd: string | undefined;
  consensus: number | null;
  probability: number;
  /** LMSR sensitivity, b = pool / ln 2: what the price maths takes, never a
   *  credit figure a human reads. */
  liquidity: number;
  /** Credits in the pool: what the owner and everyone else actually paid in. */
  pool: number;
  /** Distinct traders and credits traded, for the facts row; absent on older payloads. */
  traderCount: number | null;
  tradedVolume: number | null;
  rangeMin: number;
  rangeMax: number;
  /** The metric's own readings, oldest first. */
  metricHistory: Array<{ at: string; value: number }>;
  /** The period the metric restarts on, or null for a level or accumulator. */
  resetsEvery: string | null;
  /** The owner's definition of this horizon's number. */
  description: string | null;
  /**
   * True while this market would settle N/A: its metric is declared
   * `resolvesNaUntilMeasured` and has no reading yet (owner ask 2026-08-25,
   * the valuation that exists only once an investment closes).
   */
  settlesNaForNow: boolean;
}

/** The currency in a metric name's parenthetical tail: "revenue (monthly, USD)". */
export function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

/** The metric name without its unit tail, which the page shows instead. */
export function metricLabelOf(metricName: string): string {
  return metricName.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * The day a target period ends: '2026' and '2026-12' both end on 31 December
 * 2026, an ISO week on its Sunday. The END of the period, so a year boundary
 * never reads a day late.
 */
export function settleDayOf(targetDate: string): string | null {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  // An ISO week settles on its Sunday. Without this the weekly horizon drew a
  // chart that never said when it lands, and on a workspace whose two metrics
  // share a name once their tail is stripped, the settle day is the only thing
  // telling the two charts apart (owner report 2026-08-16).
  const wk = targetDate.match(/^(\d{4})-W(\d{2})$/);
  if (wk) {
    const jan4 = new Date(Date.UTC(Number(wk[1]), 0, 4));
    const sunday = new Date(jan4);
    sunday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (Number(wk[2]) - 1) * 7 + 6);
    return fmt(sunday);
  }
  const m = targetDate.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 12;
  const day = m[3] ? Number(m[3]) : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * What to call a horizon in the selector: the reader thinks in "this week"
 * and "end of 2026", not in ISO period strings.
 */
export function horizonLabel(targetDate: string, now: Date = new Date()): string {
  // "this week" only when it IS this week. In the window between a week
  // rolling over and the hourly refresh creating the new market, last week's
  // market is still the one on the page, and a label reading "this week"
  // about a week that has ended is worse than a date.
  if (/^\d{4}-W\d{2}$/.test(targetDate)) {
    return targetDate === isoWeekOf(now) ? 'this week' : `week to ${shortDay(targetDate)}`;
  }
  // Same rule for a day: "today" only while it is today. Daily markets came
  // with the two-stepper floor (owner ask 2026-08-25).
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return targetDate === now.toISOString().slice(0, 10) ? 'today' : shortDay(targetDate);
  }
  if (/^\d{4}$/.test(targetDate)) return `end of ${targetDate}`;
  const m = targetDate.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    // December IS the year end: "end of 2026" is what the charter calls it,
    // and it beats "end of December" beside a metric named "net 2026".
    if (m[2] === '12') return `end of ${m[1]}`;
    // And "this month" only while it is this month, like the week.
    if (targetDate === now.toISOString().slice(0, 7)) return 'this month';
    const month = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    });
    return `end of ${month}`;
  }
  return settleDayOf(targetDate) ?? targetDate;
}

/** The ISO week a moment falls in, as YYYY-Www. The Thursday rule, in UTC. */
export function isoWeekOf(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3); // this week's Thursday
  const isoYear = day.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((day.getTime() - week1Thursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * "23 Aug", or "23 Aug 2027" when the settle day is not in the year the reader
 * is standing in. The year is dead weight on a market settling in six weeks
 * and the only thing that matters on one settling in eighteen months.
 *
 * This is what the floor's caption puts after the metric's name (owner ask
 * 2026-08-20: "it should have @ resolution date in its name"). It is COMPUTED
 * from the market's target date and never stored on the metric, so the weekly
 * market rolling over on Monday renames nothing and cannot go stale.
 */
export function settleShortOf(targetDate: string, now: Date = new Date()): string | null {
  const full = settleDayOf(targetDate);
  if (!full) return null;
  const [day, month, year] = full.split(' ');
  const short = `${day} ${month.slice(0, 3)}`;
  return Number(year) === now.getUTCFullYear() ? short : `${short} ${year}`;
}

/** "23 Aug", for a selector button that has no room for the year. */
function shortDay(targetDate: string): string {
  const full = settleDayOf(targetDate);
  if (!full) return targetDate;
  const [day, month] = full.split(' ');
  return `${day} ${month.slice(0, 3)}`;
}

/**
 * Every open horizon of a floor, as a GRID read metric by metric.
 *
 * Index 0 is the primary, the one the floor opens on (see `primaryHorizonOf`
 * for the rule). The list is grouped by metric, the primary's metric first
 * and the rest by their display order, and inside a metric the dates run
 * furthest-first, so the two pickers (`metricsOf`, `datesOf`, `cellOf`) read it
 * without a second ordering of their own. The payload ships soonest-first;
 * the order flip lives here and nowhere else.
 */
export function buildHorizonViews(ws: PublicWorkspace | null | undefined, now: Date = new Date()): HorizonView[] {
  const markets = ws?.markets ?? [];
  const historyByMarket = new Map((ws?.horizonHistories ?? []).map(h => [h.marketId, h]));
  const views = markets.map(m => {
    const row = historyByMarket.get(m.marketId);
    return {
      marketId: m.marketId,
      metricId: m.metricId,
      metricOrder: m.metricOrder ?? null,
      metricName: m.metricName,
      metricLabel: metricLabelOf(m.metricName),
      unit: currencyOf(m.metricName),
      targetDate: m.targetDate,
      label: horizonLabel(m.targetDate, now),
      settleDay: settleDayOf(m.targetDate),
      settleShort: settleShortOf(m.targetDate, now),
      resolvesOn: m.resolvesOn ?? null,
      periodStart: row?.periodStart,
      periodEnd: row?.periodEnd,
      consensus: m.consensus,
      probability: m.probability,
      liquidity: m.liquidity,
      pool: m.pool ?? 0,
      traderCount: m.traderCount ?? null,
      tradedVolume: m.tradedVolume ?? null,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      metricHistory: (row?.points ?? [])
        .flatMap(p => (p.at && Number.isFinite(p.value) ? [{ at: p.at, value: p.value }] : []))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
      description: row?.description ?? null,
      resetsEvery: row?.resetsEvery ?? null,
      settlesNaForNow: !!row?.resolvesNaUntilMeasured && !row?.measured,
    };
  });
  const primary = primaryOfViews(views);
  // One rank per METRIC ID, read off its furthest-resolving market: a metric
  // renamed mid-life stores the old name on its older markets, and ranking
  // by the name on each market would split one metric into two groups.
  const rank = new Map<string, [number, number, string]>();
  for (const v of [...views].sort((a, b) => settleInstantOf(b) - settleInstantOf(a))) {
    if (!rank.has(v.metricId)) {
      rank.set(v.metricId, [v.metricId === primary?.metricId ? 0 : 1, v.metricOrder ?? LAST_ORDER, v.metricName]);
    }
  }
  return views.sort((a, b) => {
    if (a.metricId !== b.metricId) {
      const [pa, oa, na] = rank.get(a.metricId)!;
      const [pb, ob, nb] = rank.get(b.metricId)!;
      if (pa !== pb) return pa - pb;
      if (oa !== ob) return oa - ob;
      if (na !== nb) return na < nb ? -1 : 1;
      return a.metricId < b.metricId ? -1 : 1;
    }
    const t = settleInstantOf(b) - settleInstantOf(a); // furthest first
    if (t !== 0) return t;
    return a.marketId < b.marketId ? -1 : 1;
  });
}

const LAST_ORDER = 999;

/** When a horizon settles, as a number; the payload's `resolvesOn` first. */
function settleInstantOf(v: HorizonView): number {
  const t = v.resolvesOn ? new Date(v.resolvesOn).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  const day = v.settleDay ? new Date(`${v.settleDay} UTC`).getTime() : NaN;
  return Number.isFinite(day) ? day : 0;
}

/**
 * The furthest-resolving market; on a tie between metrics, the lower metric
 * order, then the earlier name, then the market id. The exact mirror of the
 * server's `compareSoonestFirst` (functions/src/lib/baseline-order.ts).
 */
function primaryOfViews(views: HorizonView[]): HorizonView | null {
  let best: HorizonView | null = null;
  for (const v of views) {
    if (!best) {
      best = v;
      continue;
    }
    const t = settleInstantOf(v) - settleInstantOf(best);
    if (t > 0) best = v;
    else if (t === 0) {
      const o = (v.metricOrder ?? LAST_ORDER) - (best.metricOrder ?? LAST_ORDER);
      if (o < 0) best = v;
      else if (o === 0) {
        if (v.metricName < best.metricName) best = v;
        else if (v.metricName === best.metricName && v.marketId < best.marketId) best = v;
      }
    }
  }
  return best;
}

/**
 * The horizon the floor is about: the furthest-resolving open market, and with
 * several metrics read on the same date, the one whose metric has the lower
 * display order. The mirror of the server's `primaryMarket`, so a card, a
 * share image and the floor all name the same number. `buildHorizonViews`
 * puts it at index 0.
 */
export function primaryHorizonOf(views: HorizonView[]): HorizonView | null {
  return views[0] ?? null;
}

/** The distinct metrics a floor prices, in stepper order (primary first). */
export function metricsOf(views: HorizonView[]): HorizonView[] {
  const seen = new Set<string>();
  return views.filter(v => {
    if (seen.has(v.metricId)) return false;
    seen.add(v.metricId);
    return true;
  });
}

/** The open dates of one metric, furthest first. */
export function datesOf(views: HorizonView[], metricId: string): HorizonView[] {
  return views.filter(v => v.metricId === metricId);
}

/**
 * The settle note under the price: "resolves 30 September 2026", or, for a
 * number that does not exist yet, the same with what happens if it still
 * does not: "resolves 30 September 2026, or N/A (all bets refunded) if there
 * is still no reading".
 */
export function settleNoteOf(v: HorizonView | null): string | undefined {
  if (!v?.settleDay) return undefined;
  return v.settlesNaForNow ? 'N/A, all bets refunded, if there is still no reading by then' : `resolves ${v.settleDay}`;
}

/**
 * How long until a horizon settles, in the two largest units that matter:
 * "13h 12m", "4d 13h", "35d", "3m" under an hour, "settling" once the instant
 * has passed. Null when the payload carries no settle instant.
 */
export function timeLeftOf(v: HorizonView | null, now: Date = new Date()): string | null {
  if (!v?.resolvesOn) return null;
  const ms = new Date(v.resolvesOn).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'settling';
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 7) return `${d}d`;
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

/**
 * How long ago an instant was, in the two units that matter: "3d ago",
 * "2h 10m ago", "just now" under a minute. The mirror of timeLeftOf, for
 * the number chart's "updated ..." note: a reading is only trustworthy
 * with its age on it.
 */
export function timeAgoOf(at: string | null | undefined, now: Date = new Date()): string | null {
  if (!at) return null;
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 7) return `${d}d ago`;
  if (d >= 1) return `${d}d ${h % 24}h ago`;
  if (h >= 1) return `${h}h ${m % 60}m ago`;
  return `${m}m ago`;
}

/**
 * A date's label in the date picker: the clock's name and its settle day,
 * "this week · 30 Aug". A named clock is "today", "this week" or "this
 * month"; any other date is its settle day alone ("30 Sep"). Both computed
 * from the market, never stored on the metric. The time left lives in the
 * chart's control row, not here.
 */
export function dateSegmentOf(v: HorizonView | null): string {
  if (!v) return '';
  const named = /^(today|this week|this month)$/.test(v.label) ? v.label : '';
  if (!v.settleShort) return named || v.targetDate;
  return named ? `${named} · ${v.settleShort}` : v.settleShort;
}

/**
 * A date as it reads inside the question line ("What will be LookPilot's
 * net revenue this week?"): a named clock is its own adverb ("today",
 * "this week", "this month") and takes no preposition; any other date
 * reads as "on" plus its settle day ("on 30 Sep"). Both computed from the
 * market, never stored on the metric. The settle instant lives in the
 * word's tooltip and the time left in the chart's control row, not here.
 */
export function dateQuestionOf(v: HorizonView | null): { word: string; on: boolean } {
  if (!v) return { word: '', on: false };
  if (/^(today|this week|this month)$/.test(v.label)) return { word: v.label, on: false };
  return { word: v.settleShort || v.targetDate, on: true };
}

/**
 * The workspace's name as the question's subject: "LookPilot's"; a name
 * already ending in s takes the bare apostrophe ("Vans'"). ASCII quote,
 * like every other string on the floor.
 */
export function possessiveOf(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

/**
 * The horizon a reader has stepped to, resolved BY MARKET ID.
 *
 * Selection travels as an identity, never as an index, for the same reason
 * price series do: the payload's order is the server's business, and a
 * workspace growing or resolving a market must not silently re-point the page
 * at a different number. An id that is no longer open falls back to the
 * primary, which is what a reader sees after the market they were looking at
 * settles under them.
 */
export function horizonById(views: HorizonView[], marketId: string | null | undefined): HorizonView | null {
  if (!marketId) return primaryHorizonOf(views);
  return views.find(v => v.marketId === marketId) ?? primaryHorizonOf(views);
}

/**
 * The cell of the grid a reader picked: the market on `metricId` read on
 * `targetDate`. Picking a metric keeps the date on screen when that metric has
 * a market on it and falls to the metric's furthest-resolving one otherwise;
 * picking a date never changes the metric (docs/ui-conventions.md, "The
 * question line"). Null only when the metric has no open market at all.
 */
export function cellOf(
  views: HorizonView[],
  metricId: string,
  targetDate: string | null | undefined,
): HorizonView | null {
  const dates = datesOf(views, metricId);
  return dates.find(v => v.targetDate === targetDate) ?? dates[0] ?? null;
}

export type PriceSeries = Array<{ at: string; consensus: number | null }>;

/**
 * A market's own price replay, BY MARKET ID.
 *
 * `ws.marketHistory` is one market's replay and the payload says which
 * (`marketHistoryMarketId`); every other market's is fetched on demand. This
 * returns an empty series rather than someone else's when it has not arrived:
 * an empty chart is a chart that is loading, while another market's series is
 * a lie the reader cannot detect.
 */
/**
 * Whether a market's price series is already in the payload. The caller uses
 * it to decide whether to fetch; it exists so no page has to know the field
 * name that carries the inline series, or which market it belongs to.
 */
export function priceSeriesIsInline(
  marketId: string | null | undefined,
  ws: PublicWorkspace | null | undefined,
): boolean {
  return !!marketId && ws?.marketHistoryMarketId === marketId;
}

export function priceSeriesOf(
  marketId: string | null | undefined,
  ws: PublicWorkspace | null | undefined,
  fetched: Record<string, PriceSeries>,
): PriceSeries {
  if (!marketId) return [];
  if (priceSeriesIsInline(marketId, ws)) return ws!.marketHistory ?? [];
  return fetched[marketId] ?? [];
}

/**
 * The metric label as it reads directly under the company's own name.
 *
 * The floor's identity block already says "LookPilot", so a caption reading
 * "LOOKPILOT NET 2026" one line below it says the company twice and buries
 * the part that matters. Strips a leading workspace-name prefix, and only
 * that: the full label is what the back button and every other surface show,
 * because there the company is not already overhead.
 *
 * Never strips down to nothing (a metric named exactly after its workspace
 * keeps its name), and never strips a prefix that is really the start of a
 * longer word ("LookPilotter"), which is why the boundary is checked.
 */
export function captionLabel(metricLabel: string, workspaceName: string | null | undefined): string {
  const name = (workspaceName ?? '').trim();
  if (!name) return metricLabel;
  if (!metricLabel.toLowerCase().startsWith(name.toLowerCase())) return metricLabel;
  const rest = metricLabel.slice(name.length);
  if (!/^[\s:,-]/.test(rest)) return metricLabel;
  const trimmed = rest.replace(/^[\s:,-]+/, '').trim();
  return trimmed.length > 0 ? trimmed : metricLabel;
}

/**
 * A market value at caption size: "4.0M", "$1.2B", "6,912", "20.9". One
 * decimal through k/M/B so sibling dates line up; small values stay exact,
 * because rounding 20.9 to 21 on a metric that IS 20.9 misquotes it.
 */
export function compactValueOf(value: number | null, unit: string): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  const one = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));
  let body: string;
  if (v >= 1e9) body = `${one(v / 1e9)}B`;
  else if (v >= 1e6) body = `${one(v / 1e6)}M`;
  else if (v >= 10_000) body = `${one(v / 1e3)}k`;
  else if (v >= 100) body = Math.round(v).toLocaleString('en-US');
  else body = String(Math.round(v * 10) / 10);
  return `${sign}${unit}${body}`;
}

/**
 * The calendar dates an owner can open a market on from the floor, in the
 * formats the API takes (docs/owner-on-the-floor.md). Deliberately four: the
 * horizons a company actually plans against. Anything else is an API call.
 */
export function openableDates(now: Date = new Date()): Array<{ label: string; targetDate: string }> {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = new Date(Date.UTC(y, m + 1, 1));
  return [
    { label: 'this week', targetDate: isoWeekOf(now) },
    { label: 'this month', targetDate: `${y}-${pad(m + 1)}` },
    { label: 'next month', targetDate: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}` },
    { label: `end of ${y}`, targetDate: String(y) },
  ];
}

/**
 * The settlement instant, written out: "30 Sep 2026, 23:59 UTC".
 *
 * A market settles on the last reading at or before this moment
 * (docs/guides/sources.md), so an owner deciding when to push a number needs
 * the boundary itself and not the distance to it: a reading at 23:58 and one
 * at 00:02 belong to different markets. UTC always, because the boundary is
 * UTC and a local rendering of it would be a different instant for every
 * reader.
 */
export function settleInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}, ${hh}:${mm} UTC`;
}

/**
 * The summary line under the question (docs/ui-conventions.md, "The price
 * and the chart"): the definition's first sentence, so a reader knows what
 * the number IS before they see it. A sentence ends at ". ", "! " or "? "
 * (or at the end of the text); a decimal point or an abbreviation like
 * "e.g." is not followed by a space and a capital, so it does not end one.
 * No definition, no line.
 */
export function firstSentenceOf(description: string | null | undefined): string | null {
  const text = (description ?? '').trim();
  if (!text) return null;
  const m = text.match(/^[\s\S]*?[.!?](?=\s+[A-Z0-9"'(]|\s*$)/);
  return (m ? m[0] : text).trim();
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The day a market is forecasting, as the date picker names it: the day
 * before the settle instant ("2026-10-01T00:00:00Z" is September's market,
 * so "30 Sep"), UTC, short. Null for an instant that does not parse.
 */
export function forecastDayOf(resolvesOn: string | null | undefined): string | null {
  if (!resolvesOn) return null;
  const t = new Date(resolvesOn).getTime();
  if (!Number.isFinite(t)) return null;
  // Own month names: en-GB short months print "Sept" in current ICU data,
  // and the picker above says "30 SEP".
  const d = new Date(t - 1);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

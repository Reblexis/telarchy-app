/**
 * One horizon of a floor, as everything on the page needs it.
 *
 * A floor shows ONE horizon: the furthest-resolving open market (owner
 * direction 2026-08-17, the second clock removed as "too confusing"). Every
 * surface needs the same handful of facts about it: its market, its price
 * series, its metric's history, where its period starts, and what to call it.
 * A workspace may still have other open markets and the API still serves
 * them; the floor does not offer them.
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
  /** Exact settle instant (ISO) from the server. */
  resolvesOn: string | null;
  /** First moment of the settled period (ISO), when the server sent one. */
  periodStart: string | undefined;
  consensus: number | null;
  probability: number;
  liquidity: number;
  rangeMin: number;
  rangeMax: number;
  /** The metric's own readings, oldest first. */
  metricHistory: Array<{ at: string; value: number }>;
  /** The owner's definition of this horizon's number. */
  description: string | null;
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
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
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
  if (/^\d{4}$/.test(targetDate)) return `end of ${targetDate}`;
  const m = targetDate.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    // December IS the year end: "end of 2026" is what the charter calls it,
    // and it beats "end of December" beside a metric named "net 2026".
    if (m[2] === '12') return `end of ${m[1]}`;
    const month = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
      .toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    return `end of ${month}`;
  }
  return settleDayOf(targetDate) ?? targetDate;
}

/** The ISO week a moment falls in, as YYYY-Www. The Thursday rule, in UTC. */
function isoWeekOf(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3); // this week's Thursday
  const isoYear = day.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((day.getTime() - week1Thursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** "23 Aug", for a selector button that has no room for the year. */
function shortDay(targetDate: string): string {
  const full = settleDayOf(targetDate);
  if (!full) return targetDate;
  const [day, month] = full.split(' ');
  return `${day} ${month.slice(0, 3)}`;
}

/**
 * Every open horizon of a floor, FURTHEST-RESOLVING FIRST.
 *
 * Index 0 is the one the floor shows. The payload ships soonest-first; the
 * order flip lives here and nowhere else, which is what makes
 * `primaryHorizonOf` a lookup rather than a decision each caller re-derives.
 * The rest of the list exists so a caller can still resolve a market it holds
 * an id for; no surface renders it.
 */
export function buildHorizonViews(
  ws: PublicWorkspace | null | undefined,
  now: Date = new Date(),
): HorizonView[] {
  const markets = ws?.markets ?? [];
  const historyByMarket = new Map((ws?.horizonHistories ?? []).map(h => [h.marketId, h]));
  return [...markets].reverse().map(m => {
    const row = historyByMarket.get(m.marketId);
    return {
      marketId: m.marketId,
      metricId: m.metricId,
      metricName: m.metricName,
      metricLabel: metricLabelOf(m.metricName),
      unit: currencyOf(m.metricName),
      targetDate: m.targetDate,
      label: horizonLabel(m.targetDate, now),
      settleDay: settleDayOf(m.targetDate),
      resolvesOn: m.resolvesOn ?? null,
      periodStart: row?.periodStart,
      consensus: m.consensus,
      probability: m.probability,
      liquidity: m.liquidity,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      metricHistory: (row?.points ?? [])
        .flatMap(p => (p.at && Number.isFinite(p.value) ? [{ at: p.at, value: p.value }] : []))
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
      description: row?.description ?? null,
    };
  });
}

/**
 * The horizon the floor is about: the furthest-resolving open market, and the
 * only one any surface renders. The mirror of the server's `primaryMarket`,
 * so a card, a share image and the floor all name the same number.
 */
export function primaryHorizonOf(views: HorizonView[]): HorizonView | null {
  return views[0] ?? null;
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

import type { HorizonView } from './floor-horizons';

/**
 * What is left to hit the market's price, for a metric that accumulates inside
 * its period.
 *
 * The reframe is the whole point (codex, 2026-08-20, after the owner read the
 * version this replaces and said "i got bored and wanted to quit"). A base rate
 * expressed as a multiplier makes a reader compute a ratio before they are
 * allowed to have a feeling. The same fact as an arithmetic they can check in
 * their head does not:
 *
 *     $488 booked, Monday to Wednesday
 *   + $692 to reach the market's $1,180
 *   = about $173 a day for the four days left
 *
 * Nobody needs a stats vocabulary to know whether $173 a day sounds greedy, and
 * that judgement IS the trade.
 *
 * ONLY for metrics that accumulate from zero inside the period. "Revenue this
 * week" does; "active traders" is a level, and "you need 4 more traders a day"
 * would be nonsense dressed as arithmetic. The test is the readings themselves
 * rather than a flag someone has to remember to set: the series must start at
 * (or near) zero and never fall.
 */
export interface PeriodGap {
  /** Booked so far, the metric's latest reading. */
  booked: number;
  /** Market price minus booked. Negative when the market is already beaten. */
  needed: number;
  /** The market's price, repeated so a caller never re-derives it. */
  target: number;
  /** Whole days from the last reading to the period's end, at least 1. */
  daysLeft: number;
  /** needed / daysLeft. */
  perDay: number;
  /** True when booked already clears the market's price. */
  alreadyThere: boolean;
}

/** A reading series that starts at zero and never falls: an accumulator. */
export function accumulatesInPeriod(points: Array<{ at: string; value: number }>): boolean {
  if (points.length < 3) return false;
  const values = points.map(p => p.value);
  // A period that opened above a tenth of where it now stands was not observed
  // from its start, so "booked so far" would be missing its beginning.
  if (values[0] > Math.max(...values) * 0.1) return false;
  for (let i = 1; i < values.length; i += 1) {
    // Small downward corrections happen (a refund lands); a real fall does not.
    if (values[i] < values[i - 1] * 0.98) return false;
  }
  return values[values.length - 1] > 0;
}

export function periodGapOf(h: HorizonView | null, now: Date = new Date()): PeriodGap | null {
  if (!h || h.consensus === null || !h.resolvesOn) return null;
  const points = h.metricHistory;
  if (!accumulatesInPeriod(points)) return null;

  const booked = points[points.length - 1].value;
  const end = new Date(h.resolvesOn).getTime();
  const from = Math.max(new Date(points[points.length - 1].at).getTime(), now.getTime());
  if (!Number.isFinite(end) || end <= from) return null;

  // Whole days, rounded up: with 30 hours left a reader has two days to trade
  // in, and telling them "1.25 days" helps nobody.
  const daysLeft = Math.max(1, Math.ceil((end - from) / 86_400_000));
  const needed = h.consensus - booked;
  return {
    booked,
    needed,
    target: h.consensus,
    daysLeft,
    perDay: needed / daysLeft,
    alreadyThere: needed <= 0,
  };
}

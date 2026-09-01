import { periodEndInstant, periodStartInstant } from './date-utils';

/**
 * Whether a market is about to settle on a reading nobody took during the
 * period it is settling for (docs/guides/sources.md, "Stale at the boundary
 * is said out loud").
 *
 * The old rule was three days for everything, which is meaningless twice
 * over: an hourly market is stale in an hour, and a market on next year's
 * revenue is not stale after a week. The period the market settles FOR is the
 * only honest yardstick. A reading taken before that period began is a
 * measurement of something else.
 */
export function readingIsStaleFor(
  targetDate: string,
  readingAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const start = periodStartInstant(targetDate);
  // Nothing can be stale for a period that has not begun: a market on
  // September, read on 31 August, is not waiting on anything. Saying "taken
  // before the period this market settles for" there was true and useless,
  // and it shipped that way for an hour on 2026-08-31.
  if (start && now.getTime() < start.getTime()) return false;
  if (!readingAt) return true;
  if (!start) return false;
  return readingAt.getTime() < start.getTime();
}

/** The furthest out a nudge ever goes, whatever the period. Two days is long
 *  enough to act on and short enough that it is not background noise. */
export const NUDGE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * True while a market is close enough to settling that a missing reading is
 * worth saying out loud.
 *
 * The window is the LAST QUARTER of the market's own period, capped at two
 * days. A flat 48 hours was wrong on anything short: a market on today is
 * inside 48 hours from the moment it opens, so every daily market nagged its
 * owner at midnight, before they could possibly have taken the day's reading
 * (owner report 2026-09-01, four of these at once). A quarter of a day is six
 * hours, a quarter of an hour is fifteen minutes, and a month still gets the
 * full two days.
 */
export function settlingSoon(targetDate: string, now: Date, capMs = NUDGE_WINDOW_MS): boolean {
  const end = periodEndInstant(targetDate).getTime();
  const start = periodStartInstant(targetDate)?.getTime() ?? end - capMs;
  const t = now.getTime();
  if (end <= t) return false;
  const windowMs = Math.min(capMs, Math.max(60_000, (end - start) / 4));
  return end - t <= windowMs;
}

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

/** How close a market has to be before a stale reading is worth an email:
 *  near enough that the owner can still act, far enough that the mail is not
 *  the first they hear of it. */
export const NUDGE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** True while a market is inside the window before its settlement instant. */
export function settlingSoon(targetDate: string, now: Date, windowMs = NUDGE_WINDOW_MS): boolean {
  const end = periodEndInstant(targetDate).getTime();
  const t = now.getTime();
  return end > t && end - t <= windowMs;
}

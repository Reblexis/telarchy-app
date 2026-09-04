/**
 * What a market on a given date opens with, read off the metric's
 * `timePreference.horizonCredits` (docs/owner-on-the-floor.md, dialog 2;
 * docs/guides/time-preference.md, "What each date opens with").
 *
 * Entries are keyed by the horizon entry as stored ("+0w", "2030-12"), and
 * a market is keyed by the date it targets, so the match resolves every
 * entry against `base` the way the refresh does and picks the one that
 * lands on the market's date. A rolling entry therefore pays its numbers
 * again every time it comes round, which is the point.
 */

import type { HorizonCredits, TimePreference } from '../types';
import { isRelativeDate, toAbsoluteDate } from './date-utils';

/** The entry behind `targetDate` right now, or null when no entry lands there. */
export function horizonEntryFor(
  tp: TimePreference | null | undefined,
  targetDate: string,
  base = new Date(),
): string | null {
  const horizons = tp?.customHorizons;
  if (!Array.isArray(horizons)) return null;
  for (const raw of horizons) {
    if (typeof raw !== 'string') continue;
    const entry = raw.trim();
    if (!entry) continue;
    const date = isRelativeDate(entry) ? toAbsoluteDate(entry, base) : entry;
    if (date === targetDate) return entry;
  }
  return null;
}

/** The numbers the owner chose for the date `targetDate` falls on. */
export function horizonCreditsFor(
  tp: TimePreference | null | undefined,
  targetDate: string,
  base = new Date(),
): HorizonCredits | null {
  const entry = horizonEntryFor(tp, targetDate, base);
  if (entry === null) return null;
  const table = tp?.horizonCredits;
  if (!table || typeof table !== 'object') return null;
  const row = table[entry];
  return row && typeof row === 'object' ? row : null;
}

/** What the metric's own book on `targetDate` opens with: the date's book
 *  number, else the metric's standing number, else the workspace default. */
export function bookCreditsFor(
  metric: { liquidityCredits?: number | null; timePreference?: unknown },
  targetDate: string,
  workspaceDefault: number,
  base = new Date(),
): number {
  const row = horizonCreditsFor(metric.timePreference as TimePreference | null, targetDate, base);
  if (row && typeof row.book === 'number') return row.book;
  if (typeof metric.liquidityCredits === 'number') return metric.liquidityCredits;
  return workspaceDefault;
}

/** What a proposal's branch on `targetDate` opens with when nobody else
 *  pays: the date's proposal number, and 0 when the owner never set one. */
export function proposalCreditsFor(
  metric: { timePreference?: unknown },
  targetDate: string,
  base = new Date(),
): number {
  const row = horizonCreditsFor(metric.timePreference as TimePreference | null, targetDate, base);
  return row && typeof row.proposal === 'number' ? row.proposal : 0;
}

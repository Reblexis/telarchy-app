/**
 * Target-date arithmetic for the frontend.
 *
 * The arithmetic itself is NOT here: it is re-exported from the backend
 * module, the way `src/lib/metrics-engine.ts` re-exports the engine. This file
 * holds only what a browser needs on top of it (locale formatting, a countdown).
 *
 * It used to be a hand-copied fork, and the fork drifted exactly where it
 * hurts. `toISOWeekString` was rewritten on 2026-08-16 (a Sunday afternoon in
 * a positive-offset zone rolled into the next week, which is how a market
 * targeting 2026-W35 got created), and only the backend copy was rewritten.
 * The frontend's `endOfPeriod` still built the week's Sunday from local-time
 * components and then read it back as UTC, so east of Greenwich every weekly
 * market showed a resolution date and countdown a day short. One source, so a
 * fix cannot land on one side again.
 */

export type {
  DateGranularity,
} from '../../functions/src/lib/date-utils';
export {
  isRelativeDate,
  detectGranularity,
  toAbsoluteDate,
  toISOWeekString,
  endOfPeriod,
  periodEndInstant,
  periodStartInstant,
  resolutionInstant,
  isValidDateFormat,
  isValidCalendarDate,
} from '../../functions/src/lib/date-utils';

import { detectGranularity, periodEndInstant } from '../../functions/src/lib/date-utils';

/**
 * Format target date for display; the format conveys granularity.
 * "2026" (year), "2026-06" (month), "2026-W20" (week), "2026-05-05" (day)
 */
export function formatTargetDateDisplay(dateStr: string): string {
  const g = detectGranularity(dateStr);
  return `${dateStr} (${g})`;
}

/**
 * The last second inside the period, for display. `periodEndInstant` is the
 * first moment AFTER it (the instant resolution runs), and showing that as the
 * deadline reads a day late on every period.
 */
function resolutionDateTime(targetDate: string): Date {
  return new Date(periodEndInstant(targetDate).getTime() - 1000);
}

export function formatResolutionDateTime(targetDate: string): string {
  return resolutionDateTime(targetDate).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function formatResolutionLabel(targetDate: string): string {
  return `${formatTargetDateDisplay(targetDate)} · resolves ${formatResolutionDateTime(targetDate)} UTC`;
}

export function fmtTime(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function getTimestampSeconds(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === 'object') {
    const o = ts as Record<string, unknown>;
    const s = o._seconds ?? o.seconds;
    return typeof s === 'number' ? s : null;
  }
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

export function formatTimeRemaining(targetDate: string): string {
  const end = resolutionDateTime(targetDate);
  const diffMs = end.getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const d = Math.floor(diffMs / 86400000);
  const h = Math.floor((diffMs % 86400000) / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (d > 30) { const mo = Math.floor(d / 30); return `${mo}mo ${d % 30}d`; }
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

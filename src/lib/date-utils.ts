/**
 * Parse and convert date strings with granularity support.
 * Supports: YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD (absolute)
 * and +Nd, +Nw, +Nm, +Ny (relative)
 */

export type DateGranularity = 'year' | 'month' | 'week' | 'day';

const RELATIVE_DATE_RE = /^\+(\d+)(d|w|m|y)$/;
const ABS_YEAR_RE = /^\d{4}$/;
const ABS_MONTH_RE = /^\d{4}-\d{2}$/;
const ABS_WEEK_RE = /^\d{4}-W\d{2}$/;
const ABS_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRelativeDate(dateStr: string): boolean {
  return RELATIVE_DATE_RE.test(dateStr);
}

/**
 * Detect granularity from date format.
 */
export function detectGranularity(dateStr: string): DateGranularity {
  if (RELATIVE_DATE_RE.test(dateStr)) {
    const m = dateStr.match(RELATIVE_DATE_RE);
    if (m) {
      const u = m[2];
      if (u === 'y') return 'year';
      if (u === 'm') return 'month';
      if (u === 'w') return 'week';
      if (u === 'd') return 'day';
    }
  }
  if (ABS_YEAR_RE.test(dateStr)) return 'year';
  if (ABS_MONTH_RE.test(dateStr)) return 'month';
  if (ABS_WEEK_RE.test(dateStr)) return 'week';
  if (ABS_DAY_RE.test(dateStr)) return 'day';
  return 'day';
}

/**
 * Convert relative date to granularity-appropriate absolute format.
 * +1y -> "2027", +3m -> "2026-05", +2w -> "2026-W09", +14d -> "2026-03-01"
 */
export function toAbsoluteDate(dateStr: string, baseDate: Date = new Date()): string {
  if (!isRelativeDate(dateStr)) return dateStr;

  const match = dateStr.match(RELATIVE_DATE_RE);
  if (!match) return dateStr;

  const amount = parseInt(match[1], 10);
  const unit = match[2] as 'd' | 'w' | 'm' | 'y';
  const d = new Date(baseDate);

  switch (unit) {
    case 'd':
      d.setDate(d.getDate() + amount);
      return d.toISOString().slice(0, 10);
    case 'w': {
      d.setDate(d.getDate() + amount * 7);
      return toISOWeekString(d);
    }
    case 'm':
      d.setMonth(d.getMonth() + amount);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'y':
      d.setFullYear(d.getFullYear() + amount);
      return String(d.getFullYear());
    default:
      return dateStr;
  }
}

/** Get ISO week string YYYY-Www for a date */
function toISOWeekString(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = Math.round((d.getTime() - mon.getTime()) / 86400000);
  let week = Math.floor(diff / 7) + 1;
  let year = d.getFullYear();
  if (week < 1) {
    year--;
    const prevJan4 = new Date(year, 0, 4);
    const prevMon = new Date(prevJan4);
    prevMon.setDate(prevJan4.getDate() - ((prevJan4.getDay() + 6) % 7));
    week = Math.floor((d.getTime() - prevMon.getTime()) / 86400000 / 7) + 1;
  } else if (week > 52) {
    const dec31 = new Date(year, 11, 31);
    const lastJan4 = new Date(year, 0, 4);
    const lastMon = new Date(lastJan4);
    lastMon.setDate(lastJan4.getDate() - ((lastJan4.getDay() + 6) % 7));
    const maxWeek = Math.floor((dec31.getTime() - lastMon.getTime()) / 86400000 / 7) + 1;
    if (week > maxWeek) {
      year++;
      week = 1;
    }
  }
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Return the last YYYY-MM-DD of the period.
 * "2026" -> "2026-12-31", "2026-05" -> "2026-05-31",
 * "2026-W07" -> Sunday of that ISO week, "2026-05-05" -> "2026-05-05"
 */
export function endOfPeriod(targetDate: string): string {
  if (ABS_YEAR_RE.test(targetDate)) {
    return `${targetDate}-12-31`;
  }
  if (ABS_MONTH_RE.test(targetDate)) {
    const [y, m] = targetDate.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${targetDate}-${String(lastDay).padStart(2, '0')}`;
  }
  if (ABS_WEEK_RE.test(targetDate)) {
    const [yStr, wStr] = targetDate.split('-W');
    const year = parseInt(yStr, 10);
    const week = parseInt(wStr, 10);
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const sunday = new Date(mon);
    sunday.setDate(mon.getDate() + (week - 1) * 7 + 6);
    return sunday.toISOString().slice(0, 10);
  }
  if (ABS_DAY_RE.test(targetDate)) {
    return targetDate;
  }
  return targetDate;
}

/**
 * Format target date for display; the format conveys granularity.
 * "2026" (year), "2026-06" (month), "2026-W20" (week), "2026-05-05" (day)
 */
export function formatTargetDateDisplay(dateStr: string): string {
  const g = detectGranularity(dateStr);
  return `${dateStr} (${g})`;
}

/**
 * Validate that a string is a recognized absolute date format.
 */
export function isValidDateFormat(dateStr: string): boolean {
  return ABS_YEAR_RE.test(dateStr) ||
    ABS_MONTH_RE.test(dateStr) ||
    ABS_WEEK_RE.test(dateStr) ||
    ABS_DAY_RE.test(dateStr);
}

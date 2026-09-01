/**
 * Parse and convert date strings with granularity support.
 * Supports: YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, YYYY-MM-DDTHH (absolute)
 * and +Nh, +Nd, +Nw, +Nm, +Ny (relative).
 * Hour-granularity strings are always UTC.
 */

export type DateGranularity = 'year' | 'month' | 'week' | 'day' | 'hour';

const RELATIVE_DATE_RE = /^\+(\d+)(h|d|w|m|y)$/;
const ABS_YEAR_RE = /^\d{4}$/;
const ABS_MONTH_RE = /^\d{4}-\d{2}$/;
const ABS_WEEK_RE = /^\d{4}-W\d{2}$/;
const ABS_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ABS_HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

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
      if (u === 'h') return 'hour';
    }
  }
  if (ABS_YEAR_RE.test(dateStr)) return 'year';
  if (ABS_MONTH_RE.test(dateStr)) return 'month';
  if (ABS_WEEK_RE.test(dateStr)) return 'week';
  if (ABS_DAY_RE.test(dateStr)) return 'day';
  if (ABS_HOUR_RE.test(dateStr)) return 'hour';
  return 'day';
}

/**
 * Convert relative date to granularity-appropriate absolute format.
 * +1y -> "2027", +3m -> "2026-05", +2w -> "2026-W09", +14d -> "2026-03-01",
 * +6h -> "2026-03-01T14" (UTC hour)
 */
export function toAbsoluteDate(dateStr: string, baseDate: Date = new Date()): string {
  if (!isRelativeDate(dateStr)) return dateStr;

  const match = dateStr.match(RELATIVE_DATE_RE);
  if (!match) return dateStr;

  const amount = parseInt(match[1], 10);
  const unit = match[2] as 'h' | 'd' | 'w' | 'm' | 'y';
  const d = new Date(baseDate);

  // All UTC. The result is read back through toISOString, which is UTC, so
  // doing the arithmetic with the local setters made the answer depend on
  // the host's timezone: on TZ=America/New_York a base of 2026-03-08T00:30Z
  // is still 7 March locally, and +7d named 14 March instead of 15.
  switch (unit) {
    case 'h':
      d.setUTCHours(d.getUTCHours() + amount);
      return d.toISOString().slice(0, 13);
    case 'd':
      d.setUTCDate(d.getUTCDate() + amount);
      return d.toISOString().slice(0, 10);
    case 'w': {
      d.setUTCDate(d.getUTCDate() + amount * 7);
      return toISOWeekString(d);
    }
    case 'm': {
      // From the FIRST of the month, so adding months cannot overflow. Asking
      // for 31 September rolls to 1 October, so on the 31st `+1m` skipped a
      // month and `+1m` and `+2m` collided on the one after; the skipped
      // month's untraded market was then voided by refreshMarkets and never
      // re-opened (bug hunt 2026-08-31). The day is not part of the answer -
      // this returns YYYY-MM - so clamping it costs nothing.
      const firstOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() + amount);
      return `${firstOfMonth.getUTCFullYear()}-${String(firstOfMonth.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    case 'y': {
      // Same reasoning, and it also keeps 29 February from becoming 1 March.
      const firstOfYear = new Date(Date.UTC(d.getUTCFullYear() + amount, 0, 1));
      return String(firstOfYear.getUTCFullYear());
    }
    default:
      return dateStr;
  }
}

/** Get ISO week string YYYY-Www for a date */
export function toISOWeekString(d: Date): string {
  // The standard ISO-8601 rule, in UTC, on the date alone.
  //
  // The previous implementation mixed local getDate()/getDay() with a UTC
  // instant and then rounded a fractional day count, so the answer depended
  // on the time of day: any afternoon late in the week rounded up a day and
  // landed in the next week. On Sunday 2026-08-16 it returned W34 for a date
  // that is W33, which is how LookPilot's "revenue this week" market ended up
  // targeting W35, a week that starts eight days out (owner report
  // 2026-08-16).
  //
  // ISO defines the week by its THURSDAY: the year of that Thursday is the
  // week-numbering year, and week 1 is the one containing 4 January. Deriving
  // it that way removes the year-boundary special cases entirely.
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (day.getUTCDay() + 6) % 7; // Mon = 0 ... Sun = 6
  day.setUTCDate(day.getUTCDate() - dayNum + 3); // the Thursday of this week
  const isoYear = day.getUTCFullYear();

  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Num = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() - jan4Num + 3);

  const week = 1 + Math.round((day.getTime() - week1Thursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Return the last YYYY-MM-DD of the period.
 * "2026" -> "2026-12-31", "2026-05" -> "2026-05-31",
 * "2026-W07" -> Sunday of that ISO week, "2026-05-05" -> "2026-05-05",
 * "2026-05-05T14" -> "2026-05-05" (an hour period ends within its own day).
 * Date-only resolution; for exact comparisons use `periodEndInstant`.
 */
export function endOfPeriod(targetDate: string): string {
  if (ABS_HOUR_RE.test(targetDate)) {
    return targetDate.slice(0, 10);
  }
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
    // Use UTC throughout to avoid local-timezone day shifts
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
    const sunday = new Date(mon);
    sunday.setUTCDate(mon.getUTCDate() + (week - 1) * 7 + 6);
    return sunday.toISOString().slice(0, 10);
  }
  if (ABS_DAY_RE.test(targetDate)) {
    return targetDate;
  }
  return targetDate;
}

/**
 * The exclusive end of a target-date period as an exact UTC instant: the first
 * moment that is no longer inside the period. "2026-06" -> 2026-07-01T00:00Z,
 * "2026-05-05" -> 2026-05-06T00:00Z, "2026-05-05T14" -> 2026-05-05T15:00Z.
 *
 * This is the canonical comparison point for "has this period fully passed":
 * a market is resolvable, and a custom horizon expired, once
 * `periodEndInstant(targetDate) <= now`.
 */
export function periodEndInstant(targetDate: string): Date {
  if (ABS_HOUR_RE.test(targetDate)) {
    const d = new Date(`${targetDate}:00:00.000Z`);
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  const d = new Date(`${endOfPeriod(targetDate)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * The inclusive start of a target-date period as an exact UTC instant: the
 * first moment inside it. "2026-06" -> 2026-06-01T00:00Z, "2026-W34" ->
 * the Monday of ISO week 34, "2026" -> 2026-01-01T00:00Z.
 *
 * The pair to periodEndInstant, and the answer to "does this reading belong
 * to the period this market settles on?". A metric that resets every Monday
 * accumulates a fresh number each week, so last week's readings are not this
 * market's actual-so-far; plotting them made a week that had not started yet
 * look like it was already at $887 and heading down to $213 (owner report
 * 2026-08-16).
 */
export function periodStartInstant(targetDate: string): Date {
  if (ABS_HOUR_RE.test(targetDate)) return new Date(`${targetDate}:00:00.000Z`);
  if (ABS_YEAR_RE.test(targetDate)) return new Date(`${targetDate}-01-01T00:00:00.000Z`);
  if (ABS_MONTH_RE.test(targetDate)) return new Date(`${targetDate}-01T00:00:00.000Z`);
  if (ABS_WEEK_RE.test(targetDate)) {
    // The Monday of that ISO week, by the same construction endOfPeriod uses
    // for its Sunday, in UTC so no local timezone can shift the day.
    const [yStr, wStr] = targetDate.split('-W');
    const jan4 = new Date(Date.UTC(parseInt(yStr, 10), 0, 4));
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (parseInt(wStr, 10) - 1) * 7);
    return mon;
  }
  if (ABS_DAY_RE.test(targetDate)) return new Date(`${targetDate}T00:00:00.000Z`);
  // Unknown shape: the epoch, so a caller filtering by window keeps
  // everything rather than silently dropping a metric's whole history.
  return new Date(0);
}

/**
 * The exact UTC instant a market settles, as an ISO timestamp.
 *
 * Resolution runs hourly at minute 0 (the `0 * * * *` scheduler calling
 * POST /api/cron/resolve). A market is settled on the first run where its
 * period has fully passed — i.e. the run at `periodEndInstant`. So "2026-06"
 * (period ends 2026-06-30) settles at "2026-07-01T00:00:00Z"; "2026" at
 * "2027-01-01T00:00:00Z"; "2026-05-05T14" at "2026-05-05T15:00:00Z".
 *
 * This is the agent-facing `resolvesOn` value: a single, unambiguous moment,
 * not the coarse `targetDate` period label.
 */
export function resolutionInstant(targetDate: string): string {
  return `${periodEndInstant(targetDate).toISOString().slice(0, 19)}Z`;
}

/**
 * Validate that a string is a recognized absolute date format.
 */
export function isValidDateFormat(dateStr: string): boolean {
  return (
    ABS_YEAR_RE.test(dateStr) ||
    ABS_MONTH_RE.test(dateStr) ||
    ABS_WEEK_RE.test(dateStr) ||
    ABS_DAY_RE.test(dateStr) ||
    ABS_HOUR_RE.test(dateStr)
  );
}

/**
 * Number of ISO weeks in a year: 53 iff the year starts on a Thursday, or is a
 * leap year starting on a Wednesday; 52 otherwise.
 *
 * Stated as arithmetic rather than by probing 28 December, because that probe
 * only works if the Date is built in the same clock toISOWeekString reads.
 * It was built in local time against UTC getters, so east of Greenwich the
 * probe landed on 27 December, week 52, and "2026-W53" - a real week a market
 * can target - failed validation.
 */
function isoWeeksInYear(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay(); // Sun = 0
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (isLeap && jan1 === 3) ? 53 : 52;
}

/**
 * Calendar-aware validation on top of the format regexes. Rejects strings that
 * match a format but name an impossible date: "2026-13", "2026-02-31", "2026-W60".
 * Used for user-authored config (custom market horizons); `isValidDateFormat`
 * stays format-only for existing callers.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (ABS_YEAR_RE.test(dateStr)) return true;
  if (ABS_MONTH_RE.test(dateStr)) {
    const m = parseInt(dateStr.slice(5, 7), 10);
    return m >= 1 && m <= 12;
  }
  if (ABS_WEEK_RE.test(dateStr)) {
    const [yStr, wStr] = dateStr.split('-W');
    const w = parseInt(wStr, 10);
    return w >= 1 && w <= isoWeeksInYear(parseInt(yStr, 10));
  }
  if (ABS_DAY_RE.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1) return false;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= daysInMonth;
  }
  if (ABS_HOUR_RE.test(dateStr)) {
    const hour = parseInt(dateStr.slice(11, 13), 10);
    return hour <= 23 && isValidCalendarDate(dateStr.slice(0, 10));
  }
  return false;
}

/**
 * When a market settles, which since 2026-08-31 is not the same as when its
 * period ends (owner ask: "shouldn't settlement dates be actually after the
 * range for that given market passes").
 *
 * A market stamps `settlesAt` when it opens: the end of its period plus the
 * metric's reporting lag. Stored rather than derived, so changing a metric's
 * lag never moves the settlement of a market people are already trading, and
 * so this function is total for markets opened before the column existed,
 * which settle at their period end exactly as they always did.
 *
 * The FIXING is unaffected: a market still settles on the last reading at or
 * before its PERIOD END. The lag buys the owner time to report that reading,
 * with `asOf` to date it into the period it measures; it never changes which
 * period is being priced.
 */
export function settlesOn(market: { targetDate: string; settlesAt?: Date | string | null }): string {
  if (market.settlesAt) {
    const d = market.settlesAt instanceof Date ? market.settlesAt : new Date(market.settlesAt);
    if (!Number.isNaN(d.getTime())) return `${d.toISOString().slice(0, 19)}Z`;
  }
  return resolutionInstant(market.targetDate);
}

/** The instant a market opened now would settle: the period end plus the
 *  metric's lag. What `markets.settles_at` is stamped with. */
export function settlementInstantFor(targetDate: string, lagMinutes: number): Date {
  const end = periodEndInstant(targetDate);
  if (!Number.isFinite(lagMinutes) || lagMinutes <= 0) return end;
  return new Date(end.getTime() + lagMinutes * 60_000);
}

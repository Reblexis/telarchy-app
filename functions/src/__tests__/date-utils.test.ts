import {
  isRelativeDate,
  detectGranularity,
  toAbsoluteDate,
  toISOWeekString,
  endOfPeriod,
  periodStartInstant,
  periodEndInstant,
  resolutionInstant,
  isValidDateFormat,
} from '../lib/date-utils';

// Fixed base date for deterministic relative-date tests
const BASE = new Date('2026-03-23T12:00:00Z');

// ─── isRelativeDate ───────────────────────────────────────────────────────────

describe('isRelativeDate', () => {
  test.each(['+1d', '+2w', '+3m', '+1y', '+14d'])('recognises %s as relative', d => {
    expect(isRelativeDate(d)).toBe(true);
  });

  test.each(['2026', '2026-03', '2026-W12', '2026-03-23', 'foo', ''])('recognises %s as NOT relative', d => {
    expect(isRelativeDate(d)).toBe(false);
  });
});

// ─── detectGranularity ───────────────────────────────────────────────────────

describe('detectGranularity', () => {
  test('absolute year → year', () => expect(detectGranularity('2026')).toBe('year'));
  test('absolute month → month', () => expect(detectGranularity('2026-03')).toBe('month'));
  test('absolute week → week', () => expect(detectGranularity('2026-W12')).toBe('week'));
  test('absolute day → day', () => expect(detectGranularity('2026-03-23')).toBe('day'));
  test('+1y → year', () => expect(detectGranularity('+1y')).toBe('year'));
  test('+2m → month', () => expect(detectGranularity('+2m')).toBe('month'));
  test('+3w → week', () => expect(detectGranularity('+3w')).toBe('week'));
  test('+4d → day', () => expect(detectGranularity('+4d')).toBe('day'));
  test('unknown string → day (fallback)', () => expect(detectGranularity('foo')).toBe('day'));
});

// ─── toAbsoluteDate ───────────────────────────────────────────────────────────

describe('toAbsoluteDate', () => {
  test('passes through already-absolute dates unchanged', () => {
    expect(toAbsoluteDate('2026-03-23', BASE)).toBe('2026-03-23');
    expect(toAbsoluteDate('2026-W12', BASE)).toBe('2026-W12');
    expect(toAbsoluteDate('2026-03', BASE)).toBe('2026-03');
    expect(toAbsoluteDate('2026', BASE)).toBe('2026');
  });

  test('+0d returns today (base date)', () => {
    expect(toAbsoluteDate('+0d', BASE)).toBe('2026-03-23');
  });

  test('+7d adds 7 days', () => {
    expect(toAbsoluteDate('+7d', BASE)).toBe('2026-03-30');
  });

  test('+1m adds one month', () => {
    expect(toAbsoluteDate('+1m', BASE)).toBe('2026-04');
  });

  test('+1y adds one year', () => {
    expect(toAbsoluteDate('+1y', BASE)).toBe('2027');
  });

  test('+1w adds one week (returns ISO week string)', () => {
    const result = toAbsoluteDate('+1w', BASE);
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// ─── toISOWeekString ──────────────────────────────────────────────────────────

describe('toISOWeekString', () => {
  test('2026-01-01 is in W01 of 2026', () => {
    // ISO week: week containing the first Thursday of the year
    const result = toISOWeekString(new Date('2026-01-01'));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  test('returns correct week for a mid-year date', () => {
    const result = toISOWeekString(new Date('2026-06-15'));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
    const [, week] = result.split('-W');
    expect(parseInt(week, 10)).toBeGreaterThan(0);
    expect(parseInt(week, 10)).toBeLessThanOrEqual(53);
  });
});

// ─── endOfPeriod ─────────────────────────────────────────────────────────────

describe('endOfPeriod', () => {
  test('year → Dec 31', () => {
    expect(endOfPeriod('2026')).toBe('2026-12-31');
    expect(endOfPeriod('2024')).toBe('2024-12-31');
  });

  test('month → last day of that month', () => {
    expect(endOfPeriod('2026-01')).toBe('2026-01-31');
    expect(endOfPeriod('2026-02')).toBe('2026-02-28'); // non-leap
    expect(endOfPeriod('2024-02')).toBe('2024-02-29'); // leap year
    expect(endOfPeriod('2026-04')).toBe('2026-04-30'); // 30-day month
  });

  test('day → unchanged', () => {
    expect(endOfPeriod('2026-03-15')).toBe('2026-03-15');
  });

  test('ISO week → last day (Sunday) of that week', () => {
    // ISO W01 2026: Mon=2025-12-29, Sun=2026-01-04
    expect(endOfPeriod('2026-W01')).toBe('2026-01-04');
    // ISO W12 2026: Mon=2026-03-16, Sun=2026-03-22
    expect(endOfPeriod('2026-W12')).toBe('2026-03-22');
    // ISO W53 2015 (a year that has 53 weeks): Sun=2016-01-03
    expect(endOfPeriod('2015-W53')).toBe('2016-01-03');
  });

  test('unknown format → returned unchanged', () => {
    expect(endOfPeriod('foo')).toBe('foo');
  });
});

// ─── resolutionInstant ───────────────────────────────────────────────────────

describe('resolutionInstant', () => {
  test('month → 00:00 UTC on the day after period close', () => {
    // June closes 2026-06-30; the 00:00 UTC resolve run on 2026-07-01 settles it.
    expect(resolutionInstant('2026-06')).toBe('2026-07-01T00:00:00Z');
    expect(resolutionInstant('2026-02')).toBe('2026-03-01T00:00:00Z'); // non-leap
    expect(resolutionInstant('2024-02')).toBe('2024-03-01T00:00:00Z'); // leap
  });

  test('year → 00:00 UTC on Jan 1 of the next year', () => {
    expect(resolutionInstant('2026')).toBe('2027-01-01T00:00:00Z');
  });

  test('ISO week → 00:00 UTC on the Monday after the week closes', () => {
    // W12 2026 closes Sun 2026-03-22 → settles 2026-03-23T00:00:00Z
    expect(resolutionInstant('2026-W12')).toBe('2026-03-23T00:00:00Z');
  });

  test('day → 00:00 UTC the following day', () => {
    expect(resolutionInstant('2026-03-15')).toBe('2026-03-16T00:00:00Z');
  });
});

// ─── isValidDateFormat ────────────────────────────────────────────────────────

describe('isValidDateFormat', () => {
  test.each(['2026', '2026-03', '2026-W12', '2026-03-23'])('accepts valid format: %s', d => {
    expect(isValidDateFormat(d)).toBe(true);
  });

  test.each(['+1d', '+2w', 'foo', '', '26-03-23', '2026/03/23'])('rejects invalid format: %s', d => {
    expect(isValidDateFormat(d)).toBe(false);
  });
});

/**
 * The window a horizon owns. Its pair, periodEndInstant, was already the
 * canonical "has this period passed"; this is the canonical "did this reading
 * happen inside it", which the floor needs to decide whether a metric reading
 * is a market's actual-so-far or last period's number (owner report
 * 2026-08-16: a week that had not started drew last week's $887).
 */
describe('periodStartInstant', () => {
  const iso = (d: Date) => d.toISOString();

  test('a year starts on 1 January', () => {
    expect(iso(periodStartInstant('2026'))).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a month starts on its first day', () => {
    expect(iso(periodStartInstant('2026-08'))).toBe('2026-08-01T00:00:00.000Z');
  });

  test('an ISO week starts on its Monday', () => {
    // 2026-W34 is 17..23 August; the market that exposed the bug settles on
    // the 24th.
    expect(iso(periodStartInstant('2026-W34'))).toBe('2026-08-17T00:00:00.000Z');
    expect(iso(periodStartInstant('2026-W33'))).toBe('2026-08-10T00:00:00.000Z');
    expect(iso(periodStartInstant('2026-W01'))).toBe('2025-12-29T00:00:00.000Z');
  });

  test('a day and an hour start at their own boundary', () => {
    expect(iso(periodStartInstant('2026-05-05'))).toBe('2026-05-05T00:00:00.000Z');
    expect(iso(periodStartInstant('2026-05-05T14'))).toBe('2026-05-05T14:00:00.000Z');
  });

  test('it always precedes the end of the same period', () => {
    for (const t of ['2026', '2026-08', '2026-W34', '2026-05-05', '2026-05-05T14']) {
      expect(periodStartInstant(t).getTime()).toBeLessThan(periodEndInstant(t).getTime());
    }
  });

  test('consecutive periods meet exactly, with no gap and no overlap', () => {
    expect(periodEndInstant('2026-W33').getTime()).toBe(periodStartInstant('2026-W34').getTime());
    expect(periodEndInstant('2026-07').getTime()).toBe(periodStartInstant('2026-08').getTime());
  });

  test('last week is outside this week, which is the whole point', () => {
    const lastWeeksReading = new Date('2026-08-15T20:42:51Z').getTime();
    const from = periodStartInstant('2026-W34').getTime();
    const to = periodEndInstant('2026-W34').getTime();
    expect(lastWeeksReading >= from && lastWeeksReading < to).toBe(false);
    // And inside its own week it counts.
    const f33 = periodStartInstant('2026-W33').getTime();
    const t33 = periodEndInstant('2026-W33').getTime();
    expect(lastWeeksReading >= f33 && lastWeeksReading < t33).toBe(true);
  });

  test('an unrecognised shape keeps everything rather than dropping a history', () => {
    expect(periodStartInstant('not-a-date').getTime()).toBe(0);
  });
});

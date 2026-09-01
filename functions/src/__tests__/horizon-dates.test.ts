/**
 * THE RULES a rolling horizon has to keep.
 *
 * 1. `+1m` from any day names NEXT month. `Date.setMonth` overflows: asking
 *    for 31 September rolls to 1 October, so on the 31st `+1m` skipped a
 *    month entirely and `+1m` and `+2m` collided on one. `refreshMarkets`
 *    VOIDS an untraded market at a no-longer-desired date, so the skipped
 *    month's market was destroyed and never re-opened, and a two-horizon
 *    metric silently lost one of its markets (bug hunt 2026-08-31).
 *
 * 2. An offset a Date cannot represent is refused at the door. `+99999999d`
 *    matched the format, was stored, and then threw RangeError inside
 *    `toAbsoluteDate` on every later read: `GET /api/metrics` and the floor
 *    died for that workspace, INCLUDING the page that would let the owner
 *    clear the horizon. `+9999999y` is the sibling that returns the literal
 *    string "NaN" as a target date.
 *
 * 3. The arithmetic is UTC. `setDate`/`setMonth` are local and the result is
 *    read back through `toISOString`, so on a non-UTC host the same base
 *    date could name a different day.
 */

import { toAbsoluteDate } from '../lib/date-utils';
import { desiredMarketDates } from '../lib/time-preference';
import { parseTimePreference } from '../routes/metrics';

const at = (iso: string) => new Date(iso);

describe('a monthly horizon never skips a month', () => {
  test('+1m from a 31st names the next month, not the one after', () => {
    expect(toAbsoluteDate('+1m', at('2026-08-31T12:00:00Z'))).toBe('2026-09');
    expect(toAbsoluteDate('+1m', at('2026-01-31T12:00:00Z'))).toBe('2026-02');
    expect(toAbsoluteDate('+1m', at('2026-03-31T12:00:00Z'))).toBe('2026-04');
    expect(toAbsoluteDate('+1m', at('2026-05-31T12:00:00Z'))).toBe('2026-06');
    expect(toAbsoluteDate('+1m', at('2026-10-31T12:00:00Z'))).toBe('2026-11');
  });

  test('+1m and +2m never name the same month', () => {
    for (const base of ['2026-01-31', '2026-03-31', '2026-05-31', '2026-08-31', '2026-10-31', '2026-02-28']) {
      const one = toAbsoluteDate('+1m', at(`${base}T12:00:00Z`));
      const two = toAbsoluteDate('+2m', at(`${base}T12:00:00Z`));
      expect(one).not.toBe(two);
    }
  });

  test('every day of a month agrees on what +1m is', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 31; day++) {
      seen.add(toAbsoluteDate('+1m', at(`2026-08-${String(day).padStart(2, '0')}T12:00:00Z`)));
    }
    expect([...seen]).toEqual(['2026-09']);
  });

  test('a rolling monthly horizon does not lose September on the 31st', () => {
    expect(
      desiredMarketDates({ enabled: false, halfLife: 1, customHorizons: ['+1m'] } as never, at('2026-08-30T12:00:00Z')),
    ).toEqual(['2026-09']);
    expect(
      desiredMarketDates({ enabled: false, halfLife: 1, customHorizons: ['+1m'] } as never, at('2026-08-31T12:00:00Z')),
    ).toEqual(['2026-09']);
  });

  test('+0m is still this month and +12m is still a year out', () => {
    expect(toAbsoluteDate('+0m', at('2026-08-31T12:00:00Z'))).toBe('2026-08');
    expect(toAbsoluteDate('+12m', at('2026-08-31T12:00:00Z'))).toBe('2027-08');
  });
});

describe('an offset that cannot be represented is refused, not stored', () => {
  const tp = (entry: string) => parseTimePreference({ enabled: false, halfLife: 1, customHorizons: [entry] });

  test('a day offset past the Date range is rejected', () => {
    expect(tp('+99999999d')).toBeInstanceOf(Error);
  });

  test('a year offset past the Date range is rejected', () => {
    expect(tp('+9999999y')).toBeInstanceOf(Error);
  });

  test('ordinary offsets are still accepted', () => {
    for (const e of ['+0d', '+1d', '+7d', '+1w', '+0m', '+1m', '+12m', '+1y']) {
      expect(tp(e)).not.toBeInstanceOf(Error);
    }
  });

  test('a stored horizon can always be resolved without throwing', () => {
    // The property that matters: whatever survives validation must never
    // take the metrics endpoint down later.
    for (const e of ['+0h', '+23h', '+0d', '+365d', '+52w', '+120m', '+10y']) {
      const parsed = tp(e);
      if (parsed instanceof Error) continue;
      expect(() => toAbsoluteDate(e, at('2026-08-31T12:00:00Z'))).not.toThrow();
      expect(toAbsoluteDate(e, at('2026-08-31T12:00:00Z'))).not.toContain('NaN');
    }
  });
});

describe('the arithmetic is UTC, not the host timezone', () => {
  test('a day offset lands on the same UTC day whatever TZ the host is in', () => {
    // 19:30 New York on 7 March is 00:30 UTC on 8 March; +7d is 15 March UTC.
    expect(toAbsoluteDate('+7d', at('2026-03-08T00:30:00Z'))).toBe('2026-03-15');
  });

  test('an hour offset is already UTC and stays that way', () => {
    expect(toAbsoluteDate('+1h', at('2026-08-31T23:10:00Z'))).toBe('2026-09-01T00');
  });
});

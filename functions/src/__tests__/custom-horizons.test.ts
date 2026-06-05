/**
 * Unit tests for custom market horizons: per-metric extra market dates beyond
 * the exponential time-preference curve. Relative entries ("+3m") are rolling
 * (re-resolved against "today"); absolute entries are one-shot.
 */

// parseTimePreference lives in the routes module, which pulls in the db client;
// stub it so this stays a pure unit test.
jest.mock('../db/client', () => ({ db: {} }));

import {
  resolveCustomHorizons, desiredMarketDates, generatesMarkets, sampleTimePoints,
} from '../lib/time-preference';
import { isValidCalendarDate, toAbsoluteDate, endOfPeriod, periodEndInstant, resolutionInstant } from '../lib/date-utils';
import { parseTimePreference } from '../routes/metrics';
import { enrichMetrics } from '../services/metrics';
import type { Metric, TimePreference } from '../types';

const BASE = new Date(Date.UTC(2026, 4, 13)); // 2026-05-13

describe('isValidCalendarDate', () => {
  test('accepts all four absolute formats', () => {
    expect(isValidCalendarDate('2026')).toBe(true);
    expect(isValidCalendarDate('2026-09')).toBe(true);
    expect(isValidCalendarDate('2026-W40')).toBe(true);
    expect(isValidCalendarDate('2026-09-15')).toBe(true);
  });
  test('accepts leap day in a leap year', () => {
    expect(isValidCalendarDate('2028-02-29')).toBe(true);
  });
  test('rejects impossible dates that pass the format regexes', () => {
    expect(isValidCalendarDate('2026-13')).toBe(false);
    expect(isValidCalendarDate('2026-00')).toBe(false);
    expect(isValidCalendarDate('2026-02-31')).toBe(false);
    expect(isValidCalendarDate('2027-02-29')).toBe(false); // not a leap year
    expect(isValidCalendarDate('2026-W60')).toBe(false);
    expect(isValidCalendarDate('2026-W00')).toBe(false);
  });
  test('ISO week 53 only in 53-week years', () => {
    expect(isValidCalendarDate('2026-W53')).toBe(true); // 2026 starts on a Thursday
    expect(isValidCalendarDate('2025-W53')).toBe(false);
  });
  test('rejects garbage and relative entries', () => {
    expect(isValidCalendarDate('garbage')).toBe(false);
    expect(isValidCalendarDate('+3m')).toBe(false);
  });
  test('hour format: valid hours on valid days only', () => {
    expect(isValidCalendarDate('2026-09-15T14')).toBe(true);
    expect(isValidCalendarDate('2026-09-15T00')).toBe(true);
    expect(isValidCalendarDate('2026-09-15T23')).toBe(true);
    expect(isValidCalendarDate('2026-09-15T24')).toBe(false);
    expect(isValidCalendarDate('2026-02-31T10')).toBe(false);
  });
});

describe('periodEndInstant / resolutionInstant', () => {
  test('exclusive period ends for every granularity', () => {
    expect(periodEndInstant('2026').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(periodEndInstant('2026-06').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(periodEndInstant('2026-05-05').toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(periodEndInstant('2026-05-05T14').toISOString()).toBe('2026-05-05T15:00:00.000Z');
  });
  test('week period ends Monday midnight after its Sunday', () => {
    // 2026-W20: Mon 2026-05-11 .. Sun 2026-05-17
    expect(endOfPeriod('2026-W20')).toBe('2026-05-17');
    expect(periodEndInstant('2026-W20').toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });
  test('resolutionInstant matches periodEndInstant for all formats', () => {
    for (const d of ['2026', '2026-06', '2026-W20', '2026-05-05', '2026-05-05T14']) {
      expect(resolutionInstant(d)).toBe(`${periodEndInstant(d).toISOString().slice(0, 19)}Z`);
    }
    expect(resolutionInstant('2026-05-05T14')).toBe('2026-05-05T15:00:00Z');
  });
  test('endOfPeriod of an hour string is its own day', () => {
    expect(endOfPeriod('2026-05-05T14')).toBe('2026-05-05');
  });
});

describe('resolveCustomHorizons', () => {
  test('relative entries resolve against the base date at their granularity', () => {
    expect(resolveCustomHorizons(['+2w'], BASE)).toEqual([toAbsoluteDate('+2w', BASE)]);
    expect(resolveCustomHorizons(['+3m'], BASE)).toEqual(['2026-08']);
    expect(resolveCustomHorizons(['+1y'], BASE)).toEqual(['2027']);
  });
  test('relative entries roll: a later base resolves to a later date', () => {
    const later = new Date(Date.UTC(2026, 5, 13)); // one month after BASE
    expect(resolveCustomHorizons(['+1m'], BASE)).toEqual(['2026-06']);
    expect(resolveCustomHorizons(['+1m'], later)).toEqual(['2026-07']);
  });
  test('fully-passed periods are dropped; still-open ones are kept', () => {
    expect(resolveCustomHorizons(['2020-01'], BASE)).toEqual([]);
    expect(resolveCustomHorizons(['2026-05-12'], BASE)).toEqual([]); // period ended at BASE midnight
    // Same-day entry: period runs until the next midnight, so it is tradeable.
    expect(resolveCustomHorizons(['2026-05-13'], BASE)).toEqual(['2026-05-13']);
    expect(resolveCustomHorizons(['2026-05-14'], BASE)).toEqual(['2026-05-14']);
  });
  test('hour entries: +Nh rolls in UTC hours, past hours are dropped', () => {
    expect(resolveCustomHorizons(['+2h'], BASE)).toEqual(['2026-05-13T02']);
    expect(resolveCustomHorizons(['2026-05-12T23'], BASE)).toEqual([]); // ended at BASE
    expect(resolveCustomHorizons(['2026-05-13T00'], BASE)).toEqual(['2026-05-13T00']); // current hour, still open
  });
  test('dedupes entries that resolve to the same date', () => {
    expect(resolveCustomHorizons(['+1m', '2026-06'], BASE)).toEqual(['2026-06']);
  });
  test('tolerates malformed historical jsonb', () => {
    expect(resolveCustomHorizons(undefined, BASE)).toEqual([]);
    expect(resolveCustomHorizons(null, BASE)).toEqual([]);
    expect(resolveCustomHorizons('not-an-array', BASE)).toEqual([]);
    expect(resolveCustomHorizons([42, null, '  ', '2099-01'], BASE)).toEqual(['2099-01']);
  });
});

describe('desiredMarketDates', () => {
  test('custom-only config (curve disabled) yields exactly the custom dates', () => {
    const tp: TimePreference = { enabled: false, halfLife: 1, customHorizons: ['+2w', '2099-12-31'] };
    expect(desiredMarketDates(tp, BASE)).toEqual(
      expect.arrayContaining([toAbsoluteDate('+2w', BASE), '2099-12-31']),
    );
    expect(desiredMarketDates(tp, BASE)).toHaveLength(2);
  });
  test('curve and custom dates union without duplicates', () => {
    const curveDates = sampleTimePoints(1, 3, BASE).map(p => p.date);
    const tp: TimePreference = { enabled: true, halfLife: 1, density: 3, customHorizons: [curveDates[0], '2099-12-31'] };
    const desired = desiredMarketDates(tp, BASE);
    expect(desired).toHaveLength(curveDates.length + 1);
    expect(desired).toEqual(expect.arrayContaining([...curveDates, '2099-12-31']));
  });
  test('sorted chronologically by period end', () => {
    const tp: TimePreference = { enabled: true, halfLife: 1, density: 3, customHorizons: ['2099-12-31', '+1w'] };
    const desired = desiredMarketDates(tp, BASE);
    const ends = desired.map(endOfPeriod);
    expect([...ends].sort()).toEqual(ends);
    expect(desired[desired.length - 1]).toBe('2099-12-31');
  });
});

describe('generatesMarkets', () => {
  test('false for null/undefined and disabled curve without horizons', () => {
    expect(generatesMarkets(null, BASE)).toBe(false);
    expect(generatesMarkets(undefined, BASE)).toBe(false);
    expect(generatesMarkets({ enabled: false, halfLife: 1 }, BASE)).toBe(false);
  });
  test('true for an enabled curve', () => {
    expect(generatesMarkets({ enabled: true, halfLife: 1 }, BASE)).toBe(true);
  });
  test('true for effective custom horizons, false when all are expired', () => {
    expect(generatesMarkets({ enabled: false, halfLife: 1, customHorizons: ['2099-01'] }, BASE)).toBe(true);
    expect(generatesMarkets({ enabled: false, halfLife: 1, customHorizons: ['2020-01'] }, BASE)).toBe(false);
  });
});

describe('parseTimePreference (custom horizons)', () => {
  test('undefined means absent, null means explicit clear', () => {
    expect(parseTimePreference(undefined)).toBeUndefined();
    expect(parseTimePreference(null)).toBeNull();
  });
  test('accepts valid mixed entries, trims and dedupes', () => {
    const tp = parseTimePreference({ enabled: false, customHorizons: [' +3m ', '+3m', '2099-12-31'] });
    expect(tp).not.toBeInstanceOf(Error);
    expect((tp as TimePreference).customHorizons).toEqual(['+3m', '2099-12-31']);
  });
  test('prunes expired absolute entries instead of rejecting', () => {
    const tp = parseTimePreference({ enabled: false, customHorizons: ['2020-01', '2099-01'] });
    expect((tp as TimePreference).customHorizons).toEqual(['2099-01']);
  });
  test('a config left with only expired entries has no customHorizons', () => {
    const tp = parseTimePreference({ enabled: true, halfLife: 1, customHorizons: ['2020-01'] });
    expect((tp as TimePreference).customHorizons).toBeUndefined();
  });
  test('rejects bad formats, zero offsets and non-string entries', () => {
    expect(parseTimePreference({ enabled: false, customHorizons: ['garbage'] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: ['2026-02-31'] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: ['+0d'] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: ['+0h'] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: ['2099-01-01T24'] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: [42] })).toBeInstanceOf(Error);
    expect(parseTimePreference({ enabled: false, customHorizons: 'not-array' })).toBeInstanceOf(Error);
  });
  test('accepts hour offsets and hour absolutes; prunes past hours', () => {
    const tp = parseTimePreference({ enabled: false, customHorizons: ['+1h', '+24h', '2099-01-01T08', '2020-01-01T08'] });
    expect(tp).not.toBeInstanceOf(Error);
    expect((tp as TimePreference).customHorizons).toEqual(['+1h', '+24h', '2099-01-01T08']);
  });
  test('caps the list at 24 entries', () => {
    const many = Array.from({ length: 25 }, (_, i) => `+${i + 1}d`);
    expect(parseTimePreference({ enabled: false, customHorizons: many })).toBeInstanceOf(Error);
    const ok = parseTimePreference({ enabled: false, customHorizons: many.slice(0, 24) });
    expect(ok).not.toBeInstanceOf(Error);
  });
});

describe('outlook with custom horizons', () => {
  const leafMetric = (name: string, tp: TimePreference): Metric => ({
    id: name, name, description: '', value: 10, total: 10,
    formula: '0', order: 1, depth: 0, timePreference: tp,
  });

  test('an untraded custom-horizon market does not null the outlook', () => {
    const tp: TimePreference = { enabled: true, halfLife: 1, density: 3, customHorizons: ['2099-12-31'] };
    const curveDates = sampleTimePoints(1, 3).map(p => p.date);
    const consensusMap = Object.fromEntries(curveDates.map(d => [`M:${d}`, 20]));
    const untraded = new Set(['M:2099-12-31']);

    const [m] = enrichMetrics([leafMetric('M', tp)], consensusMap, untraded);
    expect(m.missingMarkets).toBeUndefined();
    expect(m.total).not.toBeNull();
    expect(m.total).toBeGreaterThan(10); // curve consensus (20) pulls the outlook up
  });

  test('an untraded curve market still nulls the outlook', () => {
    const tp: TimePreference = { enabled: true, halfLife: 1, density: 3 };
    const curveDates = sampleTimePoints(1, 3).map(p => p.date);
    const untraded = new Set([`M:${curveDates[0]}`]);

    const [m] = enrichMetrics([leafMetric('M', tp)], {}, untraded);
    expect(m.missingMarkets).toEqual(['M']);
    expect(m.total).toBeNull();
  });

  test('custom-only metric exposes a time series from its horizon consensus', () => {
    const tp: TimePreference = { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] };
    const consensusMap = { 'M:2099-12-31': 42 };

    const [m] = enrichMetrics([leafMetric('M', tp)], consensusMap, new Set());
    expect(m.timeSeries).toEqual([{ date: '2099-12-31', value: 42 }]);
    expect(m.total).toBe(10); // custom horizons never feed the weighted outlook
  });
});

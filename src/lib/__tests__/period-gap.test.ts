import { describe, expect, test } from 'vitest';
import type { HorizonView } from '../floor-horizons';
import { accumulatesInPeriod, periodGapOf } from '../period-gap';

/**
 * The arithmetic under the price: booked, needed, per day.
 *
 * Written after the owner read a base rate expressed as a multiplier and said
 * he got bored and wanted to quit. The cases that matter are the ones where
 * this must NOT render, because arithmetic dressed on the wrong metric reads as
 * authoritative nonsense.
 */

const week = (values: number[], start = '2026-08-17T10:00:00Z') =>
  values.map((value, i) => ({
    at: new Date(Date.parse(start) + i * 10 * 3600_000).toISOString(),
    value,
  }));

const view = (o: Partial<HorizonView> = {}): HorizonView => ({
  marketId: 'm',
  metricId: 'x',
  metricName: 'LookPilot net this week (USD)',
  metricLabel: 'LookPilot net this week',
  unit: '$',
  targetDate: '2026-W34',
  label: 'this week',
  settleDay: '23 August 2026',
  settleShort: '23 Aug',
  resolvesOn: '2026-08-24T00:00:00Z',
  periodStart: '2026-08-17T00:00:00.000Z',
  consensus: 1180,
  probability: 0.5,
  liquidity: 2171,
  rangeMin: 0,
  rangeMax: 8000,
  metricHistory: week([0, 120, 250, 380, 488]),
  description: null,
  ...o,
});

describe('the gap to the market price', () => {
  test('says what is booked, what is missing, and what that is a day', () => {
    const g = periodGapOf(view(), new Date('2026-08-20T18:00:00Z'));
    expect(g).not.toBeNull();
    expect(g!.booked).toBe(488);
    expect(g!.needed).toBe(692);
    // 2026-08-20 18:00 to 2026-08-24 00:00 is 3.25 days, rounded up to 4.
    expect(g!.daysLeft).toBe(4);
    expect(Math.round(g!.perDay)).toBe(173);
    expect(g!.alreadyThere).toBe(false);
  });

  test('says so when the price is already beaten, instead of a negative per day', () => {
    const g = periodGapOf(view({ metricHistory: week([0, 400, 900, 1300]) }), new Date('2026-08-20T18:00:00Z'));
    expect(g!.alreadyThere).toBe(true);
    expect(g!.needed).toBe(-120);
  });

  test('rounds days UP, because a reader trades in days and not in fractions', () => {
    const g = periodGapOf(view(), new Date('2026-08-23T18:00:00Z'));
    expect(g!.daysLeft).toBe(1);
  });
});

describe('what must never render this block', () => {
  test('a level, not an accumulator: "you need 4 more traders a day" is nonsense', () => {
    // Weekly active traders: hovers, never starts at zero, falls as often as
    // it rises. Arithmetic on it would look exactly as authoritative and be
    // meaningless.
    expect(accumulatesInPeriod(week([2, 3, 2, 2, 3]))).toBe(false);
    expect(periodGapOf(view({ metricHistory: week([2, 3, 2, 2, 3]) }))).toBeNull();
  });

  test('a period we started watching late, so "booked so far" is missing its start', () => {
    expect(accumulatesInPeriod(week([900, 1000, 1100, 1200]))).toBe(false);
  });

  test('a series that falls for real', () => {
    expect(accumulatesInPeriod(week([0, 500, 900, 400]))).toBe(false);
  });

  test('a small refund does not disqualify a real accumulator', () => {
    expect(accumulatesInPeriod(week([0, 500, 900, 895, 1100]))).toBe(true);
  });

  test('too few readings to tell', () => {
    expect(accumulatesInPeriod(week([0, 500]))).toBe(false);
  });

  test('a market with no price, and a period already over', () => {
    expect(periodGapOf(view({ consensus: null }))).toBeNull();
    expect(periodGapOf(view(), new Date('2026-08-30T00:00:00Z'))).toBeNull();
  });
});

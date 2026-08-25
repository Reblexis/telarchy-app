import { describe, expect, test } from '@jest/globals';
import { compareSoonestFirst, primaryOf } from '../lib/baseline-order';

/**
 * One ordering of a floor's baseline markets (docs/ui-conventions.md, "Two
 * steppers"): soonest-first, the primary last, and a tie on the settle
 * instant between two metrics decided by metric order, never by liquidity.
 */
const m = (marketId: string, metricName: string, targetDate: string, metricOrder: number | null) => ({
  marketId,
  metricName,
  targetDate,
  metricOrder,
});

describe('compareSoonestFirst', () => {
  test('soonest first, the furthest-resolving market last', () => {
    const list = [
      m('sep', 'Revenue', '2026-09', 1),
      m('day', 'Revenue', '2026-08-25', 1),
      m('week', 'Revenue', '2026-W35', 1),
    ];
    list.sort(compareSoonestFirst);
    expect(list.map(x => x.marketId)).toEqual(['day', 'week', 'sep']);
    expect(primaryOf(list)?.marketId).toBe('sep');
  });

  test('a tie on the settle instant goes to the lower metric order', () => {
    const list = [m('rev', 'Revenue (USD)', '2026-08', 1), m('rvw', 'Reviews', '2026-08', 2)];
    list.sort(compareSoonestFirst);
    expect(primaryOf(list)?.marketId).toBe('rev');
    list.reverse().sort(compareSoonestFirst);
    expect(primaryOf(list)?.marketId).toBe('rev');
  });

  test('a day and a week ending on the same instant tie the same way', () => {
    // 2026-W35 ends Sunday 30 Aug, and so does the day 2026-08-30: identical
    // settle instants across two granularities.
    const list = [m('rvw-d', 'Reviews', '2026-08-30', 2), m('rev-w', 'Revenue', '2026-W35', 1)];
    list.sort(compareSoonestFirst);
    expect(primaryOf(list)?.marketId).toBe('rev-w');
  });

  test('without orders the earlier name wins, then the id, so the rule is total', () => {
    const list = [m('b', 'Reviews', '2026-08', null), m('a', 'Revenue', '2026-08', null)];
    list.sort(compareSoonestFirst);
    expect(primaryOf(list)?.marketId).toBe('a');
    const same = [m('y', 'Revenue', '2026-08', null), m('x', 'Revenue', '2026-08', null)];
    same.sort(compareSoonestFirst);
    expect(primaryOf(same)?.marketId).toBe('x');
    expect(compareSoonestFirst(same[0], same[0])).toBe(0);
  });
});

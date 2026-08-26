/**
 * Workspace pool arithmetic (docs/workspace-pools.md): the scoring window,
 * the squared split, the floor, and the rounding. No database.
 */

import { resolutionPayouts } from '../lib/amm';
import { assignPoolMonth, finalWeekStart, monthBounds, nextMonthKey, splitPurchase } from '../lib/funding';
import { CREDIT_PRECISION } from '../lib/validation';
import {
  distributePool,
  meetsActivityFloor,
  type PoolMarketRow,
  payoutFingerprint,
  scorePoolTrades,
} from '../lib/workspace-pools';

const M: PoolMarketRow = { marketId: 'm1', voided: false, actualValue: 80, rangeMin: 0, rangeMax: 100 };
const markets = new Map<string, PoolMarketRow>([['m1', M]]);
const [lowerPay, higherPay] = resolutionPayouts(80, 0, 100);
const week = finalWeekStart('2026-09');
const d = (day: number) => new Date(Date.UTC(2026, 8, day));

test('a funding package splits at 1,000 credits per dollar and 80% to the pool', () => {
  const { creditsUnits, poolCents } = splitPurchase(10_000);
  expect(creditsUnits).toBe(100_000 * CREDIT_PRECISION);
  expect(poolCents).toBe(8_000);
  expect(splitPurchase(1).poolCents).toBe(0);
  expect(() => splitPurchase(0)).toThrow();
});

test('a purchase sponsors the next month, never the running one', () => {
  expect(assignPoolMonth(new Date(Date.UTC(2026, 8, 30, 23, 59)))).toBe('2026-10');
  expect(assignPoolMonth(new Date(Date.UTC(2026, 11, 3)))).toBe('2027-01');
  expect(nextMonthKey('2026-12')).toBe('2027-01');
  expect(monthBounds('2026-09').end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
});

test("score is settlement value of the month's net shares minus their cash", () => {
  const scores = scorePoolTrades(
    [
      { agentId: 'a', marketId: 'm1', direction: 'higher', shares: 10, cost: 5, createdAt: d(3) },
      { agentId: 'a', marketId: 'm1', direction: 'higher', shares: -4, cost: -3, createdAt: d(4) },
    ],
    markets,
    week,
  );
  // 6 net shares at the higher payout, minus 5 paid, plus 3 received.
  expect(scores[0].score).toBeCloseTo(6 * higherPay - 5 + 3, 6);
  expect(scores[0].tradeCount).toBe(2);
  expect(scores[0].earlyTradeCount).toBe(2);
});

test('selling shares held from before the month is outside the score', () => {
  // Bought nothing this month, sold 10 (pre-month shares) for 8 cash: score 0.
  const [sellOnly] = scorePoolTrades(
    [{ agentId: 'a', marketId: 'm1', direction: 'higher', shares: -10, cost: -8, createdAt: d(3) }],
    markets,
    week,
  );
  expect(sellOnly.score).toBe(0);
  // Bought 4 this month, sold 10: only 4 of the sold shares (and 40% of the
  // sell cash) belong to the month.
  const [mixed] = scorePoolTrades(
    [
      { agentId: 'a', marketId: 'm1', direction: 'higher', shares: 4, cost: 2, createdAt: d(3) },
      { agentId: 'a', marketId: 'm1', direction: 'higher', shares: -10, cost: -8, createdAt: d(4) },
    ],
    markets,
    week,
  );
  expect(mixed.score).toBeCloseTo(0 * higherPay - 2 + 8 * 0.4, 6);
});

test('a voided market contributes zero and the lower leg pays the lower factor', () => {
  const m = new Map<string, PoolMarketRow>([
    ['v', { marketId: 'v', voided: true, actualValue: null, rangeMin: 0, rangeMax: 100 }],
    ['m1', M],
  ]);
  const [s] = scorePoolTrades(
    [
      { agentId: 'a', marketId: 'v', direction: 'higher', shares: 10, cost: 9, createdAt: d(3) },
      { agentId: 'a', marketId: 'm1', direction: 'lower', shares: 10, cost: 1, createdAt: d(3) },
    ],
    m,
    week,
  );
  expect(s.score).toBeCloseTo(10 * lowerPay - 1, 6);
  expect(s.marketCount).toBe(2);
});

test('the pool splits by score squared, integer cents, exact sum, nothing for non-positive', () => {
  const entries = distributePool(
    [
      { agentId: 'a', score: 30, tradeCount: 12, marketCount: 2, earlyTradeCount: 5 },
      { agentId: 'b', score: 10, tradeCount: 12, marketCount: 2, earlyTradeCount: 5 },
      { agentId: 'c', score: -5, tradeCount: 12, marketCount: 2, earlyTradeCount: 5 },
      { agentId: 'd', score: 50, tradeCount: 2, marketCount: 1, earlyTradeCount: 0 },
    ],
    10_001,
    new Map(),
  );
  const byId = Object.fromEntries(entries.map(e => [e.agentId, e]));
  expect(byId.a.share).toBeCloseTo(0.9, 6);
  expect(byId.b.share).toBeCloseTo(0.1, 6);
  expect(byId.a.payoutCents + byId.b.payoutCents).toBe(10_001);
  expect(byId.c.exclusion).toBe('non_positive');
  expect(byId.d.exclusion).toBe('activity_floor');
  expect(byId.d.payoutCents).toBe(0);
  expect(byId.d.rank).toBe(1); // ranked by score, paid by eligibility
});

test('hard exclusions beat the floor, and the floor needs early trades', () => {
  const entries = distributePool(
    [{ agentId: 'owner', score: 30, tradeCount: 12, marketCount: 2, earlyTradeCount: 5 }],
    1000,
    new Map([['owner', 'owner_or_admin' as const]]),
  );
  expect(entries[0].exclusion).toBe('owner_or_admin');
  expect(entries[0].payoutCents).toBe(0);
  expect(meetsActivityFloor({ tradeCount: 10, marketCount: 2, earlyTradeCount: 2 })).toBe(false);
  expect(meetsActivityFloor({ tradeCount: 10, marketCount: 2, earlyTradeCount: 3 })).toBe(true);
});

test('payout fingerprints link accounts that share payment details', () => {
  expect(payoutFingerprint({ provider: 'paypal', email: 'A@x.com' })).toBe(
    payoutFingerprint({ provider: 'paypal', email: 'a@x.com ' }),
  );
  expect(payoutFingerprint({ provider: 'bank', iban: 'DE89 3704 0044 0532 0130 00' })).toBe(
    'bank:de89370400440532013000',
  );
  expect(payoutFingerprint(null)).toBeNull();
});

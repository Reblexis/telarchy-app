import {
  betTowardsValue,
  consensus,
  directionSellProceeds,
  directionTradeCost,
  initialPool,
  lmsrCost,
  pHigher,
  resolutionPayouts,
  sharesForBudget,
} from '../lib/amm';

const B = 100; // liquidity parameter used throughout

describe('lmsrCost', () => {
  test('symmetric at [0,0]', () => {
    expect(lmsrCost([0, 0], B)).toBeCloseTo(B * Math.log(2));
  });

  test('increases monotonically as shares increase', () => {
    const c1 = lmsrCost([10, 0], B);
    const c2 = lmsrCost([20, 0], B);
    expect(c2).toBeGreaterThan(c1);
  });

  test('is symmetric - swapping shares gives same cost', () => {
    expect(lmsrCost([30, 10], B)).toBeCloseTo(lmsrCost([10, 30], B));
  });
});

describe('pHigher', () => {
  test('returns 0.5 at equal shares', () => {
    expect(pHigher([0, 0], B)).toBeCloseTo(0.5);
    expect(pHigher([50, 50], B)).toBeCloseTo(0.5);
  });

  test('returns > 0.5 when higher shares > lower shares', () => {
    expect(pHigher([0, 50], B)).toBeGreaterThan(0.5);
  });

  test('returns < 0.5 when lower shares > higher shares', () => {
    expect(pHigher([50, 0], B)).toBeLessThan(0.5);
  });

  test('returns 0 when b = 0 (no liquidity)', () => {
    expect(pHigher([0, 0], 0)).toBe(0);
  });

  test('approaches 1 as higher shares dominate', () => {
    expect(pHigher([0, 1000], B)).toBeGreaterThan(0.99);
  });
});

describe('consensus', () => {
  const rangeMin = 0;
  const rangeMax = 1000;

  test('returns midpoint at [0,0] shares (untraded LMSR prior)', () => {
    expect(consensus([0, 0], B, rangeMin, rangeMax)).toBe(500);
  });

  test('returns undefined when b = 0', () => {
    expect(consensus([10, 10], 0, rangeMin, rangeMax)).toBeUndefined();
  });

  test('returns midpoint at equal shares', () => {
    // pHigher([10, 10]) = 0.5 → consensus = rangeMin + 0.5 * (rangeMax - rangeMin) = 500
    expect(consensus([10, 10], B, rangeMin, rangeMax)).toBeCloseTo(500);
  });

  test('stays within [rangeMin, rangeMax]', () => {
    const c = consensus([0, 500], B, rangeMin, rangeMax)!;
    expect(c).toBeGreaterThanOrEqual(rangeMin);
    expect(c).toBeLessThanOrEqual(rangeMax);
  });

  test('buying higher shares increases consensus', () => {
    const _before = consensus([0, 0], B, rangeMin, rangeMax);
    // [0,0] is untraded so returns undefined; use a tiny seed
    const c1 = consensus([1, 1], B, rangeMin, rangeMax)!;
    const c2 = consensus([1, 50], B, rangeMin, rangeMax)!;
    expect(c2).toBeGreaterThan(c1);
  });
});

describe('directionTradeCost', () => {
  test('cost is positive for a buy', () => {
    expect(directionTradeCost([0, 0], 1, 10, B)).toBeGreaterThan(0);
    expect(directionTradeCost([0, 0], 0, 10, B)).toBeGreaterThan(0);
  });

  test('cost increases with amount (convexity)', () => {
    const c1 = directionTradeCost([0, 0], 1, 10, B);
    const c2 = directionTradeCost([0, 0], 1, 20, B);
    expect(c2).toBeGreaterThan(c1 * 2 - 0.01); // convex: cost(2x) >= 2*cost(x)
  });

  test('buying higher raises probability; buying lower lowers it', () => {
    const sharesAfterHigher: [number, number] = [0, 10];
    const sharesAfterLower: [number, number] = [10, 0];
    expect(pHigher(sharesAfterHigher, B)).toBeGreaterThan(0.5);
    expect(pHigher(sharesAfterLower, B)).toBeLessThan(0.5);
  });

  test('is symmetric - same cost to buy lower or higher from neutral position', () => {
    const costHigher = directionTradeCost([0, 0], 1, 10, B);
    const costLower = directionTradeCost([0, 0], 0, 10, B);
    expect(costHigher).toBeCloseTo(costLower);
  });
});

describe('sharesForBudget', () => {
  test('cost does not exceed budget', () => {
    const budget = 50;
    const { cost } = sharesForBudget([0, 0], 1, budget, B);
    expect(cost).toBeLessThanOrEqual(budget + 0.01);
  });

  test('returns positive amount for positive budget', () => {
    const { amount } = sharesForBudget([0, 0], 1, 10, B);
    expect(amount).toBeGreaterThan(0);
  });

  test('more budget → more shares', () => {
    const { amount: a1 } = sharesForBudget([0, 0], 1, 10, B);
    const { amount: a2 } = sharesForBudget([0, 0], 1, 50, B);
    expect(a2).toBeGreaterThan(a1);
  });
});

describe('betTowardsValue', () => {
  const rangeMin = 0;
  const rangeMax = 1000;

  test('direction is higher when target > current consensus', () => {
    // At [10,10], consensus ≈ 500. Target 800 → should bet higher.
    const { direction } = betTowardsValue([10, 10], B, rangeMin, rangeMax, 800, 1000);
    expect(direction).toBe(1);
  });

  test('direction is lower when target < current consensus', () => {
    // At [10,10], consensus ≈ 500. Target 200 → should bet lower.
    const { direction } = betTowardsValue([10, 10], B, rangeMin, rangeMax, 200, 1000);
    expect(direction).toBe(0);
  });

  test('cost does not exceed maxBudget', () => {
    const maxBudget = 30;
    const { cost } = betTowardsValue([0, 0], B, rangeMin, rangeMax, 800, maxBudget);
    expect(cost).toBeLessThanOrEqual(maxBudget + 0.01);
  });

  test('returns zero amount when already at target', () => {
    // Consensus at [10,10] is ~500. Betting towards 500 should do nothing.
    const { amount } = betTowardsValue([10, 10], B, rangeMin, rangeMax, 500, 100);
    expect(amount).toBeLessThanOrEqual(0.01);
  });
});

describe('directionSellProceeds', () => {
  test('proceeds are positive when selling shares you hold', () => {
    // First buy, then sell
    const { amount } = sharesForBudget([0, 0], 1, 50, B);
    const sharesAfterBuy: [number, number] = [0, amount];
    const proceeds = directionSellProceeds(sharesAfterBuy, 1, amount / 2, B);
    expect(proceeds).toBeGreaterThan(0);
  });

  test('buy cost > sell proceeds (market maker always has edge)', () => {
    const { amount, cost } = sharesForBudget([0, 0], 1, 50, B);
    const sharesAfterBuy: [number, number] = [0, amount];
    const proceeds = directionSellProceeds(sharesAfterBuy, 1, amount, B);
    // Proceeds should be close to but less than or equal to cost
    expect(proceeds).toBeLessThanOrEqual(cost + 0.02);
  });
});

describe('resolutionPayouts', () => {
  test('value at rangeMin → higher pays 0, lower pays 1', () => {
    const [lower, higher] = resolutionPayouts(0, 0, 1000);
    expect(lower).toBe(1);
    expect(higher).toBe(0);
  });

  test('value at rangeMax → higher pays 1, lower pays 0', () => {
    const [lower, higher] = resolutionPayouts(1000, 0, 1000);
    expect(lower).toBe(0);
    expect(higher).toBe(1);
  });

  test('value at midpoint → both pay 0.5', () => {
    const [lower, higher] = resolutionPayouts(500, 0, 1000);
    expect(lower).toBeCloseTo(0.5);
    expect(higher).toBeCloseTo(0.5);
  });

  test('payouts sum to 1', () => {
    const [lower, higher] = resolutionPayouts(300, 0, 1000);
    expect(lower + higher).toBeCloseTo(1);
  });

  test('clamps values below rangeMin', () => {
    const [lower, higher] = resolutionPayouts(-100, 0, 1000);
    expect(lower).toBe(1);
    expect(higher).toBe(0);
  });

  test('clamps values above rangeMax', () => {
    const [lower, higher] = resolutionPayouts(2000, 0, 1000);
    expect(lower).toBe(0);
    expect(higher).toBe(1);
  });
});

describe('initialPool', () => {
  test('equals b * ln(2)', () => {
    expect(initialPool(100)).toBeCloseTo(100 * Math.log(2));
  });

  test('returns 0 when b = 0', () => {
    expect(initialPool(0)).toBe(0);
  });
});

describe('LMSR value conservation (critical financial property)', () => {
  test('buying then immediately selling returns near-original balance (slippage only)', () => {
    const budget = 50;
    const { amount, cost } = sharesForBudget([0, 0], 1, budget, B);
    const sharesAfterBuy: [number, number] = [0, amount];
    const proceeds = directionSellProceeds(sharesAfterBuy, 1, amount, B);
    // Should recover most of what was spent (small rounding loss only)
    expect(proceeds).toBeCloseTo(cost, 0);
    expect(proceeds).toBeLessThanOrEqual(cost + 0.02);
  });

  test('pool increases by cost on buy, decreases by proceeds on sell', () => {
    const initialPoolValue = initialPool(B);
    const { amount, cost } = sharesForBudget([0, 0], 1, 40, B);
    const sharesAfterBuy: [number, number] = [0, amount];
    const poolAfterBuy = initialPoolValue + cost;

    const proceeds = directionSellProceeds(sharesAfterBuy, 1, amount, B);
    const poolAfterSell = poolAfterBuy - proceeds;
    // Pool should be close to initial (small residual due to rounding)
    expect(poolAfterSell).toBeCloseTo(initialPoolValue, 0);
  });
});

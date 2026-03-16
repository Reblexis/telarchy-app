/**
 * Binary LMSR for numeric markets (Manifold-style).
 * Each market has a value range [rangeMin, rangeMax].
 * Agents bet "higher" or "lower". The probability of "higher"
 * maps linearly across the range to produce a consensus value.
 * Market stores [lowerShares, higherShares].
 */

/** LMSR cost function for 2 outcomes. */
function lmsrCost(shares: [number, number], b: number): number {
  const max = Math.max(shares[0], shares[1]);
  return b * (max / b + Math.log(Math.exp((shares[0] - max) / b) + Math.exp((shares[1] - max) / b)));
}

/**
 * Probability that the value is "higher" (maps to upper end of range).
 * When b = 0 (no liquidity) returns 0; callers should use consensus() which
 * returns undefined for no-liquidity and untraded markets.
 */
export function pHigher(shares: [number, number], b: number): number {
  if (b <= 0) return 0;
  const diff = shares[1] - shares[0];
  return 1 / (1 + Math.exp(-diff / b));
}

/**
 * Consensus value = rangeMin + p(higher) * (rangeMax - rangeMin).
 * Returns undefined when b = 0 (no liquidity) or when no one has traded yet (shares = [0, 0]).
 */
export function consensus(shares: [number, number], b: number, rangeMin: number, rangeMax: number): number | undefined {
  if (b <= 0 || (shares[0] === 0 && shares[1] === 0)) return undefined;
  return Math.round((rangeMin + pHigher(shares, b) * (rangeMax - rangeMin)) * 100) / 100;
}

/** Cost to buy `amount` shares of higher (direction=1) or lower (direction=0). */
export function directionTradeCost(shares: [number, number], direction: 0 | 1, amount: number, b: number): number {
  const after: [number, number] = [shares[0], shares[1]];
  after[direction] += amount;
  return Math.round((lmsrCost(after, b) - lmsrCost(shares, b)) * 100) / 100;
}

/**
 * Find how many shares can be bought for a given credit budget.
 * Uses binary search since LMSR cost is monotonically increasing.
 */
export function sharesForBudget(shares: [number, number], direction: 0 | 1, budget: number, b: number): { amount: number; cost: number } {
  let lo = 0, hi = budget * 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const cost = directionTradeCost(shares, direction, mid, b);
    if (cost < budget) lo = mid; else hi = mid;
  }
  const amount = Math.round(lo * 100) / 100;
  const cost = directionTradeCost(shares, direction, amount, b);
  return { amount, cost };
}

/**
 * Buy shares to move consensus towards targetValue, spending at most maxBudget.
 * If the target is reachable within budget, buys exactly enough shares.
 * Otherwise spends the full budget pushing consensus as far as possible.
 */
export function betTowardsValue(
  shares: [number, number], b: number, rangeMin: number, rangeMax: number, targetValue: number, maxBudget: number,
): { direction: 0 | 1; amount: number; cost: number } {
  const current = consensus(shares, b, rangeMin, rangeMax) ?? (rangeMin + (rangeMax - rangeMin) / 2);
  if (Math.abs(targetValue - current) < 0.01) return { direction: 1, amount: 0, cost: 0 };

  const direction: 0 | 1 = targetValue >= current ? 1 : 0;
  const clampedP = Math.max(0.001, Math.min(0.999, (targetValue - rangeMin) / (rangeMax - rangeMin)));
  const targetDiff = -b * Math.log(1 / clampedP - 1);
  const currentDiff = shares[1] - shares[0];
  const neededAmount = Math.max(0, direction === 1 ? targetDiff - currentDiff : currentDiff - targetDiff);
  const neededCost = directionTradeCost(shares, direction, neededAmount, b);

  if (neededCost <= maxBudget) {
    const amount = Math.round(neededAmount * 100) / 100;
    const cost = directionTradeCost(shares, direction, amount, b);
    return { direction, amount, cost };
  }
  const { amount, cost } = sharesForBudget(shares, direction, maxBudget, b);
  return { direction, amount, cost };
}

/** Proceeds from selling `amount` shares of higher (direction=1) or lower (direction=0). */
export function directionSellProceeds(shares: [number, number], direction: 0 | 1, amount: number, b: number): number {
  const after: [number, number] = [shares[0], shares[1]];
  after[direction] -= amount;
  return Math.round((lmsrCost(shares, b) - lmsrCost(after, b)) * 100) / 100;
}

/** Map actual value to proportional payout factors [lowerPayout, higherPayout]. */
export function resolutionPayouts(actualValue: number, rangeMin: number, rangeMax: number): [number, number] {
  const p = Math.max(0, Math.min(1, (actualValue - rangeMin) / (rangeMax - rangeMin)));
  return [Math.round((1 - p) * 10000) / 10000, Math.round(p * 10000) / 10000];
}

export const AMM_DEFAULTS = {
  rangeMin: 0,
  rangeMax: 1000,
  liquidity: 0,
};

function lmsrCost(q0: number, q1: number, b: number): number {
  const max = Math.max(q0, q1);
  return b * (max / b + Math.log(Math.exp((q0 - max) / b) + Math.exp((q1 - max) / b)));
}

export function previewTrade(prob: number, liquidity: number, direction: 'higher' | 'lower', amount: number) {
  const b = liquidity;
  const p = Math.max(0.001, Math.min(0.999, prob));
  const q1 = b * Math.log(p / (1 - p));
  const q0 = 0;

  let lo = 0, hi = amount * 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const cost = direction === 'higher'
      ? lmsrCost(q0, q1 + mid, b) - lmsrCost(q0, q1, b)
      : lmsrCost(q0 + mid, q1, b) - lmsrCost(q0, q1, b);
    if (cost < amount) lo = mid; else hi = mid;
  }
  const shares = Math.round(lo * 1_000_000_000) / 1_000_000_000;

  const newQ0 = direction === 'lower' ? q0 + shares : q0;
  const newQ1 = direction === 'higher' ? q1 + shares : q1;
  const diff = newQ1 - newQ0;
  const newProb = 1 / (1 + Math.exp(-diff / b));

  return { shares, newProb };
}

/**
 * Client-side preview of a "bet toward a value" trade (server modes:
 * {targetValue, maxBudget}). Mirrors the backend `betTowardsValue`: buys in the
 * direction that moves consensus toward `targetValue`, buying exactly enough to
 * hit it when that costs <= maxBudget, otherwise spending the whole budget.
 * Approximate (the server response is authoritative); good enough for a hint.
 */
export function previewTargetBet(
  prob: number, liquidity: number, rangeMin: number, rangeMax: number,
  targetValue: number, maxBudget: number,
): { direction: 'higher' | 'lower'; shares: number; cost: number; newProb: number } | null {
  const b = liquidity;
  if (b <= 0 || rangeMax <= rangeMin || maxBudget <= 0) return null;
  const current = rangeMin + prob * (rangeMax - rangeMin);
  if (Math.abs(targetValue - current) < 0.01) return null;
  const direction: 'higher' | 'lower' = targetValue >= current ? 'higher' : 'lower';

  const p = Math.max(0.001, Math.min(0.999, prob));
  const q1 = b * Math.log(p / (1 - p));
  const q0 = 0;
  const before = lmsrCost(q0, q1, b);
  const costFor = (s: number) => direction === 'higher'
    ? lmsrCost(q0, q1 + s, b) - before
    : lmsrCost(q0 + s, q1, b) - before;

  // Shares needed to hit the target value exactly.
  const pt = Math.max(0.001, Math.min(0.999, (targetValue - rangeMin) / (rangeMax - rangeMin)));
  const targetDiff = b * Math.log(pt / (1 - pt));
  const needed = Math.max(0, direction === 'higher' ? targetDiff - q1 : q1 - targetDiff);

  let shares: number;
  if (costFor(needed) <= maxBudget) {
    shares = needed;
  } else {
    let lo = 0, hi = maxBudget * 20;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (costFor(mid) < maxBudget) lo = mid; else hi = mid;
    }
    shares = lo;
  }
  shares = Math.round(shares * 1_000_000_000) / 1_000_000_000;
  const cost = costFor(shares);
  const newQ0 = direction === 'lower' ? q0 + shares : q0;
  const newQ1 = direction === 'higher' ? q1 + shares : q1;
  const newProb = 1 / (1 + Math.exp(-(newQ1 - newQ0) / b));
  return { direction, shares, cost, newProb };
}

/** Map actual value to proportional payout factors [lowerPayout, higherPayout]. */
export function resolutionPayouts(actualValue: number, rangeMin: number, rangeMax: number): [number, number] {
  const p = Math.max(0, Math.min(1, (actualValue - rangeMin) / (rangeMax - rangeMin)));
  return [Math.round((1 - p) * 10000) / 10000, Math.round(p * 10000) / 10000];
}

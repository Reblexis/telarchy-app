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

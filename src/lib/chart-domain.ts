/**
 * The y domain the market chart draws (components/MarketChart), as one
 * helper, because a second surface quotes it: the stake example under each
 * bet verb names the payout at the top of the visible axis (docs/
 * ui-conventions.md, "Each bet verb says what a stake pays"), and a number
 * the verbs compute on their own would drift from the axis the reader sees.
 *
 * Two kinds of value feed it. The SERIES is what the market printed over
 * time; in a thin market a single trade can saturate the AMM and print at
 * the metric's ceiling for one tick, and taking a raw min/max over that
 * stretches the axis until every real move is a flat line (observed live
 * 2026-08-12: a $10k..$180k axis for a market that spent its life between
 * $73k and $77k). So the series contributes a ROBUST band (5th..95th
 * percentile); brief excursions still draw, clipped to the plot.
 * MUST-SHOW values are single facts the reader needs on the canvas: the
 * live call, a composed bet's ghost, resting orders, the other branch.
 * These always widen the domain, never get clipped.
 *
 * The axis is then padded by a quarter of its span, floored at zero, and
 * never narrower than four label quanta: an axis narrower than that prints
 * the same number twice and turns noise into a cliff (owner report
 * 2026-08-15: "it goes from 25 to 25 and yet it goes down?").
 */

/**
 * The smallest difference two y-axis labels can express at this magnitude,
 * given compactNum's formatting (components/MarketChart).
 */
export function labelQuantum(v: number): number {
  const abs = Math.abs(v);
  if (abs >= 1e9) return 1e8; // "1.2B": one tenth of a billion
  if (abs >= 1e6) return 1e5; // "10.1M": one tenth of a million
  if (abs >= 1000) return 100; // "77.4k": one tenth of a thousand
  if (abs >= 1) return 1; // "25": whole units
  return 0.01; // sub-unit values, where the guard must not flatten a real move
}

export function yDomain(seriesValues: number[], mustShow: number[]): { lo: number; hi: number } {
  const sorted = [...seriesValues].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
  const vMin0 = Math.min(quantile(0.05), ...mustShow);
  const vMax0 = Math.max(quantile(0.95), ...mustShow);
  const vPad = (vMax0 - vMin0 || vMax0 * 0.08 || 1) * 0.25;
  let lo = Math.max(0, vMin0 - vPad);
  let hi = vMax0 + vPad;

  const minSpan = labelQuantum(Math.max(Math.abs(vMin0), Math.abs(vMax0))) * 4;
  if (hi - lo < minSpan) {
    const mid = (vMin0 + vMax0) / 2;
    lo = Math.max(0, mid - minSpan / 2);
    // Re-derive the top from the clamped bottom, so clamping at zero
    // narrows the window instead of preserving it.
    hi = lo + minSpan;
  }
  return { lo, hi };
}

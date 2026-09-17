/**
 * The vertical band a price chart shows, before padding. One rule for every
 * chart that draws a market's call (docs/ui-conventions.md, "The market
 * chart"): every price in the window sits inside the plot, and only a freak
 * print is cut.
 *
 * `series` is what the market printed over time. In a thin market a single
 * trade can saturate the AMM and print at the metric's ceiling for one tick,
 * and a raw min/max over that stretches the axis until every real move is a
 * flat line (observed live 2026-08-12: a $10k..$180k axis for a market that
 * spent its life between $73k and $77k). Cutting to the 5th..95th percentile
 * fixed that and ran ordinary highs and lows off the plot instead (owner
 * report 2026-09-17: a 27 and a 3 on a chart that lived between 6 and 21).
 * So the band reaches to the true extremes, by at most the percentile
 * band's own height on each side.
 *
 * `mustShow` are single facts the reader needs on the canvas (the live
 * call, a composed bet's ghost, resting orders, the other branch): they
 * always widen the band and are never cut.
 */
export function priceBand(series: number[], mustShow: number[]): [number, number] {
  const sorted = series.filter(Number.isFinite).sort((a, b) => a - b);
  const shown = mustShow.filter(Number.isFinite);
  if (sorted.length === 0) return shown.length ? [Math.min(...shown), Math.max(...shown)] : [0, 0];
  const quantile = (p: number) => sorted[Math.round((sorted.length - 1) * p)];
  const q05 = quantile(0.05);
  const q95 = quantile(0.95);
  const reach = q95 - q05;
  return [
    Math.min(Math.max(sorted[0], q05 - reach), ...shown),
    Math.max(Math.min(sorted[sorted.length - 1], q95 + reach), ...shown),
  ];
}

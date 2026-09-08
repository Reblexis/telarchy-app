/**
 * One impact precision for every surface that prints a proposal's
 * difference (docs/ui-conventions.md, "The decision row, then the decision
 * bar"): the since-open chip beside the market's call, the decision row's
 * difference cell, the proposals rail and the contractors' footer. Two
 * decimals under 1, one decimal under 100, whole from 100 up; signed, the
 * unit between the sign and the number ("+$11,000", "-0.45").
 *
 * A number that is not zero never prints as zero ("+0.0", "+$0.00"): the
 * decimals grow until the first significant digit shows, because a chip
 * that says a proposal moves the number by nothing when the market says it
 * moves it by a little misreports the market.
 */
export function formatImpact(value: number, unit: string): string {
  const abs = Math.abs(value);
  let decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  while (abs > 0 && decimals < 8 && Number(abs.toFixed(decimals)) === 0) decimals += 1;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${unit}${num}`;
}

/**
 * Whether a pair's two calls need more decimals than they would usually
 * print with, so the row adds up at a glance (docs/ui-conventions.md, "The
 * decision row, then the decision bar"; critics' round 2 of 2026-09-08:
 * "17.0, 17.0, difference +0.04" reads as wrong). True when the difference
 * is not zero and either is under a tenth, or the two calls would print
 * equal at their usual precision (`print` is that surface's usual
 * formatter). The decision row and the chart's branch labels both ask.
 */
export function pairNeedsDecimals(
  approved: number,
  declined: number,
  print: (v: number) => string = v => v.toFixed(1),
): boolean {
  const diff = approved - declined;
  if (diff === 0) return false;
  return Math.abs(diff) < 0.1 || print(approved) === print(declined);
}

/** A pair's call at the reconciling precision: two decimals, thousands
 *  separated, the unit in front ("$17.02"). */
export function formatPairValue(value: number, unit: string): string {
  return `${unit}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

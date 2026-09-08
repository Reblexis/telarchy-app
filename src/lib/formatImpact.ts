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

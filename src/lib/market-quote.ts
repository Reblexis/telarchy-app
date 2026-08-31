/**
 * What a market says about itself before anyone has traded on it.
 *
 * Two surfaces quote a market at rest, the floor's bet verbs and the trade
 * ticket's side pills, and they must say the same thing in the same words,
 * so the wording lives here and nowhere else (docs/ui-conventions.md, "An
 * untouched ticket still quotes both sides").
 */

/** Metric-space values, formatted the way the headline formats them. */
function fmtValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A range end as a person would say it: "$0", not "$0.00". */
function fmtEdge(v: number): string {
  return fmtValue(v).replace(/\.0+$/, '');
}

/**
 * What one share of a side costs, in cents of a credit, as every other venue
 * quotes a market. Never 0c or 100c: a share of a live side is neither free
 * nor certain, and the rounded extremes would say it is, so the ends read as
 * bounds instead.
 */
export function priceLabel(p: number): string {
  const cents = Math.min(1, Math.max(0, p)) * 100;
  if (cents < 0.5) return '<1c';
  if (cents >= 99.5) return '>99c';
  return `${Math.round(cents)}c`;
}

/**
 * The one sentence that turns a price into a payout. A cents price on a
 * binary contract states its own payout; ours is linear in the settled
 * value, so the price alone would be a true number under a false assumption.
 */
export function payoutLine(unit: string, rangeMin: number, rangeMax: number): string {
  return `A share pays 1 credit if the number settles at ${unit}${fmtEdge(rangeMax)}, nothing at ${unit}${fmtEdge(rangeMin)}, in proportion in between.`;
}

/**
 * What a market says about itself before anyone has traded on it.
 *
 * Two surfaces quote a market at rest, the floor's bet verbs and the trade
 * ticket's side pills, and they must say the same thing in the same words,
 * so the wording lives here and nowhere else (docs/ui-conventions.md, "An
 * untouched ticket still quotes both sides").
 */

/**
 * Metric-space values, formatted the way the headline formats them. Exported
 * because every surface that quotes a market has to say a value the same way:
 * a break-even drawn on the payoff line and the same break-even in a fact row
 * are one number, and two formatters would eventually disagree about it.
 */
export function formatMetricValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const fmtValue = formatMetricValue;

/** A range end as a person would say it: "$0", not "$0.00". */
function fmtEdge(v: number): string {
  return fmtValue(v).replace(/\.0+$/, '');
}

/**
 * The one line that turns a price into a payout. A cents price on a binary
 * contract states its own payout; ours is linear in the settled value, so
 * the price alone would be a true number under a false assumption.
 *
 * Eight words, and it stays that way (owner, 2026-08-31, on the eighteen-word
 * version: "this seems like too much text"): it sits under a two-character
 * price, and a sentence of explanation there reads as a warning rather than
 * as the price's unit. What happens between the two ends is the ticket's job,
 * which says it about the actual bet ("Wins above", "Each X beyond").
 */
export function payoutLine(unit: string, rangeMin: number, rangeMax: number): string {
  return `A share pays 1 cr at ${unit}${fmtEdge(rangeMax)}, nothing at ${unit}${fmtEdge(rangeMin)}.`;
}

/**
 * How many credits can ever be won on a side, from where the market is now.
 *
 * There IS a ceiling, and it is exact: `b * ln(1/p)`, the market's liquidity
 * times the log of one over that side's price. Buying pushes the price
 * toward the range's edge, so each further share costs more than the last
 * and the cost catches the payout: profit converges on that figure rather
 * than growing with the stake. On a 30c side of a market with b = 575, a
 * 73 credit bet can make 144 and a 5,000 credit bet can make 700, which is
 * the ceiling; the next five thousand make nothing.
 *
 * This is the quote both untouched surfaces carry, because it is the only
 * number on the page that answers the question a trader asks first: is
 * there anything here worth my time. A price in cents and the multiple it
 * implies are near-identical across every live market; the depth is not,
 * and "up to 12 cr" sends somebody away in one glance where "up to 3.4x"
 * never would. It also says which side the market maker is exposed on.
 *
 * Always quoted as "up to" (the callers write the words): it is reached
 * only if the number settles at the range's own edge, and bare it would
 * read as a promise.
 *
 * Null where there is nothing to state: an unfunded market has no price
 * either and refuses trades, and a free side has no ceiling at all.
 */
export function maxWinLabel(p: number, liquidity: number): string | null {
  if (!Number.isFinite(liquidity) || liquidity <= 0) return null;
  const price = Math.min(1, Math.max(0, p));
  if (price <= 0) return null;
  const cr = liquidity * Math.log(1 / price);
  if (cr < 0.95) return '<1 cr';
  if (cr < 10) return `${Math.round(cr * 10) / 10} cr`;
  return `${Math.round(cr).toLocaleString('en-US')} cr`;
}

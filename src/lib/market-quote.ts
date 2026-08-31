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
 * The most a credit spent on a side can come back as: a share costs its
 * price and pays at most one credit, so the ceiling is the reciprocal.
 *
 * It is quoted only ever as "up to" (the callers write the words), because
 * our payout is linear in the settled value and the maximum is reached only
 * at the range's own edge. A bare multiple would read as the return rather
 * than as its ceiling, which is the same lie a percent would tell about a
 * price. It answers what "to win" answers on a binary venue, where a
 * contract pays a fixed amount and the price states its own payout; ours
 * does not, so this is the honest version of that question.
 *
 * Clamped at both ends like `priceLabel`: a 1c share really can return a
 * hundredfold and saying so reads as a lie, and no side can return less than
 * the credit put on it.
 */
export function maxReturnLabel(p: number): string {
  const price = Math.min(1, Math.max(0, p));
  if (price <= 0.01) return '>99x';
  const x = 1 / price;
  if (x >= 99.5) return '>99x';
  if (x < 1.05) return '1x';
  const body = x >= 10 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toString();
  return `${body.replace(/\.0$/, '')}x`;
}

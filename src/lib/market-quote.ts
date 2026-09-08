/**
 * What a market says about itself before anyone has traded on it.
 *
 * Two surfaces quote a market at rest, the floor's bet verbs and the trade
 * ticket's side pills, and they must say the same thing in the same words,
 * so the wording lives here and nowhere else (docs/ui-conventions.md, "An
 * untouched ticket still quotes both sides").
 */

import { previewTrade } from './amm';

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

/** A range end as a person would say it: "$0", not "$0.00". Exported
 *  because the ticket's "Pays at 50" row names the same edge the verb's
 *  preview above it does, and two formatters would eventually disagree. */
export function edgeLabel(unit: string, v: number): string {
  return `${unit}${fmtValue(v).replace(/\.0+$/, '')}`;
}

/**
 * A market's call as a person would say it, "9.4" and "41", not "9.40" and
 * "41.0": the books list stacks four calls in one narrow rail, and a
 * trailing zero there reads as precision the market has not got. The
 * numbers band keeps the fixed decimals, because a headline that changes
 * width as it ticks is worse than a trailing zero.
 */
export function callLabel(unit: string, v: number): string {
  const text = fmtValue(v);
  return `${unit}${text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text}`;
}

function fmtEdge(v: number): string {
  return fmtValue(v).replace(/\.0+$/, '');
}

/**
 * The range line under the verbs (docs/ui-conventions.md, "The verbs and
 * the inline ticket", row 3): one line that states BOTH directions, the
 * rule the two previews above it follow. "Range 0 to 50 · Higher shares
 * pay 1 cr at 50, Lower shares pay 1 cr at 0; in between, in proportion ·
 * you can sell any time".
 */
export function rangeLine(unit: string, rangeMin: number, rangeMax: number): string {
  const lo = `${unit}${fmtEdge(rangeMin)}`;
  const hi = `${unit}${fmtEdge(rangeMax)}`;
  return `Range ${lo} to ${hi} · Higher shares pay 1 cr at ${hi}, Lower shares pay 1 cr at ${lo}; in between, in proportion · you can sell any time`;
}

/**
 * What a stake pays at the range's edge, quoted by the same LMSR preview
 * the ticket runs (docs/ui-conventions.md, "The verbs and the inline
 * ticket", row 2): "25 cr pays 63 cr at 50 · +38" under Higher (the top of
 * the range) and "25 cr pays 41 cr at 0 · +16" under Lower (its floor). One
 * credit per share at that edge, so the payout IS the shares; the profit
 * is the payout minus the stake. Never the stake divided by the call.
 *
 * Null where there is nothing to quote: an unfunded book has no price.
 */
export function stakePreview(
  unit: string,
  rangeMin: number,
  rangeMax: number,
  probability: number,
  liquidity: number,
  direction: 'higher' | 'lower',
  stake: number,
): { shares: number; pays: number; profit: number; edge: string; line: string; echo: string } | null {
  if (!Number.isFinite(liquidity) || liquidity <= 0 || !(stake > 0)) return null;
  const p = Math.min(0.999, Math.max(0.001, probability));
  const { shares } = previewTrade(p, liquidity, direction, stake);
  if (!Number.isFinite(shares) || shares <= 0) return null;
  const edge = `${unit}${fmtEdge(direction === 'higher' ? rangeMax : rangeMin)}`;
  const cr = (n: number) => Math.round(n).toLocaleString('en-US');
  const profit = shares - stake;
  const signed = `${profit < 0 ? '-' : '+'}${cr(Math.abs(profit))}`;
  return {
    shares,
    pays: shares,
    profit,
    edge,
    line: `${stake} cr pays ${cr(shares)} cr at ${edge} · ${signed}`,
    echo: `${stake} cr · pays ${cr(shares)} cr at ${edge}`,
  };
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

/**
 * Client-side mirror of the server AMM (functions/src/lib/amm.ts +
 * services/trading.ts), used for ticket previews. The server response is
 * authoritative; these exist so the number the ticket shows is the number
 * the trade lands on. That promise broke once (owner report 2026-08-22):
 * the server nets positions (a buy on the side opposite a held position
 * first sells that position, moving the price, THEN the buy prices against
 * the post-close book; executeTradeInTx, owner decision 2026-08-11), and
 * these previews modelled the buy alone. Every preview of a buy therefore
 * takes the trader's held position and replays the netting close first.
 * amm-parity.test.ts runs these against the real server functions.
 */

/** The one side a trader can hold (the server nets to a single net side). */
export interface HeldPosition {
  direction: 'higher' | 'lower';
  shares: number;
}

function lmsrCost(q0: number, q1: number, b: number): number {
  const max = Math.max(q0, q1);
  return b * (max / b + Math.log(Math.exp((q0 - max) / b) + Math.exp((q1 - max) / b)));
}

/**
 * Relative LMSR book [q_lower, q_higher] reconstructed from the live
 * probability. LMSR is translation-invariant, so anchoring q_lower at 0
 * prices every move identically to the server's absolute book.
 */
function bookFromProb(prob: number, b: number): [number, number] {
  const p = Math.max(0.001, Math.min(0.999, prob));
  return [0, b * Math.log(p / (1 - p))];
}

/**
 * The book after the netting close a buy triggers: the server sells the
 * whole held position on the side OPPOSITE the buy before the buy prices.
 * A same-side (or absent) position closes nothing. Proceeds are what that
 * forced sale pays the trader, spendable inside the same trade.
 */
/**
 * Credits a buy hands back by redeeming matched pairs (owner ask
 * 2026-08-30, after Manifold; the rule is docs/ui-conventions.md, "A
 * trader holds ONE net side"). The server buys against the LIVE book and
 * then cashes every matched higher+lower pair at the 1 credit it is worth,
 * so unlike the liquidation this replaced, it moves the price by NOTHING:
 * an LMSR price reads q1 - q0, and redemption takes the same amount off
 * both. That is why this returns credits only and never a book.
 */
function redemptionCredits(buyDirection: 'higher' | 'lower', bought: number, held?: HeldPosition | null): number {
  if (!held || held.shares <= 0 || held.direction === buyDirection) return 0;
  return Math.min(held.shares, bought);
}

/** Shares a budget buys from a given book (binary search; mirrors the
    server's sharesForBudget, same 20x bound and iteration count). */
function sharesFor(book: [number, number], dirIdx: 0 | 1, budget: number, b: number): number {
  const before = lmsrCost(book[0], book[1], b);
  let lo = 0,
    hi = budget * 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const after: [number, number] = [book[0], book[1]];
    after[dirIdx] += mid;
    if (lmsrCost(after[0], after[1], b) - before < budget) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 1_000_000_000) / 1_000_000_000;
}

export function previewTrade(
  prob: number,
  liquidity: number,
  direction: 'higher' | 'lower',
  amount: number,
  held?: HeldPosition | null,
) {
  const b = liquidity;
  const book = bookFromProb(prob, b);
  const dirIdx = direction === 'higher' ? 1 : 0;
  const shares = sharesFor(book, dirIdx, amount, b);
  const after: [number, number] = [book[0], book[1]];
  after[dirIdx] += shares;
  const newProb = 1 / (1 + Math.exp(-(after[1] - after[0]) / b));
  return { shares, newProb, redeemed: redemptionCredits(direction, shares, held) };
}

/**
 * What a held position would fetch if sold right now, in credits. Mirrors
 * previewTrade's relative-state model (client approximation; the server
 * response on an actual sell is authoritative). Used for the live "worth
 * now" readout on positions.
 */
export function previewSell(prob: number, liquidity: number, direction: 'higher' | 'lower', shares: number): number {
  const b = liquidity;
  const [q0, q1] = bookFromProb(prob, b);
  const value =
    direction === 'higher'
      ? lmsrCost(q0, q1, b) - lmsrCost(q0, q1 - shares, b)
      : lmsrCost(q0, q1, b) - lmsrCost(q0 - shares, q1, b);
  return Math.max(0, Math.round(value * 1_000_000_000) / 1_000_000_000);
}

/**
 * Client preview of a {targetValue, maxBudget} trade: the FULL server
 * flow, in order. (1) The buy side is decided against the live price,
 * exactly as the route does. (2) The netting close sells an opposite held
 * position. (3) betTowardsValue runs on the post-close book, which can
 * flip the final direction: holding higher at 622 and targeting 550 nets
 * to 500 first and then buys HIGHER back up to 550. Powers the ticket's
 * "New value" input, whose placed trade uses the same server mode, so the
 * value shown is the value landed (budget permitting) by construction.
 */
export function previewTargetBet(
  prob: number,
  liquidity: number,
  rangeMin: number,
  rangeMax: number,
  targetValue: number,
  maxBudget: number,
  held?: HeldPosition | null,
): { direction: 'higher' | 'lower'; shares: number; cost: number; newProb: number; redeemed: number } | null {
  const b = liquidity;
  const span = rangeMax - rangeMin;
  if (b <= 0 || span <= 0 || maxBudget <= 0) return null;
  const p0 = Math.max(0.001, Math.min(0.999, prob));
  const current = rangeMin + p0 * span;
  if (Math.abs(targetValue - current) < 0.01) return null;

  // betTowardsValue runs on the live book: redemption happens after the buy
  // and moves no price, so nothing is closed out first and the side the
  // trade ends on is simply the side of the target.
  const book = bookFromProb(prob, b);

  // betTowardsValue (same formulas as the server).
  const p2 = 1 / (1 + Math.exp(-(book[1] - book[0]) / b));
  const current2 = rangeMin + p2 * span;
  const dirIdx: 0 | 1 = targetValue >= current2 ? 1 : 0;
  const before = lmsrCost(book[0], book[1], b);
  const costOf = (s: number) => {
    const after: [number, number] = [book[0], book[1]];
    after[dirIdx] += s;
    return lmsrCost(after[0], after[1], b) - before;
  };

  const pt = (targetValue - rangeMin) / span;
  let shares: number;
  if (pt <= 0 || pt >= 1) {
    shares = sharesFor(book, pt <= 0 ? 0 : 1, maxBudget, b);
  } else {
    const targetDiff = -b * Math.log(1 / pt - 1);
    const currentDiff = book[1] - book[0];
    const needed = Math.max(0, dirIdx === 1 ? targetDiff - currentDiff : currentDiff - targetDiff);
    shares = costOf(needed) <= maxBudget ? needed : sharesFor(book, dirIdx, maxBudget, b);
  }
  shares = Math.round(shares * 1_000_000_000) / 1_000_000_000;
  const cost = Math.max(0, costOf(shares));
  const after: [number, number] = [book[0], book[1]];
  after[dirIdx] += shares;
  const newProb = 1 / (1 + Math.exp(-(after[1] - after[0]) / b));
  const direction: 'higher' | 'lower' = dirIdx === 1 ? 'higher' : 'lower';
  return { direction, shares, cost, newProb, redeemed: redemptionCredits(direction, shares, held) };
}

/** Map actual value to proportional payout factors [lowerPayout, higherPayout]. */
export function resolutionPayouts(actualValue: number, rangeMin: number, rangeMax: number): [number, number] {
  const p = Math.max(0, Math.min(1, (actualValue - rangeMin) / (rangeMax - rangeMin)));
  return [Math.round((1 - p) * 10000) / 10000, Math.round(p * 10000) / 10000];
}

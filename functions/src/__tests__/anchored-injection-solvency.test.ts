/**
 * THE RULE: a book's pool covers its worst case, and adding cash to the pool
 * never stops that being true.
 *
 * A market that opens off-centre opens ANCHORED: `anchoredMarketState` sizes
 * b DOWN to `subsidy / max(-ln p, -ln(1-p))`, deliberately thinner than the
 * symmetric `pool / ln 2`, so the cash actually paid in covers the
 * off-centre worst case exactly. That is the whole point of the anchor: it
 * buys its opening price with a thinner book rather than with credits nobody
 * paid.
 *
 * The injection path then recomputed b as `newPool / ln 2` regardless, which
 * is the symmetric answer. On an anchored book that is not a rescale, it is
 * a resize: b and the phantom anchor shares inflate by `worstCase / ln 2`
 * while the pool grows only by the contribution. The price does not move, so
 * nothing on screen says anything happened, and the difference is minted at
 * settlement (bug hunt 2026-08-31).
 *
 * The numbers below are the ones the review worked: the market the docs name
 * (a metric reading 0 on a 0-1000 range, auto-funded 2000), and a one
 * NANOCREDIT injection, which is the smallest contribution the route
 * accepts.
 */

import { anchoredMarketState, directionTradeCost, lmsrCost, sharesForBudget } from '../lib/amm';
import { liquidityStateAfterPoolContribution } from '../services/marketLiquidity';

/** What an LMSR maker can be made to owe, over what it holds: b times the
 *  worst case for the price it sits at. `anchoredMarketState` sizes against
 *  exactly this. */
function worstCaseLiability(shares: [number, number], b: number): number {
  const p = 1 / (1 + Math.exp(-(shares[1] - shares[0]) / b));
  return b * Math.max(-Math.log(p), -Math.log(1 - p));
}

const SUBSIDY = 2000;
// The clamp's floor: the thinnest book an anchored open can produce.
const OPENING_P = 0.001;

describe('an injection keeps the pool covering the book', () => {
  test('an anchored open is covered exactly, which is what makes the rest a rule', () => {
    const { liquidity, shares } = anchoredMarketState(SUBSIDY, OPENING_P);
    expect(worstCaseLiability(shares, liquidity)).toBeCloseTo(SUBSIDY, 6);
  });

  test('the smallest legal injection does not inflate the book past its pool', () => {
    const open = anchoredMarketState(SUBSIDY, OPENING_P);
    const after = liquidityStateAfterPoolContribution(open.shares, open.liquidity, SUBSIDY, 1e-9);

    expect(worstCaseLiability(after.newShares, after.newLiquidity)).toBeLessThanOrEqual(after.newPool + 1e-6);
  });

  test('a real injection scales the book with the pool and leaves the price alone', () => {
    const open = anchoredMarketState(SUBSIDY, OPENING_P);
    const after = liquidityStateAfterPoolContribution(open.shares, open.liquidity, SUBSIDY, SUBSIDY);

    // Twice the pool buys twice the depth, and no more.
    expect(after.newLiquidity).toBeCloseTo(open.liquidity * 2, 6);
    expect(worstCaseLiability(after.newShares, after.newLiquidity)).toBeCloseTo(after.newPool, 6);

    const priceBefore = 1 / (1 + Math.exp(-(open.shares[1] - open.shares[0]) / open.liquidity));
    const priceAfter = 1 / (1 + Math.exp(-(after.newShares[1] - after.newShares[0]) / after.newLiquidity));
    expect(priceAfter).toBeCloseTo(priceBefore, 9);
  });

  test('a centred book is untouched, because pool/ln2 was already the right size', () => {
    const b = 200;
    const pool = b * Math.LN2;
    const after = liquidityStateAfterPoolContribution([0, 0], b, pool, 100);
    expect(after.newLiquidity).toBeCloseTo((pool + 100) / Math.LN2, 9);
  });

  test('settlement cannot pay more than the pool holds after an injection', () => {
    const open = anchoredMarketState(SUBSIDY, OPENING_P);
    const after = liquidityStateAfterPoolContribution(open.shares, open.liquidity, SUBSIDY, 1e-9);

    // A trader buys the side the anchor is leaning away from, with a budget
    // several times the subsidy, and the metric lands at the top of the
    // range so that side pays 1 credit a share.
    const BUDGET = 5000;
    const { amount, cost } = sharesForBudget(after.newShares, 1, BUDGET, after.newLiquidity);
    const poolAtSettlement = after.newPool + cost;

    // Only the shares somebody actually bought are owed; the anchor's own
    // seed shares are unowned.
    expect(amount).toBeLessThanOrEqual(poolAtSettlement);
  });
});

describe('the arithmetic the fix rests on', () => {
  test('lmsrCost and directionTradeCost still agree on a thin anchored book', () => {
    const open = anchoredMarketState(SUBSIDY, OPENING_P);
    const direct = directionTradeCost(open.shares, 1, 100, open.liquidity);
    const byHand =
      lmsrCost([open.shares[0], open.shares[1] + 100], open.liquidity) - lmsrCost(open.shares, open.liquidity);
    expect(direct).toBeCloseTo(byHand, 6);
  });
});

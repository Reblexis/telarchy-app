import { directionTradeCost, sharesForBudget } from '../lib/amm';
import { computeTradingProfit, type LeaderboardPosition, type ProfitMarket } from '../lib/leaderboard';

/**
 * An open position is worth what it would pay if the market resolved right now
 * at the number the market currently calls (owner decision 2026-08-19, revising
 * the liquidation mark shipped the same morning: "it will eventually resolve at
 * the correct value"). See docs/seasons.md F1.
 *
 * The invariant these tests pin is that one sentence: worth = shares x the
 * current payout factor, whether or not the market has resolved. The known and
 * accepted cost is the first test: an LMSR fills you below the price you end
 * at, so a fresh buy shows the spread as paper profit before anything has
 * happened in the world. That is deliberate, and it is why it has a test of its
 * own rather than being left to be rediscovered as a bug.
 */

const HERO_B = 360.67376022224084; // production, LookPilot September 2026 net revenue
const HERO_RANGE: [number, number] = [0, 25000];

function marketAfterBuy(b: number, budget: number): { market: ProfitMarket; cost: number; shares: number } {
  const opening: [number, number] = [0, 0];
  const { amount, cost } = sharesForBudget(opening, 1, budget, b);
  // The book after the trade: the buyer's shares are now outstanding.
  const market: ProfitMarket = {
    id: 'mkt',
    workspaceId: 'ws',
    rangeMin: HERO_RANGE[0],
    rangeMax: HERO_RANGE[1],
    resolved: false,
    actualValue: null,
    shares: [0, amount],
    liquidity: b,
    voided: false,
  };
  return { market, cost, shares: amount };
}

const position = (shares: number, direction = 'higher'): LeaderboardPosition => ({
  agentId: 'trader',
  workspaceId: 'ws',
  marketId: 'mkt',
  direction,
  shares,
});

const profitOf = (markets: ProfitMarket[], netCash: number, positions: LeaderboardPosition[]) =>
  computeTradingProfit(markets, new Map([['trader', netCash]]), positions).get('trader') ?? 0;

describe('marked profit on an open position', () => {
  test('is the holding valued as if the market resolved at its current call', () => {
    const { market, cost, shares } = marketAfterBuy(HERO_B, 1000);
    // The market's own call, as a fraction of the range: the same number the
    // board would pay per share if it resolved there this instant.
    const p = 1 / (1 + Math.exp(-shares / HERO_B));

    expect(profitOf([market], cost, [position(shares)])).toBeCloseTo(shares * p - cost, 2);
  });

  test('a fresh buy shows the LMSR spread, and that is the accepted cost', () => {
    // Accepted 2026-08-19: the average fill is below the price you end at, so
    // pressing the button books a paper gain with no information involved.
    // ~200 credits on a 1,000-credit buy at the hero market's real book.
    const { market, cost, shares } = marketAfterBuy(HERO_B, 1000);

    expect(profitOf([market], cost, [position(shares)])).toBeGreaterThan(150);
  });

  test('a price that moves in your favour pays more than the spread alone', () => {
    // Someone else buys the same side after you: the book moves up, and your
    // holding is worth more than it was. This is the profit the board exists
    // to show.
    const { market, cost, shares } = marketAfterBuy(HERO_B, 500);
    const held = market.shares as [number, number];
    const other = sharesForBudget(held, 1, 2000, HERO_B);
    const moved: ProfitMarket = { ...market, shares: [held[0], held[1] + other.amount] };

    const before = profitOf([market], cost, [position(shares)]);
    const after = profitOf([moved], cost, [position(shares)]);
    expect(after).toBeGreaterThan(before);
  });

  test('a price that moves against you takes it back', () => {
    // The other side buys. The holding is worth less than the mark it had.
    const { market, cost, shares } = marketAfterBuy(HERO_B, 500);
    const held = market.shares as [number, number];
    const other = sharesForBudget(held, 0, 5000, HERO_B);
    const moved: ProfitMarket = { ...market, shares: [held[0] + other.amount, held[1]] };

    expect(profitOf([moved], cost, [position(shares)])).toBeLessThan(0);
  });

  test('selling into your own buy nets out at zero, not at a gain', () => {
    // Buy, then sell the whole holding back. Net cash is what is left after
    // both legs; the position is gone. Nothing should be left over.
    const b = 5000;
    const opening: [number, number] = [0, 0];
    const { amount, cost } = sharesForBudget(opening, 1, 1000, b);
    const proceeds = directionTradeCost([0, amount], 1, -amount, b) * -1;
    const netCash = cost - proceeds;

    const market: ProfitMarket = {
      id: 'mkt',
      workspaceId: 'ws',
      rangeMin: 0,
      rangeMax: 25000,
      resolved: false,
      actualValue: null,
      shares: [0, 0],
      liquidity: b,
      voided: false,
    };
    expect(Math.abs(profitOf([market], netCash, []))).toBeLessThan(0.01);
  });

  test('a resolved market pays its per-share payout factor, not a price', () => {
    const market: ProfitMarket = {
      id: 'mkt',
      workspaceId: 'ws',
      rangeMin: 0,
      rangeMax: 1000,
      resolved: true,
      actualValue: 750,
      shares: [0, 100],
      liquidity: 100,
      voided: false,
    };
    // 100 shares x 0.75 payout = 75, minus 40 paid.
    expect(profitOf([market], 40, [position(100)])).toBeCloseTo(35, 2);
  });
});

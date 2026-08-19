import { computeTradingProfit, type LeaderboardPosition, type ProfitMarket } from '../lib/leaderboard';
import { directionTradeCost, sharesForBudget } from '../lib/amm';

/**
 * A buy must not book a profit the moment it lands.
 *
 * The board used to value an open position at `shares x current price`. An
 * LMSR fills you at an average price strictly below the price you end at, so
 * that convention paid an instant paper profit for pressing the button, with
 * no information involved: on the hero market's real book (b = 360.67 over a
 * $0-25,000 range on 2026-08-19) a 1,000-credit buy booked about +200 credits
 * before anything happened in the world. Season 0 ranks entrants on exactly
 * this number, so the contest was winnable by pushing prices.
 *
 * These tests fail against that convention and pass against liquidation value
 * (docs/seasons.md, F1). To watch them fail, put `p.shares * factor` back in
 * computeTradingProfit.
 */

const HERO_B = 360.67376022224084;   // production, LookPilot September 2026 net revenue
const HERO_RANGE: [number, number] = [0, 25000];

function marketAfterBuy(b: number, budget: number): { market: ProfitMarket; cost: number; shares: number } {
  const opening: [number, number] = [0, 0];
  const { amount, cost } = sharesForBudget(opening, 1, budget, b);
  // The book after the trade: the buyer's shares are now outstanding.
  const market: ProfitMarket = {
    id: 'mkt', workspaceId: 'ws',
    rangeMin: HERO_RANGE[0], rangeMax: HERO_RANGE[1],
    resolved: false, actualValue: null,
    shares: [0, amount], liquidity: b, voided: false,
  };
  return { market, cost, shares: amount };
}

const position = (shares: number, direction = 'higher'): LeaderboardPosition => ({
  agentId: 'trader', workspaceId: 'ws', marketId: 'mkt', direction, shares,
});

describe('marked profit on an open position', () => {
  test('a fresh buy on the real hero book is worth what it cost, not more', () => {
    const { market, cost, shares } = marketAfterBuy(HERO_B, 1000);
    const profit = computeTradingProfit(
      [market],
      new Map([['trader', cost]]),
      [position(shares)],
    ).get('trader') ?? 0;

    // Liquidation value of the whole holding is exactly the cost of acquiring
    // it (LMSR is path-independent), so the honest answer is zero.
    expect(Math.abs(profit)).toBeLessThan(1);
  });

  test('the buy that used to book +200 credits books none of it', () => {
    const { market, cost, shares } = marketAfterBuy(HERO_B, 1000);
    const priceNow = shares > 0 ? (market.shares as [number, number])[1] : 0;
    void priceNow;
    // The old convention, spelled out so the regression is legible: shares
    // times the marginal price, minus what was paid.
    const p = 1 / (1 + Math.exp(-shares / HERO_B));
    const oldConvention = shares * p - cost;
    expect(oldConvention).toBeGreaterThan(150);   // the exploit, ~200 cr

    const profit = computeTradingProfit(
      [market],
      new Map([['trader', cost]]),
      [position(shares)],
    ).get('trader') ?? 0;
    expect(profit).toBeLessThan(oldConvention / 10);
  });

  test('a price that moves in your favour still pays', () => {
    // Someone else buys the same side after you: the book moves up, and your
    // holding is now worth more than you paid. This is the profit the board
    // exists to show, and it must survive the fix.
    const { market, cost, shares } = marketAfterBuy(HERO_B, 500);
    const held = market.shares as [number, number];
    const other = sharesForBudget(held, 1, 2000, HERO_B);
    const moved: ProfitMarket = { ...market, shares: [held[0], held[1] + other.amount] };

    const profit = computeTradingProfit(
      [moved],
      new Map([['trader', cost]]),
      [position(shares)],
    ).get('trader') ?? 0;
    expect(profit).toBeGreaterThan(50);
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
      id: 'mkt', workspaceId: 'ws', rangeMin: 0, rangeMax: 25000,
      resolved: false, actualValue: null,
      shares: [0, 0], liquidity: b, voided: false,
    };
    const profit = computeTradingProfit([market], new Map([['trader', netCash]]), []).get('trader') ?? 0;
    expect(Math.abs(profit)).toBeLessThan(0.01);
  });

  test('a resolved market still pays its per-share payout factor', () => {
    // The fix must not touch resolution: a resolved market pays a linear
    // factor per share, which is additive and correct.
    const market: ProfitMarket = {
      id: 'mkt', workspaceId: 'ws', rangeMin: 0, rangeMax: 1000,
      resolved: true, actualValue: 750,
      shares: [0, 100], liquidity: 100, voided: false,
    };
    const profit = computeTradingProfit(
      [market],
      new Map([['trader', 40]]),
      [position(100)],
    ).get('trader') ?? 0;
    // 100 shares x 0.75 payout = 75, minus 40 paid.
    expect(profit).toBeCloseTo(35, 2);
  });
});

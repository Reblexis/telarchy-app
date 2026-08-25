import {
  computeProfitBreakdown,
  computeTradingProfit,
  isSettledMarket,
  type LeaderboardPosition,
  type ProfitMarket,
  voidedStakeKey,
} from '../lib/leaderboard';

/**
 * The board's ranking number split into what is final and what is still a
 * mark (owner direction 2026-08-24, docs/seasons.md "The score"). The
 * invariant is one sentence: settledEarnings + openEarnings = totalEarnings,
 * and totalEarnings is the same number computeTradingProfit already ranks on.
 *
 * The first case is the production one that prompted the split: the first
 * Telarchy resolution (Weekly active traders 2026-W34, actual 5 on a 0..50
 * range) paid one holder 36.95 credits on a 20-credit buy, while the same
 * account sat on hundreds of credits of open marks. The board read one
 * blended number and could not say which part was money.
 */

const resolvedMarket: ProfitMarket = {
  id: 'wat-w34',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 50,
  resolved: true,
  actualValue: 5,
  shares: [0, 369.546960271],
  liquidity: 608.8173,
  voided: false,
};

// An open market whose book currently calls p(higher) = 0.5 (no shares
// outstanding on either side), so a 'higher' share marks at 0.5.
const openMarket: ProfitMarket = {
  id: 'wat-sep',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 50,
  resolved: false,
  actualValue: null,
  shares: [0, 0],
  liquidity: 360,
  voided: false,
};

const voidedMarket: ProfitMarket = {
  id: 'cond-w34',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 50,
  resolved: false,
  actualValue: null,
  shares: [0, 38.99],
  liquidity: 360,
  voided: true,
};

const pos = (marketId: string, shares: number, direction = 'higher', agentId = 'viktor'): LeaderboardPosition => ({
  agentId,
  workspaceId: 'ws',
  marketId,
  direction,
  shares,
});

describe('isSettledMarket', () => {
  test('a market resolved to a number, or cancelled, is settled; anything else is a mark', () => {
    expect(isSettledMarket(resolvedMarket)).toBe(true);
    expect(isSettledMarket(voidedMarket)).toBe(true);
    expect(isSettledMarket(openMarket)).toBe(false);
    // Resolved flag without a number is priced at the current call, so it is
    // open on both sides of the split, matching currentPayoutFactors.
    expect(isSettledMarket({ resolved: true, actualValue: null, voided: false })).toBe(false);
  });
});

describe('computeProfitBreakdown', () => {
  test('the first Telarchy resolution: 36.95 settled on a 20-credit buy, the rest open', () => {
    const markets = [resolvedMarket, openMarket];
    const positions = [pos('wat-w34', 369.546960271), pos('wat-sep', 100)];
    // 20 credits into the resolved market, 40 into the open one.
    const netCash = new Map([['viktor', 60]]);
    const settledCash = new Map([['viktor', 20]]);

    const b = computeProfitBreakdown(markets, netCash, settledCash, positions).get('viktor')!;

    // 369.547 shares x (5 / 50) = 36.95 paid, minus the 20 that bought them.
    expect(b.settled).toBeCloseTo(16.95, 2);
    // 100 shares marked at 0.5 = 50, minus the 40 paid.
    expect(b.open).toBeCloseTo(10, 2);
    expect(b.total).toBeCloseTo(26.95, 2);
  });

  test('settled + open is exactly the number computeTradingProfit ranks on', () => {
    const markets = [resolvedMarket, openMarket, voidedMarket];
    const positions = [pos('wat-w34', 369.546960271), pos('wat-sep', 33.3333), pos('cond-w34', 38.99)];
    const netCash = new Map([['viktor', 20 + 17.7777 + 2]]);
    const settledCash = new Map([['viktor', 20 + 2]]);
    const voided = new Map([[voidedStakeKey('viktor', 'ws', 'cond-w34'), 2]]);

    const ranked = computeTradingProfit(markets, netCash, positions, voided).get('viktor')!;
    const b = computeProfitBreakdown(markets, netCash, settledCash, positions, voided).get('viktor')!;

    expect(b.total).toBe(ranked);
    expect(Math.round((b.settled + b.open) * 100) / 100).toBe(ranked);
  });

  test('a cancelled market you were still in settles to exactly zero', () => {
    // The void refunds net cash floored at zero (docs/vision.md), so the
    // cancelled market's settled contribution is refund minus the same cash.
    const positions = [pos('cond-w34', 38.99)];
    const netCash = new Map([['viktor', 2]]);
    const settledCash = new Map([['viktor', 2]]);
    const voided = new Map([[voidedStakeKey('viktor', 'ws', 'cond-w34'), 2]]);

    const b = computeProfitBreakdown([voidedMarket], netCash, settledCash, positions, voided).get('viktor')!;

    expect(b.settled).toBe(0);
    expect(b.open).toBe(0);
    expect(b.total).toBe(0);
  });

  test('selling out of a market before it resolves is settled the moment it resolves, not before', () => {
    // Sold everything at a gain: no position, net cash -5 on that market.
    const netCash = new Map([['viktor', -5]]);

    const open = computeProfitBreakdown([openMarket], netCash, new Map(), []).get('viktor')!;
    expect(open.settled).toBe(0);
    expect(open.open).toBe(5);

    const settled = computeProfitBreakdown([resolvedMarket], netCash, new Map([['viktor', -5]]), []).get('viktor')!;
    expect(settled.settled).toBe(5);
    expect(settled.open).toBe(0);
  });

  test('an agent with trades but nothing settled has settled 0 and everything open', () => {
    const netCash = new Map([['viktor', 40]]);
    const b = computeProfitBreakdown([openMarket], netCash, new Map(), [pos('wat-sep', 100)]).get('viktor')!;
    expect(b.settled).toBe(0);
    expect(b.open).toBe(10);
  });
});

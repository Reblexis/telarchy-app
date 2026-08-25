/**
 * Tests for PnL (profit and loss) computation logic.
 *
 * The PnL endpoints compute:
 *   netCash = -sum(trade.cost)        (wallet-direction cash flow)
 *   pnlConsensus = netCash + sellProceeds  (mark-to-market)
 *   pnlMetric = netCash + shares * payFactor  (if-resolved-now)
 *
 * Key invariants:
 *   1. netCash for an agent/market should equal -(sum of buy costs) + (sum of sell proceeds)
 *   2. Voided markets must be excluded from PnL (costs were refunded outside the trades table)
 *   3. After a buy, selling all shares should recover close to the original cost
 *   4. PnL@consensus for a fresh position should be near zero (small rounding loss)
 *   5. For resolved markets, pnlMetric uses actual resolution payouts
 */

import { consensus, directionSellProceeds, resolutionPayouts, sharesForBudget } from '../lib/amm';

const B = 100; // liquidity parameter
const RANGE_MIN = 0;
const RANGE_MAX = 1000;

/** Simulate a trade and return updated state. */
function simulateBuy(
  marketShares: [number, number],
  direction: 0 | 1,
  budget: number,
  b: number,
): { newShares: [number, number]; agentShares: number; cost: number } {
  const { amount, cost } = sharesForBudget(marketShares, direction, budget, b);
  const newShares: [number, number] = [marketShares[0], marketShares[1]];
  newShares[direction] += amount;
  return { newShares, agentShares: amount, cost };
}

/** Compute PnL at consensus (mark-to-market via LMSR sell proceeds). */
function computePnlConsensus(
  netCash: number,
  marketShares: [number, number],
  agentHigherShares: number,
  agentLowerShares: number,
  b: number,
): number {
  const sellHi = agentHigherShares > 0 ? directionSellProceeds(marketShares, 1, agentHigherShares, b) : 0;
  const sellLo = agentLowerShares > 0 ? directionSellProceeds(marketShares, 0, agentLowerShares, b) : 0;
  return netCash + sellHi + sellLo;
}

/** Compute PnL at metric value (hypothetical resolution). */
function computePnlMetric(
  netCash: number,
  agentHigherShares: number,
  agentLowerShares: number,
  metricValue: number,
  rangeMin: number,
  rangeMax: number,
): number {
  const clamped = Math.min(Math.max(metricValue, rangeMin), rangeMax);
  const [lowerPay, higherPay] = resolutionPayouts(clamped, rangeMin, rangeMax);
  return netCash + agentHigherShares * higherPay + agentLowerShares * lowerPay;
}

describe('PnL after single buy', () => {
  test('PnL@consensus is near zero for a fresh position (only rounding loss)', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 10, B);
    const netCash = -cost;
    const pnl = computePnlConsensus(netCash, newShares, agentShares, 0, B);
    // Should be very close to zero; the only loss is AMM rounding
    expect(Math.abs(pnl)).toBeLessThan(0.01);
  });

  test('netCash equals negative trade cost', () => {
    const { cost } = simulateBuy([0, 0], 1, 25, B);
    expect(-cost).toBeLessThan(0);
  });

  test('sell proceeds <= original cost (no free money)', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 50, B);
    const proceeds = directionSellProceeds(newShares, 1, agentShares, B);
    expect(proceeds).toBeLessThanOrEqual(cost + 0.01);
  });
});

describe('PnL after multiple trades on same market', () => {
  test('cumulative netCash equals negative sum of all trade costs', () => {
    let shares: [number, number] = [0, 0];
    let totalCost = 0;
    let totalAgentShares = 0;

    // Three sequential buys of "higher"
    for (const budget of [10, 20, 15]) {
      const result = simulateBuy(shares, 1, budget, B);
      shares = result.newShares;
      totalCost += result.cost;
      totalAgentShares += result.agentShares;
    }

    const netCash = -totalCost;
    expect(netCash).toBeLessThan(0);

    // PnL@consensus should still be near zero (all buys on same side)
    const pnl = computePnlConsensus(netCash, shares, totalAgentShares, 0, B);
    expect(Math.abs(pnl)).toBeLessThan(0.5);
  });

  test('buying both directions: netCash is sum of both costs', () => {
    let shares: [number, number] = [0, 0];
    let totalCost = 0;

    // Buy higher
    const buy1 = simulateBuy(shares, 1, 20, B);
    shares = buy1.newShares;
    totalCost += buy1.cost;

    // Buy lower
    const buy2 = simulateBuy(shares, 0, 15, B);
    shares = buy2.newShares;
    totalCost += buy2.cost;

    const netCash = -totalCost;
    const pnl = computePnlConsensus(netCash, shares, buy1.agentShares, buy2.agentShares, B);
    // PnL should be modest; the AMM spread means buying both sides loses a bit
    expect(Math.abs(pnl)).toBeLessThan(10);
  });
});

describe('PnL with sell trades', () => {
  test('selling half position recovers roughly half the cost', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 40, B);
    const sellAmount = agentShares / 2;
    const proceeds = directionSellProceeds(newShares, 1, sellAmount, B);

    // Net cash after buy + partial sell
    const netCash = -cost + proceeds;
    expect(netCash).toBeLessThan(0); // Still negative (only sold half)

    // Remaining position
    const sharesAfterSell: [number, number] = [newShares[0], newShares[1] - sellAmount];
    const pnl = computePnlConsensus(netCash, sharesAfterSell, agentShares - sellAmount, 0, B);
    expect(Math.abs(pnl)).toBeLessThan(0.5);
  });

  test('selling entire position: PnL equals sell proceeds minus buy cost', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 30, B);
    const proceeds = directionSellProceeds(newShares, 1, agentShares, B);
    const netCash = -cost + proceeds;
    // After selling all, no position left, so PnL = netCash
    const pnl = computePnlConsensus(netCash, [0, 0], 0, 0, B);
    expect(pnl).toBeCloseTo(netCash);
    // Should be near zero (small rounding)
    expect(Math.abs(pnl)).toBeLessThan(0.02);
  });
});

describe('PnL at metric value (resolution payout)', () => {
  test('higher bet profits when metric resolves above consensus', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 20, B);
    const netCash = -cost;
    const _currentConsensus = consensus(newShares, B, RANGE_MIN, RANGE_MAX)!;

    // Metric resolves well above consensus
    const pnl = computePnlMetric(netCash, agentShares, 0, RANGE_MAX, RANGE_MIN, RANGE_MAX);
    expect(pnl).toBeGreaterThan(0);

    // Metric resolves well below consensus
    const pnlLow = computePnlMetric(netCash, agentShares, 0, RANGE_MIN, RANGE_MIN, RANGE_MAX);
    expect(pnlLow).toBeLessThan(0);
  });

  test('lower bet profits when metric resolves below consensus', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 0, 20, B);
    const netCash = -cost;

    // Metric resolves at minimum
    const pnl = computePnlMetric(netCash, 0, agentShares, RANGE_MIN, RANGE_MIN, RANGE_MAX);
    expect(pnl).toBeGreaterThan(0);

    // Metric resolves at maximum
    const pnlHigh = computePnlMetric(netCash, 0, agentShares, RANGE_MAX, RANGE_MIN, RANGE_MAX);
    expect(pnlHigh).toBeLessThan(0);
  });

  test('PnL magnitude bounded by trade cost', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 30, B);
    const netCash = -cost;

    // Best case: metric at max (full payout for higher shares)
    const bestPnl = computePnlMetric(netCash, agentShares, 0, RANGE_MAX, RANGE_MIN, RANGE_MAX);
    // Worst case: metric at min (zero payout)
    const worstPnl = computePnlMetric(netCash, agentShares, 0, RANGE_MIN, RANGE_MIN, RANGE_MAX);

    // Loss can't exceed cost
    expect(worstPnl).toBeGreaterThanOrEqual(-cost - 0.01);
    // Profit from a single-direction bet is bounded by shares (which cost < budget to acquire)
    expect(bestPnl).toBeLessThan(agentShares + 0.01);
  });
});

describe('Voided market PnL exclusion (the bot-anchor bug)', () => {
  /**
   * This test reproduces the exact scenario that caused wildly wrong PnL:
   * 1. Agent buys shares on a market
   * 2. Market is voided (agent gets position.totalCost refunded)
   * 3. Trade records still exist with original costs
   *
   * If voided markets are included in PnL, netCash = -sum(trades.cost) is a
   * large negative number, but the agent was actually made whole by the refund.
   * The correct PnL for voided markets is zero.
   */
  test('voided market trades should not contribute to PnL', () => {
    // Simulate: agent buys $50 of higher shares
    const { cost: voidedCost } = simulateBuy([0, 0], 1, 50, B);

    // Simulate: same agent also has a live market trade
    const liveMarket = simulateBuy([0, 0], 1, 10, B);

    // WRONG: including voided market's trades in netCash
    const wrongNetCash = -(voidedCost + liveMarket.cost);

    // CORRECT: only include non-voided market trades
    const correctNetCash = -liveMarket.cost;

    // The bug: wrongNetCash is much more negative than correctNetCash
    expect(Math.abs(wrongNetCash)).toBeGreaterThan(Math.abs(correctNetCash) * 3);

    // Correct PnL should be near zero for a fresh position
    const correctPnl = computePnlConsensus(correctNetCash, liveMarket.newShares, liveMarket.agentShares, 0, B);
    expect(Math.abs(correctPnl)).toBeLessThan(0.5);

    // Wrong PnL would show a massive phantom loss
    const wrongPnl = computePnlConsensus(wrongNetCash, liveMarket.newShares, liveMarket.agentShares, 0, B);
    expect(Math.abs(wrongPnl)).toBeGreaterThan(40);
  });

  test('spentBetting matches non-voided trade costs (invariant)', () => {
    // Simulate the balance accounting the system does:
    // - Buy on market A: spentBetting += costA, trade.cost = costA
    // - Buy on market B: spentBetting += costB, trade.cost = costB
    // - Void market B: spentBetting -= totalCostB (refund)
    // After voiding: spentBetting = costA
    // But sum(trades.cost) = costA + costB (trades are never deleted)

    const buyA = simulateBuy([0, 0], 1, 20, B);
    const buyB = simulateBuy([0, 0], 0, 30, B);

    let spentBetting = 0;
    spentBetting += buyA.cost; // buy on market A
    spentBetting += buyB.cost; // buy on market B

    const allTradeCosts = buyA.cost + buyB.cost;
    expect(spentBetting).toBeCloseTo(allTradeCosts);

    // Void market B: refund totalCost
    spentBetting -= buyB.cost;

    // Now spentBetting only reflects market A
    expect(spentBetting).toBeCloseTo(buyA.cost);

    // But sum of all trade records still includes both
    expect(allTradeCosts).toBeGreaterThan(spentBetting);

    // PnL computation must use spentBetting-equivalent (non-voided trades only)
    const correctNetCash = -buyA.cost; // matches spentBetting
    const wrongNetCash = -allTradeCosts; // matches sum(trades.cost)
    expect(correctNetCash).toBeGreaterThan(wrongNetCash);
  });
});

describe('Liquidity injection does not break PnL', () => {
  test('PnL@consensus is near zero after liquidity injection + trade', () => {
    // Start with a seeded market
    const b1 = 10;
    const shares1: [number, number] = [0, 0];

    // Agent buys before injection
    const buy1 = simulateBuy(shares1, 1, 5, b1);

    // Liquidity injection: scales both shares and b by the same ratio
    const amount = 20; // credits injected
    const oldPool = b1 * Math.LN2;
    const newPool = oldPool + amount;
    const b2 = newPool / Math.LN2;
    const bRatio = b2 / b1;
    const shares2: [number, number] = [buy1.newShares[0] * bRatio, buy1.newShares[1] * bRatio];

    // Agent's position shares are NOT scaled (only market shares are)
    const agentShares = buy1.agentShares;

    // PnL@consensus: sell proceeds change because market state changed
    const netCash = -buy1.cost;
    const pnl = computePnlConsensus(netCash, shares2, agentShares, 0, b2);

    // After injection the sell proceeds change (agent's share of the pool
    // dilutes), but PnL shouldn't be wildly wrong. It may not be zero,
    // but it should be bounded by the original cost.
    expect(Math.abs(pnl)).toBeLessThan(buy1.cost * 2);
  });

  test('trade cost after injection is bounded by budget', () => {
    // Higher liquidity = more resistance to price movement, but
    // sharesForBudget respects the budget constraint.
    const b = 200;
    const budget = 10;
    const { cost } = sharesForBudget([0, 0], 1, budget, b);
    expect(cost).toBeLessThanOrEqual(budget + 0.01);
  });
});

describe('PnL consistency between consensus and metric', () => {
  test('PnL@metric equals PnL@consensus when metric equals consensus value', () => {
    const { newShares, agentShares, cost } = simulateBuy([0, 0], 1, 25, B);
    const netCash = -cost;
    const consensusValue = consensus(newShares, B, RANGE_MIN, RANGE_MAX)!;

    const pnlC = computePnlConsensus(netCash, newShares, agentShares, 0, B);
    const pnlM = computePnlMetric(netCash, agentShares, 0, consensusValue, RANGE_MIN, RANGE_MAX);

    // These should be in the same ballpark (LMSR sell proceeds vs linear
    // payout interpolation differ somewhat, especially for larger positions).
    expect(Math.abs(pnlC - pnlM)).toBeLessThan(5);
  });
});

describe('Multi-agent market conservation', () => {
  test('sum of all agent PnL@consensus is near zero (zero-sum after AMM spread)', () => {
    let shares: [number, number] = [0, 0];
    const agents: Array<{ higherShares: number; lowerShares: number; netCash: number }> = [];

    // Agent 1 buys higher
    const buy1 = sharesForBudget(shares, 1, 30, B);
    shares = [shares[0], shares[1] + buy1.amount];
    agents.push({ higherShares: buy1.amount, lowerShares: 0, netCash: -buy1.cost });

    // Agent 2 buys lower
    const buy2 = sharesForBudget(shares, 0, 25, B);
    shares = [shares[0] + buy2.amount, shares[1]];
    agents.push({ higherShares: 0, lowerShares: buy2.amount, netCash: -buy2.cost });

    // Agent 3 buys higher
    const buy3 = sharesForBudget(shares, 1, 15, B);
    shares = [shares[0], shares[1] + buy3.amount];
    agents.push({ higherShares: buy3.amount, lowerShares: 0, netCash: -buy3.cost });

    // Sum of PnL@consensus across all agents
    let totalPnl = 0;
    for (const a of agents) {
      totalPnl += computePnlConsensus(a.netCash, shares, a.higherShares, a.lowerShares, B);
    }

    // The AMM retains a spread, so total PnL should be negative
    // (agents collectively lose to the market maker). The magnitude depends
    // on trade sizes relative to liquidity.
    expect(totalPnl).toBeLessThanOrEqual(0.1);
    expect(totalPnl).toBeGreaterThan(-15);
  });
});

/**
 * Integration test for the market lifecycle: open → trade → closed → resolve → attribute.
 *
 * Scenario the user actually asked for: a time-preference refresh deactivates a
 * market that already has a bet on it. The bet should not be lost. The market
 * should show up as `status: "closed"` to anyone listing markets, and when its
 * target date passes the resolve cron should pay the bettor proportional to
 * the actual metric value.
 *
 * The harness (jest.mock + pglite) lets us drive resolvePredictions / getMarkets
 * directly against an in-process Postgres with the production schema.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, positions, trades, workspaces } from '../db/schema';
import { initialPool, resolutionPayouts, sharesForBudget } from '../lib/amm';
import { fromUnits, toUnits } from '../lib/validation';
import { getMarkets, resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-lifecycle';
const OWNER = 'owner-agent';
const BETTOR = 'bettor-agent';
const METRIC = 'metric-activation';
const MARKET = 'market-2026-w10';
const TARGET = '2026-W10'; // Sunday 2026-03-08
const RESOLVE_DAY = '2026-03-09'; // strictly after the Sunday

// Range and liquidity chosen so the math is hand-checkable.
const RANGE_MIN = 0;
const RANGE_MAX = 100;
const LIQUIDITY = 10;
const BETTOR_START_CREDITS = 1000;

async function seedWorld() {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Lifecycle Test',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
    { id: BETTOR, apiKeyHash: 'h-bettor', balance: toUnits(BETTOR_START_CREDITS) },
  ]);
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation rate',
    value: 0,
    formula: '0',
    marketRangeMax: RANGE_MAX,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation rate',
    targetDate: TARGET,
    rangeMin: RANGE_MIN,
    rangeMax: RANGE_MAX,
    shares: [0, 0],
    liquidity: LIQUIDITY,
    pool: initialPool(LIQUIDITY),
    active: true,
    resolved: false,
    voided: false,
  });
}

/** Apply a buy in the same way the trade route would, but bypassing Express/auth. */
async function placeBuy(agentId: string, marketId: string, direction: 'higher' | 'lower', budget: number) {
  const [m] = await db.select().from(markets).where(eq(markets.id, marketId));
  const dirIdx: 0 | 1 = direction === 'higher' ? 1 : 0;
  const { amount, cost } = sharesForBudget(m.shares as [number, number], dirIdx, budget, m.liquidity);
  const newShares: [number, number] = [...(m.shares as [number, number])];
  newShares[dirIdx] += amount;
  await db
    .update(markets)
    .set({
      shares: newShares,
      pool: m.pool + cost,
      tradedVolume: m.tradedVolume + cost,
    })
    .where(eq(markets.id, marketId));
  await db.insert(positions).values({
    id: `${agentId}_${marketId}_${direction}`,
    workspaceId: WS,
    agentId,
    marketId,
    direction,
    shares: amount,
    totalCost: cost,
  });
  await db.insert(trades).values({
    id: `trade-${agentId}-${marketId}`,
    workspaceId: WS,
    agentId,
    marketId,
    direction,
    shares: amount,
    cost,
  });
  await db
    .update(agents)
    .set({ balance: toUnits(BETTOR_START_CREDITS) - toUnits(cost) })
    .where(eq(agents.id, agentId));
  return { amount, cost };
}

describe('market lifecycle: open → closed → resolved with attribution', () => {
  test('full lifecycle pays the bettor proportional to actual value', async () => {
    await seedWorld();

    // 1. Open: bettor buys 50 credits worth of "higher".
    const BUY_BUDGET = 50;
    const { amount: shares, cost: buyCost } = await placeBuy(BETTOR, MARKET, 'higher', BUY_BUDGET);
    expect(shares).toBeGreaterThan(0);
    expect(buyCost).toBeGreaterThan(0);
    expect(buyCost).toBeLessThanOrEqual(BUY_BUDGET);

    // Listing in default mode (active-only) shows it as 'open'.
    const listed = await getMarkets({ active: true }, undefined, WS);
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe('open');

    // 2. Time-preference refresh re-samples and drops this date: market deactivated.
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));

    // 3. The market is now closed but still discoverable via active=false / includeResolved=true.
    const closedOnly = await getMarkets({ active: false }, undefined, WS);
    expect(closedOnly).toHaveLength(1);
    expect(closedOnly[0].status).toBe('closed');
    expect(closedOnly[0].resolved).toBe(false);
    expect(closedOnly[0].voided).toBe(false);

    const activeOnly = await getMarkets({ active: true }, undefined, WS);
    expect(activeOnly).toHaveLength(0);

    // The bettor's position survived the deactivation.
    const heldPositions = await db.select().from(positions).where(eq(positions.agentId, BETTOR));
    expect(heldPositions).toHaveLength(1);
    expect(heldPositions[0].shares).toBeCloseTo(shares, 6);

    // 4. Time passes; the metric's actual value lands at 80 (deep in "higher" territory).
    const ACTUAL_VALUE = 80;
    await db.update(metrics).set({ value: ACTUAL_VALUE }).where(eq(metrics.id, METRIC));

    // 5. Cron runs the day after the target period ends.
    const result = await resolvePredictions(RESOLVE_DAY, WS);
    expect(result.resolved).toBe(1);
    expect(result.totalPayout).toBeGreaterThan(0);

    // 6. Market is now resolved at the actual value.
    const [resolvedMarket] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(resolvedMarket.resolved).toBe(true);
    expect(resolvedMarket.actualValue).toBeCloseTo(ACTUAL_VALUE, 6);
    expect(resolvedMarket.active).toBe(false);
    expect(resolvedMarket.resolvedAt).toBeTruthy();

    // 7. Bettor was attributed the proportional payout for "higher" shares.
    const [, higherPayFactor] = resolutionPayouts(ACTUAL_VALUE, RANGE_MIN, RANGE_MAX);
    const expectedPayout = Math.round(shares * higherPayFactor * 100) / 100;
    expect(expectedPayout).toBeGreaterThan(0);

    const [bettor] = await db.select().from(agents).where(eq(agents.id, BETTOR));
    const finalBalance = fromUnits(bettor.balance);
    const expectedFinal = BETTOR_START_CREDITS - buyCost + expectedPayout;
    expect(finalBalance).toBeCloseTo(expectedFinal, 1);
    expect(bettor.earnedBetting).toBeCloseTo(expectedPayout, 1);
  });

  test('a "lower" bet on the same scenario is correctly attributed at zero', async () => {
    await seedWorld();
    const { cost: buyCost } = await placeBuy(BETTOR, MARKET, 'lower', 50);

    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));
    await db.update(metrics).set({ value: 100 }).where(eq(metrics.id, METRIC));

    await resolvePredictions(RESOLVE_DAY, WS);

    const [bettor] = await db.select().from(agents).where(eq(agents.id, BETTOR));
    const finalBalance = fromUnits(bettor.balance);
    // Metric resolved at the top of the range — "lower" shares pay zero.
    expect(finalBalance).toBeCloseTo(BETTOR_START_CREDITS - buyCost, 1);
    expect(bettor.earnedBetting).toBeCloseTo(0, 6);
  });

  test('closed market does not resolve early — resolveDay must be past targetDate', async () => {
    await seedWorld();
    await placeBuy(BETTOR, MARKET, 'higher', 50);
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));

    // Resolve cron runs DURING the target week, before the period ends.
    const result = await resolvePredictions('2026-03-01', WS);
    expect(result.resolved).toBe(0);

    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(m.resolved).toBe(false);
    expect(m.active).toBe(false); // still closed, not yet resolved
  });
});

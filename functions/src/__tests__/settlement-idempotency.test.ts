/**
 * THE RULE: a market settles once, and a void refunds once, however many
 * callers arrive at the same instant.
 *
 * Settlement and void both had the same shape: read the market and the rows
 * to be paid with a plain `db.select` OUTSIDE the transaction, decide, then
 * write `resolved = true` with a WHERE that names only the id and the
 * workspace. Two callers that both read before either committed both paid.
 *
 * That was not hypothetical. Three paths reach settlement and no two of them
 * exclude each other (bug hunt 2026-08-31):
 *
 *   Cloud Scheduler, every 10m   ->  POST /api/cron/resolve   (no lock)
 *   in-process timer, every 10m   ->  runDailyResolve          (lock 71001)
 *   every container boot          ->  startupCatchUp           (lock 71005)
 *
 * and every deploy lands a candidate at --min-instances 1, so a boot-time
 * catch-up running beside the timer is routine rather than rare.
 *
 * Nothing in the suite ran two money operations concurrently before this
 * file, which is why it was invisible. `credit-ledger-reconciliation` cannot
 * see it either: both payouts write honest ledger rows, so the balance still
 * equals the ledger sum. The assertion that catches it is against the
 * PAYOUT, not against the ledger.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, limitOrders, markets, metricLogs, metrics, positions, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits } from '../lib/validation';
import { voidMarket } from '../services/markets';
import { resolveSingleMarket } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-settle-once';
const OWNER = 'agent-settle-owner';
const HOLDER = 'agent-settle-holder';
const MARKET = 'market-settle-once';
const B = 200;

/** A market that is due, with a holder of 100 `higher` shares and a metric
 *  reading that settles it at the top of the range (payout factor 1.0). */
async function seedDueMarket(opts: { withTrade?: boolean } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-settle-owner', balance: 0 },
    { id: HOLDER, apiKeyHash: 'h-settle-holder', balance: 0 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Settle Once',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-settle',
    workspaceId: WS,
    name: 'Throughput',
    value: 100,
    formula: '0',
    marketRangeMax: 100,
  });
  // The fixing is the last reading at or before the period end, so the
  // reading has to be dated inside 2020 for a 2020 market.
  await db.insert(metricLogs).values({
    id: 'log-settle',
    workspaceId: WS,
    metricId: 'metric-settle',
    metricName: 'Throughput',
    value: 100,
    timestamp: new Date('2020-06-01T00:00:00Z'),
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-settle',
    metricName: 'Throughput',
    targetDate: '2020',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 100],
    liquidity: B,
    pool: initialPool(B) + 100,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
  await db.insert(positions).values({
    id: 'pos-settle',
    workspaceId: WS,
    marketId: MARKET,
    agentId: HOLDER,
    direction: 'higher',
    shares: 100,
    totalCost: 60,
  });
  if (opts.withTrade) {
    await db.insert(trades).values({
      id: 'trade-settle',
      workspaceId: WS,
      marketId: MARKET,
      agentId: HOLDER,
      direction: 'higher',
      shares: 100,
      cost: 60,
      createdAt: new Date('2020-03-01T00:00:00Z'),
    });
  }
}

const balanceOf = async (id: string) => {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(row.balance as number);
};

describe('a market settles once, however many resolvers arrive at once', () => {
  test('two concurrent resolves pay the holder once', async () => {
    await seedDueMarket();

    await Promise.all([resolveSingleMarket(MARKET, WS), resolveSingleMarket(MARKET, WS)]);

    // 100 shares at a payout factor of 1.0.
    expect(await balanceOf(HOLDER)).toBe(100);
  });

  test('two concurrent resolves write one payout row, not two', async () => {
    await seedDueMarket();

    await Promise.all([resolveSingleMarket(MARKET, WS), resolveSingleMarket(MARKET, WS)]);

    const { creditLedger } = await import('../db/schema');
    const rows = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.agentId, HOLDER), eq(creditLedger.reason, 'payout')));
    expect(rows).toHaveLength(1);
  });
});

describe('a void refunds once, however many callers arrive at once', () => {
  test('two concurrent voids refund the stake once', async () => {
    await seedDueMarket({ withTrade: true });
    const [market] = await db.select().from(markets).where(eq(markets.id, MARKET));

    await Promise.all([voidMarket(market, WS, 'first'), voidMarket(market, WS, 'second')]);

    // The trader put 60 credits of net cash in; a void returns that, once.
    expect(await balanceOf(HOLDER)).toBe(60);
  });
});

describe('a void hands the LP back the pool, not the pool minus other people money', () => {
  test('a resting limit order is refunded without being taken out of the pool', async () => {
    await seedDueMarket();
    const pool = initialPool(B) + 100;

    // The LP funded the pool.
    await db.insert(await import('../db/schema').then(s => s.liquidityEvents)).values({
      id: 'liq-settle',
      workspaceId: WS,
      marketId: MARKET,
      agentId: OWNER,
      amount: pool,
      poolContribution: pool,
      totalLiquidity: B,
      type: 'injection',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });
    // A rester's budget is held on their OWN balance at placement
    // (routes/predictions.ts, reason 'limit_order_hold'); it never enters
    // markets.pool. Folding its release into the amount subtracted from the
    // pool therefore destroys exactly that many LP credits.
    await db.insert(limitOrders).values({
      id: 'order-settle',
      workspaceId: WS,
      marketId: MARKET,
      agentId: HOLDER,
      direction: 'higher',
      limitValue: 90,
      budgetCredits: 50,
      filledCredits: 0,
      status: 'open',
    });
    await db.delete(positions).where(eq(positions.id, 'pos-settle'));

    const [market] = await db.select().from(markets).where(eq(markets.id, MARKET));
    await voidMarket(market, WS, 'nobody traded it');

    // The rester gets their held budget back...
    expect(await balanceOf(HOLDER)).toBe(50);
    // ...and the LP still gets the whole pool, because the two are different
    // people's money.
    expect(await balanceOf(OWNER)).toBeCloseTo(pool, 2);
  });
});

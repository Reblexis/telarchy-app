/**
 * The price caches must never show a stale price after a mutation.
 *
 * The 2026-08-20 perf pass put a 30s cache on the replay bundle
 * (services/predictions.ts) and a 10s cache on the floor payload
 * (routes/marketplace.ts). Both are fine for strangers arriving in bursts and
 * WRONG the moment a trade lands: a trader whose own trade ticket shows the
 * new price while the chart shows the old one reads the site as broken. The
 * contract: any trade or liquidity event emits on lib/market-events.ts, and
 * every price-facing cache drops the affected entries synchronously.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, liquidityEvents, markets, metrics, trades, workspaces } from '../db/schema';
import { emitPricesChanged } from '../lib/market-events';
import { toUnits } from '../lib/validation';
import { marketPriceSeries } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-cache';
const METRIC = 'metric-cache';
const MARKET = 'market-cache';
const B = 100;

const OPENED = new Date('2026-08-20T10:00:00.000Z');
const T1 = new Date('2026-08-20T10:01:00.000Z');
const T2 = new Date('2026-08-20T10:02:00.000Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'trader', apiKeyHash: 'h-t', balance: toUnits(1000) });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Cache',
    slug: 'cache',
    createdBy: 'trader',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'M',
    value: 10,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'M',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 10],
    liquidity: B,
    pool: B * Math.LN2,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    createdAt: OPENED,
  });
  await db.insert(liquidityEvents).values({
    id: 'liq-open',
    workspaceId: WS,
    marketId: MARKET,
    agentId: 'trader',
    amount: B * Math.LN2,
    poolContribution: B * Math.LN2,
    totalLiquidity: B,
    type: 'initial',
    createdAt: OPENED,
  });
  await db.insert(trades).values({
    id: 'trade-1',
    workspaceId: WS,
    agentId: 'trader',
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    cost: 5,
    createdAt: T1,
  });
});

async function addTrade(id: string, extraShares: number, at: Date): Promise<void> {
  await db.insert(trades).values({
    id,
    workspaceId: WS,
    agentId: 'trader',
    marketId: MARKET,
    direction: 'higher',
    shares: extraShares,
    cost: 5,
    createdAt: at,
  });
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  const shares = m.shares as [number, number];
  await db
    .update(markets)
    .set({ shares: [shares[0], shares[1] + extraShares] })
    .where(eq(markets.id, MARKET));
}

describe('replay bundle cache', () => {
  it('serves from cache until a price event lands, then recomputes', async () => {
    const before = await marketPriceSeries(MARKET, WS);

    // A raw insert with NO emit: the cache may keep serving the old answer.
    await addTrade('trade-2', 7, T2);
    const cached = await marketPriceSeries(MARKET, WS);
    expect(cached).toEqual(before);

    // The emit every real write path fires: the next read must be fresh.
    emitPricesChanged(WS, MARKET);
    const fresh = await marketPriceSeries(MARKET, WS);
    expect(fresh.length).toBe(before.length + 1);
  });

  it('the replayed series still lands on the live consensus after invalidation', async () => {
    await marketPriceSeries(MARKET, WS); // warm the cache
    await addTrade('trade-2', 7, T2);
    emitPricesChanged(WS, MARKET);
    const series = await marketPriceSeries(MARKET, WS);
    const last = series[series.length - 1];
    expect(last.at.getTime()).toBe(T2.getTime());
    expect(last.consensus).not.toBeNull();
  });

  it('a workspace-wide emit (no marketId) clears every market in it', async () => {
    const before = await marketPriceSeries(MARKET, WS);
    await addTrade('trade-2', 7, T2);
    emitPricesChanged(WS);
    const fresh = await marketPriceSeries(MARKET, WS);
    expect(fresh.length).toBe(before.length + 1);
  });
});

describe('every price write path emits (source pins)', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it.each([
    ['services/trading.ts'], // the one place a trade happens
    ['services/marketLiquidity.ts'], // liquidity injections
    ['services/proposals.ts'], // proposal-subsidised market spawns
    ['services/markets.ts'], // market refresh spawns
    ['routes/predictions.ts'], // manual market creation + top-ups
  ])('%s emits price changes', file => {
    expect(read(file)).toContain('emitPricesChanged(');
  });
});

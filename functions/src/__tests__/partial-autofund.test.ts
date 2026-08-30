/**
 * Auto-fund funds as many new markets as the owner's balance covers, never
 * all or nothing (docs/guides/credits.md). On 2026-08-27 three day markets
 * opened at zero liquidity because the balance covered two of them.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { toUnits } from '../lib/validation';
import { insertPendingMarkets } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-partial';
const OWNER = 'owner-partial';

async function seed(balance: number) {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-partial', balance: toUnits(balance) });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Partial',
    createdBy: OWNER,
    visibility: 'private',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: 100,
  });
  await db
    .insert(metrics)
    .values({ id: 'm-partial', workspaceId: WS, name: 'Level', value: 50, formula: '0', marketRangeMax: 100 });
}

const pending = (ids: string[]) =>
  ids.map(id => ({
    marketId: id,
    metricId: 'm-partial',
    metricName: 'Level',
    targetDate: `2030-${id.slice(-2)}`,
    rangeMax: 100,
  }));

test('a balance that covers two of three funds two and opens the third unfunded', async () => {
  await seed(250);
  await insertPendingMarkets(pending(['mk-01', 'mk-02', 'mk-03']), WS);
  const rows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
  const funded = rows
    .filter(r => (r.pool ?? 0) > 0)
    .map(r => r.id)
    .sort();
  const unfunded = rows.filter(r => (r.pool ?? 0) === 0).map(r => r.id);
  expect(funded).toEqual(['mk-01', 'mk-02']);
  expect(unfunded).toEqual(['mk-03']);
  const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
  expect(Number(owner.balance)).toBe(toUnits(50));
});

test('a balance that covers none opens all unfunded and spends nothing', async () => {
  await seed(30);
  await insertPendingMarkets(pending(['mk-01', 'mk-02']), WS);
  const rows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
  expect(rows.every(r => (r.pool ?? 0) === 0)).toBe(true);
  const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
  expect(Number(owner.balance)).toBe(toUnits(30));
});

/**
 * The bought liquidity wallet is pool money and funds markets like any
 * other pool money (owner report 2026-08-30: the house account was granted
 * 1,000,000 liquidity credits and new markets still spawned dead, because
 * the gate read `balance` while the injection spends the wallet first).
 */
test('a full liquidity wallet funds new markets even with no tradeable balance', async () => {
  await seed(0);
  await db
    .update(agents)
    .set({ liquidityBalance: toUnits(1000) })
    .where(eq(agents.id, OWNER));

  await insertPendingMarkets(pending(['mk-11', 'mk-12']), WS);

  const rows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
  expect(
    rows
      .filter(r => (r.pool ?? 0) > 0)
      .map(r => r.id)
      .sort(),
  ).toEqual(['mk-11', 'mk-12']);
  // Paid out of the wallet, and the tradeable balance never went negative.
  const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
  expect(Number(owner.liquidityBalance)).toBe(toUnits(800));
  expect(Number(owner.balance)).toBe(0);
});

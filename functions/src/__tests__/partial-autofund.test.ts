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

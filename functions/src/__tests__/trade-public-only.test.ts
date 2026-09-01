/**
 * THE RULE: trading happens on a public floor and nowhere else.
 *
 * A season scores every workspace that is public AT SETTLEMENT, over every
 * market that resolved inside its window. So a floor that could be traded in
 * private and published at the end contributed a whole month of score at
 * once, with nobody having seen any of it, and the clause in docs/seasons.md
 * that would have caught it ("a floor published mid-season counts from the
 * moment it is public") was never implemented (bug hunt 2026-08-31, P1-9).
 *
 * Owner decision 2026-09-01: "trading should be possible on public workspaces
 * only, private is for now only for management and initial creation." A floor
 * that is not public is for building the thing; trading only where everyone
 * can watch makes the publish-at-the-end shape impossible rather than merely
 * against the rules.
 *
 * The gate is inside executeTradeInTx, which is the one door all three
 * callers go through: the trade route, its dry-run quote, and the limit-order
 * sweep. A resting order on a floor that goes private does not fill.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, positions, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-tpo';
const TRADER = 'agent-tpo';
const MARKET = 'market-tpo';
const B = 200;
const TARGET = '2099-06';

async function seed(visibility: 'public' | 'unlisted' | 'private') {
  await db.insert(agents).values([
    { id: 'agent-tpo-owner', apiKeyHash: 'h-tpo-o', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-tpo-t', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Trade Public Only',
    createdBy: 'agent-tpo-owner',
    ownerAgentId: 'agent-tpo-owner',
    visibility,
  });
  await db.insert(metrics).values({
    id: 'metric-tpo',
    workspaceId: WS,
    name: 'Revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-tpo',
    metricName: 'Revenue',
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 1000,
    shares: [0, 50],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
  await db.insert(positions).values({
    id: `${TRADER}_${MARKET}_higher`,
    workspaceId: WS,
    marketId: MARKET,
    agentId: TRADER,
    direction: 'higher',
    shares: 50,
    totalCost: 30,
  });
}

const trade = async (mode: unknown) => {
  const { executeTradeInTx } = await import('../services/trading');
  return db.transaction(async tx =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeTradeInTx(tx as any, { workspaceId: WS, agentId: TRADER, marketId: MARKET, mode: mode as any }),
  );
};
const buy = () => trade({ type: 'buy', direction: 1, dirLabel: 'higher', amount: 10 });
const sell = () => trade({ type: 'sell', direction: 1, dirLabel: 'higher', sellShares: 10 });

describe('a floor that is not public does not trade', () => {
  test('a buy on a private floor is refused', async () => {
    await seed('private');
    await expect(buy()).rejects.toThrow(/public/i);
  });

  test('a buy on an unlisted floor is refused', async () => {
    await seed('unlisted');
    await expect(buy()).rejects.toThrow(/public/i);
  });

  test('a sell is refused too: it is not an escape hatch out of an unpublished floor', async () => {
    await seed('unlisted');
    await expect(sell()).rejects.toThrow(/public/i);
  });

  test('the refusal moves no money and no shares', async () => {
    await seed('private');
    await buy().catch(() => {});
    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(m.shares).toEqual([0, 50]);
    const [a] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(a.balance).toBe(toUnits(5000));
  });
});

describe('a public floor trades normally', () => {
  test('a buy is allowed', async () => {
    await seed('public');
    await expect(buy()).resolves.toBeTruthy();
  });

  test('a sell is allowed', async () => {
    await seed('public');
    await expect(sell()).resolves.toBeTruthy();
  });

  test('publishing a floor is what opens it for trading', async () => {
    await seed('unlisted');
    await expect(buy()).rejects.toThrow(/public/i);

    await db.update(workspaces).set({ visibility: 'public' }).where(eq(workspaces.id, WS));

    await expect(buy()).resolves.toBeTruthy();
  });
});

/**
 * THE RULE: the trades ledger records the market's call before and after
 * every trade (docs/ui-conventions.md, "What the platform records at trade
 * time"), written by the trade transaction itself, so a profile can say
 * "moved the market 18.9 -> 20.2" without replaying the book. A redemption
 * moves no price and records nothing.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, positions, trades } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-trc';
const TRADER = 'agent-trc';
const MARKET = 'market-trc';
const B = 200;

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-trc-owner', apiKeyHash: 'h-trc-o', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-trc-t', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Trade Records Consensus',
    createdBy: 'agent-trc-owner',
    ownerAgentId: 'agent-trc-owner',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-trc',
    workspaceId: WS,
    name: 'Revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-trc',
    metricName: 'Revenue',
    targetDate: '2099-06',
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

describe('a trade records the call before and after it', () => {
  test('a buy writes consensusBefore as the call it found and consensusAfter as the call it left', async () => {
    await seed();
    const before = consensus([0, 50], B, 0, 1000)!;
    await trade({ type: 'buy', direction: 1, dirLabel: 'higher', amount: 100 });
    const [row] = await db.select().from(trades).where(eq(trades.kind, 'trade'));
    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const after = consensus(m.shares as [number, number], B, 0, 1000)!;
    expect(row.consensusBefore).toBeCloseTo(before, 6);
    expect(row.consensusAfter).toBeCloseTo(after, 6);
    expect(row.consensusAfter).toBeGreaterThan(row.consensusBefore as number);
  });

  test('a sell records the move down', async () => {
    await seed();
    await trade({ type: 'sell', direction: 1, dirLabel: 'higher', sellShares: 40 });
    const [row] = await db.select().from(trades).where(eq(trades.kind, 'trade'));
    expect(row.consensusBefore).not.toBeNull();
    expect(row.consensusAfter).not.toBeNull();
    expect(row.consensusAfter as number).toBeLessThan(row.consensusBefore as number);
  });

  test('redemption rows record nothing: they move no price', async () => {
    await seed();
    // Holding 50 higher, a buy of 10 lower leaves matched pairs that the
    // engine redeems right after the buy.
    await trade({ type: 'buy', direction: 0, dirLabel: 'lower', amount: 10 });
    const redeems = await db.select().from(trades).where(eq(trades.kind, 'redeem'));
    expect(redeems.length).toBe(2);
    for (const r of redeems) {
      expect(r.consensusBefore).toBeNull();
      expect(r.consensusAfter).toBeNull();
    }
  });
});

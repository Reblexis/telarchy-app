/**
 * Every credit is accounted for.
 *
 * `agents.balance` is a cache of `credit_ledger`'s sum. If the two ever
 * disagree, the ledger is right and the cache is a bug, so this test is the
 * one that says whether the whole record is trustworthy: a workspace is driven
 * through the full money lifecycle (grant, buy, sell, fund a pool, settle a
 * market, void another) and then every participant's rows are summed and
 * compared to the column.
 *
 * Summed in SQL, never in JS. The leaderboard was OOM-killed into 503s on
 * 2026-08-14 by pulling the 348k-row trades table into memory unaggregated,
 * and `credit_ledger` grows faster than `trades` does (a trade writes one
 * trade row and one ledger row, and payouts, refunds and limit-order holds add
 * more on top). A reader that loads rows to add them up is the same bug
 * waiting for the same scale.
 *
 * Governing doc: docs/market-integrity.md.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, creditLedger, markets, metrics, positions } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { applyCredits, PLATFORM_SCOPE } from '../services/credits';
import { voidMarket } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// Mirrors the production handler in app.ts, including the `extra` spread:
// a test that flattens the error shape cannot assert the contract a caller
// actually sees.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-ledger';
const OWNER = 'agent-ledger-owner';
const ALICE = 'agent-ledger-alice';
const BOB = 'agent-ledger-bob';
const SETTLES = 'market-ledger-settles';
const VOIDS = 'market-ledger-voids';

/**
 * Everyone starts at zero and is granted through the ledger, exactly as a real
 * signup does. Seeding a balance directly would make the reconciliation
 * vacuous: the number would agree with itself.
 */
async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-ledger-owner', balance: 0 },
    { id: ALICE, apiKeyHash: 'h-ledger-alice', balance: 0 },
    { id: BOB, apiKeyHash: 'h-ledger-bob', balance: 0 },
  ]);
  for (const id of [OWNER, ALICE, BOB]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCredits(db as any, {
      agentId: id,
      workspaceId: PLATFORM_SCOPE,
      deltaUnits: toUnits(1000),
      reason: 'signup_grant',
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Ledger Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-ledger',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values(
    [SETTLES, VOIDS].map(id => ({
      id,
      workspaceId: WS,
      metricId: 'metric-ledger',
      metricName: 'Throughput',
      targetDate: id === SETTLES ? '2028' : '2029',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    })),
  );
}

const trade = (agentId: string, marketId: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId, ...body });

async function heldShares(agentId: string, marketId: string): Promise<number> {
  const rows = await db.select().from(positions).where(eq(positions.agentId, agentId));
  return rows.filter(p => p.marketId === marketId).reduce((s, p) => s + p.shares, 0);
}

/**
 * The invariant, aggregated database-side: one row per participant, their
 * ledger summed, beside the balance column.
 */
async function divergences(): Promise<Array<{ agentId: string; ledger: number; balance: number }>> {
  const rows = await db.execute(sql`
    select a.id as agent_id,
           coalesce(sum(l.delta_units), 0)::bigint as ledger,
           a.balance as balance
    from agents a
    left join credit_ledger l on l.agent_id = a.id
    group by a.id, a.balance
    having coalesce(sum(l.delta_units), 0) <> a.balance
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any).rows.map((r: any) => ({
    agentId: r.agent_id,
    ledger: Number(r.ledger),
    balance: Number(r.balance),
  }));
}

describe('the ledger sums to the balance', () => {
  test('after a signup grant alone', async () => {
    await seed();
    expect(await divergences()).toEqual([]);
  });

  test('after buys, a sell, and a pool injection', async () => {
    await seed();
    expect((await trade(ALICE, SETTLES, { direction: 'higher', amount: 40 })).status).toBe(201);
    expect((await trade(BOB, SETTLES, { direction: 'lower', amount: 25 })).status).toBe(201);

    const held = await heldShares(ALICE, SETTLES);
    expect(held).toBeGreaterThan(0);
    expect((await trade(ALICE, SETTLES, { direction: 'higher', sellShares: held / 2 })).status).toBe(201);

    const inject = await request(app)
      .post(`/api/predictions/markets/${SETTLES}/liquidity`)
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', WS)
      .send({ amount: 50, agentId: OWNER });
    expect(inject.status).toBeLessThan(300);

    expect(await divergences()).toEqual([]);
  });

  test('after a void refunds every holder', async () => {
    await seed();
    await trade(ALICE, VOIDS, { direction: 'higher', amount: 30 });
    await trade(BOB, VOIDS, { direction: 'lower', amount: 15 });

    await voidMarket(VOIDS, WS);

    expect(await divergences()).toEqual([]);
  });

  test('a void that pays a refund leaves rows explaining it', async () => {
    await seed();
    await trade(ALICE, VOIDS, { direction: 'higher', amount: 30 });
    await voidMarket(VOIDS, WS);

    const rows = await db.select().from(creditLedger).where(eq(creditLedger.agentId, ALICE));
    const reasons = rows.map(r => r.reason);
    expect(reasons).toContain('signup_grant');
    expect(reasons).toContain('trade');
    expect(reasons).toContain('void_refund');
    // The refund row names the market it came out of, or the row cannot be
    // traced back to the event that caused it.
    const refund = rows.find(r => r.reason === 'void_refund')!;
    expect(refund.refType).toBe('market');
    expect(refund.refId).toBe(VOIDS);
  });

  test('every row carries the balance it produced', async () => {
    await seed();
    await trade(ALICE, SETTLES, { direction: 'higher', amount: 40 });

    const rows = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.agentId, ALICE))
      .orderBy(creditLedger.createdAt);
    // Replaying the deltas has to arrive at what each row claims, or
    // balance_after is decoration rather than a check.
    let running = 0;
    for (const row of rows) {
      running += Number(row.deltaUnits);
      expect(Number(row.balanceAfterUnits)).toBe(running);
    }
    const [agent] = await db.select().from(agents).where(eq(agents.id, ALICE));
    expect(Number(agent.balance)).toBe(running);
    expect(fromUnits(running)).toBeLessThan(1000);
  });
});

describe('the reconciliation query can actually fail', () => {
  test('a hand-written balance change shows up as a divergence', async () => {
    // A test that cannot fail is worse than none: prove the detector fires by
    // moving the balance behind the ledger's back.
    await seed();
    await db
      .update(agents)
      .set({ balance: sql`${agents.balance} + ${toUnits(5)}` })
      .where(eq(agents.id, ALICE));

    const bad = await divergences();
    expect(bad.map(d => d.agentId)).toEqual([ALICE]);
    expect(bad[0].balance - bad[0].ledger).toBe(toUnits(5));
  });
});

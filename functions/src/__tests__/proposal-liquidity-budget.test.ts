/**
 * THE RULE (docs/guides/proposals.md, "Posting one"): `liquidityBudget` is
 * the WHOLE amount a proposer puts behind a proposal, split evenly across
 * the markets it spawns. The proposer is never charged more than the budget
 * they named, and a budget they cannot pay leaves nothing behind.
 *
 * It exists for the form on the floor (docs/ui-conventions.md, "Posting
 * one"): a person names what they spend, not a per-market number times a
 * count they cannot see.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-budget';
const OWNER = 'agent-budget-owner';
const PROPOSER = 'agent-budget-proposer';

async function baseline(id: string, targetDate: string) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: 'metric-budget',
    metricName: 'Revenue',
    targetDate,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-b-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-b-proposer', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Budget', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-budget',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await baseline('mkt-b-nov', '2030-11');
  await baseline('mkt-b-dec', '2030-12');
});

const post = (body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .post('/api/proposals')
    .set('x-test-agent-id', agent)
    .set('x-workspace-id', WS)
    .send({ title: 'A job', ...body });

const balanceOf = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};
const branchesOf = (proposalId: string) =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));

describe('liquidityBudget is the whole amount, split evenly across the markets', () => {
  test('a budget of 400 over two dates opens each of the four branches with 100 and charges 400', async () => {
    const res = await post({ liquidityBudget: 400 });
    expect(res.status).toBe(201);
    expect(res.body.liquiditySubsidy).toBeCloseTo(100, 6);
    const rows = await branchesOf(res.body.id);
    expect(rows).toHaveLength(4);
    for (const m of rows) expect(m.pool).toBeCloseTo(100, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(600, 6);
  });

  test('a proposal with three options splits the same budget over six markets', async () => {
    const res = await post({
      liquidityBudget: 600,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    });
    expect(res.status).toBe(201);
    const rows = await branchesOf(res.body.id);
    expect(rows).toHaveLength(6);
    for (const m of rows) expect(m.pool).toBeCloseTo(100, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(400, 6);
  });

  test('the proposer is never charged more than the budget they named', async () => {
    // 100 over 4 markets divides evenly; 100 over 3 would not, so a third
    // date makes six markets and 100 / 6 rounds DOWN.
    await baseline('mkt-b-oct', '2030-10');
    const res = await post({ liquidityBudget: 100 });
    expect(res.status).toBe(201);
    expect(1000 - (await balanceOf(PROPOSER))).toBeLessThanOrEqual(100 + 1e-9);
    expect(1000 - (await balanceOf(PROPOSER))).toBeGreaterThan(99.99);
  });

  test('the stored per-market subsidy is the split, so a respawn reseeds the same amount', async () => {
    const res = await post({ liquidityBudget: 400 });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, res.body.id));
    expect(row.liquiditySubsidy).toBeCloseTo(100, 6);
    expect(row.subsidyContributions).toEqual({ [PROPOSER]: 100 });
  });

  test('only dates that settle after the deadline share the budget', async () => {
    // A deadline past November leaves the December pair alone: 400 / 2.
    const res = await post({ liquidityBudget: 400, decideBy: '2030-12-05T00:00:00.000Z' });
    expect(res.status).toBe(201);
    const rows = await branchesOf(res.body.id);
    expect(rows).toHaveLength(2);
    for (const m of rows) expect(m.pool).toBeCloseTo(200, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(600, 6);
  });

  test('a budget of 0 is no seed: free to post, books open unfunded', async () => {
    const res = await post({ liquidityBudget: 0 });
    expect(res.status).toBe(201);
    expect(res.body.liquiditySubsidy).toBe(0);
    for (const m of await branchesOf(res.body.id)) expect(m.pool).toBe(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('a floor with no open market charges nothing for a budget', async () => {
    await db.delete(markets).where(eq(markets.workspaceId, WS));
    const res = await post({ liquidityBudget: 400 });
    expect(res.status).toBe(201);
    expect(res.body.liquiditySubsidy).toBe(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });
});

describe('a budget that cannot be honoured leaves nothing behind', () => {
  test('a budget above what the proposer holds is a 400, no proposal, no charge', async () => {
    const res = await post({ liquidityBudget: 1001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
    expect(await db.select().from(proposals).where(eq(proposals.workspaceId, WS))).toHaveLength(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test.each([[-1], ['100'], [null]])('liquidityBudget %p is refused or ignored, never charged', async bad => {
    const res = await post({ liquidityBudget: bad });
    if (bad === null) expect(res.status).toBe(201);
    else expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('naming both liquidityBudget and liquiditySubsidy is a 400: one proposal, one way to say the seed', async () => {
    const res = await post({ liquidityBudget: 400, liquiditySubsidy: 100 });
    expect(res.status).toBe(400);
    expect(await db.select().from(proposals).where(eq(proposals.workspaceId, WS))).toHaveLength(0);
  });

  test('two budgets posted at once never spend the same credits twice', async () => {
    const [a, b] = await Promise.all([post({ liquidityBudget: 800 }), post({ liquidityBudget: 800 })]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(200, 6);
  });
});

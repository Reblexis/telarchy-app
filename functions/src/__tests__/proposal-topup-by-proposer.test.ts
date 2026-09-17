/**
 * THE RULE (docs/guides/proposals.md, "Editing, and getting out"): a proposer
 * may add liquidity to THEIR OWN pending proposal, out of THEIR OWN balance,
 * and to nothing else. Everything else the bulk route does stays behind
 * `manage`.
 *
 * `budget` is the whole amount, split evenly across the proposal's open
 * markets and never exceeded, the same way `liquidityBudget` is on posting.
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
        capabilities: new Set(String(req.headers['x-test-caps'] ?? 'read,trade').split(',')),
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
import { predictionsRouter } from '../routes/predictions';
import { createConditionalMarkets } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-topup';
const OWNER = 'agent-topup-owner';
const PROPOSER = 'agent-topup-proposer';
const STRANGER = 'agent-topup-stranger';
const P = 'prop-topup';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-tu-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-tu-proposer', balance: toUnits(1000) },
    { id: STRANGER, apiKeyHash: 'h-tu-stranger', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Top up', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-tu',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  for (const [id, targetDate] of [
    ['mkt-tu-nov', '2030-11'],
    ['mkt-tu-dec', '2030-12'],
  ])
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: 'metric-tu',
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
  await db.insert(proposals).values({
    id: P,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: 'A job',
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
  await createConditionalMarkets(P, WS, {});
});

const bulk = (agent: string, body: Record<string, unknown>, caps = 'read,trade') =>
  request(app)
    .post('/api/predictions/markets/liquidity/bulk')
    .set('x-test-agent-id', agent)
    .set('x-workspace-id', WS)
    .set('x-test-caps', caps)
    .send(body);
const balanceOf = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};
const branches = () =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, P)));

describe('a proposer may add liquidity to their own pending proposal, and to nothing else', () => {
  test('a budget of 400 puts 100 into each of the four branches and charges the proposer 400', async () => {
    const res = await bulk(PROPOSER, { budget: 400, proposalId: P });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ markets: 4, amountPerMarket: 100 });
    for (const m of await branches()) expect(m.pool).toBeCloseTo(100, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(600, 6);
  });

  test('the top-up is recorded on the proposal, so a respawn reseeds it', async () => {
    await bulk(PROPOSER, { budget: 400, proposalId: P });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, P));
    expect(row.subsidyContributions).toEqual({ [PROPOSER]: 100 });
    expect(row.liquiditySubsidy).toBeCloseTo(100, 6);
  });

  test('the per-market amount still works for a proposer on their own proposal', async () => {
    const res = await bulk(PROPOSER, { amount: 50, proposalId: P });
    expect(res.status).toBe(200);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(800, 6);
  });

  test("a trader who did not post it cannot bulk-fund someone else's proposal", async () => {
    const res = await bulk(STRANGER, { budget: 400, proposalId: P });
    expect(res.status).toBe(403);
    expect(await balanceOf(STRANGER)).toBeCloseTo(1000, 6);
    for (const m of await branches()) expect(m.pool).toBe(0);
  });

  test("without manage, the floor's own books stay out of reach", async () => {
    const res = await bulk(PROPOSER, { amount: 10 });
    expect(res.status).toBe(403);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test("a proposer can never spend another agent's balance", async () => {
    const res = await bulk(PROPOSER, { budget: 400, proposalId: P, agentId: STRANGER });
    expect(res.status).toBe(403);
    expect(await balanceOf(STRANGER)).toBeCloseTo(1000, 6);
  });

  test('a decided proposal is closed to its proposer', async () => {
    await db.update(proposals).set({ status: 'declined' }).where(eq(proposals.id, P));
    const res = await bulk(PROPOSER, { budget: 400, proposalId: P });
    expect(res.status).toBe(403);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('a manager keeps every door: another proposal, by amount', async () => {
    const res = await bulk(OWNER, { amount: 25, proposalId: P }, 'read,trade,manage');
    expect(res.status).toBe(200);
    expect(await balanceOf(OWNER)).toBeCloseTo(900, 6);
  });
});

describe('budget is the whole amount and is never exceeded', () => {
  test('100 over four markets that does not divide evenly rounds DOWN', async () => {
    const res = await bulk(PROPOSER, { budget: 100.000003, proposalId: P });
    expect(res.status).toBe(200);
    expect(1000 - (await balanceOf(PROPOSER))).toBeLessThanOrEqual(100.000003);
  });

  test('a budget above the balance is a 400 and charges nothing', async () => {
    const res = await bulk(PROPOSER, { budget: 1001, proposalId: P });
    expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
    for (const m of await branches()) expect(m.pool).toBe(0);
  });

  test.each([[0], [-5], ['400']])('budget %p is a 400', async bad => {
    const res = await bulk(PROPOSER, { budget: bad, proposalId: P });
    expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('naming both budget and amount is a 400', async () => {
    const res = await bulk(PROPOSER, { budget: 400, amount: 100, proposalId: P });
    expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('a budget without a proposal is a 400: the whole-amount form is for proposals', async () => {
    const res = await bulk(OWNER, { budget: 400 }, 'read,trade,manage');
    expect(res.status).toBe(400);
    expect(await balanceOf(OWNER)).toBeCloseTo(1000, 6);
  });
});

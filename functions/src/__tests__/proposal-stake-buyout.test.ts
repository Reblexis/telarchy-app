/**
 * The stake comes back the moment the owner decides (owner decision
 * 2026-08-10). Decline already refunds via the void; this suite pins the
 * approval half: the owner buys the proposer out of the approved branch's
 * LP position, so the proposer is whole at decision time while the market
 * keeps its depth. And the fallback: a broke owner never blocks an
 * approval; the proposer's claim then simply waits for resolution as it
 * always did.
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

import { and, eq, inArray } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, liquidityEvents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
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

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-buyout';
const OWNER = 'agent-buyout-owner';
const PROPOSER = 'agent-buyout-proposer';

async function seed(ownerBalance: number) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-bo-owner', balance: toUnits(ownerBalance), platformAdmin: true },
    { id: PROPOSER, apiKeyHash: 'h-bo-proposer', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Buyout Test',
    createdBy: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-bo',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-base-bo',
    workspaceId: WS,
    metricId: 'metric-bo',
    metricName: 'Revenue',
    targetDate: '2026-12',
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

function asAgent(agentId: string) {
  return {
    propose: (body: Record<string, unknown>) =>
      request(app)
        .post('/api/proposals')
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS)
        .set('Content-Type', 'application/json')
        .send(body),
    approve: (id: string) =>
      request(app)
        .post(`/api/proposals/${id}/approve`)
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS)
        .send({}),
  };
}

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

describe('approval buys the proposer out', () => {
  test('the whole stake is back at decision time, and the owner holds the LP claim', async () => {
    await seed(1000);
    const created = await asAgent(PROPOSER).propose({
      title: 'Stake me',
      description: 'x',
      liquiditySubsidy: 250,
    });
    expect(created.status).toBe(201);
    // 250 per branch market, two branches: the full 500 left the proposer.
    expect(await balanceOf(PROPOSER)).toBeCloseTo(500, 5);

    const approved = await asAgent(OWNER).approve(created.body.id);
    expect(approved.status).toBe(200);

    // Declined half back via the void, approved half via the owner buy-out.
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 5);
    expect(await balanceOf(OWNER)).toBeCloseTo(750, 5);

    // The approved branch's LP rows now belong to the owner: the market
    // kept its depth and the resolution-time LP refund pays the owner.
    const open = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, created.body.id), eq(markets.resolved, false)));
    expect(open).toHaveLength(1);
    const lp = await db
      .select()
      .from(liquidityEvents)
      .where(
        inArray(
          liquidityEvents.marketId,
          open.map(m => m.id),
        ),
      );
    expect(lp.length).toBeGreaterThan(0);
    for (const row of lp) expect(row.agentId).toBe(OWNER);
  });

  test('a broke owner approves anyway; the stake waits for resolution', async () => {
    await seed(100);
    const created = await asAgent(PROPOSER).propose({
      title: 'Stake me',
      description: 'x',
      liquiditySubsidy: 250,
    });
    expect(created.status).toBe(201);

    const approved = await asAgent(OWNER).approve(created.body.id);
    expect(approved.status).toBe(200);

    // Declined half refunded by the void; the approved half stays as the
    // proposer's LP claim because the owner could not cover it.
    expect(await balanceOf(PROPOSER)).toBeCloseTo(750, 5);
    expect(await balanceOf(OWNER)).toBeCloseTo(100, 5);
  });
});

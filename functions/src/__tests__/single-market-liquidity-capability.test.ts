/**
 * HTTP-level tests for POST /markets/:id/liquidity capability gating.
 *
 * Behavior change (vision.md Phase 5): injecting liquidity from your own
 * balance is a first-class `trade` action, not admin-only. Funding *another*
 * participant's balance (passing `agentId`) still requires `manage`, because
 * it spends someone else's money.
 *
 * These tests pin the real failing cases: a trade-only caller must be able to
 * self-fund, and must be rejected when trying to spend another agent's balance.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// Mock auth: capabilities come from the `x-test-caps` header (comma-separated)
// so each caller can be a trade-only participant or a full admin.
jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const capsHeader = (req.headers['x-test-caps'] as string) || 'read,trade,manage';
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(
          capsHeader
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean),
        ),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
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

const WS = 'ws-liq-single';
const OWNER = 'agent-owner';
const TRADER = 'agent-trader';
const MEMBER = 'agent-member';
const OUTSIDER = 'agent-outsider';
const METRIC = 'metric-liq';
const MARKET = 'market-liq-2028';
const START_CREDITS = 1000;

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
    { id: TRADER, apiKeyHash: 'h-trader', balance: toUnits(START_CREDITS) },
    { id: MEMBER, apiKeyHash: 'h-member', balance: toUnits(START_CREDITS) },
    { id: OUTSIDER, apiKeyHash: 'h-outsider', balance: toUnits(START_CREDITS) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Liquidity Single Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });

  const traderGroup = (await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS))).find(
    g => g.type === 'trader',
  )!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [TRADER, MEMBER] })
    .where(eq(permissionGroups.id, traderGroup.id));

  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

function inject(callerId: string, caps: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/predictions/markets/${MARKET}/liquidity`)
    .set('X-Test-Agent-Id', callerId)
    .set('X-Test-Caps', caps)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('single-market liquidity capability gating', () => {
  test('a trade-only participant can inject from their own balance', async () => {
    await seed();
    const before = (await db.select().from(markets).where(eq(markets.id, MARKET)))[0];

    const res = await inject(TRADER, 'read,trade', { amount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.poolContribution).toBe(5);
    // The pool grew by exactly the contribution.
    const [after] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(after.pool as number).toBeCloseTo((before.pool as number) + 5, 6);
    // b did NOT grow, and that is the rule working rather than a regression
    // (2026-08-31). This fixture is a metric reading 0 on a 0..100 range with
    // a 2028 horizon, so the first credits into an untraded book also move it
    // off the midpoint it was sitting at and down to the value, and an
    // off-centre open is solvent only with a thinner b. The contribution buys
    // a true price here, not depth; the credits are all still in the pool.
    expect(res.body.liquidity).toBeLessThan(before.liquidity as number);

    const [trader] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(fromUnits(trader.balance as number)).toBeCloseTo(START_CREDITS - 5, 6);
  });

  test("a trade-only participant cannot fund another participant's balance", async () => {
    await seed();

    const res = await inject(TRADER, 'read,trade', { amount: 5, agentId: MEMBER });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('requires the "manage" capability');

    // No balance moved on either side.
    const [trader] = await db.select().from(agents).where(eq(agents.id, TRADER));
    const [member] = await db.select().from(agents).where(eq(agents.id, MEMBER));
    expect(fromUnits(trader.balance as number)).toBeCloseTo(START_CREDITS, 6);
    expect(fromUnits(member.balance as number)).toBeCloseTo(START_CREDITS, 6);
  });

  test("a manager can fund another member's balance", async () => {
    await seed();

    const res = await inject(OWNER, 'read,trade,manage', { amount: 5, agentId: MEMBER });
    expect(res.status).toBe(200);
    const [member] = await db.select().from(agents).where(eq(agents.id, MEMBER));
    expect(fromUnits(member.balance as number)).toBeCloseTo(START_CREDITS - 5, 6);
  });
});

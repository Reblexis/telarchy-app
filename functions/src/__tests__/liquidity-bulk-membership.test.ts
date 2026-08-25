/**
 * HTTP-level tests for the bulk liquidity route's workspace-membership guard.
 *
 * "Fund all open markets" spends the funding agent's own balance. The caller
 * is already gated by requireCapability('manage'); the membership recheck only
 * exists to stop an admin from funding a workspace's markets out of some
 * *other* agent's balance via `agentId` in the body.
 *
 * Regression: listParticipantsForWorkspace intentionally omits platform admins,
 * so a platform admin (including a workspace owner flagged platformAdmin) used
 * to hit a spurious "Agent is not in your workspace" when funding from their
 * own balance. Self-funding is now exempt from the recheck.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// Mock the auth middleware (better-auth is ESM-only and can't load through
// ts-jest). req.auth is populated from test headers; the route gate under test
// only depends on req.auth.agentId / workspaceId / capabilities.
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

const WS = 'ws-liq-bulk';
const OWNER = 'agent-owner';
const ADMIN = 'agent-platform-admin';
const MEMBER = 'agent-member';
const OUTSIDER = 'agent-outsider';
const METRIC = 'metric-liq';
const MARKET = 'market-liq-2028';
const START_CREDITS = 1000;

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
    { id: ADMIN, apiKeyHash: 'h-admin', balance: toUnits(START_CREDITS), platformAdmin: true },
    { id: MEMBER, apiKeyHash: 'h-member', balance: toUnits(START_CREDITS) },
    { id: OUTSIDER, apiKeyHash: 'h-outsider', balance: toUnits(START_CREDITS) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Liquidity Bulk Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });

  // MEMBER joins the trader group; ADMIN is a platform admin but is NOT in any
  // group, so listParticipantsForWorkspace excludes it. OUTSIDER is unaffiliated.
  const traderGroup = (await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS))).find(
    g => g.type === 'trader',
  )!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [MEMBER] })
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

function bulkFund(callerId: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/markets/liquidity/bulk')
    .set('X-Test-Agent-Id', callerId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('bulk liquidity workspace-membership guard', () => {
  test('platform admin can fund all open markets from their own balance', async () => {
    await seed();

    const res = await bulkFund(ADMIN, { amount: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ markets: 1, totalCost: 5, amountPerMarket: 5 });

    const [admin] = await db.select().from(agents).where(eq(agents.id, ADMIN));
    expect(fromUnits(admin.balance as number)).toBeCloseTo(START_CREDITS - 5, 6);
  });

  test("admin funding another member's balance still works", async () => {
    await seed();

    const res = await bulkFund(ADMIN, { amount: 5, agentId: MEMBER });
    expect(res.status).toBe(200);
    const [member] = await db.select().from(agents).where(eq(agents.id, MEMBER));
    expect(fromUnits(member.balance as number)).toBeCloseTo(START_CREDITS - 5, 6);
  });

  test("admin cannot fund from a non-member agent's balance", async () => {
    await seed();

    const res = await bulkFund(ADMIN, { amount: 5, agentId: OUTSIDER });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Agent is not in your workspace');
  });
});

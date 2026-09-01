/**
 * A zero-balance trade must say how to get funded, not only that funding is
 * missing.
 *
 * Owner ask (Viktor, 2026-08-31): an agent that registers and cannot trade
 * should be told "it made an agent, but just doesn't have any credits to trade
 * with", and be shown "how to send it money, depending on whether the human is
 * signed up or not". That branch is the rule this file protects: the message a
 * key-only bot needs (someone must pay you) is not the message a human
 * participant needs (top your own balance up).
 *
 * Provenance is already on the row and documented at its definition site in
 * schema.ts: `authUserId` means this human IS this participant, `ownerUserId`
 * means this human OWNS this bot, and neither set means a standalone API
 * registration with nobody behind it.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
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

const WS = 'ws-balance-guidance';
const OWNER = 'agent-guidance-owner';
const STANDALONE = 'standalone-bot';
const OWNED = 'owned-bot';
const HUMAN = 'human-participant';
const METRIC = 'metric-guidance';
const MARKET = 'market-guidance';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(authUser).values([{ id: 'u-guidance', name: 'Owner', email: 'guidance@example.com' }]);
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-guidance-owner', balance: toUnits(0) },
    // A curl registration with nobody behind it.
    { id: STANDALONE, apiKeyHash: 'h-standalone', balance: toUnits(0) },
    // A bot someone created and therefore can fund.
    { id: OWNED, apiKeyHash: 'h-owned', balance: toUnits(0), ownerUserId: 'u-guidance' },
    // A person, trading as themselves.
    { id: HUMAN, apiKeyHash: 'h-human', balance: toUnits(0), authUserId: 'u-guidance' },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Balance Guidance',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [STANDALONE, OWNED, HUMAN] })
    .where(eq(permissionGroups.id, trader.id));

  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
}

const tradeAs = (agentId: string) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, direction: 'higher', amount: 5 });

describe('a zero-balance trade says how to get funded', () => {
  test('every caller still gets the machine-readable balance and cost', async () => {
    for (const who of [STANDALONE, OWNED, HUMAN]) {
      const res = await tradeAs(who);
      expect({ who, status: res.status, balance: res.body.balance }).toEqual({
        who,
        status: 400,
        balance: 0,
      });
      expect(res.body.cost).toBeGreaterThan(0);
    }
  });

  test('a standalone registration is told an identity is not a bankroll, and who can pay it', async () => {
    const res = await tradeAs(STANDALONE);
    expect(res.body.error).toMatch(/identity, not a bankroll/i);
    // It must be able to act on this without guessing the call or its own id.
    expect(res.body.error).toContain('POST /api/agents/transfer');
    expect(res.body.error).toContain(STANDALONE);
  });

  test('an owned bot names the transfer its owner runs', async () => {
    const res = await tradeAs(OWNED);
    expect(res.body.error).toMatch(/owner/i);
    expect(res.body.error).toContain('POST /api/agents/transfer');
    expect(res.body.error).toContain(OWNED);
  });

  test('a human participant is pointed at their own balance, not at being paid', async () => {
    const res = await tradeAs(HUMAN);
    expect(res.body.error).toMatch(/your own balance|top up|earn/i);
    // Telling a person to have somebody else pay them is the wrong branch.
    expect(res.body.error).not.toMatch(/identity, not a bankroll/i);
  });

  test('the guidance is absent when the balance was not the problem', async () => {
    await db
      .update(agents)
      .set({ balance: toUnits(1000) })
      .where(eq(agents.id, STANDALONE));
    const res = await tradeAs(STANDALONE);
    expect(res.status).toBe(201);
  });

  test('resting a limit order at zero balance gets the same guidance as a trade', async () => {
    // Same wall, same persona, one route over: a bot that cannot buy also
    // cannot rest an order, and learning the fix twice in two shapes is how a
    // consistent API stops being consistent.
    const res = await request(app)
      .post('/api/predictions/limit-orders')
      .set('X-Test-Agent-Id', STANDALONE)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', limitValue: 10, budgetCredits: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/identity, not a bankroll/i);
    expect(res.body.error).toContain('POST /api/agents/transfer');
    expect(res.body.balance).toBe(0);
  });
});

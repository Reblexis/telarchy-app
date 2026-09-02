/**
 * HTTP-level tests for the per-market message thread.
 *
 * Mirrors the proposal-messages proposal one level down: each market has
 * its own thread. Used most commonly by AI agents to attach a one-line
 * rationale after a trade ("traded toward 3.5; thesis: channel substitution
 * routes refunds to Stripe").
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

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, marketMessages, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware, hashKey } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const WS = 'ws-market-msgs';
const OWNER = 'agent-owner-mm';
const BOT = 'impact-analyst';
const BOT_KEY = 'test-bot-msg-key';
const METRIC = 'metric-mm';
const MARKET = 'mkt-mm-2026-11';
const OTHER_MARKET = 'mkt-mm-other-2026-11';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-mm', balance: toUnits(0) },
    { id: BOT, apiKeyHash: hashKey(BOT_KEY), balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Market Msg Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
  const traderRows = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const traderGroup = traderRows.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BOT] })
    .where(eq(permissionGroups.id, traderGroup.id));
  await db.insert(agentApiKeys).values({
    hash: hashKey(BOT_KEY),
    keyId: 'key-mm',
    agentId: BOT,
    workspaceId: WS,
    label: 'test',
    scopes: ['*'],
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Mm Metric',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values([
    {
      id: MARKET,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Mm Metric',
      targetDate: '2026-11',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
    {
      id: OTHER_MARKET,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Mm Metric',
      targetDate: '2026-11',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
  ]);
}

const get = (marketId: string) =>
  request(app)
    .get(`/api/predictions/markets/${marketId}/messages`)
    .set('X-Test-Agent-Id', BOT)
    .set('X-Workspace-Id', WS);

const post = (marketId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/predictions/markets/${marketId}/messages`)
    .set('X-Test-Agent-Id', BOT)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

describe('per-market messages', () => {
  test('empty thread starts as []', async () => {
    await seed();
    const r = await get(MARKET);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  test('POST then GET round-trips with correct fields', async () => {
    await seed();
    const r = await post(MARKET, { content: 'Traded toward 3.5. Thesis: channel substitution.' });
    expect(r.status).toBe(201);
    expect(r.body.from).toBe(BOT);
    expect(r.body.marketId).toBe(MARKET);
    expect(r.body.content).toContain('channel substitution');

    const list = await get(MARKET);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].content).toBe('Traded toward 3.5. Thesis: channel substitution.');
    expect(list.body[0].from).toBe(BOT);
  });

  test('messages are scoped to the market — sibling market stays empty', async () => {
    await seed();
    await post(MARKET, { content: 'on the first market' });
    const other = await get(OTHER_MARKET);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
  });

  test('messages are ordered oldest-first', async () => {
    await seed();
    await post(MARKET, { content: 'first' });
    await new Promise(r => setTimeout(r, 5));
    await post(MARKET, { content: 'second' });
    const r = await get(MARKET);
    expect(r.body.map((m: { content: string }) => m.content)).toEqual(['first', 'second']);
  });

  test('non-existent market returns 404 on both GET and POST', async () => {
    await seed();
    expect((await get('ghost-market')).status).toBe(404);
    expect((await post('ghost-market', { content: 'hi' })).status).toBe(404);
  });

  test('missing or non-string content is rejected with 400', async () => {
    await seed();
    expect((await post(MARKET, {})).status).toBe(400);
    expect((await post(MARKET, { content: '' })).status).toBe(400);
    expect((await post(MARKET, { content: 123 as unknown })).status).toBe(400);
  });

  test('content over 5000 chars is rejected', async () => {
    await seed();
    const r = await post(MARKET, { content: 'x'.repeat(5_001) });
    expect(r.status).toBe(400);
  });

  test('messages persist to the marketMessages table', async () => {
    await seed();
    await post(MARKET, { content: 'persisted check' });
    const rows = await db.select().from(marketMessages).where(eq(marketMessages.marketId, MARKET));
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('persisted check');
    expect(rows[0].from).toBe(BOT);
  });
});

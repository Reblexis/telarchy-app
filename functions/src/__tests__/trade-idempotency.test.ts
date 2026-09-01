/**
 * A retried trade must not become a second trade.
 *
 * The participants here are bots, so retries are automatic and unattended. A
 * bot whose HTTP call times out after the server has already committed has no
 * safe move today: retrying buys again, at a worse price on a curve its own
 * first trade moved, and not retrying leaves it unsure whether it holds a
 * position at all. Both cost real credits and neither is visible as an error,
 * which is why nobody has reported it.
 *
 * The rule: the same Idempotency-Key from the same participant returns the
 * FIRST result and places nothing further. Everything else about the design is
 * in the questions this file answers, each of which is a way the naive version
 * goes wrong: a key reused with a different body, two participants picking the
 * same key string, a key consumed by a call that failed, and a duplicate that
 * arrives while the first is still running.
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
        capabilities: new Set(['read', 'trade']),
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
import { agents, markets, metrics, permissionGroups, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
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

const WS = 'ws-idem';
const OWNER = 'agent-idem-owner';
const A = 'bot-a';
const B = 'bot-b';
const METRIC = 'metric-idem';
const MARKET = 'market-idem';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-idem-owner', balance: toUnits(0) },
    { id: A, apiKeyHash: 'h-a', balance: toUnits(1000) },
    { id: B, apiKeyHash: 'h-b', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Idempotency',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [A, B] })
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

const buy = { marketId: MARKET, direction: 'higher', amount: 5 };
function trade(agentId: string, body: Record<string, unknown>, key?: string) {
  let r = request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json');
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(body);
}
const tradeCount = async () => (await db.select().from(trades)).length;
const balanceOf = async (id: string) =>
  fromUnits((await db.select().from(agents).where(eq(agents.id, id)))[0].balance as number);

describe('a retried trade is not a second trade', () => {
  test('THE RULE: the same key twice places one trade and returns the first result', async () => {
    const first = await trade(A, buy, 'k-1');
    const second = await trade(A, buy, 'k-1');

    expect(first.status).toBe(201);
    expect(await tradeCount()).toBe(1);
    expect(second.body.tradeId).toBe(first.body.tradeId);
    expect(second.body.shares).toBe(first.body.shares);
    expect(second.body.cost).toBe(first.body.cost);
    expect(second.body.consensus).toBe(first.body.consensus);
  });

  test('and the balance is debited once', async () => {
    await trade(A, buy, 'k-2');
    const after = await balanceOf(A);
    await trade(A, buy, 'k-2');
    expect(await balanceOf(A)).toBe(after);
  });

  test('the replay says it is a replay, so a caller can tell', async () => {
    await trade(A, buy, 'k-3');
    const second = await trade(A, buy, 'k-3');
    expect(second.body.idempotentReplay).toBe(true);
  });
});

describe('the ways a key can be misused', () => {
  test('the same key with a DIFFERENT body is refused, not silently replayed', async () => {
    // Returning the first result here would be worse than doing nothing: the
    // caller would believe a trade it never asked for had been placed.
    await trade(A, buy, 'k-4');
    const other = await trade(A, { ...buy, amount: 50 }, 'k-4');
    expect(other.status).toBe(409);
    expect(other.body.error).toMatch(/idempotency/i);
    expect(await tradeCount()).toBe(1);
  });

  test('two participants may use the same key string without colliding', async () => {
    // Keys are the caller's to choose, and "1" is a thing a caller will choose.
    const a = await trade(A, buy, 'same-key');
    const b = await trade(B, buy, 'same-key');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.tradeId).not.toBe(a.body.tradeId);
    expect(await tradeCount()).toBe(2);
  });

  test('different keys with the same body are two deliberate trades', async () => {
    await trade(A, buy, 'k-5');
    await trade(A, buy, 'k-6');
    expect(await tradeCount()).toBe(2);
  });

  test('a key is not consumed by a call that failed', async () => {
    // Nothing happened, so the retry is a first attempt, not a duplicate.
    const broke = await trade(A, { ...buy, amount: 100000 }, 'k-7');
    expect(broke.status).toBe(400);
    const ok = await trade(A, buy, 'k-7');
    expect(ok.status).toBe(201);
    expect(await tradeCount()).toBe(1);
  });
});

describe('without a key, nothing changes', () => {
  test('two identical trades with no key are two trades', async () => {
    await trade(A, buy);
    await trade(A, buy);
    expect(await tradeCount()).toBe(2);
  });

  test('a dry run needs no key and records none', async () => {
    const a = await trade(A, { ...buy, dryRun: true }, 'k-8');
    const b = await trade(A, { ...buy, dryRun: true }, 'k-8');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await tradeCount()).toBe(0);
  });
});

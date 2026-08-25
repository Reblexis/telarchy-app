/**
 * Position netting (owner decision 2026-08-11): a trader holds ONE net
 * side. Buying the side opposite to a held position first CLOSES that
 * position, so nobody ends up holding both higher and lower (guaranteed-
 * return dead weight bought at a doubled spread). These tests pin the
 * invariant and the money it moves through the real trade route against a
 * real database.
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
import { agents, markets, metrics, positions } from '../db/schema';
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
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-net';
const TRADER = 'agent-net';
const MARKET = 'market-net';

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-owner-net', apiKeyHash: 'h-owner-net', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-net', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Netting Test',
    createdBy: 'agent-owner-net',
    ownerAgentId: 'agent-owner-net',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-net',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-net',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 500,
    pool: initialPool(500),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

function trade(body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

async function pos(dir: 'higher' | 'lower'): Promise<number> {
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, `${TRADER}_${MARKET}_${dir}`), eq(positions.workspaceId, WS)));
  return row?.shares ?? 0;
}
async function balance(): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, TRADER));
  return fromUnits(row.balance as number);
}

describe('a buy on the opposite side closes the held position', () => {
  test('hold higher, then bet lower: the higher position is gone, only lower remains', async () => {
    await seed();
    expect((await trade({ direction: 'higher', amount: 100 })).status).toBe(201);
    expect(await pos('higher')).toBeGreaterThan(0);

    const res = await trade({ direction: 'lower', amount: 50 });
    expect(res.status).toBe(201);
    // Single-sided: the higher position is fully closed, lower is held.
    expect(await pos('higher')).toBeLessThan(1e-6);
    expect(await pos('lower')).toBeGreaterThan(0);
  });

  test('hold lower, then bet higher: the lower position is gone, only higher remains', async () => {
    await seed();
    expect((await trade({ direction: 'lower', amount: 100 })).status).toBe(201);
    const res = await trade({ direction: 'higher', amount: 50 });
    expect(res.status).toBe(201);
    expect(await pos('lower')).toBeLessThan(1e-6);
    expect(await pos('higher')).toBeGreaterThan(0);
  });

  test('closing the opposite refunds its worth: net spend is only the new side', async () => {
    await seed();
    // Buy higher for 100, then flip to lower for 50.
    await trade({ direction: 'higher', amount: 100 });
    const afterFirst = await balance(); // 1000 - 100 = 900
    expect(afterFirst).toBeCloseTo(900, 1);

    await trade({ direction: 'lower', amount: 50 });
    const afterFlip = await balance();
    // The higher position was sold back (proceeds returned) before the 50
    // lower buy, so the balance is NOT 900 - 50 = 850: it is higher,
    // reflecting the sale of the ~100-cr higher position at current price.
    expect(afterFlip).toBeGreaterThan(880);
    // And never both sides.
    expect(await pos('higher')).toBeLessThan(1e-6);
  });
});

describe('a buy on the SAME side accumulates, no netting', () => {
  test('hold higher, buy more higher: one growing higher position, no lower', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 60 });
    const first = await pos('higher');
    await trade({ direction: 'higher', amount: 60 });
    expect(await pos('higher')).toBeGreaterThan(first);
    expect(await pos('lower')).toBe(0);
  });
});

describe('betting toward a value nets against the opposite too', () => {
  test('hold lower, bet toward a value above the price: lower closes, higher opens', async () => {
    await seed();
    await trade({ direction: 'lower', amount: 100 }); // price now below 50
    // Target a value above the current price -> a higher move -> nets the lower.
    const res = await trade({ targetValue: 80, maxBudget: 200 });
    expect(res.status).toBe(201);
    expect(await pos('lower')).toBeLessThan(1e-6);
    expect(await pos('higher')).toBeGreaterThan(0);
  });
});

describe('the single-sided invariant holds across a churn sequence', () => {
  test('alternating buys never leave both sides held', async () => {
    await seed();
    for (const dir of ['higher', 'lower', 'higher', 'lower', 'higher'] as const) {
      const res = await trade({ direction: dir, amount: 40 });
      expect(res.status).toBe(201);
      const h = await pos('higher');
      const l = await pos('lower');
      // At most one side is non-zero after every trade.
      expect(Math.min(h, l)).toBeLessThan(1e-6);
    }
  });
});

/**
 * Per-metric market depth (docs/owner-on-the-floor.md).
 *
 * `liquidityCredits` is what a NEW market on this metric opens with, and the
 * thing worth pinning is that it REACHES THE COLUMN: the first draft validated
 * it and then dropped it, which is the exact shape of a silent failure. The
 * owner sets 2,400, the database keeps nothing, the next market opens at the
 * workspace default, and nothing anywhere reports an error.
 *
 * The second half covers the funding plan: each market is priced at its own
 * metric's depth, and the batch funds in metric order while the balance lasts.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, trades } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { metricsRouter } from '../routes/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-mpg';
const OWNER = 'agent-mpg-owner';
const TRADER = 'agent-mpg-trader';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: OWNER,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-mpg-owner', balance: toUnits(100000) },
    { id: TRADER, apiKeyHash: 'h-mpg-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Metrics Page Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values([
    {
      id: 'm-priced',
      workspaceId: WS,
      name: 'Paying customers',
      description: 'Active Stripe subscriptions on the last day of the period.',
      value: 100,
      formula: '',
      order: 0,
      marketRangeMax: 5000,
    },
    {
      id: 'm-bare',
      workspaceId: WS,
      name: 'Net promoter score',
      description: 'Not measured yet.',
      value: 0,
      formula: '',
      order: 1,
      marketRangeMax: 100,
    },
  ]);
  await db.insert(markets).values([
    {
      id: 'mkt-open',
      workspaceId: WS,
      metricId: 'm-priced',
      metricName: 'Paying customers',
      targetDate: '2026-09',
      resolved: false,
      active: true,
      rangeMin: 0,
      rangeMax: 5000,
      shares: [0, 0],
      liquidity: 1000,
      pool: 1200,
    },
    // Resolved: it is history, not a horizon the owner can close.
    {
      id: 'mkt-done',
      workspaceId: WS,
      metricId: 'm-priced',
      metricName: 'Paying customers',
      targetDate: '2026-07',
      resolved: true,
      active: true,
      rangeMin: 0,
      rangeMax: 5000,
      shares: [0, 0],
      liquidity: 1000,
      pool: 900,
    },
  ]);
}

describe('PUT /api/metrics/:id liquidityCredits', () => {
  test('writes the column, and null puts the metric back on the default', async () => {
    await request(app).put('/api/metrics/m-priced').send({ liquidityCredits: 2400 }).expect(200);
    let [row] = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, 'm-priced'), eq(metrics.workspaceId, WS)));
    expect(row.liquidityCredits).toBe(2400);

    await request(app).put('/api/metrics/m-priced').send({ liquidityCredits: null }).expect(200);
    [row] = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, 'm-priced'), eq(metrics.workspaceId, WS)));
    expect(row.liquidityCredits).toBeNull();
  });

  test('refuses a negative or non-numeric amount', async () => {
    await request(app).put('/api/metrics/m-priced').send({ liquidityCredits: -1 }).expect(400);
    await request(app).put('/api/metrics/m-priced').send({ liquidityCredits: 'lots' }).expect(400);
  });

  test('does not touch a market that is already open', async () => {
    await request(app).put('/api/metrics/m-priced').send({ liquidityCredits: 9999 }).expect(200);
    const [mkt] = await db.select().from(markets).where(eq(markets.id, 'mkt-open'));
    expect(mkt.pool).toBe(1200);
  });
});

describe("auto-fund at each metric's own price", () => {
  test('funds in list order while the balance lasts, at per-market prices', async () => {
    const { planAffordable } = await import('../services/markets');
    const items = [
      { id: 'a', credits: 2400 },
      { id: 'b', credits: 1200 },
      { id: 'c', credits: 1200 },
    ];
    // 3,000 credits covers a (2,400) and then nothing else, but c is cheap
    // enough that a naive "cheapest first" would fund the wrong market. Order
    // is the owner's metric order and it is deliberate.
    const funded = planAffordable(items, i => i.credits, toUnits(3000));
    expect(funded.map(f => f.item.id)).toEqual(['a']);

    const richer = planAffordable(items, i => i.credits, toUnits(4000));
    expect(richer.map(f => f.item.id)).toEqual(['a', 'b']);
    expect(richer.map(f => f.credits)).toEqual([2400, 1200]);
  });

  test('skips a metric priced below the minimum contribution rather than failing the batch', async () => {
    const { planAffordable } = await import('../services/markets');
    const funded = planAffordable(
      [
        { id: 'dust', credits: 0 },
        { id: 'real', credits: 500 },
      ],
      i => i.credits,
      toUnits(10000),
    );
    expect(funded.map(f => f.item.id)).toEqual(['real']);
  });
});

describe('machinery edits and open markets (docs/market-integrity.md)', () => {
  test('a range change with only untraded open markets voids and respawns them at the new range', async () => {
    // Give the metric a horizon so the reconcile knows what to respawn.
    await db
      .update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-09'] } })
      .where(and(eq(metrics.id, 'm-priced'), eq(metrics.workspaceId, WS)));

    await request(app).put('/api/metrics/m-priced').send({ marketRangeMax: 50000 }).expect(200);

    // The old market is gone from the open set...
    const [old] = await db.select().from(markets).where(eq(markets.id, 'mkt-open'));
    expect(old.resolved).toBe(true);
    // ...and a fresh one stands at the same date with the new machinery.
    const open = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, 'm-priced'), eq(markets.resolved, false)));
    expect(open).toHaveLength(1);
    expect(open[0].targetDate).toBe('2026-09');
    expect(open[0].rangeMax).toBe(50000);
  });

  test('a range change is still refused the moment anyone has money in a market', async () => {
    await db.insert(trades).values({
      id: 't-freeze',
      workspaceId: WS,
      marketId: 'mkt-open',
      agentId: TRADER,
      direction: 'higher',
      shares: 1,
      cost: toUnits(10),
    });
    const res = await request(app).put('/api/metrics/m-priced').send({ marketRangeMax: 50000 }).expect(409);
    expect(res.body.error).toMatch(/has trades/);
    const [mkt] = await db.select().from(markets).where(eq(markets.id, 'mkt-open'));
    expect(mkt.resolved).toBe(false);
    expect(mkt.rangeMax).toBe(5000);
  });
});

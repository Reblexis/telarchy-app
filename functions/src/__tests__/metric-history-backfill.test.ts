/**
 * POST /api/metrics/:id/logs/backfill: dated readings for a past you can
 * prove (docs/guides/sources.md, "Backfilling a past you can prove").
 *
 * The rule every test here is named after: a backfill may extend a metric's
 * history backwards and may never change what a market settles on. Readings
 * are what resolution reads, so a route that writes them at arbitrary
 * timestamps is the one place where dated writes could rewrite a payout.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const capsHeader = (req.headers['x-test-caps'] as string) || 'read,trade,manage';
      req.auth = {
        agentId: 'owner',
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

import express from 'express';
import request from 'supertest';
import { db } from '../db/client';
import { agents, markets, metricLogs, metrics, updates, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { metricsRouter } from '../routes/metrics';
import { metricValueAsOf } from '../services/metrics';
import { ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-backfill';
const METRIC = 'metric-backfill';
const NOW_READING = new Date('2026-08-31T10:00:00Z');

const app = express();
app.use(express.json());
app.use('/api/metrics', authMiddleware, metricsRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: String(err?.message ?? err) });
});

async function seed() {
  await truncateAll();
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h-o', balance: 0 });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Backfill',
    slug: 'backfill',
    createdBy: 'owner',
    visibility: 'private',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: '30-day revenue (USD)',
    value: 3039.11,
    formula: '0',
    marketRangeMax: 6500,
  });
  // The reading the metric was born with, as every live metric has.
  await db.insert(metricLogs).values({
    id: 'log-live',
    workspaceId: WS,
    metricId: METRIC,
    metricName: '30-day revenue (USD)',
    value: 3039.11,
    outlook: 3039.11,
    timestamp: NOW_READING,
  });
}

function backfill(readings: unknown, caps = 'read,trade,manage') {
  return request(app)
    .post(`/api/metrics/${METRIC}/logs/backfill`)
    .set('X-Workspace-Id', WS)
    .set('X-Test-Caps', caps)
    .send({ readings });
}

const past = (day: number, value: number) => ({
  at: `2026-07-${String(day).padStart(2, '0')}T00:00:00Z`,
  value,
});

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(seed);

describe('a backfill extends history backwards', () => {
  test('dated readings land at their own instants and read back in order', async () => {
    const res = await backfill([past(2, 3571.2), past(1, 3589.4)]);
    expect(res.status).toBe(200);
    expect(res.body.written).toBe(2);

    const logs = await request(app).get(`/api/metrics/${METRIC}/logs`).set('X-Workspace-Id', WS);
    const series = logs.body.map((l: any) => [new Date(l.timestamp).toISOString(), l.value]);
    expect(series).toEqual([
      ['2026-07-01T00:00:00.000Z', 3589.4],
      ['2026-07-02T00:00:00.000Z', 3571.2],
      [NOW_READING.toISOString(), 3039.11],
    ]);
  });

  test("the metric's current value does not move", async () => {
    await backfill([past(1, 9999)]);
    const [m] = await db.select().from(metrics);
    expect(m.value).toBeCloseTo(3039.11, 2);
  });

  test('no change-log row is written, because nobody measured these today', async () => {
    await backfill([past(1, 3589.4)]);
    expect(await db.select().from(updates)).toHaveLength(0);
  });
});

describe('a backfill never changes what a market settles on', () => {
  test('the value as of any instant at or after the live reading is untouched', async () => {
    const instant = new Date('2026-10-01T00:00:00Z');
    const before = await metricValueAsOf(METRIC, instant, WS);
    await backfill([past(1, 9999), past(2, 8888)]);
    expect(await metricValueAsOf(METRIC, instant, WS)).toBe(before);
  });

  test('a reading at or after the oldest existing one is refused', async () => {
    const sameInstant = await backfill([{ at: NOW_READING.toISOString(), value: 1 }]);
    expect(sameInstant.status).toBe(400);
    const after = await backfill([{ at: '2026-09-15T00:00:00Z', value: 1 }]);
    expect(after.status).toBe(400);
    expect(after.body.error).toMatch(/older/i);
    expect(await db.select().from(metricLogs)).toHaveLength(1);
  });

  test('re-sending the same batch is refused rather than duplicated', async () => {
    const batch = [past(1, 3589.4), past(2, 3571.2)];
    expect((await backfill(batch)).status).toBe(200);
    expect((await backfill(batch)).status).toBe(400);
    expect(await db.select().from(metricLogs)).toHaveLength(3);
  });

  test('a metric with a resolved market takes no backfill at all', async () => {
    await db.insert(markets).values({
      id: 'mk-resolved',
      workspaceId: WS,
      metricId: METRIC,
      metricName: '30-day revenue (USD)',
      targetDate: '2026-08',
      rangeMin: 0,
      rangeMax: 6500,
      shares: [0, 0],
      liquidity: 100,
      pool: 69,
      active: false,
      resolved: true,
      voided: false,
      proposalId: null,
    });
    const res = await backfill([past(1, 3589.4)]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/resolved/i);
  });
});

describe('what it refuses to accept at all', () => {
  test('a caller without manage cannot write history', async () => {
    expect((await backfill([past(1, 1)], 'read,trade')).status).toBe(403);
  });

  test('two readings at the same instant', async () => {
    const res = await backfill([past(1, 1), past(1, 2)]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same instant|duplicate/i);
  });

  test('an unparseable instant or a non-finite value', async () => {
    expect((await backfill([{ at: 'whenever', value: 1 }])).status).toBe(400);
    expect((await backfill([{ at: past(1, 1).at, value: 'lots' }])).status).toBe(400);
    expect((await backfill([{ at: past(1, 1).at, value: Number.NaN }])).status).toBe(400);
  });

  test('more than 2000 readings in one call', async () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      at: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
      value: i,
    }));
    const res = await backfill(many);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2000/);
  });

  test('an empty or missing list', async () => {
    expect((await backfill([])).status).toBe(400);
    expect((await backfill(undefined)).status).toBe(400);
  });
});

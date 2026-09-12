/**
 * The question in the owner's own words (docs/ui-conventions.md, "The question
 * line"; Viktor, 2026-09-12: "add support for custom title of a market and
 * then edit the title of the main unconditional market").
 *
 * The rule this file protects is the one a silent failure would break:
 * **the title the owner writes REACHES THE COLUMN and comes back on the
 * floor payload.** A validated-then-dropped field looks exactly like a
 * working one from the outside.
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
import { agents, markets, metrics } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { marketplaceRouter } from '../routes/marketplace';
import { metricsRouter } from '../routes/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-title';
const OWNER = 'agent-title-owner';

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
app.use('/api/marketplace', marketplaceRouter);
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
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-title-owner', balance: toUnits(100000) }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Snake',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values([
    {
      id: 'len',
      workspaceId: WS,
      name: 'Reached length',
      description: 'The length the current attempt has reached.',
      value: 3,
      formula: '',
      order: 0,
      marketRangeMax: 36,
    },
  ]);
  await db.insert(markets).values([
    {
      id: 'mkt-len',
      workspaceId: WS,
      metricId: 'len',
      metricName: 'Reached length',
      targetDate: '2026-09-12T06:30',
      resolvesOn: new Date(Date.now() + 60 * 60_000),
      resolved: false,
      active: true,
      rangeMin: 0,
      rangeMax: 36,
      shares: [0, 0],
      liquidity: 200,
      pool: 1200,
    } as never,
  ]);
}

const metricRow = async () => {
  const [m] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, 'len'), eq(metrics.workspaceId, WS)));
  return m;
};
const floorMarket = async () => {
  const r = await request(app).get(`/api/marketplace/${WS}`);
  expect(r.status).toBe(200);
  return (r.body.markets as Array<Record<string, unknown>>).find(m => m.marketId === 'mkt-len');
};

describe('A CUSTOM MARKET TITLE REACHES THE COLUMN', () => {
  test('the owner writes it, the database keeps it, the floor payload returns it', async () => {
    const title = 'What length will I reach on this attempt?';
    const put = await request(app).put('/api/metrics/len').send({ marketTitle: title });
    expect(put.status).toBe(200);
    expect((await metricRow()).marketTitle).toBe(title);
    expect((await floorMarket())?.marketTitle).toBe(title);
  });

  test('a metric with no title says null, never an empty string', async () => {
    expect((await metricRow()).marketTitle).toBeNull();
    expect((await floorMarket())?.marketTitle).toBeNull();
  });

  test('surrounding space is trimmed', async () => {
    await request(app).put('/api/metrics/len').send({ marketTitle: '  Which way?  ' });
    expect((await metricRow()).marketTitle).toBe('Which way?');
  });

  test('a blank title CLEARS it, so an owner can take the question back', async () => {
    await request(app).put('/api/metrics/len').send({ marketTitle: 'Which way?' });
    await request(app).put('/api/metrics/len').send({ marketTitle: '   ' });
    expect((await metricRow()).marketTitle).toBeNull();
    await request(app).put('/api/metrics/len').send({ marketTitle: 'Which way?' });
    await request(app).put('/api/metrics/len').send({ marketTitle: null });
    expect((await metricRow()).marketTitle).toBeNull();
  });

  test('a title longer than 200 characters is refused, and nothing is written', async () => {
    const r = await request(app)
      .put('/api/metrics/len')
      .send({ marketTitle: `Q${'x'.repeat(200)}` });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/200/);
    expect((await metricRow()).marketTitle).toBeNull();
  });

  test('a title that is not a string is refused', async () => {
    const r = await request(app).put('/api/metrics/len').send({ marketTitle: 7 });
    expect(r.status).toBe(400);
    expect((await metricRow()).marketTitle).toBeNull();
  });

  test('RENAMING THE METRIC LEAVES THE TITLE ALONE: the owner wrote it, not the name', async () => {
    await request(app).put('/api/metrics/len').send({ marketTitle: 'What length will I reach?' });
    const r = await request(app).put('/api/metrics/len').send({ name: 'Length reached' });
    expect(r.status).toBe(200);
    expect((await metricRow()).marketTitle).toBe('What length will I reach?');
    expect((await floorMarket())?.marketTitle).toBe('What length will I reach?');
    expect((await floorMarket())?.metricName).toBe('Length reached');
  });
});

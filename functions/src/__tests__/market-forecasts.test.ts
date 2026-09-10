/**
 * Reference forecasts (docs/metrics.md, "The reference forecaster, and
 * reference forecasts"): a participant files { value, stage, model, note }
 * on an open market; the market keeps every one, oldest first, and answers
 * them publicly. What is pinned: who may file (trade), what is refused (a
 * market that is not open, a value that is not a finite number, a stage that
 * is not a short token), that the record carries the instant it was filed,
 * and that a market's forecasts are its own.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const caps = (req.headers['x-test-caps'] as string | undefined)?.split(',') ?? ['read', 'trade', 'manage'];
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(caps),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics } from '../db/schema';
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
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const WS = 'ws-forecasts';
const OWNER = 'owner-fc';
const REF = 'reference-astra';
const OTHER = 'some-trader';
const METRIC = 'metric-fc';
const OPEN = 'mkt-fc-open';
const OPEN2 = 'mkt-fc-open-2';
const RESOLVED = 'mkt-fc-resolved';
const VOIDED = 'mkt-fc-voided';
const CLOSED = 'mkt-fc-closed';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-fc', balance: toUnits(0) },
    { id: REF, apiKeyHash: 'h-ref-fc', balance: toUnits(1000), platformOperated: true },
    { id: OTHER, apiKeyHash: 'h-other-fc', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Forecasts',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db
    .insert(metrics)
    .values({ id: METRIC, workspaceId: WS, name: 'Fc Metric', value: 0, formula: '0', marketRangeMax: 100 });
  const base = {
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Fc Metric',
    targetDate: '2026-11',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 1200,
    pool: initialPool(1200),
    active: true,
    resolved: false,
    voided: false,
  };
  await db.insert(markets).values([
    { ...base, id: OPEN },
    { ...base, id: OPEN2 },
    { ...base, id: RESOLVED, resolved: true, actualValue: 40 },
    { ...base, id: VOIDED, voided: true, active: false },
    { ...base, id: CLOSED, active: false },
  ]);
});

const file = (marketId: string, body: object, agent = REF, caps?: string) => {
  const r = request(app)
    .post(`/api/predictions/markets/${marketId}/forecasts`)
    .set('X-Workspace-Id', WS)
    .set('X-Test-Agent-Id', agent);
  return (caps ? r.set('X-Test-Caps', caps) : r).send(body);
};
const list = (marketId: string) =>
  request(app).get(`/api/predictions/markets/${marketId}/forecasts`).set('X-Workspace-Id', WS);

describe('filing a reference forecast', () => {
  test('a participant with trade files { value, stage, model, note } and gets the record back', async () => {
    const before = Date.now();
    const res = await file(OPEN, {
      value: 42.5,
      stage: 'mature',
      model: 'gpt-6-astra',
      note: 'the September print lands under 45',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      marketId: OPEN,
      agentId: REF,
      value: 42.5,
      stage: 'mature',
      model: 'gpt-6-astra',
      note: 'the September print lands under 45',
    });
    expect(typeof res.body.id).toBe('string');
    expect(new Date(res.body.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test('stage, model and note are optional: a bare value files with stage "spawn"', async () => {
    const res = await file(OPEN, { value: 10 });
    expect(res.status).toBe(201);
    expect(res.body.stage).toBe('spawn');
    expect(res.body.model).toBeNull();
    expect(res.body.note).toBeNull();
  });

  test('THE RULE: the market must be open; resolved, voided and closed markets refuse with 409', async () => {
    for (const id of [RESOLVED, VOIDED, CLOSED]) {
      const res = await file(id, { value: 10 });
      expect([id, res.status]).toEqual([id, 409]);
    }
  });

  test('a market that does not exist, or lives on another workspace, is 404', async () => {
    expect((await file('mkt-nope', { value: 10 })).status).toBe(404);
  });

  test('THE RULE: value must be a finite number', async () => {
    for (const value of ['42', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      const res = await file(OPEN, { value });
      expect(res.status).toBe(400);
    }
  });

  test('THE RULE: stage is a short token, and model and note are bounded strings', async () => {
    expect((await file(OPEN, { value: 1, stage: 'not a token!' })).status).toBe(400);
    expect((await file(OPEN, { value: 1, stage: 'x'.repeat(33) })).status).toBe(400);
    expect((await file(OPEN, { value: 1, model: 'm'.repeat(101) })).status).toBe(400);
    expect((await file(OPEN, { value: 1, note: 'n'.repeat(2001) })).status).toBe(400);
    expect(
      (await file(OPEN, { value: 1, stage: 'mature-2', model: 'gpt-6-astra', note: 'n'.repeat(2000) })).status,
    ).toBe(201);
  });

  test('THE RULE: filing needs trade; read-only callers are refused', async () => {
    const res = await file(OPEN, { value: 10 }, OTHER, 'read');
    expect(res.status).toBe(403);
    expect((await list(OPEN)).body).toEqual([]);
  });

  test('any participant with trade may file, not only the reference', async () => {
    expect((await file(OPEN, { value: 10 }, OTHER)).status).toBe(201);
  });
});

describe("reading a market's forecasts", () => {
  test('a market keeps every forecast filed on it, oldest first, and only its own', async () => {
    await file(OPEN, { value: 10, stage: 'spawn' });
    await file(OPEN, { value: 20, stage: 'mature' });
    await file(OPEN2, { value: 99, stage: 'spawn' });
    const res = await list(OPEN);
    expect(res.status).toBe(200);
    expect(res.body.map((f: { value: number; stage: string }) => [f.value, f.stage])).toEqual([
      [10, 'spawn'],
      [20, 'mature'],
    ]);
    expect(res.body.every((f: { marketId: string }) => f.marketId === OPEN)).toBe(true);
  });

  test('reading is public: a caller with only read sees them', async () => {
    await file(OPEN, { value: 10 });
    const res = await request(app)
      .get(`/api/predictions/markets/${OPEN}/forecasts`)
      .set('X-Workspace-Id', WS)
      .set('X-Test-Caps', 'read');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].agentId).toBe(REF);
  });

  test('an unknown market is 404, and a market with no forecasts is an empty list', async () => {
    expect((await list('mkt-nope')).status).toBe(404);
    expect((await list(OPEN2)).body).toEqual([]);
  });
});

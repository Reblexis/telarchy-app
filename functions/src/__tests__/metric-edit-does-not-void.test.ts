/**
 * Editing what a market says no longer destroys the market.
 *
 * Until 2026-08-18 any edit to a metric's name, description, formula or range
 * voided every open market on it, refunded every position and respawned the
 * market fresh. The reasoning was sound (the description IS the settlement
 * text) and the consequence was not: with a prize season running, rewording
 * one sentence threw away a week of price discovery and every position in it,
 * which made ordinary copy-editing an operation nobody could safely perform.
 *
 * The rule now splits the four fields by what they actually are:
 *
 *      WORDS                             MACHINERY
 *      name, description                 formula, marketRangeMax
 *      nothing computes from them        the market prices inside them
 *      -> edit freely, log the change    -> refused while a market is open
 *
 * Governing doc: docs/market-integrity.md.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
// Both routes are capability-gated; this spec is about what an edit does to a
// market, not about who is allowed to make one.
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metricDefinitionRevisions, metrics, positions } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { metricsRouter } from '../routes/metrics';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-edit';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: (req.headers['x-test-agent-id'] as string) ?? null,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const OWNER = 'agent-edit-owner';
const TRADER = 'agent-edit-trader';
const METRIC = 'metric-edit';
const MARKET = 'market-edit-2028';
const ORIGINAL_DESC = 'Everything Steam pays out this year, minus refunds.';

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-edit-owner', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-edit-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Edit Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Net 2026',
    description: ORIGINAL_DESC,
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Net 2026',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

const put = (body: Record<string, unknown>) =>
  request(app)
    .put(`/api/metrics/${METRIC}`)
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const buy = (credits: number) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, direction: 'higher', amount: credits });

async function market() {
  const [row] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return row;
}

async function revisions() {
  return db
    .select()
    .from(metricDefinitionRevisions)
    .where(eq(metricDefinitionRevisions.metricId, METRIC))
    .orderBy(metricDefinitionRevisions.createdAt);
}

describe('the words half: edits apply and are logged', () => {
  test('rewriting the description leaves the market, its price and its positions alone', async () => {
    await seed();
    expect((await buy(40)).status).toBe(201);
    const before = await market();
    const [posBefore] = await db.select().from(positions).where(eq(positions.agentId, TRADER));
    expect(posBefore.shares).toBeGreaterThan(0);

    const res = await put({ description: 'Steam and Stripe, minus refunds, taxes and the Steam cut.' });
    expect(res.status).toBe(200);

    const after = await market();
    // The exact assertions the old behaviour would have failed: it marked the
    // market resolved+voided, zeroed the pool and refunded the position.
    expect(after.resolved).toBe(false);
    expect(after.voided).toBe(false);
    expect(after.shares).toEqual(before.shares);
    expect(after.pool).toBeCloseTo(before.pool as number, 8);
    expect(after.liquidity).toBeCloseTo(before.liquidity as number, 8);

    const [posAfter] = await db.select().from(positions).where(eq(positions.agentId, TRADER));
    expect(posAfter.shares).toBeCloseTo(posBefore.shares, 8);
  });

  test('the change is on the record, old value and new', async () => {
    await seed();
    const next = 'Steam and Stripe, minus refunds.';
    expect((await put({ description: next })).status).toBe(200);

    const rows = await revisions();
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('description');
    expect(rows[0].oldValue).toBe(ORIGINAL_DESC);
    expect(rows[0].newValue).toBe(next);
    expect(rows[0].changedBy).toBe(OWNER);
  });

  test('renaming follows through to the open market, which renders the name', async () => {
    await seed();
    expect((await put({ name: 'LookPilot net 2026' })).status).toBe(200);

    // markets.metricName is denormalised; without the sync the floor, the
    // share image and every notification keep showing the old name forever.
    expect((await market()).metricName).toBe('LookPilot net 2026');
    expect((await revisions())[0].field).toBe('name');
  });

  test('two fields in one save write two rows', async () => {
    await seed();
    expect((await put({ name: 'Renamed', description: 'Rewritten.' })).status).toBe(200);
    expect((await revisions()).map(r => r.field).sort()).toEqual(['description', 'name']);
  });

  test('saving the same text again writes nothing', async () => {
    await seed();
    expect((await put({ description: ORIGINAL_DESC })).status).toBe(200);
    // A revision log that records non-changes is noise a reader has to filter,
    // and it makes "did the goalposts move?" harder to answer, not easier.
    expect(await revisions()).toHaveLength(0);
  });
});

describe('the machinery half: refused while a market is open', () => {
  test('the formula cannot change under an open market', async () => {
    await seed();
    const res = await put({ formula: 'other * 2' });
    expect(res.status).toBe(409);
    expect(res.body.fields).toEqual(['the formula']);
    expect(res.body.openMarketId).toBe(MARKET);

    // Refused means nothing was written, not written-then-voided.
    const [row] = await db.select().from(metrics).where(eq(metrics.id, METRIC));
    expect(row.formula).toBe('0');
    expect((await market()).resolved).toBe(false);
  });

  test('the market range cannot change under an open market', async () => {
    await seed();
    const res = await put({ marketRangeMax: 500 });
    expect(res.status).toBe(409);
    expect(res.body.fields).toEqual(['the market range']);

    const [row] = await db.select().from(metrics).where(eq(metrics.id, METRIC));
    expect(row.marketRangeMax).toBe(100);
    // The failure this prevents: metric says 0..500, market still prices
    // 0..100, and nothing on screen says they differ.
    expect((await market()).rangeMax).toBe(100);
  });

  test('with no open market, the same edit is allowed', async () => {
    await seed();
    await db
      .update(markets)
      .set({ resolved: true, active: false })
      .where(and(eq(markets.id, MARKET), eq(markets.workspaceId, WS)));

    expect((await put({ marketRangeMax: 500 })).status).toBe(200);
    const [row] = await db.select().from(metrics).where(eq(metrics.id, METRIC));
    expect(row.marketRangeMax).toBe(500);
  });

  test('a leaf metric value is a measurement, not a redefinition', async () => {
    await seed();
    // Logging a reading must never be mistaken for changing the settlement
    // basis, or the daily sync would refuse every update.
    expect((await put({ value: 42 })).status).toBe(200);
    expect((await market()).resolved).toBe(false);
  });
});

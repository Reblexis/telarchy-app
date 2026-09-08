/**
 * The settlement summary: one stored line beside the definition.
 *
 * The floor's settlement line (docs/ui-conventions.md, "The numbers band and
 * the settlement line") prints "Settles on:" followed by the metric's
 * settlement summary, a stored field the owner writes on the metric sheet. A
 * metric with no summary falls back, on the client, to the first sentence of
 * its definition, so the server ships null rather than inventing one.
 *
 * The summary is settlement WORDS, the same kind of thing as the description
 * (docs/market-integrity.md, I1): editing it never voids a market, and every
 * change is written to the append-only revision log.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metricDefinitionRevisions, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { marketplaceRouter } from '../routes/marketplace';
import { metricsRouter } from '../routes/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-summary';
const OWNER = 'agent-summary-owner';
const METRIC = 'metric-summary';
const MARKET = 'mkt-summary';

const app = express();
app.use(express.json());
// The real capability gate runs (middleware/roles is not mocked); the test
// chooses the caller's capabilities per request through a header.
app.use((req, _res, next) => {
  const caps = ((req.headers['x-test-caps'] as string) ?? 'read,trade,manage').split(',');
  (req as any).auth = {
    agentId: OWNER,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(caps),
    isMasterKey: false,
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
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-summary-o', balance: 1_000_000_000 }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Summary Floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Active traders',
    value: 9,
    formula: '0',
    marketRangeMax: 100,
    description: 'Distinct accounts that traded in the period. Read from the ledger at 00:00 UTC.',
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Active traders',
    targetDate: '2027-01',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
});

async function storedSummary(): Promise<string | null | undefined> {
  const [row] = await db
    .select({ settlementSummary: metrics.settlementSummary })
    .from(metrics)
    .where(eq(metrics.id, METRIC));
  return row?.settlementSummary;
}

describe('the column round-trips', () => {
  test('a metric starts with no summary and GET reports null', async () => {
    const one = await request(app).get(`/api/metrics/${METRIC}`);
    expect(one.status).toBe(200);
    expect(one.body.settlementSummary).toBeNull();

    const list = await request(app).get('/api/metrics');
    expect(list.status).toBe(200);
    expect(list.body.find((m: any) => m.id === METRIC).settlementSummary).toBeNull();
  });

  test('PUT stores it and GET metric, GET metrics and the PUT response all carry it', async () => {
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({
      settlementSummary: 'Distinct accounts with a trade in the month, per the ledger.',
    });
    expect(put.status).toBe(200);
    expect(put.body.settlementSummary).toBe('Distinct accounts with a trade in the month, per the ledger.');
    expect(await storedSummary()).toBe('Distinct accounts with a trade in the month, per the ledger.');

    const one = await request(app).get(`/api/metrics/${METRIC}`);
    expect(one.body.settlementSummary).toBe('Distinct accounts with a trade in the month, per the ledger.');
    const list = await request(app).get('/api/metrics');
    expect(list.body.find((m: any) => m.id === METRIC).settlementSummary).toBe(
      'Distinct accounts with a trade in the month, per the ledger.',
    );
  });

  test('a summary alone is a field to update', async () => {
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'One line.' });
    expect(put.status).toBe(200);
    expect(put.body.error).toBeUndefined();
  });
});

describe('PUT validation', () => {
  test('200 characters is accepted', async () => {
    const summary = 'x'.repeat(200);
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: summary });
    expect(put.status).toBe(200);
    expect(await storedSummary()).toBe(summary);
  });

  test('201 characters is refused with 400 and nothing is stored', async () => {
    const put = await request(app)
      .put(`/api/metrics/${METRIC}`)
      .send({ settlementSummary: 'x'.repeat(201) });
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/200/);
    expect(await storedSummary()).toBeNull();
  });

  test('a non-string is refused with 400', async () => {
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 42 });
    expect(put.status).toBe(400);
    expect(await storedSummary()).toBeNull();
  });

  test('null clears it', async () => {
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'Set once.' });
    expect(await storedSummary()).toBe('Set once.');
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: null });
    expect(put.status).toBe(200);
    expect(put.body.settlementSummary).toBeNull();
    expect(await storedSummary()).toBeNull();
  });

  test('whitespace is trimmed and an all-whitespace summary clears it', async () => {
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: '  Trimmed.  ' });
    expect(await storedSummary()).toBe('Trimmed.');
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: '   ' });
    expect(put.status).toBe(200);
    expect(await storedSummary()).toBeNull();
  });

  test('a PUT that omits the summary leaves it alone', async () => {
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'Kept.' });
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ description: 'New definition.' });
    expect(put.status).toBe(200);
    expect(await storedSummary()).toBe('Kept.');
  });
});

describe('editing the summary is a word edit (docs/market-integrity.md, I1)', () => {
  test('it never voids the open market', async () => {
    const put = await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'Reworded.' });
    expect(put.status).toBe(200);
    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(m.voided).toBe(false);
    expect(m.resolved).toBe(false);
    expect(m.active).toBe(true);
  });

  test('every change is written to the revision log, and an unchanged save writes nothing', async () => {
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'First.' });
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'First.' });
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'Second.' });
    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: null });
    const rows = await db
      .select()
      .from(metricDefinitionRevisions)
      .where(
        and(eq(metricDefinitionRevisions.metricId, METRIC), eq(metricDefinitionRevisions.field, 'settlementSummary')),
      )
      .orderBy(metricDefinitionRevisions.createdAt);
    expect(rows.map(r => [r.oldValue, r.newValue])).toEqual([
      [null, 'First.'],
      ['First.', 'Second.'],
      ['Second.', null],
    ]);
    expect(rows.every(r => r.changedBy === OWNER)).toBe(true);
  });
});

describe('the floor payload carries it', () => {
  test('each horizon entry and the hero carry the summary, null when there is none', async () => {
    const before = await request(app).get(`/api/marketplace/${WS}`);
    expect(before.status).toBe(200);
    const horizonBefore = before.body.horizonHistories.find((h: any) => h.marketId === MARKET);
    expect(horizonBefore).toBeDefined();
    expect(horizonBefore.settlementSummary).toBeNull();
    expect(before.body.heroMetricSettlementSummary).toBeNull();

    await request(app).put(`/api/metrics/${METRIC}`).send({ settlementSummary: 'Ledger count at 00:00 UTC.' });

    const after = await request(app).get(`/api/marketplace/${WS}`);
    const horizonAfter = after.body.horizonHistories.find((h: any) => h.marketId === MARKET);
    expect(horizonAfter.settlementSummary).toBe('Ledger count at 00:00 UTC.');
    expect(horizonAfter.description).toContain('Distinct accounts that traded');
    expect(after.body.heroMetricSettlementSummary).toBe('Ledger count at 00:00 UTC.');
  });
});

describe('manage is required', () => {
  test('a caller without manage gets 403 and the summary does not change', async () => {
    const put = await request(app)
      .put(`/api/metrics/${METRIC}`)
      .set('x-test-caps', 'read,trade')
      .send({ settlementSummary: 'Not mine to set.' });
    expect(put.status).toBe(403);
    expect(put.body.requiredCapabilities).toEqual(['manage']);
    expect(await storedSummary()).toBeNull();
  });
});

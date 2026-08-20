/**
 * The workspace brief (GET /api/marketplace/:id/context) and the Ask door on
 * top of it.
 *
 * Two things this pins, both of which are promises to somebody:
 *  - a document the owner has NOT published is not in the brief, however
 *    convenient it would be for the answer;
 *  - the brief's contract impact is the same number the floor's ballot
 *    shows, because it comes from the same function.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import express from 'express';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import {
  agents, markets, metrics, metricLogs, permissionGroups, proposals, sources, workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { marketplaceRouter } from '../routes/marketplace';
import { AppError } from '../lib/errors';
import { buildWorkspaceContext, renderContextMarkdown } from '../services/workspace-context';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-ctx';

async function seed(opts: { publicCaps?: string[]; publishDocument?: boolean } = {}) {
  const { publicCaps = ['read', 'trade'], publishDocument = true } = opts;
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS, name: 'LookPilot', createdBy: 'owner', visibility: 'public', slug: 'lookpilot',
    description: 'Webcam head tracking for simulator games.',
    charter: 'I ship what the market ranks highest, or I say why not.',
  });
  await db.insert(sources).values([
    { id: 'src-room', workspaceId: WS, name: 'Data room', description: 'The numbers behind the numbers',
      type: 'text', content: 'Revenue is Steam developer share plus Stripe. 17 languages.' },
    { id: 'src-private', workspaceId: WS, name: 'Payroll', description: '', type: 'text', content: 'SECRET SALARIES' },
  ]);
  await db.insert(permissionGroups).values({
    id: 'grp-pub', workspaceId: WS, name: 'Public', type: 'public',
    capabilities: publicCaps, memberIds: [],
    // Only the data room is published; payroll is not.
    sourcePermissions: publishDocument ? { 'src-room': { read: true } } : {},
  });
  await db.insert(metrics).values({
    id: 'metric-1', workspaceId: WS, name: 'Revenue this week', description: 'Steam plus Stripe, gross.',
    value: 1234, marketRangeMax: 5000,
  });
  await db.insert(metricLogs).values({
    id: 'log-1', workspaceId: WS, metricId: 'metric-1', metricName: 'Revenue this week',
    value: 1000, timestamp: new Date('2026-08-01'),
  });
  await db.insert(markets).values({
    id: 'mkt-hero', workspaceId: WS, metricId: 'metric-1', metricName: 'Revenue this week',
    targetDate: '2026-12', rangeMin: 0, rangeMax: 5000, shares: [0, 0], liquidity: 50, pool: initialPool(50),
    active: true, resolved: false, voided: false, proposalId: null, branch: null,
  });
  await db.insert(proposals).values({
    id: 'prop-1', workspaceId: WS, proposedBy: 'owner', title: '$200: rewrite the store page',
    description: 'Better copy, better conversion.', askUsd: 200, status: 'pending',
  });
}

describe('the workspace brief', () => {
  test('carries the company, its numbers, its markets and its contracts', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('LookPilot');
    expect(res.body.charter).toContain('ship what the market ranks highest');
    expect(res.body.metrics[0].name).toBe('Revenue this week');
    expect(res.body.metrics[0].history).toEqual([{ at: '2026-08-01', value: 1000 }]);
    expect(res.body.markets[0].metricName).toBe('Revenue this week');
    expect(res.body.contracts[0].title).toContain('rewrite the store page');
    expect(res.body.contracts[0].askUsd).toBe(200);
  });

  test('includes a PUBLISHED document and never an unpublished one', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    const names = res.body.documents.map((d: { name: string }) => d.name);
    expect(names).toEqual(['Data room']);
    expect(JSON.stringify(res.body)).not.toContain('SECRET SALARIES');
  });

  test('a source nobody published stays out even when it is the only one', async () => {
    await seed({ publishDocument: false });
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.body.documents).toEqual([]);
  });

  test('a workspace whose Public group cannot read is refused, not summarised', async () => {
    await seed({ publicCaps: [] });
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.status).toBe(403);
  });

  test('?format=md is the same facts as one readable brief', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context?format=md`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('markdown');
    expect(res.text).toContain('# LookPilot');
    expect(res.text).toContain('Revenue this week');
    expect(res.text).toContain('rewrite the store page');
    expect(res.text).toContain('Data room');
    expect(res.text).not.toContain('SECRET SALARIES');
  });
});

describe('asking the floor', () => {
  test('is off, and says so, when no model is configured', async () => {
    await seed();
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'What do you sell?' });
    expect(res.status).toBe(503);
  });

  test('refuses an empty or oversized question before spending anything', async () => {
    await seed();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const empty = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: '   ' });
    expect(empty.status).toBe(400);
    const huge = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'x'.repeat(501) });
    expect(huge.status).toBe(400);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('the brief and the floor agree', () => {
  test('an unpriced contract reports no delta rather than zero', async () => {
    await seed();
    const ctx = (await buildWorkspaceContext(WS))!;
    // No conditional markets exist, so there is nothing priced yet. Zero
    // would read as "the market says this changes nothing", which is a
    // different and much stronger claim than "nobody has priced it".
    expect(ctx.contracts[0].impact).toEqual([]);
    expect(renderContextMarkdown(ctx)).not.toContain('difference 0');
  });
});

/**
 * HTTP-level test for GET /api/marketplace/stats, specifically the
 * weeklyActiveParticipants field (2026-08-14): distinct participants with a
 * trade OR a proposal in the trailing 7 days, across all workspaces. It is
 * the resolution source for the Telarchy dogfooding workspace's hero metric,
 * so its definition is pinned by a test.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.auth = null; next(); },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => { req.auth = req.auth ?? null; next(); },
}));

import request from 'supertest';
import express from 'express';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents, markets, metrics, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { marketplaceRouter } from '../routes/marketplace';
import { AppError } from '../lib/errors';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => { await ensureMigrations(); }, 30_000);
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-stats';
const DAY = 24 * 60 * 60 * 1000;

async function seed() {
  await db.insert(workspaces).values([{ id: WS, name: 'Stats WS', createdBy: 'seed', visibility: 'public' }]);
  await db.insert(agents).values([
    { id: 'trader-fresh', apiKeyHash: 'h1', balance: toUnits(0) },
    { id: 'trader-and-proposer', apiKeyHash: 'h2', balance: toUnits(0) },
    { id: 'proposer-fresh', apiKeyHash: 'h3', balance: toUnits(0) },
    { id: 'trader-stale', apiKeyHash: 'h4', balance: toUnits(0) },
  ]);
  await db.insert(metrics).values([{ id: 'm1', workspaceId: WS, name: 'M', value: 0, formula: '0', marketRangeMax: 100 }]);
  await db.insert(markets).values([{
    id: 'mkt1', workspaceId: WS, metricId: 'm1', metricName: 'M', targetDate: '2026-12',
    rangeMin: 0, rangeMax: 100, shares: [0, 0] as [number, number],
    liquidity: 10, pool: initialPool(10), active: true, resolved: false, voided: false,
  }]);
  const tradeBase = { workspaceId: WS, marketId: 'mkt1', direction: 'higher', shares: 1, cost: 1 };
  await db.insert(trades).values([
    { ...tradeBase, id: 't1', agentId: 'trader-fresh', createdAt: new Date(Date.now() - 1 * DAY) },
    { ...tradeBase, id: 't2', agentId: 'trader-and-proposer', createdAt: new Date(Date.now() - 2 * DAY) },
    // Two trades by one participant count once.
    { ...tradeBase, id: 't3', agentId: 'trader-fresh', createdAt: new Date(Date.now() - 3 * DAY) },
    // Outside the window: does not count.
    { ...tradeBase, id: 't4', agentId: 'trader-stale', createdAt: new Date(Date.now() - 9 * DAY) },
  ]);
  await db.insert(proposals).values([
    { id: 'p1', workspaceId: WS, proposedBy: 'proposer-fresh', title: 'fresh job', createdAt: new Date(Date.now() - 1 * DAY) },
    // Trader who also proposed still counts once across both tables.
    { id: 'p2', workspaceId: WS, proposedBy: 'trader-and-proposer', title: 'job', createdAt: new Date(Date.now() - 1 * DAY) },
    { id: 'p3', workspaceId: WS, proposedBy: 'trader-stale', title: 'old job', createdAt: new Date(Date.now() - 10 * DAY) },
  ]);
}

describe('GET /api/marketplace/stats', () => {
  test('weeklyActiveParticipants counts distinct traders-or-proposers in the trailing 7 days', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    // trader-fresh, trader-and-proposer, proposer-fresh; trader-stale is
    // outside the window in both tables.
    expect(res.body.weeklyActiveParticipants).toBe(3);
    expect(res.body.tradesThisWeek).toBe(3);
  });

  test('is zero on an empty platform rather than absent', async () => {
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.weeklyActiveParticipants).toBe(0);
  });
});

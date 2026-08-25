/**
 * HTTP-level test for GET /api/marketplace/stats, specifically the
 * weeklyActiveVerifiedTraders field (2026-08-14): distinct participants who
 * (a) have a Manifold account synced and (b) placed trades totalling at
 * least 100 credits (abs cost) in the trailing 7 days, across all
 * workspaces. It is the resolution source for the Telarchy dogfooding
 * workspace's hero metric, so its definition is pinned by a test.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, systemConfig, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-stats';
const DAY = 24 * 60 * 60 * 1000;

async function seed() {
  await db.insert(workspaces).values([{ id: WS, name: 'Stats WS', createdBy: 'seed', visibility: 'public' }]);
  await db.insert(agents).values([
    { id: 'verified-whale', apiKeyHash: 'h1', balance: toUnits(0) },
    { id: 'verified-seller', apiKeyHash: 'h2', balance: toUnits(0) },
    { id: 'verified-gesture', apiKeyHash: 'h3', balance: toUnits(0) },
    { id: 'unverified-whale', apiKeyHash: 'h4', balance: toUnits(0) },
    { id: 'verified-stale', apiKeyHash: 'h5', balance: toUnits(0) },
  ]);
  // The verified set: a synced Manifold account per agent.
  await db.insert(systemConfig).values([
    { key: 'manifold-claimed:agent:verified-whale', value: { username: 'whale' } },
    { key: 'manifold-claimed:agent:verified-seller', value: { username: 'seller' } },
    { key: 'manifold-claimed:agent:verified-gesture', value: { username: 'gesture' } },
    { key: 'manifold-claimed:agent:verified-stale', value: { username: 'stale' } },
  ]);
  await db
    .insert(metrics)
    .values([{ id: 'm1', workspaceId: WS, name: 'M', value: 0, formula: '0', marketRangeMax: 100 }]);
  await db.insert(markets).values([
    {
      id: 'mkt1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'M',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
  ]);
  const base = { workspaceId: WS, marketId: 'mkt1', direction: 'higher', shares: 1 };
  await db.insert(trades).values([
    // Verified, 150 cr across two trades: counts.
    { ...base, id: 't1', agentId: 'verified-whale', cost: 90, createdAt: new Date(Date.now() - 1 * DAY) },
    { ...base, id: 't2', agentId: 'verified-whale', cost: 60, createdAt: new Date(Date.now() - 2 * DAY) },
    // Verified, sells only (negative cost) totalling 120 abs: counts.
    { ...base, id: 't3', agentId: 'verified-seller', cost: -120, createdAt: new Date(Date.now() - 1 * DAY) },
    // Verified but a costless-gesture 5 cr: does NOT count (100 cr floor).
    { ...base, id: 't4', agentId: 'verified-gesture', cost: 5, createdAt: new Date(Date.now() - 1 * DAY) },
    // 500 cr but no Manifold sync: does NOT count.
    { ...base, id: 't5', agentId: 'unverified-whale', cost: 500, createdAt: new Date(Date.now() - 1 * DAY) },
    // Verified and heavy, but outside the window: does NOT count.
    { ...base, id: 't6', agentId: 'verified-stale', cost: 500, createdAt: new Date(Date.now() - 9 * DAY) },
  ]);
}

describe('GET /api/marketplace/stats', () => {
  test('weeklyActiveVerifiedTraders = Manifold-synced AND >=100 cr abs traded in 7 days', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    // verified-whale (150 summed) and verified-seller (120 abs via sells).
    expect(res.body.weeklyActiveVerifiedTraders).toBe(2);
  });

  test('is zero on an empty platform rather than absent', async () => {
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.weeklyActiveVerifiedTraders).toBe(0);
  });
});

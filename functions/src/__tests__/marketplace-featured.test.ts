/**
 * HTTP-level tests for the public benchmark surface:
 *   GET  /api/marketplace/featured       (anonymous-readable, public-WS only)
 *   POST /api/admin/markets/featured     (platform-admin curation)
 *
 * Verifies the privacy contract — featured markets in private workspaces
 * stay private — and the admin gate.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      isMasterKey: req.headers['x-master-key'] === '1',
      uid: req.headers['x-user-id'] as string | undefined,
      agentId: req.headers['x-agent-id'] as string | undefined,
      workspaceId: req.headers['x-workspace-id'] as string | undefined,
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { agents, authUser, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { adminRouter } from '../routes/admin';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
// Run authMiddleware for the admin router so req.auth is populated; keep
// /api/marketplace anonymous to mirror the production mount.
const { authMiddleware } = require('../middleware/auth');
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/admin', authMiddleware, adminRouter);
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

const PUBLIC_WS = 'ws-public';
const PRIVATE_WS = 'ws-private';
const METRIC_PUB = 'metric-pub';
const METRIC_PRIV = 'metric-priv';
const MKT_PUB_FEATURED = 'mkt-public-featured';
const MKT_PUB_PLAIN = 'mkt-public-plain';
const MKT_PRIV_FEATURED = 'mkt-private-featured';
const ADMIN_AGENT = 'agent-admin';
const NORMAL_USER = 'user-normal';

async function seed() {
  await db.insert(workspaces).values([
    { id: PUBLIC_WS, name: 'Public WS', createdBy: 'seed', visibility: 'public' },
    { id: PRIVATE_WS, name: 'Private WS', createdBy: 'seed', visibility: 'private' },
  ]);
  await db.insert(authUser).values([
    { id: 'uid-admin', name: 'Admin', email: 'admin@example.test' },
    { id: NORMAL_USER, name: 'Normal', email: 'normal@example.test' },
  ]);
  await db.insert(agents).values([
    { id: ADMIN_AGENT, apiKeyHash: 'h-admin', balance: toUnits(0), authUserId: 'uid-admin', platformAdmin: true },
    { id: 'agent-normal', apiKeyHash: 'h-normal', balance: toUnits(0), authUserId: NORMAL_USER },
  ]);
  await db.insert(metrics).values([
    { id: METRIC_PUB, workspaceId: PUBLIC_WS, name: 'Pub metric', value: 0, formula: '0', marketRangeMax: 100 },
    { id: METRIC_PRIV, workspaceId: PRIVATE_WS, name: 'Priv metric', value: 0, formula: '0', marketRangeMax: 100 },
  ]);
  const marketBase = {
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
  };
  await db.insert(markets).values([
    {
      ...marketBase,
      id: MKT_PUB_FEATURED,
      workspaceId: PUBLIC_WS,
      metricId: METRIC_PUB,
      metricName: 'Pub metric',
      targetDate: '2026-12',
      featured: true,
    },
    {
      ...marketBase,
      id: MKT_PUB_PLAIN,
      workspaceId: PUBLIC_WS,
      metricId: METRIC_PUB,
      metricName: 'Pub metric',
      targetDate: '2026-11',
      featured: false,
    },
    {
      ...marketBase,
      id: MKT_PRIV_FEATURED,
      workspaceId: PRIVATE_WS,
      metricId: METRIC_PRIV,
      metricName: 'Priv metric',
      targetDate: '2026-12',
      featured: true,
    },
  ]);
}

describe('GET /api/marketplace/featured', () => {
  test('returns only featured markets in public-visibility workspaces', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/featured');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      workspaceId: PUBLIC_WS,
      workspaceName: 'Public WS',
      marketId: MKT_PUB_FEATURED,
      metricName: 'Pub metric',
      targetDate: '2026-12',
    });
    // Privacy contract: the private-workspace featured market never appears
    expect(res.body.find((m: any) => m.workspaceId === PRIVATE_WS)).toBeUndefined();
    // Plain (non-featured) public market is filtered out
    expect(res.body.find((m: any) => m.marketId === MKT_PUB_PLAIN)).toBeUndefined();
  });

  // What an owner reads after paying: the pool is the credits that went in,
  // and `liquidity` beside it is b = pool / ln 2. Sending only b made a
  // 1,000-credit injection read as 1,443 in the pool (owner, 2026-08-30).
  test('carries the pool in credits, separately from the sensitivity b', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/featured');
    expect(res.status).toBe(200);
    const m = res.body[0];
    expect(m.pool).toBeCloseTo(initialPool(10), 6);
    expect(m.liquidity).toBe(10);
    // The two are not the same number, and the credit one is the pool.
    expect(m.pool).not.toBeCloseTo(m.liquidity, 3);
  });

  test('returns [] when no featured markets exist anywhere', async () => {
    await db.insert(workspaces).values({ id: PUBLIC_WS, name: 'Public WS', createdBy: 'seed', visibility: 'public' });
    const res = await request(app).get('/api/marketplace/featured');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/admin/markets/featured', () => {
  test('platform admin can flip the flag', async () => {
    await seed();
    const res = await request(app)
      .post('/api/admin/markets/featured')
      .set('X-User-Id', 'uid-admin')
      .send({ marketId: MKT_PUB_PLAIN, workspaceId: PUBLIC_WS, featured: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: MKT_PUB_PLAIN, workspaceId: PUBLIC_WS, featured: true });

    const after = await request(app).get('/api/marketplace/featured');
    expect(after.body).toHaveLength(2);
  });

  test('master key can flip the flag', async () => {
    await seed();
    const res = await request(app)
      .post('/api/admin/markets/featured')
      .set('X-Master-Key', '1')
      .send({ marketId: MKT_PUB_FEATURED, workspaceId: PUBLIC_WS, featured: false });
    expect(res.status).toBe(200);
    expect(res.body.featured).toBe(false);
  });

  test('unauthorized callers get 403', async () => {
    await seed();
    const res = await request(app)
      .post('/api/admin/markets/featured')
      .set('X-User-Id', NORMAL_USER)
      .send({ marketId: MKT_PUB_PLAIN, workspaceId: PUBLIC_WS, featured: true });
    expect(res.status).toBe(403);
  });

  test('rejects malformed body with 400', async () => {
    await seed();
    const res = await request(app)
      .post('/api/admin/markets/featured')
      .set('X-Master-Key', '1')
      .send({ marketId: MKT_PUB_PLAIN, workspaceId: PUBLIC_WS });
    expect(res.status).toBe(400);
  });

  test('returns 404 when market does not exist', async () => {
    await seed();
    const res = await request(app)
      .post('/api/admin/markets/featured')
      .set('X-Master-Key', '1')
      .send({ marketId: 'nope', workspaceId: PUBLIC_WS, featured: true });
    expect(res.status).toBe(404);
  });
});

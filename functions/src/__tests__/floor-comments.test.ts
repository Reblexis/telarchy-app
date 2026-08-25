/**
 * The floor's public comments read (owner ask 2026-08-11): the thread
 * under a market or proposal is readable with no account on an Open
 * workspace, and stays closed where the Public group cannot read.
 * Posting is the existing authenticated message routes; this pins only
 * the public window onto them.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, marketMessages, markets, permissionGroups, proposalMessages, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-comments';

async function seed(publicCaps: string[]) {
  await db.insert(agents).values([{ id: 'agent-c1', apiKeyHash: 'h-c1', balance: 0, nickname: 'carol' }]);
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Comments WS', createdBy: 'agent-c1', visibility: 'public', slug: 'comments-ws' });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-c',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
  });
  await db.insert(markets).values({
    id: 'mkt-c1',
    workspaceId: WS,
    metricId: 'metric-c',
    metricName: 'Revenue',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
  await db.insert(marketMessages).values({
    id: 'mm1',
    workspaceId: WS,
    marketId: 'mkt-c1',
    from: 'agent-c1',
    content: 'thin book, fair price',
    createdAt: new Date(),
  });
  await db.insert(proposalMessages).values({
    id: 'pm1',
    workspaceId: WS,
    proposalId: 'prop-c1',
    from: 'agent-c1',
    content: 'show your channel first',
    createdAt: new Date(),
  });
}

describe('public comments window', () => {
  test('market and proposal threads read anonymously on an Open workspace', async () => {
    await seed(['read', 'trade']);
    const market = await request(app).get(`/api/marketplace/${WS}/comments?marketId=mkt-c1`);
    expect(market.status).toBe(200);
    expect(market.body).toHaveLength(1);
    expect(market.body[0].fromName).toBe('carol');
    expect(market.body[0].content).toBe('thin book, fair price');

    const prop = await request(app).get(`/api/marketplace/${WS}/comments?proposalId=prop-c1`);
    expect(prop.status).toBe(200);
    expect(prop.body[0].content).toBe('show your channel first');
  });

  test('a workspace whose Public group cannot read stays closed, and a missing subject 400s', async () => {
    await seed([]);
    const closed = await request(app).get(`/api/marketplace/${WS}/comments?marketId=mkt-c1`);
    expect(closed.status).toBe(403);

    await truncateAll();
    await seed(['read']);
    const bare = await request(app).get(`/api/marketplace/${WS}/comments`);
    expect(bare.status).toBe(400);
  });
});

/**
 * GET /api/predictions/positions filters in SQL (docs/infra/deploy.md,
 * "Per-participant reads are keyed by the participant").
 *
 * A trading page polls this every 15 seconds with `?marketId=`. It read every
 * position the participant ever held in the workspace and dropped the rest in
 * JS; a bot on a floor that opens a book a second holds hundreds of thousands.
 * The answer is unchanged: the one market asked for, positions with shares
 * only.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = { agentId: 'kai', workspaceId: req.headers['x-workspace-id'], capabilities: new Set(['read', 'trade']) };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, positions, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { captureQueries } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);

const WS = 'ws-pos';
const N = 50;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'kai', apiKeyHash: 'h-kai', balance: 0 },
    { id: 'bo', apiKeyHash: 'h-bo', balance: 0 },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Positions', createdBy: 'kai' });
  const ids = [...Array.from({ length: N }, (_, i) => `m-${i}`), 'm-zero'];
  await db.insert(markets).values(
    ids.map(id => ({
      id,
      workspaceId: WS,
      metricId: 'metric',
      metricName: 'Game score',
      targetDate: '2030',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 10,
      pool: initialPool(10),
    })),
  );
  await db.insert(positions).values([
    ...Array.from({ length: N }, (_, i) => ({
      id: `kai_m-${i}_higher`,
      workspaceId: WS,
      agentId: 'kai',
      marketId: `m-${i}`,
      direction: 'higher',
      shares: 5,
      totalCost: 2,
    })),
    // Sold down to nothing.
    {
      id: 'kai_m-zero_higher',
      workspaceId: WS,
      agentId: 'kai',
      marketId: 'm-zero',
      direction: 'higher',
      shares: 0,
      totalCost: 2,
    },
    // Someone else's.
    {
      id: 'bo_m-7_lower',
      workspaceId: WS,
      agentId: 'bo',
      marketId: 'm-7',
      direction: 'lower',
      shares: 3,
      totalCost: 1,
    },
  ]);
});

const get = (q: string) => request(app).get(`/api/predictions/positions${q}`).set('X-Workspace-Id', WS);

test('?marketId= answers the one position in that market, with what it is in', async () => {
  const res = await get('?marketId=m-7');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0]).toMatchObject({ marketId: 'm-7', agentId: 'kai', shares: 5, metricName: 'Game score' });
});

test('a position sold down to zero shares is not listed', async () => {
  const all = await get('');
  expect(all.body).toHaveLength(N);
  expect(all.body.map((p: { marketId: string }) => p.marketId)).not.toContain('m-zero');
  expect((await get('?marketId=m-zero')).body).toEqual([]);
});

test('the market filter and the held-shares filter run in the database, not over every position', async () => {
  const log = captureQueries();
  try {
    await get('?marketId=m-7');
  } finally {
    log.stop();
  }
  const reads = log.stats.filter(s => /from "positions"/i.test(s.sql));
  expect(reads.length).toBeGreaterThan(0);
  expect(Math.max(...reads.map(s => s.rows))).toBe(1);
});

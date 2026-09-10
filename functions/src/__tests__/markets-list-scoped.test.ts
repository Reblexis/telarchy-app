/**
 * GET /api/predictions/markets is a read (docs/infra/deploy.md, "Reads are
 * bounded in the size of a workspace"): its trade counts carry the workspace
 * so the trades index applies instead of a scan of every trade on the site,
 * and the relative-date refresh it used to await runs beside the response,
 * never in front of it (notes/snake-load-audit-2026-09-10.md, item 13).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-ml',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// A refresh that never finishes. If the listing awaited it, the request
// below would hang until supertest's timeout.
jest.mock('../services/markets', () => ({
  ...jest.requireActual('../services/markets'),
  refreshRelativeDateMarkets: jest.fn(() => new Promise(() => undefined)),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { refreshRelativeDateMarkets } from '../services/markets';
import { getMarkets } from '../services/predictions';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-ml';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'agent-ml', apiKeyHash: 'h-ml', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'List', slug: 'list', createdBy: 'agent-ml' });
  await db
    .insert(metrics)
    .values({ id: 'metric-ml', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100 });
  await db.insert(markets).values({
    id: 'mkt-ml',
    workspaceId: WS,
    metricId: 'metric-ml',
    metricName: 'Revenue',
    targetDate: '2030-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
});

test('trade counts are scoped to the workspace', async () => {
  const cap = captureQueries();
  let rows: Awaited<ReturnType<typeof getMarkets>>;
  try {
    rows = await getMarkets({}, undefined, WS);
  } finally {
    cap.stop();
  }
  expect(rows).toHaveLength(1);
  const q = cap.queries.find(s => s.includes('from "trades"'));
  expect(q).toBeDefined();
  expect(q).toContain('"workspace_id"');
});

test('the listing answers while the refresh is still running', async () => {
  const res = await request(app).get('/api/predictions/markets').set('X-Workspace-Id', WS).timeout(5_000);
  expect(res.status).toBe(200);
  expect(res.body.map((m: { id: string }) => m.id)).toEqual(['mkt-ml']);
  // The refresh still happens (the cooldown inside it keeps it to one run
  // per five minutes); it is just not in front of the reader.
  expect(refreshRelativeDateMarkets).toHaveBeenCalledWith(WS);
});

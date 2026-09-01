/**
 * A bot learns that something changed by breaking, and that is the whole
 * problem.
 *
 * There is no API version and no deprecation signal, so a participant written
 * a month ago is running against a surface it cannot tell has moved. Full
 * `/v1` URL versioning would freeze 190 endpoints that are still being
 * reshaped weekly; a standard header costs nothing and gives a running bot the
 * one thing it lacks, which is notice, in a response it is already reading.
 *
 * `GET /api/predictions/markets` is the first real user. `?active=`,
 * `?includeResolved=` and `?includeVoided=` were superseded by the single
 * `?status=` filter and still work, which is exactly the state a deprecation
 * signal exists for: nothing is broken, and the caller should be told anyway.
 *
 * The rule this file protects: a deprecation is a NOTICE, never a refusal. A
 * caller sending the old parameter must get the same answer it got before,
 * plus headers.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups } from '../db/schema';
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
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-deprecation';
const OWNER = 'agent-dep-owner';
const READER = 'reader-bot';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-dep-owner', balance: toUnits(0) },
    { id: READER, apiKeyHash: 'h-reader', balance: toUnits(100) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Deprecation',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [READER] })
    .where(eq(permissionGroups.id, trader.id));

  await db.insert(metrics).values({
    id: 'metric-dep',
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'market-dep',
    workspaceId: WS,
    metricId: 'metric-dep',
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
}

const list = (q = '') =>
  request(app).get(`/api/predictions/markets${q}`).set('X-Test-Agent-Id', READER).set('X-Workspace-Id', WS);

describe('a superseded query parameter announces itself', () => {
  test('THE RULE: it is a notice, not a refusal, and the answer is unchanged', async () => {
    const modern = await list('?status=open');
    const legacy = await list('?active=true');
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(modern.body);
  });

  test('the standard Deprecation header is set', async () => {
    const res = await list('?active=true');
    expect(res.headers.deprecation).toBeDefined();
  });

  test('a Link points at the policy, so the notice is actionable', async () => {
    const res = await list('?active=true');
    expect(res.headers.link).toContain('rel="deprecation"');
    expect(res.headers.link).toContain('compatibility');
  });

  test('the replacement is named, not just the problem', async () => {
    const res = await list('?includeResolved=true');
    expect(String(res.headers['x-telarchy-deprecation'])).toContain('status');
  });

  test('every superseded parameter is covered, not only the first', async () => {
    for (const q of ['?active=true', '?includeResolved=true', '?includeVoided=true']) {
      const res = await list(q);
      expect({ q, deprecated: res.headers.deprecation !== undefined }).toEqual({ q, deprecated: true });
    }
  });
});

describe('the current parameters say nothing', () => {
  test('?status= is the supported form and is not flagged', async () => {
    const res = await list('?status=open');
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.link).toBeUndefined();
  });

  test('a bare call is not flagged', async () => {
    const res = await list();
    expect(res.headers.deprecation).toBeUndefined();
  });

  test('other query parameters are not flagged', async () => {
    const res = await list('?limit=5');
    expect(res.headers.deprecation).toBeUndefined();
  });
});

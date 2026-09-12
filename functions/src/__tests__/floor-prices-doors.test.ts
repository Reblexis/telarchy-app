/**
 * The prices read's doors in the real app (docs/guides/api-reference.md,
 * "Rate limits"; docs/infra/deploy.md, "Prices, one channel across
 * instances").
 *
 * A viewer polls GET /api/marketplace/:id/prices once a second. Two things
 * in front of the router would each defeat that: the global limiter (600 a
 * minute per anonymous IP, which an office of viewers behind one address
 * reaches) and credential resolution, which turns a signed-in viewer's
 * cookie into a session lookup every second. Neither may touch this route,
 * and the prices polls must not count against the trade limiter.
 */

process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-prices-doors';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'prices-doors-secret-prices-doors-12';
// A tiny limit, so this file can prove the limiter is live beside the route
// that must never meet it.
process.env.RATE_LIMIT_MAX = '8';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'stub' }),
}));
const sessionLookups = { n: 0 };
jest.mock('../auth', () => ({
  auth: {
    api: {
      getSession: async () => {
        sessionLookups.n++;
        return null;
      },
    },
  },
}));

import request from 'supertest';
import { agents } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { isPricePollPath } from '../middleware/route-policy';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

// Required after the env above: app.ts reads RATE_LIMIT_MAX at import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../app') as typeof import('../app');

const WS = 'ws-prices-doors';

beforeAll(async () => {
  await ensureMigrations();
  await truncateAll();
  await db.insert(agents).values({ id: 'agent-doors-owner', apiKeyHash: 'h-do', balance: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Doors',
    createdBy: 'agent-doors-owner',
    ownerAgentId: 'agent-doors-owner',
    visibility: 'public',
  });
});

test('the prices path is recognised exactly, and nothing near it is', () => {
  expect(isPricePollPath('/api/marketplace/snake/prices')).toBe(true);
  expect(isPricePollPath('/api/marketplace/snake/prices/')).toBe(true);
  expect(isPricePollPath('/api/marketplace/snake')).toBe(false);
  expect(isPricePollPath('/api/marketplace/snake/prices/extra')).toBe(false);
  expect(isPricePollPath('/api/marketplace/a/b/prices')).toBe(false);
  expect(isPricePollPath('/api/predictions/trade')).toBe(false);
});

test('A VIEWER POLLING PRICES IS NEVER RATE LIMITED, while the limiter is live for everything else', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 30; i++) statuses.push((await request(app).get(`/api/marketplace/${WS}/prices`)).status);
  expect(statuses.filter(s => s === 429)).toEqual([]);

  const other: number[] = [];
  for (let i = 0; i < 12; i++) other.push((await request(app).get('/api/marketplace/workspaces/public')).status);
  expect(other).toContain(429);

  // And still not limited after the global bucket is spent.
  expect((await request(app).get(`/api/marketplace/${WS}/prices`)).status).not.toBe(429);
});

test('prices polls do not count against the trade limiter', async () => {
  for (let i = 0; i < 30; i++) await request(app).get(`/api/marketplace/${WS}/prices`);
  // Identified, so the global limiter (spent by the test above) skips it and
  // only the trade limiter could answer 429.
  const res = await request(app)
    .post('/api/predictions/trade')
    .set('X-Agent-Key', 'not-a-real-key')
    .set('X-Workspace-Id', WS)
    .send({});
  expect(res.status).not.toBe(429);
});

test('THE PRICES READ RESOLVES NO CREDENTIALS: a session cookie costs no session lookup', async () => {
  const before = sessionLookups.n;
  const res = await request(app)
    .get(`/api/marketplace/${WS}/prices`)
    .set('Cookie', 'better-auth.session_token=abc.def');
  expect(res.status).toBe(200);
  expect(sessionLookups.n).toBe(before);
});

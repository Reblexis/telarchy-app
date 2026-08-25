/**
 * The auth matrix: every mounted /api route, hit anonymously, with an agent key
 * and with the master key, and the status codes pinned in a fixture.
 *
 * This is the safety net under the deny-by-default restructure of app.ts
 * (2026-08-24): the fixture was recorded on the mount-order design and the
 * restructure had to reproduce it byte for byte. It stays as the regression
 * test for "did this change who can reach what". Regenerate deliberately with
 *   UPDATE_AUTH_MATRIX=1 npx jest route-auth-matrix
 * and read the diff before committing it.
 *
 * Bodies are `{}` and path params are `x`, so most routes answer 400/404 once
 * past auth; the interesting information is the difference between the three
 * columns, which is exactly the auth decision.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-matrix';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'matrix-secret-matrix-secret-1234';

jest.mock('../db/client', () => require('./harness/test-db'));
// better-auth ships ESM only, which ts-jest cannot load; the session path is not
// exercised here (anon, agent key, master key are), so the two imports are
// replaced by inert equivalents and every other line of the real middleware runs.
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { app } from '../app';
import { agentApiKeys, agents } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { hashKey } from '../middleware/auth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const FIXTURE = join(__dirname, 'fixtures', 'route-auth-matrix.json');
const WS = 'ws-auth-matrix';
const AGENT = 'agent-auth-matrix';
const AGENT_KEY = 'matrix-agent-key-raw-value';

/** Streaming or outbound routes that never return for a bare request. */
const SKIP = new Set<string>(['GET /api/events', 'GET /api/events/stream']);

import { listApiRoutes, type RouteRef } from './harness/routes';

const concrete = (path: string) => path.replace(/:[A-Za-z_]+\??/g, 'x').replace(/\*/g, 'x');

type Mode = 'anon' | 'agent' | 'master';
const MODES: Mode[] = ['anon', 'agent', 'master'];

async function hit(r: RouteRef, mode: Mode): Promise<number> {
  const method = r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let req = request(app)[method](concrete(r.path)).set('Origin', 'http://localhost');
  if (mode === 'agent') req = req.set('X-Agent-Key', AGENT_KEY).set('X-Workspace-Id', WS);
  if (mode === 'master') req = req.set('X-API-Key', process.env.API_KEY as string).set('X-Workspace-Id', WS);
  if (method !== 'get') req = req.send({});
  const res = await req.timeout({ deadline: 8000 });
  return res.status;
}

beforeAll(async () => {
  await ensureMigrations();
  await truncateAll();
  await db.insert(agents).values({ id: AGENT, apiKeyHash: hashKey(AGENT_KEY), balance: toUnits(100) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Auth matrix',
    createdBy: AGENT,
    ownerAgentId: AGENT,
    visibility: 'public',
  });
  await db
    .insert(agentApiKeys)
    .values({ hash: hashKey(AGENT_KEY), keyId: 'matrix-key', agentId: AGENT, workspaceId: WS, scopes: ['*'] });
});

test('every /api route answers the same status for anon, agent key and master key as the pinned matrix', async () => {
  const routes = listApiRoutes(app).filter(r => !SKIP.has(`${r.method} ${r.path}`));
  expect(routes.length).toBeGreaterThan(50);
  const matrix: Record<string, Record<Mode, number>> = {};
  for (const r of routes) {
    const row = {} as Record<Mode, number>;
    for (const mode of MODES) {
      try {
        row[mode] = await hit(r, mode);
      } catch (_e) {
        row[mode] = -1; // timed out or threw: recorded as such, still a stable value
      }
    }
    matrix[`${r.method} ${r.path}`] = row;
  }
  if (process.env.UPDATE_AUTH_MATRIX || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, JSON.stringify(matrix, null, 2) + '\n');
  }
  const pinned = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  expect(matrix).toEqual(pinned);
}, 240_000);

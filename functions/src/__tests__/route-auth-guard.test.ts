/**
 * Deny by default, enforced.
 *
 * Three checks that together make "a route shipped open by accident"
 * impossible to merge:
 *   1. app.ts mounts `apiAuthPolicy` on /api exactly once, before any router,
 *      and mounts no bare auth middleware anywhere else (the mount-order design
 *      this replaced, see middleware/route-policy.ts).
 *   2. Every optional-auth prefix in the policy is served by at least one mounted
 *      route, so the public list cannot rot.
 *   3. At runtime an unknown /api path is 401 anonymously and 404 with the master
 *      key: auth runs before routing, not after.
 * route-auth-matrix.test.ts pins the per-route outcome; this test pins the rule.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-guard';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'guard-secret-guard-secret-123456';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(404).json({ error: 'stub' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { ensureMigrations, truncateAll } from './harness/test-db';
import { listApiRoutes } from './harness/routes';
import { OPTIONAL_AUTH_PREFIXES, isOptionalAuthPath } from '../middleware/route-policy';
import { app } from '../app';

const APP_TS = readFileSync(join(__dirname, '..', 'app.ts'), 'utf8');

beforeAll(async () => { await ensureMigrations(); await truncateAll(); });

describe('app.ts', () => {
  test('mounts apiAuthPolicy on /api exactly once, before every router', () => {
    const policyMounts = [...APP_TS.matchAll(/app\.use\('\/api',\s*apiAuthPolicy\)/g)];
    expect(policyMounts).toHaveLength(1);
    const policyAt = policyMounts[0].index ?? -1;
    // Limiters and the JSON wrapper mounted on /api paths are not routers; the first
    // thing that can answer a request is a Router, an app.get/post handler, or the
    // BetterAuth handler.
    const firstRouterMount = APP_TS.search(/app\.use\('\/api[^']*',[^;]*?(Router\b|toNodeHandler)|app\.(get|post|all)\('\/api/);
    expect(firstRouterMount).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(firstRouterMount);
  });

  test('mounts no bare auth middleware (the policy owns the decision)', () => {
    const bare = [...APP_TS.matchAll(/app\.use\([^)]*\b(authMiddleware|optionalAuthMiddleware)\b[^)]*\)/g)].map(m => m[0]);
    expect(bare).toEqual([]);
  });
});

describe('optional-auth prefixes', () => {
  test('every prefix is served by a mounted route', () => {
    const routes = listApiRoutes(app);
    const stale = OPTIONAL_AUTH_PREFIXES
      .map(p => p.prefix)
      .filter(prefix => !routes.some(r => prefix === '/api' ? r.path === '/api' : r.path === prefix || r.path.startsWith(prefix + '/')));
    expect(stale).toEqual([]);
  });

  test('matching is by path segment, and /api is exact', () => {
    expect(isOptionalAuthPath('/api')).toBe(true);
    expect(isOptionalAuthPath('/api/')).toBe(true);
    expect(isOptionalAuthPath('/api/help')).toBe(true);
    expect(isOptionalAuthPath('/api/helpdesk')).toBe(false);
    expect(isOptionalAuthPath('/api/agents/register')).toBe(true);
    expect(isOptionalAuthPath('/api/metrics')).toBe(false);
    expect(isOptionalAuthPath('/api/workspaces/x')).toBe(false);
    expect(isOptionalAuthPath('/api/marketplace/x/ask?y=1')).toBe(true);
  });
});

describe('runtime', () => {
  test('an unknown /api path is denied before it is routed', async () => {
    const anon = await request(app).get('/api/definitely-not-a-route');
    expect(anon.status).toBe(401);
    const master = await request(app).get('/api/definitely-not-a-route')
      .set('X-API-Key', process.env.API_KEY as string).set('X-Workspace-Id', 'ws-guard');
    expect(master.status).toBe(404);
  });

  test('a private route is denied anonymously, a public one is not', async () => {
    expect((await request(app).get('/api/metrics')).status).toBe(401);
    expect((await request(app).get('/api/help')).status).toBe(200);
  });
});

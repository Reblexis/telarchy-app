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
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'stub' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { app } from '../app';
import { isOptionalAuthPath, OPTIONAL_AUTH_PREFIXES } from '../middleware/route-policy';
import { listApiRoutes } from './harness/routes';
import { ensureMigrations, truncateAll } from './harness/test-db';

const APP_TS = readFileSync(join(__dirname, '..', 'app.ts'), 'utf8');

beforeAll(async () => {
  await ensureMigrations();
  await truncateAll();
});

describe('app.ts', () => {
  test('mounts apiAuthPolicy on /api exactly once, before every router', () => {
    // The ONE deliberate pre-policy route is the Stripe webhook: it must be
    // mounted before express.json (signature verification needs the raw
    // bytes) and its authentication IS the signature, pinned in
    // liquidity-purchases.test.ts. Strip that single line so anything else
    // mounted early still fails this test.
    const SCANNED = APP_TS.replace(/app\.post\('\/api\/stripe\/webhook'.*\n/, '');
    const policyMounts = [...SCANNED.matchAll(/app\.use\('\/api',\s*apiAuthPolicy\)/g)];
    expect(policyMounts).toHaveLength(1);
    const policyAt = policyMounts[0].index ?? -1;
    // Limiters and the JSON wrapper mounted on /api paths are not routers; the first
    // thing that can answer a request is a Router, an app.get/post handler, or the
    // BetterAuth handler.
    const firstRouterMount = SCANNED.search(
      /app\.use\('\/api[^']*',[^;]*?(Router\b|toNodeHandler)|app\.(get|post|all)\('\/api/,
    );
    expect(firstRouterMount).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(firstRouterMount);
  });

  test('mounts no bare auth middleware (the policy owns the decision)', () => {
    const bare = [...APP_TS.matchAll(/app\.use\([^)]*\b(authMiddleware|optionalAuthMiddleware)\b[^)]*\)/g)].map(
      m => m[0],
    );
    expect(bare).toEqual([]);
  });
});

describe('optional-auth prefixes', () => {
  test('every prefix is served by a mounted route', () => {
    const routes = listApiRoutes(app);
    const stale = OPTIONAL_AUTH_PREFIXES.map(p => p.prefix).filter(
      prefix =>
        !routes.some(r =>
          prefix === '/api' ? r.path === '/api' : r.path === prefix || r.path.startsWith(prefix + '/'),
        ),
    );
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
  test('an unknown /api path answers 404 for everyone, credentials or not', async () => {
    // Changed deliberately (2026-09-01). This used to expect 401 for an
    // anonymous caller: the policy runs before every router, so a path nobody
    // mounted was refused by authMiddleware and never reached the 404 handler,
    // and a typo, an unmounted verb and a missing route all claimed to be
    // credential problems. That is the wrong answer to give an agent exploring
    // the API, which is what an agent does in its first minute.
    //
    // The policy now consults the mounted route table first (route-inventory)
    // and answers 404 when nothing could serve the request. It grants nothing:
    // a path that DOES match falls through to exactly the check it faced
    // before, which the rest of this file and route-auth-matrix pin, and every
    // endpoint is already published at GET /api/help, so naming a route as
    // absent discloses nothing that was hidden.
    const anon = await request(app).get('/api/definitely-not-a-route');
    expect(anon.status).toBe(404);
    const master = await request(app)
      .get('/api/definitely-not-a-route')
      .set('X-API-Key', process.env.API_KEY as string)
      .set('X-Workspace-Id', 'ws-guard');
    expect(master.status).toBe(404);
  });

  test('a real route that needs credentials is still 401, not 404', async () => {
    // The half of the old assertion that must not change: "you may not" and
    // "there is no such thing" stay different answers.
    const anon = await request(app).get('/api/metrics');
    expect(anon.status).toBe(401);
  });

  test('the beta surface (/beta/api/...) gets the same decision as /api/...', async () => {
    // app.ts rewrites /beta/api/* to /api/* before routing, so inside the policy
    // baseUrl + path is /api/..., while originalUrl still says /beta/api/...; the
    // policy must key on the former (it denied every anonymous beta call when it
    // read originalUrl, 2026-08-25). Exercised directly: the beta store the real
    // app would consult for /beta is not configured under test.
    const { apiAuthPolicy } = await import('../middleware/route-policy');
    const call = (path: string) =>
      new Promise<number | 'next'>(resolve => {
        const req = {
          originalUrl: `/beta/api${path}`,
          baseUrl: '/api',
          path,
          headers: {},
          query: {},
          method: 'GET',
        } as unknown as import('express').Request;
        const res = {
          status: (code: number) => ({ json: () => resolve(code) }),
        } as unknown as import('express').Response;
        apiAuthPolicy(req, res, () => resolve('next'));
      });
    expect(await call('/help')).toBe('next');
    expect(await call('/marketplace')).toBe('next');
    expect(await call('/metrics')).toBe(401);
  });

  test('a private route is denied anonymously, a public one is not', async () => {
    expect((await request(app).get('/api/metrics')).status).toBe(401);
    expect((await request(app).get('/api/help')).status).toBe(200);
  });
});

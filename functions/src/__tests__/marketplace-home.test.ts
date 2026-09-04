/**
 * GET /api/marketplace/home: the home page in one call.
 *
 * Until 2026-09-04 the home page made three waterfall stages (seasons, the
 * public listing, then one floor payload per row). This endpoint returns all
 * of it in one response, and server.ts inlines the same object into the
 * served HTML for a full document load. What is pinned here:
 *
 *   - seasons is exactly the array GET /api/seasons returns;
 *   - every listing row is exactly a GET /api/marketplace/workspaces/public
 *     row plus `floor`, exactly GET /api/marketplace/:id's body;
 *   - only public workspaces appear;
 *   - a floor that fails to build is null and the others still return;
 *   - the payload is memoized for 15 seconds, concurrent callers share one
 *     build, and a failed build does not poison the cache.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
  getAuthWorkspaceMemberships: async () => [],
}));

jest.mock('../lib/public-seasons', () => {
  const actual = jest.requireActual('../lib/public-seasons');
  return { ...actual, listPublicSeasons: jest.fn(actual.listPublicSeasons) };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, prizeSeasons } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { listPublicSeasons } from '../lib/public-seasons';
import { buildHomePayload, getHomePayload, marketplaceRouter, resetHomePayloadCache } from '../routes/marketplace';
import { seasonsRouter } from '../routes/seasons';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/seasons', seasonsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  resetHomePayloadCache();
  jest.restoreAllMocks();
});

const PUBLIC_WS = 'ws-home-public';
const PRIVATE_WS = 'ws-home-private';
const OWNER = 'agent-home-owner';
const METRIC = 'metric-home';
const MARKET = 'mkt-home';

async function seed() {
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-home-o', balance: 1_000_000_000_000 }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: PUBLIC_WS,
    name: 'Home Floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: PRIVATE_WS,
    name: 'Hidden Floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, PUBLIC_WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));
  await db.insert(metrics).values([
    {
      id: METRIC,
      workspaceId: PUBLIC_WS,
      name: 'Net 2026 (USD)',
      value: 45_000,
      formula: '0',
      marketRangeMax: 150_000,
      description: 'Everything earned in 2026.',
    },
  ]);
  await db.insert(markets).values([
    {
      id: MARKET,
      workspaceId: PUBLIC_WS,
      metricId: METRIC,
      metricName: 'Net 2026 (USD)',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 150_000,
      shares: [0, 12],
      liquidity: 5_000,
      pool: initialPool(5_000),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
  ]);
  await db.insert(prizeSeasons).values({
    id: 'season-home',
    name: 'Season Home',
    startsAt: new Date('2026-08-01'),
    endsAt: new Date('2026-12-31'),
    poolUsd: 1000,
    ladder: [{ place: 1, prizeUsd: 1000 }],
    workspaceIds: [PUBLIC_WS],
    rulesUrl: 'https://telarchy.com/legal/season-home',
    status: 'running',
  });
}

describe('GET /api/marketplace/home', () => {
  test('answers 200 with at, seasons and listings', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/home');
    expect(res.status).toBe(200);
    expect(typeof res.body.at).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.at))).toBe(false);
    expect(Array.isArray(res.body.seasons)).toBe(true);
    expect(Array.isArray(res.body.listings)).toBe(true);
  });

  test('seasons is exactly the array GET /api/seasons returns', async () => {
    await seed();
    const home = await request(app).get('/api/marketplace/home');
    const seasons = await request(app).get('/api/seasons');
    expect(seasons.status).toBe(200);
    expect(home.body.seasons).toHaveLength(1);
    expect(home.body.seasons).toEqual(seasons.body.seasons);
  });

  test('each listing is the public row plus floor, deep-equal to GET /api/marketplace/:id', async () => {
    await seed();
    const home = await request(app).get('/api/marketplace/home');
    const list = await request(app).get('/api/marketplace/workspaces/public');
    const floor = await request(app).get(`/api/marketplace/${PUBLIC_WS}`);
    expect(floor.status).toBe(200);

    expect(home.body.listings).toHaveLength(1);
    const row = home.body.listings[0];
    expect(row.workspaceId).toBe(PUBLIC_WS);
    const { floor: rowFloor, ...rest } = row;
    expect(rest).toEqual(list.body[0]);
    expect(rowFloor.markets.length).toBeGreaterThan(0);
    expect(rowFloor.markets[0].marketId).toBe(MARKET);
    expect(rowFloor).toEqual(floor.body);
  });

  test('a private workspace is absent', async () => {
    await seed();
    const home = await request(app).get('/api/marketplace/home');
    const ids = home.body.listings.map((l: { workspaceId: string }) => l.workspaceId);
    expect(ids).toEqual([PUBLIC_WS]);
    expect(ids).not.toContain(PRIVATE_WS);
  });

  test('an empty platform answers with empty arrays, not an error', async () => {
    const home = await request(app).get('/api/marketplace/home');
    expect(home.status).toBe(200);
    expect(home.body.seasons).toEqual([]);
    expect(home.body.listings).toEqual([]);
  });

  test('is served from cache on a second call within 15s: `at` is identical', async () => {
    await seed();
    const first = await request(app).get('/api/marketplace/home');
    // A change after the first build is invisible until the cache expires.
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));
    const second = await request(app).get('/api/marketplace/home');
    expect(second.body.at).toBe(first.body.at);
    expect(second.body).toEqual(first.body);
    expect(second.body.listings[0].floor.markets).toHaveLength(1);
  });

  test('rebuilds once the 15 seconds are up', async () => {
    await seed();
    const first = await request(app).get('/api/marketplace/home');
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 15_001);
    const later = await request(app).get('/api/marketplace/home');
    expect(later.body.at).not.toBe(first.body.at);
    expect(later.body.listings[0].floor.markets).toHaveLength(0);
  });

  test('concurrent callers share one in-flight build', async () => {
    await seed();
    const seasonsSpy = listPublicSeasons as jest.Mock;
    seasonsSpy.mockClear();
    const [a, b, c] = await Promise.all([getHomePayload(), getHomePayload(), getHomePayload()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(seasonsSpy).toHaveBeenCalledTimes(1);
  });

  test('a failed build answers 500 and does not poison the cache', async () => {
    await seed();
    (listPublicSeasons as jest.Mock).mockRejectedValueOnce(new Error('seasons unavailable'));
    const failed = await request(app).get('/api/marketplace/home');
    expect(failed.status).toBe(500);
    const ok = await request(app).get('/api/marketplace/home');
    expect(ok.status).toBe(200);
    expect(ok.body.listings).toHaveLength(1);
    // And the recovered build is now cached like any other.
    const again = await request(app).get('/api/marketplace/home');
    expect(again.body.at).toBe(ok.body.at);
  });

  test('one workspace whose floor throws yields floor: null while the others still return', async () => {
    await seed();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: 'ws-home-broken',
      name: 'Broken Floor',
      createdBy: OWNER,
      ownerAgentId: OWNER,
      visibility: 'public',
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const payload = await buildHomePayload({
      floorOf: async ws => {
        if (ws.id === 'ws-home-broken') throw new Error('floor exploded');
        return { stub: ws.id };
      },
    });
    const byId = new Map(payload.listings.map(l => [l.workspaceId, l.floor]));
    expect(byId.get('ws-home-broken')).toBeNull();
    expect(byId.get(PUBLIC_WS)).toEqual({ stub: PUBLIC_WS });
    expect(errorSpy).toHaveBeenCalled();
  });

  test('"home" is not read as a workspace slug', async () => {
    await seed();
    // A public workspace whose slug is literally "home" must not shadow the route.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: 'ws-home-slug',
      name: 'Home',
      createdBy: OWNER,
      ownerAgentId: OWNER,
      visibility: 'public',
    });
    const res = await request(app).get('/api/marketplace/home');
    expect(res.status).toBe(200);
    expect(res.body.listings).toBeDefined();
    expect(res.body.workspaceId).toBeUndefined();
  });
});

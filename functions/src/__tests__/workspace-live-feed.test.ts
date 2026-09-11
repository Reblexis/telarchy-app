/**
 * `liveFeed`: the owner's feed of the thing the market steers, drawn
 * natively on the floor (docs/ui-conventions.md, "The live view is a
 * segment of the chart slot"; owner ask 2026-09-11: "it should all be
 * doable within the telarchy.com it should replace the snake.telarchy.com").
 *
 * Pinned here: the setting takes `{ kind, url }` with `kind` from the
 * allow-list and an https url, or null, and nothing else; it needs
 * `manage`; it rides the public floor payload as a present key; and the
 * three proxy routes pass the upstream's JSON through with the stated
 * caches, one upstream fetch in flight per workspace, a 502 on failure,
 * and the history limit capped at 2000.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

let auth: { workspaceId: string; capabilities: Set<string>; uid?: string; agentId?: string; isMasterKey?: boolean };

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

jest.mock('../middleware/roles', () => ({
  requireCapability: (cap: string) => (req: any, res: any, next: any) => {
    if (!req.auth?.capabilities?.has(cap)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../middleware/capabilities', () => ({
  computeCapabilities: async () => new Set<string>(['manage']),
}));

import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { LIVE_FEED_KINDS, resetLiveFeedCache } from '../lib/live-feed';
import { marketplaceRouter } from '../routes/marketplace';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use(
  '/api/workspaces',
  (req: any, _res, next) => {
    req.auth = auth;
    next();
  },
  workspacesRouter,
);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-feed';
const WS2 = 'ws-feed-2';
const FEED = { kind: 'snake', url: 'https://snake.example.com' };

const put = (body: object) => request(app).put(`/api/workspaces/${WS}/settings`).send(body);
const floor = async () => (await request(app).get(`/api/marketplace/${WS}`)).body;

const realFetch = global.fetch;
let upstream: jest.Mock;
/** The fake upstream: answers `/state`, `/games` and `/history` with a body
 *  that names the path and the call count, so a cached answer is telling. */
function fakeUpstream(impl?: (url: string, init?: RequestInit) => Promise<Response> | Response): jest.Mock {
  upstream = jest.fn(async (url: string, init?: RequestInit) => {
    if (impl) return impl(url, init);
    const u = new URL(url);
    return new Response(JSON.stringify({ path: u.pathname, query: u.search, n: upstream.mock.calls.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  global.fetch = upstream as any;
  return upstream;
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  resetLiveFeedCache();
  auth = { workspaceId: WS, capabilities: new Set(['manage', 'manage_workspace']), agentId: 'agent-f1' };
  await db.insert(agents).values({ id: 'agent-f1', apiKeyHash: 'h-f1', balance: 0, nickname: 'owner' });
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Snake', createdBy: 'agent-f1', visibility: 'public', slug: 'snake' });
  await db
    .insert(workspaces)
    .values({ id: WS2, name: 'Other', createdBy: 'agent-f1', visibility: 'public', slug: 'other' });
  for (const [id, wsId] of [
    ['grp-pub-f1', WS],
    ['grp-pub-f2', WS2],
  ]) {
    await db.insert(permissionGroups).values({
      id,
      workspaceId: wsId,
      name: 'Public',
      type: 'public',
      capabilities: ['read'],
      memberIds: [],
    });
  }
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('the liveFeed setting', () => {
  test('the allow-list is snake, and nothing else yet', () => {
    expect([...LIVE_FEED_KINDS]).toEqual(['snake']);
  });

  test('{ kind: snake, url: https } is accepted and served on the public floor payload', async () => {
    expect((await put({ liveFeed: FEED })).status).toBe(200);
    expect((await floor()).liveFeed).toEqual(FEED);
  });

  test('the url is trimmed and a trailing slash dropped before it is stored', async () => {
    expect((await put({ liveFeed: { kind: 'snake', url: '  https://snake.example.com/ \n' } })).status).toBe(200);
    expect((await floor()).liveFeed).toEqual(FEED);
  });

  test('null clears it', async () => {
    await put({ liveFeed: FEED });
    expect((await put({ liveFeed: null })).status).toBe(200);
    expect((await floor()).liveFeed).toBeNull();
  });

  test('a settings write that does not name it leaves it alone', async () => {
    await put({ liveFeed: FEED });
    expect((await put({ description: 'Snake, steered by its market' })).status).toBe(200);
    expect((await floor()).liveFeed).toEqual(FEED);
  });

  test('a workspace that never set one reports null, not a missing key', async () => {
    const body = await floor();
    expect(body).toHaveProperty('liveFeed');
    expect(body.liveFeed).toBeNull();
  });

  test('the setting is read back on the workspace itself', async () => {
    await put({ liveFeed: FEED });
    const [row] = await db.select().from(workspaces).where(require('drizzle-orm').eq(workspaces.id, WS));
    expect(row.liveFeed).toEqual(FEED);
  });

  describe('{ kind from the allow-list, https url } or null: anything else is 400 and nothing is stored', () => {
    const bad: Array<[string, unknown]> = [
      ['http', { kind: 'snake', url: 'http://snake.example.com' }],
      ['javascript:', { kind: 'snake', url: 'javascript:alert(1)' }],
      ['a bare word', { kind: 'snake', url: 'snake.example.com' }],
      ['an unknown kind', { kind: 'chess', url: 'https://chess.example.com' }],
      ['an uppercase kind', { kind: 'Snake', url: 'https://snake.example.com' }],
      ['a missing kind', { url: 'https://snake.example.com' }],
      ['a missing url', { kind: 'snake' }],
      ['a bare string', 'https://snake.example.com'],
      ['a number', 42],
      ['an array', [FEED]],
      ['a boolean', true],
      ['an empty object', {}],
      ['a url that is not a string', { kind: 'snake', url: 42 }],
      [
        '501 characters',
        { kind: 'snake', url: `https://snake.example.com/${'a'.repeat(501 - 'https://snake.example.com/'.length)}` },
      ],
    ];
    for (const [label, value] of bad) {
      test(`${label} is refused`, async () => {
        const res = await put({ liveFeed: value });
        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/liveFeed/);
        expect((await floor()).liveFeed).toBeNull();
      });
    }

    test('a refused value does not clobber the one already set', async () => {
      await put({ liveFeed: FEED });
      expect((await put({ liveFeed: { kind: 'chess', url: 'https://x.example.com' } })).status).toBe(400);
      expect((await floor()).liveFeed).toEqual(FEED);
    });

    test('extra fields are dropped, not stored', async () => {
      expect((await put({ liveFeed: { ...FEED, token: 'secret' } })).status).toBe(200);
      expect((await floor()).liveFeed).toEqual(FEED);
    });
  });

  test('setting it requires manage', async () => {
    auth = { workspaceId: WS, capabilities: new Set(['read', 'trade']), agentId: 'agent-f1' };
    expect((await put({ liveFeed: FEED })).status).toBe(403);
    expect((await floor()).liveFeed).toBeNull();
  });

  test('it is plain manage, not manage_workspace', async () => {
    auth = { workspaceId: WS, capabilities: new Set(['manage']), agentId: 'agent-f1' };
    expect((await put({ liveFeed: FEED })).status).toBe(200);
  });

  test('the deprecated liveViewUrl still stores and serves beside it', async () => {
    expect((await put({ liveViewUrl: 'https://snake.example.com/board', liveFeed: FEED })).status).toBe(200);
    const body = await floor();
    expect(body.liveViewUrl).toBe('https://snake.example.com/board');
    expect(body.liveFeed).toEqual(FEED);
  });
});

describe('the live proxy', () => {
  const live = (path = '', slug = 'snake') => request(app).get(`/api/marketplace/${slug}/live${path}`);

  beforeEach(async () => {
    await put({ liveFeed: FEED });
    fakeUpstream();
  });

  test('/live passes <url>/state through as JSON, no-store to the browser', async () => {
    const res = await live();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: '/state', query: '', n: 1 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe('https://snake.example.com/state');
  });

  test('/live/games passes <url>/games through', async () => {
    const res = await live('/games');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('/games');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('/live/history passes game, from and limit through', async () => {
    const res = await live('/history?game=3&from=120&limit=300');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('/history');
    const q = new URLSearchParams(res.body.query);
    expect(q.get('game')).toBe('3');
    expect(q.get('from')).toBe('120');
    expect(q.get('limit')).toBe('300');
  });

  test('THE HISTORY LIMIT IS CAPPED AT 2000', async () => {
    const res = await live('/history?game=current&limit=99999');
    expect(res.status).toBe(200);
    expect(new URLSearchParams(res.body.query).get('limit')).toBe('2000');
  });

  test('a non-numeric or negative from and limit are dropped, not forwarded', async () => {
    const res = await live('/history?game=current&from=abc&limit=-5');
    expect(res.status).toBe(200);
    const q = new URLSearchParams(res.body.query);
    expect(q.get('game')).toBe('current');
    expect(q.has('from')).toBe(false);
    expect(q.has('limit')).toBe(false);
  });

  test('/live is cached for 2 seconds per workspace', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-11T12:00:00Z') });
    try {
      expect((await live()).body.n).toBe(1);
      expect((await live()).body.n).toBe(1);
      jest.setSystemTime(new Date('2026-09-11T12:00:01.900Z'));
      expect((await live()).body.n).toBe(1);
      jest.setSystemTime(new Date('2026-09-11T12:00:02.100Z'));
      expect((await live()).body.n).toBe(2);
      expect(upstream).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('/live/games and /live/history are cached for 30 seconds, history per query', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-11T12:00:00Z') });
    try {
      expect((await live('/games')).body.n).toBe(1);
      jest.setSystemTime(new Date('2026-09-11T12:00:29Z'));
      expect((await live('/games')).body.n).toBe(1);
      jest.setSystemTime(new Date('2026-09-11T12:00:31Z'));
      expect((await live('/games')).body.n).toBe(2);

      jest.setSystemTime(new Date('2026-09-11T12:01:00Z'));
      const a = (await live('/history?game=1&from=0&limit=300')).body.n;
      const b = (await live('/history?game=1&from=300&limit=300')).body.n;
      expect(b).toBe(a + 1);
      expect((await live('/history?game=1&from=0&limit=300')).body.n).toBe(a);
      jest.setSystemTime(new Date('2026-09-11T12:01:31Z'));
      expect((await live('/history?game=1&from=0&limit=300')).body.n).toBe(b + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the cache is per workspace: two floors on the same feed fetch separately', async () => {
    await request(app).put(`/api/workspaces/${WS2}/settings`).send({ liveFeed: FEED });
    expect((await live()).body.n).toBe(1);
    expect((await live('', 'other')).body.n).toBe(2);
    expect((await live()).body.n).toBe(1);
  });

  test('NEVER MORE THAN ONE UPSTREAM FETCH IN FLIGHT PER WORKSPACE', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(r => {
      release = r;
    });
    fakeUpstream(async () => {
      await gate;
      return new Response(JSON.stringify({ shared: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    // supertest sends only once the request is awaited, so start all three.
    const first = live().then(r => r);
    const second = live().then(r => r);
    const third = live().then(r => r);
    await new Promise(r => setTimeout(r, 30));
    expect(upstream).toHaveBeenCalledTimes(1);
    release!();
    const bodies = (await Promise.all([first, second, third])).map(r => r.body);
    expect(bodies).toEqual([{ shared: true }, { shared: true }, { shared: true }]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  test('an upstream error status is a 502 JSON', async () => {
    fakeUpstream(() => new Response('boom', { status: 500 }));
    const res = await live();
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('an upstream that throws (down, DNS) is a 502 JSON', async () => {
    fakeUpstream(() => {
      throw new TypeError('fetch failed');
    });
    const res = await live('/games');
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
  });

  test('an upstream that answers non-JSON is a 502 JSON', async () => {
    fakeUpstream(() => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const res = await live();
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
  });

  test('a failure is not cached: the next read tries the upstream again', async () => {
    let calls = 0;
    fakeUpstream(() => {
      calls += 1;
      return calls === 1
        ? new Response('boom', { status: 503 })
        : new Response(JSON.stringify({ ok: calls }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect((await live()).status).toBe(502);
    const res = await live();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: 2 });
  });

  test('the upstream fetch carries a 5-second timeout signal', async () => {
    await live();
    const init = upstream.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('a floor with no feed is 404 on all three, and the upstream is never asked', async () => {
    await put({ liveFeed: null });
    for (const path of ['', '/games', '/history?game=current']) {
      const res = await live(path);
      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe('string');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  test('an unknown slug is 404', async () => {
    expect((await live('', 'nowhere')).status).toBe(404);
  });

  test('a private floor is 403 by id (and, like every floor route, 404 by slug), and the upstream is never asked', async () => {
    await db.update(workspaces).set({ visibility: 'private' }).where(require('drizzle-orm').eq(workspaces.id, WS));
    expect((await live('', WS)).status).toBe(403);
    expect((await live()).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test('the routes resolve by id as well as by slug', async () => {
    expect((await live('', WS)).status).toBe(200);
  });
});

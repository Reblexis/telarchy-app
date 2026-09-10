/**
 * `liveViewUrl`: the owner's own picture of the thing the market steers,
 * embedded on the public floor (docs/ui-conventions.md, "The live view";
 * owner ask 2026-09-10, for the Snake floor: "could you visualize it in
 * telarchy itself?").
 *
 * The rules worth pinning: it is set through the settings endpoint by a
 * caller holding `manage`, it takes an https URL or null and nothing else
 * (an iframe pointed at http or javascript: is a hole, not a feature), it
 * is capped at 500 characters, and it rides the public floor payload as a
 * present key, since the floor renders it and null means "no box".
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

const WS = 'ws-live';
const URL_OK = 'https://snake.example.com/board';

const put = (body: object) => request(app).put(`/api/workspaces/${WS}/settings`).send(body);
const floor = async () => (await request(app).get(`/api/marketplace/${WS}`)).body;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  auth = { workspaceId: WS, capabilities: new Set(['manage', 'manage_workspace']), agentId: 'agent-l1' };
  await db.insert(agents).values({ id: 'agent-l1', apiKeyHash: 'h-l1', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Live WS',
    createdBy: 'agent-l1',
    visibility: 'public',
    slug: 'live-ws',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-l',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read'],
    memberIds: [],
  });
});

describe('the live view URL', () => {
  test('an https URL is accepted and served on the public floor payload', async () => {
    const set = await put({ liveViewUrl: URL_OK });
    expect(set.status).toBe(200);
    expect((await floor()).liveViewUrl).toBe(URL_OK);
  });

  test('the value is trimmed before it is stored', async () => {
    expect((await put({ liveViewUrl: `  ${URL_OK}\n` })).status).toBe(200);
    expect((await floor()).liveViewUrl).toBe(URL_OK);
  });

  test('null clears it, and so does an empty string', async () => {
    await put({ liveViewUrl: URL_OK });
    expect((await put({ liveViewUrl: null })).status).toBe(200);
    expect((await floor()).liveViewUrl).toBeNull();

    await put({ liveViewUrl: URL_OK });
    expect((await put({ liveViewUrl: '' })).status).toBe(200);
    expect((await floor()).liveViewUrl).toBeNull();
  });

  test('a settings write that does not name it leaves it alone', async () => {
    await put({ liveViewUrl: URL_OK });
    expect((await put({ description: 'Snake, steered by its market' })).status).toBe(200);
    expect((await floor()).liveViewUrl).toBe(URL_OK);
  });

  test('a workspace that never set one reports null, not a missing key', async () => {
    // The floor renders nothing for null; a missing key would read as
    // "not allowed to see", which is what the read gate means elsewhere.
    const body = await floor();
    expect(body).toHaveProperty('liveViewUrl');
    expect(body.liveViewUrl).toBeNull();
  });

  test('the setting is read back on the workspace itself', async () => {
    await put({ liveViewUrl: URL_OK });
    const [row] = await db.select().from(workspaces);
    expect(row.liveViewUrl).toBe(URL_OK);
  });

  describe('https only: anything else is 400 and nothing is stored', () => {
    const bad: Array<[string, unknown]> = [
      ['http', 'http://snake.example.com/board'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['a bare word', 'snake.example.com/board'],
      ['a protocol-relative URL', '//snake.example.com/board'],
      ['uppercase HTTP', 'HTTP://snake.example.com/board'],
      ['a number', 42],
      ['an object', { url: URL_OK }],
      ['an array', [URL_OK]],
      ['a boolean', true],
      ['501 characters', `https://snake.example.com/${'a'.repeat(501 - 'https://snake.example.com/'.length)}`],
    ];
    for (const [label, value] of bad) {
      test(`${label} is refused`, async () => {
        const res = await put({ liveViewUrl: value });
        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/liveViewUrl/);
        expect((await floor()).liveViewUrl).toBeNull();
      });
    }

    test('exactly 500 characters is the last accepted length', async () => {
      const url = `https://snake.example.com/${'a'.repeat(500 - 'https://snake.example.com/'.length)}`;
      expect(url.length).toBe(500);
      expect((await put({ liveViewUrl: url })).status).toBe(200);
      expect((await floor()).liveViewUrl).toBe(url);
    });

    test('a refused value does not clobber the one already set', async () => {
      await put({ liveViewUrl: URL_OK });
      expect((await put({ liveViewUrl: 'http://elsewhere.example.com' })).status).toBe(400);
      expect((await floor()).liveViewUrl).toBe(URL_OK);
    });
  });

  test('setting it requires manage', async () => {
    auth = { workspaceId: WS, capabilities: new Set(['read', 'trade']), agentId: 'agent-l1' };
    const res = await put({ liveViewUrl: URL_OK });
    expect(res.status).toBe(403);
    expect((await floor()).liveViewUrl).toBeNull();
  });

  test('it is plain manage, not manage_workspace', async () => {
    auth = { workspaceId: WS, capabilities: new Set(['manage']), agentId: 'agent-l1' };
    expect((await put({ liveViewUrl: URL_OK })).status).toBe(200);
  });
});

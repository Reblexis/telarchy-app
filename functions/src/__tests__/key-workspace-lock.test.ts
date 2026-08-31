process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-lock';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'lock-secret-lock-secret-12345678';

jest.mock('../db/client', () => require('./harness/test-db'));
// better-auth ships ESM only, which ts-jest cannot load. The session path is
// not what this tests, so the import is stubbed and every other line of the
// real middleware runs (same shape as route-auth-matrix).
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware, hashKey, optionalAuthMiddleware } from '../middleware/auth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

/**
 * A key pinned to one workspace (docs/guides/auth-and-keys.md, "A key can be
 * pinned to one workspace").
 *
 * The market page offers this as the default when someone hands their market
 * to their own agent: same powers, one market. It only means anything if
 * X-Workspace-Id cannot move the key elsewhere, which is the whole of what is
 * tested here. Without the pin a key minted "for this market" reaches every
 * market its owner belongs to, and nobody would find out until one of them
 * changed.
 */

const HOME = 'ws-home';
const OTHER = 'ws-other';
const AGENT = 'agent-pinned';
const LOCKED_KEY = 'locked-key-raw';
const OPEN_KEY = 'open-key-raw';

const app = express();
app.use(express.json());
app.get('/where', authMiddleware, (req, res) => {
  res.json({ workspaceId: req.auth?.workspaceId, caps: [...(req.auth?.capabilities ?? [])].sort() });
});
app.get('/public', optionalAuthMiddleware, (req, res) => {
  res.json({ workspaceId: req.auth?.workspaceId ?? null });
});

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h-pinned', balance: toUnits(100) });
  for (const [id, name] of [
    [HOME, 'Home'],
    [OTHER, 'Other'],
  ]) {
    // `as any` like every other suite here: the harness hands back a pglite
    // handle, which is structurally the same and nominally different.
    // biome-ignore lint/suspicious/noExplicitAny: test harness handle
    await provisionWorkspace(db as any, {
      wsId: id,
      name,
      createdBy: AGENT,
      ownerAgentId: AGENT,
      visibility: 'public',
    });
  }
  await db.insert(agentApiKeys).values([
    {
      hash: hashKey(LOCKED_KEY),
      keyId: 'k-locked',
      agentId: AGENT,
      workspaceId: HOME,
      scopes: ['*'],
      workspaceLocked: true,
    },
    { hash: hashKey(OPEN_KEY), keyId: 'k-open', agentId: AGENT, workspaceId: HOME, scopes: ['*'] },
  ]);
});

describe('a pinned key', () => {
  test('acts in its own workspace when no header names one', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', LOCKED_KEY).expect(200);
    expect(res.body.workspaceId).toBe(HOME);
    // Pinning narrows the workspace, never the powers inside it.
    expect(res.body.caps).toContain('manage');
  });

  test('refuses to act in another workspace, rather than quietly acting in its own', async () => {
    const res = await request(app)
      .get('/where')
      .set('X-Agent-Key', LOCKED_KEY)
      .set('X-Workspace-Id', OTHER)
      .expect(403);
    expect(res.body.error).toMatch(/limited to one workspace/i);
  });

  test('is happy when the header names the workspace it is already pinned to', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', LOCKED_KEY).set('X-Workspace-Id', HOME).expect(200);
    expect(res.body.workspaceId).toBe(HOME);
  });

  test('on an optional-auth read it resolves in its own workspace instead of 403ing a public page', async () => {
    const res = await request(app)
      .get('/public')
      .set('X-Agent-Key', LOCKED_KEY)
      .set('X-Workspace-Id', OTHER)
      .expect(200);
    expect(res.body.workspaceId).toBe(HOME);
  });
});

describe('an unpinned key', () => {
  test('still follows X-Workspace-Id anywhere its owner is a member, as it always has', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', OPEN_KEY).set('X-Workspace-Id', OTHER).expect(200);
    expect(res.body.workspaceId).toBe(OTHER);
  });
});

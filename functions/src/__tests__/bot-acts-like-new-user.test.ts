process.env.API_KEY = process.env.API_KEY || 'test-master-key-new-user';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'newuser-secret-newuser-secret-123';

jest.mock('../db/client', () => require('./harness/test-db'));
// better-auth ships ESM only, which ts-jest cannot load. The session path is
// not what this tests, so the import is stubbed and every other line of the
// real middleware runs (same shape as key-workspace-lock).
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, permissionGroups } from '../db/schema';
import { getGroupMemberIds, listParticipantsForWorkspace, provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware, hashKey, optionalAuthMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

/**
 * A bot is a newly signed-up user in every workspace it is not a member of
 * (docs/guides/auth-and-keys.md, "Which workspace a call lands in").
 *
 * Owner report 2026-09-14: a bot built against the API was refused trades on
 * Snake (403, no trade permission) because it had been set up for one other
 * workspace and never called join. "there should not be any need to join
 * public workspaces", and the bot "should be just like a new signed up user",
 * not a holder of its owner's rights.
 */

const HOME = 'ws-home';
const SNAKE = 'ws-snake';
const VIEW_ONLY = 'ws-view-only';
const UNLISTED = 'ws-unlisted';
const PRIVATE = 'ws-private';
const OWNER = 'agent-owner';
const BOT = 'agent-bot';
const OTHER_BOT = 'agent-other-bot';
const BOT_KEY = 'bot-key-raw';
const OTHER_BOT_KEY = 'other-bot-key-raw';
const READ_ONLY_KEY = 'bot-read-only-key-raw';

const app = express();
app.use(express.json());
app.get('/where', authMiddleware, (req, res) => {
  res.json({ workspaceId: req.auth?.workspaceId, caps: [...(req.auth?.capabilities ?? [])].sort() });
});
app.post('/act', authMiddleware, (req, res) => {
  res.json({ workspaceId: req.auth?.workspaceId, caps: [...(req.auth?.capabilities ?? [])].sort() });
});
app.get('/optional', optionalAuthMiddleware, (req, res) => {
  res.json({ agentId: req.auth?.agentId ?? null, caps: [...(req.auth?.capabilities ?? [])].sort() });
});
app.use('/api/marketplace', marketplaceRouter);

async function publicGroupMembers(workspaceId: string): Promise<string[]> {
  const [group] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public')));
  return getGroupMemberIds(group);
}

async function setPublicCaps(workspaceId: string, capabilities: string[]) {
  await db
    .update(permissionGroups)
    .set({ capabilities })
    .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public')));
}

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(100) },
    { id: BOT, apiKeyHash: 'h-bot', balance: toUnits(100), ownerAgentId: OWNER },
    { id: OTHER_BOT, apiKeyHash: 'h-other-bot', balance: toUnits(100) },
  ]);
  const floors: [string, string, 'public' | 'unlisted' | 'private'][] = [
    [HOME, 'Home', 'public'],
    [SNAKE, 'Snake', 'public'],
    [VIEW_ONLY, 'View only', 'public'],
    [UNLISTED, 'Unlisted', 'unlisted'],
    [PRIVATE, 'Private', 'private'],
  ];
  for (const [id, name, visibility] of floors) {
    // The bot's owner created every floor and sits in its Admin group, so a
    // bot that inherited its owner's rights would show `manage` everywhere.
    await provisionWorkspace(db as any, { wsId: id, name, createdBy: OWNER, ownerAgentId: OWNER, visibility });
  }
  await setPublicCaps(VIEW_ONLY, ['read']);
  // A stale `trade` left on a restricted floor's Public group must still give
  // a stranger nothing: visibility is the boundary, not the group.
  await setPublicCaps(UNLISTED, ['read', 'trade']);
  await setPublicCaps(PRIVATE, ['read', 'trade']);
  // The bot was set up for Home only, the way the Agents page registers one.
  await db
    .update(permissionGroups)
    .set({ memberIds: [BOT] })
    .where(and(eq(permissionGroups.workspaceId, HOME), eq(permissionGroups.type, 'public')));
  await db.insert(agentApiKeys).values([
    { hash: hashKey(BOT_KEY), keyId: 'k-bot', agentId: BOT, workspaceId: HOME, scopes: ['*'] },
    { hash: hashKey(OTHER_BOT_KEY), keyId: 'k-other', agentId: OTHER_BOT, workspaceId: HOME, scopes: ['*'] },
    {
      hash: hashKey(READ_ONLY_KEY),
      keyId: 'k-bot-read',
      agentId: BOT,
      workspaceId: HOME,
      scopes: ['workspace:read'],
    },
  ]);
});

describe('a bot needs no join call on a public workspace', () => {
  test('a bot set up for one workspace can trade on another public workspace it never joined', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    expect(res.body.workspaceId).toBe(SNAKE);
    expect(res.body.caps).toEqual(['read', 'trade']);
  });

  test('the same when the workspace is named by its slug', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', 'snake').expect(200);
    expect(res.body.workspaceId).toBe(SNAKE);
    expect(res.body.caps).toEqual(['read', 'trade']);
  });

  test('a public workspace whose Public group is view-only gives the bot read and not trade', async () => {
    const res = await request(app)
      .get('/where')
      .set('X-Agent-Key', BOT_KEY)
      .set('X-Workspace-Id', VIEW_ONLY)
      .expect(200);
    expect(res.body.caps).toEqual(['read']);
  });

  test('the key scopes still narrow what a non-member bot holds', async () => {
    const res = await request(app)
      .get('/where')
      .set('X-Agent-Key', READ_ONLY_KEY)
      .set('X-Workspace-Id', SNAKE)
      .expect(200);
    expect(res.body.caps).toEqual(['read']);
  });

  test('an optional-auth read by a non-member bot carries its identity and the Public group rights', async () => {
    const res = await request(app)
      .get('/optional')
      .set('X-Agent-Key', BOT_KEY)
      .set('X-Workspace-Id', SNAKE)
      .expect(200);
    expect(res.body.agentId).toBe(BOT);
    expect(res.body.caps).toEqual(['read', 'trade']);
  });
});

describe('a bot is a new user, never its owner', () => {
  test('a bot does not inherit its owner admin rights on a workspace the owner runs', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    expect(res.body.caps).not.toContain('manage');
    expect(res.body.caps).not.toContain('manage_workspace');
  });

  test('a bot holds nothing on an unlisted workspace it is not a member of, whatever its owner holds', async () => {
    const res = await request(app)
      .get('/where')
      .set('X-Agent-Key', BOT_KEY)
      .set('X-Workspace-Id', UNLISTED)
      .expect(200);
    expect(res.body.caps).toEqual([]);
  });

  test('a bot holds nothing on a private workspace it is not a member of', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', PRIVATE).expect(200);
    expect(res.body.caps).toEqual([]);
  });

  test('an optional-auth read on a private workspace does not carry the bot into it', async () => {
    const res = await request(app)
      .get('/optional')
      .set('X-Agent-Key', BOT_KEY)
      .set('X-Workspace-Id', PRIVATE)
      .expect(200);
    expect(res.body.caps).toEqual([]);
  });
});

describe('the first write joins the bot, the way the join call would', () => {
  test('a first write on a public workspace makes the bot a member, listed among its participants', async () => {
    expect(await publicGroupMembers(SNAKE)).not.toContain(BOT);
    await request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    expect(await publicGroupMembers(SNAKE)).toContain(BOT);
    const participants = await listParticipantsForWorkspace(SNAKE);
    expect(participants.map((p: { id: string }) => p.id)).toContain(BOT);
  });

  test('a read never joins the bot', async () => {
    await request(app).get('/where').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    await request(app).get('/optional').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    expect(await publicGroupMembers(SNAKE)).not.toContain(BOT);
  });

  test('a write on a view-only public workspace does not join the bot', async () => {
    await request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', VIEW_ONLY).expect(200);
    expect(await publicGroupMembers(VIEW_ONLY)).not.toContain(BOT);
  });

  test('a write with a read-only key does not join the bot', async () => {
    await request(app).post('/act').set('X-Agent-Key', READ_ONLY_KEY).set('X-Workspace-Id', SNAKE).expect(200);
    expect(await publicGroupMembers(SNAKE)).not.toContain(BOT);
  });

  test('a write on a restricted workspace never joins the bot', async () => {
    await request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', UNLISTED).expect(200);
    await request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', PRIVATE).expect(200);
    expect(await publicGroupMembers(UNLISTED)).not.toContain(BOT);
    expect(await publicGroupMembers(PRIVATE)).not.toContain(BOT);
  });

  test('five first writes at once join the bot exactly once', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200),
      ),
    );
    expect((await publicGroupMembers(SNAKE)).filter(id => id === BOT)).toHaveLength(1);
  });

  test('a bot joining at the same moment as another bot does not erase that other bot membership', async () => {
    await Promise.all([
      request(app).post('/act').set('X-Agent-Key', BOT_KEY).set('X-Workspace-Id', SNAKE).expect(200),
      request(app).post(`/api/marketplace/${SNAKE}/join`).set('X-Agent-Key', OTHER_BOT_KEY),
    ]);
    const members = await publicGroupMembers(SNAKE);
    expect(members).toContain(BOT);
    expect(members).toContain(OTHER_BOT);
  });

  test('two participants calling join at the same moment both end up members', async () => {
    await Promise.all([
      request(app).post(`/api/marketplace/${SNAKE}/join`).set('X-Agent-Key', BOT_KEY),
      request(app).post(`/api/marketplace/${SNAKE}/join`).set('X-Agent-Key', OTHER_BOT_KEY),
    ]);
    const members = await publicGroupMembers(SNAKE);
    expect(members).toContain(BOT);
    expect(members).toContain(OTHER_BOT);
  });

  test('a member bot keeps working as before', async () => {
    const res = await request(app).get('/where').set('X-Agent-Key', BOT_KEY).expect(200);
    expect(res.body.workspaceId).toBe(HOME);
    expect(res.body.caps).toEqual(['read', 'trade']);
  });
});

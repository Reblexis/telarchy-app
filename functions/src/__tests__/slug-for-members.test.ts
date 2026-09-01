/**
 * A member may name their workspace by slug, like everyone else already can.
 *
 * `X-Workspace-Id` takes a slug for an anonymous reader, because "someone
 * arriving from a shared link has a slug long before they have an id"
 * (lib/public-read.ts). For a caller holding a KEY it did not:
 * `resolveAgentWorkspace` compared the header against the agent's memberships,
 * which hold ids, so a slug never matched and the caller fell through to an
 * empty capability set.
 *
 * The effect was the worst shape available: registering made you WORSE off
 * than staying anonymous. Anonymous, the slug worked and reads answered 200.
 * With the key you had just been given, the same slug on the same endpoint
 * answered 403. Found 2026-09-01 by running the repository's own reference
 * agent against production, which registered successfully and then could not
 * read anything.
 *
 * Membership is still the gate. Resolving a NAME grants nothing: an agent that
 * is not a member gets the same empty set under either name, which is what the
 * second block asserts.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-slug-members';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'slug-members-secret-slug-members-1';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { eq } from 'drizzle-orm';
import request from 'supertest';
import { app } from '../app';
import { agentApiKeys, agents, permissionGroups, workspaces } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { hashKey } from '../middleware/auth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS_ID = 'ws-slug-members-uuid';
const SLUG = 'acme';
const OWNER = 'slug-members-owner';
const MEMBER = 'member-bot';
const MEMBER_KEY = 'member-bot-raw-key';
const STRANGER = 'stranger-bot';
const STRANGER_KEY = 'stranger-bot-raw-key';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-slug-owner', balance: toUnits(0) },
    { id: MEMBER, apiKeyHash: hashKey(MEMBER_KEY), balance: toUnits(100) },
    { id: STRANGER, apiKeyHash: hashKey(STRANGER_KEY), balance: toUnits(100) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_ID,
    name: 'Acme',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.update(workspaces).set({ slug: SLUG }).where(eq(workspaces.id, WS_ID));

  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS_ID));
  const pub = groups.find(g => g.type === 'public')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [MEMBER] })
    .where(eq(permissionGroups.id, pub.id));

  await db.insert(agentApiKeys).values([
    { hash: hashKey(MEMBER_KEY), keyId: 'k-member', agentId: MEMBER, workspaceId: WS_ID, scopes: ['*'] },
    { hash: hashKey(STRANGER_KEY), keyId: 'k-stranger', agentId: STRANGER, workspaceId: WS_ID, scopes: ['*'] },
  ]);
}

const read = (key: string, workspace: string) =>
  request(app)
    .get('/api/predictions/markets')
    .set('Origin', 'http://localhost')
    .set('X-Agent-Key', key)
    .set('X-Workspace-Id', workspace);

describe('a member may use the name they were given', () => {
  test('THE FIX: the slug works for a key holder, as it already did anonymously', async () => {
    const res = await read(MEMBER_KEY, SLUG);
    expect(res.status).toBe(200);
  });

  test('the id still works, unchanged', async () => {
    const res = await read(MEMBER_KEY, WS_ID);
    expect(res.status).toBe(200);
  });

  test('the slug is matched case-insensitively, as everywhere else', async () => {
    const res = await read(MEMBER_KEY, SLUG.toUpperCase());
    expect(res.status).toBe(200);
  });

  test('REGRESSION: a key holder is never worse off than an anonymous reader', async () => {
    // The shape that made this urgent. Registering must not cost you access
    // you had before you registered.
    const anon = await request(app)
      .get('/api/predictions/markets')
      .set('Origin', 'http://localhost')
      .set('X-Workspace-Id', SLUG);
    const withKey = await read(MEMBER_KEY, SLUG);
    expect({ anon: anon.status, withKey: withKey.status }).toEqual({ anon: 200, withKey: 200 });
  });
});

describe('resolving a name grants nothing', () => {
  test('THE RULE: a non-member gets no capabilities under either name', async () => {
    // Membership is the gate, and it still is. If the slug bought access, this
    // change would have handed every key holder every public floor.
    for (const name of [SLUG, WS_ID]) {
      const res = await request(app)
        .post('/api/predictions/trade')
        .set('Origin', 'http://localhost')
        .set('X-Agent-Key', STRANGER_KEY)
        .set('X-Workspace-Id', name)
        .send({ marketId: 'x', direction: 'higher', amount: 1 });
      expect({ name, status: res.status }).toEqual({ name, status: 403 });
    }
  });

  test('a slug nobody has resolves to nothing', async () => {
    const res = await read(MEMBER_KEY, 'no-such-floor');
    expect(res.status).toBe(403);
  });
});

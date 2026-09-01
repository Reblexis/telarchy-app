/**
 * The master key must name a workspace the same way everyone else does.
 *
 * The master-key path put the raw `X-Workspace-Id` header straight into
 * `req.auth.workspaceId`. Every route downstream treats that as a workspace
 * ID, so a call naming a floor by SLUG operated on a workspace that does not
 * exist. `GET /api/groups` calls `ensureSystemGroups(workspaceId)`, which
 * CREATES a system group set for whatever string it is handed, so one
 * diagnostic read with a slug wrote three orphan permission-group rows keyed
 * to the literal "telarchy" into production (2026-09-01; found because the
 * groups it returned had zero members while the real floor had 21).
 *
 * Silent, and wrong in the worst direction: it reports an empty floor rather
 * than an error, so a reader concludes the workspace is misconfigured.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-slug-path';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'master-slug-secret-master-slug-12';

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
import { agents, permissionGroups, workspaces } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS_ID = 'ws-master-slug-uuid';
const SLUG = 'acme';
const OWNER = 'master-slug-owner';
const MEMBER = 'master-slug-member';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-ms-owner', balance: toUnits(0) },
    { id: MEMBER, apiKeyHash: 'h-ms-member', balance: toUnits(0) },
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
});

const groupsWith = (workspace: string) =>
  request(app)
    .get('/api/groups')
    .set('Origin', 'http://localhost')
    .set('X-API-Key', process.env.API_KEY as string)
    .set('X-Workspace-Id', workspace);

describe('the master key naming a floor by slug', () => {
  test('THE FIX: it sees the real floor, not an empty one', async () => {
    const res = await groupsWith(SLUG);
    expect(res.status).toBe(200);
    const pub = res.body.find((g: { type: string }) => g.type === 'public');
    expect(pub.workspaceId).toBe(WS_ID);
    expect(pub.memberIds).toContain(MEMBER);
  });

  test('by id, unchanged', async () => {
    const res = await groupsWith(WS_ID);
    const pub = res.body.find((g: { type: string }) => g.type === 'public');
    expect(pub.memberIds).toContain(MEMBER);
  });

  test('THE RULE: naming a floor by slug creates no rows keyed to the slug', async () => {
    // The actual damage. ensureSystemGroups builds a group set for whatever
    // string it is given, so an unresolved slug wrote orphan rows into
    // production that no workspace owns and nothing can reach.
    await groupsWith(SLUG);
    const orphans = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, SLUG));
    expect(orphans).toEqual([]);
  });

  test('a name nobody has still creates nothing', async () => {
    await groupsWith('no-such-floor');
    const orphans = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, 'no-such-floor'));
    expect(orphans).toEqual([]);
  });
});

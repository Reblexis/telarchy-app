/**
 * A fresh browser account must keep its participant identity before its first
 * workspace exists, so self-targeted routes (GET /api/agents/me/keys, POST
 * /api/auth/profile) work between signup and workspace creation. Regression
 * for the onboarding smoke test where /api/agents/me/keys returned a bare 403
 * because resolveUser dropped agentId when memberships were empty.
 *
 * Also covers the workspace-creation return contract: provisionWorkspace
 * returns the slug so POST /api/workspaces can hand back { slug, ownerHandle }
 * and the caller can build /{ownerHandle}/{slug} without a second call.
 */

jest.mock('../db/client', () => require('./harness/test-db'));
// middleware/auth imports the BetterAuth instance (ESM-only); resolveUser
// itself never touches it, so stub the module out for this suite.
jest.mock('../auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: (h: unknown) => h }));

import { agents, authUser } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { resolveUser } from '../middleware/auth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

describe('resolveUser before the first workspace', () => {
  test('keeps agentId when the participant exists but has no memberships', async () => {
    await db.insert(authUser).values({ id: 'auth-user-1', name: 'U', email: 'u1@example.com' });
    await db.insert(agents).values({
      id: 'user-1',
      authUserId: 'auth-user-1',
      apiKeyHash: 'h-user-1',
    });
    const result = await resolveUser('auth-user-1');
    expect(result).toEqual({ workspaceId: '', agentId: 'user-1' });
  });

  test('still returns null when no participant row exists at all', async () => {
    expect(await resolveUser('never-provisioned')).toBeNull();
  });
});

describe('provisionWorkspace', () => {
  test('returns the slug it stored on the workspace row', async () => {
    await db.insert(authUser).values({ id: 'auth-owner-1', name: 'O', email: 'o1@example.com' });
    await db.insert(agents).values({
      id: 'owner-1',
      authUserId: 'auth-owner-1',
      apiKeyHash: 'h-owner-1',
    });
    const slug = await provisionWorkspace(db as any, {
      wsId: '00000000-0000-4000-8000-000000000001',
      name: 'Smoke Test Co',
      createdBy: 'owner-1',
      ownerAgentId: 'owner-1',
      visibility: 'private',
    });
    expect(typeof slug).toBe('string');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(/smoke/);
  });
});

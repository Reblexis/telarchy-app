/**
 * Platform admins (agents.platformAdmin = true) act as virtual admins of every
 * workspace via getParticipantWorkspaceMemberships, but they must not surface
 * in any workspace's participants tab via listParticipantsForWorkspace. These
 * two behaviours are paired: workspace-listing routes use the membership
 * lookup so the sidebar shows everything, while leaderboards / participants /
 * activity use the participant lister and stay clean.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { agents, permissionGroups } from '../db/schema';
import {
  getParticipantWorkspaceMemberships,
  listParticipantsForWorkspace,
  provisionWorkspace,
} from '../lib/participants';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function insertAgent(opts: { id: string; platformAdmin?: boolean }): Promise<void> {
  await db.insert(agents).values({
    id: opts.id,
    apiKeyHash: `hash-${opts.id}`,
    platformAdmin: opts.platformAdmin ?? false,
    balance: 0,
  });
}

describe('platform admin virtual workspace access', () => {
  test('getParticipantWorkspaceMemberships returns admin role for every workspace when participant is platformAdmin', async () => {
    await insertAgent({ id: 'super', platformAdmin: true });
    await insertAgent({ id: 'normal', platformAdmin: false });

    const wsA = randomUUID();
    const wsB = randomUUID();
    // pglite's transaction type doesn't structurally match the node-postgres
    // type provisionWorkspace declares; the runtime ops are identical.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, { wsId: wsA, name: 'A', createdBy: 'normal', ownerAgentId: 'normal' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, { wsId: wsB, name: 'B', createdBy: 'normal', ownerAgentId: 'normal' });

    const adminMemberships = await getParticipantWorkspaceMemberships('super');
    expect(adminMemberships).toHaveLength(2);
    expect(new Set(adminMemberships.map(m => m.workspaceId))).toEqual(new Set([wsA, wsB]));
    expect(adminMemberships.every(m => m.memberRole === 'admin')).toBe(true);

    const normalMemberships = await getParticipantWorkspaceMemberships('normal');
    expect(normalMemberships.map(m => m.workspaceId).sort()).toEqual([wsA, wsB].sort());
    expect(normalMemberships.every(m => m.memberRole === 'admin')).toBe(true);
  });

  test('listParticipantsForWorkspace hides platform admins even when they are in a permission group', async () => {
    await insertAgent({ id: 'super', platformAdmin: true });
    await insertAgent({ id: 'alice', platformAdmin: false });

    const ws = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, { wsId: ws, name: 'Alpha', createdBy: 'alice', ownerAgentId: 'alice' });

    // Inject the platform admin into the admin group as if a self-heal had run.
    const [adminGroup] = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, ws));
    const beforeIds = (adminGroup.memberIds as string[]) ?? [];
    await db
      .update(permissionGroups)
      .set({ memberIds: [...beforeIds, 'super'] })
      .where(eq(permissionGroups.id, adminGroup.id));

    const visible = await listParticipantsForWorkspace(ws);
    const ids = visible.map(p => p.id);
    expect(ids).toContain('alice');
    expect(ids).not.toContain('super');
  });

  test('a regular non-platform admin still appears in participants', async () => {
    await insertAgent({ id: 'alice', platformAdmin: false });

    const ws = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, { wsId: ws, name: 'Solo', createdBy: 'alice', ownerAgentId: 'alice' });

    const visible = await listParticipantsForWorkspace(ws);
    expect(visible.map(p => p.id)).toEqual(['alice']);
  });
});

import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { agents, appUsers, permissionGroups, userWorkspaces, workspaces } from '../db/schema';

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;
import type { WorkspaceMemberRole } from '../types';

const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

function upsertMembership(
  memberships: Map<string, WorkspaceMemberRole>,
  workspaceId: string,
  memberRole: WorkspaceMemberRole,
): void {
  const current = memberships.get(workspaceId);
  if (!current || ROLE_PRIORITY.indexOf(memberRole) < ROLE_PRIORITY.indexOf(current)) {
    memberships.set(workspaceId, memberRole);
  }
}

export interface WorkspaceMembership {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
}

type GroupLike = {
  memberIds?: unknown;
  agentIds?: unknown;
  uids?: unknown;
  type?: unknown;
  workspaceId?: unknown;
};

export function getGroupMemberIds(group: GroupLike): string[] {
  const memberIds = Array.isArray(group.memberIds) ? group.memberIds.filter((id): id is string => typeof id === 'string') : [];
  const legacyAgentIds = Array.isArray(group.agentIds) ? group.agentIds.filter((id): id is string => typeof id === 'string') : [];
  return [...new Set([...memberIds, ...legacyAgentIds])];
}

export function isParticipantMember(group: GroupLike, participantId?: string): boolean {
  if (!participantId) return false;
  return getGroupMemberIds(group).includes(participantId);
}

export function isLegacyUserMember(group: GroupLike, userId?: string): boolean {
  if (!userId) return false;
  const legacyUids = Array.isArray(group.uids) ? group.uids.filter((id): id is string => typeof id === 'string') : [];
  return legacyUids.includes(userId);
}

export async function resolveParticipantIdForUser(userId: string): Promise<string | null> {
  const [direct] = await db.select({ id: agents.id }).from(agents).where(eq(agents.authUserId, userId));
  if (direct) return direct.id;

  const [profile] = await db.select().from(appUsers).where(eq(appUsers.userId, userId));
  if (profile?.agentId) return profile.agentId;

  const [owned] = await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerUid, userId));
  return owned?.id ?? null;
}

/** Workspace owner's BetterAuth user id → agents.id (same as browser session agent for that user). */
export async function resolveWorkspaceOwnerAgentId(workspaceId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: userWorkspaces.userId })
    .from(userWorkspaces)
    .where(and(eq(userWorkspaces.workspaceId, workspaceId), eq(userWorkspaces.role, 'owner')))
    .orderBy(asc(userWorkspaces.joinedAt))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) return null;
  return resolveParticipantIdForUser(userId);
}

export async function getParticipantWorkspaceMemberships(participantId: string): Promise<WorkspaceMembership[]> {
  const groups = await db.select().from(permissionGroups);
  const memberships = new Map<string, WorkspaceMemberRole>();

  for (const group of groups) {
    if (!isParticipantMember(group, participantId)) continue;
    upsertMembership(memberships, group.workspaceId, group.type === 'admin' ? 'admin' : 'trader');
  }

  return Array.from(memberships.entries()).map(([workspaceId, memberRole]) => ({ workspaceId, memberRole }));
}

export async function getUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const participantId = await resolveParticipantIdForUser(userId);

  let memberships: WorkspaceMembership[] = [];
  if (participantId) {
    memberships = await getParticipantWorkspaceMemberships(participantId);
  }

  if (memberships.length === 0) {
    const rows = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, userId));
    return rows.map(row => ({ workspaceId: row.workspaceId, memberRole: row.role as WorkspaceMemberRole }));
  }

  // Permission groups cap at 'admin'. Upgrade to 'owner' for any workspace where
  // the user has an explicit owner row in userWorkspaces.
  const ownerRows = await db.select({ workspaceId: userWorkspaces.workspaceId })
    .from(userWorkspaces)
    .where(and(eq(userWorkspaces.userId, userId), eq(userWorkspaces.role, 'owner')));

  if (ownerRows.length > 0) {
    const ownerSet = new Set(ownerRows.map(r => r.workspaceId));
    return memberships.map(m =>
      ownerSet.has(m.workspaceId) ? { ...m, memberRole: 'owner' as WorkspaceMemberRole } : m,
    );
  }

  return memberships;
}

export async function getWorkspaceRoleForParticipant(
  workspaceId: string,
  participantId?: string,
  userId?: string,
): Promise<'admin' | 'trader' | null> {
  if (!participantId && !userId) return null;
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const adminGroup = groups.find(group => group.type === 'admin');
  if (adminGroup && (isParticipantMember(adminGroup, participantId) || isLegacyUserMember(adminGroup, userId))) {
    return 'admin';
  }

  const hasTraderMembership = groups.some(group =>
    isParticipantMember(group, participantId) || isLegacyUserMember(group, userId),
  );
  return hasTraderMembership ? 'trader' : null;
}

export async function listAccessibleWorkspaceIdsForParticipant(
  participantId?: string,
  userId?: string,
): Promise<WorkspaceMembership[]> {
  if (participantId) {
    const memberships = await getParticipantWorkspaceMemberships(participantId);
    if (memberships.length > 0) return memberships;
  }
  if (userId) return getUserWorkspaceMemberships(userId);
  return [];
}

/**
 * Create a workspace and guarantee the owner has both a userWorkspaces row
 * (role='owner') and is a member of the Admin permission group.
 * Must be called inside a transaction or standalone — handles both.
 *
 * @param tx  Drizzle transaction (or the db client itself for standalone use)
 * @param opts.wsId         Workspace UUID to use (caller generates it)
 * @param opts.name         Display name
 * @param opts.createdBy    Identity string stored on the workspace row
 * @param opts.ownerUid     BetterAuth user id of the owner (if a real user)
 * @param opts.ownerAgentId Agent id of the owner (if known at creation time)
 */
export async function provisionWorkspace(
  tx: DbOrTx,
  opts: {
    wsId: string;
    name: string;
    createdBy: string;
    ownerUid?: string;
    ownerAgentId?: string;
  },
): Promise<void> {
  const { wsId, name, createdBy, ownerUid, ownerAgentId } = opts;
  const now = new Date();

  await tx.insert(workspaces).values({
    id: wsId,
    name,
    createdBy,
    createdAt: now,
    visibility: 'private',
  });

  if (ownerUid) {
    await tx.insert(userWorkspaces).values({
      userId: ownerUid,
      workspaceId: wsId,
      role: 'owner',
      joinedAt: now,
    });
  }

  const adminMemberIds = ownerAgentId ? [ownerAgentId] : [];
  const adminUids = ownerUid ? [ownerUid] : [];

  await tx.insert(permissionGroups).values([
    {
      id: randomUUID(), workspaceId: wsId,
      name: 'Public', type: 'public',
      description: 'Participants explicitly added to this workspace.',
      memberIds: [], agentIds: [], uids: [], permissions: {}, createdAt: now,
    },
    {
      id: randomUUID(), workspaceId: wsId,
      name: 'Admin', type: 'admin',
      description: 'Participants with full administrative access to this workspace.',
      memberIds: adminMemberIds, agentIds: adminMemberIds, uids: adminUids,
      permissions: {}, createdAt: now,
    },
  ]);
}

export async function listParticipantsForWorkspace(workspaceId: string) {
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const memberIds = [...new Set(groups.flatMap(group => getGroupMemberIds(group)))];
  if (memberIds.length === 0) return [];
  return db.select().from(agents).where(inArray(agents.id, memberIds));
}

export async function syncLegacyWorkspaceMemberships(workspaceId: string): Promise<void> {
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const participantRoles = new Map<string, WorkspaceMemberRole>();

  for (const group of groups) {
    for (const participantId of getGroupMemberIds(group)) {
      upsertMembership(participantRoles, participantId, group.type === 'admin' ? 'admin' : 'trader');
    }
  }

  const participantIds = [...participantRoles.keys()];
  const participantRows = participantIds.length === 0
    ? []
    : await db.select({ id: agents.id, authUserId: agents.authUserId }).from(agents).where(inArray(agents.id, participantIds));

  const desired = participantRows
    .filter(row => row.authUserId)
    .map(row => ({
      userId: row.authUserId as string,
      workspaceId,
      role: participantRoles.get(row.id) as WorkspaceMemberRole,
      joinedAt: new Date(),
    }));

  const existing = await db.select().from(userWorkspaces).where(eq(userWorkspaces.workspaceId, workspaceId));
  const desiredUserIds = new Set(desired.map(row => row.userId));

  for (const row of existing) {
    if (!desiredUserIds.has(row.userId)) {
      await db.delete(userWorkspaces).where(and(eq(userWorkspaces.userId, row.userId), eq(userWorkspaces.workspaceId, workspaceId)));
    }
  }

  for (const row of desired) {
    await db.insert(userWorkspaces)
      .values(row)
      .onConflictDoUpdate({ target: [userWorkspaces.userId, userWorkspaces.workspaceId], set: { role: row.role } });
  }
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return Boolean(workspace);
}

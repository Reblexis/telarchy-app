import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, appUsers, permissionGroups, userWorkspaces, workspaces } from '../db/schema';
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
  if (participantId) {
    const memberships = await getParticipantWorkspaceMemberships(participantId);
    if (memberships.length > 0) return memberships;
  }

  const rows = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, userId));
  return rows.map(row => ({ workspaceId: row.workspaceId, memberRole: row.role as WorkspaceMemberRole }));
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

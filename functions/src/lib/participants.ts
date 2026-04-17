import { and, eq, inArray, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { agents, permissionGroups, workspaces } from '../db/schema';

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
  type?: unknown;
  workspaceId?: unknown;
};

export function getGroupMemberIds(group: GroupLike): string[] {
  return (group.memberIds as string[] ?? []).filter(id => typeof id === 'string');
}

export function isParticipantMember(group: GroupLike, participantId?: string): boolean {
  if (!participantId) return false;
  return getGroupMemberIds(group).includes(participantId);
}

export async function resolveParticipantIdForUser(userId: string): Promise<string | null> {
  const [direct] = await db.select({ id: agents.id }).from(agents).where(eq(agents.authUserId, userId));
  return direct?.id ?? null;
}

/** Workspace owner's createdBy → agents.id */
export async function resolveWorkspaceOwnerAgentId(workspaceId: string): Promise<string | null> {
  const [ws] = await db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!ws?.createdBy) return null;

  // createdBy may already be an agent id
  const [directAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, ws.createdBy));
  if (directAgent) return directAgent.id;

  // Or it may be a userId — resolve via authUserId
  return resolveParticipantIdForUser(ws.createdBy);
}

export async function getParticipantWorkspaceMemberships(participantId: string): Promise<WorkspaceMembership[]> {
  const groups = await db.select().from(permissionGroups);
  const memberships = new Map<string, WorkspaceMemberRole>();

  for (const group of groups) {
    if (!isParticipantMember(group, participantId)) continue;
    upsertMembership(memberships, group.workspaceId, group.type === 'admin' ? 'admin' : group.type === 'public' ? 'viewer' : 'trader');
  }

  return Array.from(memberships.entries()).map(([workspaceId, memberRole]) => ({ workspaceId, memberRole }));
}

export async function getUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const participantId = await resolveParticipantIdForUser(userId);
  if (!participantId) return [];

  const memberships = await getParticipantWorkspaceMemberships(participantId);

  // Permission groups cap at 'admin'. Upgrade to 'owner' for any workspace where
  // the user (or their participantId) is the workspace creator.
  // Also include workspaces the user created but isn't in any permission group for.
  const ownedRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(or(eq(workspaces.createdBy, userId), eq(workspaces.createdBy, participantId)));

  if (ownedRows.length === 0) return memberships;

  const ownerSet = new Set(ownedRows.map(r => r.id));
  const result = memberships.map(m =>
    ownerSet.has(m.workspaceId) ? { ...m, memberRole: 'owner' as WorkspaceMemberRole } : m,
  );

  // Self-heal: if the creator isn't in the admin group, add them.
  // This repairs state left by migrations or bugs without manual DB fixes.
  const existingWsIds = new Set(memberships.map(m => m.workspaceId));
  const missingWsIds = ownedRows.filter(r => !existingWsIds.has(r.id)).map(r => r.id);

  if (missingWsIds.length > 0) {
    for (const wsId of missingWsIds) {
      result.push({ workspaceId: wsId, memberRole: 'owner' });
    }
    // Fire-and-forget: add to admin groups so future lookups work directly
    db.select().from(permissionGroups)
      .where(and(inArray(permissionGroups.workspaceId, missingWsIds), eq(permissionGroups.type, 'admin')))
      .then(groups => {
        for (const group of groups) {
          const ids = (group.memberIds as string[] ?? []);
          if (!ids.includes(participantId)) {
            db.update(permissionGroups)
              .set({ memberIds: [...ids, participantId] })
              .where(eq(permissionGroups.id, group.id))
              .catch(e => console.error('Failed to self-heal admin group membership:', e));
          }
        }
      })
      .catch(e => console.error('Failed to self-heal admin group lookup:', e));
  }

  return result;
}

export async function getWorkspaceRoleForParticipant(
  workspaceId: string,
  participantId?: string,
  userId?: string,
): Promise<'admin' | 'trader' | null> {
  if (!participantId && !userId) return null;
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));

  // If we only have userId, resolve to participantId
  const resolvedParticipantId = participantId ?? (userId ? await resolveParticipantIdForUser(userId) : null) ?? undefined;

  const adminGroup = groups.find(group => group.type === 'admin');
  if (adminGroup && isParticipantMember(adminGroup, resolvedParticipantId)) {
    return 'admin';
  }

  const hasTraderMembership = groups.some(group => isParticipantMember(group, resolvedParticipantId));
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
 * Create a workspace and guarantee the owner is a member of the Admin permission group.
 *
 * @param tx  Drizzle transaction (or the db client itself for standalone use)
 * @param opts.wsId         Workspace UUID to use (caller generates it)
 * @param opts.name         Display name
 * @param opts.createdBy    Identity string stored on the workspace row
 * @param opts.ownerAgentId Agent id of the owner (if known at creation time)
 */
export async function provisionWorkspace(
  tx: DbOrTx,
  opts: {
    wsId: string;
    name: string;
    createdBy: string;
    ownerAgentId?: string;
  },
): Promise<void> {
  const { wsId, name, createdBy, ownerAgentId } = opts;
  const now = new Date();

  await tx.insert(workspaces).values({
    id: wsId,
    name,
    createdBy,
    createdAt: now,
    visibility: 'private',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: 0.5,
  });

  const adminMemberIds = ownerAgentId ? [ownerAgentId] : [];

  await tx.insert(permissionGroups).values([
    {
      id: randomUUID(), workspaceId: wsId,
      name: 'Public', type: 'public',
      description: 'Participants explicitly added to this workspace.',
      memberIds: [], permissions: {}, capabilities: ['read'], createdAt: now,
    },
    {
      id: randomUUID(), workspaceId: wsId,
      name: 'Admin', type: 'admin',
      description: 'Participants with full administrative access to this workspace.',
      memberIds: adminMemberIds,
      permissions: {}, capabilities: ['read', 'trade', 'manage'], createdAt: now,
    },
    {
      id: randomUUID(), workspaceId: wsId,
      name: 'Trader', type: 'trader',
      description: 'Participants who can view metrics and trade on all markets.',
      memberIds: [], permissions: {}, capabilities: ['read', 'trade'], createdAt: now,
    },
  ]);
}

export async function listParticipantsForWorkspace(workspaceId: string) {
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const memberIds = [...new Set(groups.flatMap(group => getGroupMemberIds(group)))];
  if (memberIds.length === 0) return [];
  return db.select().from(agents).where(inArray(agents.id, memberIds));
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return Boolean(workspace);
}

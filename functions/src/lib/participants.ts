import { and, eq, inArray, or, sql, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { agents, authUser, permissionGroups, workspaces } from '../db/schema';
import { DEFAULT_MARKET_LIQUIDITY_CREDITS, validateNickname } from './validation';
import { AppError } from './errors';

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

/**
 * Choose which workspace to act on for a user, given their memberships and an
 * optional requested workspace (typically from the X-Workspace-Id header).
 *
 * If the requested workspace is a membership match, use it. Otherwise fall back
 * to the user's highest-priority membership. Returns null when the user has no
 * memberships at all. The request header is advisory: a stale or unknown value
 * must not cause the whole request to fail.
 */
export function selectEffectiveWorkspaceId(
  memberships: WorkspaceMembership[],
  requestedWorkspaceId?: string,
): string | null {
  if (memberships.length === 0) return null;
  if (requestedWorkspaceId) {
    const match = memberships.find(m => m.workspaceId === requestedWorkspaceId);
    if (match) return requestedWorkspaceId;
  }
  const sorted = [...memberships].sort((a, b) =>
    ROLE_PRIORITY.indexOf(a.memberRole) - ROLE_PRIORITY.indexOf(b.memberRole),
  );
  return sorted[0].workspaceId;
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
  // Platform admins are virtual admins of every workspace. They do not get a
  // permission-group entry (so they stay hidden in the participants tab via
  // listParticipantsForWorkspace), but every workspace shows up in their
  // workspace switcher and admin-gated routes treat them as 'admin'.
  const [participant] = await db
    .select({ platformAdmin: agents.platformAdmin })
    .from(agents)
    .where(eq(agents.id, participantId));
  if (participant?.platformAdmin === true) {
    const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
    return allWorkspaces.map(w => ({ workspaceId: w.id, memberRole: 'admin' as WorkspaceMemberRole }));
  }

  const groups = await db.select().from(permissionGroups);
  const memberships = new Map<string, WorkspaceMemberRole>();

  for (const group of groups) {
    if (!isParticipantMember(group, participantId)) continue;
    const caps = (group.capabilities as string[] | null) ?? [];
    const role: WorkspaceMemberRole =
      group.type === 'admin' ? 'admin'
      : group.type === 'public' ? (caps.includes('trade') ? 'trader' : 'viewer')
      : 'trader';
    upsertMembership(memberships, group.workspaceId, role);
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
    visibility?: 'public' | 'unlisted' | 'private';
  },
): Promise<void> {
  const { wsId, name, createdBy, ownerAgentId, visibility } = opts;
  const now = new Date();

  await tx.insert(workspaces).values({
    id: wsId,
    name,
    createdBy,
    createdAt: now,
    visibility: visibility ?? 'private',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: DEFAULT_MARKET_LIQUIDITY_CREDITS,
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
  const rows = await db.select().from(agents).where(inArray(agents.id, memberIds));
  // Platform admins act as virtual admins in every workspace (see
  // getParticipantWorkspaceMemberships and computeCapabilities). They are not
  // real members of those workspaces, so they should not appear in the
  // participants tab, leaderboards, activity-feed member set, or admin-credit
  // target lists. Filter them out uniformly here.
  return rows.filter(a => !a.platformAdmin);
}

/**
 * Resolve participant IDs (agents.id) to human-readable display names. Prefers
 * agents.nickname (claimed via either signup path), falls back to
 * authUser.name for human accounts that haven't picked one. Pure API agents
 * without a nickname are absent from the map; callers should fall back to a
 * truncated ID.
 */
export async function getParticipantDisplayNames(
  participantIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(participantIds.filter(Boolean))];
  if (unique.length === 0) return names;

  const rows = await db
    .select({ agentId: agents.id, nickname: agents.nickname, name: authUser.name })
    .from(agents)
    .leftJoin(authUser, eq(agents.authUserId, authUser.id))
    .where(inArray(agents.id, unique));

  for (const row of rows) {
    const display = row.nickname ?? row.name;
    if (display) names.set(row.agentId, display);
  }
  return names;
}

/**
 * Claim a nickname for a participant. Validates format, checks case-insensitive
 * uniqueness, and writes it. Throws AppError(400) on bad format and AppError(409)
 * when the nickname is already taken. Both signup paths (human auth, API agent
 * register) call this so the rules stay symmetric.
 *
 * The DB-level partial unique index on LOWER(nickname) is the source of truth
 * for races; the pre-check exists so callers get a clean 409 instead of a raw
 * constraint-violation surface.
 */
export async function claimNickname(
  tx: DbOrTx,
  participantId: string,
  nickname: string,
): Promise<void> {
  const formatError = validateNickname(nickname);
  if (formatError) throw new AppError(formatError, 400);

  const lower = nickname.toLowerCase();
  const conflict = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(sql`LOWER(${agents.nickname}) = ${lower}`, ne(agents.id, participantId)));
  if (conflict.length > 0) throw new AppError('Nickname is already taken', 409);

  try {
    await tx.update(agents).set({ nickname }).where(eq(agents.id, participantId));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '23505') throw new AppError('Nickname is already taken', 409);
    throw err;
  }
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return Boolean(workspace);
}

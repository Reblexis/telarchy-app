import { randomUUID } from 'crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, authUser, permissionGroups, workspaceSlugAliases, workspaces } from '../db/schema';
import { AppError } from './errors';
import { uniqueSlugForOwner } from './slug';
import { DEFAULT_MARKET_LIQUIDITY_CREDITS, validateNickname } from './validation';

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
  const sorted = [...memberships].sort(
    (a, b) => ROLE_PRIORITY.indexOf(a.memberRole) - ROLE_PRIORITY.indexOf(b.memberRole),
  );
  return sorted[0].workspaceId;
}

type GroupLike = {
  memberIds?: unknown;
  type?: unknown;
  workspaceId?: unknown;
};

export function getGroupMemberIds(group: GroupLike): string[] {
  return ((group.memberIds as string[]) ?? []).filter(id => typeof id === 'string');
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

export interface OwnerHandle {
  /** The owner agent's id (the guaranteed-unique fallback segment). */
  ownerId: string;
  /** The public URL segment: the owner's custom id (nickname) when set, else its id. */
  ownerHandle: string;
}

/**
 * Resolve workspace owner keys (workspaces.createdBy, which is an agent id or,
 * for some legacy rows, a BetterAuth user id) to their public URL handle. The
 * handle is the owner agent's nickname when set, otherwise its opaque id. Keyed
 * by the original ownerKey passed in so callers can join back onto workspace rows.
 */
export async function getOwnerHandles(ownerKeys: string[]): Promise<Map<string, OwnerHandle>> {
  const out = new Map<string, OwnerHandle>();
  const unique = [...new Set(ownerKeys.filter(Boolean))];
  if (unique.length === 0) return out;

  // Most ownerKeys are already agent ids.
  const direct = await db
    .select({ id: agents.id, nickname: agents.nickname })
    .from(agents)
    .where(inArray(agents.id, unique));
  for (const a of direct) out.set(a.id, { ownerId: a.id, ownerHandle: a.nickname ?? a.id });

  // Legacy rows store a userId; resolve those via authUserId.
  const unresolved = unique.filter(k => !out.has(k));
  if (unresolved.length > 0) {
    const byUser = await db
      .select({ id: agents.id, nickname: agents.nickname, authUserId: agents.authUserId })
      .from(agents)
      .where(inArray(agents.authUserId, unresolved));
    for (const a of byUser) {
      if (a.authUserId) out.set(a.authUserId, { ownerId: a.id, ownerHandle: a.nickname ?? a.id });
    }
  }
  return out;
}

/**
 * Resolve a URL owner segment (a custom id/nickname or a raw agent id) to the
 * owner agent's id. Mirrors the id-first, then case-insensitive-nickname lookup
 * used elsewhere (routes/agents.ts). Returns null when nothing matches.
 */
export async function resolveOwnerSegment(segment: string): Promise<string | null> {
  const [byId] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, segment));
  if (byId) return byId.id;
  const [byNick] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(sql`LOWER(${agents.nickname}) = ${segment.toLowerCase()}`);
  return byNick?.id ?? null;
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
      group.type === 'admin'
        ? 'admin'
        : group.type === 'public'
          ? caps.includes('trade')
            ? 'trader'
            : 'viewer'
          : 'trader';
    upsertMembership(memberships, group.workspaceId, role);
  }

  return Array.from(memberships.entries()).map(([workspaceId, memberRole]) => ({ workspaceId, memberRole }));
}

export async function getUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const participantId = await resolveParticipantIdForUser(userId);

  // A freshly-signed-up user may own workspaces before any participant
  // (agents) row exists for them - workspace creation does not call
  // ensureParticipant. Do NOT early-return on a missing participantId, or the
  // creator loses membership (and thus capabilities) on their own workspace.
  const memberships = participantId ? await getParticipantWorkspaceMemberships(participantId) : [];

  // Permission groups cap at 'admin'. Upgrade to 'owner' for any workspace where
  // the user (or their participantId) is the workspace creator.
  // Also include workspaces the user created but isn't in any permission group
  // for - including when they have no participant row yet.
  const ownerCreators = participantId ? [userId, participantId] : [userId];
  const ownedRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.createdBy, ownerCreators));

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
    // Fire-and-forget: add to admin groups so future lookups work directly.
    // Only possible once the owner has a participant row; until then the
    // 'owner' membership above (plus the createdBy owner-shortcut in
    // computeCapabilities) already grants full access.
    if (participantId)
      db.select()
        .from(permissionGroups)
        .where(and(inArray(permissionGroups.workspaceId, missingWsIds), eq(permissionGroups.type, 'admin')))
        .then(groups => {
          for (const group of groups) {
            const ids = (group.memberIds as string[]) ?? [];
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
): Promise<string> {
  const { wsId, name, createdBy, ownerAgentId, visibility } = opts;
  const now = new Date();

  const slug = await uniqueSlugForOwner(tx, createdBy, name);

  await tx.insert(workspaces).values({
    id: wsId,
    name,
    slug,
    createdBy,
    createdAt: now,
    visibility: visibility ?? 'private',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: DEFAULT_MARKET_LIQUIDITY_CREDITS,
  });

  await tx.insert(workspaceSlugAliases).values({
    workspaceId: wsId,
    ownerKey: createdBy,
    slug,
    createdAt: now,
  });

  const adminMemberIds = ownerAgentId ? [ownerAgentId] : [];

  await tx.insert(permissionGroups).values([
    {
      id: randomUUID(),
      workspaceId: wsId,
      name: 'Public',
      type: 'public',
      description: 'Participants explicitly added to this workspace.',
      memberIds: [],
      permissions: {},
      // A floor created public is tradeable from its first moment
      // (docs/guides/creating.md, "Public means tradeable"). A restricted
      // floor seeds without `trade` and is granted it when it is published;
      // nothing trades on a floor that is not public anyway.
      capabilities: visibility === 'public' ? ['read', 'trade'] : ['read'],
      createdAt: now,
    },
    {
      id: randomUUID(),
      workspaceId: wsId,
      name: 'Admin',
      type: 'admin',
      description: 'Participants with full administrative access to this workspace.',
      memberIds: adminMemberIds,
      permissions: {},
      capabilities: ['read', 'trade', 'manage'],
      createdAt: now,
    },
    {
      id: randomUUID(),
      workspaceId: wsId,
      name: 'Trader',
      type: 'trader',
      description: 'Participants who can view metrics and trade on all markets.',
      memberIds: [],
      permissions: {},
      capabilities: ['read', 'trade'],
      createdAt: now,
    },
  ]);

  return slug;
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
export async function getParticipantDisplayNames(participantIds: string[]): Promise<Map<string, string>> {
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
export async function claimNickname(tx: DbOrTx, participantId: string, nickname: string): Promise<void> {
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

/**
 * Which of these participants are operated by us.
 *
 * One reader for one fact: the season's standings projection, the public
 * board's prize column and the settlement transaction all have to agree about
 * who may take a rung, and settlement assigns real money. Three copies of a
 * `nickname === 'telarchy-agents'` check is how they would come to disagree.
 *
 * An id that does not exist simply is not in the set, which reads as "not the
 * house", and that is the safe direction: a missing row must not silently make
 * a stranger ineligible for a prize.
 */
export async function platformOperatedIds(agentIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(agentIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ id: agents.id, platformOperated: agents.platformOperated })
    .from(agents)
    .where(inArray(agents.id, unique));
  return new Set(rows.filter(r => r.platformOperated).map(r => r.id));
}

/**
 * Which of these accounts own or administer any PUBLIC workspace: the
 * workspace's creator, or a member of any of its permission groups whose
 * capabilities include 'manage'. The strict-eligibility rule reads this on
 * the season money path (standings projection and settlement, which must
 * agree), because workspace operators resolve the metrics a season is
 * scored on. Private and unlisted workspaces do not count: the season
 * scores only public ones, so operating a private floor gives no leverage
 * over any scored market.
 */
export async function publicWorkspaceOperatorIds(agentIds: string[]): Promise<Set<string>> {
  const unique = new Set(agentIds.filter(Boolean));
  if (unique.size === 0) return new Set();
  const publicWs = await db
    .select({ id: workspaces.id, createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.visibility, 'public'));
  const operators = new Set<string>();
  for (const ws of publicWs) if (unique.has(ws.createdBy)) operators.add(ws.createdBy);
  if (publicWs.length > 0) {
    const groups = await db
      .select({ memberIds: permissionGroups.memberIds, capabilities: permissionGroups.capabilities })
      .from(permissionGroups)
      .where(
        inArray(
          permissionGroups.workspaceId,
          publicWs.map(w => w.id),
        ),
      );
    for (const g of groups) {
      if (!(g.capabilities ?? []).includes('manage')) continue;
      for (const id of g.memberIds ?? []) if (unique.has(id)) operators.add(id);
    }
  }
  return operators;
}

/** payoutHandle per account, for the one-payout-identity rule. Accounts with
 *  no handle map to null (nothing is required until claim time). */
export async function payoutHandlesById(agentIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(agentIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: agents.id, payoutHandle: agents.payoutHandle })
    .from(agents)
    .where(inArray(agents.id, unique));
  return new Map(rows.map(r => [r.id, r.payoutHandle ?? null]));
}

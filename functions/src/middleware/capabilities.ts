import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, permissionGroups, workspaces } from '../db/schema';
import { getGroupMemberIds, resolveParticipantIdForUser } from '../lib/participants';
import { ALL_CAPABILITIES, type Capability } from '../types';

/**
 * Compute the union of capabilities a caller has in a given workspace.
 *
 * Rules:
 *  - Master API key: all capabilities.
 *  - Workspace creator (by uid or agentId match on workspaces.createdBy): all capabilities.
 *  - Otherwise: union of `capabilities` across every permission group in the workspace
 *    whose memberIds contains the caller's canonical participantId.
 *  - Platform admins get all capabilities.
 */
export async function computeCapabilities(opts: {
  workspaceId: string;
  uid?: string;
  agentId?: string;
  isMasterKey?: boolean;
}): Promise<Set<Capability>> {
  if (opts.isMasterKey) return new Set(ALL_CAPABILITIES);
  const caps = new Set<Capability>();
  if (!opts.workspaceId) return caps;

  // Resolve canonical participantId (agentId is authoritative; otherwise derive from uid)
  let participantId = opts.agentId;
  if (!participantId && opts.uid) {
    const resolved = await resolveParticipantIdForUser(opts.uid);
    if (resolved) participantId = resolved;
  }

  // Platform admin shortcut
  if (opts.uid) {
    const [row] = await db
      .select({ platformAdmin: agents.platformAdmin })
      .from(agents)
      .where(eq(agents.authUserId, opts.uid));
    if (row?.platformAdmin === true) return new Set(ALL_CAPABILITIES);
  }

  // Workspace owner shortcut: createdBy matches either the uid or the participantId
  const [ws] = await db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, opts.workspaceId));
  if (ws) {
    if ((opts.uid && ws.createdBy === opts.uid) || (participantId && ws.createdBy === participantId)) {
      return new Set(ALL_CAPABILITIES);
    }
  }

  if (!participantId) return caps;

  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, opts.workspaceId));
  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(participantId)) continue;
    const groupCaps = (group.capabilities as string[] | null) ?? [];
    for (const cap of groupCaps) {
      if (cap === 'read' || cap === 'trade' || cap === 'manage' || cap === 'manage_workspace') caps.add(cap);
    }
  }
  return caps;
}

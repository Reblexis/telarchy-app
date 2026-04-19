import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { createHash, timingSafeEqual } from 'crypto';
import { db } from '../db/client';
import { agents, agentApiKeys } from '../db/schema';
import { auth } from '../auth';
import { eq } from 'drizzle-orm';
import type { AuthInfo, WorkspaceMemberRole } from '../types';
import { computeCapabilities } from './capabilities';
import {
  getParticipantWorkspaceMemberships,
  getUserWorkspaceMemberships as getUserWorkspaceMembershipsForParticipant,
} from '../lib/participants';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function safeCompare(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

export interface WorkspaceMembership {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
}

export async function getAgentWorkspaceMemberships(agentId: string): Promise<WorkspaceMembership[]> {
  return getParticipantWorkspaceMemberships(agentId);
}

export async function getUserWorkspaceMemberships(userId: string, _linkedAgentId?: string): Promise<WorkspaceMembership[]> {
  return getUserWorkspaceMembershipsFromParticipant(userId);
}

export async function getAuthWorkspaceMemberships(authInfo: {
  uid?: string;
  agentId?: string;
}): Promise<WorkspaceMembership[]> {
  if (authInfo.uid) return getUserWorkspaceMembershipsFromParticipant(authInfo.uid);
  if (authInfo.agentId) return getAgentWorkspaceMemberships(authInfo.agentId);
  return [];
}

async function getUserWorkspaceMembershipsFromParticipant(userId: string): Promise<WorkspaceMembership[]> {
  return getUserWorkspaceMembershipsForParticipant(userId);
}

async function resolveUser(
  userId: string,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; agentId?: string } | null> {
  const [agentRow] = await db.select({ id: agents.id, platformAdmin: agents.platformAdmin })
    .from(agents).where(eq(agents.authUserId, userId));
  const agentId = agentRow?.id ?? undefined;
  const isPlatformAdmin = agentRow?.platformAdmin === true;

  if (isPlatformAdmin && requestedWorkspaceId) {
    return { workspaceId: requestedWorkspaceId, agentId };
  }

  const memberships = await getUserWorkspaceMemberships(userId, agentId);
  if (memberships.length === 0) return null;

  if (requestedWorkspaceId) {
    const membership = memberships.find(m => m.workspaceId === requestedWorkspaceId);
    if (!membership) return null;
    return { workspaceId: requestedWorkspaceId, agentId };
  }

  memberships.sort((a, b) =>
    ROLE_PRIORITY.indexOf(a.memberRole) -
    ROLE_PRIORITY.indexOf(b.memberRole),
  );
  return { workspaceId: memberships[0].workspaceId, agentId };
}

async function resolveAgentWorkspace(
  agentId: string,
  requestedWorkspaceId: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole } | null> {
  const memberships = await getAgentWorkspaceMemberships(agentId);
  const membership = memberships.find(row => row.workspaceId === requestedWorkspaceId);
  if (!membership) return null;
  return membership;
}

/** Like authMiddleware but never rejects. Unauthenticated requests pass through with req.auth unset. */
export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (!requestedWorkspaceId) return next();
    req.auth = {
      capabilities: await computeCapabilities({ workspaceId: requestedWorkspaceId, isMasterKey: true }),
      workspaceId: requestedWorkspaceId,
      isMasterKey: true,
    };
    return next();
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    let result = await resolveUser(session.user.id, requestedWorkspaceId);
    // If the requested workspace isn't a membership (e.g. stale localStorage,
    // wrong env), fall back to the user's default workspace rather than leaving
    // them with empty capabilities.
    if (result === null && requestedWorkspaceId) {
      console.error(`[optionalAuth] user ${session.user.id} not a member of requested workspace ${requestedWorkspaceId}, falling back`);
      result = await resolveUser(session.user.id);
    }
    if (result !== null) {
      req.auth = {
        capabilities: await computeCapabilities({
          workspaceId: result.workspaceId,
          uid: session.user.id,
          agentId: result.agentId,
        }),
        workspaceId: result.workspaceId,
        uid: session.user.id,
        agentId: result.agentId,
      };
    } else {
      // New user with no workspaces yet; set minimal auth so ensureParticipant
      // can run on /me and provision the first workspace.
      req.auth = { capabilities: new Set(), workspaceId: '', uid: session.user.id };
    }
    return next();
  }

  // 3. Agent API key
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const [keyRecord] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.hash, hash));
    if (!keyRecord) { console.error(`[optionalAuth] agent key not found in DB (hash ${hash.slice(0,8)}...)`); return next(); }
    const { agentId } = keyRecord;
    const keyWorkspaceId = keyRecord.workspaceId;
    if (agentId && keyWorkspaceId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (agent) {
        const effectiveWorkspaceId = (req.headers['x-workspace-id'] as string | undefined) ?? keyWorkspaceId;
        const membership = await resolveAgentWorkspace(agentId, effectiveWorkspaceId);
        if (membership) {
          req.auth = {
            capabilities: await computeCapabilities({ workspaceId: membership.workspaceId, agentId }),
            agentId,
            workspaceId: membership.workspaceId,
          };
        } else {
          console.error(`[optionalAuth] agent ${agentId}: no membership for workspace ${effectiveWorkspaceId}`);
        }
      } else {
        console.error(`[optionalAuth] agent ${agentId}: not found in agents table`);
      }
    } else {
      console.error(`[optionalAuth] key record missing agentId or workspaceId`);
    }
  }
  return next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → all capabilities, requires X-Workspace-Id
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (!requestedWorkspaceId) return res.status(400).json({ error: 'X-Workspace-Id header is required' });
    req.auth = {
      capabilities: await computeCapabilities({ workspaceId: requestedWorkspaceId, isMasterKey: true }),
      workspaceId: requestedWorkspaceId,
      isMasterKey: true,
    };
    return next();
  }

  // 2. BetterAuth session (cookie or Bearer token)
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    let result = await resolveUser(session.user.id, requestedWorkspaceId);
    // If the requested workspace wasn't found in memberships, retry without the
    // workspace filter. This handles stale localStorage values or newly created
    // workspaces where the membership hasn't propagated yet.
    if (result === null && requestedWorkspaceId) {
      console.error(`[auth] user ${session.user.id} not a member of requested workspace ${requestedWorkspaceId}, falling back`);
      result = await resolveUser(session.user.id);
    }
    if (result === null) {
      req.auth = { capabilities: new Set(), workspaceId: '', uid: session.user.id };
    } else {
      req.auth = {
        capabilities: await computeCapabilities({
          workspaceId: result.workspaceId,
          uid: session.user.id,
          agentId: result.agentId,
        }),
        workspaceId: result.workspaceId,
        uid: session.user.id,
        agentId: result.agentId,
      };
    }
    return next();
  }

  // 3. Agent API key
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const [keyRecord] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.hash, hash));
    if (!keyRecord) return res.status(401).json({ error: 'Invalid agent key' });

    const { agentId } = keyRecord;
    const keyWorkspaceId = keyRecord.workspaceId;
    if (!keyWorkspaceId) {
      return res.status(403).json({ error: 'Agent API key has no workspace assigned' });
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) return res.status(401).json({ error: 'Agent not found' });

    const effectiveWorkspaceId = (req.headers['x-workspace-id'] as string | undefined) ?? keyWorkspaceId;
    const membership = await resolveAgentWorkspace(agentId, effectiveWorkspaceId);
    if (!membership) {
      return res.status(403).json({ error: 'Agent is not a member of the specified workspace' });
    }
    req.auth = {
      capabilities: await computeCapabilities({
        workspaceId: membership.workspaceId,
        agentId,
      }),
      agentId,
      workspaceId: membership.workspaceId,
    };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

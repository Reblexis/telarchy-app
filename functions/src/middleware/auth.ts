import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { createHash, timingSafeEqual } from 'crypto';
import { db } from '../db/client';
import { appUsers, agents, agentApiKeys } from '../db/schema';
import { auth } from '../auth';
import { eq } from 'drizzle-orm';
import type { AgentRole, AuthInfo, WorkspaceMemberRole } from '../types';
import {
  getParticipantWorkspaceMemberships,
  getUserWorkspaceMemberships as getUserWorkspaceMembershipsForParticipant,
  resolveParticipantIdForUser,
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

function memberRoleToAuthRole(memberRole: WorkspaceMemberRole | null): AgentRole {
  if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
  if (memberRole === 'trader') return 'agent';
  return 'pending';
}

const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

export interface WorkspaceMembership {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
}

export async function getAgentWorkspaceMemberships(agentId: string): Promise<WorkspaceMembership[]> {
  return getParticipantWorkspaceMemberships(agentId);
}

export async function getUserWorkspaceMemberships(userId: string, linkedAgentId?: string): Promise<WorkspaceMembership[]> {
  if (linkedAgentId) return getAgentWorkspaceMemberships(linkedAgentId);
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
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null; agentId?: string } | null> {
  const [profile] = await db.select().from(appUsers).where(eq(appUsers.userId, userId));
  const agentId = await resolveParticipantIdForUser(userId) ?? undefined;
  const isPlatformAdmin = profile?.platformAdmin === true;

  if (isPlatformAdmin) {
    const wsId = requestedWorkspaceId ?? 'default';
    return { workspaceId: wsId, memberRole: 'owner', agentId };
  }

  const memberships = await getUserWorkspaceMemberships(userId, agentId);

  if (memberships.length === 0) {
    if (requestedWorkspaceId && requestedWorkspaceId !== 'default') return null;
    return { workspaceId: 'default', memberRole: null, agentId };
  }

  if (requestedWorkspaceId) {
    const membership = memberships.find(m => m.workspaceId === requestedWorkspaceId);
    if (!membership) return null;
    return { workspaceId: requestedWorkspaceId, memberRole: membership.memberRole, agentId };
  }

  memberships.sort((a, b) =>
    ROLE_PRIORITY.indexOf(a.memberRole) -
    ROLE_PRIORITY.indexOf(b.memberRole),
  );
  return { workspaceId: memberships[0].workspaceId, memberRole: memberships[0].memberRole, agentId };
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
    req.auth = { role: 'admin', workspaceId: requestedWorkspaceId };
    return next();
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    const result = await resolveUser(session.user.id, requestedWorkspaceId);
    if (result !== null) {
      req.auth = {
        role: memberRoleToAuthRole(result.memberRole),
        workspaceId: result.workspaceId,
        uid: session.user.id,
        agentId: result.agentId,
      };
    }
  }
  return next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → admin, requires X-Workspace-Id
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (!requestedWorkspaceId) return res.status(400).json({ error: 'X-Workspace-Id header is required' });
    req.auth = { role: 'admin', workspaceId: requestedWorkspaceId };
    return next();
  }

  // 2. BetterAuth session (cookie or Bearer token)
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    const result = await resolveUser(session.user.id, requestedWorkspaceId);
    if (result === null) {
      return res.status(403).json({ error: 'Not a member of the specified workspace' });
    }
    req.auth = {
      role: memberRoleToAuthRole(result.memberRole),
      workspaceId: result.workspaceId,
      uid: session.user.id,
      agentId: result.agentId,
    };
    return next();
  }

  // 3. Agent API key
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const [keyRecord] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.hash, hash));
    if (!keyRecord) return res.status(401).json({ error: 'Invalid agent key' });

    const { agentId } = keyRecord;
    const keyWorkspaceId = keyRecord.workspaceId ?? 'default';

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) return res.status(401).json({ error: 'Agent not found' });

    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (requestedWorkspaceId && requestedWorkspaceId !== keyWorkspaceId) {
      const membership = await resolveAgentWorkspace(agentId, requestedWorkspaceId);
      if (membership) {
        req.auth = { role: memberRoleToAuthRole(membership.memberRole), agentId, workspaceId: membership.workspaceId };
        return next();
      }
    }

    if (keyWorkspaceId !== 'default') {
      const membership = await resolveAgentWorkspace(agentId, keyWorkspaceId);
      if (membership) {
        req.auth = { role: memberRoleToAuthRole(membership.memberRole), agentId, workspaceId: membership.workspaceId };
        return next();
      }
    }

    req.auth = { role: agent.role as AgentRole, agentId, workspaceId: keyWorkspaceId };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

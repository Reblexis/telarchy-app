import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { createHash, timingSafeEqual } from 'crypto';
import { db } from '../db/client';
import { appUsers, userWorkspaces, agents, agentApiKeys } from '../db/schema';
import { auth } from '../auth';
import { eq, and } from 'drizzle-orm';
import type { AgentRole, AuthInfo, WorkspaceMemberRole } from '../types';

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

function isBootstrapAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  const listed = [
    ...(process.env.ADMIN_EMAILS || '').split(','),
    process.env.ADMIN_EMAIL || '',
  ].map(e => e.trim().toLowerCase()).filter(Boolean);
  return listed.includes(lower);
}

const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

function memberRoleToAuthRole(memberRole: WorkspaceMemberRole | null): AgentRole {
  if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
  if (memberRole === 'trader') return 'agent';
  return 'pending';
}

export interface WorkspaceMembership {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
}

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

export async function getAgentWorkspaceMemberships(agentId: string): Promise<WorkspaceMembership[]> {
  const { permissionGroups } = await import('../db/schema');
  const groups = await db.select().from(permissionGroups);
  const memberships = new Map<string, WorkspaceMemberRole>();

  for (const group of groups) {
    const agentIds = (group.agentIds as string[]) ?? [];
    if (!agentIds.includes(agentId)) continue;
    upsertMembership(memberships, group.workspaceId, group.type === 'admin' ? 'admin' : 'trader');
  }

  return Array.from(memberships.entries()).map(([workspaceId, memberRole]) => ({ workspaceId, memberRole }));
}

export async function getUserWorkspaceMemberships(userId: string, linkedAgentId?: string): Promise<WorkspaceMembership[]> {
  const memberships = new Map<string, WorkspaceMemberRole>();
  const rows = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, userId));

  for (const row of rows) {
    upsertMembership(memberships, row.workspaceId, row.role as WorkspaceMemberRole);
  }

  if (linkedAgentId) {
    const agentMemberships = await getAgentWorkspaceMemberships(linkedAgentId);
    for (const membership of agentMemberships) {
      upsertMembership(memberships, membership.workspaceId, membership.memberRole);
    }
  }

  return Array.from(memberships.entries()).map(([workspaceId, memberRole]) => ({ workspaceId, memberRole }));
}

export async function getAuthWorkspaceMemberships(authInfo: {
  uid?: string;
  agentId?: string;
}): Promise<WorkspaceMembership[]> {
  if (authInfo.uid) return getUserWorkspaceMemberships(authInfo.uid, authInfo.agentId);
  if (authInfo.agentId) return getAgentWorkspaceMemberships(authInfo.agentId);
  return [];
}

async function resolveUser(
  userId: string,
  email: string | undefined | null,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null; agentId?: string } | null> {
  const [profile] = await db.select().from(appUsers).where(eq(appUsers.userId, userId));
  const agentId = profile?.agentId ?? undefined;
  const isPlatformAdmin = profile?.platformAdmin === true || isBootstrapAdmin(email);

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

  const nonDefault = memberships.filter(m => m.workspaceId !== 'default');
  if (nonDefault.length === 0) return { workspaceId: 'default', memberRole: null, agentId };
  nonDefault.sort((a, b) =>
    ROLE_PRIORITY.indexOf(a.memberRole) -
    ROLE_PRIORITY.indexOf(b.memberRole),
  );
  return { workspaceId: nonDefault[0].workspaceId, memberRole: nonDefault[0].memberRole, agentId };
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

/** Like authMiddleware but never rejects — unauthenticated requests pass through with req.auth unset. */
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
    const result = await resolveUser(session.user.id, session.user.email, requestedWorkspaceId);
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
    const result = await resolveUser(session.user.id, session.user.email, requestedWorkspaceId);
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

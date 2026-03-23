import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, timingSafeEqual } from 'crypto';
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

/** Bootstrap: emails listed in ADMIN_EMAILS / ADMIN_EMAIL env vars are platform admins. */
function isBootstrapAdmin(email: string | undefined): boolean {
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

/**
 * Resolve workspace, role, and linked agentId for any Firebase user.
 * All users — including platform admins — go through this single path.
 *
 * Platform admin = users/{uid}.platformAdmin === true OR email in ADMIN_EMAILS bootstrap list.
 * Platform admins have implicit owner access to all workspaces and workspaceId='default'.
 */
async function resolveFirebaseUser(
  uid: string,
  email: string | undefined,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null; agentId?: string } | null> {
  const userDoc = await getFirestore().collection('users').doc(uid).get();
  const data = userDoc.exists ? userDoc.data()! : null;
  const agentId = data?.agentId as string | undefined;

  const isPlatformAdmin = data?.platformAdmin === true || isBootstrapAdmin(email);

  if (isPlatformAdmin) {
    // Platform admins can switch into any workspace; default context is workspaceId='default'.
    const wsId = requestedWorkspaceId ?? 'default';
    return { workspaceId: wsId, memberRole: 'owner', agentId };
  }

  // Regular user: derive role from workspace membership.
  const workspaces = data?.workspaces as Record<string, { role: WorkspaceMemberRole }> | undefined;

  if (!workspaces || Object.keys(workspaces).length === 0) {
    return { workspaceId: 'default', memberRole: null, agentId };
  }

  if (requestedWorkspaceId) {
    const membership = workspaces[requestedWorkspaceId];
    if (!membership) return null; // not a member → caller returns 403
    return { workspaceId: requestedWorkspaceId, memberRole: membership.role, agentId };
  }

  const entries = Object.entries(workspaces).filter(([wsId]) => wsId !== 'default');
  if (entries.length === 0) return { workspaceId: 'default', memberRole: null, agentId };
  entries.sort(([, a], [, b]) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
  const [wsId, membership] = entries[0];
  return { workspaceId: wsId, memberRole: membership.role, agentId };
}

/**
 * Look up workspace membership for a pure agent (no Firebase UID) via the users/{agentId} document.
 */
async function resolveAgentWorkspace(
  agentId: string,
  requestedWorkspaceId: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole } | null> {
  const userDoc = await getFirestore().collection('users').doc(agentId).get();
  if (!userDoc.exists) return null;
  const workspaces = userDoc.data()!.workspaces as Record<string, { role: WorkspaceMemberRole }> | undefined;
  const membership = workspaces?.[requestedWorkspaceId];
  if (!membership) return null;
  return { workspaceId: requestedWorkspaceId, memberRole: membership.role };
}

/** Like authMiddleware but never rejects — unauthenticated requests pass through with req.auth unset. */
export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    req.auth = { role: 'admin', workspaceId: requestedWorkspaceId ?? 'default' };
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) {
      const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
      const result = await resolveFirebaseUser(decoded.uid, decoded.email ?? undefined, requestedWorkspaceId);
      if (result !== null) {
        req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid, agentId: result.agentId };
      }
    }
  }
  return next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → admin, respects X-Workspace-Id (falls back to 'default')
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    req.auth = { role: 'admin', workspaceId: requestedWorkspaceId ?? 'default' };
    return next();
  }

  // 2. Firebase ID token — all users resolved through the same path
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) {
      const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
      const result = await resolveFirebaseUser(decoded.uid, decoded.email ?? undefined, requestedWorkspaceId);
      if (result === null) {
        return res.status(403).json({ error: 'Not a member of the specified workspace' });
      }
      req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid, agentId: result.agentId };
      return next();
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 3. Agent API key → role from Firestore agent doc
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const keyDoc = await getFirestore().collection('agentApiKeys').doc(hash).get();
    if (!keyDoc.exists) return res.status(401).json({ error: 'Invalid agent key' });

    const keyData = keyDoc.data() as { agentId: string; workspaceId?: string };
    const { agentId } = keyData;
    const keyWorkspaceId = keyData.workspaceId ?? 'default';

    const agentDoc = await getFirestore().collection('agents').doc(agentId).get();
    if (!agentDoc.exists) return res.status(401).json({ error: 'Agent not found' });

    const agent = agentDoc.data()!;

    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (requestedWorkspaceId && requestedWorkspaceId !== keyWorkspaceId) {
      const membership = await resolveAgentWorkspace(agentId, requestedWorkspaceId);
      if (membership) {
        req.auth = { role: memberRoleToAuthRole(membership.memberRole), agentId, workspaceId: membership.workspaceId };
        return next();
      }
    }

    req.auth = { role: agent.role, agentId, workspaceId: keyWorkspaceId };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

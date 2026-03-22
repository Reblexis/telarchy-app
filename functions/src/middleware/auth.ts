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

function getAdminEmails(): string[] {
  return [
    ...(process.env.ADMIN_EMAILS || '').split(','),
    process.env.ADMIN_EMAIL || '',
  ]
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminFirebaseUser(decoded: { email?: string; admin?: unknown; role?: unknown }): boolean {
  if (decoded.admin === true || decoded.role === 'admin') return true;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email) return false;
  return getAdminEmails().includes(email);
}

function safeCompare(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    // Buffers of different length would throw — treat as mismatch.
    return false;
  }
}

const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

/**
 * Resolve workspace, member role, and linked agentId for a Firebase user.
 * If requestedWorkspaceId is provided, validates membership and returns it.
 * Returns null when requestedWorkspaceId is provided but the user is not a member (signals 403).
 * Without requestedWorkspaceId: auto-resolves to highest-privilege workspace.
 * Returns workspaceId='default' when the user has no workspaces.
 */
async function resolveFirebaseUser(
  uid: string,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null; agentId?: string } | null> {
  const userDoc = await getFirestore().collection('users').doc(uid).get();
  const agentId = userDoc.exists ? (userDoc.data()!.agentId as string | undefined) : undefined;

  if (!userDoc.exists) return { workspaceId: 'default', memberRole: null, agentId };
  const workspaces = userDoc.data()!.workspaces as Record<string, { role: WorkspaceMemberRole }> | undefined;
  if (!workspaces) return { workspaceId: 'default', memberRole: null, agentId };

  if (requestedWorkspaceId) {
    const membership = workspaces[requestedWorkspaceId];
    if (!membership) return null; // not a member — caller should return 403
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
 * Returns null if the agent has no membership in the requested workspace.
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

function memberRoleToAuthRole(memberRole: WorkspaceMemberRole | null): AgentRole {
  if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
  if (memberRole === 'trader') return 'agent';
  return 'pending'; // viewer or no workspace
}

/** Like authMiddleware but never rejects — allows unauthenticated requests through with req.auth unset. */
export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    req.auth = { role: 'admin', workspaceId: 'default' };
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) {
      if (isAdminFirebaseUser(decoded)) {
        const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        req.auth = { role: 'admin', workspaceId: requestedWorkspaceId ?? 'default', uid: decoded.uid };
      } else {
        const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        const result = await resolveFirebaseUser(decoded.uid, requestedWorkspaceId);
        if (result !== null) {
          req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid, agentId: result.agentId };
        }
        // null means not a member; leave req.auth unset (optional middleware)
      }
    }
    // Invalid token: continue without auth (optional)
  }
  // No credentials at all: continue without auth
  return next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → admin, always in the 'default' workspace (timing-safe comparison)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    req.auth = { role: 'admin', workspaceId: 'default' };
    return next();
  }

  // 2. Firebase ID token — platform admins get full access; others get workspace-derived role
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) {
      if (isAdminFirebaseUser(decoded)) {
        // Platform admin: full admin access; can switch to any workspace via X-Workspace-Id
        const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        req.auth = { role: 'admin', workspaceId: requestedWorkspaceId ?? 'default', uid: decoded.uid };
      } else {
        // Workspace user: resolve role from workspace membership + linked agentId
        const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        const result = await resolveFirebaseUser(decoded.uid, requestedWorkspaceId);
        if (result === null) {
          return res.status(403).json({ error: 'Not a member of the specified workspace' });
        }
        req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid, agentId: result.agentId };
      }
      return next();
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 3. Agent API key → agent role from Firestore; workspaceId from key doc or X-Workspace-Id membership
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

    // If X-Workspace-Id header present, check users/{agentId} for workspace ownership/membership
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

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
 * Resolve workspace and member role for a Firebase user.
 * If requestedWorkspaceId is provided, validates membership in that workspace and returns it.
 * Returns null when requestedWorkspaceId is provided but the user is not a member (signals 403).
 * Without requestedWorkspaceId: auto-resolves to highest-privilege workspace.
 * Returns workspaceId='default' (platform context) when the user has no workspaces.
 */
async function resolveFirebaseWorkspace(
  uid: string,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null } | null> {
  const userDoc = await getFirestore().collection('users').doc(uid).get();
  if (!userDoc.exists) return { workspaceId: 'default', memberRole: null };
  const workspaces = userDoc.data()!.workspaces as Record<string, { role: WorkspaceMemberRole }> | undefined;
  if (!workspaces) return { workspaceId: 'default', memberRole: null };

  if (requestedWorkspaceId) {
    const membership = workspaces[requestedWorkspaceId];
    if (!membership) return null; // not a member — caller should return 403
    return { workspaceId: requestedWorkspaceId, memberRole: membership.role };
  }

  const entries = Object.entries(workspaces).filter(([wsId]) => wsId !== 'default');
  if (entries.length === 0) return { workspaceId: 'default', memberRole: null };
  entries.sort(([, a], [, b]) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
  const [wsId, membership] = entries[0];
  return { workspaceId: wsId, memberRole: membership.role };
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
        const result = await resolveFirebaseWorkspace(decoded.uid, requestedWorkspaceId);
        if (result !== null) {
          req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid };
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
        // Workspace user: resolve role from workspace membership
        const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        const result = await resolveFirebaseWorkspace(decoded.uid, requestedWorkspaceId);
        if (result === null) {
          return res.status(403).json({ error: 'Not a member of the specified workspace' });
        }
        req.auth = { role: memberRoleToAuthRole(result.memberRole), workspaceId: result.workspaceId, uid: decoded.uid };
      }
      return next();
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 3. Agent API key → agent role from Firestore; workspaceId from key doc
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const keyDoc = await getFirestore().collection('agentApiKeys').doc(hash).get();
    if (!keyDoc.exists) return res.status(401).json({ error: 'Invalid agent key' });

    const keyData = keyDoc.data() as { agentId: string; workspaceId?: string };
    const { agentId } = keyData;
    const workspaceId = keyData.workspaceId ?? 'default';

    const agentDoc = await getFirestore().collection('agents').doc(agentId).get();
    if (!agentDoc.exists) return res.status(401).json({ error: 'Agent not found' });

    const agent = agentDoc.data()!;
    req.auth = { role: agent.role, agentId, workspaceId };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

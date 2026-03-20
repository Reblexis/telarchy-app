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

/**
 * Resolve workspace and member role for a Firebase user.
 * Priority: owner > admin > trader/viewer > no workspace.
 * Returns workspaceId='default' (platform context) when the user has no workspaces.
 */
async function resolveFirebaseWorkspace(uid: string): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole | null }> {
  const userDoc = await getFirestore().collection('users').doc(uid).get();
  if (!userDoc.exists) return { workspaceId: 'default', memberRole: null };
  const workspaces = userDoc.data()!.workspaces as Record<string, { role: WorkspaceMemberRole }> | undefined;
  if (!workspaces) return { workspaceId: 'default', memberRole: null };
  const entries = Object.entries(workspaces).filter(([wsId]) => wsId !== 'default');
  if (entries.length === 0) return { workspaceId: 'default', memberRole: null };
  // Prefer higher-privilege roles
  const ROLE_PRIORITY: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];
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
        req.auth = { role: 'admin', workspaceId: 'default', uid: decoded.uid };
      } else {
        const { workspaceId, memberRole } = await resolveFirebaseWorkspace(decoded.uid);
        req.auth = { role: memberRoleToAuthRole(memberRole), workspaceId, uid: decoded.uid };
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
        // Platform admin: full access to the default workspace
        req.auth = { role: 'admin', workspaceId: 'default', uid: decoded.uid };
      } else {
        // Workspace user: resolve role from workspace membership
        const { workspaceId, memberRole } = await resolveFirebaseWorkspace(decoded.uid);
        req.auth = { role: memberRoleToAuthRole(memberRole), workspaceId, uid: decoded.uid };
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

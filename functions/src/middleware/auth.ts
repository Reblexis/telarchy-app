import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, timingSafeEqual } from 'crypto';
import type { AuthInfo } from '../types';

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
 * Resolve the default workspaceId for a Firebase user.
 * Checks `users/{uid}` for explicit workspace memberships; falls back to 'default'.
 */
async function resolveFirebaseWorkspace(uid: string): Promise<string> {
  const userDoc = await getFirestore().collection('users').doc(uid).get();
  if (!userDoc.exists) return 'default';
  const workspaces = userDoc.data()!.workspaces as Record<string, unknown> | undefined;
  if (!workspaces) return 'default';
  // Return the first non-default workspace they own, or 'default'.
  const owned = Object.entries(workspaces).find(([wsId, m]) =>
    wsId !== 'default' && (m as Record<string, unknown>).role === 'owner',
  );
  return owned ? owned[0] : 'default';
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → admin, always in the 'default' workspace (timing-safe comparison)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const masterKey = process.env.API_KEY;
  if (apiKey && masterKey && safeCompare(apiKey, masterKey)) {
    req.auth = { role: 'admin', workspaceId: 'default' };
    return next();
  }

  // 2. Firebase ID token → admin
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await getAuth().verifyIdToken(token).catch(() => null);
    if (decoded) {
      if (!isAdminFirebaseUser(decoded)) {
        return res.status(403).json({ error: 'This Firebase account is not allowed. Add its email to ADMIN_EMAILS / ADMIN_EMAIL or grant an admin custom claim.' });
      }
      const workspaceId = await resolveFirebaseWorkspace(decoded.uid);
      req.auth = { role: 'admin', workspaceId, uid: decoded.uid };
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

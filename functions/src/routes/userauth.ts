import { Router } from 'express';
import { randomBytes } from 'crypto';
import { db } from '../db/client';
import { appUsers, agents, agentApiKeys, userWorkspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { requireUser } from '../middleware/roles';
import { hashKey } from '../middleware/auth';

export const userauthRouter = Router();

/** Shared logic: ensure appUsers row + linked agent exist for a given uid. */
async function ensureProfile(uid: string): Promise<{ agentId: string; apiKey?: string; isNew: boolean }> {
  const [existing] = await db.select().from(appUsers).where(eq(appUsers.userId, uid));
  if (existing?.agentId) return { agentId: existing.agentId, isNew: false };

  const candidateId = uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28) || `u${uid.slice(0, 20)}`;
  const [existingAgent] = await db.select().from(agents).where(eq(agents.id, candidateId));

  let agentId: string;
  let apiKey: string | undefined;

  if (existingAgent?.ownerUid === uid) {
    agentId = candidateId;
  } else if (!existingAgent) {
    agentId = candidateId;
    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashKey(rawKey);
    apiKey = rawKey;
    await db.transaction(async tx => {
      await tx.insert(agents).values({ id: agentId, apiKeyHash: keyHash, role: 'agent', balance: 0, ownerUid: uid, createdAt: new Date(), approvedAt: new Date() });
      await tx.insert(agentApiKeys).values({ hash: keyHash, agentId, workspaceId: 'default' });
    });
  } else {
    agentId = `${candidateId.slice(0, 20)}${uid.slice(-6).toLowerCase()}`;
    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashKey(rawKey);
    apiKey = rawKey;
    await db.transaction(async tx => {
      await tx.insert(agents).values({ id: agentId, apiKeyHash: keyHash, role: 'agent', balance: 0, ownerUid: uid, createdAt: new Date(), approvedAt: new Date() });
      await tx.insert(agentApiKeys).values({ hash: keyHash, agentId, workspaceId: 'default' });
    });
  }

  await db.insert(appUsers)
    .values({ userId: uid, agentId, platformAdmin: false, intent: null, createdAt: new Date() })
    .onConflictDoUpdate({ target: appUsers.userId, set: { agentId } });

  return { agentId, apiKey, isNew: true };
}

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Auto-creates the profile + agent on first call (handles OAuth users who skip upsertProfile).
 */
userauthRouter.get('/me', requireUser, wrap(async (req, res) => {
  const { uid, workspaceId, role: authRole } = req.auth!;

  if (!uid) {
    res.json({ uid: null, email: null, workspaceId, authRole, workspaces: {} });
    return;
  }

  // Auto-create profile on first access (important for OAuth users who bypass signup page)
  await ensureProfile(uid);

  const [profile] = await db.select().from(appUsers).where(eq(appUsers.userId, uid));
  const memberships = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, uid));

  const workspaceMap = Object.fromEntries(memberships.map(m => [m.workspaceId, { role: m.role }]));
  const memberRole = workspaceMap[workspaceId]?.role ?? null;

  res.json({
    uid,
    email: null, // BetterAuth session has the email — frontend reads from authClient.useSession()
    intent: profile?.intent ?? null,
    workspaceId,
    authRole,
    memberRole,
    workspaces: workspaceMap,
  });
}));

/**
 * POST /api/auth/profile
 * Upserts the user's app profile. Auto-creates a linked agent on first call.
 * Also used to update intent after signup.
 */
userauthRouter.post('/profile', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'User account required' }); return; }

  const { intent } = req.body;
  if (intent !== undefined && !['creator', 'agent'].includes(intent)) {
    res.status(400).json({ error: 'intent must be "creator" or "agent"' }); return;
  }

  const { agentId, apiKey } = await ensureProfile(uid);

  // Update intent if provided
  if (intent !== undefined) {
    await db.insert(appUsers)
      .values({ userId: uid, agentId, platformAdmin: false, intent, createdAt: new Date() })
      .onConflictDoUpdate({ target: appUsers.userId, set: { intent } });
  }

  res.json({ ok: true, agentId, ...(apiKey !== undefined && { apiKey }) });
}));

/**
 * DELETE /api/auth/me
 * GDPR: deletes the user's app profile. BetterAuth handles actual account deletion.
 */
userauthRouter.delete('/me', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'User account required' }); return; }

  await db.transaction(async tx => {
    await tx.delete(userWorkspaces).where(eq(userWorkspaces.userId, uid));
    await tx.delete(appUsers).where(eq(appUsers.userId, uid));
    // Delete BetterAuth session/account rows (cascade deletes auth tables)
    const { authAccount, authSession, authUser } = await import('../db/schema');
    await tx.delete(authAccount).where(eq(authAccount.userId, uid));
    await tx.delete(authSession).where(eq(authSession.userId, uid));
    await tx.delete(authUser).where(eq(authUser.id, uid));
  });

  res.status(204).send();
}));

/**
 * GET /api/auth/me/export
 * GDPR: exports all data associated with the current user.
 */
userauthRouter.get('/me/export', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'User account required' }); return; }

  const [profile, memberships] = await Promise.all([
    db.select().from(appUsers).where(eq(appUsers.userId, uid)).then(r => r[0] ?? null),
    db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, uid)),
  ]);

  res.json({
    uid,
    profile,
    memberships,
    exportedAt: new Date().toISOString(),
  });
}));

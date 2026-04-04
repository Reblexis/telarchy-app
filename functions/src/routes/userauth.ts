import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '../db/client';
import { appUsers, agents, agentApiKeys, userWorkspaces } from '../db/schema';
import { eq } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { requireUser } from '../middleware/roles';
import { hashKey } from '../middleware/auth';
import { getAuthWorkspaceMemberships, getUserWorkspaceMemberships } from '../middleware/auth';
import { syncLegacyWorkspaceMemberships, provisionWorkspace } from '../lib/participants';

export const userauthRouter = Router();

/** Shared logic: ensure a browser-authenticated participant exists for a given uid. */
async function ensureParticipant(uid: string): Promise<{ participantId: string; apiKey?: string; isNew: boolean }> {
  const [direct] = await db.select().from(agents).where(eq(agents.authUserId, uid));
  if (direct) return { participantId: direct.id, isNew: false };

  const [existing] = await db.select().from(appUsers).where(eq(appUsers.userId, uid));
  if (existing?.agentId) {
    await db.update(agents).set({ authUserId: uid }).where(eq(agents.id, existing.agentId));
    return { participantId: existing.agentId, isNew: false };
  }

  const [owned] = await db.select().from(agents).where(eq(agents.ownerUid, uid));
  if (owned) {
    await db.update(agents).set({ authUserId: uid }).where(eq(agents.id, owned.id));
    return { participantId: owned.id, isNew: false };
  }

  const preferredId = uid;
  const [existingAgent] = await db.select().from(agents).where(eq(agents.id, preferredId));

  let participantId: string;
  let apiKey: string | undefined;

  if (existingAgent?.authUserId === uid || existingAgent?.ownerUid === uid) {
    participantId = preferredId;
    await db.update(agents).set({ authUserId: uid }).where(eq(agents.id, participantId));
  } else {
    participantId = existingAgent ? `${uid}-user` : preferredId;
    const rawKey = randomBytes(32).toString('hex');
    apiKey = rawKey;
    const keyHash = hashKey(rawKey);
    const wsId = randomUUID();
    const now = new Date();
    await db.transaction(async tx => {
      await tx.insert(agents).values({
        id: participantId,
        apiKeyHash: keyHash,
        role: 'agent',
        authUserId: uid,
        balance: 0,
        createdAt: now,
        approvedAt: now,
      });
      await provisionWorkspace(tx, {
        wsId, name: 'My Workspace', createdBy: uid,
        ownerUid: uid, ownerAgentId: participantId,
      });
      await tx.insert(agentApiKeys).values({ hash: keyHash, agentId: participantId, workspaceId: wsId });
    });
    await syncLegacyWorkspaceMemberships(wsId);
  }

  await db.insert(appUsers)
    .values({ userId: uid, platformAdmin: false, intent: existing?.intent ?? null, createdAt: new Date() })
    .onConflictDoNothing();

  return { participantId, apiKey, isNew: true };
}

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Auto-creates the participant on first call (handles OAuth users who skip profile setup).
 */
userauthRouter.get('/me', requireUser, wrap(async (req, res) => {
  const { uid, workspaceId, role: authRole } = req.auth!;

  if (!uid) {
    res.json({ uid: null, email: null, workspaceId, authRole, workspaces: {} });
    return;
  }

  // Auto-create participant on first access (important for OAuth users who bypass signup page)
  const { participantId } = await ensureParticipant(uid);

  const [profile] = await db.select().from(appUsers).where(eq(appUsers.userId, uid));
  const memberships = await getUserWorkspaceMemberships(uid);

  const workspaceMap = Object.fromEntries(memberships.map(m => [m.workspaceId, { role: m.memberRole }]));
  const memberRole = workspaceMap[workspaceId]?.role ?? null;

  res.json({
    uid,
    email: null, // BetterAuth session has the email — frontend reads from authClient.useSession()
    intent: profile?.intent ?? null,
    participantId,
    workspaceId,
    authRole,
    memberRole,
    workspaces: workspaceMap,
  });
}));

/**
 * POST /api/auth/profile
 * Upserts the user's app profile. Auto-creates a participant on first call.
 * Also used to update intent after signup.
 */
userauthRouter.post('/profile', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  const { intent } = req.body;
  if (intent !== undefined && !['creator', 'agent'].includes(intent)) {
    res.status(400).json({ error: 'intent must be "creator" or "agent"' }); return;
  }

  const { participantId, apiKey } = await ensureParticipant(uid);

  // Update intent if provided
  if (intent !== undefined) {
    await db.insert(appUsers)
      .values({ userId: uid, platformAdmin: false, intent, createdAt: new Date() })
      .onConflictDoUpdate({ target: appUsers.userId, set: { intent } });
  }

  res.json({ ok: true, participantId, agentId: participantId, ...(apiKey !== undefined && { apiKey }) });
}));

/**
 * DELETE /api/auth/me
 * GDPR: deletes the user's app profile and detaches browser auth from the participant.
 */
userauthRouter.delete('/me', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  await db.transaction(async tx => {
    await tx.delete(userWorkspaces).where(eq(userWorkspaces.userId, uid));
    await tx.delete(appUsers).where(eq(appUsers.userId, uid));
    await tx.update(agents).set({ authUserId: null }).where(eq(agents.authUserId, uid));
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
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  const [profile, memberships, participant] = await Promise.all([
    db.select().from(appUsers).where(eq(appUsers.userId, uid)).then(r => r[0] ?? null),
    getAuthWorkspaceMemberships({ uid }),
    db.select().from(agents).where(eq(agents.authUserId, uid)).then(r => r[0] ?? null),
  ]);

  res.json({
    uid,
    profile,
    participant,
    memberships,
    exportedAt: new Date().toISOString(),
  });
}));

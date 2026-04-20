import { Router } from 'express';
import { randomBytes } from 'crypto';
import { db } from '../db/client';
import { agents, authUser, trades, positions, tasks, taskMessages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CURRENT_CONSENT_VERSION } from './legal';
import { wrap } from '../lib/wrap';
import { requireUser } from '../middleware/roles';
import { hashKey } from '../middleware/auth';
import { getAuthWorkspaceMemberships, getUserWorkspaceMemberships } from '../middleware/auth';
import { toUnits, SIGNUP_CREDITS } from '../lib/validation';

export const userauthRouter = Router();

/**
 * Ensure a participant (agent record) exists for a browser-authenticated user.
 * Only creates the agent row with signup credits. Workspace creation is deferred
 * to /create-workspace so the user can pick a template.
 */
async function ensureParticipant(uid: string): Promise<{ participantId: string; isNew: boolean }> {
  const [existing] = await db.select().from(agents).where(eq(agents.authUserId, uid));
  if (existing) return { participantId: existing.id, isNew: false };

  const participantId = uid;
  const now = new Date();
  // Generate a key hash for the agents table (required not-null column).
  // The actual agentApiKeys row linking this to a workspace is created later
  // when the user creates their first workspace.
  const keyHash = hashKey(randomBytes(32).toString('hex'));

  await db.insert(agents).values({
    id: participantId,
    apiKeyHash: keyHash,
    authUserId: uid,
    platformAdmin: false,
    intent: null,
    balance: toUnits(SIGNUP_CREDITS),
    createdAt: now,
    approvedAt: now,
  });

  return { participantId, isNew: true };
}

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Auto-creates the participant on first call (handles OAuth users who skip profile setup).
 */
userauthRouter.get('/me', requireUser, wrap(async (req, res) => {
  const { uid, capabilities } = req.auth!;

  if (!uid) {
    const authRole = capabilities.has('manage') ? 'admin' : capabilities.has('trade') ? 'agent' : capabilities.has('read') ? 'member' : 'pending';
    res.json({ uid: null, email: null, workspaceId: req.auth!.workspaceId, authRole, workspaces: {} });
    return;
  }

  // Auto-create participant on first access (important for OAuth users who bypass signup page)
  const { participantId } = await ensureParticipant(uid);

  const [agent] = await db.select().from(agents).where(eq(agents.authUserId, uid));
  const memberships = await getUserWorkspaceMemberships(uid);

  const workspaceMap = Object.fromEntries(memberships.map(m => [m.workspaceId, { role: m.memberRole }]));

  // Use the workspace from auth context, or fall back to the first membership.
  // New users with no workspace yet will have an empty workspaceId (authRole = 'pending').
  const workspaceId = req.auth!.workspaceId || memberships[0]?.workspaceId || '';
  const memberRole = workspaceMap[workspaceId]?.role ?? null;

  // Recompute authRole from actual membership; the middleware value may be stale
  // (e.g. 'pending' when ensureParticipant just created the first workspace).
  // This is a legacy label for frontend consumers; capabilities are authoritative.
  const effectiveAuthRole = memberRole === 'owner' || memberRole === 'admin' ? 'admin'
    : memberRole === 'trader' ? 'agent'
    : memberRole === 'viewer' ? 'member'
    : memberships.length > 0 ? 'agent'
    : 'pending';

  res.json({
    uid,
    email: null, // BetterAuth session has the email; frontend reads from authClient.useSession()
    intent: agent?.intent ?? null,
    participantId,
    workspaceId,
    authRole: effectiveAuthRole,
    memberRole,
    workspaces: workspaceMap,
  });
}));

/**
 * POST /api/auth/consent
 * Records that the authenticated user accepted the current Terms and Privacy
 * Policy. Called by the signup flow immediately after sign-up (email/password
 * or OAuth) and before the user is allowed to use the app.
 */
userauthRouter.post('/consent', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  const { accepted } = req.body ?? {};
  if (accepted !== true) {
    res.status(400).json({ error: 'Consent to Terms and Privacy Policy is required' });
    return;
  }

  await db.update(authUser)
    .set({ consentedAt: new Date(), consentedVersion: CURRENT_CONSENT_VERSION })
    .where(eq(authUser.id, uid));

  res.json({ ok: true, version: CURRENT_CONSENT_VERSION });
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

  const { participantId } = await ensureParticipant(uid);

  // Update intent if provided
  if (intent !== undefined) {
    await db.update(agents).set({ intent }).where(eq(agents.authUserId, uid));
  }

  res.json({ ok: true, participantId, agentId: participantId });
}));

/**
 * DELETE /api/auth/me
 * GDPR: deletes the user's app profile and detaches browser auth from the participant.
 */
userauthRouter.delete('/me', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  await db.transaction(async tx => {
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
 * GDPR Article 15: returns all personal data associated with the current user.
 * Mirrors the categories listed in docs/legal/privacy-policy.md §1.
 */
userauthRouter.get('/me/export', requireUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Browser account session required' }); return; }

  const [authRow, participantRow, memberships] = await Promise.all([
    db.select().from(authUser).where(eq(authUser.id, uid)).then(r => r[0] ?? null),
    db.select().from(agents).where(eq(agents.authUserId, uid)).then(r => r[0] ?? null),
    getAuthWorkspaceMemberships({ uid }),
  ]);

  const account = authRow ? {
    id: authRow.id,
    email: authRow.email,
    emailVerified: authRow.emailVerified,
    name: authRow.name,
    image: authRow.image,
    createdAt: authRow.createdAt,
    updatedAt: authRow.updatedAt,
    consentedAt: authRow.consentedAt,
    consentedVersion: authRow.consentedVersion,
  } : null;

  const participantId = participantRow?.id ?? null;
  const participant = participantRow ? {
    id: participantRow.id,
    authUserId: participantRow.authUserId,
    balance: participantRow.balance,
    earnedBetting: participantRow.earnedBetting,
    spentBetting: participantRow.spentBetting,
    spentTokens: participantRow.spentTokens,
    earnedTasks: participantRow.earnedTasks,
    walletAddress: participantRow.walletAddress,
    withdrawnUsdc: participantRow.withdrawnUsdc,
    platformAdmin: participantRow.platformAdmin,
    intent: participantRow.intent,
    createdAt: participantRow.createdAt,
    approvedAt: participantRow.approvedAt,
  } : null;

  const [userTrades, userPositions, userTasks, userTaskMessages] = participantId
    ? await Promise.all([
        db.select().from(trades).where(eq(trades.agentId, participantId)),
        db.select().from(positions).where(eq(positions.agentId, participantId)),
        db.select().from(tasks).where(eq(tasks.proposedBy, participantId)),
        db.select().from(taskMessages).where(eq(taskMessages.from, participantId)),
      ])
    : [[], [], [], []];

  res.json({
    uid,
    account,
    participant,
    memberships,
    trades: userTrades,
    positions: userPositions,
    tasksProposed: userTasks,
    taskMessages: userTaskMessages,
    exportedAt: new Date().toISOString(),
    notes: 'Request logs (IP, user-agent, short-TTL) are not included; see Privacy Policy §5.',
  });
}));

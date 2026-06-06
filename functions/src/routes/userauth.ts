import { Router, type Request } from 'express';
import { randomBytes } from 'crypto';
import { db } from '../db/client';
import { agents, agentApiKeys, authUser, trades, positions, proposals, proposalMessages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CURRENT_CONSENT_VERSION } from './legal';
import { wrap } from '../lib/wrap';
import { requireUser, requireIdentity, requireScope } from '../middleware/roles';
import { hashKey } from '../middleware/auth';
import { getAuthWorkspaceMemberships, getUserWorkspaceMemberships } from '../middleware/auth';
import { toUnits, SIGNUP_CREDITS, normalizeBio } from '../lib/validation';
import { claimNickname } from '../lib/participants';

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
 * Resolve the caller to a participant ID (for both browser-session and agent-key auth).
 * Browser users are auto-provisioned on first call; agent-key callers already
 * have an agent row by definition.
 */
async function resolveCallerParticipantId(req: Request): Promise<string | null> {
  const uid = req.auth?.uid;
  const agentId = req.auth?.agentId;
  if (uid) {
    const { participantId } = await ensureParticipant(uid);
    return participantId;
  }
  if (agentId) return agentId;
  return null;
}

/**
 * GET /api/auth/me
 * Returns the current participant's profile and workspace memberships.
 * Works for both browser sessions and agent API keys: same shape, different
 * auth path. Auto-creates the participant for OAuth users on first call.
 */
userauthRouter.get('/me', requireIdentity, requireScope('account:read'), wrap(async (req, res) => {
  const { uid, agentId, capabilities } = req.auth!;

  if (!uid && !agentId) {
    // Master key with no identity (rare): degrade gracefully.
    const authRole = capabilities.has('manage') ? 'admin' : capabilities.has('trade') ? 'agent' : capabilities.has('read') ? 'member' : 'pending';
    res.json({ uid: null, email: null, workspaceId: req.auth!.workspaceId, authRole, workspaces: {} });
    return;
  }

  const participantId = (await resolveCallerParticipantId(req))!;
  const [agent] = await db.select().from(agents).where(eq(agents.id, participantId));
  const memberships = uid
    ? await getUserWorkspaceMemberships(uid)
    : await getAuthWorkspaceMemberships({ agentId });

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
    uid: uid ?? null,
    email: null, // BetterAuth session has the email; frontend reads from authClient.useSession()
    intent: agent?.intent ?? null,
    nickname: agent?.nickname ?? null,
    bio: agent?.bio ?? null,
    participantId,
    workspaceId,
    authRole: effectiveAuthRole,
    memberRole,
    capabilities: [...capabilities].sort(),
    workspaces: workspaceMap,
    platformAdmin: agent?.platformAdmin === true,
  });
}));

/**
 * POST /api/auth/consent
 * Records that the authenticated user accepted the current Terms and Privacy
 * Policy. Browser-account specific: programmatic agent-key participants are
 * exempt from consent gating (see middleware/consent.ts), so this endpoint
 * keeps requireUser by design.
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
 * Upserts the caller's participant profile (intent + nickname + bio). Works
 * for both browser sessions and agent API keys; uses whichever identity is
 * present on req.auth and updates that participant's row. `bio` is a freeform
 * public description (max 500 chars; empty string or null clears it) shown on
 * the public participant profile.
 */
userauthRouter.post('/profile', requireIdentity, requireScope('account:write'), wrap(async (req, res) => {
  const participantId = await resolveCallerParticipantId(req);
  if (!participantId) {
    res.status(403).json({ error: 'Identity required' });
    return;
  }

  const { intent, nickname, bio } = req.body;
  if (intent !== undefined && !['creator', 'agent', 'trader'].includes(intent)) {
    res.status(400).json({ error: 'intent must be "creator", "agent", or "trader"' }); return;
  }

  let normalizedBio: string | null | undefined;
  if (bio !== undefined) {
    const result = normalizeBio(bio);
    if (result instanceof Error) { res.status(400).json({ error: result.message }); return; }
    normalizedBio = result;
  }

  if (nickname !== undefined) {
    if (typeof nickname !== 'string') {
      res.status(400).json({ error: 'nickname must be a string' }); return;
    }
    const trimmed = nickname.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: 'nickname must not be empty' }); return;
    }
    if (trimmed.length > 64) {
      res.status(400).json({ error: 'nickname must be 1–64 characters' }); return;
    }
  }

  if (intent !== undefined) {
    await db.update(agents).set({ intent }).where(eq(agents.id, participantId));
  }

  if (normalizedBio !== undefined) {
    await db.update(agents).set({ bio: normalizedBio }).where(eq(agents.id, participantId));
  }

  if (nickname !== undefined) {
    await claimNickname(db, participantId, nickname.trim());
  }

  res.json({ ok: true, participantId, agentId: participantId });
}));

/**
 * DELETE /api/auth/me
 * GDPR / self-delete: removes the caller's participant record (and, for
 * browser users, the BetterAuth account rows). Works for both auth paths so
 * an API-key participant can also exercise their right to be forgotten.
 */
userauthRouter.delete('/me', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  // Account deletion is intentionally browser-only: a leaked or scoped API
  // key must never be able to wipe its owner's account. The UI requires the
  // user to be signed in (cookie session) to reach this endpoint. We keep
  // requireIdentity at the middleware layer (API parity) and enforce the
  // browser-only constraint inline so the endpoint still appears symmetric
  // in /api/help with auth=identity but actually blocks key callers.
  if (!uid) {
    res.status(403).json({ error: 'Account deletion is only available from a signed-in browser session.' });
    return;
  }
  const participantId = await resolveCallerParticipantId(req);
  if (!participantId) {
    res.status(403).json({ error: 'Identity required' });
    return;
  }

  await db.transaction(async tx => {
    // Detach + delete the caller's PII. Trades, positions, and liquidity
    // events are kept (they affect market state for other participants);
    // the agent row stays as an opaque attribution token but loses every
    // authentication path and human-identifiable field.
    await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, participantId));
    await tx.update(agents)
      .set({ authUserId: null, nickname: null, walletAddress: null, intent: null })
      .where(eq(agents.id, participantId));
    if (uid) {
      // Browser-account user: tear down BetterAuth rows (login + sessions).
      const { authAccount, authSession, authUser } = await import('../db/schema');
      await tx.delete(authAccount).where(eq(authAccount.userId, uid));
      await tx.delete(authSession).where(eq(authSession.userId, uid));
      await tx.delete(authUser).where(eq(authUser.id, uid));
    }
    // The agent row itself is intentionally preserved — its presence keeps
    // historical trades/positions/liquidity events attributable for market
    // integrity, while the row carries no PII after the update above.
  });

  res.status(204).send();
}));

/**
 * GET /api/auth/me/export
 * GDPR Article 15: returns all personal data for the caller. Works for both
 * auth paths; agent-key callers see the participant + their trades/positions
 * (no BetterAuth account section, since they have none).
 */
userauthRouter.get('/me/export', requireIdentity, requireScope('account:read'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const participantId = await resolveCallerParticipantId(req);
  if (!participantId) {
    res.status(403).json({ error: 'Identity required' });
    return;
  }

  const [authRow, participantRow, memberships] = await Promise.all([
    uid ? db.select().from(authUser).where(eq(authUser.id, uid)).then(r => r[0] ?? null) : Promise.resolve(null),
    db.select().from(agents).where(eq(agents.id, participantId)).then(r => r[0] ?? null),
    getAuthWorkspaceMemberships({ uid, agentId }),
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

  const participant = participantRow ? {
    id: participantRow.id,
    authUserId: participantRow.authUserId,
    nickname: participantRow.nickname,
    balance: participantRow.balance,
    earnedBetting: participantRow.earnedBetting,
    spentBetting: participantRow.spentBetting,
    spentTokens: participantRow.spentTokens,
    walletAddress: participantRow.walletAddress,
    withdrawnUsdc: participantRow.withdrawnUsdc,
    platformAdmin: participantRow.platformAdmin,
    intent: participantRow.intent,
    createdAt: participantRow.createdAt,
    approvedAt: participantRow.approvedAt,
  } : null;

  const [userTrades, userPositions, userProposals, userProposalMessages] = await Promise.all([
    db.select().from(trades).where(eq(trades.agentId, participantId)),
    db.select().from(positions).where(eq(positions.agentId, participantId)),
    db.select().from(proposals).where(eq(proposals.proposedBy, participantId)),
    db.select().from(proposalMessages).where(eq(proposalMessages.from, participantId)),
  ]);

  res.json({
    uid: uid ?? null,
    account,
    participant,
    memberships,
    trades: userTrades,
    positions: userPositions,
    proposalsProposed: userProposals,
    proposalMessages: userProposalMessages,
    exportedAt: new Date().toISOString(),
    notes: 'Request logs (IP, user-agent, short-TTL) are not included; see Privacy Policy §5.',
  });
}));

import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireIdentity, requireScope } from '../middleware/roles';
import { listNotifications, markNotificationsSeen } from '../services/notifications';
import { db } from '../db/client';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * The notifications inbox behind the floor's bell (owner ask 2026-08-19).
 *
 * It shows EVERYTHING that happened to you: comments on your contracts,
 * replies in threads you are in, new contracts where you trade, and decisions
 * on your own contracts. The email switches (POST /api/auth/profile) do not
 * filter it, because they tune interruption and this is the record; turning
 * an email off means "stop writing to me", not "hide it from me".
 *
 * Workspace-agnostic on purpose: a participant trades on several floors and
 * has one inbox, so no X-Workspace-Id is required or read.
 */
export const notificationsRouter = Router();

/**
 * The caller as a participant. A browser session resolves through its account
 * link; unlike the profile routes this never CREATES the participant, because
 * reading an inbox is not a reason to mint an identity, and an account with no
 * participant row has nothing in it anyway.
 */
async function callerParticipantId(req: import('express').Request): Promise<string | null> {
  if (req.auth?.agentId) return req.auth.agentId;
  const uid = req.auth?.uid;
  if (!uid) return null;
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.authUserId, uid));
  return row?.id ?? null;
}

notificationsRouter.get('/', requireIdentity, requireScope('account:read'), wrap(async (req, res) => {
  const participantId = await callerParticipantId(req);
  if (!participantId) { res.status(403).json({ error: 'Identity required' }); return; }

  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30;
  const { items, unread, seenAt } = await listNotifications(participantId, limit);

  res.json({
    unread,
    seenAt,
    notifications: items.map(i => ({
      id: i.id, kind: i.kind, at: i.at, actor: i.actor, subject: i.subject,
      detail: i.detail, workspaceSlug: i.workspaceSlug,
      proposalId: i.proposalId, marketId: i.marketId,
      unread: seenAt === null ? true : i.at.getTime() > seenAt.getTime(),
    })),
  });
}));

/** Read everything: moves the watermark to now. Idempotent. */
notificationsRouter.post('/seen', requireIdentity, requireScope('account:write'), wrap(async (req, res) => {
  const participantId = await callerParticipantId(req);
  if (!participantId) { res.status(403).json({ error: 'Identity required' }); return; }
  const seenAt = await markNotificationsSeen(participantId);
  res.json({ ok: true, seenAt });
}));

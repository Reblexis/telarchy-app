import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, pushSubscriptions } from '../db/schema';
import {
  configuredTransports,
  fcmConfigured,
  isPushTransport,
  PUSH_TRANSPORTS,
  pushConfigured,
  vapidPublicKey,
  webPushConfigured,
} from '../lib/push';
import { wrap } from '../lib/wrap';
import { requireIdentity, requireScope } from '../middleware/roles';
import { listNotifications, markNotificationRead, markNotificationsSeen } from '../services/notifications';

/**
 * The notifications inbox behind the floor's bell (owner ask 2026-08-19).
 *
 * It shows what happened to you: comments on your contracts, replies in
 * threads you are in, new contracts where you trade, markets you traded
 * settling, and decisions on contracts you posted, traded or argued about.
 * Which KINDS it derives is set by the matrix's web cells (revised
 * 2026-08-24, owner; POST /api/auth/profile notificationChannels). The email
 * cells never filter it: those tune a different channel.
 *
 * This router also owns the mobile channel's addresses: a browser's push
 * subscription, registered from the settings dialog.
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

notificationsRouter.get(
  '/',
  requireIdentity,
  requireScope('account:read'),
  wrap(async (req, res) => {
    const participantId = await callerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30;
    const { items, unread, seenAt } = await listNotifications(participantId, limit);

    res.json({
      unread,
      seenAt,
      notifications: items.map(i => ({
        id: i.id,
        kind: i.kind,
        at: i.at,
        actor: i.actor,
        subject: i.subject,
        detail: i.detail,
        workspaceSlug: i.workspaceSlug,
        proposalId: i.proposalId,
        marketId: i.marketId,
        commentId: i.commentId,
        unread: i.unread,
      })),
    });
  }),
);

/**
 * Read ONE item, which is what clicking a row does: the count goes down by
 * one rather than all at once. Idempotent, and it never 404s on an id the
 * inbox no longer derives, because "I read a thing that has since aged out"
 * is not an error worth showing a person.
 */
notificationsRouter.post(
  '/:itemId/read',
  requireIdentity,
  requireScope('account:write'),
  wrap(async (req, res) => {
    const participantId = await callerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }
    const itemId = String(req.params.itemId ?? '');
    if (!itemId || itemId.length > 200) {
      res.status(400).json({ error: 'itemId is required' });
      return;
    }
    await markNotificationRead(participantId, itemId);
    res.json({ ok: true });
  }),
);

/** Read everything: moves the watermark to now. Idempotent. */
notificationsRouter.post(
  '/seen',
  requireIdentity,
  requireScope('account:write'),
  wrap(async (req, res) => {
    const participantId = await callerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }
    const seenAt = await markNotificationsSeen(participantId);
    res.json({ ok: true, seenAt });
  }),
);

/**
 * What a client needs before it subscribes: the VAPID public key a browser
 * passes to PushManager.subscribe, and which transports this deployment can
 * actually send over. Public, since the key is embedded in every subscribing
 * client.
 *
 * `transports` is per transport rather than one boolean because the two
 * clients ask different questions: a store build needs to know FCM is live
 * even where VAPID is not, and a browser the reverse. `configured` stays as
 * the older any-transport answer so existing clients keep working.
 */
notificationsRouter.get(
  '/push-key',
  wrap(async (_req, res) => {
    res.json({ configured: pushConfigured(), publicKey: vapidPublicKey(), transports: configuredTransports() });
  }),
);

/**
 * Register one of the caller's mobile addresses (docs/mobile.md). Two shapes,
 * because there are two transports:
 *
 *   { subscription: { endpoint, keys: { p256dh, auth } } }   a browser
 *   { transport: 'fcm', token }                              a store build
 *
 * Upserts on the address: re-subscribing the same browser (which browsers do
 * on every permission re-grant) or the same device (which store builds do on
 * every launch) must not duplicate deliveries.
 *
 * An address for a transport this deployment cannot send over is refused
 * rather than stored, so a client never shows the user a working switch that
 * delivers nothing.
 */
notificationsRouter.post(
  '/push-subscriptions',
  requireIdentity,
  requireScope('account:write'),
  wrap(async (req, res) => {
    const participantId = await callerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }
    // Absent a transport this is a browser, which is the only shape that
    // existed before store builds and the only one older clients send.
    const transport = req.body?.transport ?? 'webpush';
    if (!isPushTransport(transport)) {
      res.status(400).json({ error: `transport must be one of: ${PUSH_TRANSPORTS.join(', ')}` });
      return;
    }

    let endpoint: string;
    let keys: { p256dh: string; auth: string } | Record<string, never>;

    if (transport === 'fcm') {
      if (!fcmConfigured()) {
        res.status(503).json({ error: 'Store-build push is not configured on this server' });
        return;
      }
      const token = req.body?.token;
      if (typeof token !== 'string' || !token || token.length > 2000) {
        res.status(400).json({ error: 'token is required for the fcm transport' });
        return;
      }
      endpoint = token;
      // A device token authenticates by itself; there is no key exchange.
      keys = {};
    } else {
      if (!webPushConfigured()) {
        res.status(503).json({ error: 'Push is not configured on this server' });
        return;
      }
      const sub = req.body?.subscription;
      const subEndpoint = sub?.endpoint;
      const subKeys = sub?.keys;
      if (
        typeof subEndpoint !== 'string' ||
        !subEndpoint.startsWith('https://') ||
        subEndpoint.length > 2000 ||
        !subKeys ||
        typeof subKeys.p256dh !== 'string' ||
        typeof subKeys.auth !== 'string'
      ) {
        res
          .status(400)
          .json({ error: 'subscription must be a browser PushSubscription: { endpoint, keys: { p256dh, auth } }' });
        return;
      }
      endpoint = subEndpoint;
      keys = { p256dh: subKeys.p256dh, auth: subKeys.auth };
    }

    await db
      .insert(pushSubscriptions)
      .values({ id: randomUUID(), agentId: participantId, endpoint, keys, transport })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { agentId: participantId, keys, transport },
      });
    res.json({ ok: true });
  }),
);

/** Forget this browser's subscription (the mobile toggle going dark here). */
notificationsRouter.delete(
  '/push-subscriptions',
  requireIdentity,
  requireScope('account:write'),
  wrap(async (req, res) => {
    const participantId = await callerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.agentId, participantId), eq(pushSubscriptions.endpoint, endpoint)));
    res.json({ ok: true });
  }),
);

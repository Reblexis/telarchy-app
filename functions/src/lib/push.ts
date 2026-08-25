/**
 * The mobile channel's transport: browser push (Web Push / VAPID), the same
 * notifications a phone shows for a native app, minus the app. This module
 * owns delivery only; services/notifications.ts owns who gets what.
 *
 * Configured by VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (Secret Manager in
 * production, keyring/telarchy in the umbrella). With either missing nothing
 * is sent and nothing throws, which is what local dev and the test suite run
 * on; the subscribe endpoint also answers 503 so a client never collects a
 * subscription nobody can use.
 *
 * Same delivery rules as mail (docs/vision.md): fire-and-forget, one failure
 * logged and swallowed. One rule of its own: a push endpoint answering 404 or
 * 410 is a browser that revoked the subscription, and the row is deleted
 * rather than retried forever.
 */

import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../db/client';
import { pushSubscriptions } from '../db/schema';

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let vapidApplied = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidApplied) {
    webpush.setVapidDetails(
      // A mailto the push service can complain to, per the VAPID spec.
      `mailto:${process.env.OWNER_NOTIFY_EMAIL || 'viktor.cihal@gmail.com'}`,
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidApplied = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification lands, an absolute URL. */
  url: string;
}

/** Send one payload to every subscription a participant holds. */
export async function sendPushToParticipant(agentId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.agentId, agentId));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        JSON.stringify(payload),
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser revoked it; the address no longer exists.
        await db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.agentId, agentId), eq(pushSubscriptions.endpoint, sub.endpoint)))
          .catch(err => console.error('push subscription cleanup failed:', err));
      } else {
        console.error('push delivery failed:', e);
      }
    }
  }
}

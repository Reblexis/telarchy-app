/**
 * The mobile channel's delivery (docs/mobile.md, "Notifications"). This module
 * owns HOW a participant's phone is reached; services/notifications.ts owns
 * who gets what.
 *
 * The rule: THE TRANSPORT IS A PROPERTY OF THE ADDRESS, NOT OF THE
 * NOTIFICATION. A participant may hold a desktop browser, an installed web app
 * and a store build at once. Callers name a participant and a payload, never a
 * transport; each address is delivered over the one it was registered with.
 *
 * Two transports:
 *
 * - `webpush` (Web Push / VAPID) for browsers and installed web apps.
 *   Configured by VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 * - `fcm` for store builds, whose webview cannot receive Web Push. One
 *   transport covers both stores: Firebase delivers to Android itself and
 *   relays to iOS over APNs using the auth key uploaded to it, so this server
 *   holds one native credential and speaks one protocol. Configured by
 *   FCM_SERVICE_ACCOUNT_JSON, a Firebase service-account key as JSON.
 *
 * Both live in Secret Manager in production and in keyring/telarchy in the
 * umbrella. A transport with no credentials sends nothing and throws nothing,
 * which is what local dev, the test suite, and a self-hosted instance with no
 * store builds run on; the subscribe endpoint refuses to take an address for a
 * transport that cannot send, so a client never collects one nobody can use.
 *
 * Same delivery rules as mail (docs/vision.md): fire-and-forget, one failure
 * logged and swallowed. One rule of its own: an address is deleted ONLY when
 * the platform disowns it (404/410 from a push endpoint, NOT_FOUND or
 * UNREGISTERED from FCM). A timeout, a 500, or a credential this server got
 * wrong leaves the row alone, because deleting there would unsubscribe a
 * working phone over a fault that is ours.
 */

import { createSign } from 'crypto';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../db/client';
import { pushSubscriptions } from '../db/schema';

/** Every transport an address may be registered with. */
export const PUSH_TRANSPORTS = ['webpush', 'fcm'] as const;
export type PushTransport = (typeof PUSH_TRANSPORTS)[number];

export function isPushTransport(value: unknown): value is PushTransport {
  return typeof value === 'string' && (PUSH_TRANSPORTS as readonly string[]).includes(value);
}

// --- Web Push -------------------------------------------------------------

export function webPushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/** Whether the mobile channel can reach anyone at all, over any transport. */
export function pushConfigured(): boolean {
  return webPushConfigured() || fcmConfigured();
}

/** Which transports this deployment can actually send over. */
export function configuredTransports(): Record<PushTransport, boolean> {
  return { webpush: webPushConfigured(), fcm: fcmConfigured() };
}

// web-push keeps the VAPID details in module state, so they are applied once
// per distinct key rather than on every send; tracking the key rather than a
// boolean means a rotated secret is picked up instead of ignored.
let vapidAppliedFor: string | null = null;
function ensureVapid(): boolean {
  if (!webPushConfigured()) return false;
  const key = process.env.VAPID_PUBLIC_KEY as string;
  if (vapidAppliedFor !== key) {
    webpush.setVapidDetails(
      // A mailto the push service can complain to, per the VAPID spec.
      `mailto:${process.env.OWNER_NOTIFY_EMAIL || 'viktor.cihal@gmail.com'}`,
      key,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidAppliedFor = key;
  }
  return true;
}

// --- FCM ------------------------------------------------------------------

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * The service account, or null when it is absent or unparseable. Malformed
 * JSON is treated as "not configured" rather than thrown: a bad secret should
 * make the store-build transport dark, not take down every notification the
 * site sends.
 */
function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedToken: { token: string; expiresAt: number; forEmail: string } | null = null;

/**
 * An OAuth access token for the FCM scope, minted from the service account by
 * the JWT bearer flow. Done by hand rather than with google-auth-library: it
 * is one signed assertion and one POST, against a dependency that would pull
 * in the whole Google auth stack for it.
 */
async function fcmAccessToken(account: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.forEmail === account.client_email && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  let assertion: string;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
  } catch (e) {
    console.error('FCM token signing failed (is FCM_SERVICE_ACCOUNT_JSON a real key?):', e);
    return null;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    console.error('FCM token mint failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  cachedToken = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
    forEmail: account.client_email,
  };
  return body.access_token;
}

/** True when FCM's answer means this device token no longer exists. */
function fcmDisownedTheDevice(status: number, body: unknown): boolean {
  if (status !== 404) return false;
  const error = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })?.error;
  if (error?.status === 'NOT_FOUND') return true;
  return (error?.details ?? []).some(d => d.errorCode === 'UNREGISTERED');
}

// --- Delivery -------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification lands, an absolute URL. */
  url: string;
}

/** Whether the address should be forgotten, per transport. */
type Verdict = 'delivered' | 'failed' | 'address-is-gone';

async function deliverWebPush(endpoint: string, keys: unknown, payload: PushPayload): Promise<Verdict> {
  try {
    await webpush.sendNotification(
      { endpoint, keys: keys as { p256dh: string; auth: string } },
      JSON.stringify(payload),
    );
    return 'delivered';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'address-is-gone';
    console.error('push delivery failed:', e);
    return 'failed';
  }
}

async function deliverFcm(token: string, payload: PushPayload, account: ServiceAccount): Promise<Verdict> {
  const accessToken = await fcmAccessToken(account);
  if (!accessToken) return 'failed';
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          // The shell reads `url` on tap, the same key public/sw.js reads, so
          // one payload shape serves both transports.
          data: { url: payload.url },
        },
      }),
    });
    if (res.ok) return 'delivered';
    const body = await res.json().catch(() => ({}));
    if (fcmDisownedTheDevice(res.status, body)) return 'address-is-gone';
    console.error('FCM delivery failed:', res.status, JSON.stringify(body));
    return 'failed';
  } catch (e) {
    console.error('FCM delivery failed:', e);
    return 'failed';
  }
}

/**
 * Send one payload to every address a participant holds, over whichever
 * transport each was registered with. One address failing never stops the
 * ones behind it.
 */
export async function sendPushToParticipant(agentId: string, payload: PushPayload): Promise<void> {
  if (!pushConfigured()) return;
  const account = serviceAccount();
  const webPushLive = ensureVapid();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.agentId, agentId));

  for (const sub of subs) {
    let verdict: Verdict = 'failed';
    if (sub.transport === 'fcm') {
      if (!account) continue; // This deployment cannot send to store builds.
      verdict = await deliverFcm(sub.endpoint, payload, account);
    } else {
      if (!webPushLive) continue; // This deployment cannot send to browsers.
      verdict = await deliverWebPush(sub.endpoint, sub.keys, payload);
    }
    if (verdict === 'address-is-gone') {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.agentId, agentId), eq(pushSubscriptions.endpoint, sub.endpoint)))
        .catch(err => console.error('push subscription cleanup failed:', err));
    }
  }
}

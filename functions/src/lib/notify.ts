/**
 * Outbound mail, all of it.
 *
 * Two kinds live here. Owner notifications (owner decision 2026-08-10): the
 * floor's two "someone showed up" moments, a new email in the door and a new
 * job on the ballot, must reach the owner without them polling the admin
 * pages, because the promise on the floor is "we will get back to you within
 * a few days" and a silent inbox breaks it. Participant notifications
 * (services/notifications.ts, owner ask 2026-08-19) go out over the same
 * transport.
 *
 * Transport is Resend (the telarchy.com domain is verified there), read from
 * RESEND_API_KEY; the owner's address is OWNER_NOTIFY_EMAIL. No key means
 * mail is off (local dev, tests), which is deliberate: no test run and no
 * laptop can write to a real person. The caller's flow must never depend on
 * any of this, so every failure is logged and swallowed here rather than
 * thrown at a request that was only posting a comment.
 */

const RESEND_API = 'https://api.resend.com/emails';

// From address and public origin come from lib/origin.ts (PUBLIC_ORIGIN, MAIL_FROM),
// so a self-hosted instance mails from its own domain and links to itself.
export { publicOrigin } from './origin';

import { mailFrom } from './origin';

/**
 * Send one plain-text email. Resolves either way: a missing key, a 4xx from
 * Resend, or a dead network are all logged and swallowed. Returns true only
 * when Resend accepted it, which is what the tests assert on.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: mailFrom(), to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error(`email send failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('email send failed:', e);
    return false;
  }
}

export async function notifyOwner(subject: string, text: string): Promise<void> {
  const to = process.env.OWNER_NOTIFY_EMAIL;
  if (!to) return;
  await sendEmail(to, subject, text);
}

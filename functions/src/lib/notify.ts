/**
 * Owner notifications (owner decision 2026-08-10): the floor's two
 * "someone showed up" moments, a new email in the door and a new job on
 * the ballot, must reach the owner without them polling the admin pages,
 * because the promise on the floor is "we will get back to you within a
 * few days" and a silent inbox breaks it.
 *
 * Transport is Resend (the telarchy.com domain is verified there), read
 * from RESEND_API_KEY; the recipient is OWNER_NOTIFY_EMAIL. Both unset
 * means notifications are off (local dev, tests): the caller's flow must
 * never depend on this, so every failure is logged and swallowed here.
 */

const RESEND_API = 'https://api.resend.com/emails';

export async function notifyOwner(subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_NOTIFY_EMAIL;
  if (!key || !to) return;
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: 'Telarchy <floor@telarchy.com>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`owner notification failed: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error('owner notification failed:', e);
  }
}

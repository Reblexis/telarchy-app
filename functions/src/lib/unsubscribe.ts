import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The unsubscribe token (docs/announcements-by-email.md, "Unsubscribing").
 *
 * It is the address and a keyed signature of it, and nothing else. No row, so
 * a link cannot be invalidated by a cleanup and never expires; keyed, so a
 * token cannot be guessed for somebody else's address and the list cannot be
 * enumerated by walking ids.
 *
 * The address is normalised before signing and before comparing, because the
 * suppression list is keyed on the address: "Two@Example.com " and
 * "two@example.com" are one person, and an unsubscribe that only stopped one
 * spelling would keep writing to someone who asked us to stop.
 */

/** One spelling of an address, for signing, storing and comparing. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function secret(): string {
  const s = process.env.BROADCAST_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error('BROADCAST_SECRET (or BETTER_AUTH_SECRET) must be set to mint unsubscribe links');
  return s;
}

const b64 = (s: Buffer | string) => Buffer.from(s).toString('base64url');
const sign = (email: string) => createHmac('sha256', secret()).update(email).digest('base64url').slice(0, 32);

export function unsubscribeToken(email: string): string {
  const e = normalizeEmail(email);
  return `${b64(e)}.${sign(e)}`;
}

/** The address a token names, or null when it does not verify. */
export function emailFromToken(token: string): string | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let email: string;
  try {
    email = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email || normalizeEmail(email) !== email) return null;
  let expected: string;
  try {
    expected = sign(email);
  } catch {
    return null;
  }
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}

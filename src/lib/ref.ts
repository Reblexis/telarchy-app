/**
 * Attribution capture. A `?ref=<slug>` on any landing URL is kept in a
 * first-party cookie for 30 days so the signup that follows can say where it
 * came from (docs/agent-economy.md, "Attribution"). The slug grammar matches the
 * backend's (functions/src/lib/attribution.ts): [a-z0-9-]{1,32}.
 */
const REF_COOKIE = 'ta_ref';
export const REF_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SLUG = /^[a-z0-9-]{1,32}$/;

function isValidRef(v: string | null | undefined): v is string {
  return typeof v === 'string' && SLUG.test(v);
}

/** Store `ref` if valid. Returns the stored slug or null. */
export function storeRef(ref: string | null | undefined, doc: { cookie: string } = document): string | null {
  if (!isValidRef(ref)) return null;
  doc.cookie = `${REF_COOKIE}=${ref}; Max-Age=${REF_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  return ref;
}

/** Read the stored slug, or null when absent or malformed. */
export function readRefCookie(doc: { cookie: string } = document): string | null {
  for (const part of doc.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== REF_COOKIE) continue;
    const v = decodeURIComponent(rest.join('='));
    return isValidRef(v) ? v : null;
  }
  return null;
}

/** Called once on app start: capture `?ref=` from the current URL, if present. */
export function captureRefFromLocation(
  search: string = window.location.search,
  doc: { cookie: string } = document,
): string | null {
  const ref = new URLSearchParams(search).get('ref');
  return storeRef(ref, doc);
}

/**
 * Validate and normalize a post-signup/post-login `next` redirect target.
 * Only same-origin paths are allowed; anything that isn't a single leading
 * "/" followed by a non-"/" character is rejected so the URL can't be
 * subverted into a different origin (e.g. `//evil.com`).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  if (raw.length > 200) return null;
  return raw;
}

const STORAGE_KEY = 'signup-next';

/** Stash the validated next-path in sessionStorage so it survives an OAuth round-trip. */
export function stashNextPath(raw: string | null | undefined): void {
  const safe = safeNextPath(raw);
  if (safe) sessionStorage.setItem(STORAGE_KEY, safe);
  else sessionStorage.removeItem(STORAGE_KEY);
}

/** Pop the previously-stashed next-path (returns and clears). */
export function popStashedNextPath(): string | null {
  const v = sessionStorage.getItem(STORAGE_KEY);
  if (v) sessionStorage.removeItem(STORAGE_KEY);
  return safeNextPath(v);
}

/** Read `?next=` from a URL search string and return a validated path. */
export function readNextFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    return safeNextPath(params.get('next'));
  } catch {
    return null;
  }
}

/**
 * The auth door, carrying where the person is standing.
 *
 * Every call site that sent someone to sign up dropped this, so being asked
 * for an account meant losing the market, the season entry or the
 * half-finished setup you were asked about (owner direction 2026-08-24).
 * Pass `window.location` (or a router location) and they come back.
 */
export function authPath(door: 'login' | 'signup', loc: { pathname: string; search?: string; hash?: string }): string {
  const here = `${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`;
  const safe = safeNextPath(here);
  // The doors themselves are not somewhere to come back to.
  if (!safe || safe.startsWith('/login') || safe.startsWith('/signup')) return `/${door}`;
  return `/${door}?next=${encodeURIComponent(safe)}`;
}

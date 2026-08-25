/**
 * CORS and BetterAuth trusted origins — derived only from env (no hostname assumptions).
 * Same code path for self-hosted Docker, Firebase, Cloud Run, or any reverse proxy.
 */

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v === '' ? undefined : v;
}

/** Comma-separated list → de-duplicated origins. */
export function parseOriginList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/** True when ALLOWED_ORIGIN is unset, empty, or "*". */
export function corsAllowAll(): boolean {
  const o = process.env.ALLOWED_ORIGIN?.trim();
  return o === undefined || o === '' || o === '*';
}

/**
 * Exact browser origins when CORS is restricted (comma-separated ALLOWED_ORIGIN).
 */
export function corsExplicitOrigins(): string[] {
  if (corsAllowAll()) return [];
  return parseOriginList(process.env.ALLOWED_ORIGIN?.trim());
}

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function mergedRestrictedOrigins(): string[] {
  return [...new Set([...corsExplicitOrigins(), ...parseOriginList(trimEnv('TRUSTED_ORIGINS'))])];
}

/**
 * CORS allow callback. Missing Origin (non-browser / same-origin tooling) is allowed.
 */
export function originAllowedForCors(origin: string | undefined): boolean {
  if (!origin) return true;
  if (corsAllowAll()) return true;
  const allowed = new Set(mergedRestrictedOrigins());
  if (allowed.has(origin)) return true;
  if (trimEnv('ALLOW_LOCALHOST_CORS') === '1' && LOCALHOST_ORIGIN.test(origin)) return true;
  return false;
}

/**
 * BetterAuth trustedOrigins — must cover every browser origin that calls /api/auth/*.
 */
export function betterAuthTrustedOrigins(): string[] {
  if (corsAllowAll()) return ['*'];
  const merged = mergedRestrictedOrigins();
  if (merged.length === 0) {
    throw new Error(
      'ALLOWED_ORIGIN is not * but parses to no origins. Use comma-separated HTTPS origins or set TRUSTED_ORIGINS.',
    );
  }
  return merged;
}

/**
 * The origins that ARE the published site, as opposed to a beta or a preview.
 * ALLOWED_ORIGIN alone, deliberately: TRUSTED_ORIGINS exists to let the beta
 * authenticate, and treating it as "public" here would hand the beta the
 * indexable status this is meant to withhold.
 */
export function publicOrigins(): string[] {
  return corsExplicitOrigins();
}

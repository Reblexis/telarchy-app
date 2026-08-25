/**
 * The beta has to be able to authenticate, and must not be indexable.
 *
 * Both were found by trying to use it (2026-08-20). Signing in on the
 * candidate revision answered `403 INVALID_ORIGIN`, because BetterAuth trusts
 * only what ALLOWED_ORIGIN names, so nobody could log in on the beta, so
 * nobody saw the Publish button, so nothing could ever be published from it.
 * TRUSTED_ORIGINS is the supported way to add an origin without calling it
 * the public site.
 *
 * A cookie-less curl does NOT reproduce the failure: better-auth only runs the
 * origin check on a request that carries credentials. That is why this is a
 * unit test on the origin lists rather than a request test that would pass for
 * the wrong reason.
 */

import { betterAuthTrustedOrigins, originAllowedForCors, publicOrigins } from '../lib/origins';

const PUBLIC = 'https://telarchy.com';
const BETA = 'https://candidate---api-ksc7usrtbq-uc.a.run.app';

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    fn();
  } finally {
    process.env = saved;
  }
};

describe('the beta can authenticate', () => {
  test('without TRUSTED_ORIGINS the beta origin is not trusted, which is the bug', () => {
    withEnv({ ALLOWED_ORIGIN: PUBLIC, TRUSTED_ORIGINS: undefined }, () => {
      expect(betterAuthTrustedOrigins()).toEqual([PUBLIC]);
      expect(betterAuthTrustedOrigins()).not.toContain(BETA);
    });
  });

  test('with it, both the site and the beta are trusted', () => {
    withEnv({ ALLOWED_ORIGIN: PUBLIC, TRUSTED_ORIGINS: BETA }, () => {
      const trusted = betterAuthTrustedOrigins();
      expect(trusted).toContain(PUBLIC);
      expect(trusted).toContain(BETA);
    });
  });

  test('the beta is allowed by CORS too, for the same reason', () => {
    withEnv({ ALLOWED_ORIGIN: PUBLIC, TRUSTED_ORIGINS: BETA }, () => {
      expect(originAllowedForCors(BETA)).toBe(true);
      expect(originAllowedForCors('https://example.com')).toBe(false);
    });
  });
});

describe('the beta is not the published site', () => {
  test('trusting it for auth does not make it public', () => {
    withEnv({ ALLOWED_ORIGIN: PUBLIC, TRUSTED_ORIGINS: BETA }, () => {
      // publicOrigins drives X-Robots-Tag: a second indexable copy of the app
      // on production data would split every link and could show strangers an
      // unpublished build.
      expect(publicOrigins()).toEqual([PUBLIC]);
      expect(publicOrigins()).not.toContain(BETA);
    });
  });
});

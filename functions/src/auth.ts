import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { randomBytes } from 'crypto';
import { authDb } from './db/client';
import * as schema from './db/schema';
import { betterAuthTrustedOrigins } from './lib/origins';

// Auto-generate BETTER_AUTH_SECRET if not set (self-hosted convenience).
// Sessions signed with a generated secret are invalidated on every restart
// until the secret is persisted. Print a clear warning.
if (!process.env.BETTER_AUTH_SECRET?.trim()) {
  const generated = randomBytes(32).toString('hex');
  process.env.BETTER_AUTH_SECRET = generated;
  console.warn(
    '\n[WARN] BETTER_AUTH_SECRET is not set. A temporary secret has been generated:\n' +
      `       ${generated}\n` +
      '       All sessions will be invalidated on every restart until you persist this.\n' +
      '       Add BETTER_AUTH_SECRET=<value> to your environment configuration.\n',
  );
}

/**
 * Public origin of this app as seen by the browser (scheme + host, no path).
 * Required for correct OAuth redirect_uri behind proxies / serverless unless the
 * platform sets forwarded URL headers Better Auth can trust.
 */
const publicAuthBaseURL = process.env.BETTER_AUTH_URL?.trim() || undefined;

/**
 * Optional registrable domain for auth cookies, e.g. ".example.com" when users hit
 * both apex and www so OAuth state cookies survive the callback host.
 */
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();

import { isValidSourceSlug, sourceFromCookieHeader } from './lib/attribution';

export const auth = betterAuth({
  ...(publicAuthBaseURL ? { baseURL: publicAuthBaseURL } : {}),
  ...(authCookieDomain
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: authCookieDomain,
          },
        },
      }
    : {}),
  // authDb, never the swapping `db`: a session belongs to the person, not to
  // the store a request happens to be reading (see db/client.ts). Changing
  // this to `db` makes everyone signed in on the beta look anonymous to the
  // API, which is a bug that only shows up on the beta.
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
    },
  }),
  // Attribution (open-source release, 2026-08-24): `source` is the `?ref=` slug
  // the landing stored in the ta_ref cookie. Email signups send it in the body
  // (SignupPage); OAuth signups never call signUp.email, so the create hook reads
  // the cookie from the request instead. better-auth ^1.5: hooks receive
  // (user, ctx) with ctx.request / ctx.headers on the endpoint context.
  user: {
    additionalFields: {
      source: { type: 'string', required: false, input: true },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const given = (user as { source?: unknown }).source;
          if (typeof given === 'string' && isValidSourceSlug(given)) return { data: { ...user, source: given } };
          const cookie = ctx?.headers?.get?.('cookie') ?? ctx?.request?.headers?.get?.('cookie') ?? '';
          const fromCookie = sourceFromCookieHeader(cookie);
          return { data: { ...user, source: fromCookie } };
        },
      },
    },
  },
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  trustedOrigins: betterAuthTrustedOrigins(),
  basePath: '/api/auth',
});

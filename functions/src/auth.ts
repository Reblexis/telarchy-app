import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/client';
import * as schema from './db/schema';
import { betterAuthTrustedOrigins } from './lib/origins';

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
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
    },
  }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    } : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    } : {}),
  },
  trustedOrigins: betterAuthTrustedOrigins(),
  basePath: '/api/auth',
});

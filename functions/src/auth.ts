import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/client';
import * as schema from './db/schema';

/** Public site origin for OAuth redirect_uri (Cloud Run otherwise uses *.run.app). */
const explicitBaseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.GCLOUD_PROJECT === 'telarchy-e0043' ? 'https://telarchy.com' : undefined);

/** OAuth callback is apex; www-only cookies are not sent → state_mismatch without shared domain. */
const telarchySharedCookieDomain =
  process.env.GCLOUD_PROJECT === 'telarchy-e0043' ||
  (process.env.BETTER_AUTH_URL ?? '').includes('telarchy.com');

export const auth = betterAuth({
  ...(explicitBaseURL ? { baseURL: explicitBaseURL } : {}),
  ...(telarchySharedCookieDomain
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: '.telarchy.com',
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
  trustedOrigins: process.env.ALLOWED_ORIGIN === '*'
    ? ['*']
    : [
      process.env.ALLOWED_ORIGIN ?? '',
      'https://telarchy.com',
      'https://www.telarchy.com',
      'http://localhost:5173',
      'http://localhost:4173',
    ].filter(Boolean),
  basePath: '/api/auth',
});

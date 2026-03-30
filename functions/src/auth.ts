import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/client';
import * as schema from './db/schema';

export const auth = betterAuth({
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
    ...(process.env.GOOGLE_CLIENT_ID ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    } : {}),
    ...(process.env.GITHUB_CLIENT_ID ? {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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

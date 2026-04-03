/**
 * Firebase Cloud Functions entry point (managed telarchy.com platform).
 * For self-hosted deployments, use server.ts instead.
 *
 * Scheduled jobs are handled via HTTP cron endpoints (/api/cron/resolve,
 * /api/cron/refresh) in self-hosted mode. These onSchedule exports serve
 * the same purpose on Firebase.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { app } from './app';
import { assertTreasuryConfigured } from './lib/usdc';
import { runBootstrap } from './lib/bootstrap';

const SECRETS = ['TREASURY_PRIVATE_KEY', 'DATABASE_URL', 'BETTER_AUTH_SECRET'];
/**
 * OAuth — Secret Manager names must match env vars used in auth.ts.
 * Google: required for telarchy.com social login. Add GitHub secrets to the project
 * and append 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET' here when you want GitHub.
 */
const OAUTH_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

// Run bootstrap exactly once per instance (idempotent — no-op after first boot).
let bootstrapPromise: Promise<void> | null = null;
function ensureBootstrapped(): Promise<void> {
  if (!bootstrapPromise) bootstrapPromise = runBootstrap();
  return bootstrapPromise;
}

export const api = onRequest({ minInstances: 1, secrets: [...SECRETS, ...OAUTH_SECRETS] }, async (req, res) => {
  assertTreasuryConfigured();
  await ensureBootstrapped();
  return app(req, res);
});

export const dailyResolve = onSchedule({ schedule: 'every day 00:00', secrets: SECRETS }, async () => {
  const { resolvePredictions } = await import('./services/predictions');
  const { cleanupOldEvents } = await import('./services/events');
  const result = await resolvePredictions(undefined, 'default');
  const cleaned = await cleanupOldEvents('default');
  console.log('Daily prediction resolution:', result, 'Events cleaned:', cleaned);
});

export const dailyMarketRefresh = onSchedule({ schedule: 'every day 00:10', secrets: SECRETS }, async () => {
  const { refreshRelativeDateMarkets } = await import('./services/markets');
  const result = await refreshRelativeDateMarkets('default');
  console.log('Daily market refresh:', result);
});

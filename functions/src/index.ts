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

export const api = onRequest({ minInstances: 1, secrets: ['TREASURY_PRIVATE_KEY'] }, (req, res) => {
  assertTreasuryConfigured();
  return app(req, res);
});

export const dailyResolve = onSchedule('every day 00:00', async () => {
  const { resolvePredictions } = await import('./services/predictions');
  const { cleanupOldEvents } = await import('./services/events');
  const result = await resolvePredictions(undefined, 'default');
  const cleaned = await cleanupOldEvents('default');
  console.log('Daily prediction resolution:', result, 'Events cleaned:', cleaned);
});

export const dailyMarketRefresh = onSchedule('every day 00:10', async () => {
  const { refreshRelativeDateMarkets } = await import('./services/markets');
  const result = await refreshRelativeDateMarkets('default');
  console.log('Daily market refresh:', result);
});

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { app } from './app';

// If DATA_SERVICE_ACCOUNT is set (base64-encoded service account JSON),
// use it as the credential — allows hosting on a different project than the data.
const serviceAccountEnv = process.env.DATA_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(Buffer.from(serviceAccountEnv, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp();
}

export const api = onRequest({ minInstances: 1, secrets: ['TREASURY_PRIVATE_KEY'] }, app);

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

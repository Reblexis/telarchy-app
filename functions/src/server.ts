/**
 * Standalone server entry point - runs the same Express app on any platform
 * (Docker, Railway, Fly.io, Cloud Run, bare VPS, etc.).
 *
 * Required env vars:
 *   DATABASE_URL   - PostgreSQL connection string
 *                    e.g. postgresql://user:password@localhost:5432/telarchy
 *   API_KEY        - master API key (keep secret)
 *   TREASURY_PRIVATE_KEY - Base treasury wallet private key for the backed economy
 *
 * Optional env vars:
 *   PORT                - HTTP port (default 8080)
 *   ALLOWED_ORIGIN      - unset, empty, or "*" = any origin; else comma-separated exact origins (CORS + BetterAuth)
 *   TRUSTED_ORIGINS     - optional comma-separated extra origins (merged with ALLOWED_ORIGIN for CORS and BetterAuth)
 *   BETTER_AUTH_URL     - public site origin (https://your-host) for OAuth redirects behind proxies
 *   AUTH_COOKIE_DOMAIN  - e.g. ".example.com" so apex + www share auth cookies (optional)
 *   ALLOW_LOCALHOST_CORS - "1" to allow localhost/127.0.0.1 when ALLOWED_ORIGIN is restricted (local dev)
 *   INITIAL_ADMIN_EMAIL    - admin email created on first boot (default: admin@localhost)
 *   INITIAL_ADMIN_PASSWORD - admin password on first boot (auto-generated + printed if not set)
 *   GOOGLE_CLIENT_ID    - Google OAuth client ID (for social sign-in)
 *   GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID    - GitHub OAuth client ID (for social sign-in)
 *   GITHUB_CLIENT_SECRET
 *
 * Quick start:
 *   npm run build
 *   DATABASE_URL=postgresql://... API_KEY=my-secret node lib/server.js
 */

import path from 'path';
import fs from 'fs';
import express from 'express';
import { assertTreasuryConfigured } from './lib/usdc';
import { runBootstrap } from './lib/bootstrap';

/** Schedule a daily job at a fixed UTC time. Fires once at the next occurrence, then every 24 h. */
function scheduleDailyUTC(hourUTC: number, minuteUTC: number, label: string, fn: () => Promise<void>): void {
  function msUntilNext(): number {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0, 0));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }
  const tick = () => fn().catch(e => console.error(`Scheduled job "${label}" failed:`, e));
  const arm = () => setTimeout(() => { tick(); setInterval(tick, 24 * 60 * 60 * 1000); }, msUntilNext());
  arm();
  console.log(`Scheduled "${label}" daily at ${String(hourUTC).padStart(2, '0')}:${String(minuteUTC).padStart(2, '0')} UTC`);
}

async function runDailyResolve(): Promise<void> {
  const { resolvePredictions } = await import('./services/predictions');
  const { cleanupOldEvents } = await import('./services/events');
  const { db } = await import('./db/client');
  const { workspaces } = await import('./db/schema');
  const wsIds = (await db.select({ id: workspaces.id }).from(workspaces)).map((r: { id: string }) => r.id);
  for (const wsId of wsIds) {
    const result = await resolvePredictions(undefined, wsId);
    const cleaned = await cleanupOldEvents(wsId);
    console.log(`Daily resolve [${wsId}]:`, result, 'events cleaned:', cleaned);
  }
}

async function runDailyRefresh(): Promise<void> {
  const { refreshRelativeDateMarkets } = await import('./services/markets');
  const { db } = await import('./db/client');
  const { workspaces } = await import('./db/schema');
  const wsIds = (await db.select({ id: workspaces.id }).from(workspaces)).map((r: { id: string }) => r.id);
  for (const wsId of wsIds) {
    const result = await refreshRelativeDateMarkets(wsId);
    console.log(`Daily market refresh [${wsId}]:`, result);
  }
}

import('./app').then(async ({ app }) => {
  assertTreasuryConfigured();
  await runBootstrap();

  scheduleDailyUTC(0, 0, 'dailyResolve', runDailyResolve);
  scheduleDailyUTC(0, 10, 'dailyMarketRefresh', runDailyRefresh);

  // Serve frontend static files when bundled in self-hosted mode
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // SPA fallback: serve index.html for all non-API routes
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(publicDir, 'index.html'));
      }
    });
  }

  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => {
    console.log(`Telarchy server listening on port ${port}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

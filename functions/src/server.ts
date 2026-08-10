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

import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import express from 'express';

// Overlay machine-local overrides from .env.local (ignored by git).
// Matches the Next.js / Vite convention: .env is shared defaults, .env.local
// is per-machine secrets (DATABASE_URL pointing at a proxy port, treasury key
// for the dev chain, persisted BETTER_AUTH_SECRET so sessions survive restarts).
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}
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

function scheduleEvery(intervalMs: number, label: string, fn: () => Promise<void>): void {
  const tick = () => fn().catch(e => console.error(`Scheduled job "${label}" failed:`, e));
  setInterval(tick, intervalMs);
  console.log(`Scheduled "${label}" every ${Math.round(intervalMs / 60000)} min`);
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

  // Catch-up: resolve any markets whose target date passed while the server was down.
  runDailyResolve().catch(e => console.error('Startup catch-up resolve failed:', e));
  runDailyRefresh().catch(e => console.error('Startup catch-up refresh failed:', e));

  // Resolve frequently so markets settle close to their resolvesOn instant
  // (hourly markets exist now; settlement value is pinned as-of resolvesOn,
  // so running often only reduces payout latency, never changes results).
  scheduleEvery(10 * 60_000, 'resolve', runDailyResolve);
  scheduleDailyUTC(0, 10, 'dailyMarketRefresh', runDailyRefresh);

  // Serve frontend static files when bundled in self-hosted mode
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    // Cache policy (root cause of every "I deployed but still see the old
    // UI" report, 2026-08-10): the HTML shell must ALWAYS revalidate
    // (no-cache + the ETag makes that a 304 when nothing changed), because
    // it is the pointer to the hashed bundles; without an explicit header,
    // browsers heuristically cache it and serve stale bundles for hours.
    // The hashed assets themselves are immutable by construction and cache
    // for a year.
    app.use(express.static(publicDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    // SPA fallback: serve index.html for all non-API routes. The exclusion
    // checks for `/api/` (with trailing slash) so SPA routes whose path
    // happens to begin with the literal characters "/api" (e.g.
    // `/api-access`) still fall through to the SPA. The Express API router
    // mounts on `/api` and only matches when the next char is `/` or the
    // path is exactly `/api`, matching this boundary.
    app.get('*', async (req, res) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) return;
      const indexPath = path.join(publicDir, 'index.html');
      // Workspace share links get their own unfurl card: link scrapers do not
      // run JavaScript, so the workspace name/description must be in the HTML
      // the server sends. Any failure falls back to the plain SPA shell.
      // Single-segment paths that are app routes, never workspace slugs. A
      // slug colliding with one of these is unreachable by design (creation
      // is admin-only; do not name a workspace after an app route).
      const RESERVED = new Set([
        'login', 'signup', 'waitlist', 'claim', 'welcome', 'agent-login',
        'terms', 'privacy', 'agent', 'manage', 'marketplace', 'leaderboard',
        'benchmark', 'guides', 'tutorials', 'start', 'create-workspace',
        'admin', 'agents', 'account', 'api-access', 'overview', 'metrics',
        'markets', 'proposals', 'sources', 'activity', 'settings', 'check-in',
        'participants',
      ]);
      const rootMatch = req.path.match(/^\/([^/.]+)$/);
      const shareMatch = req.path.match(/^\/marketplace\/([^/]+)$/)
        ?? (rootMatch && !RESERVED.has(rootMatch[1]) ? rootMatch : null);
      if (shareMatch) {
        try {
          const { resolvePublicWorkspace } = await import('./routes/marketplace');
          const ws = await resolvePublicWorkspace(decodeURIComponent(shareMatch[1]));
          if (ws && ws.visibility !== 'private') {
            const { injectWorkspaceMeta } = await import('./lib/share-meta');
            const html = fs.readFileSync(indexPath, 'utf8');
            res.setHeader('Cache-Control', 'no-cache');
            res.type('html').send(injectWorkspaceMeta(
              html, ws, `https://telarchy.com${req.path}`,
              `https://telarchy.com/api/marketplace/${encodeURIComponent(shareMatch[1])}/card.png`,
            ));
            return;
          }
        } catch (e) {
          console.error('share-meta injection failed:', e);
        }
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
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

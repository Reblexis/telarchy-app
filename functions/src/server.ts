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

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// One .env for the whole repo, at the repository root (.env.example documents
// it). The backend is usually started from functions/, so look one level up as
// well as in the working directory; the first that exists wins.
for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

import express from 'express';

// Overlay machine-local overrides from .env.local (ignored by git).
// Matches the Next.js / Vite convention: .env is shared defaults, .env.local
// is per-machine secrets (DATABASE_URL pointing at a proxy port, treasury key
// for the dev chain, persisted BETTER_AUTH_SECRET so sessions survive restarts).
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { BETA_PREFIX, isBetaPath } from './lib/beta-surface';
import { runBootstrap } from './lib/bootstrap';
import { publicOrigin } from './lib/origin';
import { assertTreasuryConfigured } from './lib/usdc';
import { shouldLogVisit } from './lib/visit-log';

/** Schedule a daily job at a fixed UTC time. Fires once at the next occurrence, then every 24 h. */
function scheduleDailyUTC(hourUTC: number, minuteUTC: number, label: string, fn: () => Promise<void>): void {
  function msUntilNext(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0, 0),
    );
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }
  const tick = () => fn().catch(e => console.error(`Scheduled job "${label}" failed:`, e));
  const arm = () =>
    setTimeout(() => {
      tick();
      setInterval(tick, 24 * 60 * 60 * 1000);
    }, msUntilNext());
  arm();
  console.log(
    `Scheduled "${label}" daily at ${String(hourUTC).padStart(2, '0')}:${String(minuteUTC).padStart(2, '0')} UTC`,
  );
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

import('./app')
  .then(async ({ app }) => {
    // The treasury key is only needed when real-money settlement is on; a
    // play-money instance must boot without one (.env.example).
    if (process.env.USDC_SETTLEMENT_ENABLED === 'true') assertTreasuryConfigured();
    await runBootstrap();

    // Dynamic on purpose, like every db-touching import in this file: static
    // imports hoist above the .env.local overlay at the top and would capture
    // DATABASE_URL before the overlay ran.
    const { withSingletonLock } = await import('./lib/singleton-jobs');

    /**
     * Every instance arms every timer below, and Cloud Run runs up to 4
     * instances of prod plus 4 of the candidate. The advisory lock elects one
     * winner per tick; the rest skip (lib/singleton-jobs.ts). Before this the
     * limit sweep ran up to 8x every 12 seconds, all doing identical work.
     */
    const singleton = (name: Parameters<typeof withSingletonLock>[0], fn: () => Promise<void>) => async () => {
      await withSingletonLock(name, fn);
    };

    // The visit logger's dependencies, loaded once per boot instead of once per
    // request (geoip-lite parses its whole IP dataset on first import; inside a
    // request that made some visitor's page view pay for it). Still dynamic for
    // the same .env.local reason as above.
    const visitDeps = Promise.all([
      import('./db/client'),
      import('./db/schema'),
      import('crypto'),
      import('geoip-lite'),
    ]).then(([client, schema, crypto, geo]) => ({
      db: client.db,
      pageVisits: schema.pageVisits,
      randomUUID: crypto.randomUUID,
      geoip: geo.default,
    }));

    // Catch-up: resolve any markets whose target date passed while the server was down.
    singleton('startupCatchUp', async () => {
      await runDailyResolve();
      await runDailyRefresh();
    })().catch(e => console.error('Startup catch-up failed:', e));

    // Resolve frequently so markets settle close to their resolvesOn instant
    // (hourly markets exist now; settlement value is pinned as-of resolvesOn,
    // so running often only reduces payout latency, never changes results).
    scheduleEvery(10 * 60_000, 'resolve', singleton('resolve', runDailyResolve));
    // Sweep resting limit orders often so a crossed order fills promptly
    // even without a fresh trade to trigger it (owner report 2026-08-11).
    scheduleEvery(
      12_000,
      'limitSweep',
      singleton('limitSweep', async () => {
        const { sweepLimitOrders } = await import('./services/trading');
        const r = await sweepLimitOrders();
        if (r.fills > 0) console.log('Limit sweep:', r);
      }),
    );
    scheduleDailyUTC(0, 10, 'dailyMarketRefresh', singleton('dailyMarketRefresh', runDailyRefresh));
    // Data hygiene: visit-log retention, question IP scrub, trace retention
    // (services/maintenance.ts). Used to run on admin read paths or never.
    scheduleDailyUTC(
      0,
      20,
      'dailyMaintenance',
      singleton('dailyMaintenance', async () => {
        const { runDailyMaintenance } = await import('./services/maintenance');
        console.log('Daily maintenance:', await runDailyMaintenance());
      }),
    );

    /**
     * The beta surface, on this domain (owner ask 2026-08-20). Order matters and
     * this block must come before the site's own static and SPA handlers, or
     * `/beta` is swallowed by the catch-all.
     *
     *  1. The revision serving telarchy.com forwards /beta/* to the candidate.
     *  2. Any revision with nothing to forward to serves its OWN beta bundle,
     *     so the URL is never a dead end and the run.app URL keeps working.
     *
     * See lib/beta-surface.ts for why this is a proxy rather than a redirect.
     */
    const publicBetaDir = path.join(__dirname, 'public-beta');
    if (fs.existsSync(publicBetaDir)) {
      app.use(
        BETA_PREFIX,
        express.static(publicBetaDir, {
          setHeaders: (res, filePath) => {
            res.setHeader('X-Robots-Tag', 'noindex, nofollow');
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
            else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        }),
      );
    }
    // The proxy itself lives in app.ts, before the prefix strip (order matters,
    // see the comment there). What is left here is the local fallback: this
    // build's own beta bundle, for when there is nothing to forward to.
    app.use((req, res, next) => {
      if (!isBetaPath(req.path)) return next();
      if (req.path === '/beta/api' || req.path.startsWith('/beta/api/')) return next();
      const betaIndex = path.join(publicBetaDir, 'index.html');
      if (fs.existsSync(betaIndex)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.sendFile(betaIndex);
        return;
      }
      next();
    });

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
      app.use(
        express.static(publicDir, {
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
              res.setHeader('Cache-Control', 'no-cache');
            } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        }),
      );
      // SPA fallback: serve index.html for all non-API routes. The exclusion
      // checks for `/api/` (with trailing slash) so SPA routes whose path
      // happens to begin with the literal characters "/api" (e.g.
      // `/api-access`) still fall through to the SPA. The Express API router
      // mounts on `/api` and only matches when the next char is `/` or the
      // path is exactly `/api`, matching this boundary.
      app.get('*', async (req, res) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) return;
        // Visitor log (owner ask 2026-08-11): one row per document load,
        // fire-and-forget so a slow insert never delays the page. Surfaced
        // on /admin; request-log data per the privacy policy, purged past
        // 30 days when the stats endpoint reads.
        // The owner's own cockpit is not a visitor (see lib/visit-log.ts).
        if (shouldLogVisit(req.path))
          (async () => {
            const { db, pageVisits, randomUUID, geoip } = await visitDeps;
            const fwd = String(req.headers['x-forwarded-for'] ?? '')
              .split(',')[0]
              .trim();
            const ip = (fwd || req.socket.remoteAddress || '').slice(0, 60) || null;
            // Offline IP -> country (no network call, ISO alpha-2), so the
            // launch cockpit can show where visitors come from without a
            // per-request geo API. Private/unknown IPs return null.
            const country = ip ? geoip.lookup(ip)?.country || null : null;
            await db.insert(pageVisits).values({
              id: randomUUID(),
              path: req.path.slice(0, 200),
              referer: String(req.headers.referer ?? '').slice(0, 300) || null,
              userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
              ip,
              country,
            });
          })().catch(e => console.error('visit log failed:', e));
        const indexPath = path.join(publicDir, 'index.html');
        // Workspace share links get their own unfurl card: link scrapers do not
        // run JavaScript, so the workspace name/description must be in the HTML
        // the server sends. Any failure falls back to the plain SPA shell.
        // Single-segment paths that are app routes, never workspace slugs. A
        // slug colliding with one of these is unreachable by design (creation
        // is admin-only; do not name a workspace after an app route).
        const RESERVED = new Set([
          'local',
          'login',
          'signup',
          'waitlist',
          'claim',
          'welcome',
          'agent-login',
          'terms',
          'privacy',
          'agent',
          'manage',
          'marketplace',
          'leaderboard',
          'benchmark',
          'guides',
          'tutorials',
          'start',
          'create-workspace',
          'admin',
          'agents',
          'account',
          'api-access',
          'overview',
          'metrics',
          'markets',
          'proposals',
          'sources',
          'activity',
          'settings',
          'check-in',
          'participants',
          // The audience pages (docs/audience-pages.md); /compare/* is two segments and never matches a slug.
          'forecast',
          'for-agents',
          'owners',
        ]);
        // The audience pages carry their own title, description and FAQ
        // structured data in the head: they exist to be found from a search
        // or an AI answer, and neither reads the SPA.
        try {
          const { isAudienceRoute, injectAudienceMeta, isHeadRoute, injectRouteHead } = await import(
            './lib/audience-meta'
          );
          if (isAudienceRoute(req.path)) {
            const html = fs.readFileSync(indexPath, 'utf8');
            res.setHeader('Cache-Control', 'no-cache');
            res.type('html').send(injectAudienceMeta(html, req.path, `${publicOrigin()}${req.path}`));
            return;
          }
          // The app's own public doors get a per-route head the same way.
          if (isHeadRoute(req.path)) {
            const html = fs.readFileSync(indexPath, 'utf8');
            res.setHeader('Cache-Control', 'no-cache');
            res.type('html').send(injectRouteHead(html, req.path, `${publicOrigin()}${req.path}`));
            return;
          }
        } catch (e) {
          console.error('audience-meta injection failed:', e);
        }
        const rootMatch = req.path.match(/^\/([^/.]+)$/);
        const shareMatch =
          req.path.match(/^\/marketplace\/([^/]+)$/) ?? (rootMatch && !RESERVED.has(rootMatch[1]) ? rootMatch : null);
        if (shareMatch) {
          try {
            const { resolvePublicWorkspace } = await import('./routes/marketplace');
            const ws = await resolvePublicWorkspace(decodeURIComponent(shareMatch[1]));
            if (ws && ws.visibility !== 'private') {
              const { injectWorkspaceMeta } = await import('./lib/share-meta');
              const html = fs.readFileSync(indexPath, 'utf8');
              res.setHeader('Cache-Control', 'no-cache');
              res
                .type('html')
                .send(
                  injectWorkspaceMeta(
                    html,
                    ws,
                    `${publicOrigin()}${req.path}`,
                    `${publicOrigin()}/api/marketplace/${encodeURIComponent(shareMatch[1])}/card.png`,
                  ),
                );
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
  })
  .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

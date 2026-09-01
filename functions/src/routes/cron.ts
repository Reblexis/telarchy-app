/**
 * HTTP cron endpoints for self-hosted deployments.
 *
 * On standalone/Docker deployments, call these endpoints from any scheduler:
 *   curl -X POST https://your-server/api/cron/resolve \
 *     -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{}'
 *
 * Auth: X-API-Key only (no X-Workspace-Id required; these are platform-wide).
 * Body: { workspaceId?: string } - if omitted, runs for all workspaces.
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../db/client';
import { workspaces } from '../db/schema';
import { isMasterKey, masterKeyConfigured } from '../lib/master-key';
import { wrap } from '../lib/wrap';

export const cronRouter = Router();

function validateApiKey(req: Request, res: Response): boolean {
  const key = req.headers['x-api-key'] as string | undefined;
  if (!key || !masterKeyConfigured()) {
    res.status(401).json({ error: 'X-API-Key required' });
    return false;
  }
  if (!isMasterKey(key)) {
    res.status(401).json({ error: 'Invalid API key' });
    return false;
  }
  return true;
}

async function allWorkspaceIds(): Promise<string[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  return rows.map(r => r.id);
}

/**
 * Report any season whose published start instant has passed. Starts none.
 *
 * Between 2026-08-20 and 2026-09-01 this started them, because a start is the
 * one step in a season's life that can silently not happen: nothing errors,
 * nothing alerts, the page keeps saying "starts in", and the baselines are
 * taken whenever somebody notices.
 *
 * Owner decision 2026-09-01: "dont autostart season 1 we will start that
 * manually as needed." Pinning baselines and freezing a workspace set is the
 * moment a season becomes real money. The old risk is answered by keeping this
 * endpoint and having it LOG what is waiting, so a season nobody has started
 * is on the record rather than invisible. Starting one is
 * POST /api/seasons/:id/start.
 */
cronRouter.post(
  '/seasons',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;
    const { startDueSeasons } = await import('../services/seasons');
    const result = await startDueSeasons();
    // Logged unconditionally, including the empty case: a scheduler job that
    // stopped firing is invisible unless the quiet runs are on the record too.
    console.log('[cron/seasons]', JSON.stringify(result));
    res.json({ ok: true, ...result });
  }),
);

/**
 * Record Telarchy's own numbers as a reading on its own floor.
 *
 * Hourly on the managed instance (docs/infra/deploy.md, "Cron schedule"); a
 * no-op on any instance that has not set SELF_SYNC_WORKSPACE_ID, which is
 * every self-hosted one. Idempotent in the sense that matters: a second call
 * in the same hour records a second honest reading, it does not double
 * anything.
 */
cronRouter.post(
  '/self-sync',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;

    const { syncSelfMetrics } = await import('../services/self-sync');
    const result = await syncSelfMetrics();
    // Logged unconditionally, the empty case included: a scheduler job that
    // stopped firing is invisible unless the quiet runs are on the record too,
    // which is exactly how the previous sync went daily without anyone seeing.
    console.log('[cron/self-sync]', JSON.stringify(result));
    res.json({ ok: true, ...result });
  }),
);

cronRouter.post(
  '/resolve',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;

    const { resolvePredictions } = await import('../services/predictions');
    const { cleanupOldEvents } = await import('../services/events');
    const { snapshotAgentBalances } = await import('../services/balances');
    const { withSingletonLock } = await import('../lib/singleton-jobs');

    // The same lock the in-process timer holds. This door held none, so the
    // scheduler's pass and the container's own pass did the work together
    // (bug hunt 2026-08-31); "both are idempotent" in docs/infra/deploy.md
    // was true sequentially and not concurrently. `skipped` is a normal
    // answer, not an error: it means another pass has it.
    const results: Array<Record<string, unknown>> = [];
    let balanceSnapshots = 0;
    const ran = await withSingletonLock('resolve', async () => {
      const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
      for (const wsId of wsIds) {
        const resolved = await resolvePredictions(req.body?.targetDate as string | undefined, wsId);
        const cleaned = await cleanupOldEvents(wsId);
        results.push({ workspaceId: wsId, ...resolved, eventsCleaned: cleaned });
      }

      // Platform-wide (not per-workspace): one balance snapshot per
      // participant per UTC day, taken on the first hourly run of the day.
      // Powers the balance graph on public profiles.
      balanceSnapshots = await snapshotAgentBalances();
    });

    res.json({ ok: true, lock: ran, balanceSnapshots, workspaces: results });
  }),
);

cronRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;

    const { refreshRelativeDateMarkets } = await import('../services/markets');
    const { withSingletonLock } = await import('../lib/singleton-jobs');

    // Same reasoning as /resolve above: this door shares its work with the
    // in-process dailyMarketRefresh timer and with startupCatchUp.
    const results: Array<Record<string, unknown>> = [];
    const ran = await withSingletonLock('dailyMarketRefresh', async () => {
      const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
      for (const wsId of wsIds) {
        const result = await refreshRelativeDateMarkets(wsId);
        results.push({ workspaceId: wsId, ...result });
      }
    });

    res.json({ ok: true, lock: ran, workspaces: results });
  }),
);

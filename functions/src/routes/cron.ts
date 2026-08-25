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
 * Start any season whose published start instant has passed.
 *
 * A season used to start only when a human called POST /api/seasons/:id/start
 * at the right minute (owner direction 2026-08-20: "make it automatic"). That
 * is the one step in a season's life that can silently not happen: nothing
 * errors, nothing alerts, the page keeps saying "starts in", and the baselines
 * are taken whenever somebody notices.
 *
 * Safe to call as often as you like. It only ever moves a DRAFT whose startsAt
 * has passed, so a double call is a no-op and an early call does nothing.
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

cronRouter.post(
  '/resolve',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;

    const { resolvePredictions } = await import('../services/predictions');
    const { cleanupOldEvents } = await import('../services/events');
    const { snapshotAgentBalances } = await import('../services/balances');

    const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
    const results = [];
    for (const wsId of wsIds) {
      const resolved = await resolvePredictions(req.body?.targetDate as string | undefined, wsId);
      const cleaned = await cleanupOldEvents(wsId);
      results.push({ workspaceId: wsId, ...resolved, eventsCleaned: cleaned });
    }

    // Platform-wide (not per-workspace): one balance snapshot per participant
    // per UTC day, taken on the first hourly run of the day. Powers the
    // balance graph on public profiles.
    const balanceSnapshots = await snapshotAgentBalances();

    res.json({ ok: true, balanceSnapshots, workspaces: results });
  }),
);

cronRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    if (!validateApiKey(req, res)) return;

    const { refreshRelativeDateMarkets } = await import('../services/markets');

    const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
    const results = [];
    for (const wsId of wsIds) {
      const result = await refreshRelativeDateMarkets(wsId);
      results.push({ workspaceId: wsId, ...result });
    }

    res.json({ ok: true, workspaces: results });
  }),
);

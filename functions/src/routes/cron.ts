/**
 * HTTP cron endpoints for self-hosted deployments.
 *
 * On standalone/Docker deployments, call these endpoints from any scheduler:
 *   curl -X POST https://your-server/api/cron/resolve \
 *     -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{}'
 *
 * Auth: X-API-Key only (no X-Workspace-Id required — these are platform-wide).
 * Body: { workspaceId?: string } — if omitted, runs for all workspaces.
 */

import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { db } from '../db/client';
import { workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import type { Request, Response } from 'express';

export const cronRouter = Router();

function validateApiKey(req: Request, res: Response): boolean {
  const key = req.headers['x-api-key'] as string | undefined;
  const master = process.env.API_KEY;
  if (!key || !master) { res.status(401).json({ error: 'X-API-Key required' }); return false; }
  try {
    if (!timingSafeEqual(Buffer.from(key), Buffer.from(master))) {
      res.status(401).json({ error: 'Invalid API key' }); return false;
    }
  } catch {
    res.status(401).json({ error: 'Invalid API key' }); return false;
  }
  return true;
}

async function allWorkspaceIds(): Promise<string[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  return rows.map(r => r.id);
}

cronRouter.post('/resolve', wrap(async (req, res) => {
  if (!validateApiKey(req, res)) return;

  const { resolvePredictions } = await import('../services/predictions');
  const { cleanupOldEvents } = await import('../services/events');

  const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
  const results = [];
  for (const wsId of wsIds) {
    const resolved = await resolvePredictions(req.body?.targetDate as string | undefined, wsId);
    const cleaned = await cleanupOldEvents(wsId);
    results.push({ workspaceId: wsId, ...resolved, eventsCleaned: cleaned });
  }

  res.json({ ok: true, workspaces: results });
}));

cronRouter.post('/refresh', wrap(async (req, res) => {
  if (!validateApiKey(req, res)) return;

  const { refreshRelativeDateMarkets } = await import('../services/markets');

  const wsIds = req.body?.workspaceId ? [req.body.workspaceId as string] : await allWorkspaceIds();
  const results = [];
  for (const wsId of wsIds) {
    const result = await refreshRelativeDateMarkets(wsId);
    results.push({ workspaceId: wsId, ...result });
  }

  res.json({ ok: true, workspaces: results });
}));

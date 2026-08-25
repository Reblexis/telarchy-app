import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { hookWatcher } from '../db/schema';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireCapability } from '../middleware/roles';
import { getEventsSince } from '../services/events';

export const eventsRouter = Router();

eventsRouter.get(
  '/',
  authMiddleware,
  requireCapability('read'),
  wrap(async (req, res) => {
    const since = req.query.since as string;
    if (!since) {
      res.status(400).json({ error: 'since query parameter is required (ISO timestamp)' });
      return;
    }
    const { workspaceId } = req.auth!;
    res.json(await getEventsSince(since, workspaceId));
  }),
);

eventsRouter.post(
  '/hooks/heartbeat',
  authMiddleware,
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { lastPolledAt, intervalMs } = req.body;
    await db
      .insert(hookWatcher)
      .values({
        workspaceId,
        lastHeartbeat: lastPolledAt ? new Date(lastPolledAt) : new Date(),
        status: JSON.stringify({ intervalMs: intervalMs || 60000 }),
      })
      .onConflictDoUpdate({
        target: hookWatcher.workspaceId,
        set: {
          lastHeartbeat: lastPolledAt ? new Date(lastPolledAt) : new Date(),
          status: JSON.stringify({ intervalMs: intervalMs || 60000 }),
        },
      });
    res.json({ ok: true });
  }),
);

eventsRouter.get(
  '/hooks/status',
  authMiddleware,
  wrap(async (req, res) => {
    const workspaceId = req.auth!.workspaceId;
    const [row] = await db.select().from(hookWatcher).where(eq(hookWatcher.workspaceId, workspaceId));
    if (!row?.lastHeartbeat) {
      res.json({ active: false });
      return;
    }

    let statusData: { intervalMs?: number } = {};
    if (row.status) {
      try {
        statusData = JSON.parse(row.status);
      } catch {
        console.error('hookWatcher: malformed status JSON', row.status);
      }
    }
    const intervalMs = statusData.intervalMs || 60000;
    const lastPolledAt = row.lastHeartbeat.toISOString();
    const ageMs = Date.now() - row.lastHeartbeat.getTime();
    res.json({
      active: ageMs < intervalMs * 3,
      lastPolledAt,
      intervalMs,
      nextPollAt: new Date(row.lastHeartbeat.getTime() + intervalMs).toISOString(),
    });
  }),
);

import { Router } from 'express';
import { db } from '../db/client';
import { hookWatcher } from '../db/schema';
import { eq } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getEventsSince } from '../services/events';

export const eventsRouter = Router();

eventsRouter.get('/', authMiddleware, requireRole('agent', 'admin'), wrap(async (req, res) => {
  const since = req.query.since as string;
  if (!since) { res.status(400).json({ error: 'since query parameter is required (ISO timestamp)' }); return; }
  const { workspaceId } = req.auth!;
  res.json(await getEventsSince(since, workspaceId));
}));

eventsRouter.post('/hooks/heartbeat', authMiddleware, requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { lastPolledAt, intervalMs } = req.body;
  await db.insert(hookWatcher)
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
}));

eventsRouter.get('/hooks/status', wrap(async (req, res) => {
  const workspaceId = (req.headers['x-workspace-id'] as string) || 'default';
  const [row] = await db.select().from(hookWatcher).where(eq(hookWatcher.workspaceId, workspaceId));
  if (!row?.lastHeartbeat) { res.json({ active: false }); return; }

  const statusData = row.status ? JSON.parse(row.status) : {};
  const intervalMs = statusData.intervalMs || 60000;
  const lastPolledAt = row.lastHeartbeat.toISOString();
  const ageMs = Date.now() - row.lastHeartbeat.getTime();
  res.json({
    active: ageMs < intervalMs * 3,
    lastPolledAt,
    intervalMs,
    nextPollAt: new Date(row.lastHeartbeat.getTime() + intervalMs).toISOString(),
  });
}));

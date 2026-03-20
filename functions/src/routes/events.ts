import { Router } from 'express';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getEventsSince } from '../services/events';

export const eventsRouter = Router();

const WATCHER_DOC = 'hookWatcher';

// Events feed — agent/admin
eventsRouter.get('/', authMiddleware, requireRole('agent', 'admin'), wrap(async (req, res) => {
  const since = req.query.since as string;
  if (!since) { res.status(400).json({ error: 'since query parameter is required (ISO timestamp)' }); return; }
  const { workspaceId } = req.auth!;
  res.json(await getEventsSince(since, workspaceId));
}));

// Watcher heartbeat — agent/admin (called by the local watcher script)
eventsRouter.post('/hooks/heartbeat', authMiddleware, requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { lastPolledAt, intervalMs } = req.body;
  await db().collection('system').doc(WATCHER_DOC).set({
    lastPolledAt: lastPolledAt || new Date().toISOString(),
    intervalMs: intervalMs || 60000,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  res.json({ ok: true });
}));

// Watcher status — public (for the UI timer)
eventsRouter.get('/hooks/status', wrap(async (_req, res) => {
  const doc = await db().collection('system').doc(WATCHER_DOC).get();
  if (!doc.exists) { res.json({ active: false }); return; }
  const d = doc.data()!;
  const lastPolledAt = d.lastPolledAt;
  const intervalMs = d.intervalMs || 60000;
  const ageMs = Date.now() - new Date(lastPolledAt).getTime();
  res.json({
    active: ageMs < intervalMs * 3,
    lastPolledAt,
    intervalMs,
    nextPollAt: new Date(new Date(lastPolledAt).getTime() + intervalMs).toISOString(),
  });
}));

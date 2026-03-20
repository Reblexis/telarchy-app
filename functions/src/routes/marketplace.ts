import { Router } from 'express';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { consensus, pHigher } from '../lib/amm';

export const marketplaceRouter = Router();

/**
 * GET /api/marketplace
 * Returns active, open markets from all public workspaces.
 * No authentication required — this is the public discovery endpoint.
 */
marketplaceRouter.get('/', wrap(async (req, res) => {
  const limit = typeof req.query.limit === 'string'
    ? Math.min(parseInt(req.query.limit, 10), 100)
    : 50;

  const wsSnap = await db().collection('workspaces')
    .where('visibility', '==', 'public')
    .get();

  if (wsSnap.empty) { res.json([]); return; }

  const allMarkets: Array<Record<string, unknown>> = [];

  await Promise.all(wsSnap.docs.map(async wsDoc => {
    const ws = wsDoc.data();
    const marketSnap = await wsCol(wsDoc.id, 'markets')
      .where('resolved', '==', false)
      .where('active', '==', true)
      .get();

    for (const mDoc of marketSnap.docs) {
      const m = mDoc.data();
      if (m.taskId) continue; // skip conditional markets
      const shares: [number, number] = m.shares || [0, 0];
      allMarkets.push({
        workspaceId: wsDoc.id,
        workspaceName: ws.name,
        marketId: mDoc.id,
        metricName: m.metricName,
        targetDate: m.targetDate,
        consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
        probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
        liquidity: m.liquidity,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      });
    }
  }));

  // Sort by liquidity descending so most active markets appear first
  allMarkets.sort((a, b) => (b.liquidity as number) - (a.liquidity as number));
  res.json(allMarkets.slice(0, limit));
}));

/**
 * GET /api/marketplace/:workspaceId
 * Returns workspace metadata + its active markets (public workspaces only).
 */
marketplaceRouter.get('/:workspaceId', wrap(async (req, res) => {
  const { workspaceId } = req.params as { workspaceId: string };
  const wsDoc = await db().collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const ws = wsDoc.data()!;
  if (ws.visibility === 'private') {
    res.status(403).json({ error: 'This workspace is private' }); return;
  }

  const marketSnap = await wsCol(workspaceId, 'markets')
    .where('resolved', '==', false)
    .where('active', '==', true)
    .orderBy('targetDate', 'asc')
    .get();

  const markets = marketSnap.docs
    .filter(d => !d.data().taskId)
    .map(d => {
      const m = d.data();
      const shares: [number, number] = m.shares || [0, 0];
      return {
        marketId: d.id,
        metricName: m.metricName,
        targetDate: m.targetDate,
        consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
        probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
        liquidity: m.liquidity,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      };
    });

  res.json({
    workspaceId,
    name: ws.name,
    visibility: ws.visibility,
    markets,
  });
}));

/**
 * GET /api/marketplace/list
 * Returns all workspaces with visibility public or unlisted that the user can discover.
 * Unlisted workspaces are findable by direct link but not listed here.
 */
marketplaceRouter.get('/workspaces/public', wrap(async (req, res) => {
  const wsSnap = await db().collection('workspaces')
    .where('visibility', '==', 'public')
    .get();

  res.json(wsSnap.docs.map(d => ({
    workspaceId: d.id,
    name: d.data().name,
    visibility: d.data().visibility,
  })));
}));

/**
 * POST /api/marketplace/:workspaceId/join
 * Join a public or unlisted workspace as a trader (requires auth).
 */
marketplaceRouter.post('/:workspaceId/join', authMiddleware, requireRole('admin'), wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required to join a workspace' }); return; }

  const { workspaceId } = req.params as { workspaceId: string };
  const wsDoc = await db().collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const ws = wsDoc.data()!;
  if (ws.visibility === 'private') {
    res.status(403).json({ error: 'This workspace is invite-only' }); return;
  }

  const userDoc = await db().collection('users').doc(uid).get();
  const existing = userDoc.data()?.workspaces?.[workspaceId];
  if (existing) {
    res.json({ ok: true, role: existing.role, alreadyMember: true }); return;
  }

  await db().collection('users').doc(uid).set({
    workspaces: { [workspaceId]: { role: 'trader', joinedAt: new Date() } },
  }, { merge: true });

  res.status(201).json({ ok: true, workspaceId, role: 'trader' });
}));

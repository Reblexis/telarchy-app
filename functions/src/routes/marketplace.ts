import { Router } from 'express';
import { db } from '../db/client';
import { workspaces, markets, agents, trades, userWorkspaces, permissionGroups } from '../db/schema';
import { eq, and, gt, count } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireIdentity } from '../middleware/roles';
import { consensus, pHigher } from '../lib/amm';
import { endOfPeriod } from '../lib/date-utils';
import { ensureSystemGroups } from './groups';

export const marketplaceRouter = Router();

function includesId(ids: unknown, id: string | undefined): boolean {
  if (!id) return false;
  return ((ids as string[]) ?? []).includes(id);
}

function getWorkspaceRole(groups: Array<typeof permissionGroups.$inferSelect>, uid?: string, agentId?: string): 'admin' | 'trader' | null {
  const adminGroup = groups.find(group => group.type === 'admin');
  if (adminGroup && (includesId(adminGroup.uids, uid) || includesId(adminGroup.agentIds, agentId))) {
    return 'admin';
  }
  const hasTraderMembership = groups.some(group =>
    includesId(group.uids, uid) || includesId(group.agentIds, agentId),
  );
  return hasTraderMembership ? 'trader' : null;
}

marketplaceRouter.get('/', wrap(async (req, res) => {
  const limit = typeof req.query.limit === 'string'
    ? Math.min(parseInt(req.query.limit, 10), 100)
    : 50;

  const publicWs = await db.select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.visibility, 'public'));

  if (publicWs.length === 0) { res.json([]); return; }

  const allMarkets: Array<Record<string, unknown>> = [];

  await Promise.all(publicWs.map(async ws => {
    const wsMarkets = await db.select().from(markets)
      .where(and(
        eq(markets.workspaceId, ws.id),
        eq(markets.resolved, false),
        eq(markets.active, true),
      ));

    for (const m of wsMarkets) {
      if (m.taskId) continue;
      const shares = (m.shares as [number, number]) || [0, 0];
      allMarkets.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        marketId: m.id,
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

  allMarkets.sort((a, b) => {
    const dateDiff = endOfPeriod(a.targetDate as string).localeCompare(endOfPeriod(b.targetDate as string));
    if (dateDiff !== 0) return dateDiff;
    return (b.liquidity as number) - (a.liquidity as number);
  });
  res.json(allMarkets.slice(0, limit));
}));

marketplaceRouter.get('/stats', wrap(async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allWs = await db.select({ id: workspaces.id }).from(workspaces);

  const [agentCount] = await db.select({ count: count() }).from(agents).where(eq(agents.role, 'agent'));

  let marketsActive = 0;
  let tradesThisWeek = 0;

  await Promise.all(allWs.map(async ws => {
    const [mCount, tCount] = await Promise.all([
      db.select({ count: count() }).from(markets)
        .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true)))
        .then(r => r[0]?.count ?? 0),
      db.select({ count: count() }).from(trades)
        .where(and(eq(trades.workspaceId, ws.id), gt(trades.createdAt, weekAgo)))
        .then(r => r[0]?.count ?? 0),
    ]);
    marketsActive += Number(mCount);
    tradesThisWeek += Number(tCount);
  }));

  res.json({ marketsActive, agentsActive: Number(agentCount.count), tradesThisWeek });
}));

marketplaceRouter.get('/workspaces/public', wrap(async (_req, res) => {
  const rows = await db.select({ id: workspaces.id, name: workspaces.name, visibility: workspaces.visibility })
    .from(workspaces)
    .where(eq(workspaces.visibility, 'public'));
  res.json(rows.map(r => ({ workspaceId: r.id, name: r.name, visibility: r.visibility })));
}));

marketplaceRouter.get('/:workspaceId', wrap(async (req, res) => {
  const { workspaceId } = req.params as { workspaceId: string };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }

  const wsMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false), eq(markets.active, true)));

  const marketList = wsMarkets.filter(m => !m.taskId).map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    return {
      marketId: m.id,
      metricName: m.metricName,
      targetDate: m.targetDate,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      liquidity: m.liquidity,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
    };
  });

  marketList.sort((a, b) => {
    const dateDiff = endOfPeriod(a.targetDate).localeCompare(endOfPeriod(b.targetDate));
    if (dateDiff !== 0) return dateDiff;
    return b.liquidity - a.liquidity;
  });

  res.json({ workspaceId, name: ws.name, visibility: ws.visibility, markets: marketList });
}));

marketplaceRouter.post('/:workspaceId/join', authMiddleware, requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const { workspaceId } = req.params as { workspaceId: string };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is invite-only' }); return; }

  await ensureSystemGroups(workspaceId);
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const publicGroup = groups.find(group => group.type === 'public');
  if (!publicGroup) {
    res.status(500).json({ error: 'Workspace public group is missing' }); return;
  }

  const [existingMembership] = uid
    ? await db.select().from(userWorkspaces)
        .where(and(eq(userWorkspaces.userId, uid), eq(userWorkspaces.workspaceId, workspaceId)))
    : [];

  const publicUids = (publicGroup.uids as string[]) ?? [];
  const publicAgentIds = (publicGroup.agentIds as string[]) ?? [];
  const nextUids = uid && !publicUids.includes(uid) ? [...publicUids, uid] : publicUids;
  const nextAgentIds = agentId && !publicAgentIds.includes(agentId) ? [...publicAgentIds, agentId] : publicAgentIds;
  const alreadyMember = getWorkspaceRole(groups, uid, agentId) !== null || Boolean(existingMembership);

  await db.transaction(async tx => {
    if (uid && !existingMembership) {
      await tx.insert(userWorkspaces).values({ userId: uid, workspaceId, role: 'trader', joinedAt: new Date() });
    }
    if (nextUids !== publicUids || nextAgentIds !== publicAgentIds) {
      await tx.update(permissionGroups)
        .set({ uids: nextUids, agentIds: nextAgentIds })
        .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, workspaceId)));
    }
  });

  const refreshedGroups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const role = existingMembership?.role ?? getWorkspaceRole(refreshedGroups, uid, agentId) ?? 'trader';
  res.status(alreadyMember ? 200 : 201).json({ ok: true, workspaceId, role, alreadyMember });
}));

import { Router } from 'express';
import { db } from '../db/client';
import { workspaces, markets, agents, trades, permissionGroups, proposals } from '../db/schema';
import { eq, and, gt, gte, count, inArray, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireIdentity } from '../middleware/roles';
import { consensus, pHigher } from '../lib/amm';
import { endOfPeriod } from '../lib/date-utils';
import { ensureSystemGroups } from './groups';
import { getGroupMemberIds } from '../lib/participants';

export const marketplaceRouter = Router();

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
      if (m.proposalId) continue;
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

  // Sort within-workspace by soonest target date, then by liquidity, then
  // round-robin across workspaces so one prolific workspace doesn't dominate
  // the public marketplace list. Anonymous visitors should see breadth.
  allMarkets.sort((a, b) => {
    const dateDiff = endOfPeriod(a.targetDate as string).localeCompare(endOfPeriod(b.targetDate as string));
    if (dateDiff !== 0) return dateDiff;
    return (b.liquidity as number) - (a.liquidity as number);
  });
  const byWs: Map<string, Array<Record<string, unknown>>> = new Map();
  for (const m of allMarkets) {
    const wsId = m.workspaceId as string;
    if (!byWs.has(wsId)) byWs.set(wsId, []);
    byWs.get(wsId)!.push(m);
  }
  const interleaved: Array<Record<string, unknown>> = [];
  let added = true;
  while (added && interleaved.length < limit) {
    added = false;
    for (const list of byWs.values()) {
      if (list.length === 0) continue;
      interleaved.push(list.shift()!);
      added = true;
      if (interleaved.length >= limit) break;
    }
  }
  res.json(interleaved);
}));

marketplaceRouter.get('/stats', wrap(async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allWs = await db.select({ id: workspaces.id }).from(workspaces);

  const [agentCount] = await db.select({ count: count() }).from(agents);

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
  const rows = await db.select({
    id: workspaces.id,
    name: workspaces.name,
    visibility: workspaces.visibility,
    proposalReward: workspaces.proposalReward,
    spamPenalty: workspaces.spamPenalty,
    maxPendingProposalsPerParticipant: workspaces.maxPendingProposalsPerParticipant,
  }).from(workspaces).where(eq(workspaces.visibility, 'public'));

  if (rows.length === 0) { res.json([]); return; }

  const wsIds = rows.map(r => r.id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const statRows = await db.select({
    workspaceId: proposals.workspaceId,
    status: proposals.status,
    n: sql<number>`count(*)::int`,
  }).from(proposals)
    .where(and(inArray(proposals.workspaceId, wsIds), gte(proposals.createdAt, since)))
    .groupBy(proposals.workspaceId, proposals.status);

  const statsByWs = new Map<string, { total: number; approved: number; declined: number; declinedSpam: number; withdrawn: number; pending: number }>();
  for (const id of wsIds) {
    statsByWs.set(id, { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 });
  }
  for (const row of statRows) {
    const s = statsByWs.get(row.workspaceId);
    if (!s) continue;
    s.total += row.n;
    if (row.status === 'approved') s.approved += row.n;
    else if (row.status === 'declined') s.declined += row.n;
    else if (row.status === 'declined_spam') s.declinedSpam += row.n;
    else if (row.status === 'withdrawn') s.withdrawn += row.n;
    else if (row.status === 'pending') s.pending += row.n;
  }

  res.json(rows.map(r => ({
    workspaceId: r.id,
    name: r.name,
    visibility: r.visibility,
    proposalReward: r.proposalReward,
    spamPenalty: r.spamPenalty,
    maxPendingProposalsPerParticipant: r.maxPendingProposalsPerParticipant,
    proposalStats: statsByWs.get(r.id)!,
  })));
}));

marketplaceRouter.get('/:workspaceId', wrap(async (req, res) => {
  const { workspaceId } = req.params as { workspaceId: string };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }

  const wsMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false), eq(markets.active, true)));

  const marketList = wsMarkets.filter(m => !m.proposalId).map(m => {
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

  await ensureSystemGroups(workspaceId);
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const publicGroup = groups.find(group => group.type === 'public');
  if (!publicGroup) {
    res.status(500).json({ error: 'Workspace public group is missing' }); return;
  }

  const participantId = agentId ?? uid;
  if (!participantId) { res.status(400).json({ error: 'No participant identity' }); return; }

  const publicMemberIds = getGroupMemberIds(publicGroup);
  const alreadyMember = publicMemberIds.includes(participantId);

  if (!alreadyMember) {
    await db.update(permissionGroups)
      .set({ memberIds: [...publicMemberIds, participantId] })
      .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, workspaceId)));
  }

  const publicCaps = (publicGroup.capabilities as string[] | null) ?? [];
  const role = publicCaps.includes('trade') ? 'trader' : 'viewer';

  res.status(alreadyMember ? 200 : 201).json({
    ok: true,
    workspaceId,
    workspaceName: ws.name,
    role,
    alreadyMember,
  });
}));

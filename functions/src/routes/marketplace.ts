import { Router } from 'express';
import { db } from '../db/client';
import { workspaces, markets, metrics, metricLogs, agents, trades, permissionGroups, proposals } from '../db/schema';
import { eq, and, gt, gte, count, desc, inArray, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireIdentity } from '../middleware/roles';
import { consensus, pHigher } from '../lib/amm';
import { replayMarketTradePoints } from '../services/predictions';
import { periodEndInstant, resolutionInstant } from '../lib/date-utils';
import { ensureSystemGroups } from './groups';
import { getGroupMemberIds, getOwnerHandles, getParticipantDisplayNames } from '../lib/participants';
import { SIGNUP_CREDITS } from '../lib/validation';

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
        resolvesOn: resolutionInstant(m.targetDate),
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
    const dateDiff = periodEndInstant(a.targetDate as string).getTime() - periodEndInstant(b.targetDate as string).getTime();
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

/**
 * Public featured-markets list for the /benchmark surface. Returns only
 * featured + active + unresolved markets that live in public-visibility
 * workspaces, matching the privacy contract of the rest of /api/marketplace
 * (anything inside a private workspace stays private). Anonymous-readable.
 */
marketplaceRouter.get('/featured', wrap(async (_req, res) => {
  const publicWs = await db.select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces).where(eq(workspaces.visibility, 'public'));
  if (publicWs.length === 0) { res.json([]); return; }
  const wsById = new Map(publicWs.map(w => [w.id, w.name]));

  const rows = await db.select().from(markets).where(and(
    inArray(markets.workspaceId, publicWs.map(w => w.id)),
    eq(markets.featured, true),
    eq(markets.resolved, false),
    eq(markets.active, true),
    eq(markets.voided, false),
  ));

  const out = rows.filter(m => !m.proposalId).map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    return {
      workspaceId: m.workspaceId,
      workspaceName: wsById.get(m.workspaceId) ?? m.workspaceId,
      marketId: m.id,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      liquidity: m.liquidity,
      tradedVolume: m.tradedVolume,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
    };
  });

  out.sort((a, b) => {
    const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
    if (dateDiff !== 0) return dateDiff;
    return b.liquidity - a.liquidity;
  });

  res.json(out);
}));

marketplaceRouter.get('/workspaces/public', wrap(async (_req, res) => {
  const rows = await db.select({
    id: workspaces.id,
    name: workspaces.name,
    slug: workspaces.slug,
    createdBy: workspaces.createdBy,
    description: workspaces.description,
    visibility: workspaces.visibility,
    proposalReward: workspaces.proposalReward,
    spamPenalty: workspaces.spamPenalty,
    maxPendingProposalsPerParticipant: workspaces.maxPendingProposalsPerParticipant,
  }).from(workspaces).where(eq(workspaces.visibility, 'public'));

  if (rows.length === 0) { res.json([]); return; }

  const ownerHandles = await getOwnerHandles(rows.map(r => r.createdBy));

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

  // Activity counts so an agent can tell empty workspaces from active ones in
  // one call, before joining. metricCount = metrics defined; openMarketCount =
  // markets still tradeable (active, not resolved/voided).
  const metricRows = await db.select({
    workspaceId: metrics.workspaceId,
    n: sql<number>`count(*)::int`,
  }).from(metrics)
    .where(inArray(metrics.workspaceId, wsIds))
    .groupBy(metrics.workspaceId);
  const metricCountByWs = new Map<string, number>(metricRows.map(r => [r.workspaceId, r.n]));

  const openMarketRows = await db.select({
    workspaceId: markets.workspaceId,
    n: sql<number>`count(*)::int`,
  }).from(markets)
    .where(and(
      inArray(markets.workspaceId, wsIds),
      eq(markets.active, true),
      eq(markets.resolved, false),
      eq(markets.voided, false),
    ))
    .groupBy(markets.workspaceId);
  const openMarketCountByWs = new Map<string, number>(openMarketRows.map(r => [r.workspaceId, r.n]));

  res.json(rows.map(r => ({
    workspaceId: r.id,
    name: r.name,
    slug: r.slug,
    ownerId: ownerHandles.get(r.createdBy)?.ownerId ?? null,
    ownerHandle: ownerHandles.get(r.createdBy)?.ownerHandle ?? null,
    description: r.description,
    visibility: r.visibility,
    proposalReward: r.proposalReward,
    spamPenalty: r.spamPenalty,
    maxPendingProposalsPerParticipant: r.maxPendingProposalsPerParticipant,
    metricCount: metricCountByWs.get(r.id) ?? 0,
    openMarketCount: openMarketCountByWs.get(r.id) ?? 0,
    proposalStats: statsByWs.get(r.id)!,
  })));
}));

/**
 * Resolve a share-link segment to a non-private workspace: by id first, then
 * by slug among public/unlisted workspaces. The slug form exists because the
 * share link is the product's front door and a UUID in it reads as machinery;
 * `telarchy.com/marketplace/lookpilot` is what an owner actually posts. Slugs
 * are unique per owner, not globally, so an ambiguous slug (two public
 * workspaces, different owners, same slug) resolves to none rather than to
 * whichever the query returned first.
 */
export async function resolvePublicWorkspace(idOrSlug: string) {
  const [byId] = await db.select().from(workspaces).where(eq(workspaces.id, idOrSlug));
  if (byId) return byId;
  const bySlug = await db.select().from(workspaces)
    .where(and(
      sql`lower(${workspaces.slug}) = lower(${idOrSlug})`,
      inArray(workspaces.visibility, ['public', 'unlisted']),
    ));
  return bySlug.length === 1 ? bySlug[0] : undefined;
}

marketplaceRouter.get('/:workspaceId', wrap(async (req, res) => {
  const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }
  const workspaceId = ws.id;

  const wsMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false), eq(markets.active, true)));

  const marketList = wsMarkets.filter(m => !m.proposalId).map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    return {
      marketId: m.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      liquidity: m.liquidity,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
    };
  });

  marketList.sort((a, b) => {
    const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
    if (dateDiff !== 0) return dateDiff;
    return b.liquidity - a.liquidity;
  });

  // Everything below is what a logged-out stranger sees when they open a shared
  // workspace link. It deliberately stops short of anything a member sees:
  // metric names and market consensus are public (they already were), but
  // logged metric values, proposal text, and chat still require the `read`
  // capability, i.e. membership. Counts, not contents.
  const [owner] = [...(await getOwnerHandles([ws.createdBy])).values()];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const proposalRows = await db.select({ status: proposals.status, n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(and(eq(proposals.workspaceId, workspaceId), gte(proposals.createdAt, since)))
    .groupBy(proposals.status);
  const proposalStats = { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 };
  for (const row of proposalRows) {
    proposalStats.total += row.n;
    if (row.status === 'approved') proposalStats.approved += row.n;
    else if (row.status === 'declined') proposalStats.declined += row.n;
    else if (row.status === 'declined_spam') proposalStats.declinedSpam += row.n;
    else if (row.status === 'withdrawn') proposalStats.withdrawn += row.n;
    else if (row.status === 'pending') proposalStats.pending += row.n;
  }

  const [metricCountRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(metrics).where(eq(metrics.workspaceId, workspaceId));

  // Distinct participants across every group, so the page can say whether
  // anyone is actually here. Identities stay unlisted; this is a count only.
  const groupRows = await db.select({ memberIds: permissionGroups.memberIds })
    .from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const participantIds = new Set<string>();
  for (const g of groupRows) for (const id of getGroupMemberIds(g)) participantIds.add(id);

  // What a visitor gets if they press join, so the CTA can be honest about it
  // rather than promising trading rights the Public group does not hold.
  const publicGroup = groupRows.length
    ? (await db.select().from(permissionGroups)
        .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public'))))[0]
    : undefined;
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];

  // The ballot. When the Public group grants `read`, workspace contents are one
  // free self-join away from any visitor, so hiding proposals behind signup is
  // friction theater, not privacy. Show them: pending proposals with their
  // conditional-market deltas (the thing a visitor is being invited to price)
  // and recent decisions with their published decline reasons (the owner's
  // charter accountability on display). Workspaces whose Public group lacks
  // `read` keep the counts-only boundary.
  let openProposals: Array<Record<string, unknown>> | undefined;
  let decidedProposals: Array<Record<string, unknown>> | undefined;
  // Trader context, same Open-workspace disclosure rule as the ballot: the
  // hero metric's logged history (what a forecaster prices against), its
  // description (the owner's provenance statement: where the number comes
  // from), and a simple activity pulse. Without these the page asks people
  // to bet on a number with no evidence, which serious forecasters refuse.
  let heroHistory: Array<{ at: Date | null; value: number }> | undefined;
  let heroMetricDescription: string | null | undefined;
  let tradesThisWeek: number | undefined;
  let marketHistory: Array<{ at: Date; consensus: number | null }> | undefined;
  if (publicCaps.includes('read')) {
    const heroMarketId = marketList[0]?.marketId as string | undefined;
    if (heroMarketId) {
      const points = await replayMarketTradePoints(heroMarketId, workspaceId);
      marketHistory = points.slice(-500).map(pt => ({ at: pt.createdAt, consensus: pt.consensus }));
    }
    const heroMetricId = marketList[0]?.metricId as string | undefined;
    if (heroMetricId) {
      const [metricRow] = await db.select({ description: metrics.description })
        .from(metrics).where(and(eq(metrics.workspaceId, workspaceId), eq(metrics.id, heroMetricId)));
      heroMetricDescription = metricRow?.description ?? null;
      const logs = await db.select({ at: metricLogs.timestamp, value: metricLogs.value })
        .from(metricLogs)
        .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, heroMetricId)))
        .orderBy(desc(metricLogs.timestamp))
        .limit(90);
      heroHistory = logs.reverse();
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [tradeCount] = await db.select({ n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(eq(trades.workspaceId, workspaceId), gte(trades.createdAt, weekAgo)));
    tradesThisWeek = tradeCount?.n ?? 0;
  }
  if (publicCaps.includes('read')) {
    const pending = await db.select().from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), eq(proposals.status, 'pending')))
      .orderBy(desc(proposals.createdAt))
      .limit(20);
    const names = await getParticipantDisplayNames(pending.map(p => p.proposedBy));

    const pendingIds = pending.map(p => p.id);
    const branchMarkets = pendingIds.length
      ? await db.select().from(markets)
          .where(and(
            eq(markets.workspaceId, workspaceId),
            inArray(markets.proposalId, pendingIds),
            eq(markets.active, true),
            eq(markets.resolved, false),
            eq(markets.voided, false),
          ))
      : [];
    // Group per proposal x (metric, targetDate); the delta a visitor reads is
    // approved consensus minus declined consensus, the causal impact of saying
    // yes. tradeCount would need the trades table; presence of both branch
    // prices is enough for the public page.
    const byProposal = new Map<string, Map<string, { metricName: string; targetDate: string; approved: number | null; declined: number | null }>>();
    for (const m of branchMarkets) {
      if (!m.proposalId || !m.branch) continue;
      const shares = (m.shares as [number, number]) || [0, 0];
      const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null;
      const groups = byProposal.get(m.proposalId) ?? new Map();
      const key = `${m.metricId}|${m.targetDate}`;
      const g = groups.get(key) ?? { metricName: m.metricName, targetDate: m.targetDate, approved: null, declined: null };
      if (m.branch === 'approved') g.approved = c; else if (m.branch === 'declined') g.declined = c;
      groups.set(key, g);
      byProposal.set(m.proposalId, groups);
    }

    openProposals = pending.map(p => {
      const pairs = [...(byProposal.get(p.id)?.values() ?? [])].map(g => ({
        metricName: g.metricName,
        targetDate: g.targetDate,
        approvedConsensus: g.approved,
        declinedConsensus: g.declined,
        delta: g.approved != null && g.declined != null ? g.approved - g.declined : null,
      }));
      // A many-metric workspace spawns a pair per metric x horizon; the public
      // page reads only the headline, so ship the largest-impact few and the
      // total count instead of the whole matrix.
      pairs.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        proposedByName: names.get(p.proposedBy) ?? null,
        createdAt: p.createdAt,
        marketPairCount: pairs.length,
        markets: pairs.slice(0, 3),
      };
    });

    const decided = await db.select().from(proposals)
      .where(and(
        eq(proposals.workspaceId, workspaceId),
        inArray(proposals.status, ['approved', 'declined']),
      ))
      .orderBy(desc(proposals.resolvedAt))
      .limit(10);
    decidedProposals = decided.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      resolvedAt: p.resolvedAt,
      declineReason: p.declineReason,
    }));
  }

  res.json({
    workspaceId,
    name: ws.name,
    slug: ws.slug,
    ownerId: owner?.ownerId ?? null,
    // Equal to ownerId when the owner never set a nickname. Callers should not
    // print a raw 32-char participant id as if it were a name; compare the two.
    ownerHandle: owner?.ownerHandle ?? null,
    description: ws.description,
    charter: ws.charter,
    visibility: ws.visibility,
    proposalReward: ws.proposalReward,
    spamPenalty: ws.spamPenalty,
    joinAs: publicCaps.includes('trade') ? 'trader' : 'viewer',
    // The manipulation bound, surfaced so the page can state the fairness rule
    // ("no account can put more than N credits into one market") instead of
    // asking visitors to take it on faith. 0 = no cap.
    maxPositionCostPerMarket: ws.maxPositionCostPerMarket,
    signupCredits: SIGNUP_CREDITS,
    metricCount: metricCountRow?.n ?? 0,
    openMarketCount: marketList.length,
    participantCount: participantIds.size,
    proposalStats,
    markets: marketList,
    ...(openProposals !== undefined ? {
      proposals: openProposals,
      decided: decidedProposals,
      heroHistory,
      heroMetricDescription,
      tradesThisWeek,
      marketHistory,
    } : {}),
  });
}));

marketplaceRouter.post('/:workspaceId/join', authMiddleware, requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const { workspaceId } = req.params as { workspaceId: string };
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  // Visibility is the access boundary, not knowledge of the UUID. A private
  // workspace is populated by an admin adding members; nobody self-joins it.
  // 404 rather than 403 so this cannot be used to probe for private IDs.
  if (ws.visibility === 'private') { res.status(404).json({ error: 'Workspace not found' }); return; }

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

import { Router } from 'express';
import { db } from '../db/client';
import { workspaces, markets, metrics, metricLogs, agents, trades, positions, permissionGroups, proposals, proposalMessages, marketMessages, systemConfig } from '../db/schema';
import { eq, ne, and, gt, gte, count, desc, asc, inArray, like, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireIdentity } from '../middleware/roles';
import { consensus, pHigher } from '../lib/amm';
import { replayMarketTradePoints } from '../services/predictions';
import { periodEndInstant, periodStartInstant, resolutionInstant } from '../lib/date-utils';
import { ensureSystemGroups } from './groups';
import { getGroupMemberIds, getOwnerHandles, getParticipantDisplayNames } from '../lib/participants';
import { SIGNUP_CREDITS } from '../lib/validation';
import { computeContractors, type ContractorEntry, type ContractorJobPair } from '../lib/contractors';

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

  // The hero metric of the Telarchy dogfooding workspace (2026-08-14):
  // distinct participants who (a) have a Manifold account synced (the
  // verified set: each maps to a public Manifold profile anyone can check,
  // surfaced on the leaderboard) and (b) placed trades totalling at least
  // 100 credits across the trailing 7 days (credits are free, so a costless
  // gesture must not count; abs(cost) so sells are activity too). It lives
  // on this public route for the same reason manifoldImportCount does: a
  // resolution source has to be readable by the people being asked to
  // trust it.
  const spendByAgent = await db.select({ id: trades.agentId, spend: sql<number>`sum(abs(${trades.cost}))` })
    .from(trades).where(gt(trades.createdAt, weekAgo)).groupBy(trades.agentId);
  const qualifying = spendByAgent.filter(r => Number(r.spend) >= 100).map(r => r.id);
  const claimedRows = qualifying.length > 0
    ? await db.select({ key: systemConfig.key }).from(systemConfig)
        .where(inArray(systemConfig.key, qualifying.map(id => `manifold-claimed:agent:${id}`)))
    : [];
  const weeklyActiveVerifiedTraders = claimedRows.length;

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

  // Platform-wide count of completed Manifold imports. It lives here, on the
  // global stats route, because it is a platform number rather than a property
  // of any one workspace, and because a public prediction market resolves
  // against this URL: a resolution source has to be readable by the people
  // being asked to trust it, without knowing a workspace id.
  const [manifoldRow] = await db.select({ n: count() }).from(systemConfig)
    .where(like(systemConfig.key, 'manifold-claimed:agent:%'));

  res.json({
    marketsActive,
    agentsActive: Number(agentCount.count),
    tradesThisWeek,
    weeklyActiveVerifiedTraders,
    manifoldImportCount: Number(manifoldRow?.n ?? 0),
  });
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
    .where(and(inArray(proposals.workspaceId, wsIds), gte(proposals.createdAt, since), ne(proposals.status, 'removed')))
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
    .where(and(eq(proposals.workspaceId, workspaceId), gte(proposals.createdAt, since), ne(proposals.status, 'removed')))
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
  // Top contractors: the other side of the economy from traders, ranked by
  // the market's live valuation of the jobs they posted (see lib/contractors).
  let topContractors: ContractorEntry[] | undefined;
  // Trader context, same Open-workspace disclosure rule as the ballot: the
  // hero metric's logged history (what a forecaster prices against), its
  // description (the owner's provenance statement: where the number comes
  // from), and a simple activity pulse. Without these the page asks people
  // to bet on a number with no evidence, which serious forecasters refuse.
  let heroHistory: Array<{ at: Date | null; value: number }> | undefined;
  let horizonHistories: Array<{
    marketId: string; metricName: string; targetDate: string;
    description: string | null; points: Array<{ at: Date | null; value: number }>;
  }> | undefined;
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
      // Up to a year of the hero metric's real values, so the floor's
      // year chart can show the actual trajectory (not just the last few
      // days). Cadence is at most a few pushes a day, so 500 covers it.
      const logs = await db.select({ at: metricLogs.timestamp, value: metricLogs.value })
        .from(metricLogs)
        .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, heroMetricId)))
        .orderBy(desc(metricLogs.timestamp))
        .limit(500);
      heroHistory = logs.reverse();
    }
    // Every open horizon's own metric history, so a two-clock workspace can
    // draw one actual-vs-forecast chart per horizon instead of only the
    // soonest one's (owner direction 2026-08-15). Keyed by marketId; the
    // hero's copy stays in heroHistory for consumers that predate this.
    horizonHistories = [];
    for (const m of marketList.slice(0, 4)) {
      const metricId = m.metricId as string;
      const rows = await db.select({ at: metricLogs.timestamp, value: metricLogs.value })
        .from(metricLogs)
        .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, metricId)))
        .orderBy(desc(metricLogs.timestamp))
        .limit(500);
      const [metricRow] = await db.select({ description: metrics.description })
        .from(metrics).where(and(eq(metrics.workspaceId, workspaceId), eq(metrics.id, metricId)));
      // Only readings from inside THIS horizon's own window are its
      // actual-so-far. A metric that resets every Monday accumulates a fresh
      // number each week, so last week's readings belong to last week's
      // market; plotting them made a week that had not started yet look like
      // it already stood at $887 and was heading down to the $213 the market
      // called (owner report 2026-08-16). A year horizon keeps everything it
      // had, because a year's window contains it.
      const from = periodStartInstant(m.targetDate as string).getTime();
      const to = periodEndInstant(m.targetDate as string).getTime();
      const inWindow = rows.filter(r => {
        const t = r.at ? new Date(r.at).getTime() : NaN;
        return Number.isFinite(t) && t >= from && t < to;
      });
      horizonHistories.push({
        marketId: m.marketId as string,
        metricName: m.metricName as string,
        targetDate: m.targetDate as string,
        description: metricRow?.description ?? null,
        points: inWindow.reverse(),
      });
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [tradeCount] = await db.select({ n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(eq(trades.workspaceId, workspaceId), gte(trades.createdAt, weekAgo)));
    tradesThisWeek = tradeCount?.n ?? 0;
  }
  if (publicCaps.includes('read')) {
    // All non-withdrawn jobs (pending + decided) in one list, so the board can
    // show status inline instead of a separate history. Decided jobs keep
    // their markets (resolved/voided included, not just active) so clicking one
    // still shows the impact that was priced for it.
    const pending = await db.select().from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), inArray(proposals.status, ['pending', 'approved', 'declined'])))
      .orderBy(desc(proposals.createdAt))
      .limit(40);
    const names = await getParticipantDisplayNames(pending.map(p => p.proposedBy));

    const pendingIds = pending.map(p => p.id);
    const branchMarkets = pendingIds.length
      ? await db.select().from(markets)
          .where(and(
            eq(markets.workspaceId, workspaceId),
            inArray(markets.proposalId, pendingIds),
          ))
      : [];
    // Group per proposal x (metric, targetDate); the delta a visitor reads is
    // approved consensus minus declined consensus, the causal impact of saying
    // yes. tradeCount would need the trades table; presence of both branch
    // prices is enough for the public page.
    // The pair ships enough for the page to make the conditional market the
    // main view when a job is selected: not just both consensus values, but
    // the approved branch's id and price shape, so the same chart and the
    // same ticket can render and trade it.
    interface PairGroup {
      metricName: string;
      targetDate: string;
      approved: number | null;
      declined: number | null;
      approvedMarketId: string | null;
      declinedMarketId: string | null;
      approvedProbability: number | null;
      approvedLiquidity: number | null;
      declinedProbability: number | null;
      declinedLiquidity: number | null;
      rangeMin: number;
      rangeMax: number;
    }
    const byProposal = new Map<string, Map<string, PairGroup>>();
    // A voided pair is dead weight on a PENDING contract: it was voided
    // because its horizon was retired, yet it kept printing its last delta
    // on the ballot (seen 2026-08-15, when the near horizon moved to a
    // weekly cadence and every contract still showed its old monthly
    // number). Decided contracts keep everything, voided included: their
    // markets are the record of what was priced when the owner ruled.
    const decidedIds = new Set(pending.filter(p => p.status !== 'pending').map(p => p.id));
    for (const m of branchMarkets) {
      if (!m.proposalId || !m.branch) continue;
      if (m.voided && !decidedIds.has(m.proposalId)) continue;
      const shares = (m.shares as [number, number]) || [0, 0];
      const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null;
      const groups = byProposal.get(m.proposalId) ?? new Map<string, PairGroup>();
      const key = `${m.metricId}|${m.targetDate}`;
      const g: PairGroup = groups.get(key) ?? {
        metricName: m.metricName,
        targetDate: m.targetDate,
        approved: null,
        declined: null,
        approvedMarketId: null,
        declinedMarketId: null,
        approvedProbability: null,
        approvedLiquidity: null,
        declinedProbability: null,
        declinedLiquidity: null,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      };
      if (m.branch === 'approved') {
        g.approved = c;
        g.approvedMarketId = m.id;
        // pHigher returns 0 (not undefined) at zero liquidity, and a fake
        // "0% probability" is worse than an honest null: the page falls
        // back to the baseline's shape for unpriced branches.
        g.approvedProbability = m.liquidity > 0 ? Math.round(pHigher(shares, m.liquidity) * 10000) / 10000 : null;
        g.approvedLiquidity = m.liquidity;
        g.rangeMin = m.rangeMin;
        g.rangeMax = m.rangeMax;
      } else if (m.branch === 'declined') {
        g.declined = c;
        g.declinedMarketId = m.id;
        g.declinedProbability = m.liquidity > 0 ? Math.round(pHigher(shares, m.liquidity) * 10000) / 10000 : null;
        g.declinedLiquidity = m.liquidity;
      }
      groups.set(key, g);
      byProposal.set(m.proposalId, groups);
    }

    openProposals = pending.map(p => {
      const pairs = [...(byProposal.get(p.id)?.values() ?? [])].map(g => ({
        metricName: g.metricName,
        targetDate: g.targetDate,
        resolvesOn: resolutionInstant(g.targetDate),
        approvedConsensus: g.approved,
        declinedConsensus: g.declined,
        delta: g.approved != null && g.declined != null ? g.approved - g.declined : null,
        approvedMarketId: g.approvedMarketId,
        declinedMarketId: g.declinedMarketId,
        approvedProbability: g.approvedProbability,
        approvedLiquidity: g.approvedLiquidity,
        declinedProbability: g.declinedProbability,
        declinedLiquidity: g.declinedLiquidity,
        rangeMin: g.rangeMin,
        rangeMax: g.rangeMax,
      }));
      // A many-metric workspace spawns a pair per metric x horizon; the public
      // page reads only the headline, so ship the largest-impact few and the
      // total count instead of the whole matrix.
      pairs.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        askUsd: p.askUsd ?? null,
        status: p.status,
        resolvedAt: p.resolvedAt,
        declineReason: p.declineReason,
        proposedByName: names.get(p.proposedBy) ?? null,
        // The linkable handle for the public profile page: prefer the
        // unique nickname, fall back to the raw participant id, which the
        // profile endpoint also resolves (owner ask 2026-08-11).
        proposedByHandle: p.proposedBy,
        createdAt: p.createdAt,
        marketPairCount: pairs.length,
        markets: pairs.slice(0, 3),
      };
    });
    // Pending jobs lead (the live ballot), decided ones follow (most recently
    // decided first): one list, ordered by where a job is in its life.
    openProposals.sort((a, b) => {
      const rank = (s: unknown) => (s === 'pending' ? 0 : 1);
      const ra = rank(a.status), rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      const at = new Date((a.resolvedAt as Date | null) ?? (a.createdAt as Date)).getTime();
      const bt = new Date((b.resolvedAt as Date | null) ?? (b.createdAt as Date)).getTime();
      return bt - at;
    });

    // Contractors rank on the market's CURRENT valuation of the jobs they
    // posted, not on dollars collected (owner direction 2026-08-14): a job
    // posted minutes ago counts the moment anyone prices it. Live jobs are
    // pending + approved; a declined job's forecast was about an action
    // nobody will take, so it scores nothing. Scored over every live job in
    // the workspace, not just the 40 the ballot ships.
    const liveJobs = await db.select({
      id: proposals.id,
      proposedBy: proposals.proposedBy,
      status: proposals.status,
      askUsd: proposals.askUsd,
    }).from(proposals).where(and(
      eq(proposals.workspaceId, workspaceId),
      inArray(proposals.status, ['pending', 'approved']),
    ));
    const liveJobIds = liveJobs.map(j => j.id);
    // Voided branch markets are kept for a DECIDED contract and dropped for a
    // pending one, the same rule the ballot follows.
    //
    // Approving a contract voids its declined branch, and that branch's last
    // price is exactly what the impact was measured against, so a decided
    // contract's score has to read it. A PENDING contract's voided pairs are
    // something else: a retired horizon, or a generation spawned during a
    // bug. Counting those made the contractor rail read -48 and -108.21 on
    // the Telarchy floor (owner report 2026-08-15) long after the live pairs
    // had been re-created at zero impact, because the largest-magnitude
    // horizon was a dead market nobody can trade.
    const liveJobMarkets = liveJobIds.length
      ? await db.select({
          proposalId: markets.proposalId,
          branch: markets.branch,
          metricId: markets.metricId,
          targetDate: markets.targetDate,
          shares: markets.shares,
          liquidity: markets.liquidity,
          rangeMin: markets.rangeMin,
          rangeMax: markets.rangeMax,
          voided: markets.voided,
        }).from(markets).where(and(
          eq(markets.workspaceId, workspaceId),
          inArray(markets.proposalId, liveJobIds),
        ))
      : [];
    const pendingJobIds = new Set(liveJobs.filter(j => j.status === 'pending').map(j => j.id));
    const pairsByJob = new Map<string, Map<string, ContractorJobPair>>();
    for (const m of liveJobMarkets) {
      if (!m.proposalId || !m.branch) continue;
      if (m.voided && pendingJobIds.has(m.proposalId)) continue;
      const c = consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null;
      const groups = pairsByJob.get(m.proposalId) ?? new Map<string, ContractorJobPair>();
      const key = `${m.metricId}|${m.targetDate}`;
      const pair: ContractorJobPair = groups.get(key)
        ?? { metricId: m.metricId, targetDate: m.targetDate, approvedConsensus: null, declinedConsensus: null };
      if (m.branch === 'approved') pair.approvedConsensus = c;
      else if (m.branch === 'declined') pair.declinedConsensus = c;
      groups.set(key, pair);
      pairsByJob.set(m.proposalId, groups);
    }
    // The hero metric is the one the floor's chart is showing (soonest
    // resolving baseline market), so every contractor score is in one unit.
    const heroMetricId = (marketList[0]?.metricId as string | undefined) ?? null;
    const contractorNames = await getParticipantDisplayNames(liveJobs.map(j => j.proposedBy));
    topContractors = computeContractors(
      liveJobs.map(j => ({
        proposalId: j.id,
        proposedBy: j.proposedBy,
        status: j.status,
        askUsd: j.askUsd ?? null,
        pairs: [...(pairsByJob.get(j.id)?.values() ?? [])],
      })),
      heroMetricId,
      contractorNames,
      5,
    );
  }

  // Platform-wide count of completed Manifold imports. Public on purpose: a
  // prediction market on "how many forecasters brought their record over"
  // cannot resolve on a number only the owner can see, and this audience will
  // not take it on faith. Counts claims rather than workspace membership, so it
  // reads the same from anywhere.
  const [manifoldRow] = await db.select({ n: count() }).from(systemConfig)
    .where(like(systemConfig.key, 'manifold-claimed:agent:%'));
  const manifoldImportCount = manifoldRow?.n ?? 0;

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
    subjectAbout: ws.subjectAbout ?? null,
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
    manifoldImportCount,
    proposalStats,
    markets: marketList,
    ...(openProposals !== undefined ? {
      proposals: openProposals,
      topContractors,
      heroHistory,
      horizonHistories,
      heroMetricDescription,
      tradesThisWeek,
      marketHistory,
    } : {}),
  });
}));

/**
 * A single market's price history on a public workspace, replayed the same
 * way the hero market's is. Exists so the trading floor can make a
 * proposal's conditional market the main view (select a job, the chart and
 * the ticket switch to it) instead of growing a second, smaller market UI
 * underneath the first. Same Open-workspace disclosure rule as the ballot:
 * if the Public group cannot `read`, neither can this.
 */
marketplaceRouter.get('/:workspaceId/markets/:marketId/history', wrap(async (req, res) => {
  const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }

  const [publicGroup] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
  if (!publicCaps.includes('read')) { res.status(403).json({ error: 'Not public' }); return; }

  const [market] = await db.select({ id: markets.id }).from(markets)
    .where(and(eq(markets.id, req.params.marketId as string), eq(markets.workspaceId, ws.id)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  const points = await replayMarketTradePoints(market.id, ws.id);
  res.json({ history: points.slice(-500).map(pt => ({ at: pt.createdAt, consensus: pt.consensus })) });
}));

/**
 * Comments, publicly readable on the floor (owner ask 2026-08-11): the
 * conversation under the market and under each job is part of what a
 * visitor sizes up before signing up, so reading it must not require an
 * account. Same Open-workspace disclosure rule as the ballot and the
 * history: if the Public group cannot read, neither can this. Posting
 * stays on the authenticated routes (markets/:id/messages,
 * proposals/:id/messages).
 */
marketplaceRouter.get('/:workspaceId/comments', wrap(async (req, res) => {
  const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }

  const [publicGroup] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
  if (!publicCaps.includes('read')) { res.status(403).json({ error: 'Not public' }); return; }

  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
  const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : null;
  if (!marketId && !proposalId) { res.status(400).json({ error: 'Pass marketId or proposalId' }); return; }

  let rows: Array<{ id: string; from: string; content: string; createdAt: Date }>;
  if (proposalId) {
    rows = await db.select().from(proposalMessages)
      .where(and(eq(proposalMessages.workspaceId, ws.id), eq(proposalMessages.proposalId, proposalId)))
      .orderBy(asc(proposalMessages.createdAt));
  } else {
    rows = await db.select().from(marketMessages)
      .where(and(eq(marketMessages.workspaceId, ws.id), eq(marketMessages.marketId, marketId!)))
      .orderBy(asc(marketMessages.createdAt));
  }
  const names = await getParticipantDisplayNames(rows.map(m => m.from));
  res.json(rows.slice(-200).map(m => ({
    id: m.id, fromName: names.get(m.from) ?? 'anonymous', content: m.content, createdAt: m.createdAt,
  })));
}));

/**
 * Who holds what, and the trade history, for a market on a public floor
 * (owner ask 2026-08-11: a way to view positions and trades for the
 * market, right beside the comments). Public read on Open workspaces,
 * same disclosure rule as comments; identities are the same public
 * handles the leaderboard shows. Marks each holder's position to the
 * market's current consensus so the worth reads live.
 */
marketplaceRouter.get('/:workspaceId/market-activity', wrap(async (req, res) => {
  const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (ws.visibility === 'private') { res.status(403).json({ error: 'This workspace is private' }); return; }

  const [publicGroup] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
  if (!publicCaps.includes('read')) { res.status(403).json({ error: 'Not public' }); return; }

  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
  if (!marketId) { res.status(400).json({ error: 'Pass marketId' }); return; }

  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, ws.id)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  const c = consensus((market.shares as [number, number]) || [0, 0], market.liquidity, market.rangeMin, market.rangeMax);
  const p = c === undefined ? null : Math.max(0, Math.min(1, (c - market.rangeMin) / (market.rangeMax - market.rangeMin)));

  const posRows = await db.select({
    agentId: positions.agentId, direction: positions.direction, shares: positions.shares, totalCost: positions.totalCost,
  }).from(positions)
    .where(and(eq(positions.workspaceId, ws.id), eq(positions.marketId, marketId), gt(positions.shares, 0)))
    .orderBy(desc(positions.shares)).limit(50);

  const tradeRows = await db.select({
    id: trades.id, agentId: trades.agentId, direction: trades.direction, shares: trades.shares,
    cost: trades.cost, createdAt: trades.createdAt,
  }).from(trades)
    .where(and(eq(trades.workspaceId, ws.id), eq(trades.marketId, marketId)))
    .orderBy(desc(trades.createdAt)).limit(50);

  const ids = [...new Set([...posRows.map(r => r.agentId), ...tradeRows.map(r => r.agentId)])];
  const names = await getParticipantDisplayNames(ids);
  const handle = (id: string) => names.get(id) ?? id;

  res.json({
    consensus: c ?? null,
    positions: posRows.map(r => ({
      handle: handle(r.agentId), id: r.agentId,
      direction: r.direction, shares: r.shares, cost: r.totalCost,
      // Worth = shares marked to current price (the EV payout factor).
      worth: p === null ? null : Math.round(r.shares * (r.direction === 'higher' ? p : 1 - p) * 100) / 100,
    })),
    trades: tradeRows.map(r => ({
      id: r.id, handle: handle(r.agentId), direction: r.direction,
      // A negative cost is a sell (proceeds); the sign carries the kind.
      kind: r.cost < 0 ? 'sell' : 'buy', shares: Math.abs(r.shares), cost: Math.abs(r.cost), createdAt: r.createdAt,
    })),
  });
}));

/**
 * The workspace's og:image (owner direction 2026-08-10: graphics over
 * text in the unfurl). One picture of the floor: the hero market's live
 * consensus huge, its step-line history, the resolution date. Discovery
 * data only (market consensus is already public on this page), so no
 * `read` gate; five-minute cache keeps scraper storms off the replay.
 */
marketplaceRouter.get('/:workspaceId/card.png', wrap(async (req, res) => {
  const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
  if (!ws || ws.visibility === 'private') { res.status(404).json({ error: 'Workspace not found' }); return; }

  const wsMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true)));
  const baseline = wsMarkets.filter(m => !m.proposalId);
  baseline.sort((a, b) => {
    const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
    if (dateDiff !== 0) return dateDiff;
    return b.liquidity - a.liquidity;
  });
  const hero = baseline[0];

  let history: number[] = [];
  let heroConsensus: number | null = null;
  let metricLabel = ws.name;
  let unit = '';
  let resolvesOn: string | null = null;
  if (hero) {
    const shares = (hero.shares as [number, number]) || [0, 0];
    heroConsensus = consensus(shares, hero.liquidity, hero.rangeMin, hero.rangeMax) ?? null;
    metricLabel = hero.metricName.replace(/\s*\(.*\)\s*$/, '');
    // Same mapping the floor's currencyOf uses: the "(USD)" tail becomes
    // the $ prefix; any other tail stays off the headline number.
    const unitTail = hero.metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
    unit = /\busd\b|\$/i.test(unitTail) ? '$' : '';
    resolvesOn = resolutionInstant(hero.targetDate)
      ? new Date(periodEndInstant(hero.targetDate).getTime() - 1).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        })
      : null;
    const points = await replayMarketTradePoints(hero.id, ws.id);
    history = points.map(pt => pt.consensus).filter((c): c is number => c !== null).slice(-120);
  }

  const { renderShareCardPng } = await import('../lib/share-card');
  const png = renderShareCardPng({
    name: ws.name, metricLabel, unit, consensus: heroConsensus, resolvesOn, history,
  });
  // Short cache so a shared card stays close to the live price (owner ask
  // 2026-08-11: the shared link should show the current price). The big
  // number already renders the current consensus; this keeps re-fetches
  // fresh. Platforms cache og:images on their own side too, which we
  // cannot control.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.type('png').send(png);
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

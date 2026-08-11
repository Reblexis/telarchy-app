import { Router } from 'express';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { getParticipantDisplayNames } from '../lib/participants';
import { agents, authUser, systemConfig, markets, positions, trades, workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { computeLeaderboardFromAggregates } from '../lib/leaderboard';

/**
 * Cross-workspace participant leaderboard. Public (no auth). Aggregates only
 * over markets in public-visibility workspaces, matching the privacy contract
 * of /api/marketplace: anything inside a private workspace stays inside.
 *
 * The math (calibration / accuracy / earnings / ranking rules) lives in
 * lib/leaderboard.ts so it can be unit-tested without a DB.
 *
 * Trade stats are aggregated in SQL (one row per agent) and positions are
 * fetched only for resolved markets. Loading the raw trades table into the
 * process (348k+ rows and growing) OOM-killed the Cloud Run instance and the
 * endpoint answered 503; never bring unaggregated trade history into memory
 * here.
 */
export const leaderboardRouter = Router();

leaderboardRouter.get('/', wrap(async (req, res) => {
  const limit = (() => {
    const raw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) return 100;
    return Math.min(raw, 500);
  })();

  const publicWs = await db.select({ id: workspaces.id })
    .from(workspaces).where(eq(workspaces.visibility, 'public'));
  if (publicWs.length === 0) { res.json({ participants: [] }); return; }
  const publicWsIds = publicWs.map(w => w.id);

  // Resolved, non-voided markets only: the assembly step needs them for
  // payout factors. Open markets contribute nothing to the leaderboard.
  const resolvedMarkets = await db.select({
    id: markets.id,
    workspaceId: markets.workspaceId,
    rangeMin: markets.rangeMin,
    rangeMax: markets.rangeMax,
    resolved: markets.resolved,
    actualValue: markets.actualValue,
  }).from(markets).where(and(
    inArray(markets.workspaceId, publicWsIds),
    eq(markets.voided, false),
    eq(markets.resolved, true),
    isNotNull(markets.actualValue),
  ));

  // Per-agent trade aggregates over non-voided markets, computed in SQL.
  const tradeAggs = await db.select({
    agentId: trades.agentId,
    totalTrades: sql<number>`count(*)::int`,
    lastTradeAt: sql<string | null>`max(${trades.createdAt})`,
    costOnResolved: sql<number>`coalesce(sum(${trades.cost}) filter (where ${markets.resolved} = true and ${markets.actualValue} is not null), 0)`,
  }).from(trades)
    .innerJoin(markets, and(
      eq(markets.id, trades.marketId),
      eq(markets.workspaceId, trades.workspaceId),
    ))
    .where(and(
      inArray(trades.workspaceId, publicWsIds),
      eq(markets.voided, false),
    ))
    .groupBy(trades.agentId);

  // Position rows matter only on resolved markets with shares still held.
  const positionRows = await db.select({
    agentId: positions.agentId,
    workspaceId: positions.workspaceId,
    marketId: positions.marketId,
    direction: positions.direction,
    shares: positions.shares,
  }).from(positions)
    .innerJoin(markets, and(
      eq(markets.id, positions.marketId),
      eq(markets.workspaceId, positions.workspaceId),
    ))
    .where(and(
      inArray(positions.workspaceId, publicWsIds),
      eq(markets.voided, false),
      eq(markets.resolved, true),
      isNotNull(markets.actualValue),
      gt(positions.shares, 0),
    ));

  const agentIdsSeen = new Set<string>();
  for (const t of tradeAggs) agentIdsSeen.add(t.agentId);
  for (const p of positionRows) agentIdsSeen.add(p.agentId);
  if (agentIdsSeen.size === 0) { res.json({ participants: [] }); return; }

  // Resolve display names the same way the proposals payload does: agent
  // nickname, else the linked browser account's name. A raw 32-char agent
  // id printed as a trader's name on the public floor is a bug, not a
  // fallback (observed 2026-08-10: the top-traders rail led with one).
  const displayNames = await getParticipantDisplayNames(Array.from(agentIdsSeen));
  const nicknameById = new Map<string, string | null>();
  for (const id of agentIdsSeen) nicknameById.set(id, displayNames.get(id) ?? null);

  const ranked = computeLeaderboardFromAggregates(
    resolvedMarkets,
    tradeAggs.map(t => ({ ...t, costOnResolved: Number(t.costOnResolved) })),
    positionRows,
    nicknameById,
    limit,
  );

  // Enrich the ranked slice with the picture and the Manifold badge (owner
  // ask 2026-08-11): the rail shows a face, and a Manifold logo for
  // imported traders. Only for the entries actually returned, so the
  // lookups stay small.
  const rankedIds = ranked.map(e => e.id);
  if (rankedIds.length > 0) {
    const agentRows = await db.select({ id: agents.id, authUserId: agents.authUserId })
      .from(agents).where(inArray(agents.id, rankedIds));
    const uidByAgent = new Map(agentRows.map(r => [r.id, r.authUserId]));
    const uids = agentRows.map(r => r.authUserId).filter((u): u is string => !!u);
    const imageByUid = new Map<string, string | null>();
    if (uids.length > 0) {
      const userRows = await db.select({ id: authUser.id, image: authUser.image })
        .from(authUser).where(inArray(authUser.id, uids));
      for (const u of userRows) imageByUid.set(u.id, u.image);
    }
    const manifoldRows = await db.select({ key: systemConfig.key, value: systemConfig.value })
      .from(systemConfig)
      .where(inArray(systemConfig.key, rankedIds.map(id => `manifold-claimed:agent:${id}`)));
    const manifoldByAgent = new Map<string, string>();
    for (const r of manifoldRows) {
      const agentId = r.key.replace('manifold-claimed:agent:', '');
      const uname = (r.value as { username?: string } | undefined)?.username;
      if (uname) manifoldByAgent.set(agentId, uname);
    }
    for (const e of ranked) {
      const uid = uidByAgent.get(e.id);
      (e as typeof e & { image?: string | null; manifoldUsername?: string | null }).image =
        uid ? imageByUid.get(uid) ?? null : null;
      (e as typeof e & { image?: string | null; manifoldUsername?: string | null }).manifoldUsername =
        manifoldByAgent.get(e.id) ?? null;
    }
  }

  res.json({ participants: ranked });
}));

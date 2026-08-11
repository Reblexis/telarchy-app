import { Router } from 'express';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { getParticipantDisplayNames } from '../lib/participants';
import { agents, authUser, systemConfig, markets, positions, trades, workspaces, permissionGroups } from '../db/schema';
import { wrap } from '../lib/wrap';
import { consensus } from '../lib/amm';
import { fromUnits, SIGNUP_CREDITS } from '../lib/validation';

/**
 * Cross-workspace participant leaderboard. Public (no auth). Aggregates only
 * over markets in public-visibility workspaces, matching the privacy contract
 * of /api/marketplace: anything inside a private workspace stays inside.
 *
 * Ranking (owner direction 2026-08-11): by PROFIT = balance + current
 * worth of open positions - credits the platform granted (signup +
 * Manifold import). The lib/leaderboard.ts calibration math is retained
 * for tests and other callers but is not what this rail ranks on.
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

  // Open markets and their current EV factors, to value each holder's
  // open positions (owner direction 2026-08-11: profit = net worth minus
  // the platform grant, so held positions are valued at the market's
  // current consensus). Bounded: one row per (agent, market).
  const openMarkets = await db.select({
    id: markets.id, workspaceId: markets.workspaceId,
    shares: markets.shares, liquidity: markets.liquidity,
    rangeMin: markets.rangeMin, rangeMax: markets.rangeMax,
  }).from(markets).where(and(
    inArray(markets.workspaceId, publicWsIds),
    eq(markets.voided, false),
    eq(markets.resolved, false),
    eq(markets.active, true),
  ));
  const openFactorByKey = new Map<string, [number, number]>();
  for (const m of openMarkets) {
    const c = consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax);
    if (c === undefined) continue;
    const p = Math.max(0, Math.min(1, (c - m.rangeMin) / (m.rangeMax - m.rangeMin)));
    openFactorByKey.set(`${m.workspaceId}:${m.id}`, [1 - p, p]);
  }
  const openPositionRows = await db.select({
    agentId: positions.agentId, workspaceId: positions.workspaceId, marketId: positions.marketId,
    direction: positions.direction, shares: positions.shares, totalCost: positions.totalCost,
  }).from(positions)
    .innerJoin(markets, and(eq(markets.id, positions.marketId), eq(markets.workspaceId, positions.workspaceId)))
    .where(and(
      inArray(positions.workspaceId, publicWsIds),
      eq(markets.voided, false),
      eq(markets.resolved, false),
      eq(markets.active, true),
      gt(positions.shares, 0),
    ));
  // Current worth of each agent's OPEN positions, marked to price.
  const worthByAgent = new Map<string, number>();
  for (const p of openPositionRows) {
    const factors = openFactorByKey.get(`${p.workspaceId}:${p.marketId}`);
    if (!factors) continue;
    const factor = p.direction === 'higher' ? factors[1] : factors[0];
    worthByAgent.set(p.agentId, (worthByAgent.get(p.agentId) ?? 0) + p.shares * factor);
  }

  // House accounts do not belong on the board (owner direction
  // 2026-08-11: the operator and the owner are not traders, and their
  // balances carry credits the platform handed them for running the
  // market, which the profit formula cannot net out). Exclude every
  // member of an Admin permission group in a public workspace: the owner
  // and the market-maker sit there; real traders are in the Public group.
  const adminGroups = await db.select({ memberIds: permissionGroups.memberIds })
    .from(permissionGroups)
    .where(and(inArray(permissionGroups.workspaceId, publicWsIds), eq(permissionGroups.type, 'admin')));
  const houseIds = new Set<string>();
  for (const g of adminGroups) for (const id of (g.memberIds as string[] | null) ?? []) houseIds.add(id);

  const agentIdsSeen = new Set<string>();
  for (const t of tradeAggs) agentIdsSeen.add(t.agentId);
  for (const p of positionRows) agentIdsSeen.add(p.agentId);
  for (const id of worthByAgent.keys()) agentIdsSeen.add(id);
  for (const id of houseIds) agentIdsSeen.delete(id);
  if (agentIdsSeen.size === 0) { res.json({ participants: [] }); return; }
  const seenIds = Array.from(agentIdsSeen);

  // Resolve display names the same way the proposals payload does: agent
  // nickname, else the linked browser account's name. A raw 32-char agent
  // id printed as a trader's name on the public floor is a bug, not a
  // fallback (observed 2026-08-10: the top-traders rail led with one).
  const displayNames = await getParticipantDisplayNames(seenIds);

  // Profit is NET WORTH minus what the platform handed you (owner
  // direction 2026-08-11): balance (credits on hand, which already
  // absorbed every resolved payout) + current worth of open positions,
  // minus the starting grant (signup) and any Manifold import. So a
  // trader who only lost value on open positions reads negative, and one
  // who never traded reads exactly zero.
  const agentRows = await db.select({ id: agents.id, authUserId: agents.authUserId, balance: agents.balance })
    .from(agents).where(inArray(agents.id, seenIds));
  const balanceById = new Map(agentRows.map(r => [r.id, fromUnits(r.balance as number)]));
  const uidByAgent = new Map(agentRows.map(r => [r.id, r.authUserId]));

  const manifoldRows = await db.select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, seenIds.map(id => `manifold-claimed:agent:${id}`)));
  const manifoldGrantByAgent = new Map<string, number>();
  const manifoldNameByAgent = new Map<string, string>();
  for (const r of manifoldRows) {
    const agentId = r.key.replace('manifold-claimed:agent:', '');
    const v = r.value as { username?: string; granted?: number } | undefined;
    if (v?.username) manifoldNameByAgent.set(agentId, v.username);
    if (v?.granted) manifoldGrantByAgent.set(agentId, v.granted);
  }

  const aggById = new Map(tradeAggs.map(t => [t.agentId, t]));
  const profitById = new Map<string, number>();
  for (const id of seenIds) {
    const netWorth = (balanceById.get(id) ?? 0) + (worthByAgent.get(id) ?? 0);
    const granted = SIGNUP_CREDITS + (manifoldGrantByAgent.get(id) ?? 0);
    profitById.set(id, Math.round((netWorth - granted) * 100) / 100);
  }

  const uids = agentRows.map(r => r.authUserId).filter((u): u is string => !!u);
  const imageByUid = new Map<string, string | null>();
  if (uids.length > 0) {
    const userRows = await db.select({ id: authUser.id, image: authUser.image })
      .from(authUser).where(inArray(authUser.id, uids));
    for (const u of userRows) imageByUid.set(u.id, u.image);
  }

  const ranked = seenIds.map(id => {
    const agg = aggById.get(id);
    const uid = uidByAgent.get(id);
    return {
      rank: 0,
      id,
      nickname: displayNames.get(id) ?? null,
      image: uid ? imageByUid.get(uid) ?? null : null,
      manifoldUsername: manifoldNameByAgent.get(id) ?? null,
      calibration: null as number | null,
      accuracy: null as number | null,
      totalEarnings: profitById.get(id) ?? 0,
      resolvedMarkets: 0,
      totalTrades: agg ? Number(agg.totalTrades) : 0,
      lastTradeAt: agg?.lastTradeAt ?? null,
    };
  });
  // Profit first, most recent trade as the tiebreak; then rank + cap.
  ranked.sort((a, b) => {
    if (b.totalEarnings !== a.totalEarnings) return b.totalEarnings - a.totalEarnings;
    const at = a.lastTradeAt ? Date.parse(a.lastTradeAt) : 0;
    const bt = b.lastTradeAt ? Date.parse(b.lastTradeAt) : 0;
    return bt - at;
  });
  const capped = ranked.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));

  res.json({ participants: capped });
}));

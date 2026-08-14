import { Router } from 'express';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { getParticipantDisplayNames } from '../lib/participants';
import { agents, authUser, systemConfig, markets, positions, trades, workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { computeCalibrationStats, computeTradingProfit, type ProfitMarket } from '../lib/leaderboard';

/**
 * Cross-workspace participant leaderboard. Public (no auth). Aggregates only
 * over markets in public-visibility workspaces, matching the privacy contract
 * of /api/marketplace: anything inside a private workspace stays inside.
 *
 * Ranking (owner direction 2026-08-11, revised 2026-08-14 by Viktor): by
 * TRADING PROFIT MARKED TO MARKET, measured off the trades themselves
 * rather than off the balance:
 *
 *   profit = payouts on resolved markets
 *          + current worth of open positions (shares x live consensus factor)
 *          - net cash paid for those positions (buys positive, sells negative)
 *
 * An unresolved position counts as soon as its price moves; nothing waits
 * for resolution, which is the whole point of the board.
 *
 * Why not balance-minus-grant (the 2026-08-11 formula): a balance carries
 * everything the platform ever handed an account, so house accounts had to
 * be excluded by name to stop operator credits topping the board, and that
 * exclusion silently deleted the floor's most active traders (owner report
 * 2026-08-14: "maybe the bug is that it doesn't count admin into traders").
 * Trading profit is grant-blind: it only counts money that went into and
 * came out of markets, so the owner and the market maker can be ranked on
 * the same number as everyone else and nobody needs excluding.
 *
 * Everyone who has ever traded in a public workspace is on the board. The
 * activity aggregate is deliberately NOT joined to markets, so a trader
 * whose markets were later voided or deleted still appears (with the profit
 * those markets can no longer justify, i.e. zero, since a void refunds).
 * Filtering the join (the pre-2026-08-14 behaviour) erased whole traders.
 *
 * Calibration and accuracy (lib/leaderboard.ts) are reported per row but
 * are not the ranking key.
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

  // Every non-voided market in a public workspace, resolved or not: enough
  // to price one share of each direction (currentPayoutFactors picks the
  // resolution payout or the live call). Voided markets are left out of BOTH
  // halves of the formula, since the refund cancelled the cash and the claim
  // together.
  const marketRows = await db.select({
    id: markets.id,
    workspaceId: markets.workspaceId,
    rangeMin: markets.rangeMin,
    rangeMax: markets.rangeMax,
    resolved: markets.resolved,
    actualValue: markets.actualValue,
    shares: markets.shares,
    liquidity: markets.liquidity,
  }).from(markets).where(and(
    inArray(markets.workspaceId, publicWsIds),
    eq(markets.voided, false),
  ));
  const profitMarkets: ProfitMarket[] = marketRows.map(m => ({
    id: m.id,
    workspaceId: m.workspaceId,
    rangeMin: m.rangeMin,
    rangeMax: m.rangeMax,
    resolved: m.resolved,
    actualValue: m.actualValue,
    shares: (m.shares as [number, number] | null) ?? null,
    liquidity: m.liquidity,
  }));
  const resolvedMarkets = profitMarkets.filter(m => m.resolved && m.actualValue !== null);

  // Who has traded, and when they last did. Deliberately NOT joined to
  // markets: a trade on a market that was later voided (or whose row was
  // deleted outright) still happened. Joining here, as this did until
  // 2026-08-14, silently deleted every trader whose activity sat on voided
  // conditional branches, which on the LookPilot floor was most of them, so
  // the board rendered two rows out of eight.
  const tradeAggs = await db.select({
    agentId: trades.agentId,
    totalTrades: sql<number>`count(*)::int`,
    lastTradeAt: sql<string | null>`max(${trades.createdAt})`,
  }).from(trades)
    .where(inArray(trades.workspaceId, publicWsIds))
    .groupBy(trades.agentId);

  // Net cash each agent put into markets that still exist and were not
  // voided: the cost basis of the profit formula. Sells are stored with
  // negative cost, so the sum is money in minus money already taken back
  // out. Aggregated in SQL; the raw trades table (348k rows and growing)
  // must never come into this process.
  const costAggs = await db.select({
    agentId: trades.agentId,
    netCash: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
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

  // Every position still held on a market that can be valued, resolved or
  // open. One row per (agent, market), so this stays bounded as trade
  // history grows.
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
      gt(positions.shares, 0),
    ));

  const netCashById = new Map(costAggs.map(c => [c.agentId, Number(c.netCash)]));
  const profitById = computeTradingProfit(profitMarkets, netCashById, positionRows);

  // Nobody is excluded any more (owner report 2026-08-14: "maybe the bug is
  // that it doesn't count admin into traders"). The 2026-08-11 formula read
  // a balance, so operator and owner accounts had to be struck off by name
  // to keep granted credits off the board; trading profit never sees a
  // grant, so the house is ranked on the same number as everyone else.
  const agentIdsSeen = new Set<string>();
  for (const t of tradeAggs) agentIdsSeen.add(t.agentId);
  for (const p of positionRows) agentIdsSeen.add(p.agentId);
  if (agentIdsSeen.size === 0) { res.json({ participants: [] }); return; }
  const seenIds = Array.from(agentIdsSeen);

  // Resolve display names the same way the proposals payload does: agent
  // nickname, else the linked browser account's name. A raw 32-char agent
  // id printed as a trader's name on the public floor is a bug, not a
  // fallback (observed 2026-08-10: the top-traders rail led with one).
  const displayNames = await getParticipantDisplayNames(seenIds);

  const agentRows = await db.select({ id: agents.id, authUserId: agents.authUserId })
    .from(agents).where(inArray(agents.id, seenIds));
  const uidByAgent = new Map(agentRows.map(r => [r.id, r.authUserId]));

  const manifoldRows = await db.select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, seenIds.map(id => `manifold-claimed:agent:${id}`)));
  // Only the Manifold display name is read here now; the import grant no
  // longer enters the formula, because trading profit never counts granted
  // credits in the first place.
  const manifoldNameByAgent = new Map<string, string>();
  for (const r of manifoldRows) {
    const agentId = r.key.replace('manifold-claimed:agent:', '');
    const v = r.value as { username?: string; granted?: number } | undefined;
    if (v?.username) manifoldNameByAgent.set(agentId, v.username);
  }

  const aggById = new Map(tradeAggs.map(t => [t.agentId, t]));

  const uids = agentRows.map(r => r.authUserId).filter((u): u is string => !!u);
  const imageByUid = new Map<string, string | null>();
  if (uids.length > 0) {
    const userRows = await db.select({ id: authUser.id, image: authUser.image })
      .from(authUser).where(inArray(authUser.id, uids));
    for (const u of userRows) imageByUid.set(u.id, u.image);
  }

  // Quality stats alongside the ranking number: the board ranks on profit,
  // but a row that reports calibration lets a visitor tell a lucky big bet
  // from a forecaster who is right repeatedly. Reported, never ranked on.
  const calibrationById = computeCalibrationStats(resolvedMarkets, positionRows);

  const ranked = seenIds.map(id => {
    const agg = aggById.get(id);
    const uid = uidByAgent.get(id);
    const quality = calibrationById.get(id);
    return {
      rank: 0,
      id,
      nickname: displayNames.get(id) ?? null,
      image: uid ? imageByUid.get(uid) ?? null : null,
      manifoldUsername: manifoldNameByAgent.get(id) ?? null,
      calibration: quality?.calibration ?? null,
      accuracy: quality?.accuracy ?? null,
      totalEarnings: profitById.get(id) ?? 0,
      resolvedMarkets: quality?.resolvedMarkets ?? 0,
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

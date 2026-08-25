import { and, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { markets, positions, trades } from '../db/schema';
import {
  type CalibrationStats,
  computeCalibrationStats,
  computeProfitBreakdown,
  type LeaderboardPosition,
  type ProfitBreakdown,
  type ProfitMarket,
  voidedStakeKey,
} from './leaderboard';

/**
 * The board: everyone's trading profit marked to market, over ONE named set of
 * workspaces.
 *
 * This module owns the SQL side of that question. `lib/leaderboard.ts` owns the
 * arithmetic (`computeTradingProfit`) and stays pure so its thirty-odd tests
 * run without a database. Nothing else may query `trades` or `positions` to
 * compute profit; `__tests__/season-scoring-ownership.test.ts` greps for it and
 * fails on a second copy. That guard exists because the same fact computed in
 * two places is how every visible floor bug in the week of 2026-08-11 happened,
 * and because a prize season now decides who receives money on this number.
 *
 *   workspaceIds ──┬─► trade counts + last trade   (SQL aggregate, per agent)
 *                  ├─► net cash into live markets  (SQL aggregate, per agent)
 *                  ├─► open positions on unvoided  (rows, shares > 0 only)
 *                  └─► net cash per voided market  (SQL aggregate, per market)
 *                                    │
 *                                    ▼
 *                        computeTradingProfit  ──►  Map<agentId, profit>
 *
 * WHY THE AGGREGATES ARE IN SQL, and why they must stay there: the `trades`
 * table is 348k rows and growing. Pulling it unaggregated into the process
 * OOM-killed the Cloud Run instance and the endpoint answered 503. Never bring
 * unaggregated trade history into this process. Positions are fetched as rows
 * because only held, unvoided ones are needed and that set is small.
 *
 * The workspace set is a PARAMETER, never derived here. The public board passes
 * the currently-public workspaces; a prize season passes the set pinned at its
 * start, so that flipping a workspace's visibility mid-season cannot inject an
 * entrant's whole history into their season score (design decision D2,
 * 2026-08-17).
 */

export interface BoardRow {
  agentId: string;
  /** Trading profit marked to market, rounded to 2dp. */
  profit: number;
  totalTrades: number;
  lastTradeAt: string | null;
}

export interface Board {
  /** agentId -> profit. Everyone with a valued position or a counted trade. */
  profitById: Map<string, number>;
  /** agentId -> the same profit split into settled (final) and open (a
   *  mark); settled + open = profitById exactly. Reported beside the ranking
   *  number, never ranked on (docs/seasons.md, "The score"). */
  breakdownById: Map<string, ProfitBreakdown>;
  /** agentId -> trade count and last trade instant. */
  activityById: Map<string, { totalTrades: number; lastTradeAt: string | null }>;
  /** agentId -> calibration/accuracy over markets that actually resolved.
   *  Reported beside the ranking number, never ranked on. */
  calibrationById: Map<string, CalibrationStats>;
  /** Held, unvoided positions, as the profit formula saw them. */
  positions: LeaderboardPosition[];
  /** Every agent with any activity in this workspace set. */
  agentIds: string[];
}

/**
 * Compute the board over `workspaceIds`. An empty list answers an empty board
 * rather than silently widening to every workspace, which would leak the exact
 * opposite of what was asked for.
 */
export async function loadBoard(workspaceIds: string[]): Promise<Board> {
  if (workspaceIds.length === 0) {
    return {
      profitById: new Map(),
      breakdownById: new Map(),
      activityById: new Map(),
      calibrationById: new Map(),
      positions: [],
      agentIds: [],
    };
  }

  // Every market in the set, whatever state it is in: enough to say what a
  // holding is worth (currentPayoutFactors picks the resolution payout or the
  // live call; a voided market pays its refund instead).
  const marketRows = await db
    .select({
      id: markets.id,
      workspaceId: markets.workspaceId,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
      resolved: markets.resolved,
      actualValue: markets.actualValue,
      shares: markets.shares,
      liquidity: markets.liquidity,
      voided: markets.voided,
    })
    .from(markets)
    .where(inArray(markets.workspaceId, workspaceIds));

  const profitMarkets: ProfitMarket[] = marketRows.map(m => ({
    id: m.id,
    workspaceId: m.workspaceId,
    rangeMin: m.rangeMin,
    rangeMax: m.rangeMax,
    resolved: m.resolved,
    actualValue: m.actualValue,
    shares: (m.shares as [number, number] | null) ?? null,
    liquidity: m.liquidity,
    voided: m.voided,
  }));

  // Who has traded, and when they last did. Deliberately NOT joined to
  // markets: a trade on a market that was later voided (or whose row was
  // deleted outright) still happened. Joining here, as this did until
  // 2026-08-14, silently deleted every trader whose activity sat on voided
  // conditional branches, which on the LookPilot floor was most of them, so
  // the board rendered two rows out of eight.
  const tradeAggs = await db
    .select({
      agentId: trades.agentId,
      totalTrades: sql<number>`count(*)::int`,
      lastTradeAt: sql<string | null>`max(${trades.createdAt})`,
    })
    .from(trades)
    .where(inArray(trades.workspaceId, workspaceIds))
    .groupBy(trades.agentId);

  // Net cash each agent put into markets that still exist: the cost basis of
  // the profit formula. Sells are stored with negative cost, so the sum is
  // money in minus money already taken back out. Voided markets are counted
  // on this side too, because the value side counts their refund; the join
  // only drops trades whose market row is gone, which nothing can value.
  const costAggs = await db
    .select({
      agentId: trades.agentId,
      netCash: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .innerJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, trades.workspaceId)))
    .where(inArray(trades.workspaceId, workspaceIds))
    .groupBy(trades.agentId);

  // The part of that net cash that went into markets whose money is final
  // (resolved to a number, or cancelled): the cost side of settled profit.
  // Same predicate as isSettledMarket in lib/leaderboard.ts.
  const settledCostAggs = await db
    .select({
      agentId: trades.agentId,
      netCash: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .innerJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, trades.workspaceId)))
    .where(
      and(
        inArray(trades.workspaceId, workspaceIds),
        or(eq(markets.voided, true), and(eq(markets.resolved, true), isNotNull(markets.actualValue))),
      ),
    )
    .groupBy(trades.agentId);

  // Positions that can still be valued at a price: held, on a market that was
  // not cancelled. Both filters matter for size as much as for meaning, since
  // this query has been OOM-killed before. Cancelled markets pay a refund
  // instead and are handled below, off the trades, so they need no rows here.
  const positionRows = await db
    .select({
      agentId: positions.agentId,
      workspaceId: positions.workspaceId,
      marketId: positions.marketId,
      direction: positions.direction,
      shares: positions.shares,
    })
    .from(positions)
    .innerJoin(markets, and(eq(markets.id, positions.marketId), eq(markets.workspaceId, positions.workspaceId)))
    .where(and(inArray(positions.workspaceId, workspaceIds), eq(markets.voided, false), gt(positions.shares, 0)));

  // What each agent still had at stake on each CANCELLED market: the void
  // refund is this floored at zero (docs/vision.md), so it is the value side
  // of those markets. One row per (agent, voided market).
  const voidedStakeRows = await db
    .select({
      agentId: trades.agentId,
      workspaceId: trades.workspaceId,
      marketId: trades.marketId,
      netCash: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .innerJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, trades.workspaceId)))
    .where(and(inArray(trades.workspaceId, workspaceIds), eq(markets.voided, true)))
    .groupBy(trades.agentId, trades.workspaceId, trades.marketId);

  const voidedStake = new Map(
    voidedStakeRows.map(r => [voidedStakeKey(r.agentId, r.workspaceId, r.marketId), Number(r.netCash)]),
  );

  const netCashById = new Map(costAggs.map(c => [c.agentId, Number(c.netCash)]));
  const settledCashById = new Map(settledCostAggs.map(c => [c.agentId, Number(c.netCash)]));
  const breakdownById = computeProfitBreakdown(profitMarkets, netCashById, settledCashById, positionRows, voidedStake);
  const profitById = new Map(Array.from(breakdownById, ([id, b]) => [id, b.total]));

  // Calibration is about markets that produced an answer, so voided ones
  // (actualValue null by construction) never reach it.
  const resolved = profitMarkets.filter(m => m.resolved && m.actualValue !== null);
  const calibrationById = computeCalibrationStats(resolved, positionRows);

  const activityById = new Map(
    tradeAggs.map(t => [
      t.agentId,
      {
        totalTrades: Number(t.totalTrades),
        lastTradeAt: t.lastTradeAt ?? null,
      },
    ]),
  );

  // Nobody is excluded (owner report 2026-08-14: "maybe the bug is that it
  // doesn't count admin into traders"). Trading profit never sees a grant, so
  // the house is ranked on the same number as everyone else.
  const agentIdsSeen = new Set<string>();
  for (const t of tradeAggs) agentIdsSeen.add(t.agentId);
  for (const p of positionRows) agentIdsSeen.add(p.agentId);

  return {
    profitById,
    breakdownById,
    activityById,
    calibrationById,
    positions: positionRows,
    agentIds: Array.from(agentIdsSeen),
  };
}

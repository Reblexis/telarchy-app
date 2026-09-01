import { and, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { markets, positions, trades } from '../db/schema';
import { resolutionInstant, settlesOn } from './date-utils';
import {
  type CalibrationStats,
  computeCalibrationStats,
  computeMarkedWindowProfit,
  computeProfitBreakdown,
  computeSettledWindowProfit,
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

/**
 * The season score since the 2026-08-28 amendment: settled profit per agent
 * over markets whose `resolvedAt` fell inside `(windowStart, windowEnd]`,
 * voids included (voiding stamps `resolvedAt` too), counting only trades
 * placed up to SEASON_TRADE_CUTOFF_HOURS before each market's resolve
 * instant (docs/seasons.md, "The score"; rules,
 * docs/legal/season-0-rules.md, Scoring).
 *
 * The arithmetic is `computeSettledWindowProfit` (lib/leaderboard.ts, pure);
 * this is its SQL side, aggregated in the database for the same OOM reason
 * as everything above. Positions are NOT read from the positions table: the
 * scored holding is the position at each market's cutoff instant, which only
 * the trade ledger knows.
 */
/**
 * A season turns on two instants, and both halves of the board must use the
 * same pair or they disagree about the same market.
 *
 *   period end        the answer is fixed, and trading stops (#123)
 *   period end + lag  the market settles and pays
 *
 * The marked half used to decide membership by the PERIOD END, so a market
 * whose reporting lag pushed settlement past `endsAt` was marked into "Total
 * if prices hold" and then dropped by the settled half, whose window keys on
 * `resolvedAt`. The column promised dollars the season could not pay, against
 * its own tooltip (bug hunt 2026-08-31, P1-10). Owner decision 2026-09-01:
 * the reporting lag is counted in the season.
 */
export function seasonMarketCountsIn(
  market: { targetDate: string; settlesAt?: Date | string | null },
  windowEnd: Date,
): boolean {
  const settles = new Date(settlesOn(market));
  if (Number.isNaN(settles.getTime())) return false;
  return settles.getTime() <= windowEnd.getTime();
}

export async function loadSeasonSettled(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();

  const inWindow = and(
    inArray(markets.workspaceId, workspaceIds),
    isNotNull(markets.resolvedAt),
    gt(markets.resolvedAt, windowStart),
    lte(markets.resolvedAt, windowEnd),
    or(eq(markets.voided, true), and(eq(markets.resolved, true), isNotNull(markets.actualValue))),
  );

  const marketRows = await db
    .select({
      id: markets.id,
      workspaceId: markets.workspaceId,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
      actualValue: markets.actualValue,
      voided: markets.voided,
    })
    .from(markets)
    .where(inWindow);
  if (marketRows.length === 0) return new Map();

  const aggs = await db
    .select({
      agentId: trades.agentId,
      workspaceId: trades.workspaceId,
      marketId: trades.marketId,
      direction: trades.direction,
      shares: sql<number>`coalesce(sum(${trades.shares}), 0)::float`,
      cost: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .innerJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, trades.workspaceId)))
    .where(
      and(
        inWindow,
        // NO CUTOFF. Every trade counts, cost and shares both.
        //
        // The 6-hour cutoff existed for one published reason: "it just cannot
        // farm the prize off a reading that is already visible"
        // (docs/legal/season-0-rules.md). A market resolves on its reading
        // now, so the reading becoming visible IS the resolution and there is
        // no window to farm; the cutoff protected nothing and cost something.
        //
        // "Does not count" cut both ways: meant to ignore late BUYING, it
        // also ignored late SELLING, so a trader could buy before the cutoff,
        // sell out after it, and still be scored on shares they did not hold
        // at resolution - the same bankroll scored on market after market for
        // the price of the spread. Counting every trade makes the arithmetic
        // self-correcting, because the aggregate nets to zero shares at the
        // cost of the spread (owner decision 2026-09-01).
      ),
    )
    .groupBy(trades.agentId, trades.workspaceId, trades.marketId, trades.direction);

  return computeSettledWindowProfit(
    marketRows.map(m => ({ ...m, actualValue: m.voided ? null : m.actualValue })),
    aggs.map(a => ({ ...a, shares: Number(a.shares), cost: Number(a.cost) })),
  );
}

/**
 * The season's score with the mark added: the settled window exactly as
 * `loadSeasonSettled` computes it, PLUS every market still open whose
 * resolution instant falls on or before the season's end, each holding
 * valued at what the market currently calls.
 *
 * This is the standings' display column and never the score
 * (docs/seasons.md, "The standings show the mark beside the score"). Three
 * rules decide what it contains, and all three are here rather than in the
 * caller so a second surface cannot answer them differently:
 *
 *  - A market resolving AFTER the season ends contributes nothing, marked or
 *    not: a resolution after the end pays no season prize, so counting it
 *    would show an entrant money this season can never give them. The
 *    resolution instant comes from the market's own targetDate, so a horizon
 *    created tomorrow is classified by the same rule as one created today.
 *  - The settled half is the settled function itself, unchanged. The money
 *    path and the display column can then never disagree about a resolved
 *    market, which is the whole reason the two are summed rather than
 *    recomputed together.
 *  - The 6-hour trade cutoff applies to the open half too, measured against
 *    each market's own resolve instant: a trade too late to be scored must
 *    not appear in the projection of that score either.
 */
export async function loadSeasonMarked(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();

  const settled = await loadSeasonSettled(workspaceIds, windowStart, windowEnd);
  const open = await loadOpenWindowMarked(workspaceIds, windowEnd);

  const out = new Map(settled);
  for (const [agentId, profit] of open) {
    out.set(agentId, (out.get(agentId) ?? 0) + profit);
  }
  // Both halves are already 2dp; the sum of two 2dp floats is not.
  for (const [agentId, profit] of out) out.set(agentId, Math.round(profit * 100) / 100);
  return out;
}

/**
 * The open half of the marked score: markets that have not resolved and will
 * resolve on or before `windowEnd`, valued at their current call.
 *
 * Positions come from the trade ledger rather than the positions table, for
 * the same reason the settled half does: the scored holding is the position
 * at the cutoff instant, and only the ledger knows what that was.
 */
async function loadOpenWindowMarked(workspaceIds: string[], windowEnd: Date): Promise<Map<string, number>> {
  const openRows = await db
    .select({
      id: markets.id,
      workspaceId: markets.workspaceId,
      targetDate: markets.targetDate,
      rangeMin: markets.rangeMin,
      rangeMax: markets.rangeMax,
      shares: markets.shares,
      liquidity: markets.liquidity,
      // Without this, settlesOn falls back to the period end and the lag is
      // invisible to the half that decides what the standings promise.
      settlesAt: markets.settlesAt,
    })
    .from(markets)
    .where(and(inArray(markets.workspaceId, workspaceIds), eq(markets.resolved, false), eq(markets.voided, false)));

  // Membership is decided by when a market SETTLES, so this half and the
  // settled half agree about the same market (seasonMarketCountsIn).
  const scored = openRows
    .map(m => ({ ...m, resolvesOn: resolveInstantOrNull(m.targetDate) }))
    .filter(m => m.resolvesOn !== null && seasonMarketCountsIn(m, windowEnd));
  if (scored.length === 0) return new Map();

  // No cutoff here either, for the same reason as the settled half: every
  // trade counts, so the marked position is the one actually held.
  const cutoffs = scored.map(m => and(eq(trades.marketId, m.id), eq(trades.workspaceId, m.workspaceId)));

  const aggs = await db
    .select({
      agentId: trades.agentId,
      workspaceId: trades.workspaceId,
      marketId: trades.marketId,
      direction: trades.direction,
      shares: sql<number>`coalesce(sum(${trades.shares}), 0)::float`,
      cost: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .where(or(...cutoffs))
    .groupBy(trades.agentId, trades.workspaceId, trades.marketId, trades.direction);

  return computeMarkedWindowProfit(
    scored.map(m => ({
      id: m.id,
      workspaceId: m.workspaceId,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      resolved: false,
      actualValue: null,
      voided: false,
      shares: (m.shares as [number, number] | null) ?? null,
      liquidity: m.liquidity,
    })),
    aggs.map(a => ({ ...a, shares: Number(a.shares), cost: Number(a.cost) })),
  );
}

/** A market whose targetDate cannot be read resolves at no instant we can
 *  name, so it is left out rather than guessed at. */
function resolveInstantOrNull(targetDate: string): Date | null {
  try {
    const at = new Date(resolutionInstant(targetDate));
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

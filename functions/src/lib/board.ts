import { and, eq, gt, inArray, isNotNull, lte, or, type SQL, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, creditLedger, creditTransfers, liquidityEvents, markets, positions, trades } from '../db/schema';
import { resolutionInstant, settlesOn } from './date-utils';
import {
  type CalibrationStats,
  computeCalibrationStats,
  computeMarkedWindowProfit,
  computeProfitBreakdown,
  computeSettledWindowProfit,
  foldHouseholdBreakdowns,
  foldHouseholds,
  householdsOf,
  type LeaderboardPosition,
  type ProfitBreakdown,
  type ProfitMarket,
  voidedStakeKey,
} from './leaderboard';
import { fromUnits } from './validation';

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
  /** agentId -> profit: the account's own trading profit, plus peer
   *  transfers, plus the same for every account it owns (docs/seasons.md,
   *  "Your score includes the accounts you own"). Everyone with a valued
   *  position, a counted trade, a transfer, or an owned account that has one. */
  profitById: Map<string, number>;
  /** agentId -> the same profit split into settled (final) and open (a
   *  mark); settled + open = profitById exactly. Reported beside the ranking
   *  number, never ranked on (docs/seasons.md, "The score"). */
  breakdownById: Map<string, ProfitBreakdown>;
  /** agentId -> this account alone, before the household fold. */
  ownProfitById: Map<string, number>;
  ownBreakdownById: Map<string, ProfitBreakdown>;
  /** owner agentId -> the accounts folded into its row (itself excluded);
   *  only owners with at least one appear. */
  householdById: Map<string, string[]>;
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
      ownProfitById: new Map(),
      ownBreakdownById: new Map(),
      householdById: new Map(),
      activityById: new Map(),
      calibrationById: new Map(),
      positions: [],
      agentIds: [],
    };
  }

  // Every TRADED market in the set, whatever state it is in: enough to say
  // what a holding is worth (currentPayoutFactors picks the resolution payout
  // or the live call; a voided market pays its refund instead). A market
  // nobody traded and nobody holds cannot have moved a balance, so it never
  // enters the board (docs/ui-conventions.md, "Top traders"); without that
  // restriction this read is proportional to the workspace's market count,
  // which the Snake grows by ~11k a day, almost none of them traded
  // (telarchy umbrella, notes/snake-load-audit-2026-09-10.md, item 7).
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
    .where(and(inArray(markets.workspaceId, workspaceIds), tradedIn(workspaceIds)));

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
  // A fault refund is the one issued credit that counts (docs/ui-conventions.md,
  // "Top traders"): the platform repaying what its own fault cost a holder on
  // one market is settled money back on that market. It counts on a board
  // only when its market is in this workspace set. Rare rows, read through
  // the partial index on reason = 'fault_refund'.
  const faultRefunds = await db
    .select({
      agentId: creditLedger.agentId,
      units: sql<number>`coalesce(sum(${creditLedger.deltaUnits}), 0)::float`,
    })
    .from(creditLedger)
    .innerJoin(markets, and(eq(markets.id, creditLedger.refId), eq(markets.workspaceId, creditLedger.workspaceId)))
    .where(
      and(
        eq(creditLedger.reason, 'fault_refund'),
        eq(creditLedger.refType, 'market'),
        inArray(markets.workspaceId, workspaceIds),
      ),
    )
    .groupBy(creditLedger.agentId);
  for (const r of faultRefunds) {
    const credits = fromUnits(Number(r.units));
    const b = breakdownById.get(r.agentId) ?? { settled: 0, open: 0, total: 0 };
    breakdownById.set(r.agentId, {
      settled: Math.round((b.settled + credits) * 100) / 100,
      open: b.open,
      total: Math.round((b.total + credits) * 100) / 100,
    });
  }
  // CREDITS TRANSFERRED BETWEEN PARTICIPANTS COUNT here too, over all time
  // (docs/seasons.md, "The ALL-TIME board's ranking key", 2026-09-16):
  // received is profit, sent is loss, settled money. Whatever the workspace
  // set: a transfer belongs to no floor, and the number a profile shows has
  // to be the one the board ranks. From the peer-transfer receipt only.
  const transfers = await loadTransferNet(null, null);
  for (const [agentId, net] of transfers) {
    const b = breakdownById.get(agentId) ?? { settled: 0, open: 0, total: 0 };
    breakdownById.set(agentId, {
      settled: Math.round((b.settled + net) * 100) / 100,
      open: b.open,
      total: Math.round((b.total + net) * 100) / 100,
    });
  }
  const ownBreakdownById = breakdownById;
  const ownProfitById = new Map(Array.from(ownBreakdownById, ([id, b]) => [id, b.total]));

  // YOUR SCORE INCLUDES THE ACCOUNTS YOU OWN (docs/seasons.md): the owner's
  // row is its own plus its bots' and their bots'; the bots keep their own.
  const ownerOf = await loadOwnerOf();
  const foldedBreakdownById = foldHouseholdBreakdowns(ownBreakdownById, ownerOf);
  const profitById = new Map(Array.from(foldedBreakdownById, ([id, b]) => [id, b.total]));
  const householdById = householdsOf(foldedBreakdownById.keys(), ownerOf);

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
  for (const r of faultRefunds) agentIdsSeen.add(r.agentId);
  for (const id of foldedBreakdownById.keys()) agentIdsSeen.add(id);

  return {
    profitById,
    breakdownById: foldedBreakdownById,
    ownProfitById,
    ownBreakdownById,
    householdById,
    activityById,
    calibrationById,
    positions: positionRows,
    agentIds: Array.from(agentIdsSeen),
  };
}

/**
 * The season score since the 2026-08-28 amendment: settled profit per agent
 * over markets whose `resolvedAt` fell inside `(windowStart, windowEnd]`,
 * voids included (voiding stamps `resolvedAt` too), every trade counting
 * (the cutoff was removed 2026-09-01), PLUS, since the 2026-09-16
 * amendment, the credits transferred between participants inside the same
 * window, received as profit and sent as loss (docs/seasons.md, "The
 * score"; rules, docs/legal/season-0-rules.md, Scoring).
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

/**
 * What each agent put into each of these markets' pools.
 *
 * Profit out of a book you funded is not score, up to this amount
 * (docs/seasons.md; the Terms' section 2 has always said buying liquidity
 * confers none). Shared by BOTH halves of the standings on purpose: the
 * settled half and the marked half applying different rules is how a column
 * ends up promising money the settlement will not pay, which is P1-10 and
 * happened once already.
 *
 * The key is the one windowProfit looks up by, and a mismatch there fails
 * silently while every pure test still passes, so it is pinned end to end in
 * own-book-no-profit.test.ts.
 */
async function ownPoolFundingWhere(marketPredicate: SQL): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Joined to the market set by its predicate, never by a list of ids: the
  // list version threw past Postgres's 65,535-parameter cap once a season
  // window held that many settled books (audit item 9).
  const funding = await db
    .select({
      agentId: liquidityEvents.agentId,
      workspaceId: liquidityEvents.workspaceId,
      marketId: liquidityEvents.marketId,
      contributed: sql<number>`coalesce(sum(${liquidityEvents.poolContribution}), 0)::float`,
    })
    .from(liquidityEvents)
    .innerJoin(
      markets,
      and(eq(markets.id, liquidityEvents.marketId), eq(markets.workspaceId, liquidityEvents.workspaceId)),
    )
    .where(and(isNotNull(liquidityEvents.agentId), marketPredicate))
    .groupBy(liquidityEvents.agentId, liquidityEvents.workspaceId, liquidityEvents.marketId);
  for (const f of funding) {
    out.set(`${f.agentId} ${f.workspaceId} ${f.marketId}`, Number(f.contributed));
  }
  return out;
}

/**
 * The markets of `workspaceIds` that at least one trade or position touches.
 * A semi-join on the ledgers rather than an `IN (<ids>)` list, so nothing
 * here is proportional to the number of markets, only to the number of
 * traded ones. Every read in this module that starts from `markets` goes
 * through it: an untraded market cannot change anyone's number.
 */
function tradedIn(workspaceIds: string[]): SQL {
  return sql`${markets.id} in (
    select ${trades.marketId} from ${trades} where ${inArray(trades.workspaceId, workspaceIds)}
    union
    select ${positions.marketId} from ${positions} where ${inArray(positions.workspaceId, workspaceIds)}
  )`;
}

/**
 * The book in the enclosing query has a trade or a position on it: the same
 * membership as `tradedIn`, probed per book through `trades (market_id)` and
 * `positions (market_id)`, for a read whose candidate books are already few.
 */
function tradedHere(): SQL {
  return sql`(exists (select 1 from "trades" tr where tr.market_id = "markets"."id" and tr.workspace_id = "markets"."workspace_id") or exists (select 1 from "positions" po where po.market_id = "markets"."id" and po.workspace_id = "markets"."workspace_id"))`;
}

export async function loadSeasonSettled(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
  opts: SeasonScoreOptions = {},
): Promise<Map<string, number>> {
  return (await loadSeasonSettledSplit(workspaceIds, windowStart, windowEnd, opts)).byId;
}

export interface SeasonScoreOptions {
  /** False for the standings scoped to one floor as a view: a transfer
   *  belongs to no floor, so that view leaves them out
   *  (docs/ui-conventions.md, "The picker scopes the season board too").
   *  Default true: the score. */
  transfers?: boolean;
}

/** A season number with its household fold made visible: `byId` is what the
 *  standings rank (own plus owned accounts), `ownById` the account alone,
 *  `householdById` which accounts each owner's row folds in. */
export interface SeasonScoreSplit {
  byId: Map<string, number>;
  ownById: Map<string, number>;
  householdById: Map<string, string[]>;
}

export async function loadSeasonSettledSplit(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
  opts: SeasonScoreOptions = {},
): Promise<SeasonScoreSplit> {
  if (workspaceIds.length === 0) return { byId: new Map(), ownById: new Map(), householdById: new Map() };
  const own = await loadSeasonSettledTrading(workspaceIds, windowStart, windowEnd);
  // CREDITS TRANSFERRED BETWEEN PARTICIPANTS COUNT (docs/seasons.md, rules
  // amended 2026-09-16): received is profit, sent is loss, at the transfer
  // instant, same window shape as resolutions.
  if (opts.transfers !== false) {
    const transfers = await loadTransferNet(windowStart, windowEnd);
    for (const [agentId, net] of transfers) {
      own.set(agentId, Math.round(((own.get(agentId) ?? 0) + net) * 100) / 100);
    }
  }
  return foldSeason(own);
}

/** YOUR SCORE INCLUDES THE ACCOUNTS YOU OWN (docs/seasons.md), on a season
 *  number: the same fold the board applies, so a standing and a profile
 *  agree about whose bots count where. */
async function foldSeason(own: Map<string, number>): Promise<SeasonScoreSplit> {
  const ownerOf = await loadOwnerOf();
  const byId = foldHouseholds(own, ownerOf);
  return { byId, ownById: own, householdById: householdsOf(byId.keys(), ownerOf) };
}

/**
 * Net credits each participant received minus sent in peer transfers, over
 * `(windowStart, windowEnd]` on the transfer instant, or over all time when
 * both are null. Read from the peer-transfer receipt, never from the ledger
 * reason: a USDC deposit is written as `transfer_in` with no receipt and no
 * counterparty, and must not score.
 */
async function loadTransferNet(windowStart: Date | null, windowEnd: Date | null): Promise<Map<string, number>> {
  const where =
    windowStart && windowEnd
      ? sql`where ${creditTransfers.createdAt} > ${windowStart} and ${creditTransfers.createdAt} <= ${windowEnd}`
      : sql``;
  const rows = await db
    .select({
      agentId: sql<string>`x.agent_id`,
      net: sql<number>`sum(x.delta)::float`,
    })
    .from(
      sql`(
        select ${creditTransfers.toAgentId} as agent_id, ${creditTransfers.credits} as delta
          from ${creditTransfers} ${where}
        union all
        select ${creditTransfers.fromAgentId}, -${creditTransfers.credits}
          from ${creditTransfers} ${where}
      ) as x`,
    )
    .groupBy(sql`x.agent_id`);
  return new Map(rows.map(r => [r.agentId, Math.round(Number(r.net) * 100) / 100]));
}

/**
 * Who owns whom: owned account -> owner participant. A bot registered from
 * a browser account (`agents.ownerUserId`) is owned by the participant that
 * IS that account (`agents.authUserId`); a bot created with an agent key
 * (`agents.ownerAgentId`) by that agent. An owning account with no
 * participant owns nothing here, since there is no row to fold into. The
 * agents table is small (thousands of rows) and this is two indexed reads.
 */
export async function loadOwnerOf(): Promise<Map<string, string>> {
  const owned = await db
    .select({ id: agents.id, ownerAgentId: agents.ownerAgentId, ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(or(isNotNull(agents.ownerAgentId), isNotNull(agents.ownerUserId)));
  const uids = Array.from(new Set(owned.map(r => r.ownerUserId).filter((u): u is string => !!u)));
  const byUid = new Map<string, string>();
  if (uids.length > 0) {
    const humans = await db
      .select({ id: agents.id, authUserId: agents.authUserId })
      .from(agents)
      .where(inArray(agents.authUserId, uids));
    for (const h of humans) if (h.authUserId) byUid.set(h.authUserId, h.id);
  }
  const ownerOf = new Map<string, string>();
  for (const r of owned) {
    const owner = r.ownerAgentId ?? (r.ownerUserId ? byUid.get(r.ownerUserId) : undefined);
    if (owner && owner !== r.id) ownerOf.set(r.id, owner);
  }
  return ownerOf;
}

/** The trading half of the settled score: resolution payouts and refunds
 *  minus net cash on the markets that resolved inside the window, plus the
 *  fault refunds that name those markets. */
async function loadSeasonSettledTrading(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<Map<string, number>> {
  const inWindow = and(
    inArray(markets.workspaceId, workspaceIds),
    // Traded books only, in the shape the partial index `markets (resolved_at)
    // where resolved and traded_volume > 0` serves (docs/infra/deploy.md, "The
    // season's settled half starts from traded books"): a void sets resolved,
    // untraded voids are most of a busy floor's settled books (the Snake voids
    // ~10k a day, the chess floor every option but one, every move), and a
    // book with a trade always has volume.
    eq(markets.resolved, true),
    gt(markets.tradedVolume, 0),
    isNotNull(markets.resolvedAt),
    gt(markets.resolvedAt, windowStart),
    lte(markets.resolvedAt, windowEnd),
    or(eq(markets.voided, true), and(eq(markets.resolved, true), isNotNull(markets.actualValue))),
    // Settled books nobody traded score nobody. Probed per candidate book
    // rather than as the set of every book the workspaces ever traded.
    tradedHere(),
  )!;

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

  const ownPoolFunding = await ownPoolFundingWhere(inWindow);

  const scores = computeSettledWindowProfit(
    marketRows.map(m => ({ ...m, actualValue: m.voided ? null : m.actualValue })),
    aggs.map(a => ({ ...a, shares: Number(a.shares), cost: Number(a.cost) })),
    ownPoolFunding,
  );
  // A FAULT REFUND COUNTS, ON THE MARKET IT NAMES (docs/seasons.md): the
  // platform repaying what its own fault cost a holder is money back on that
  // market, so it is scored with the market, whenever the refund was paid.
  // The only issued credit a season counts. Rare rows, read through the
  // partial index on reason = 'fault_refund'.
  const faultRefunds = await db
    .select({
      agentId: creditLedger.agentId,
      units: sql<number>`coalesce(sum(${creditLedger.deltaUnits}), 0)::float`,
    })
    .from(creditLedger)
    .innerJoin(markets, and(eq(markets.id, creditLedger.refId), eq(markets.workspaceId, creditLedger.workspaceId)))
    .where(and(eq(creditLedger.reason, 'fault_refund'), eq(creditLedger.refType, 'market'), inWindow))
    .groupBy(creditLedger.agentId);
  for (const r of faultRefunds) {
    const credits = fromUnits(Number(r.units));
    scores.set(r.agentId, Math.round(((scores.get(r.agentId) ?? 0) + credits) * 100) / 100);
  }
  return scores;
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
  opts: SeasonScoreOptions = {},
): Promise<Map<string, number>> {
  return (await loadSeasonMarkedSplit(workspaceIds, windowStart, windowEnd, opts)).byId;
}

export async function loadSeasonMarkedSplit(
  workspaceIds: string[],
  windowStart: Date,
  windowEnd: Date,
  opts: SeasonScoreOptions = {},
): Promise<SeasonScoreSplit> {
  if (workspaceIds.length === 0) return { byId: new Map(), ownById: new Map(), householdById: new Map() };

  const settled = await loadSeasonSettledSplit(workspaceIds, windowStart, windowEnd, opts);
  const open = await loadOpenWindowMarked(workspaceIds, windowEnd);

  // Fold on the OWN numbers, then the household: folding a folded map
  // would count a bot twice.
  const own = new Map(settled.ownById);
  for (const [agentId, profit] of open) {
    own.set(agentId, (own.get(agentId) ?? 0) + profit);
  }
  // Both halves are already 2dp; the sum of two 2dp floats is not.
  for (const [agentId, profit] of own) own.set(agentId, Math.round(profit * 100) / 100);
  return foldSeason(own);
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
  // Open, unvoided and traded: the same restriction as the board, for the
  // same reason (an untraded book marks nobody).
  const isOpen = and(
    inArray(markets.workspaceId, workspaceIds),
    eq(markets.resolved, false),
    eq(markets.voided, false),
    tradedIn(workspaceIds),
  )!;
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
    .where(isOpen);

  // Membership is decided by when a market SETTLES, so this half and the
  // settled half agree about the same market (seasonMarketCountsIn).
  const scored = openRows
    .map(m => ({ ...m, resolvesOn: resolveInstantOrNull(m.targetDate) }))
    .filter(m => m.resolvesOn !== null && seasonMarketCountsIn(m, windowEnd));
  if (scored.length === 0) return new Map();

  // No cutoff here either, for the same reason as the settled half: every
  // trade counts, so the marked position is the one actually held. The
  // ledger is joined to the open set by predicate (it used to be one OR
  // branch per market, ten thousand of them on the Snake floor); the rows
  // on open books that settle after the window are dropped here, and the
  // pure function ignores any market it was not handed anyway.
  const scoredKeys = new Set(scored.map(m => `${m.workspaceId} ${m.id}`));
  const aggs = (
    await db
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
      .where(isOpen)
      .groupBy(trades.agentId, trades.workspaceId, trades.marketId, trades.direction)
  ).filter(a => scoredKeys.has(`${a.workspaceId} ${a.marketId}`));

  const ownPoolFunding = await ownPoolFundingWhere(isOpen);

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
    ownPoolFunding,
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

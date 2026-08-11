import { resolutionPayouts } from './amm';

export interface LeaderboardMarket {
  id: string;
  workspaceId: string;
  rangeMin: number;
  rangeMax: number;
  resolved: boolean;
  actualValue: number | null;
}

export interface LeaderboardTrade {
  agentId: string;
  workspaceId: string;
  marketId: string;
  cost: number;
  createdAt: Date | null;
}

export interface LeaderboardPosition {
  agentId: string;
  workspaceId: string;
  marketId: string;
  direction: string;
  shares: number;
}

/** Per-agent trade aggregates, computed in SQL so the route never loads the
 *  full trades table into memory (348k+ rows OOM-killed the instance and the
 *  endpoint returned 503; the leaderboard needs only these three numbers per
 *  agent). */
export interface LeaderboardTradeAggregate {
  agentId: string;
  /** Count of trades on non-voided public-workspace markets. */
  totalTrades: number;
  lastTradeAt: Date | string | null;
  /** Sum of trade costs on resolved (actualValue-bearing) markets; the cost
   *  side of realized PnL. */
  costOnResolved: number;
}

export interface LeaderboardEntry {
  rank: number | null;
  id: string;
  nickname: string | null;
  calibration: number | null;
  accuracy: number | null;
  totalEarnings: number;
  resolvedMarkets: number;
  totalTrades: number;
  lastTradeAt: string | null;
}

interface AgentStats {
  weightSum: number;
  weightedFactor: number;
  correctCount: number;
  resolvedCount: number;
  resolvedMarkets: Set<string>;
  realizedPnl: number;
  totalTrades: number;
  lastTradeAt: Date | null;
}

function emptyStats(): AgentStats {
  return {
    weightSum: 0,
    weightedFactor: 0,
    correctCount: 0,
    resolvedCount: 0,
    resolvedMarkets: new Set(),
    realizedPnl: 0,
    totalTrades: 0,
    lastTradeAt: null,
  };
}

function marketKey(workspaceId: string, marketId: string): string {
  return `${workspaceId} ${marketId}`;
}

/**
 * Compute the leaderboard from already-fetched, public-workspace-scoped data.
 *
 * - calibration: shares-weighted mean payout factor on resolved positions.
 * - accuracy: fraction of resolved positions where payout factor > 0.5.
 * - totalEarnings: realized PnL (sum of payouts minus trade costs) on resolved
 *   markets only. Voided markets must be filtered out by the caller (this
 *   function trusts the input).
 *
 * Ranking: ranked participants (calibration not null) come first, sorted by
 * totalEarnings desc, calibration desc as tiebreaker. Earnings is the primary
 * key because the page sells "success creates real economic value" — sorting
 * on calibration would put a 1-resolved-market lucky bot above a high-earning
 * conviction trader, contradicting the pitch. Unranked participants (no
 * resolved markets) follow, sorted by lastTradeAt desc. Rank numbers are only
 * assigned to ranked participants.
 */
export function computeLeaderboard(
  marketsList: LeaderboardMarket[],
  tradesList: LeaderboardTrade[],
  positionsList: LeaderboardPosition[],
  nicknameById: Map<string, string | null>,
  limit: number,
): LeaderboardEntry[] {
  // Derive the per-agent aggregates the way the SQL route does, then share
  // the assembly path. Kept so the math stays unit-testable from raw rows.
  const marketByKey = new Map<string, LeaderboardMarket>();
  const resolvedKeys = new Set<string>();
  for (const m of marketsList) {
    const k = marketKey(m.workspaceId, m.id);
    marketByKey.set(k, m);
    if (m.resolved && m.actualValue !== null) resolvedKeys.add(k);
  }

  const aggById = new Map<string, LeaderboardTradeAggregate>();
  for (const t of tradesList) {
    const k = marketKey(t.workspaceId, t.marketId);
    if (!marketByKey.has(k)) continue;
    let agg = aggById.get(t.agentId);
    if (!agg) {
      agg = { agentId: t.agentId, totalTrades: 0, lastTradeAt: null, costOnResolved: 0 };
      aggById.set(t.agentId, agg);
    }
    agg.totalTrades += 1;
    if (t.createdAt && (!agg.lastTradeAt || t.createdAt > new Date(agg.lastTradeAt))) {
      agg.lastTradeAt = t.createdAt;
    }
    if (resolvedKeys.has(k)) agg.costOnResolved += t.cost;
  }

  const resolvedMarkets = marketsList.filter(m => m.resolved && m.actualValue !== null);
  return computeLeaderboardFromAggregates(
    resolvedMarkets, Array.from(aggById.values()), positionsList, nicknameById, limit,
  );
}

/**
 * Assemble the leaderboard from pre-aggregated trade stats plus raw position
 * rows on resolved markets. This is the shape the route feeds after SQL-side
 * aggregation; only resolved markets and their positions are needed here.
 */
export function computeLeaderboardFromAggregates(
  resolvedMarkets: LeaderboardMarket[],
  tradeAggs: LeaderboardTradeAggregate[],
  positionsList: LeaderboardPosition[],
  nicknameById: Map<string, string | null>,
  limit: number,
  /** Unrealized PnL on OPEN positions marked to current price, by agent
   *  (owner direction 2026-08-11: rank by total profit, positions
   *  included). Added into totalEarnings so a market that has not resolved
   *  yet still produces a real ranking. */
  unrealizedByAgent?: Map<string, number>,
): LeaderboardEntry[] {
  const resolvedFactorsByKey = new Map<string, [number, number]>();
  for (const m of resolvedMarkets) {
    if (!m.resolved || m.actualValue === null) continue;
    const actual = Math.min(m.actualValue, m.rangeMax);
    resolvedFactorsByKey.set(marketKey(m.workspaceId, m.id), resolutionPayouts(actual, m.rangeMin, m.rangeMax));
  }

  const stats = new Map<string, AgentStats>();
  const ensure = (id: string): AgentStats => {
    let s = stats.get(id);
    if (!s) { s = emptyStats(); stats.set(id, s); }
    return s;
  };

  for (const agg of tradeAggs) {
    const s = ensure(agg.agentId);
    s.totalTrades += agg.totalTrades;
    const at = agg.lastTradeAt ? new Date(agg.lastTradeAt) : null;
    if (at && (!s.lastTradeAt || at > s.lastTradeAt)) s.lastTradeAt = at;
    s.realizedPnl -= agg.costOnResolved;
  }

  for (const p of positionsList) {
    if (p.shares <= 0) continue;
    const k = marketKey(p.workspaceId, p.marketId);
    const factors = resolvedFactorsByKey.get(k);
    if (!factors) continue;
    const factor = p.direction === 'higher' ? factors[1] : factors[0];
    const s = ensure(p.agentId);
    s.weightSum += p.shares;
    s.weightedFactor += p.shares * factor;
    s.resolvedCount += 1;
    s.resolvedMarkets.add(k);
    if (factor > 0.5) s.correctCount += 1;
    s.realizedPnl += p.shares * factor;
  }

  // Every agent with an open position also belongs on the board, even with
  // no resolved trade yet (the LookPilot case pre-December).
  if (unrealizedByAgent) for (const id of unrealizedByAgent.keys()) ensure(id);

  type Entry = Omit<LeaderboardEntry, 'rank'>;
  const entries: Entry[] = [];
  for (const [id, s] of stats) {
    const calibration = s.weightSum > 0 ? s.weightedFactor / s.weightSum : null;
    const accuracy = s.resolvedCount > 0 ? s.correctCount / s.resolvedCount : null;
    // Total profit = realized (resolved) + unrealized (open positions at
    // current price). This is what the board ranks on (owner 2026-08-11).
    const totalProfit = s.realizedPnl + (unrealizedByAgent?.get(id) ?? 0);
    entries.push({
      id,
      nickname: nicknameById.get(id) ?? null,
      calibration,
      accuracy,
      totalEarnings: Math.round(totalProfit * 10000) / 10000,
      resolvedMarkets: s.resolvedMarkets.size,
      totalTrades: s.totalTrades,
      lastTradeAt: s.lastTradeAt ? s.lastTradeAt.toISOString() : null,
    });
  }

  // Profit first (owner direction 2026-08-11), most recent trade as the
  // tiebreak. Everyone with any activity gets a rank now.
  entries.sort((a, b) => {
    if (b.totalEarnings !== a.totalEarnings) return b.totalEarnings - a.totalEarnings;
    const aTime = a.lastTradeAt ? Date.parse(a.lastTradeAt) : 0;
    const bTime = b.lastTradeAt ? Date.parse(b.lastTradeAt) : 0;
    return bTime - aTime;
  });

  let nextRank = 1;
  return entries.slice(0, limit).map(e => ({
    rank: nextRank++,
    ...e,
  }));
}

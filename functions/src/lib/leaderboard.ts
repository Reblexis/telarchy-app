import { consensus, resolutionPayouts } from './amm';

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
  /** Gross cost paid into this position. Only the profit formula reads it,
   *  and only on voided markets, where it IS the refund: voidMarket credits
   *  positions.totalCost back and never touches shares, so a position that
   *  was partly or wholly sold before the void still refunds its full basis. */
  totalCost?: number;
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

/** A market as the profit formula needs to see it: enough to say what a
 *  holding is worth right now, whether it is open, resolved, or voided. */
export interface ProfitMarket extends LeaderboardMarket {
  shares: [number, number] | null;
  liquidity: number;
  /** Voided markets pay their holders back at cost instead of at a price. */
  voided: boolean;
}

/**
 * What one share of each direction is worth on this market right now:
 * the resolution payout factors once it has resolved, the market's own
 * current call before that. Returns null for a market with no price yet
 * (zero liquidity), whose positions therefore cannot be valued.
 *
 * Callers must exclude voided markets: a void refunds the cash, so those
 * positions are worth nothing AND cost nothing, and counting one side
 * without the other invents a loss.
 */
export function currentPayoutFactors(m: ProfitMarket): [number, number] | null {
  if (m.resolved && m.actualValue !== null) {
    return resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax);
  }
  const c = consensus(m.shares ?? [0, 0], m.liquidity, m.rangeMin, m.rangeMax);
  if (c === undefined) return null;
  const p = Math.max(0, Math.min(1, (c - m.rangeMin) / (m.rangeMax - m.rangeMin)));
  return [1 - p, p];
}

/**
 * Trading profit marked to market, the number both the public board and a
 * participant's own profile rank and report (owner direction 2026-08-14):
 *
 *   profit = what the positions are worth now - net cash paid for them
 *
 * "Worth now" is the resolution payout on resolved markets, the live price
 * on open ones, and the REFUND on voided ones, so an unresolved position
 * counts the moment its price moves and a cancelled market counts what it
 * actually paid back. Net cash comes from the trade rows (sells are stored
 * negative), so the result never includes credits the platform granted,
 * which is what lets house accounts be ranked beside everyone else instead
 * of excluded.
 *
 * Voiding is why this cannot simply skip cancelled markets. A void refunds
 * positions.totalCost, the GROSS cost paid in, and selling never reduces
 * that field, so a trader who sold half a position and was then refunded
 * the whole basis really did end up ahead. Dropping voided markets from
 * both sides reports that trader as flat; counting the refund as value
 * against the net cash they paid reports what the ledger actually did.
 */
export function computeTradingProfit(
  marketsList: ProfitMarket[],
  netCashByAgent: Map<string, number>,
  positionsList: LeaderboardPosition[],
): Map<string, number> {
  const factorsByKey = new Map<string, [number, number]>();
  const voidedKeys = new Set<string>();
  for (const m of marketsList) {
    const key = marketKey(m.workspaceId, m.id);
    if (m.voided) { voidedKeys.add(key); continue; }
    const factors = currentPayoutFactors(m);
    if (factors) factorsByKey.set(key, factors);
  }
  const valueByAgent = new Map<string, number>();
  for (const p of positionsList) {
    const key = marketKey(p.workspaceId, p.marketId);
    // A voided position is worth its refund, whatever is left of it: the
    // shares are meaningless after a cancel, and a fully sold-out position
    // still had its basis returned.
    if (voidedKeys.has(key)) {
      const refund = p.totalCost ?? 0;
      if (refund > 0) valueByAgent.set(p.agentId, (valueByAgent.get(p.agentId) ?? 0) + refund);
      continue;
    }
    if (p.shares <= 0) continue;
    const factors = factorsByKey.get(key);
    if (!factors) continue;
    const factor = p.direction === 'higher' ? factors[1] : factors[0];
    valueByAgent.set(p.agentId, (valueByAgent.get(p.agentId) ?? 0) + p.shares * factor);
  }
  const out = new Map<string, number>();
  for (const id of new Set([...valueByAgent.keys(), ...netCashByAgent.keys()])) {
    const profit = (valueByAgent.get(id) ?? 0) - (netCashByAgent.get(id) ?? 0);
    out.set(id, Math.round(profit * 100) / 100);
  }
  return out;
}

/** Per-agent quality stats on markets that have actually resolved. The board
 *  does not RANK on these (owner direction 2026-08-11: rank on profit marked
 *  to market), but it reports them, so a visitor can tell a lucky big bet
 *  from a consistently well-calibrated forecaster. */
export interface CalibrationStats {
  calibration: number | null;
  accuracy: number | null;
  resolvedMarkets: number;
}

/**
 * Shares-weighted mean payout factor (calibration) and win rate (accuracy)
 * over resolved, non-voided markets. Callers pass only resolved markets and
 * the positions still held on them; voided markets must be filtered out
 * upstream (this function trusts its input).
 */
export function computeCalibrationStats(
  resolvedMarkets: LeaderboardMarket[],
  positionsList: LeaderboardPosition[],
): Map<string, CalibrationStats> {
  const factorsByKey = new Map<string, [number, number]>();
  for (const m of resolvedMarkets) {
    if (!m.resolved || m.actualValue === null) continue;
    const actual = Math.min(m.actualValue, m.rangeMax);
    factorsByKey.set(marketKey(m.workspaceId, m.id), resolutionPayouts(actual, m.rangeMin, m.rangeMax));
  }
  const acc = new Map<string, { weightSum: number; weightedFactor: number; correct: number; n: number; markets: Set<string> }>();
  for (const p of positionsList) {
    if (p.shares <= 0) continue;
    const k = marketKey(p.workspaceId, p.marketId);
    const factors = factorsByKey.get(k);
    if (!factors) continue;
    const factor = p.direction === 'higher' ? factors[1] : factors[0];
    let s = acc.get(p.agentId);
    if (!s) { s = { weightSum: 0, weightedFactor: 0, correct: 0, n: 0, markets: new Set() }; acc.set(p.agentId, s); }
    s.weightSum += p.shares;
    s.weightedFactor += p.shares * factor;
    s.n += 1;
    s.markets.add(k);
    if (factor > 0.5) s.correct += 1;
  }
  const out = new Map<string, CalibrationStats>();
  for (const [id, s] of acc) {
    out.set(id, {
      calibration: s.weightSum > 0 ? s.weightedFactor / s.weightSum : null,
      accuracy: s.n > 0 ? s.correct / s.n : null,
      resolvedMarkets: s.markets.size,
    });
  }
  return out;
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

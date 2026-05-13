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
  const marketByKey = new Map<string, LeaderboardMarket>();
  const resolvedFactorsByKey = new Map<string, [number, number]>();
  for (const m of marketsList) {
    const k = marketKey(m.workspaceId, m.id);
    marketByKey.set(k, m);
    if (m.resolved && m.actualValue !== null) {
      const actual = Math.min(m.actualValue, m.rangeMax);
      resolvedFactorsByKey.set(k, resolutionPayouts(actual, m.rangeMin, m.rangeMax));
    }
  }

  const stats = new Map<string, AgentStats>();
  const ensure = (id: string): AgentStats => {
    let s = stats.get(id);
    if (!s) { s = emptyStats(); stats.set(id, s); }
    return s;
  };

  for (const t of tradesList) {
    const k = marketKey(t.workspaceId, t.marketId);
    if (!marketByKey.has(k)) continue;
    const s = ensure(t.agentId);
    s.totalTrades += 1;
    if (t.createdAt && (!s.lastTradeAt || t.createdAt > s.lastTradeAt)) {
      s.lastTradeAt = t.createdAt;
    }
    if (resolvedFactorsByKey.has(k)) {
      s.realizedPnl -= t.cost;
    }
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

  type Entry = Omit<LeaderboardEntry, 'rank'>;
  const entries: Entry[] = [];
  for (const [id, s] of stats) {
    const calibration = s.weightSum > 0 ? s.weightedFactor / s.weightSum : null;
    const accuracy = s.resolvedCount > 0 ? s.correctCount / s.resolvedCount : null;
    entries.push({
      id,
      nickname: nicknameById.get(id) ?? null,
      calibration,
      accuracy,
      totalEarnings: Math.round(s.realizedPnl * 10000) / 10000,
      resolvedMarkets: s.resolvedMarkets.size,
      totalTrades: s.totalTrades,
      lastTradeAt: s.lastTradeAt ? s.lastTradeAt.toISOString() : null,
    });
  }

  entries.sort((a, b) => {
    const aRanked = a.calibration !== null;
    const bRanked = b.calibration !== null;
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked && bRanked) {
      if (b.totalEarnings !== a.totalEarnings) return b.totalEarnings - a.totalEarnings;
      if (b.calibration! !== a.calibration!) return b.calibration! - a.calibration!;
    }
    const aTime = a.lastTradeAt ? Date.parse(a.lastTradeAt) : 0;
    const bTime = b.lastTradeAt ? Date.parse(b.lastTradeAt) : 0;
    return bTime - aTime;
  });

  let nextRank = 1;
  return entries.slice(0, limit).map(e => ({
    rank: e.calibration !== null ? nextRank++ : null,
    ...e,
  }));
}

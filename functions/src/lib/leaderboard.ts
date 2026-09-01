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

/** Key for the voided-stake map: one entry per (agent, cancelled market). */
export function voidedStakeKey(agentId: string, workspaceId: string, marketId: string): string {
  return `${agentId}\u0000${workspaceId}\u0000${marketId}`;
}

/** A market as the profit formula needs to see it: enough to say what a
 *  holding is worth right now, whether it is open, resolved, or voided. */
export interface ProfitMarket extends LeaderboardMarket {
  shares: [number, number] | null;
  liquidity: number;
  /** Voided markets pay their holders a refund instead of a price. */
  voided: boolean;
}

/**
 * What one share of each direction is worth on this market right now:
 * the resolution payout factors once it has resolved, the market's own
 * current call before that. Returns null for a market with no price yet
 * (zero liquidity), whose positions therefore cannot be valued.
 *
 * Never called for a voided market: a cancelled market pays a refund, not a
 * price, and computeTradingProfit skips it before reaching here.
 *
 * This is the whole of the board's mark (owner decision 2026-08-19, revising
 * the liquidation mark of the same day): an open holding is valued as if the
 * market resolved at the number the market currently calls. Known and
 * accepted, see docs/seasons.md F1.
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
 * "Worth now" is the payout factor the market is calling right now: the
 * resolution payout once it has resolved, and the SAME FORMULA AT THE CURRENT
 * CONSENSUS before that, so a holding is valued as if the market resolved
 * today at the number it currently calls. Voided markets pay their REFUND. An
 * unresolved position therefore counts the moment its price moves, and a
 * cancelled market counts what it actually paid back.
 *
 * Owner decision 2026-08-19, revising the liquidation mark shipped the same
 * day (docs/seasons.md F1): "it will eventually resolve at the correct value".
 * The known cost is that an LMSR fills you below the price you end at, so a
 * buy books the spread as paper profit the instant it lands, and the desk's
 * "worth" line (liquidation value, what a sell would really pay) reads lower
 * than the board does. Both are recorded in F1 and in the Season 0 rules.
 *
 * Net cash comes from the trade rows (sells are stored negative), so the result never includes credits the platform granted,
 * which is what lets house accounts be ranked beside everyone else instead
 * of excluded.
 *
 * Voiding is why this cannot simply skip cancelled markets. A void refunds
 * the participant's net cash on that market floored at zero (docs/vision.md,
 * "a void refunds net cash, not gross cost"), so the cancelled market's
 * contribution is that refund minus the same net cash: exactly zero for
 * anyone who was still in it, and the realised gain for anyone who sold out
 * above cost and keeps it. Dropping cancelled markets from both sides would
 * silently erase that gain.
 */
export function computeTradingProfit(
  marketsList: ProfitMarket[],
  netCashByAgent: Map<string, number>,
  positionsList: LeaderboardPosition[],
  /** Net cash each agent has on each VOIDED market, keyed by
   *  voidedStakeKey(agentId, workspaceId, marketId). The refund is this
   *  floored at zero, so callers pass the raw sum and the flooring happens
   *  here, in one place, next to the rule it implements. */
  voidedStake?: Map<string, number>,
): Map<string, number> {
  const value = positionValues(marketsList, positionsList, voidedStake);
  const out = new Map<string, number>();
  for (const id of new Set([...value.keys(), ...netCashByAgent.keys()])) {
    const v = value.get(id);
    const profit = (v?.settled ?? 0) + (v?.open ?? 0) - (netCashByAgent.get(id) ?? 0);
    out.set(id, Math.round(profit * 100) / 100);
  }
  return out;
}

/** A market whose money is final: it resolved to a number, or it was
 *  cancelled and refunded. Everything else is still a mark. The SQL side of
 *  the board (`lib/board.ts`) filters on the same predicate. */
export function isSettledMarket(m: Pick<ProfitMarket, 'resolved' | 'actualValue' | 'voided'>): boolean {
  return m.voided || (m.resolved && m.actualValue !== null);
}

/** A market as the season's settled-window score needs it: what it resolved
 *  to (null when it was cancelled instead). */
export interface SettledWindowMarket {
  id: string;
  workspaceId: string;
  rangeMin: number;
  rangeMax: number;
  /** Null exactly when the market was voided: it paid a refund, not a price. */
  actualValue: number | null;
  voided: boolean;
}

/** Per (agent, market, direction) sums over the COUNTED trades of one
 *  settled-window market: every trade up to the cutoff before its resolve
 *  instant. Sells are stored negative, so `shares` is the position held at
 *  the cutoff and `cost` the net cash paid for it. The SQL side is
 *  `lib/board.ts` loadSeasonSettled. */
export interface SettledWindowTradeAgg {
  agentId: string;
  workspaceId: string;
  marketId: string;
  direction: string;
  shares: number;
  cost: number;
}

/**
 * The season score since the 2026-08-29 amendment (docs/seasons.md, "The
 * score"): settled profit over the markets that resolved, or were cancelled
 * and refunded, inside the season window.
 *
 *   score = resolution payouts on counted shares
 *         + void refunds on counted net cash
 *         - counted net cash
 *
 * "Counted" excludes each market's final SEASON_TRADE_CUTOFF_HOURS
 * (lib/seasons.ts): the caller aggregates only trades up to the cutoff, so
 * an entrant's scored position is what they held when the cutoff fell.
 * A void contributes max(0, netCash) - netCash: exactly zero for anyone
 * still in the market, and the realised gain for anyone who sold out above
 * cost, the same convention computeTradingProfit uses. Nothing marked ever
 * enters: a market absent from `marketsList` (still open, or resolved
 * outside the window) contributes nothing.
 */
export function computeSettledWindowProfit(
  marketsList: SettledWindowMarket[],
  aggs: SettledWindowTradeAgg[],
  ownPoolFunding?: Map<string, number>,
): Map<string, number> {
  return windowProfit(
    marketsList,
    aggs,
    m =>
      m.voided || m.actualValue === null
        ? null
        : resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax),
    ownPoolFunding,
  );
}

/**
 * The same window, valued at the CURRENT CALL rather than only at what has
 * already resolved: a market that has resolved contributes its payout, and
 * one still open contributes what it would pay if it resolved right now at
 * the price the book is calling (`currentPayoutFactors`, the board's mark).
 *
 * This is the standings' display column, never the score
 * (docs/seasons.md, "The standings show the mark beside the score"). Which
 * markets belong to the window is the CALLER's decision and the whole
 * difference between the two functions: `lib/board.ts` loadSeasonMarked
 * passes the settled window plus the open markets that resolve on or before
 * the season's end, because a resolution after the end pays no season prize.
 */
export function computeMarkedWindowProfit(
  marketsList: ProfitMarket[],
  aggs: SettledWindowTradeAgg[],
): Map<string, number> {
  return windowProfit(marketsList, aggs, m => (m.voided ? null : currentPayoutFactors(m as ProfitMarket)));
}

/**
 * One loop, two callers. The arithmetic that turns per-(agent, market,
 * direction) trade sums into profit is identical whether a market's payout
 * factors come from its resolution or from its live call; only where the
 * factors come from differs, so only that is a parameter. Two copies of this
 * loop would be two answers to "what has this person made", which is the
 * failure mode `season-scoring-ownership.test.ts` exists to prevent.
 */
function windowProfit<M extends SettledWindowMarket>(
  marketsList: M[],
  aggs: SettledWindowTradeAgg[],
  factorsFor: (m: M) => [number, number] | null,
  /** Pool credits each agent put into each market, keyed
   *  `${agentId} ${workspaceId} ${marketId}`. Absent means none known, which
   *  scores exactly as it did before. */
  ownPoolFunding?: Map<string, number>,
): Map<string, number> {
  const marketByKey = new Map<string, M>();
  const factorsByKey = new Map<string, [number, number]>();
  for (const m of marketsList) {
    const k = marketKey(m.workspaceId, m.id);
    marketByKey.set(k, m);
    const factors = factorsFor(m);
    if (factors) factorsByKey.set(k, factors);
  }

  // A void refunds NET cash per (agent, market), both directions summed and
  // floored at zero, so voided markets accumulate cash per agent-market
  // before the flooring.
  const out = new Map<string, number>();
  const perAgentMarket = new Map<string, { agentId: string; key: string; profit: number }>();
  const voidedCash = new Map<string, { agentId: string; netCash: number }>();
  const add = (agentId: string, amount: number) => {
    out.set(agentId, (out.get(agentId) ?? 0) + amount);
  };

  for (const a of aggs) {
    const k = marketKey(a.workspaceId, a.marketId);
    const m = marketByKey.get(k);
    if (!m) continue;
    if (m.voided) {
      const vk = `${a.agentId} ${k}`;
      const v = voidedCash.get(vk) ?? { agentId: a.agentId, netCash: 0 };
      v.netCash += a.cost;
      voidedCash.set(vk, v);
      continue;
    }
    const factors = factorsByKey.get(k);
    if (!factors) continue;
    // Counted shares cannot go negative for an honestly built ledger (a sell
    // never precedes the buys it unwinds), but the participant-deletion
    // unwind gap can leave orphans; never pay a negative holding.
    const held = Math.max(0, a.shares);
    const payout = held * (a.direction === 'higher' ? factors[1] : factors[0]);
    // Per (agent, market), not straight into the total: the own-funding
    // offset below is per market and has to see both directions of it.
    const pk = `${a.agentId} ${k}`;
    const prev = perAgentMarket.get(pk) ?? { agentId: a.agentId, key: k, profit: 0 };
    prev.profit += payout - a.cost;
    perAgentMarket.set(pk, prev);
  }

  // PROFIT OUT OF A BOOK YOU FUNDED IS NOT SCORE, up to what you put into
  // that market's pool.
  //
  // The Terms have always said buying liquidity "confers no contest entry,
  // standing, or score" (section 2), and the scoring did not enforce it:
  // trading profit counted while the LP loss on the other side of the SAME
  // account did not, so funding your own market and trading against it turned
  // pool credits into season score roughly one for one (owner decision
  // 2026-09-01, docs/seasons.md).
  //
  // Floored at zero rather than turned into a loss, which is what keeps it
  // from being a penalty on liquidity: an LP who does not trade their own
  // book has no profit to reduce, and someone who won MORE than they funded
  // keeps the excess, because that part was risk against other people. A
  // genuine trading loss is left alone.
  for (const e of perAgentMarket.values()) {
    const ownFunding = ownPoolFunding?.get(`${e.agentId} ${e.key}`) ?? 0;
    const adjusted = e.profit > 0 ? Math.max(0, e.profit - ownFunding) : e.profit;
    add(e.agentId, adjusted);
  }

  for (const v of voidedCash.values()) {
    add(v.agentId, Math.max(0, v.netCash) - v.netCash);
  }

  for (const [id, profit] of out) out.set(id, Math.round(profit * 100) / 100);
  return out;
}

/** What each agent's holdings are worth, split by whether that worth is
 *  final (resolution payouts, void refunds) or a mark at the current call. */
function positionValues(
  marketsList: ProfitMarket[],
  positionsList: LeaderboardPosition[],
  voidedStake?: Map<string, number>,
): Map<string, { settled: number; open: number }> {
  const marketByKey = new Map<string, ProfitMarket>();
  for (const m of marketsList) {
    // A cancelled market is never valued at a price, whatever its row still
    // says its shares are: it pays a refund, handled below.
    if (m.voided) continue;
    marketByKey.set(marketKey(m.workspaceId, m.id), m);
  }
  const valueByAgent = new Map<string, { settled: number; open: number }>();
  const add = (agentId: string, side: 'settled' | 'open', amount: number) => {
    const v = valueByAgent.get(agentId) ?? { settled: 0, open: 0 };
    v[side] += amount;
    valueByAgent.set(agentId, v);
  };
  for (const p of positionsList) {
    if (p.shares <= 0) continue;
    const m = marketByKey.get(marketKey(p.workspaceId, p.marketId));
    if (!m) continue;
    // One path, resolved or not: the payout factor is per-share and additive,
    // and before resolution the market's own call stands in for the outcome.
    const factors = currentPayoutFactors(m);
    if (!factors) continue;
    const worth = p.shares * (p.direction === 'higher' ? factors[1] : factors[0]);
    add(p.agentId, isSettledMarket(m) ? 'settled' : 'open', worth);
  }
  if (voidedStake) {
    for (const [key, netCash] of voidedStake) {
      const refund = Math.max(0, netCash);
      if (refund <= 0) continue;
      const agentId = key.slice(0, key.indexOf('\u0000'));
      add(agentId, 'settled', refund);
    }
  }
  return valueByAgent;
}

export interface ProfitBreakdown {
  /** Final money: payouts on resolved markets and refunds on cancelled ones,
   *  minus the net cash paid on those markets. */
  settled: number;
  /** Still a mark: open positions at the current call, minus their net cash. */
  open: number;
  /** settled + open, and identical to computeTradingProfit for the agent. */
  total: number;
}

/**
 * The same profit as computeTradingProfit, split into what is final and what
 * is still a mark (owner direction 2026-08-24, docs/seasons.md "The score").
 * `netCashSettledByAgent` is each agent's net cash on settled markets only
 * (isSettledMarket); the open side is the remainder, so total = settled + open
 * holds exactly and the ranking number never changes by being split.
 */
export function computeProfitBreakdown(
  marketsList: ProfitMarket[],
  netCashByAgent: Map<string, number>,
  netCashSettledByAgent: Map<string, number>,
  positionsList: LeaderboardPosition[],
  voidedStake?: Map<string, number>,
): Map<string, ProfitBreakdown> {
  const value = positionValues(marketsList, positionsList, voidedStake);
  const total = computeTradingProfit(marketsList, netCashByAgent, positionsList, voidedStake);
  const out = new Map<string, ProfitBreakdown>();
  for (const [id, t] of total) {
    const settled = Math.round(((value.get(id)?.settled ?? 0) - (netCashSettledByAgent.get(id) ?? 0)) * 100) / 100;
    out.set(id, { settled, open: Math.round((t - settled) * 100) / 100, total: t });
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
  const acc = new Map<
    string,
    { weightSum: number; weightedFactor: number; correct: number; n: number; markets: Set<string> }
  >();
  for (const p of positionsList) {
    if (p.shares <= 0) continue;
    const k = marketKey(p.workspaceId, p.marketId);
    const factors = factorsByKey.get(k);
    if (!factors) continue;
    const factor = p.direction === 'higher' ? factors[1] : factors[0];
    let s = acc.get(p.agentId);
    if (!s) {
      s = { weightSum: 0, weightedFactor: 0, correct: 0, n: 0, markets: new Set() };
      acc.set(p.agentId, s);
    }
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
    resolvedMarkets,
    Array.from(aggById.values()),
    positionsList,
    nicknameById,
    limit,
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
    if (!s) {
      s = emptyStats();
      stats.set(id, s);
    }
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

/**
 * Scoring and distribution for workspace prize pools
 * (docs/workspace-pools.md). Pure: takes rows, returns numbers.
 */

import { resolutionPayouts } from './amm';

export interface PoolTradeRow {
  agentId: string;
  marketId: string;
  direction: 'lower' | 'higher';
  /** Positive on a buy, negative on a sell. */
  shares: number;
  /** Cash paid (buys positive, sells negative), in credits. */
  cost: number;
  createdAt: Date;
}

export interface PoolMarketRow {
  marketId: string;
  voided: boolean;
  actualValue: number | null;
  rangeMin: number;
  rangeMax: number;
}

export interface PoolScore {
  agentId: string;
  /** Net settled profit in credits. */
  score: number;
  tradeCount: number;
  marketCount: number;
  earlyTradeCount: number;
}

/**
 * Net settled profit per trader from the trades in `trades` (already filtered
 * to the month and to markets resolved inside it). On each market, only the
 * net shares the month's trades acquired count, valued at settlement, plus
 * the cash of those trades. A sell that exceeds what the month bought is
 * selling pre-month shares: that excess and its cash stay outside the score.
 * A voided market contributes zero.
 */
export function scorePoolTrades(
  trades: PoolTradeRow[],
  marketsById: Map<string, PoolMarketRow>,
  finalWeekStart: Date,
): PoolScore[] {
  type Leg = { bought: number; buyCash: number; sold: number; sellCash: number };
  const perAgent = new Map<
    string,
    { legs: Map<string, { lower: Leg; higher: Leg }>; tradeCount: number; early: number }
  >();
  const emptyLeg = (): Leg => ({ bought: 0, buyCash: 0, sold: 0, sellCash: 0 });

  for (const t of trades) {
    const market = marketsById.get(t.marketId);
    if (!market) continue;
    let a = perAgent.get(t.agentId);
    if (!a) {
      a = { legs: new Map(), tradeCount: 0, early: 0 };
      perAgent.set(t.agentId, a);
    }
    a.tradeCount++;
    if (t.createdAt < finalWeekStart) a.early++;
    let legs = a.legs.get(t.marketId);
    if (!legs) {
      legs = { lower: emptyLeg(), higher: emptyLeg() };
      a.legs.set(t.marketId, legs);
    }
    const leg = t.direction === 'higher' ? legs.higher : legs.lower;
    if (t.shares >= 0) {
      leg.bought += t.shares;
      leg.buyCash += t.cost;
    } else {
      leg.sold += -t.shares;
      leg.sellCash += -t.cost;
    }
  }

  const out: PoolScore[] = [];
  for (const [agentId, a] of perAgent) {
    let score = 0;
    let marketCount = 0;
    for (const [marketId, legs] of a.legs) {
      marketCount++;
      const market = marketsById.get(marketId);
      if (!market || market.voided || market.actualValue === null) continue;
      const [lowerPay, higherPay] = resolutionPayouts(market.actualValue, market.rangeMin, market.rangeMax);
      for (const [dir, leg] of [
        ['lower', legs.lower],
        ['higher', legs.higher],
      ] as const) {
        const pay = dir === 'higher' ? higherPay : lowerPay;
        const soldOfMonth = Math.min(leg.sold, leg.bought);
        const sellCashOfMonth = leg.sold > 0 ? leg.sellCash * (soldOfMonth / leg.sold) : 0;
        const netShares = leg.bought - soldOfMonth;
        score += netShares * pay - leg.buyCash + sellCashOfMonth;
      }
    }
    out.push({
      agentId,
      score: Math.round(score * 100) / 100,
      tradeCount: a.tradeCount,
      marketCount,
      earlyTradeCount: a.early,
    });
  }
  return out.sort((x, y) => y.score - x.score || x.agentId.localeCompare(y.agentId));
}

/** The activity floor, part of the platform's distribution rule. */
export const ACTIVITY_FLOOR = { trades: 10, markets: 2, earlyTrades: 3 } as const;

export function meetsActivityFloor(s: { tradeCount: number; marketCount: number; earlyTradeCount: number }): boolean {
  return (
    s.tradeCount >= ACTIVITY_FLOOR.trades &&
    s.marketCount >= ACTIVITY_FLOOR.markets &&
    s.earlyTradeCount >= ACTIVITY_FLOOR.earlyTrades
  );
}

export type PoolExclusion =
  | 'owner_or_admin'
  | 'shared_payout'
  | 'platform_operated'
  | 'activity_floor'
  | 'non_positive';

export interface PoolEntry extends PoolScore {
  eligible: boolean;
  exclusion: PoolExclusion | null;
  share: number;
  payoutCents: number;
  rank: number | null;
}

/**
 * Split a pool by score squared among eligible traders with a positive score.
 * Cents are integers; the last recipient absorbs rounding so the sum is exact.
 */
export function distributePool(
  scores: PoolScore[],
  poolCents: number,
  exclusions: Map<string, Exclude<PoolExclusion, 'activity_floor' | 'non_positive'>>,
): PoolEntry[] {
  const entries: PoolEntry[] = scores.map(s => {
    const hard = exclusions.get(s.agentId) ?? null;
    let exclusion: PoolExclusion | null = hard;
    if (!exclusion && !meetsActivityFloor(s)) exclusion = 'activity_floor';
    if (!exclusion && s.score <= 0) exclusion = 'non_positive';
    return { ...s, eligible: exclusion === null, exclusion, share: 0, payoutCents: 0, rank: null };
  });
  const eligible = entries.filter(e => e.eligible);
  const weight = (e: PoolEntry) => e.score * e.score;
  const total = eligible.reduce((sum, e) => sum + weight(e), 0);
  if (total > 0 && poolCents > 0) {
    let assigned = 0;
    eligible.forEach((e, i) => {
      e.share = weight(e) / total;
      e.payoutCents = i === eligible.length - 1 ? poolCents - assigned : Math.floor(poolCents * e.share);
      assigned += e.payoutCents;
    });
  } else if (total > 0) {
    for (const e of eligible) e.share = weight(e) / total;
  }
  entries.sort((x, y) => y.score - x.score || x.agentId.localeCompare(y.agentId));
  let rank = 0;
  for (const e of entries) {
    if (e.score > 0) e.rank = ++rank;
  }
  return entries;
}

/** Group payout-method objects so accounts sharing one are linked. */
export function payoutFingerprint(method: unknown): string | null {
  if (!method || typeof method !== 'object') return null;
  const m = method as Record<string, unknown>;
  const norm = (v: unknown) =>
    String(v ?? '')
      .replace(/\s+/g, '')
      .toLowerCase();
  switch (m.provider) {
    case 'paypal':
    case 'wise':
      return `${m.provider}:${norm(m.email)}`;
    case 'bank':
      return `bank:${norm(m.iban)}`;
    case 'crypto':
      return `crypto:${norm(m.network)}:${norm(m.address)}`;
    case 'revolut':
      return `revolut:${norm(m.handle)}`;
    case 'other':
      return `other:${norm(m.details)}`;
    default:
      return null;
  }
}

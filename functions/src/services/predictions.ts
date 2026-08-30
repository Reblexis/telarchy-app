import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, liquidityEvents, markets, positions, proposals, trades } from '../db/schema';
import { consensus, pHigher, resolutionPayouts } from '../lib/amm';
import { periodEndInstant, resolutionInstant } from '../lib/date-utils';
import { onPricesChanged } from '../lib/market-events';
import { ttlCache } from '../lib/ttl-cache';
import { toUnits } from '../lib/validation';
import type { Metric } from '../types';
import { applyCredits } from './credits';
import { emitEvent } from './events';
import { distributeLPLeftover, voidMarket } from './markets';
import { getAllMetrics, metricValueAsOf } from './metrics';
import { notifyMarketResolved } from './notifications';
import { releaseLimitOrdersForMarket } from './trading';

type MarketRow = typeof markets.$inferSelect;

export async function resolveSingleMarket(
  marketId: string,
  workspaceId: string,
): Promise<{ resolved: boolean; totalPayout: number; skipped?: boolean }> {
  const [market] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) return { resolved: false, totalPayout: 0, skipped: true };
  if (market.resolved) return { resolved: false, totalPayout: 0, skipped: true };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));
  const result = await resolveMarketRow(market, metricMap, workspaceId);
  return { resolved: !result.skipped, totalPayout: result.totalPayout, skipped: result.skipped };
}

async function resolveMarketRow(
  market: MarketRow,
  metricMap: Map<string, Metric>,
  workspaceId: string,
): Promise<{ positions: number; totalPayout: number; skipped?: boolean }> {
  const metric = metricMap.get(market.metricId);
  if (!metric) {
    console.error(`Market ${market.id} (${market.metricName}): metric ${market.metricId} not found, skipping`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }
  // Settle on the metric value as of resolvesOn (the period-end boundary),
  // not the live value at whatever moment the resolve cron happens to fire.
  // The cron drifts (observed +12s to +80min), and value-at-cron-time made
  // hour markets resolve against the previous or next hour's reading
  // depending on that race. The fixing is deterministic: updates landing
  // after the boundary count toward the next fixing, never this one.
  const boundary = periodEndInstant(market.targetDate);
  let rawValue = await metricValueAsOf(market.metricId, boundary, workspaceId);
  if (rawValue === null && metric.resolvesNaUntilMeasured) {
    // A number that does not exist yet has no fixing (owner ask 2026-08-25:
    // "if not invested.. it resolves N/A"). The market is N/A: voided, every
    // position refunded, the reason published. The default `value` of a
    // never-measured metric is 0, and "$0 valuation" is the wrong answer this
    // rule exists to prevent. docs/ui-conventions.md, "A market on a number
    // that does not exist yet resolves N/A".
    const voided = await voidMarket(
      market,
      workspaceId,
      `N/A: "${market.metricName}" had no reading by ${boundary.toISOString()}, so there is nothing to settle on. Every position was refunded.`,
    );
    return { positions: voided.refunded, totalPayout: 0, skipped: true };
  }
  if (rawValue === null) {
    // No logged value at-or-before the boundary (metric predates value
    // logging or was created after the boundary). Fall back to the live
    // value, but make the gap visible: this is the only path where cron
    // timing can still affect the settled value.
    console.error(
      `Market ${market.id} (${market.metricName}): no metric log at-or-before ${boundary.toISOString()}, falling back to live value ${metric.total}`,
    );
    rawValue = metric.total;
  }
  if (rawValue === null || rawValue < 0) {
    console.error(`Market ${market.id} (${market.metricName}): metric value is ${rawValue}, skipping`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }

  const actualValue = Math.min(rawValue, market.rangeMax);
  const [lowerPay, higherPay] = resolutionPayouts(actualValue, market.rangeMin, market.rangeMax);
  const pool = market.pool ?? 0;

  const posRows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, market.id)));

  let totalPayout = 0;
  let positionCount = 0;

  await db.transaction(async tx => {
    for (const pos of posRows) {
      if (pos.shares <= 0) continue;
      const payFactor = pos.direction === 'higher' ? higherPay : lowerPay;
      const payout = Math.round(pos.shares * payFactor * 100) / 100;
      if (payout <= 0) continue;
      totalPayout += payout;
      positionCount++;
      await applyCredits(tx, {
        agentId: pos.agentId,
        workspaceId,
        deltaUnits: toUnits(payout),
        reason: 'payout',
        refType: 'market',
        refId: market.id,
        also: { earnedBetting: sql`${agents.earnedBetting} + ${payout}` },
      });
    }

    if (totalPayout > pool + 0.01) {
      console.error(`Market ${market.id}: totalPayout ${totalPayout} exceeds pool ${pool} - LMSR invariant violated`);
    }

    // Orders resting when the answer arrives never get to fill, so their
    // reserved credits are refunded rather than resolved along with the market.
    await releaseLimitOrdersForMarket(tx, market.id, 'cancelled');

    // Cap leftover at 0 so a violated invariant can never subtract from LPs.
    const poolLeftover = Math.max(0, Math.round((pool - totalPayout) * 100) / 100);
    await tx
      .update(markets)
      .set({ resolved: true, resolvedAt: new Date(), actualValue, active: false, pool: 0 })
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));

    await distributeLPLeftover(tx, market.id, poolLeftover, workspaceId);
  });

  emitEvent(
    'market:resolved',
    { marketId: market.id, metricName: market.metricName, targetDate: market.targetDate, actualValue },
    workspaceId,
  ).catch(e => console.error('emitEvent failed:', e));

  // Fire-and-forget, after the transaction: the settlement is the answer to
  // every bet on this book, and mail must never block or fail a resolve.
  void notifyMarketResolved({ workspaceId, marketId: market.id });

  return { positions: positionCount, totalPayout };
}

/**
 * Which branch of a conditional pair settles, given the proposal's status.
 * `approved` and `declined` are the two decided worlds; everything else
 * (pending, withdrawn, spam, removed) decided nothing, so no branch settles
 * and both are voided.
 */
export function conditionalBranchToSettle(status: string | undefined): 'approved' | 'declined' | null {
  if (status === 'approved') return 'approved';
  if (status === 'declined') return 'declined';
  return null;
}

export async function resolvePredictions(
  targetDate: string | undefined,
  workspaceId: string,
): Promise<{ resolved: number; totalPayout: number }> {
  // Optional `targetDate` override pins "now" to that day's midnight UTC
  // (test/backfill use). A market is resolvable once its period has fully
  // passed; instant-based so hour-granularity markets resolve on the next
  // hourly cron run instead of waiting for midnight.
  const now = targetDate ? new Date(`${targetDate}T00:00:00.000Z`) : new Date();

  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const marketsToResolve = openMarkets.filter(m => periodEndInstant(m.targetDate) <= now);
  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));

  const proposalIds = [...new Set(marketsToResolve.map(m => m.proposalId).filter(Boolean) as string[])];
  const proposalStatusMap = new Map<string, string>();
  if (proposalIds.length > 0) {
    const proposalRows = await db
      .select({ id: proposals.id, status: proposals.status })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), inArray(proposals.id, proposalIds)));
    for (const row of proposalRows) proposalStatusMap.set(row.id, row.status);
  }

  let totalPayout = 0;
  let resolvedCount = 0;

  for (const market of marketsToResolve) {
    // A conditional pair is symmetric: whichever branch the owner chose settles
    // against the metric like any other market, and the branch they did not
    // choose is the counterfactual, which has nothing to settle against and is
    // voided. Approve and the approved branch pays; decline and the declined
    // branch pays.
    //
    // Until 2026-08-30 this voided every conditional whose proposal was not
    // `approved`, so a declined proposal's surviving branch was voided at its
    // date instead of paying the people who priced it. That silently withheld
    // the calibration record on declines that /api/help and the guides both
    // promise (owner, 2026-08-30: "on the declined branch it's the other way
    // around, so the declined market goes further, and the approved one is
    // voided").
    //
    // A proposal still pending at the settle instant decided nothing, so
    // neither branch has a world to settle in and both void.
    const decidedBranch = market.proposalId
      ? conditionalBranchToSettle(proposalStatusMap.get(market.proposalId))
      : null;
    // `branch` is NULL on natural-trajectory markets, and on conditional rows
    // old enough to predate the column. The trade router already reads a
    // missing branch as "approved" for back-compat, so settlement does too:
    // a legacy pair keeps resolving exactly as it did.
    const marketBranch = market.branch ?? 'approved';
    if (market.proposalId && marketBranch !== decidedBranch) {
      await voidMarket(market, workspaceId);
    } else {
      const result = await resolveMarketRow(market, metricMap, workspaceId);
      if (!result.skipped) {
        totalPayout += result.totalPayout;
        resolvedCount++;
      }
    }
  }

  return { resolved: resolvedCount, totalPayout };
}

export type MarketStatus = 'open' | 'closed' | 'resolved' | 'voided' | 'all';

export interface GetMarketsOptions {
  includeResolved?: boolean;
  includeVoided?: boolean;
  proposalId?: string;
  active?: boolean;
  /**
   * Canonical lifecycle filter. When set, takes precedence over
   * includeResolved / includeVoided / active.
   *  - 'open'     active markets that accept buys and sells (default)
   *  - 'closed'   TP-deactivated, sell-only, not resolved
   *  - 'resolved' settled markets
   *  - 'voided'   cancelled / refunded markets
   *  - 'all'      every market regardless of state
   */
  status?: MarketStatus;
  minLiquidity?: number;
  limit?: number;
  /**
   * Filter by market kind:
   *  - 'baseline' (default when no proposalId): rows where proposalId is null
   *  - 'conditional': rows with any proposalId set
   *  - 'all': both
   * Ignored when opts.proposalId is set (that already pins to one proposal).
   */
  kind?: 'baseline' | 'conditional' | 'all';
}

export async function getMarkets(
  options: GetMarketsOptions | boolean = false,
  proposalId: string | undefined,
  workspaceId: string,
) {
  const opts: GetMarketsOptions = typeof options === 'boolean' ? { includeResolved: options, proposalId } : options;

  // Resolve which lifecycle states the caller actually wants. Explicit
  // `status` is authoritative. Otherwise: if any legacy flag is set, treat
  // the call as legacy; if nothing is set, default to status='open' so a
  // bare `GET /api/predictions/markets` returns tradeable markets only.
  const anyLegacy = opts.active !== undefined || !!opts.includeResolved || !!opts.includeVoided;
  const effectiveStatus: MarketStatus | 'legacy' = opts.status ? opts.status : anyLegacy ? 'legacy' : 'open';

  const wantsResolved =
    effectiveStatus === 'resolved' ||
    effectiveStatus === 'all' ||
    (effectiveStatus === 'legacy' && !!opts.includeResolved);
  const wantsVoided =
    effectiveStatus === 'voided' || effectiveStatus === 'all' || (effectiveStatus === 'legacy' && !!opts.includeVoided);

  let rows = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.workspaceId, workspaceId),
        wantsResolved ? undefined : eq(markets.resolved, false),
        wantsVoided ? undefined : eq(markets.voided, false),
        opts.proposalId ? eq(markets.proposalId, opts.proposalId) : undefined,
      ),
    );

  if (!opts.proposalId) {
    const kind = opts.kind ?? 'baseline';
    if (kind === 'baseline') rows = rows.filter(m => !m.proposalId);
    else if (kind === 'conditional') rows = rows.filter(m => !!m.proposalId);
    // 'all' keeps both
  }
  if (!rows.length) return [];

  if (effectiveStatus === 'open') {
    rows = rows.filter(m => m.active !== false && !m.resolved && !m.voided);
  } else if (effectiveStatus === 'closed') {
    rows = rows.filter(m => m.active === false && !m.resolved && !m.voided);
  } else if (effectiveStatus === 'resolved') {
    rows = rows.filter(m => m.resolved && !m.voided);
  } else if (effectiveStatus === 'voided') {
    rows = rows.filter(m => m.voided);
  } else if (effectiveStatus === 'legacy' && opts.active !== undefined) {
    rows = rows.filter(m => (m.active !== false) === opts.active);
  }
  // effectiveStatus === 'all' or legacy-without-active: no additional filter.
  if (opts.minLiquidity !== undefined && opts.minLiquidity > 0) {
    rows = rows.filter(m => (m.liquidity ?? 0) >= opts.minLiquidity!);
  }
  if (opts.minLiquidity !== undefined || opts.limit !== undefined) {
    rows = [...rows].sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  } else {
    rows = [...rows].sort((a, b) => {
      const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.targetDate.localeCompare(b.targetDate);
    });
  }
  if (opts.limit !== undefined && opts.limit > 0) {
    rows = rows.slice(0, opts.limit);
  }

  // Batch-count trades per market to avoid N+1 queries.
  const marketIds = rows.map(m => m.id);
  const tradeCounts = marketIds.length
    ? await db
        .select({ marketId: trades.marketId, count: count() })
        .from(trades)
        .where(inArray(trades.marketId, marketIds))
        .groupBy(trades.marketId)
    : [];
  const tradeCountMap: Record<string, number> = {};
  for (const r of tradeCounts) tradeCountMap[r.marketId] = Number(r.count);

  return rows.map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    const status: 'open' | 'resolved' | 'voided' | 'closed' = m.voided
      ? 'voided'
      : m.resolved
        ? 'resolved'
        : m.active === false
          ? 'closed'
          : 'open';
    return {
      id: m.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolvesOn: resolutionInstant(m.targetDate),
      active: m.active !== false,
      resolved: m.resolved,
      resolvedAt: m.resolvedAt ?? null,
      actualValue: m.actualValue ?? null,
      voided: m.voided,
      status,
      createdAt: m.createdAt,
      proposalId: m.proposalId ?? undefined,
      branch: m.branch ?? undefined,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      liquidity: m.liquidity,
      totalStake: m.liquidity,
      tradeCount: tradeCountMap[m.id] ?? 0,
      tradedVolume: m.tradedVolume ?? 0,
    };
  });
}

export interface MarketTradePoint {
  agentId: string;
  direction: string;
  shares: number;
  cost: number;
  consensus: number | null;
  createdAt: Date;
}

/**
 * Reconstruct the consensus right after each trade of a market. Naively
 * summing trade shares is wrong twice over:
 *
 * 1. Liquidity injections rescale the whole share vector (and b) between
 *    trades, so trades AND injections are replayed in chronological order.
 * 2. **A market does not necessarily open empty.** A conditional pair opens
 *    ANCHORED at the baseline's current value, and so does a near-horizon
 *    baseline market (`anchoredMarketState`, docs/ui-conventions.md), which
 *    means shares are already outstanding before anyone trades. Replaying
 *    from [0, 0] then reports a price the market never printed, and the chart
 *    draws that wrong level flat across the whole window before snapping to
 *    the true price at the live dot: it reads as if every trade happened at
 *    once, at the right-hand edge (owner report 2026-08-19). On the Telarchy
 *    floor a branch whose real consensus was 6.97 replayed as 26.57.
 *
 * The opening shares are not stored, so they are SOLVED for: replay once from
 * zero to learn what the trades and injections contribute, then subtract that
 * from the book as it stands today. Whatever is left was there at the open.
 * This is exact rather than a guess, needs no migration, and makes the last
 * point equal the live consensus by construction, which is the property every
 * caller depends on.
 *
 * Shared by GET /markets/:id/trades (the members' trade log) and the public
 * trading floor's consensus series (the amber line on the hero chart).
 */
export async function replayMarketTradePoints(marketId: string, workspaceId: string): Promise<MarketTradePoint[]> {
  return (await replayCache.get(marketId, workspaceId)).points;
}

/**
 * The replay bundle: everything derived from one market's trade and
 * liquidity history, computed from ONE fetch of each table and cached
 * briefly. Before this, the trade rows were fetched twice per history
 * request (once to replay, once in openingConsensus) and every 5s floor
 * poll re-replayed the full history. The cache is dropped the instant a
 * trade or liquidity change lands (lib/market-events.ts), so a fresh price
 * never waits out the TTL.
 */
interface ReplayBundle {
  market: typeof markets.$inferSelect | null;
  points: MarketTradePoint[];
  /** The consensus the market carried before anyone traded it. */
  opening: number | null;
}

const replayCache = ttlCache({
  ttlMs: 30_000,
  keyOf: (marketId: string, workspaceId: string) => `${workspaceId}:${marketId}`,
  load: (marketId: string, workspaceId: string) => computeReplayBundle(marketId, workspaceId),
});

onPricesChanged((workspaceId, marketId) => {
  if (marketId) replayCache.invalidate(`${workspaceId}:${marketId}`);
  else replayCache.clear();
});

/** Test seam. */

async function computeReplayBundle(marketId: string, workspaceId: string): Promise<ReplayBundle> {
  const [market] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.id, marketId)));
  if (!market) return { market: null, points: [], opening: null };

  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.marketId, marketId)))
    .orderBy(asc(trades.createdAt));

  const liqRows = await db
    .select()
    .from(liquidityEvents)
    .where(
      and(
        eq(liquidityEvents.workspaceId, workspaceId),
        eq(liquidityEvents.marketId, marketId),
        gt(liquidityEvents.totalLiquidity, 0),
      ),
    )
    .orderBy(asc(liquidityEvents.createdAt));

  type Ev =
    | { at: number; kind: 'trade'; trade: (typeof rows)[number] }
    | { at: number; kind: 'liquidity'; totalLiquidity: number };
  const events: Ev[] = [
    ...rows.map(t => ({ at: t.createdAt.getTime(), kind: 'trade' as const, trade: t })),
    ...liqRows.map(l => ({ at: l.createdAt.getTime(), kind: 'liquidity' as const, totalLiquidity: l.totalLiquidity })),
  ];
  events.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'liquidity' ? -1 : 1));

  // The market's b when it opened: the first injection's total (creation funds
  // the book through one), else whatever it carries now.
  const openingLiquidity = events.find(e => e.kind === 'liquidity')?.totalLiquidity ?? market.liquidity;

  /** One pass over the events. `emit` is off for the solving pass. */
  function walk(opening: [number, number], emit: boolean) {
    let shares: [number, number] = [...opening] as [number, number];
    let liquidity = openingLiquidity;
    // How much the opening shares themselves get rescaled along the way, so
    // the solve below can divide it back out.
    let openingScale = 1;
    const points: MarketTradePoint[] = [];
    for (const ev of events) {
      if (ev.kind === 'liquidity') {
        if (liquidity > 0 && ev.totalLiquidity > 0) {
          const ratio = ev.totalLiquidity / liquidity;
          shares = [shares[0] * ratio, shares[1] * ratio];
          openingScale *= ratio;
        }
        liquidity = ev.totalLiquidity;
        continue;
      }
      const t = ev.trade;
      const directionIndex = t.direction === 'higher' ? 1 : 0;
      shares = [...shares] as [number, number];
      shares[directionIndex] += t.shares;
      if (emit) {
        points.push({
          agentId: t.agentId,
          direction: t.direction,
          shares: Math.abs(t.shares),
          cost: t.cost,
          consensus: consensus(shares, liquidity, market.rangeMin, market.rangeMax) ?? null,
          createdAt: t.createdAt,
        });
        // Rows written at the same instant are ONE move, so they all carry
        // the price that move ended on. A redemption is the case that
        // needs it: it writes a row per side (docs/market-integrity.md,
        // "Redemption is liability-neutral"), and priced row by row the
        // first one drew a dip the market never printed before the second
        // one undid it.
        for (let k = points.length - 2; k >= 0; k--) {
          if (points[k].createdAt.getTime() !== t.createdAt.getTime()) break;
          points[k].consensus = points[points.length - 1].consensus;
        }
      }
    }
    return { shares, openingScale, points };
  }

  // Solve for the opening shares: everything the events did not put there.
  const fromZero = walk([0, 0], false);
  const current = (market.shares as [number, number] | null) ?? [0, 0];
  const scale = fromZero.openingScale || 1;
  const opening: [number, number] = [
    (current[0] - fromZero.shares[0]) / scale,
    (current[1] - fromZero.shares[1]) / scale,
  ];
  // A negative opening means the book and its events disagree (hand-edited
  // rows, a deleted trade). Fall back to an empty open rather than invent
  // negative shares, which would price the market outside its own range.
  const seed: [number, number] = [Math.max(0, opening[0]), Math.max(0, opening[1])];

  const points = walk(seed, true).points;
  return { market, points, opening: openingConsensus(market, points, rows, liqRows) };
}

/**
 * A market's price over time, as a chart reads it: the price it OPENED at,
 * then the price after each trade.
 *
 * The opening point is not a trade, which is why it does not belong in
 * `replayMarketTradePoints` (that one answers "what did each trade do", and a
 * synthetic row there would need an agent and a cost it does not have). It
 * belongs here because a market with one trade otherwise draws as a single
 * point, and a single point cannot show when anything happened: the chart
 * back-extends it flat across the whole window and the one real move lands on
 * the right edge (owner report 2026-08-19).
 */
export async function marketPriceSeries(
  marketId: string,
  workspaceId: string,
): Promise<Array<{ at: Date; consensus: number | null }>> {
  // One cached bundle: market row, replayed points, and the opening price all
  // come from the same single fetch of the trade history.
  const { market, points, opening } = await replayCache.get(marketId, workspaceId);
  if (!market) return [];

  const series = points.map(pt => ({ at: pt.createdAt, consensus: pt.consensus }));

  // The opening price: reconstructed by rewinding the first trade out of the
  // book the replay produced, so it needs no second solve.
  if (opening === null) return series;
  const openedAt = market.createdAt ?? points[0]?.createdAt ?? new Date();
  // Never draw the open after the first trade (clock skew, a backfilled row).
  if (points.length > 0 && openedAt.getTime() >= points[0].createdAt.getTime()) return series;
  return [{ at: openedAt, consensus: opening }, ...series];
}

/** The consensus the market carried before anyone traded it. */
function openingConsensus(
  market: typeof markets.$inferSelect,
  points: MarketTradePoint[],
  /** The same rows computeReplayBundle already fetched; never refetched. */
  rows: Array<typeof trades.$inferSelect>,
  liqRows: Array<typeof liquidityEvents.$inferSelect>,
): number | null {
  if (points.length === 0) {
    return (
      consensus(
        (market.shares as [number, number] | null) ?? [0, 0],
        market.liquidity,
        market.rangeMin,
        market.rangeMax,
      ) ?? null
    );
  }
  const openingLiquidity = liqRows[0]?.totalLiquidity ?? market.liquidity;

  // Rewind the first trade out of the first replayed point: the price before
  // it is the price the market opened at, at the liquidity it opened with.
  const first = rows[0];
  if (!first) return null;
  const firstPoint = points[0];
  const dir = first.direction === 'higher' ? 1 : 0;
  // Reconstruct the book at the first point, then undo that trade.
  const p = firstPoint.consensus;
  if (p === null) return null;
  const bAtFirst = liqRows.filter(l => l.createdAt <= first.createdAt).slice(-1)[0]?.totalLiquidity ?? openingLiquidity;
  const frac = (p - market.rangeMin) / (market.rangeMax - market.rangeMin);
  if (!(frac > 0 && frac < 1)) return null;
  const diffAfter = Math.log(frac / (1 - frac)) * bAtFirst; // shares[1] - shares[0]
  const diffBefore = dir === 1 ? diffAfter - first.shares : diffAfter + first.shares;
  const pBefore = 1 / (1 + Math.exp(-diffBefore / bAtFirst));
  return Math.round((market.rangeMin + pBefore * (market.rangeMax - market.rangeMin)) * 100) / 100;
}

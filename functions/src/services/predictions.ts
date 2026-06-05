import { db } from '../db/client';
import { agents, markets, positions, proposals, trades } from '../db/schema';
import { eq, and, inArray, sql, count } from 'drizzle-orm';
import { getAllMetrics, buildConsensusMap } from './metrics';
import { voidMarket, distributeLPLeftover } from './markets';
import { toUnits } from '../lib/validation';
import type { Metric } from '../types';
import { periodEndInstant, resolutionInstant } from '../lib/date-utils';
import { pHigher, consensus, resolutionPayouts } from '../lib/amm';
import { emitEvent } from './events';

type MarketRow = typeof markets.$inferSelect;

export async function resolveSingleMarket(marketId: string, workspaceId: string): Promise<{ resolved: boolean; totalPayout: number; skipped?: boolean }> {
  const [market] = await db.select().from(markets)
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
  const rawValue = metric.total;
  if (rawValue === null || rawValue < 0) {
    console.error(`Market ${market.id} (${market.metricName}): metric total is ${rawValue}, skipping`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }

  const actualValue = Math.min(rawValue, market.rangeMax);
  const [lowerPay, higherPay] = resolutionPayouts(actualValue, market.rangeMin, market.rangeMax);
  const pool = market.pool ?? 0;

  const posRows = await db.select().from(positions)
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
      await tx.update(agents)
        .set({
          balance: sql`${agents.balance} + ${toUnits(payout)}`,
          earnedBetting: sql`${agents.earnedBetting} + ${payout}`,
        })
        .where(eq(agents.id, pos.agentId));
    }

    if (totalPayout > pool + 0.01) {
      console.error(`Market ${market.id}: totalPayout ${totalPayout} exceeds pool ${pool} - LMSR invariant violated`);
    }

    // Cap leftover at 0 so a violated invariant can never subtract from LPs.
    const poolLeftover = Math.max(0, Math.round((pool - totalPayout) * 100) / 100);
    await tx.update(markets)
      .set({ resolved: true, resolvedAt: new Date(), actualValue, active: false, pool: 0 })
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));

    await distributeLPLeftover(tx, market.id, poolLeftover, workspaceId);
  });

  emitEvent('market:resolved', { marketId: market.id, metricName: market.metricName, targetDate: market.targetDate, actualValue }, workspaceId)
    .catch(e => console.error('emitEvent failed:', e));

  return { positions: positionCount, totalPayout };
}

export async function resolvePredictions(targetDate: string | undefined, workspaceId: string): Promise<{ resolved: number; totalPayout: number }> {
  // Optional `targetDate` override pins "now" to that day's midnight UTC
  // (test/backfill use). A market is resolvable once its period has fully
  // passed; instant-based so hour-granularity markets resolve on the next
  // hourly cron run instead of waiting for midnight.
  const now = targetDate ? new Date(`${targetDate}T00:00:00.000Z`) : new Date();

  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const marketsToResolve = openMarkets.filter(m => periodEndInstant(m.targetDate) <= now);
  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));

  const proposalIds = [...new Set(marketsToResolve.map(m => m.proposalId).filter(Boolean) as string[])];
  const proposalStatusMap = new Map<string, string>();
  if (proposalIds.length > 0) {
    const proposalRows = await db.select({ id: proposals.id, status: proposals.status }).from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), inArray(proposals.id, proposalIds)));
    for (const row of proposalRows) proposalStatusMap.set(row.id, row.status);
  }

  let totalPayout = 0;
  let resolvedCount = 0;

  for (const market of marketsToResolve) {
    if (market.proposalId && proposalStatusMap.get(market.proposalId) !== 'approved') {
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

export async function getMarkets(options: GetMarketsOptions | boolean = false, proposalId: string | undefined, workspaceId: string) {
  const opts: GetMarketsOptions = typeof options === 'boolean'
    ? { includeResolved: options, proposalId }
    : options;

  // Resolve which lifecycle states the caller actually wants. Explicit
  // `status` is authoritative. Otherwise: if any legacy flag is set, treat
  // the call as legacy; if nothing is set, default to status='open' so a
  // bare `GET /api/predictions/markets` returns tradeable markets only.
  const anyLegacy = opts.active !== undefined || !!opts.includeResolved || !!opts.includeVoided;
  const effectiveStatus: MarketStatus | 'legacy' =
    opts.status ? opts.status : anyLegacy ? 'legacy' : 'open';

  const wantsResolved = effectiveStatus === 'resolved' || effectiveStatus === 'all'
    || (effectiveStatus === 'legacy' && !!opts.includeResolved);
  const wantsVoided = effectiveStatus === 'voided' || effectiveStatus === 'all'
    || (effectiveStatus === 'legacy' && !!opts.includeVoided);

  let rows = await db.select().from(markets)
    .where(and(
      eq(markets.workspaceId, workspaceId),
      wantsResolved ? undefined : eq(markets.resolved, false),
      wantsVoided ? undefined : eq(markets.voided, false),
      opts.proposalId ? eq(markets.proposalId, opts.proposalId) : undefined,
    ));

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
    ? await db.select({ marketId: trades.marketId, count: count() })
        .from(trades)
        .where(inArray(trades.marketId, marketIds))
        .groupBy(trades.marketId)
    : [];
  const tradeCountMap: Record<string, number> = {};
  for (const r of tradeCounts) tradeCountMap[r.marketId] = Number(r.count);

  return rows.map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    const status: 'open' | 'resolved' | 'voided' | 'closed' =
      m.voided ? 'voided' :
      m.resolved ? 'resolved' :
      m.active === false ? 'closed' :
      'open';
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

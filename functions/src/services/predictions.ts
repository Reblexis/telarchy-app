import { db } from '../db/client';
import { agents, markets, positions, tasks, trades } from '../db/schema';
import { eq, and, inArray, sql, count } from 'drizzle-orm';
import { getAllMetrics, buildConsensusMap } from './metrics';
import { voidMarket, distributeLPLeftover } from './markets';
import { toUnits } from '../lib/validation';
import type { Metric } from '../types';
import { endOfPeriod } from '../lib/date-utils';
import { pHigher, consensus, resolutionPayouts } from '../lib/amm';
import { emitEvent } from './events';

type MarketRow = typeof markets.$inferSelect;

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

export async function resolveMarket(marketId: string, workspaceId: string): Promise<{ resolved: boolean; totalPayout: number }> {
  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));

  if (!market || market.resolved) return { resolved: false, totalPayout: 0 };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));
  const result = await resolveMarketRow(market, metricMap, workspaceId);
  if (result.skipped) return { resolved: false, totalPayout: 0 };
  return { resolved: true, totalPayout: result.totalPayout };
}

export async function resolvePredictions(targetDate: string | undefined, workspaceId: string): Promise<{ resolved: number; totalPayout: number }> {
  const today = targetDate || new Date().toISOString().slice(0, 10);

  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const marketsToResolve = openMarkets.filter(m => endOfPeriod(m.targetDate) < today);
  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));

  const taskIds = [...new Set(marketsToResolve.map(m => m.taskId).filter(Boolean) as string[])];
  const taskStatusMap = new Map<string, string>();
  if (taskIds.length > 0) {
    const taskRows = await db.select({ id: tasks.id, status: tasks.status }).from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.id, taskIds)));
    for (const row of taskRows) taskStatusMap.set(row.id, row.status);
  }

  let totalPayout = 0;
  let resolvedCount = 0;

  for (const market of marketsToResolve) {
    if (market.taskId && taskStatusMap.get(market.taskId) !== 'approved') {
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

export { voidMarket } from './markets';

export interface GetMarketsOptions {
  includeResolved?: boolean;
  taskId?: string;
  active?: boolean;
  minLiquidity?: number;
  limit?: number;
}

export async function getMarkets(options: GetMarketsOptions | boolean = false, taskId: string | undefined, workspaceId: string) {
  const opts: GetMarketsOptions = typeof options === 'boolean'
    ? { includeResolved: options, taskId }
    : options;

  let rows = await db.select().from(markets)
    .where(and(
      eq(markets.workspaceId, workspaceId),
      opts.includeResolved ? undefined : eq(markets.resolved, false),
      opts.taskId ? eq(markets.taskId, opts.taskId) : undefined,
    ));

  if (!opts.taskId) {
    rows = rows.filter(m => !m.taskId);
  }
  if (!rows.length) return [];

  if (opts.active !== undefined) {
    rows = rows.filter(m => (m.active !== false) === opts.active);
  }
  if (opts.minLiquidity !== undefined && opts.minLiquidity > 0) {
    rows = rows.filter(m => (m.liquidity ?? 0) >= opts.minLiquidity!);
  }
  if (opts.minLiquidity !== undefined || opts.limit !== undefined) {
    rows = [...rows].sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  } else {
    rows = [...rows].sort((a, b) => {
      const dateDiff = endOfPeriod(a.targetDate).localeCompare(endOfPeriod(b.targetDate));
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
      active: m.active !== false,
      resolved: m.resolved,
      resolvedAt: m.resolvedAt ?? null,
      actualValue: m.actualValue ?? null,
      voided: m.voided,
      status,
      createdAt: m.createdAt,
      taskId: m.taskId ?? undefined,
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

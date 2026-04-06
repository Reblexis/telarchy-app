import { db } from '../db/client';
import { agents, markets, metrics as metricsTable, positions, tasks, trades, systemConfig } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { consensus, initialPool } from '../lib/amm';
import { voidMarket } from './markets';
import { toUnits } from '../lib/validation';
import { AppError } from '../lib/errors';

type MarketRow = typeof markets.$inferSelect;

async function getTradeCountMap(marketIds: string[], workspaceId: string): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const rows = await db.select({ marketId: trades.marketId, count: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, marketIds)))
    .groupBy(trades.marketId);
  return new Map(rows.map(r => [r.marketId, r.count]));
}

async function getBaselineConsensusMap(marketRows: MarketRow[], workspaceId: string): Promise<Map<string, number>> {
  if (marketRows.length === 0) return new Map();
  const metricIds = [...new Set(marketRows.map(m => m.metricId))];
  const wantedKeys = new Set(marketRows.map(m => `${m.metricId}:${m.targetDate}`));

  const openMarkets = await db.select().from(markets)
    .where(and(
      eq(markets.workspaceId, workspaceId),
      eq(markets.resolved, false),
      inArray(markets.metricId, metricIds),
    ));

  const map = new Map<string, number>();
  for (const m of openMarkets) {
    if (m.taskId || !m.active) continue;
    const key = `${m.metricId}:${m.targetDate}`;
    if (!wantedKeys.has(key) || map.has(key)) continue;
    const shares = (m.shares as [number, number]) || [0, 0];
    const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax);
    if (c !== undefined) map.set(key, c);
  }
  return map;
}

export async function createConditionalMarkets(taskId: string, workspaceId = 'default'): Promise<string[]> {
  const lockKey = `lock:taskMarket:${taskId}`;

  const acquired = await db.transaction(async tx => {
    const rows = await tx.select().from(systemConfig)
      .where(eq(systemConfig.key, lockKey))
      .for('update');
    const existing = rows[0]?.value as { locked?: boolean; expiresAt?: number } | undefined;
    if (existing?.locked && (existing.expiresAt ?? 0) > Date.now()) return false;
    await tx.insert(systemConfig)
      .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + 300_000 } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: true, expiresAt: Date.now() + 300_000 } },
      });
    return true;
  });

  if (!acquired) {
    const existing = await db.select({ id: markets.id }).from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.taskId, taskId), eq(markets.resolved, false)));
    return existing.map(m => m.id);
  }

  try {
    const metricRows = await db.select().from(metricsTable)
      .where(eq(metricsTable.workspaceId, workspaceId));

    const leafMetricIds = new Set(
      metricRows.filter(r => !r.formula || r.formula === '0').map(r => r.id),
    );

    const openMarkets = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

    const sourceMarkets = openMarkets.filter(m => m.active !== false && !m.taskId && leafMetricIds.has(m.metricId));
    const desiredKeys = new Set(sourceMarkets.map(m => `${m.metricId}:${m.targetDate}`));

    const existingConditional = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.taskId, taskId), eq(markets.resolved, false)));

    if (existingConditional.length > 0) {
      const existingKeys = new Set(existingConditional.map(m => `${m.metricId}:${m.targetDate}`));
      const setsMatch = existingConditional.length === desiredKeys.size &&
        [...desiredKeys].every(k => existingKeys.has(k));
      if (setsMatch) return existingConditional.map(m => m.id);
    }

    await voidTaskMarkets(taskId, workspaceId);

    const newMarkets: typeof markets.$inferInsert[] = [];
    for (const src of sourceMarkets) {
      const marketId = randomUUID();
      newMarkets.push({
        id: marketId, workspaceId,
        metricId: src.metricId, metricName: src.metricName, targetDate: src.targetDate,
        resolved: false, resolvedAt: null, actualValue: null, active: true, taskId,
        rangeMin: src.rangeMin, rangeMax: src.rangeMax,
        shares: [0, 0] as [number, number], liquidity: src.liquidity,
        pool: initialPool(src.liquidity), createdAt: new Date(),
      });
    }

    if (newMarkets.length > 0) {
      await db.insert(markets).values(newMarkets);
    }
    return newMarkets.map(m => m.id as string);
  } finally {
    await db.insert(systemConfig)
      .values({ key: lockKey, value: { locked: false, expiresAt: 0 } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: false, expiresAt: 0 } },
      });
  }
}

export async function voidTaskMarkets(taskId: string, workspaceId = 'default'): Promise<void> {
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.taskId, taskId), eq(markets.resolved, false)));

  for (const market of openMarkets) {
    await voidMarket(market, workspaceId);
  }
}

export async function approveTask(taskId: string, workspaceId = 'default'): Promise<void> {
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));

  if (!task) throw new AppError('Task not found', 404);
  if (task.status !== 'pending') throw new AppError('Task is not pending', 400);

  const [agent] = await db.select().from(agents).where(eq(agents.id, task.proposedBy));

  await db.transaction(async tx => {
    await tx.update(tasks).set({ status: 'approved' })
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
    // Credit the proposing agent only if a real agent row exists
    if (agent) {
      await tx.update(agents)
        .set({
          balance: sql`${agents.balance} + ${toUnits(task.price)}`,
          earnedTasks: sql`${agents.earnedTasks} + ${task.price}`,
        })
        .where(eq(agents.id, task.proposedBy));
    } else {
      console.error(`approveTask: no agent row for proposedBy=${task.proposedBy}, skipping payout`);
    }
  });
}

export async function getTaskMarketSummaries(marketIds: string[], workspaceId = 'default') {
  if (marketIds.length === 0) return [];
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, marketIds)));
  return buildTaskMarketSummariesFromRows(rows, workspaceId);
}

export async function getTaskMarketSummariesForTask(taskId: string, workspaceId = 'default') {
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.taskId, taskId), eq(markets.resolved, false)));
  return buildTaskMarketSummariesFromRows(rows, workspaceId);
}

async function buildTaskMarketSummariesFromRows(rows: MarketRow[], workspaceId: string) {
  const [tradeCountMap, baselineConsensusMap] = await Promise.all([
    getTradeCountMap(rows.map(r => r.id), workspaceId),
    getBaselineConsensusMap(rows, workspaceId),
  ]);

  return rows.map(m => {
    const shares = (m.shares as [number, number]) || [0, 0];
    const key = `${m.metricId}:${m.targetDate}`;
    return {
      marketId: m.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      baselineConsensus: baselineConsensusMap.get(key) ?? null,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      liquidity: m.liquidity,
      tradeCount: tradeCountMap.get(m.id) ?? 0,
      resolved: m.resolved,
      actualValue: m.actualValue ?? null,
    };
  });
}

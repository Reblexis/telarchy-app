import { db } from '../db/client';
import { agents, markets, metrics as metricsTable, positions, liquidityEvents, systemConfig, workspaces } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { AMM_DEFAULTS, initialPool } from '../lib/amm';
import { emitEvent } from './events';
import { resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { applyAgentLiquidityInjectionTx } from './marketLiquidity';
import { sufficientBalance, toUnits } from '../lib/validation';

type MarketRow = typeof markets.$inferSelect;

/** Credit LP contributors proportionally from the pool leftover. */
export async function distributeLPLeftover(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  marketId: string,
  poolAmount: number,
  workspaceId: string,
): Promise<void> {
  if (poolAmount <= 0) return;
  const liqRows = await tx.select().from(liquidityEvents)
    .where(and(eq(liquidityEvents.workspaceId, workspaceId), eq(liquidityEvents.marketId, marketId)));

  const contributions = new Map<string, number>();
  let total = 0;
  for (const row of liqRows) {
    if (!row.agentId || !row.poolContribution || row.poolContribution <= 0) continue;
    contributions.set(row.agentId, (contributions.get(row.agentId) ?? 0) + row.poolContribution);
    total += row.poolContribution;
  }
  if (total <= 0) return;

  let distributed = 0;
  const entries = [...contributions.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [agentId, contribution] = entries[i];
    const share = i === entries.length - 1
      ? Math.round((poolAmount - distributed) * 100) / 100
      : Math.round(poolAmount * contribution / total * 100) / 100;
    if (share <= 0) continue;
    distributed += share;
    await tx.update(agents)
      .set({
        balance: sql`${agents.balance} + ${toUnits(share)}`,
        earnedBetting: sql`${agents.earnedBetting} + ${share}`,
      })
      .where(eq(agents.id, agentId));
  }
}

/** Void a single open market: refund all positions at cost, mark resolved+voided. */
export async function voidMarket(
  marketOrId: MarketRow | string,
  workspaceId: string,
): Promise<{ refunded: number }> {
  const market = typeof marketOrId === 'string'
    ? await db.select().from(markets)
        .where(and(eq(markets.id, marketOrId), eq(markets.workspaceId, workspaceId)))
        .then(r => r[0] ?? null)
    : marketOrId;

  if (!market || market.resolved) return { refunded: 0 };

  const posRows = await db.select().from(positions)
    .where(and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, market.id)));

  let refunded = 0;
  const pool = market.pool ?? 0;

  await db.transaction(async tx => {
    await tx.update(markets)
      .set({ resolved: true, resolvedAt: new Date(), actualValue: null, voided: true, active: false, pool: 0 })
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));

    for (const pos of posRows) {
      if (pos.totalCost <= 0) continue;
      refunded += pos.totalCost;
      await tx.update(agents)
        .set({
          balance: sql`${agents.balance} + ${toUnits(pos.totalCost)}`,
          spentBetting: sql`${agents.spentBetting} - ${pos.totalCost}`,
        })
        .where(eq(agents.id, pos.agentId));
    }

    const lpLeftover = Math.round((pool - refunded) * 100) / 100;
    await distributeLPLeftover(tx, market.id, lpLeftover, workspaceId);
  });

  emitEvent('market:resolved', { marketId: market.id, metricName: market.metricName, targetDate: market.targetDate, voided: true }, workspaceId)
    .catch(e => console.error('emitEvent failed:', e));
  return { refunded };
}

/** Void all open markets whose metricId is in the provided set. */
export async function voidOpenMarketsForMetrics(metricIds: Set<string>, workspaceId: string): Promise<void> {
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  for (const m of openMarkets) {
    if (metricIds.has(m.metricId)) await voidMarket(m, workspaceId);
  }
}

export type PendingMarket = {
  marketId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  rangeMax: number;
};

/**
 * Insert a batch of pending markets, using workspace auto-fund if available.
 * Falls back to AMM defaults when auto-fund is not configured or balance is insufficient.
 * Returns the number of markets successfully created.
 */
export async function insertPendingMarkets(pending: PendingMarket[], workspaceId: string): Promise<number> {
  if (pending.length === 0) return 0;

  const now = new Date();

  const insertWithDefaults = async (): Promise<number> => {
    const newMarkets = pending.map(p => ({
      id: p.marketId, workspaceId, metricId: p.metricId, metricName: p.metricName, targetDate: p.targetDate,
      resolved: false, resolvedAt: null, actualValue: null, active: true,
      rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: p.rangeMax,
      shares: [0, 0] as [number, number], liquidity: AMM_DEFAULTS.liquidity,
      pool: initialPool(AMM_DEFAULTS.liquidity), createdAt: now,
    }));
    const newLiqEvents = pending.map(p => ({
      id: randomUUID(), workspaceId, marketId: p.marketId, amount: AMM_DEFAULTS.liquidity,
      totalLiquidity: AMM_DEFAULTS.liquidity, type: 'initial' as const, createdAt: now,
    }));
    await db.transaction(async tx => {
      await tx.insert(markets).values(newMarkets);
      await tx.insert(liquidityEvents).values(newLiqEvents);
    });
    return pending.length;
  };

  const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const credits = wsRow?.newMarketLiquidityCredits ?? 0;
  if (!wsRow?.autoFundNewMarkets || credits <= 0) return insertWithDefaults();

  const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
  if (!ownerAgentId) {
    console.error('insertPendingMarkets: auto-fund on but workspace has no owner agent', workspaceId);
    return insertWithDefaults();
  }

  const totalCost = Math.round(credits * pending.length * 1e6) / 1e6;
  const [ag] = await db.select().from(agents).where(eq(agents.id, ownerAgentId));
  if (!ag || !sufficientBalance(ag.balance as number, totalCost)) {
    console.error('insertPendingMarkets: insufficient balance for auto-fund', { workspaceId, needed: totalCost });
    return insertWithDefaults();
  }

  await db.transaction(async tx => {
    for (const p of pending) {
      await tx.insert(markets).values({
        id: p.marketId, workspaceId, metricId: p.metricId, metricName: p.metricName, targetDate: p.targetDate,
        resolved: false, resolvedAt: null, actualValue: null, active: true,
        rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: p.rangeMax,
        shares: [0, 0] as [number, number], liquidity: 0, pool: 0, createdAt: now,
      });
      await applyAgentLiquidityInjectionTx(tx, { workspaceId, marketId: p.marketId, agentId: ownerAgentId, poolContribution: credits });
    }
  });
  return pending.length;
}

/**
 * Recreate markets for a standalone (non-TP-managed) metric at specific target dates.
 * Uses workspace auto-fund settings if available, otherwise falls back to AMM defaults.
 */
export async function recreateMarketsForMetric(
  metricId: string,
  metricName: string,
  targetDates: string[],
  rangeMax: number,
  workspaceId: string,
): Promise<void> {
  const pending: PendingMarket[] = targetDates.map(targetDate => ({
    marketId: randomUUID(), metricId, metricName, targetDate, rangeMax,
  }));
  await insertPendingMarkets(pending, workspaceId);
  for (const p of pending) {
    emitEvent('market:created', { marketId: p.marketId, metricName, targetDate: p.targetDate }, workspaceId)
      .catch(e => console.error('emitEvent failed:', e));
  }
}

/** Acquire a named lock using systemConfig as a lock table. Returns true if acquired. */
async function acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
  return db.transaction(async tx => {
    const rows = await tx.select().from(systemConfig)
      .where(eq(systemConfig.key, lockKey))
      .for('update');
    const existing = rows[0]?.value as { locked?: boolean; expiresAt?: number } | undefined;
    if (existing?.locked && (existing.expiresAt ?? 0) > Date.now()) return false;
    await tx.insert(systemConfig)
      .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + ttlMs } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: true, expiresAt: Date.now() + ttlMs } },
      });
    return true;
  });
}

async function setLockCooldown(lockKey: string, ttlMs: number): Promise<void> {
  await db.insert(systemConfig)
    .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + ttlMs } })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: { locked: true, expiresAt: Date.now() + ttlMs } },
    });
}

async function releaseLock(lockKey: string): Promise<void> {
  await db.insert(systemConfig)
    .values({ key: lockKey, value: { locked: false, expiresAt: 0 } })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: { locked: false, expiresAt: 0 } },
    });
}

export async function refreshRelativeDateMarkets(workspaceId: string, opts: { force?: boolean } = {}): Promise<{ created: number; deactivated: number; deduplicated: number }> {
  const lockKey = `lock:marketRefresh:${workspaceId}`;
  if (!opts.force) {
    const acquired = await acquireLock(lockKey, 120_000);
    if (!acquired) return { created: 0, deactivated: 0, deduplicated: 0 };
  }

  const metricRows = await db.select().from(metricsTable).where(eq(metricsTable.workspaceId, workspaceId));

  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToRangeMax = new Map<string, number>();
  const tpMetrics: { id: string; name: string; halfLife: number }[] = [];

  for (const row of metricRows) {
    nameToFormula[row.name] = row.formula || '0';
    nameToId.set(row.name, row.id);
    if (row.marketRangeMax != null) idToRangeMax.set(row.id, row.marketRangeMax);
    const tp = row.timePreference as { enabled?: boolean; halfLife?: number } | null;
    if (tp?.enabled && tp.halfLife) {
      tpMetrics.push({ id: row.id, name: row.name, halfLife: tp.halfLife });
    }
  }

  const desiredRefs = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  for (const tp of tpMetrics) {
    let leafNames = getLeafDescendantNames(tp.name, nameToFormula);
    // If the TP metric is itself a leaf, it needs markets for itself
    const tpIsLeaf = !nameToFormula[tp.name] || nameToFormula[tp.name].trim() === '0';
    if (tpIsLeaf) leafNames = [tp.name];
    const timePoints = sampleTimePoints(tp.halfLife);
    for (const leafName of leafNames) {
      const leafId = nameToId.get(leafName);
      if (!leafId) continue;
      for (const { date } of timePoints) {
        desiredRefs.set(`${leafId}:${date}`, { metricId: leafId, metricName: leafName, targetDate: date });
      }
    }
  }

  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const openKeys = new Set<string>();
  let deactivated = 0;
  const toDeactivate: string[] = [];
  const toActivate: string[] = [];
  const toLiquidityNormalize: string[] = [];
  const seenNonTask = new Map<string, { id: string; createdAt: Date }>();
  const toVoid: MarketRow[] = [];
  const toFund: string[] = [];

  for (const m of openMarkets) {
    const key = `${m.metricId}:${m.targetDate}`;

    // Void markets whose rangeMax is stale (metric's marketRangeMax has changed).
    // Skip adding to openKeys so the pending step recreates them with the correct rangeMax.
    if (!m.taskId) {
      const expectedRangeMax = idToRangeMax.get(m.metricId);
      if (expectedRangeMax !== undefined && m.rangeMax !== expectedRangeMax) {
        toVoid.push(m);
        continue;
      }
    }

    openKeys.add(key);
    if (m.taskId) continue;

    const prev = seenNonTask.get(key);
    if (!prev) {
      seenNonTask.set(key, { id: m.id, createdAt: m.createdAt });
    } else if (m.createdAt < prev.createdAt) {
      const prevMarket = openMarkets.find(om => om.id === prev.id);
      if (prevMarket) toVoid.push(prevMarket);
      seenNonTask.set(key, { id: m.id, createdAt: m.createdAt });
    } else {
      toVoid.push(m);
    }

    const shouldBeActive = desiredRefs.has(key);
    if (shouldBeActive && !m.active) {
      toActivate.push(m.id);
    } else if (!shouldBeActive && m.active) {
      toDeactivate.push(m.id);
      deactivated++;
    }

    if (m.active && (m.pool ?? 0) === 0) toFund.push(m.id);

  }

  // Apply updates in a transaction
  if (toActivate.length || toDeactivate.length) {
    await db.transaction(async tx => {
      if (toActivate.length) {
        for (const id of toActivate) {
          await tx.update(markets).set({ active: true })
            .where(and(eq(markets.id, id), eq(markets.workspaceId, workspaceId)));
        }
      }
      if (toDeactivate.length) {
        for (const id of toDeactivate) {
          await tx.update(markets).set({ active: false })
            .where(and(eq(markets.id, id), eq(markets.workspaceId, workspaceId)));
        }
      }
    });
  }

  // Create missing markets
  const pending: PendingMarket[] = [];

  for (const [, { metricId, metricName, targetDate }] of desiredRefs) {
    const key = `${metricId}:${targetDate}`;
    if (openKeys.has(key)) continue;
    pending.push({
      marketId: randomUUID(),
      metricId,
      metricName,
      targetDate,
      rangeMax: idToRangeMax.get(metricId) ?? AMM_DEFAULTS.rangeMax,
    });
  }

  const created = await insertPendingMarkets(pending, workspaceId);

  // Fund existing active markets that have no liquidity
  if (toFund.length > 0) {
    const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    const credits = wsRow?.newMarketLiquidityCredits ?? 0;
    if (wsRow?.autoFundNewMarkets && credits > 0) {
      const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
      if (ownerAgentId) {
        const totalCost = Math.round(credits * toFund.length * 1e6) / 1e6;
        const [ag] = await db.select().from(agents).where(eq(agents.id, ownerAgentId));
        if (ag && sufficientBalance(ag.balance as number, totalCost)) {
          await db.transaction(async tx => {
            for (const marketId of toFund) {
              await applyAgentLiquidityInjectionTx(tx, { workspaceId, marketId, agentId: ownerAgentId, poolContribution: credits });
            }
          });
        }
      }
    }
  }

  // Void duplicates
  for (const m of toVoid) await voidMarket(m, workspaceId);
  const deduplicated = toVoid.length;

  // Hold lock as cooldown for 5 minutes
  if (!opts.force) await setLockCooldown(lockKey, 5 * 60 * 1000);

  return { created, deactivated, deduplicated };
}

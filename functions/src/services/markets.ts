import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents,
  liquidityEvents,
  markets,
  metrics as metricsTable,
  proposals as proposalsTable,
  systemConfig,
  trades,
  workspaces,
} from '../db/schema';
import { AMM_DEFAULTS, initialPool } from '../lib/amm';
import { emitPricesChanged } from '../lib/market-events';
import { resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { desiredMarketDates, generatesMarkets, getLeafDescendantNames } from '../lib/time-preference';
import { liquiditySpendableUnits, MIN_LIQUIDITY_CONTRIBUTION, toUnits } from '../lib/validation';
import type { TimePreference } from '../types';
import { applyCredits } from './credits';
import { emitEvent } from './events';
import { applyAgentLiquidityInjectionTx } from './marketLiquidity';
import { releaseLimitOrdersForMarket } from './trading';

type MarketRow = typeof markets.$inferSelect;

/** Credit LP contributors proportionally from the pool leftover. */
export async function distributeLPLeftover(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  marketId: string,
  poolAmount: number,
  workspaceId: string,
): Promise<void> {
  if (poolAmount <= 0) return;
  const liqRows = await tx
    .select()
    .from(liquidityEvents)
    .where(and(eq(liquidityEvents.workspaceId, workspaceId), eq(liquidityEvents.marketId, marketId)));

  // Grouped by agent AND by the purse that funded the contribution: a
  // leftover goes back where it came from, so bought liquidity credits
  // (funded_from 'liquidity') return to the walled wallet and can never
  // leak into a tradeable balance (owner decision 2026-08-28, the
  // two-currencies model). Legacy rows with no funded_from read as
  // 'balance'.
  const contributions = new Map<string, number>();
  let total = 0;
  for (const row of liqRows) {
    if (!row.agentId || !row.poolContribution || row.poolContribution <= 0) continue;
    const key = `${row.fundedFrom === 'liquidity' ? 'liquidity' : 'balance'}:${row.agentId}`;
    contributions.set(key, (contributions.get(key) ?? 0) + row.poolContribution);
    total += row.poolContribution;
  }
  if (total <= 0) return;

  let distributed = 0;
  const entries = [...contributions.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [key, contribution] = entries[i];
    const [source, agentId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const share =
      i === entries.length - 1
        ? Math.round((poolAmount - distributed) * 100) / 100
        : Math.round(((poolAmount * contribution) / total) * 100) / 100;
    if (share <= 0) continue;
    distributed += share;
    if (source === 'liquidity') {
      await tx
        .update(agents)
        .set({ liquidityBalance: sql`${agents.liquidityBalance} + ${toUnits(share)}` })
        .where(eq(agents.id, agentId));
    } else {
      await applyCredits(tx, {
        agentId,
        workspaceId,
        deltaUnits: toUnits(share),
        reason: 'lp_leftover',
        refType: 'market',
        refId: marketId,
        also: { earnedBetting: sql`${agents.earnedBetting} + ${share}` },
      });
    }
  }
}

/**
 * Void a single open market: refund every participant what they still had at
 * stake, mark resolved+voided.
 *
 * The refund is NET CASH on this market (buys positive, sells negative,
 * floored at zero), not `positions.totalCost` (owner decision 2026-08-15;
 * governing sentence in docs/vision.md, "a void refunds net cash, not gross
 * cost"). totalCost is cumulative BUY cost and a sell never reduces it, on
 * purpose, so the position cap cannot be stretched by churning; refunding it
 * handed a round-tripper their buy cost a second time. Observed in
 * production: two 5-credit round trips on one market minted 10 credits, and
 * repeating the trip before an expected void would have minted more.
 *
 * Floored at zero so a void can never debit an account: a participant who
 * sold out above their cost keeps that realised gain and gets nothing back.
 */
export async function voidMarket(
  marketOrId: MarketRow | string,
  workspaceId: string,
  /** Why, when a human deliberately voided a market people were holding. The
   *  engine's own voids pass nothing: "the proposal was declined" is already
   *  in the event that caused them. Published on the market:resolved event so
   *  the reason survives next to the act. */
  reason?: string,
): Promise<{ refunded: number }> {
  const market =
    typeof marketOrId === 'string'
      ? await db
          .select()
          .from(markets)
          .where(and(eq(markets.id, marketOrId), eq(markets.workspaceId, workspaceId)))
          .then(r => r[0] ?? null)
      : marketOrId;

  if (!market || market.resolved) return { refunded: 0 };

  // What each participant still has in this market: their trades summed, so
  // money they already took back out by selling is not handed to them twice.
  // Read from trades rather than positions because positions.totalCost is
  // gross buys by design (see the position cap) and cannot answer this.
  const stakeRows = await db
    .select({
      agentId: trades.agentId,
      netCash: sql<number>`coalesce(sum(${trades.cost}), 0)::float`,
    })
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.marketId, market.id)))
    .groupBy(trades.agentId);

  let refunded = 0;
  const pool = market.pool ?? 0;

  await db.transaction(async tx => {
    await tx
      .update(markets)
      .set({ resolved: true, resolvedAt: new Date(), actualValue: null, voided: true, active: false, pool: 0 })
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));

    for (const row of stakeRows) {
      // Floored at zero: a void never debits. Someone who sold out above
      // their cost keeps the gain and is refunded nothing.
      //
      // Not rounded to cents: balances are stored in nanocredits, and
      // rounding a refund up hands out a fraction of a credit nobody had at
      // stake (caught by the conservation test, which saw a cancel leave a
      // trader 0.0038 credits richer than they started).
      const refund = Math.max(0, Number(row.netCash));
      if (refund <= 0) continue;
      refunded += refund;
      await applyCredits(tx, {
        agentId: row.agentId,
        workspaceId,
        deltaUnits: toUnits(refund),
        reason: 'void_refund',
        refType: 'market',
        refId: market.id,
        also: { spentBetting: sql`${agents.spentBetting} - ${refund}` },
      });
    }

    // Credits reserved by orders that will now never fill go back to their
    // owners, or voiding a market would quietly strand them.
    refunded += await releaseLimitOrdersForMarket(tx, market.id, 'voided');

    const lpLeftover = Math.round((pool - refunded) * 100) / 100;
    await distributeLPLeftover(tx, market.id, lpLeftover, workspaceId);
  });

  emitEvent(
    'market:resolved',
    {
      marketId: market.id,
      metricName: market.metricName,
      targetDate: market.targetDate,
      voided: true,
      ...(reason ? { reason } : {}),
    },
    workspaceId,
  ).catch(e => console.error('emitEvent failed:', e));
  return { refunded };
}

/** Void all open markets whose metricId is in the provided set. */
export async function voidOpenMarketsForMetrics(metricIds: Set<string>, workspaceId: string): Promise<void> {
  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  for (const m of openMarkets) {
    if (metricIds.has(m.metricId)) await voidMarket(m, workspaceId);
  }
}

export { openingAnchorP } from '../lib/market-open';

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
      id: p.marketId,
      workspaceId,
      metricId: p.metricId,
      metricName: p.metricName,
      targetDate: p.targetDate,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      active: true,
      rangeMin: AMM_DEFAULTS.rangeMin,
      rangeMax: p.rangeMax,
      shares: [0, 0] as [number, number],
      liquidity: AMM_DEFAULTS.liquidity,
      pool: initialPool(AMM_DEFAULTS.liquidity),
      createdAt: now,
    }));
    const newLiqEvents = pending.map(p => ({
      id: randomUUID(),
      workspaceId,
      marketId: p.marketId,
      amount: AMM_DEFAULTS.liquidity,
      totalLiquidity: AMM_DEFAULTS.liquidity,
      type: 'initial' as const,
      createdAt: now,
    }));
    await db.transaction(async tx => {
      await tx.insert(markets).values(newMarkets);
      await tx.insert(liquidityEvents).values(newLiqEvents);
    });
    for (const e of newLiqEvents) emitPricesChanged(workspaceId, e.marketId);
    return pending.length;
  };

  const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const credits = wsRow?.newMarketLiquidityCredits ?? 0;
  if (!wsRow?.autoFundNewMarkets || credits <= 0) return insertWithDefaults();
  // Legacy rows can carry sub-minimum credits (configured before the
  // MIN_LIQUIDITY_CONTRIBUTION guard was added). Treat as auto-fund off
  // rather than aborting the entire refresh transaction.
  if (credits < MIN_LIQUIDITY_CONTRIBUTION) {
    console.error('insertPendingMarkets: newMarketLiquidityCredits below minimum, falling back to insertWithDefaults', {
      workspaceId,
      credits,
      minimum: MIN_LIQUIDITY_CONTRIBUTION,
    });
    return insertWithDefaults();
  }

  const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
  if (!ownerAgentId) {
    console.error('insertPendingMarkets: auto-fund on but workspace has no owner agent', workspaceId);
    return insertWithDefaults();
  }

  // Fund as many as the balance covers, in list order, and open the rest
  // unfunded for a later refresh. All-or-nothing left every market of a
  // rollover at zero when the balance was short of the whole day's need
  // (2026-08-27: three LookPilot day markets, none funded, all morning).
  const [ag] = await db.select().from(agents).where(eq(agents.id, ownerAgentId));
  // The bought liquidity wallet counts: pool money is what this spends, and
  // the injection itself spends the wallet first (owner report 2026-08-30,
  // a house sitting on a million liquidity credits still spawning dead
  // markets because the gate read `balance` alone). Each market is priced at
  // its own metric's depth (docs/owner-on-the-floor.md), so the plan walks
  // the list in order spending that one purse.
  const spendableUnits = ag ? liquiditySpendableUnits(ag) : 0;
  const perMetric = await metricCreditsMap(workspaceId, credits);
  const funded = planAffordable(pending, p => perMetric.get(p.metricId) ?? credits, spendableUnits);
  if (funded.length === 0) {
    console.error('insertPendingMarkets: insufficient balance for auto-fund', { workspaceId, needed: credits });
    return insertWithDefaults();
  }
  if (funded.length < pending.length) {
    console.error('insertPendingMarkets: balance covers some of the new markets, the rest open unfunded', {
      workspaceId,
      funded: funded.length,
      unfunded: pending.length - funded.length,
    });
  }
  const fundedCredits = new Map(funded.map(f => [f.item.marketId, f.credits]));

  await db.transaction(async tx => {
    for (const p of pending) {
      await tx.insert(markets).values({
        id: p.marketId,
        workspaceId,
        metricId: p.metricId,
        metricName: p.metricName,
        targetDate: p.targetDate,
        resolved: false,
        resolvedAt: null,
        actualValue: null,
        active: true,
        rangeMin: AMM_DEFAULTS.rangeMin,
        rangeMax: p.rangeMax,
        shares: [0, 0] as [number, number],
        liquidity: 0,
        pool: 0,
        createdAt: now,
      });
      const poolContribution = fundedCredits.get(p.marketId);
      if (poolContribution === undefined) {
        await tx.insert(liquidityEvents).values({
          id: randomUUID(),
          workspaceId,
          marketId: p.marketId,
          amount: 0,
          totalLiquidity: 0,
          type: 'initial' as const,
          createdAt: now,
        });
        continue;
      }
      await applyAgentLiquidityInjectionTx(tx, {
        workspaceId,
        marketId: p.marketId,
        agentId: ownerAgentId,
        poolContribution,
      });
    }
  });
  return pending.length;
}

/**
 * What each metric's new market opens with: its own `liquidityCredits` when the
 * owner set one on the metrics page, the workspace default otherwise
 * (docs/owner-on-the-floor.md).
 */
async function metricCreditsMap(workspaceId: string, fallback: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: metricsTable.id, credits: metricsTable.liquidityCredits })
    .from(metricsTable)
    .where(eq(metricsTable.workspaceId, workspaceId));
  return new Map(rows.map(r => [r.id, r.credits == null ? fallback : (r.credits as number)]));
}

/**
 * Walk the list in order, funding each market at its own price while the
 * balance lasts. Order matters and all-or-nothing does not: an unfunded market
 * waits for the next refresh rather than for every sibling to become
 * affordable at once (2026-08-27: three LookPilot day markets, none funded).
 */
export function planAffordable<T>(
  items: T[],
  costOf: (item: T) => number,
  balanceUnits: number,
): Array<{ item: T; credits: number }> {
  let left = balanceUnits;
  const out: Array<{ item: T; credits: number }> = [];
  for (const item of items) {
    const credits = costOf(item);
    if (credits < MIN_LIQUIDITY_CONTRIBUTION) continue;
    const units = toUnits(credits);
    if (left < units) continue;
    left -= units;
    out.push({ item, credits });
  }
  return out;
}

/** Acquire a named lock using systemConfig as a lock table. Returns true if acquired. */
async function acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
  return db.transaction(async tx => {
    const rows = await tx.select().from(systemConfig).where(eq(systemConfig.key, lockKey)).for('update');
    const existing = rows[0]?.value as { locked?: boolean; expiresAt?: number } | undefined;
    if (existing?.locked && (existing.expiresAt ?? 0) > Date.now()) return false;
    await tx
      .insert(systemConfig)
      .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + ttlMs } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: true, expiresAt: Date.now() + ttlMs } },
      });
    return true;
  });
}

async function setLockCooldown(lockKey: string, ttlMs: number): Promise<void> {
  await db
    .insert(systemConfig)
    .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + ttlMs } })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: { locked: true, expiresAt: Date.now() + ttlMs } },
    });
}

async function _releaseLock(lockKey: string): Promise<void> {
  await db
    .insert(systemConfig)
    .values({ key: lockKey, value: { locked: false, expiresAt: 0 } })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: { locked: false, expiresAt: 0 } },
    });
}

export async function refreshRelativeDateMarkets(
  workspaceId: string,
  opts: { force?: boolean } = {},
): Promise<{ created: number; deactivated: number; deduplicated: number; conditionalRespawned: number }> {
  const lockKey = `lock:marketRefresh:${workspaceId}`;
  if (!opts.force) {
    const acquired = await acquireLock(lockKey, 120_000);
    if (!acquired) return { created: 0, deactivated: 0, deduplicated: 0, conditionalRespawned: 0 };
  }

  const metricRows = await db.select().from(metricsTable).where(eq(metricsTable.workspaceId, workspaceId));

  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToRangeMax = new Map<string, number>();
  const tpMetrics: { id: string; name: string; tp: TimePreference }[] = [];

  // One base date for the whole run so the curve samples and custom horizons
  // never disagree about "today".
  const base = new Date();

  for (const row of metricRows) {
    nameToFormula[row.name] = row.formula || '0';
    nameToId.set(row.name, row.id);
    if (row.marketRangeMax != null) idToRangeMax.set(row.id, row.marketRangeMax);
    const tp = row.timePreference as TimePreference | null;
    if (generatesMarkets(tp, base)) {
      tpMetrics.push({ id: row.id, name: row.name, tp });
    }
  }

  const desiredRefs = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  // Leaf metricIds whose markets are system-managed (reachable from a
  // market-generating metric). Markets on other metrics, e.g. manual one-offs
  // created via POST /api/predictions/markets, are left alone by the refresh.
  const managedLeafIds = new Set<string>();
  for (const { name, tp } of tpMetrics) {
    let leafNames = getLeafDescendantNames(name, nameToFormula);
    // If the TP metric is itself a leaf, it needs markets for itself
    const tpIsLeaf = !nameToFormula[name] || nameToFormula[name].trim() === '0';
    if (tpIsLeaf) leafNames = [name];
    const targetDates = desiredMarketDates(tp, base);
    for (const leafName of leafNames) {
      const leafId = nameToId.get(leafName);
      if (!leafId) continue;
      managedLeafIds.add(leafId);
      for (const date of targetDates) {
        desiredRefs.set(`${leafId}:${date}`, { metricId: leafId, metricName: leafName, targetDate: date });
      }
    }
  }

  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const openKeys = new Set<string>();
  let deactivated = 0;
  const toDeactivate: string[] = [];
  const toActivate: string[] = [];
  const _toLiquidityNormalize: string[] = [];
  const seenNonProposal = new Map<string, { id: string; createdAt: Date }>();
  const toVoid: MarketRow[] = [];
  const toFund: string[] = [];

  for (const m of openMarkets) {
    // Conditional markets (those scoped to a proposal) are independent of the
    // metric's permanent baseline forecasting. They must not occupy openKeys,
    // otherwise a stale conditional at a date that matches a current sample
    // point would block the baseline market at that date from ever being
    // (re)created, and the metric's time series silently loses that point.
    if (m.proposalId) continue;

    const key = `${m.metricId}:${m.targetDate}`;
    const isManaged = managedLeafIds.has(m.metricId);

    // Void markets whose rangeMax is stale (metric's marketRangeMax has changed).
    // Skip adding to openKeys so the pending step recreates them with the correct
    // rangeMax. Managed metrics only: a manual one-off market may use a custom
    // range on purpose, and voiding it here would destroy it without recreation.
    const expectedRangeMax = idToRangeMax.get(m.metricId);
    if (isManaged && expectedRangeMax !== undefined && m.rangeMax !== expectedRangeMax) {
      toVoid.push(m);
      continue;
    }

    openKeys.add(key);

    // Duplicate voiding stays global: two open markets at the same
    // metricId:targetDate are always wrong, manual or managed.
    const prev = seenNonProposal.get(key);
    if (!prev) {
      seenNonProposal.set(key, { id: m.id, createdAt: m.createdAt });
    } else if (m.createdAt < prev.createdAt) {
      const prevMarket = openMarkets.find(om => om.id === prev.id);
      if (prevMarket) toVoid.push(prevMarket);
      seenNonProposal.set(key, { id: m.id, createdAt: m.createdAt });
    } else {
      toVoid.push(m);
    }

    // Activation lifecycle applies only to managed metrics; manual one-off
    // markets on unmanaged metrics keep whatever state they were given.
    const shouldBeActive = desiredRefs.has(key);
    if (shouldBeActive && !m.active) {
      toActivate.push(m.id);
    } else if (isManaged && !shouldBeActive && m.active) {
      toDeactivate.push(m.id);
      deactivated++;
    }

    // Include any active market whose pool is below the minimum usable size.
    // Captures both pool=0 (auto-fund was off when created) and pool < MIN
    // (historical micro-injections that left markets butterfly-sensitive).
    if (m.active && (m.pool ?? 0) < MIN_LIQUIDITY_CONTRIBUTION) toFund.push(m.id);
  }

  // Apply updates in a transaction
  if (toActivate.length || toDeactivate.length) {
    await db.transaction(async tx => {
      if (toActivate.length) {
        for (const id of toActivate) {
          await tx
            .update(markets)
            .set({ active: true })
            .where(and(eq(markets.id, id), eq(markets.workspaceId, workspaceId)));
        }
      }
      if (toDeactivate.length) {
        for (const id of toDeactivate) {
          await tx
            .update(markets)
            .set({ active: false })
            .where(and(eq(markets.id, id), eq(markets.workspaceId, workspaceId)));
        }
      }
    });
    // Outside the transaction (events are non-blocking, fire-and-forget).
    for (const id of toDeactivate) {
      emitEvent('market:closed', { marketId: id }, workspaceId).catch(e => console.error('emitEvent failed:', e));
    }
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
    if (wsRow?.autoFundNewMarkets && credits >= MIN_LIQUIDITY_CONTRIBUTION) {
      const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
      if (ownerAgentId) {
        // As many as the balance covers, not all or nothing: an unfunded
        // market waits for the next refresh rather than for every one of its
        // siblings to become affordable at once.
        const [ag] = await db.select().from(agents).where(eq(agents.id, ownerAgentId));
        const perMetric = await metricCreditsMap(workspaceId, credits);
        const rows = await db
          .select({ id: markets.id, metricId: markets.metricId })
          .from(markets)
          .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, toFund)));
        const byId = new Map(rows.map(r => [r.id, r.metricId]));
        const funded = planAffordable(
          toFund,
          marketId => perMetric.get(byId.get(marketId) ?? '') ?? credits,
          // The bought liquidity wallet counts here too: same purse, same
          // spend order as the injection (lib/validation, two currencies).
          ag ? liquiditySpendableUnits(ag) : 0,
        );
        if (funded.length > 0) {
          await db.transaction(async tx => {
            for (const f of funded) {
              await applyAgentLiquidityInjectionTx(tx, {
                workspaceId,
                marketId: f.item,
                agentId: ownerAgentId,
                poolContribution: f.credits,
              });
            }
          });
        }
      }
    }
  }

  // Void duplicates
  for (const m of toVoid) await voidMarket(m, workspaceId);
  const deduplicated = toVoid.length;

  // Reconcile conditional markets for pending proposals. Relative-date markets
  // roll their target dates forward over time, and when a baseline date rolls
  // off, a proposal's conditional markets at that date are voided as stale. Left
  // alone, a pending proposal can end up with zero live conditional markets while
  // its conditionalMarketIds still references the (now dead) rows. The lazy
  // re-spawn on the per-proposal fetch was keyed on an empty id list, so it never
  // fired in that state and the proposal showed no conditional markets forever
  // (observed on lookpilot-growth: 3 pending proposals, ~24 voided conditionals
  // each, conditional markets list permanently empty). createConditionalMarkets
  // is an idempotent incremental sync (spawn missing, void stale, keep current),
  // so running it here re-aligns each pending proposal's conditional set with the
  // live baselines and re-seeds the subsidy from subsidyContributions. Only
  // pending proposals are reconciled: approved/declined proposals void one branch
  // on purpose, and re-spawning it would resurrect the dead counterfactual.
  let conditionalRespawned = 0;
  const pendingProposals = await db
    .select()
    .from(proposalsTable)
    .where(and(eq(proposalsTable.workspaceId, workspaceId), eq(proposalsTable.status, 'pending')));
  if (pendingProposals.length > 0) {
    const { createConditionalMarkets, subsidyContributionsOf } = await import('./proposals');
    for (const proposal of pendingProposals) {
      try {
        const marketIds = await createConditionalMarkets(proposal.id, workspaceId, {
          contributions: subsidyContributionsOf(proposal),
        });
        const prevIds = (proposal.conditionalMarketIds as string[]) ?? [];
        const changed = marketIds.length !== prevIds.length || marketIds.some(id => !prevIds.includes(id));
        if (changed) {
          await db
            .update(proposalsTable)
            .set({ conditionalMarketIds: marketIds })
            .where(and(eq(proposalsTable.id, proposal.id), eq(proposalsTable.workspaceId, workspaceId)));
          conditionalRespawned++;
        }
      } catch (e) {
        console.error(`refreshRelativeDateMarkets: conditional respawn failed for proposal ${proposal.id}:`, e);
      }
    }
  }

  // Hold lock as cooldown for 5 minutes
  if (!opts.force) await setLockCooldown(lockKey, 5 * 60 * 1000);

  return { created, deactivated, deduplicated, conditionalRespawned };
}

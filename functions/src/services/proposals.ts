import { db } from '../db/client';
import { agents, markets, metrics as metricsTable, proposals, trades, systemConfig, liquidityEvents } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { consensus } from '../lib/amm';
import { voidMarket } from './markets';
import { AppError } from '../lib/errors';
import { MIN_LIQUIDITY_CONTRIBUTION, sufficientBalance, toUnits, fromUnits } from '../lib/validation';

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
    if (m.proposalId || !m.active) continue;
    const key = `${m.metricId}:${m.targetDate}`;
    if (!wantedKeys.has(key) || map.has(key)) continue;
    const shares = (m.shares as [number, number]) || [0, 0];
    const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax);
    if (c !== undefined) map.set(key, c);
  }
  return map;
}

export interface CreateConditionalMarketsOptions {
  /** Per-market credit subsidy. 0 means no subsidy; markets ship at zero liquidity. */
  subsidyPerMarket?: number;
  /** LP attribution for the subsidy. Required when subsidyPerMarket > 0. */
  proposerAgentId?: string | null;
}

export async function createConditionalMarkets(
  proposalId: string,
  workspaceId: string,
  options: CreateConditionalMarketsOptions = {},
): Promise<string[]> {
  const subsidy = options.subsidyPerMarket ?? 0;
  if (subsidy > 0 && subsidy < MIN_LIQUIDITY_CONTRIBUTION) {
    throw new AppError(
      `Liquidity subsidy must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per market (LMSR b below this is butterfly-sensitive)`,
      400,
    );
  }
  if (subsidy > 0 && !options.proposerAgentId) {
    throw new AppError('proposerAgentId is required when subsidyPerMarket > 0', 400);
  }
  const lockKey = `lock:proposalMarket:${proposalId}`;

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
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));
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

    const sourceMarkets = openMarkets.filter(m => m.active !== false && !m.proposalId && leafMetricIds.has(m.metricId));
    const desiredKeys = new Set(sourceMarkets.map(m => `${m.metricId}:${m.targetDate}`));

    const existingConditional = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));

    if (existingConditional.length > 0) {
      const existingKeys = new Set(existingConditional.map(m => `${m.metricId}:${m.targetDate}`));
      const setsMatch = existingConditional.length === desiredKeys.size &&
        [...desiredKeys].every(k => existingKeys.has(k));
      if (setsMatch) return existingConditional.map(m => m.id);
    }

    await voidProposalMarkets(proposalId, workspaceId);

    const conditionalLiquidity = subsidy > 0 ? subsidy / Math.LN2 : 0;
    const newMarkets: typeof markets.$inferInsert[] = [];
    for (const src of sourceMarkets) {
      const marketId = randomUUID();
      newMarkets.push({
        id: marketId, workspaceId,
        metricId: src.metricId, metricName: src.metricName, targetDate: src.targetDate,
        resolved: false, resolvedAt: null, actualValue: null, active: true, proposalId,
        rangeMin: src.rangeMin, rangeMax: src.rangeMax,
        shares: [0, 0] as [number, number],
        liquidity: conditionalLiquidity,
        pool: subsidy > 0 ? subsidy : 0,
        createdAt: new Date(),
      });
    }

    const totalCost = subsidy > 0 ? Math.round(subsidy * newMarkets.length * 1e6) / 1e6 : 0;

    if (newMarkets.length > 0) {
      await db.transaction(async tx => {
        if (totalCost > 0) {
          const proposerId = options.proposerAgentId as string;
          const [agentRow] = await tx.select().from(agents).where(eq(agents.id, proposerId)).for('update');
          if (!agentRow) throw new AppError('Proposer agent not found', 404);
          if (!sufficientBalance(agentRow.balance as number, totalCost)) {
            throw new AppError(
              `Insufficient balance for forecast subsidy: need ${totalCost}, have ${fromUnits(agentRow.balance as number)}`,
              400,
            );
          }
          await tx.update(agents).set({
            balance: sql`${agents.balance} - ${toUnits(totalCost)}`,
            spentBetting: sql`${agents.spentBetting} + ${totalCost}`,
          }).where(eq(agents.id, proposerId));
        }

        await tx.insert(markets).values(newMarkets);

        if (totalCost > 0) {
          const proposerId = options.proposerAgentId as string;
          const liqRows = newMarkets.map(m => ({
            id: randomUUID(),
            workspaceId,
            marketId: m.id as string,
            agentId: proposerId,
            amount: subsidy,
            poolContribution: subsidy,
            totalLiquidity: conditionalLiquidity,
            type: 'proposal-subsidy',
            createdAt: new Date(),
          }));
          await tx.insert(liquidityEvents).values(liqRows);
        }
      });
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

export async function voidProposalMarkets(proposalId: string, workspaceId: string): Promise<void> {
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));

  for (const market of openMarkets) {
    await voidMarket(market, workspaceId);
  }
}

export async function approveProposal(proposalId: string, workspaceId: string): Promise<void> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));

  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status !== 'pending') throw new AppError('Proposal is not pending', 400);

  await db.update(proposals).set({ status: 'approved' })
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
}

export async function getProposalMarketSummaries(marketIds: string[], workspaceId: string) {
  if (marketIds.length === 0) return [];
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, marketIds)));
  return buildProposalMarketSummariesFromRows(rows, workspaceId);
}

export async function getProposalMarketSummariesForProposal(proposalId: string, workspaceId: string) {
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));
  return buildProposalMarketSummariesFromRows(rows, workspaceId);
}

async function buildProposalMarketSummariesFromRows(rows: MarketRow[], workspaceId: string) {
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

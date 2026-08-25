import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { agents, liquidityEvents, markets } from '../db/schema';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { fromUnits, MIN_LIQUIDITY_CONTRIBUTION, sufficientBalance, toUnits } from '../lib/validation';
import { applyCredits } from './credits';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function liquidityStateAfterPoolContribution(
  shares: [number, number],
  liquidity: number,
  pool: number | null,
  poolContribution: number,
): { newPool: number; newLiquidity: number; newShares: [number, number] } {
  const hasLiquidity = liquidity > 0;
  const oldPool = hasLiquidity ? (pool ?? 0) : 0;
  const newPool = oldPool + poolContribution;
  const newLiquidity = newPool / Math.LN2;
  const bRatio = hasLiquidity ? newLiquidity / liquidity : 1;
  const newShares: [number, number] = hasLiquidity ? [shares[0] * bRatio, shares[1] * bRatio] : [0, 0];
  return { newPool, newLiquidity, newShares };
}

/**
 * Debit agent and add pool contribution to one market (same rules as POST .../liquidity).
 * Locks market and agent rows within the transaction.
 */
export async function applyAgentLiquidityInjectionTx(
  tx: DbTx,
  params: {
    workspaceId: string;
    marketId: string;
    agentId: string;
    poolContribution: number;
  },
): Promise<void> {
  if (params.poolContribution < MIN_LIQUIDITY_CONTRIBUTION) {
    throw new AppError(
      `Liquidity contribution must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits (LMSR b < this produces butterfly-sensitive markets)`,
      400,
    );
  }

  const [market] = await tx
    .select()
    .from(markets)
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)))
    .for('update');
  if (!market) throw new AppError('Market not found', 404);

  const oldShares = (market.shares as [number, number]) || [0, 0];
  const { newPool, newLiquidity, newShares } = liquidityStateAfterPoolContribution(
    oldShares,
    market.liquidity,
    market.pool ?? 0,
    params.poolContribution,
  );

  const [agentRow] = await tx.select().from(agents).where(eq(agents.id, params.agentId)).for('update');
  if (!agentRow) throw new AppError('Agent not found', 404);
  if (!sufficientBalance(agentRow.balance as number, params.poolContribution)) {
    throw new AppError(
      `Insufficient balance: need ${params.poolContribution}, have ${fromUnits(agentRow.balance as number)}`,
      400,
    );
  }

  await tx
    .update(markets)
    .set({ liquidity: newLiquidity, shares: newShares, pool: newPool })
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)));
  await applyCredits(tx, {
    agentId: params.agentId,
    workspaceId: params.workspaceId,
    deltaUnits: -toUnits(params.poolContribution),
    reason: 'liquidity',
    refType: 'market',
    refId: params.marketId,
    also: { spentBetting: sql`${agents.spentBetting} + ${params.poolContribution}` },
  });
  await tx.insert(liquidityEvents).values({
    id: randomUUID(),
    workspaceId: params.workspaceId,
    marketId: params.marketId,
    agentId: params.agentId,
    amount: params.poolContribution,
    poolContribution: params.poolContribution,
    totalLiquidity: newLiquidity,
    type: 'injection',
    createdAt: new Date(),
  });
  emitPricesChanged(params.workspaceId, params.marketId);
}

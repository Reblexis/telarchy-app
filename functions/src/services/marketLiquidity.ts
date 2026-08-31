import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { agents, liquidityEvents, markets, metrics } from '../db/schema';
import { anchoredMarketState } from '../lib/amm';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { nearHorizonAnchorP } from '../lib/market-open';
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

  // The bought liquidity wallet spends first (owner decision 2026-08-28,
  // two currencies): a purchase exists only to become depth, so any wallet
  // that covers the whole contribution pays it. No mixing within one
  // injection - a contribution part-wallet part-balance would need its LP
  // leftover split two ways for one event, and simplicity is the contract.
  const wantUnits = toUnits(params.poolContribution);
  const fromWallet = (agentRow.liquidityBalance as number) >= wantUnits;
  if (!fromWallet && !sufficientBalance(agentRow.balance as number, params.poolContribution)) {
    throw new AppError(
      `Insufficient balance: need ${params.poolContribution}, have ${fromUnits(agentRow.balance as number)} tradeable and ${fromUnits(agentRow.liquidityBalance as number)} liquidity credits`,
      400,
    );
  }

  await tx
    .update(markets)
    .set({ liquidity: newLiquidity, shares: newShares, pool: newPool })
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)));
  if (fromWallet) {
    // The wallet is not the credit ledger's currency: its audit trail is
    // liquidity_purchases (inflow) and liquidity_events with
    // funded_from='liquidity' (outflow), so no ledger row is written and
    // spentBetting (a trading stat) does not move.
    await tx
      .update(agents)
      .set({ liquidityBalance: sql`${agents.liquidityBalance} - ${wantUnits}` })
      .where(eq(agents.id, params.agentId));
  } else {
    await applyCredits(tx, {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      deltaUnits: -wantUnits,
      reason: 'liquidity',
      refType: 'market',
      refId: params.marketId,
      also: { spentBetting: sql`${agents.spentBetting} + ${params.poolContribution}` },
    });
  }
  await tx.insert(liquidityEvents).values({
    id: randomUUID(),
    workspaceId: params.workspaceId,
    marketId: params.marketId,
    agentId: params.agentId,
    amount: params.poolContribution,
    poolContribution: params.poolContribution,
    totalLiquidity: newLiquidity,
    type: 'injection',
    fundedFrom: fromWallet ? 'liquidity' : 'balance',
    createdAt: new Date(),
  });
  // The book just came into existence, so this is where it gets its opening
  // price. Inside the injection rather than at each call site because there
  // were five call sites and one of them remembered (owner report
  // 2026-08-31). A no-op on every other injection: a market with a price
  // already has shares.
  await anchorUntradedMarketTx(tx, { workspaceId: params.workspaceId, marketId: params.marketId });
  emitPricesChanged(params.workspaceId, params.marketId);
}

/**
 * Open a just-funded, never-traded market at its metric's current value.
 *
 * Every path that turns a baseline market's liquidity from nothing into a
 * book calls this, and it is the only place that decides where such a market
 * opens. There were three such paths and only one of them anchored (owner
 * report 2026-08-31): the daily spawn anchored, the refresh that funds a
 * market which opened unfunded did not, and POST /api/predictions/markets did
 * not, so the same market opened at the metric's value or at the middle of its
 * range depending on whether the owner's balance happened to cover it that
 * morning. A price is not a coin flip about which code path ran.
 *
 * Refuses in exactly the cases where there is no untraded book to place:
 * no market, no liquidity, or shares that are not [0, 0] - the last one
 * covering both a market someone has traded and one already anchored, whose
 * price is a fact about the market rather than a default to overwrite.
 * Returns whether it anchored.
 */
export async function anchorUntradedMarketTx(
  tx: DbTx,
  params: { workspaceId: string; marketId: string; now?: Date },
): Promise<boolean> {
  const [market] = await tx
    .select()
    .from(markets)
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)))
    .for('update');
  if (!market) return false;

  const shares = (market.shares as [number, number]) || [0, 0];
  if (shares[0] !== 0 || shares[1] !== 0) return false;
  const pool = market.pool ?? 0;
  if (!(market.liquidity > 0) || pool <= 0) return false;
  // A conditional branch opens at the BASELINE market's consensus adjusted for
  // the branch and the contract's ask (services/proposals.ts), which is a
  // different question with a different input. The metric's own value is the
  // wrong number for it, so this function does not answer for one.
  if (market.proposalId) return false;

  const [metric] = await tx
    .select({ value: metrics.value })
    .from(metrics)
    .where(and(eq(metrics.id, market.metricId), eq(metrics.workspaceId, params.workspaceId)));
  const anchorP = nearHorizonAnchorP(
    market.targetDate,
    metric?.value,
    market.rangeMax,
    params.now ?? new Date(),
    market.rangeMin,
  );
  if (anchorP === null) return false;

  const anchored = anchoredMarketState(pool, anchorP);
  await tx
    .update(markets)
    .set({ shares: anchored.shares, liquidity: anchored.liquidity })
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)));
  // The anchored open changes the book's b, so it leaves a ledger row
  // (docs/market-integrity.md I4): no credits move (amount 0), but the replay
  // prices every later trade with the b recorded here. Without it the chart
  // replays the injection's fatter b and quotes prices the book never printed
  // (owner report 2026-08-29, the LookPilot weekly cliff). A millisecond after
  // NOW, not after `params.now`: that argument dates the horizon question
  // ("how far out is this market"), and a caller passing an older spawn
  // timestamp would file the anchor before the injection it follows and
  // invert the replay.
  await tx.insert(liquidityEvents).values({
    id: randomUUID(),
    workspaceId: params.workspaceId,
    marketId: params.marketId,
    amount: 0,
    totalLiquidity: anchored.liquidity,
    type: 'anchor',
    createdAt: new Date(Date.now() + 1),
  });
  return true;
}

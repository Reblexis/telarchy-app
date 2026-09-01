import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { agents, liquidityEvents, markets, metrics } from '../db/schema';
import { anchoredMarketState } from '../lib/amm';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { openingAnchorP } from '../lib/market-open';
import { fromUnits, MIN_LIQUIDITY_CONTRIBUTION, sufficientBalance, toUnits } from '../lib/validation';
import { applyCredits } from './credits';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * What a market's book becomes when somebody adds `poolContribution` to its
 * pool.
 *
 * b SCALES WITH THE POOL. It is not recomputed as `newPool / ln 2`, because
 * that is the size only a CENTRED book has: a market that opens off-centre
 * opens anchored, and `anchoredMarketState` sizes it thinner on purpose
 * (`b = subsidy / max(-ln p, -ln(1-p))`) so the cash actually paid in covers
 * the off-centre worst case exactly. Resizing to the symmetric answer on the
 * next injection inflated b and the anchor's seed shares by
 * `worstCase / ln 2` while the pool grew only by the contribution, and the
 * price did not move, so nothing said anything had happened. The difference
 * was minted at settlement: on the market the docs name (a metric reading 0
 * on a 0-1000 range, auto-funded 2000), a ONE NANOCREDIT injection took the
 * worst case from 2,000 to 11,288 against a pool of 2,000, and a 5,000
 * credit buy then settled 8,738 credits out of nothing (bug hunt
 * 2026-08-31, anchored-injection-solvency.test.ts).
 *
 * Scaling preserves whatever ratio the book already had, so a centred book
 * is unaffected: its b WAS `pool / ln 2`, so `b * newPool / pool` is
 * `newPool / ln 2` again. The shares scale by the same factor, which is what
 * leaves the price where it was.
 */
export function liquidityStateAfterPoolContribution(
  shares: [number, number],
  liquidity: number,
  pool: number | null,
  poolContribution: number,
): { newPool: number; newLiquidity: number; newShares: [number, number] } {
  const hasLiquidity = liquidity > 0;
  const oldPool = hasLiquidity ? (pool ?? 0) : 0;
  const newPool = oldPool + poolContribution;
  // A book with no depth yet has no ratio to preserve and no shares to
  // scale, so it is sized the way a fresh centred market is; the caller
  // anchors it afterwards if it should open off-centre
  // (anchorUntradedMarketTx). A book with depth but no pool on record cannot
  // be scaled from, and is treated the same way rather than dividing by zero.
  const scalable = hasLiquidity && oldPool > 0;
  const newLiquidity = scalable ? liquidity * (newPool / oldPool) : newPool / Math.LN2;
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

  // The bought liquidity wallet spends FIRST and is drained before the
  // tradeable balance is touched at all (owner decision 2026-08-28, two
  // currencies; owner ask 2026-08-30, "liquidity credits should be
  // prioritized and the standard ones only used when no liquidity credits
  // are left"). A contribution may therefore be part wallet, part balance,
  // which is why it can write TWO liquidity_events: leftovers are grouped
  // by purse (services/markets.ts, distributeLPLeftover), so each part
  // returns to the purse that paid it and bought credits still never leak
  // into a tradeable balance.
  const wantUnits = toUnits(params.poolContribution);
  const walletUnits = Math.min(agentRow.liquidityBalance as number, wantUnits);
  const balanceUnits = wantUnits - walletUnits;
  // Whether the tradeable balance may finish the job is the account's own
  // setting (default on, what every account did before it existed).
  const mayUseBalance = agentRow.poolFromBalance !== false;
  if (balanceUnits > 0 && !mayUseBalance) {
    throw new AppError(
      `Insufficient liquidity credits: need ${params.poolContribution}, have ${fromUnits(agentRow.liquidityBalance as number)}. This account is set to fund pools from liquidity credits only.`,
      400,
    );
  }
  if (balanceUnits > 0 && !sufficientBalance(agentRow.balance as number, fromUnits(balanceUnits))) {
    throw new AppError(
      `Insufficient balance: need ${params.poolContribution}, have ${fromUnits(agentRow.balance as number)} tradeable and ${fromUnits(agentRow.liquidityBalance as number)} liquidity credits`,
      400,
    );
  }

  await tx
    .update(markets)
    .set({ liquidity: newLiquidity, shares: newShares, pool: newPool })
    .where(and(eq(markets.id, params.marketId), eq(markets.workspaceId, params.workspaceId)));

  if (walletUnits > 0) {
    // The wallet is not the credit ledger's currency: its audit trail is
    // liquidity_purchases (inflow) and liquidity_events with
    // funded_from='liquidity' (outflow), so no ledger row is written and
    // spentBetting (a trading stat) does not move.
    await tx
      .update(agents)
      .set({ liquidityBalance: sql`${agents.liquidityBalance} - ${walletUnits}` })
      .where(eq(agents.id, params.agentId));
  }
  if (balanceUnits > 0) {
    const balanceCredits = fromUnits(balanceUnits);
    await applyCredits(tx, {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      deltaUnits: -balanceUnits,
      reason: 'liquidity',
      refType: 'market',
      refId: params.marketId,
      also: { spentBetting: sql`${agents.spentBetting} + ${balanceCredits}` },
    });
  }

  const parts: Array<{ from: 'liquidity' | 'balance'; credits: number }> = [];
  if (walletUnits > 0) parts.push({ from: 'liquidity', credits: fromUnits(walletUnits) });
  if (balanceUnits > 0) parts.push({ from: 'balance', credits: fromUnits(balanceUnits) });
  for (const part of parts) {
    await tx.insert(liquidityEvents).values({
      id: randomUUID(),
      workspaceId: params.workspaceId,
      marketId: params.marketId,
      agentId: params.agentId,
      amount: part.credits,
      poolContribution: part.credits,
      totalLiquidity: newLiquidity,
      type: 'injection',
      fundedFrom: part.from,
      createdAt: new Date(),
    });
  }
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
  const anchorP = openingAnchorP(
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

import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, liquidityPurchases } from '../db/schema';
import { toUnits } from '../lib/validation';

/**
 * Fulfil a paid liquidity purchase: credit the buyer's LIQUIDITY WALLET
 * (owner decision 2026-08-28, the two-currencies model). Nothing touches a
 * market here: the wallet spends later, through the normal injection path,
 * market by market, at the owner's hand. The wallet is walled - it can only
 * ever become pool contributions, and LP leftovers from wallet-funded
 * injections return to it (services/marketLiquidity.ts,
 * services/markets.ts) - which is what keeps a purchase a service rather
 * than a credit sale.
 *
 * Runs from the Stripe webhook, so it must be idempotent (Stripe retries
 * deliveries): the purchase row is locked, and a row already completed
 * returns without crediting again.
 */
export async function fulfillLiquidityPurchase(
  purchaseId: string,
  stripeSessionId: string,
): Promise<{ fulfilled: boolean; alreadyCompleted: boolean; credits: number }> {
  return await db.transaction(async tx => {
    const [purchase] = await tx
      .select()
      .from(liquidityPurchases)
      .where(eq(liquidityPurchases.id, purchaseId))
      .for('update');
    if (!purchase) return { fulfilled: false, alreadyCompleted: false, credits: 0 };
    if (purchase.status === 'completed') return { fulfilled: false, alreadyCompleted: true, credits: purchase.credits };
    // The session id must match the row the reference points at: a forged
    // reference to someone else's pending purchase would otherwise let one
    // cheap payment fulfil an expensive row.
    if (purchase.stripeSessionId && purchase.stripeSessionId !== stripeSessionId) {
      return { fulfilled: false, alreadyCompleted: false, credits: 0 };
    }

    await tx
      .update(agents)
      .set({ liquidityBalance: sql`${agents.liquidityBalance} + ${toUnits(purchase.credits)}` })
      .where(eq(agents.id, purchase.agentId));
    await tx
      .update(liquidityPurchases)
      .set({ status: 'completed', completedAt: new Date(), stripeSessionId })
      .where(eq(liquidityPurchases.id, purchaseId));
    return { fulfilled: true, alreadyCompleted: false, credits: purchase.credits };
  });
}

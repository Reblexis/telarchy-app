import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { liquidityPurchases, markets } from '../db/schema';
import { applyMintedLiquidityInjectionTx } from './marketLiquidity';

/**
 * Fulfil a paid liquidity purchase: mint its credits evenly into the
 * workspace's OPEN market pools.
 *
 * Runs from the Stripe webhook, so it must be idempotent (Stripe retries
 * deliveries): the purchase row is locked, and a row already completed
 * returns without touching a pool. Even-split across open markets is the
 * published allocation policy (docs/liquidity-purchases.md): credits are
 * free to move between books via trading anyway, and any cleverer policy
 * would be a judgement the purchase page never showed the buyer.
 *
 * A workspace with no open market at fulfilment time (checkout refuses
 * this, so it takes a race between payment and every market resolving)
 * completes with an empty allocation; the money is service revenue either
 * way and the operator can inject by hand.
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

    const open = await tx
      .select({ id: markets.id })
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, purchase.workspaceId),
          eq(markets.active, true),
          eq(markets.resolved, false),
          eq(markets.voided, false),
        ),
      );

    const allocation: Record<string, number> = {};
    if (open.length > 0) {
      const per = purchase.credits / open.length;
      for (const m of open) {
        await applyMintedLiquidityInjectionTx(tx, {
          workspaceId: purchase.workspaceId,
          marketId: m.id,
          poolContribution: per,
        });
        allocation[m.id] = per;
      }
    }

    await tx
      .update(liquidityPurchases)
      .set({ status: 'completed', completedAt: new Date(), allocation, stripeSessionId })
      .where(eq(liquidityPurchases.id, purchaseId));
    return { fulfilled: true, alreadyCompleted: false, credits: purchase.credits };
  });
}

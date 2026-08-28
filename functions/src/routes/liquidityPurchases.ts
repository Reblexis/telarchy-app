import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { type Request, type Response, Router } from 'express';
import { db } from '../db/client';
import { liquidityPurchases, markets, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { publicOrigins } from '../lib/origins';
import { isPlatformAuthorized } from '../lib/platform-admin';
import {
  createCheckoutSession,
  isLiquidityPurchaseEnabled,
  liquidityCreditsPerUsd,
  verifyStripeSignature,
} from '../lib/stripe';
import { wrap } from '../lib/wrap';
import { computeCapabilities } from '../middleware/capabilities';
import { requireIdentity } from '../middleware/roles';
import { fulfillLiquidityPurchase } from '../services/liquidityPurchases';

/**
 * Paid market liquidity: the one place real money enters the managed
 * instance (owner decision 2026-08-28; docs/liquidity-purchases.md is the
 * governing doc). A workspace admin buys pool liquidity for their own
 * markets through Stripe Checkout; the webhook mints the credits into the
 * workspace's open market pools, never into a balance.
 *
 * Money-vs-contest boundary, stated once: the payment buys a service
 * (sharper prices on the buyer's own markets), not contest entry. What
 * keeps that true in code: credits land pool-only
 * (applyMintedLiquidityInjectionTx has no balance write), and purchasers
 * hold manage on a public workspace, which is exactly the class strict
 * season eligibility pays nothing (lib/seasons.ts).
 */
export const liquidityPurchasesRouter = Router();

const MIN_PURCHASE_USD = 5;
const MAX_PURCHASE_USD = 5000;

function baseUrl(): string {
  return publicOrigins()[0] ?? 'https://telarchy.com';
}

function requireEnabled() {
  if (!isLiquidityPurchaseEnabled()) {
    throw new AppError(
      'Liquidity purchases are disabled on this instance (no Stripe configuration). Fund markets with credits via POST /api/predictions/markets/:id/liquidity instead.',
      503,
    );
  }
}

async function requireManageOn(req: Request, workspaceId: string) {
  const caps =
    workspaceId === req.auth?.workspaceId
      ? req.auth.capabilities
      : await computeCapabilities({
          workspaceId,
          uid: req.auth?.uid,
          agentId: req.auth?.agentId,
          isMasterKey: req.auth?.isMasterKey,
        });
  if (!caps.has('manage')) {
    throw new AppError('Forbidden: this identity lacks the "manage" capability in this workspace.', 403);
  }
}

/**
 * Start a purchase: create the pending row and the Stripe Checkout session,
 * return the URL to send the buyer to. Nothing changes on any market until
 * the webhook confirms payment.
 */
liquidityPurchasesRouter.post(
  '/workspaces/:id/liquidity/checkout',
  requireIdentity,
  wrap(async (req, res) => {
    requireEnabled();
    const workspaceId = req.params.id as string;
    await requireManageOn(req, workspaceId);

    const usdAmount = Number(req.body?.usdAmount);
    if (!Number.isFinite(usdAmount) || usdAmount < MIN_PURCHASE_USD || usdAmount > MAX_PURCHASE_USD) {
      throw new AppError(`usdAmount must be between ${MIN_PURCHASE_USD} and ${MAX_PURCHASE_USD} US dollars`, 400);
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new AppError('Workspace not found', 404);

    // Refuse a purchase that could not be allocated: the webhook splits the
    // credits across open markets, and money with nowhere to go is a
    // support ticket, not a feature.
    const open = await db
      .select({ id: markets.id })
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, workspaceId),
          eq(markets.active, true),
          eq(markets.resolved, false),
          eq(markets.voided, false),
        ),
      );
    if (open.length === 0) throw new AppError('This workspace has no open markets to fund', 409);

    const creditsPerUsd = liquidityCreditsPerUsd();
    const purchaseId = randomUUID();
    await db.insert(liquidityPurchases).values({
      id: purchaseId,
      workspaceId,
      agentId: req.auth?.agentId ?? req.auth?.uid ?? 'unknown',
      usdAmount,
      credits: usdAmount * creditsPerUsd,
      creditsPerUsd,
      status: 'pending',
    });

    const session = await createCheckoutSession({
      usdAmount,
      workspaceName: ws.name,
      purchaseId,
      successUrl: `${baseUrl()}/manage?liquidity=purchased`,
      cancelUrl: `${baseUrl()}/manage?liquidity=cancelled`,
    });
    await db
      .update(liquidityPurchases)
      .set({ stripeSessionId: session.id })
      .where(eq(liquidityPurchases.id, purchaseId));

    res.status(201).json({
      purchaseId,
      url: session.url,
      credits: usdAmount * creditsPerUsd,
      creditsPerUsd,
      openMarkets: open.length,
    });
  }),
);

/** A workspace admin's purchase history for that workspace. */
liquidityPurchasesRouter.get(
  '/workspaces/:id/liquidity/purchases',
  requireIdentity,
  wrap(async (req, res) => {
    const workspaceId = req.params.id as string;
    await requireManageOn(req, workspaceId);
    const rows = await db
      .select()
      .from(liquidityPurchases)
      .where(eq(liquidityPurchases.workspaceId, workspaceId))
      .orderBy(desc(liquidityPurchases.createdAt));
    res.json({
      purchases: rows.map(r => ({
        id: r.id,
        usdAmount: r.usdAmount,
        credits: r.credits,
        creditsPerUsd: r.creditsPerUsd,
        status: r.status,
        allocation: r.allocation ?? null,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    });
  }),
);

/**
 * Liquidity revenue over a window: the number that sizes the next season's
 * pool, `pool(N+1) = max(pool(0), k x revenue(N)) + rollover(N)`
 * (docs/liquidity-purchases.md). Platform admin only.
 */
liquidityPurchasesRouter.get(
  '/liquidity/revenue',
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin required', 403);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(0);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError('from and to must be ISO dates', 400);
    }
    const rows = await db.select().from(liquidityPurchases).where(eq(liquidityPurchases.status, 'completed'));
    const inWindow = rows.filter(r => {
      const at = r.completedAt ? new Date(r.completedAt) : new Date(r.createdAt);
      return at >= from && at <= to;
    });
    res.json({
      totalUsd: inWindow.reduce((sum, r) => sum + r.usdAmount, 0),
      purchases: inWindow.length,
      from,
      to,
    });
  }),
);

/**
 * The Stripe webhook. Mounted in app.ts with express.raw BEFORE the global
 * JSON body parser, because signature verification needs the exact bytes
 * Stripe signed. Always 200 on events we ignore, so Stripe stops
 * retrying them; 400 only on a bad signature.
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!isLiquidityPurchaseEnabled()) {
    res.status(503).json({ error: 'Liquidity purchases are disabled on this instance' });
    return;
  }
  const payload = (req.body as Buffer | undefined)?.toString('utf8') ?? '';
  const ok = verifyStripeSignature(
    payload,
    req.headers['stripe-signature'] as string | undefined,
    process.env.STRIPE_WEBHOOK_SECRET as string,
  );
  if (!ok) {
    res.status(400).json({ error: 'Bad signature' });
    return;
  }

  let event: {
    type?: string;
    data?: { object?: { id?: string; client_reference_id?: string; payment_status?: string } };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    res.status(400).json({ error: 'Bad payload' });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;
    const purchaseId = session?.client_reference_id;
    // 'paid' is the only state that mints; async payment methods send a
    // later async_payment_succeeded we treat identically below.
    if (purchaseId && session?.id && session.payment_status === 'paid') {
      await fulfillLiquidityPurchase(purchaseId, session.id);
    }
  } else if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object;
    if (session?.client_reference_id && session.id) {
      await fulfillLiquidityPurchase(session.client_reference_id, session.id);
    }
  }
  res.json({ received: true });
}

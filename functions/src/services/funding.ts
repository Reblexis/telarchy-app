/**
 * Funding packages (docs/liquidity.md): a card payment through Stripe
 * Checkout that becomes liquidity credits in the workspace's budget and a
 * cash share of that workspace's next monthly pool.
 *
 * Stripe is spoken to over its REST API with fetch (no SDK): two calls,
 * create a Checkout Session and verify a webhook signature. The webhook is
 * the only thing that credits anything; a returned browser is not proof of
 * payment.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { fundingPurchases, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import {
  assignPoolMonth,
  CREDITS_PER_USD,
  MAX_PURCHASE_CENTS,
  MIN_PURCHASE_CENTS,
  POOL_FRACTION_BP,
  splitPurchase,
} from '../lib/funding';
import { applyBudget } from './liquidityBudget';
import { addToScheduledPool } from './workspacePools';

export function fundingEnabled(): boolean {
  return process.env.FUNDING_ENABLED === 'true' && Boolean(process.env.STRIPE_SECRET_KEY);
}

type Transport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
let transport: Transport = (url, init) => fetch(url, init);
/** Tests swap the network out; production never calls this. */
export function setStripeTransportForTests(t: Transport | null): void {
  transport = t ?? ((url, init) => fetch(url, init));
}

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Create the pending purchase and the Checkout Session for it. Returns the
 * URL to send the buyer to. Nothing is credited here.
 */
export async function createFundingCheckout(params: {
  workspaceId: string;
  buyerAgentId: string | null;
  amountCents: number;
  /** Built from the purchase id so the return page can name what it paid for. */
  successUrl: (purchaseId: string) => string;
  cancelUrl: string;
}): Promise<{ purchaseId: string; url: string }> {
  if (!fundingEnabled()) throw new AppError('Funding packages are not enabled on this instance', 503);
  const { workspaceId, buyerAgentId, amountCents } = params;
  if (!Number.isInteger(amountCents) || amountCents < MIN_PURCHASE_CENTS || amountCents > MAX_PURCHASE_CENTS) {
    throw new AppError(`amountCents must be an integer between ${MIN_PURCHASE_CENTS} and ${MAX_PURCHASE_CENTS}`, 400);
  }
  const [ws] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!ws) throw new AppError('Workspace not found', 404);

  const purchaseId = randomUUID();
  const { creditsUnits, poolCents } = splitPurchase(amountCents);
  const dollars = (amountCents / 100).toFixed(2);
  const res = await transport('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode({
      mode: 'payment',
      client_reference_id: purchaseId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': `Telarchy funding package for ${ws.name}`,
      'line_items[0][price_data][product_data][description]': `$${dollars}: ${(
        (amountCents * CREDITS_PER_USD) / 100
      ).toLocaleString('en-US')} credits of market liquidity plus a $${(poolCents / 100).toFixed(
        2,
      )} prize pool for the workspace's next month. Non-refundable.`,
      'metadata[purchaseId]': purchaseId,
      'metadata[workspaceId]': workspaceId,
      success_url: params.successUrl(purchaseId),
      cancel_url: params.cancelUrl,
    }),
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url) {
    throw new AppError(`Payment provider refused the session: ${body.error?.message ?? res.status}`, 502);
  }
  await db.insert(fundingPurchases).values({
    id: purchaseId,
    workspaceId,
    buyerAgentId,
    amountCents,
    creditsUnits,
    poolCents,
    poolMonth: assignPoolMonth(new Date()),
    creditsPerUsd: CREDITS_PER_USD,
    poolFractionBp: POOL_FRACTION_BP,
    providerSessionId: body.id,
    status: 'pending',
  });
  return { purchaseId, url: body.url };
}

/** Stripe's signature scheme: `t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">`. */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map(kv => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
}

/**
 * Apply a paid Checkout Session: credit the budget and the month's pool,
 * once. Safe to call again with the same session; the second call is a
 * no-op. The month is decided at payment time, not at checkout creation,
 * because a running month's pool is fixed (docs/workspace-pools.md).
 */
export async function applyPaidSession(session: {
  id: string;
  payment_status?: string;
  payment_intent?: string | null;
  amount_total?: number | null;
}): Promise<{ applied: boolean; purchaseId?: string }> {
  if (session.payment_status && session.payment_status !== 'paid') return { applied: false };
  const paidAt = new Date();
  return db.transaction(async tx => {
    const [purchase] = await tx
      .select()
      .from(fundingPurchases)
      .where(eq(fundingPurchases.providerSessionId, session.id))
      .for('update');
    if (!purchase) return { applied: false };
    if (purchase.status === 'paid') return { applied: false, purchaseId: purchase.id };
    if (typeof session.amount_total === 'number' && session.amount_total !== purchase.amountCents) {
      throw new AppError(`Paid amount ${session.amount_total} does not match purchase ${purchase.amountCents}`, 409);
    }
    const poolMonth = assignPoolMonth(paidAt);
    await tx
      .update(fundingPurchases)
      .set({
        status: 'paid',
        paidAt,
        poolMonth,
        providerPaymentRef: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      })
      .where(and(eq(fundingPurchases.id, purchase.id), eq(fundingPurchases.status, 'pending')));
    await applyBudget(tx, {
      workspaceId: purchase.workspaceId,
      deltaUnits: Number(purchase.creditsUnits),
      reason: 'purchase',
      refType: 'purchase',
      refId: purchase.id,
    });
    await addToScheduledPool(tx, purchase.workspaceId, poolMonth, purchase.poolCents);
    return { applied: true, purchaseId: purchase.id };
  });
}

/** Parse and apply one webhook delivery. Unknown event types are acknowledged and ignored. */
export async function handleStripeWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<{ handled: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError('Webhook secret not configured', 503);
  if (!verifyStripeSignature(rawBody, signatureHeader, secret)) throw new AppError('Bad signature', 400);
  const event = JSON.parse(rawBody) as { type?: string; data?: { object?: Record<string, unknown> } };
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { handled: 'ignored' };
  }
  const obj = event.data?.object;
  if (!obj || typeof obj.id !== 'string') throw new AppError('Malformed event', 400);
  const result = await applyPaidSession({
    id: obj.id,
    payment_status: typeof obj.payment_status === 'string' ? obj.payment_status : undefined,
    payment_intent: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
    amount_total: typeof obj.amount_total === 'number' ? obj.amount_total : null,
  });
  return { handled: result.applied ? 'applied' : 'noop' };
}

/**
 * A funding package granted by the operator without a card payment: the
 * invoice-plus-grant path (an owner who paid by bank transfer, or a package
 * Telarchy sponsors), and the way to exercise pools on an instance with no
 * payment provider. Same split, same records, provider 'manual'.
 */
export async function grantFundingPackage(params: {
  workspaceId: string;
  amountCents: number;
  note?: string | null;
  grantedByAgentId?: string | null;
}): Promise<{ purchaseId: string; poolMonth: string }> {
  const { workspaceId, amountCents } = params;
  if (!Number.isInteger(amountCents) || amountCents < MIN_PURCHASE_CENTS || amountCents > MAX_PURCHASE_CENTS) {
    throw new AppError(`amountCents must be an integer between ${MIN_PURCHASE_CENTS} and ${MAX_PURCHASE_CENTS}`, 400);
  }
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new AppError('Workspace not found', 404);
  const purchaseId = randomUUID();
  const { creditsUnits, poolCents } = splitPurchase(amountCents);
  const now = new Date();
  const poolMonth = assignPoolMonth(now);
  await db.transaction(async tx => {
    await tx.insert(fundingPurchases).values({
      id: purchaseId,
      workspaceId,
      buyerAgentId: params.grantedByAgentId ?? null,
      amountCents,
      creditsUnits,
      poolCents,
      poolMonth,
      creditsPerUsd: CREDITS_PER_USD,
      poolFractionBp: POOL_FRACTION_BP,
      provider: 'manual',
      providerSessionId: `manual:${purchaseId}`,
      providerPaymentRef: params.note ?? null,
      status: 'paid',
      paidAt: now,
    });
    await applyBudget(tx, {
      workspaceId,
      deltaUnits: creditsUnits,
      reason: 'purchase',
      refType: 'purchase',
      refId: purchaseId,
    });
    await addToScheduledPool(tx, workspaceId, poolMonth, poolCents);
  });
  return { purchaseId, poolMonth };
}

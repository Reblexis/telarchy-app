import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from './errors';

/**
 * The one place real money enters Telarchy: a workspace owner buys market
 * liquidity through Stripe Checkout (owner decision 2026-08-28; design
 * records in the telarchy umbrella,
 * notes/real-money-economy-design-2026-08-26.md approach A and
 * notes/trader-rewards-design-2026-08-28.md, owner-purchased liquidity).
 *
 * Deliberately SDK-free: Checkout session creation is one form-encoded POST
 * and webhook verification is one HMAC, and a dependency that large for two
 * calls would put a supply chain between the platform and its only payment
 * path.
 *
 * The whole feature is env-gated, like USDC settlement: without
 * STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET every purchase surface
 * answers 503 and the instance sells nothing.
 */

export function isLiquidityPurchaseEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/**
 * Provisional price (approved design open question: "$1 = 100 credits of
 * pool liquidity", Viktor to confirm before the first sale). Env override
 * so confirming the number is a config change, not a deploy.
 */
export function liquidityCreditsPerUsd(): number {
  const raw = Number(process.env.LIQUIDITY_CREDITS_PER_USD ?? 100);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Create a Stripe Checkout session for a liquidity purchase.
 *
 * `purchaseId` rides in client_reference_id and metadata, so the webhook can
 * find the pending row without trusting anything else in the event. The
 * session id is stored on the row as a second key for idempotency.
 */
export async function createCheckoutSession(params: {
  usdAmount: number;
  workspaceName: string;
  purchaseId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams({
    mode: 'payment',
    client_reference_id: params.purchaseId,
    'metadata[purchaseId]': params.purchaseId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(params.usdAmount * 100)),
    'line_items[0][price_data][product_data][name]': `Market liquidity: ${params.workspaceName}`,
    'line_items[0][price_data][product_data][description]':
      'Non-refundable. Credits enter market pools only and never a balance.',
  });
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !json.id || !json.url) {
    // Stripe's message is safe to surface to a workspace admin; it says
    // things like "amount too small", never secrets.
    throw new AppError(`Stripe refused the checkout session: ${json.error?.message ?? res.status}`, 502);
  }
  return { id: json.id, url: json.url };
}

/**
 * Verify a Stripe-Signature header against the raw request payload.
 *
 * The scheme is Stripe's own: the header carries `t=<unix seconds>` and one
 * or more `v1=<hex hmac>`; the signed message is `${t}.${payload}` keyed
 * with the webhook secret. Timestamp tolerance bounds replay; comparison is
 * timing-safe. Returns false rather than throwing, because a bad signature
 * is an expected input on a public endpoint, not an exception.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowMs: number = Date.now(),
): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const idx = piece.indexOf('=');
    if (idx < 1) continue;
    const k = piece.slice(0, idx).trim();
    const v = piece.slice(idx + 1).trim();
    parts.set(k, [...(parts.get(k) ?? []), v]);
  }
  const t = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return signatures.some(sig => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

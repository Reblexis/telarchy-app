/**
 * A paid Checkout Session is applied once (docs/liquidity.md): the budget is
 * credited, the next month's pool is funded, and a redelivered webhook is a
 * no-op. The signature check is Stripe's scheme, verified by hand.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { createHmac } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { fundingPurchases, workspacePools, workspaces } from '../db/schema';
import { assignPoolMonth, splitPurchase } from '../lib/funding';
import { applyPaidSession, grantFundingPackage, verifyStripeSignature } from '../services/funding';
import { readBudgetUnits } from '../services/liquidityBudget';
import { ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-1';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values({ id: WS, name: 'W', slug: 'w', createdBy: 'owner', visibility: 'public' });
  const { creditsUnits, poolCents } = splitPurchase(10_000);
  await db.insert(fundingPurchases).values({
    id: 'p1',
    workspaceId: WS,
    buyerAgentId: 'owner',
    amountCents: 10_000,
    creditsUnits,
    poolCents,
    poolMonth: '2026-10',
    creditsPerUsd: 1000,
    poolFractionBp: 8000,
    providerSessionId: 'cs_test_1',
    status: 'pending',
  });
});

test('the signature scheme: t.body hmac, five-minute tolerance', () => {
  const body = '{"id":"evt"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', 'whsec').update(`${t}.${body}`).digest('hex');
  expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, 'whsec')).toBe(true);
  expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, 'other')).toBe(false);
  expect(verifyStripeSignature(`${body} `, `t=${t},v1=${v1}`, 'whsec')).toBe(false);
  expect(verifyStripeSignature(body, `t=${t - 1000},v1=${v1}`, 'whsec')).toBe(false);
  expect(verifyStripeSignature(body, undefined, 'whsec')).toBe(false);
});

test("a paid session credits the budget and the next month's pool, once", async () => {
  const first = await applyPaidSession({
    id: 'cs_test_1',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 10_000,
  });
  expect(first).toEqual({ applied: true, purchaseId: 'p1' });
  expect(await readBudgetUnits(db, WS)).toBe(splitPurchase(10_000).creditsUnits);
  const month = assignPoolMonth(new Date());
  const [pool] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, month)));
  expect(pool.poolCents).toBe(8_000);
  expect(pool.status).toBe('scheduled');
  const [purchase] = await db.select().from(fundingPurchases).where(eq(fundingPurchases.id, 'p1'));
  expect(purchase.status).toBe('paid');
  expect(purchase.poolMonth).toBe(month);
  expect(purchase.providerPaymentRef).toBe('pi_1');

  const again = await applyPaidSession({ id: 'cs_test_1', payment_status: 'paid', amount_total: 10_000 });
  expect(again).toEqual({ applied: false, purchaseId: 'p1' });
  expect(await readBudgetUnits(db, WS)).toBe(splitPurchase(10_000).creditsUnits);
  const [poolAgain] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, month)));
  expect(poolAgain.poolCents).toBe(8_000);
});

test('an unpaid, unknown, or mismatched session credits nothing', async () => {
  expect(await applyPaidSession({ id: 'cs_test_1', payment_status: 'unpaid' })).toEqual({ applied: false });
  expect(await applyPaidSession({ id: 'cs_nobody', payment_status: 'paid' })).toEqual({ applied: false });
  await expect(applyPaidSession({ id: 'cs_test_1', payment_status: 'paid', amount_total: 9_999 })).rejects.toThrow(
    /does not match/,
  );
  expect(await readBudgetUnits(db, WS)).toBe(0);
});

test('an operator grant is a paid package with provider manual', async () => {
  const { purchaseId, poolMonth } = await grantFundingPackage({
    workspaceId: WS,
    amountCents: 2_500,
    note: 'invoice 7',
  });
  expect(poolMonth).toBe(assignPoolMonth(new Date()));
  expect(await readBudgetUnits(db, WS)).toBe(splitPurchase(2_500).creditsUnits);
  const [purchase] = await db.select().from(fundingPurchases).where(eq(fundingPurchases.id, purchaseId));
  expect(purchase.provider).toBe('manual');
  expect(purchase.status).toBe('paid');
  const [pool] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, poolMonth)));
  expect(pool.poolCents).toBe(2_000);
  await expect(grantFundingPackage({ workspaceId: 'nope', amountCents: 100 })).rejects.toThrow(/not found/);
});

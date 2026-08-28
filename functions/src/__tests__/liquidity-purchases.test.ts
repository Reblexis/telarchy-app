/**
 * Paid liquidity against a real database: the checkout gate, the webhook's
 * signature wall, the pool-only fulfilment, and its idempotency. Stripe
 * itself is a mocked fetch; the money-shaped rules are what run for real.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, liquidityEvents, liquidityPurchases, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { liquidityPurchasesRouter, stripeWebhookHandler } from '../routes/liquidityPurchases';
import { applyAgentLiquidityInjectionTx } from '../services/marketLiquidity';
import { voidMarket } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-liq';
const SECRET_KEY = 'sk_test_x';
const WEBHOOK_SECRET = 'whsec_test_x';

let caller: { agentId?: string; uid?: string; isMasterKey?: boolean } = { isMasterKey: true, agentId: 'buyer' };

const app = express();
// Same shape app.ts mounts: raw body for the webhook, JSON for the rest.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), wrap(stripeWebhookHandler));
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller & { capabilities: Set<string> } }).auth = {
    ...caller,
    capabilities: new Set(caller.isMasterKey ? ['read', 'trade', 'manage'] : []),
  };
  next();
});
app.use('/api', liquidityPurchasesRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500 && !(err instanceof AppError)) console.error(err);
  res.status(status).json({ error: err.message });
});

const realFetch = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  caller = { isMasterKey: true, agentId: 'buyer' };
  process.env.STRIPE_SECRET_KEY = SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  global.fetch = jest.fn(
    async () =>
      new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
});
afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  global.fetch = realFetch;
});

async function seedWorkspace(marketIds: string[]) {
  await db.insert(agents).values({ id: 'buyer', apiKeyHash: 'h-buyer', balance: toUnits(500) });
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Floor', slug: 'floor', createdBy: 'buyer', visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-liq',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  for (const id of marketIds) {
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: 'metric-liq',
      metricName: 'Revenue',
      targetDate: `t-${id}`,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
  }
}

function signedWebhook(body: unknown): { payload: string; header: string } {
  const payload = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return { payload, header: `t=${t},v1=${v1}` };
}

function completedEvent(purchaseId: string, sessionId = 'cs_test_1') {
  return {
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, client_reference_id: purchaseId, payment_status: 'paid' } },
  };
}

async function poolOf(marketId: string): Promise<number> {
  const [m] = await db.select({ pool: markets.pool }).from(markets).where(eq(markets.id, marketId));
  return m.pool as number;
}

describe('checkout', () => {
  test('503 when the instance has no Stripe configuration', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await seedWorkspace(['m1']);
    const res = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    expect(res.status).toBe(503);
  });

  test('records a pending purchase and returns the Stripe URL', async () => {
    await seedWorkspace(['m1', 'm2']);
    const res = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain('checkout.stripe.com');
    expect(res.body.credits).toBe(100000); // $1 = 1,000 credits, owner-confirmed
    const [row] = await db.select().from(liquidityPurchases).where(eq(liquidityPurchases.id, res.body.purchaseId));
    expect(row.status).toBe('pending');
    expect(row.stripeSessionId).toBe('cs_test_1');
    // Nothing credited before the webhook: paying is what mints.
    const [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(buyer.liquidityBalance).toBe(0);
  });

  test('a workspace with no open market can still buy: the wallet holds until markets exist', async () => {
    await seedWorkspace([]);
    const res = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    expect(res.status).toBe(201);
  });

  test('the slug reaches the same checkout as the id', async () => {
    await seedWorkspace(['m1']);
    const res = await request(app).post('/api/workspaces/floor/liquidity/checkout').send({ usdAmount: 100 });
    expect(res.status).toBe(201);
  });

  test('bounds the amount', async () => {
    await seedWorkspace(['m1']);
    for (const usdAmount of [0, -5, 4.99, 5001, 'x']) {
      const res = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount });
      expect(res.status).toBe(400);
    }
  });

  test('requires the manage capability in the workspace', async () => {
    await seedWorkspace(['m1']);
    caller = { agentId: 'stranger' };
    const res = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    expect(res.status).toBe(403);
  });
});

describe('the webhook', () => {
  test("credits the buyer's liquidity wallet, once, however often Stripe retries", async () => {
    await seedWorkspace(['m1', 'm2']);
    const checkout = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    const purchaseId = checkout.body.purchaseId as string;
    const poolBefore = await poolOf('m1');

    const { payload, header } = signedWebhook(completedEvent(purchaseId));
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', header)
      .set('content-type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);

    // The two-currencies model (owner decision 2026-08-28): the purchase is
    // wallet credits, and NO market moves until the owner places them.
    const [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(fromUnits(buyer.liquidityBalance as number)).toBe(100000);
    expect(await poolOf('m1')).toBeCloseTo(poolBefore, 6);
    const [row] = await db.select().from(liquidityPurchases).where(eq(liquidityPurchases.id, purchaseId));
    expect(row.status).toBe('completed');

    // Stripe redelivers; the wallet must not grow again.
    const again = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', signedWebhook(completedEvent(purchaseId)).header)
      .set('content-type', 'application/json')
      .send(payload);
    expect(again.status).toBe(200);
    const [buyer2] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(fromUnits(buyer2.liquidityBalance as number)).toBe(100000);
  });

  test('an injection spends the wallet first, and a void returns the leftover to the wallet', async () => {
    await seedWorkspace(['m1']);
    await db
      .update(agents)
      .set({ liquidityBalance: toUnits(1000) })
      .where(eq(agents.id, 'buyer'));
    const poolBefore = await poolOf('m1');

    await db.transaction(async tx => {
      await applyAgentLiquidityInjectionTx(tx as never, {
        workspaceId: WS,
        marketId: 'm1',
        agentId: 'buyer',
        poolContribution: 600,
      });
    });
    let [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(fromUnits(buyer.liquidityBalance as number)).toBe(400);
    // The tradeable balance never moved: the wallet paid.
    expect(fromUnits(buyer.balance as number)).toBe(500);
    expect(await poolOf('m1')).toBeCloseTo(poolBefore + 600, 6);
    const [ev] = await db
      .select()
      .from(liquidityEvents)
      .where(eq(liquidityEvents.marketId, 'm1'))
      .orderBy(liquidityEvents.createdAt);
    expect(ev.fundedFrom ?? 'liquidity').toBe('liquidity');

    // Void the market: the pool leftover routes back BY SOURCE, so the
    // wallet-funded share returns to the wallet and never becomes stake.
    const [market] = await db.select().from(markets).where(eq(markets.id, 'm1'));
    await voidMarket(market, WS);
    [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(fromUnits(buyer.liquidityBalance as number)).toBeGreaterThan(400);
    expect(fromUnits(buyer.balance as number)).toBe(500);
  });

  test('a wallet too small for the whole amount falls back to the tradeable balance', async () => {
    await seedWorkspace(['m1']);
    await db
      .update(agents)
      .set({ liquidityBalance: toUnits(100) })
      .where(eq(agents.id, 'buyer'));
    await db.transaction(async tx => {
      await applyAgentLiquidityInjectionTx(tx as never, {
        workspaceId: WS,
        marketId: 'm1',
        agentId: 'buyer',
        poolContribution: 300,
      });
    });
    const [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(fromUnits(buyer.liquidityBalance as number)).toBe(100);
    expect(fromUnits(buyer.balance as number)).toBe(200);
  });

  test('a bad signature mints nothing and is refused', async () => {
    await seedWorkspace(['m1']);
    const checkout = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    const before = await poolOf('m1');
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('content-type', 'application/json')
      .send(JSON.stringify(completedEvent(checkout.body.purchaseId)));
    expect(res.status).toBe(400);
    expect(await poolOf('m1')).toBeCloseTo(before, 6);
  });

  test('an unpaid session mints nothing', async () => {
    await seedWorkspace(['m1']);
    const checkout = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    const before = await poolOf('m1');
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', client_reference_id: checkout.body.purchaseId, payment_status: 'unpaid' } },
    };
    const { payload, header } = signedWebhook(event);
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', header)
      .set('content-type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(await poolOf('m1')).toBeCloseTo(before, 6);
    const [row] = await db.select().from(liquidityPurchases).where(eq(liquidityPurchases.id, checkout.body.purchaseId));
    expect(row.status).toBe('pending');
  });

  test("a session id that does not match the purchase's mints nothing", async () => {
    await seedWorkspace(['m1']);
    const checkout = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    const before = await poolOf('m1');
    const { payload, header } = signedWebhook(completedEvent(checkout.body.purchaseId, 'cs_forged_other'));
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', header)
      .set('content-type', 'application/json')
      .send(payload);
    expect(await poolOf('m1')).toBeCloseTo(before, 6);
    const [buyer] = await db.select().from(agents).where(eq(agents.id, 'buyer'));
    expect(buyer.liquidityBalance).toBe(0);
  });
});

describe('history and revenue', () => {
  test('purchases list and completed revenue window', async () => {
    await seedWorkspace(['m1']);
    const checkout = await request(app).post(`/api/workspaces/${WS}/liquidity/checkout`).send({ usdAmount: 100 });
    const { payload, header } = signedWebhook(completedEvent(checkout.body.purchaseId));
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', header)
      .set('content-type', 'application/json')
      .send(payload);

    const list = await request(app).get(`/api/workspaces/${WS}/liquidity/purchases`);
    expect(list.status).toBe(200);
    expect(list.body.purchases).toHaveLength(1);
    expect(list.body.purchases[0].status).toBe('completed');

    const revenue = await request(app).get('/api/liquidity/revenue');
    expect(revenue.status).toBe(200);
    expect(revenue.body.totalUsd).toBe(100);
    expect(revenue.body.purchases).toBe(1);
  });
});

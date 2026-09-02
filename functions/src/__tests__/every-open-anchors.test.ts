/**
 * A BOOK THAT OPENS ON AN UNTRADED MARKET OPENS AT THE METRIC'S VALUE.
 *
 * Not "the daily spawn does". Every path that turns a baseline market from no
 * liquidity into a book, whichever endpoint supplied the credits. The owner
 * asked for the range-floor fix and then for the rest of it ("make sure the
 * bug isnt anywehre else etiher", 2026-08-31), and there were five paths, of
 * which one anchored:
 *
 *   1. the daily spawn                        (fixed, PR #73)
 *   2. the refresh funding an unfunded market (fixed, PR #73)
 *   3. POST /markets with auto-fund           (fixed, PR #73)
 *   4. POST /markets with an explicit liquidity amount
 *   5. POST /markets/liquidity/bulk, and POST /markets/:id/liquidity
 *
 * 4 and 5 are what this file pins. The rule they share is the name of the
 * file: which endpoint paid for the book cannot change the price it opens at.
 *
 * And its mirror, which matters just as much: a book that ALREADY has a price
 * is never re-anchored. A top-up is not a re-open, an already-anchored market
 * is not a blank one, and a conditional branch prices a different question
 * (the baseline adjusted for approval and the ask, services/proposals.ts), so
 * the metric's own value is the wrong number for it.
 */

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
  requireSelfOrAdmin: () => (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals, trades } from '../db/schema';
import { consensus } from '../lib/amm';
import { toAbsoluteDate } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-every-open';
const OWNER = 'owner-every-open';
const METRIC = 'm-revenue';
const NEAR = toAbsoluteDate('+2w');
const RANGE_MAX = 1000;
/** The metric reads $0 on a 0-1,000 range: the reported case. */
const VALUE = 0;
/** 2% of the range, the lowest a solvent LMSR book can be seeded at. */
// One part in a thousand of a 0-1,000 range (ANCHOR_P_FLOOR); it was 2%, $20,
// until 2026-09-02.
const FLOOR_OPEN = 1;
const MIDPOINT = 500;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    workspaceId: WS,
    agentId: OWNER,
    capabilities: new Set(['manage', 'read', 'trade']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/predictions', predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-every', balance: toUnits(100_000) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Telarchy',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Telarchy revenue (USD)',
    value: VALUE,
    formula: '0',
    marketRangeMax: RANGE_MAX,
  });
});

async function priceOf(marketId: string): Promise<number> {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, WS)));
  return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) as number;
}

async function seedBareMarket(
  id: string,
  opts: { targetDate?: string; proposalId?: string; shares?: [number, number]; liquidity?: number } = {},
) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Telarchy revenue (USD)',
    targetDate: opts.targetDate ?? NEAR,
    rangeMin: 0,
    rangeMax: RANGE_MAX,
    shares: opts.shares ?? ([0, 0] as [number, number]),
    liquidity: opts.liquidity ?? 0,
    pool: opts.liquidity ? opts.liquidity * Math.LN2 : 0,
    active: true,
    resolved: false,
    voided: false,
    proposalId: opts.proposalId ?? null,
    createdAt: new Date(),
  });
}

describe('a book opening on an untraded market opens at the metric value', () => {
  test('POST /markets with an explicit liquidity amount', async () => {
    const res = await request(app)
      .post('/api/predictions/markets')
      .send({ metricId: METRIC, targetDate: NEAR, liquidity: 250, skipAutoLiquidity: true });
    expect(res.status).toBe(201);
    const opened = await priceOf(res.body.id);
    expect(opened).toBeCloseTo(FLOOR_OPEN, 1);
    expect(opened).toBeLessThan(MIDPOINT / 2);
  });

  test('POST /markets/:id/liquidity, the first credits into an empty market', async () => {
    await seedBareMarket('mk-single');
    const res = await request(app).post('/api/predictions/markets/mk-single/liquidity').send({ amount: 250 });
    expect(res.status).toBe(200);
    expect(await priceOf('mk-single')).toBeCloseTo(FLOOR_OPEN, 1);
  });

  test('POST /markets/liquidity/bulk, the first credits into an empty market', async () => {
    await seedBareMarket('mk-bulk');
    const res = await request(app).post('/api/predictions/markets/liquidity/bulk').send({ amount: 250 });
    expect(res.status).toBe(200);
    expect(await priceOf('mk-bulk')).toBeCloseTo(FLOOR_OPEN, 1);
  });

  test('a far-horizon market anchors on every one of those paths too', async () => {
    // Owner rule 2026-08-31: the horizon stopped deciding where a book opens.
    await seedBareMarket('mk-far', { targetDate: '2099-12-31' });
    await request(app).post('/api/predictions/markets/mk-far/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-far')).toBeCloseTo(FLOOR_OPEN, 1);
    expect(await priceOf('mk-far')).not.toBeCloseTo(MIDPOINT, 0);
  });
});

describe('a book that already has a price is never re-anchored', () => {
  test('a top-up of a traded market does not move it', async () => {
    await seedBareMarket('mk-traded', { shares: [0, 120], liquidity: 300 });
    await db.insert(trades).values({
      id: 't-1',
      workspaceId: WS,
      marketId: 'mk-traded',
      agentId: OWNER,
      direction: 'higher',
      shares: 120,
      cost: 60,
      createdAt: new Date(),
    });
    const before = await priceOf('mk-traded');
    await request(app).post('/api/predictions/markets/mk-traded/liquidity').send({ amount: 250 });
    // Injecting scales b and the shares together, so the price is preserved
    // exactly; what must not happen is the anchor overwriting it.
    expect(await priceOf('mk-traded')).toBeCloseTo(before, 4);
    expect(before).toBeGreaterThan(MIDPOINT);
  });

  test('a top-up of an untraded but already ANCHORED market does not re-open it', async () => {
    // Shares outstanding with no trade behind them is exactly what an anchored
    // open looks like. It is a price, not a blank.
    await seedBareMarket('mk-anchored', { shares: [900, 0], liquidity: 300 });
    const before = await priceOf('mk-anchored');
    await request(app).post('/api/predictions/markets/mk-anchored/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-anchored')).toBeCloseTo(before, 4);
  });

  test('a conditional branch is never anchored to the metric value', async () => {
    // Its price is the baseline adjusted for the branch and the ask
    // (lib/branch-anchor.ts). With no baseline market at all there is no
    // such price, and the centre is what is left.
    await db.insert(proposals).values({
      id: 'prop-1',
      workspaceId: WS,
      title: 'A proposal',
      description: 'x',
      status: 'pending',
      proposedBy: OWNER,
      createdAt: new Date(),
    });
    await seedBareMarket('mk-cond', { proposalId: 'prop-1' });
    await request(app).post('/api/predictions/markets/mk-cond/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-cond')).toBeCloseTo(MIDPOINT, 0);
  });
});

describe('a branch that spawned unfunded opens at the baseline price when first given money', () => {
  // docs/guides/creating.md, "A conditional pair opens at the baseline
  // price ... whenever its book is first given money". The Wallpaper
  // Animator floor's price-cut proposal carried no subsidy, its owner
  // deepened both branches a minute later, and they opened at $12,500 on a
  // 0-25,000 range while the unconditional 31 Dec market sat at $6,126
  // (owner report 2026-09-02: "it should liquidate at the main unconditional
  // market value unless specified otherwise").
  const BASELINE = 300;
  async function seedBaselineAt(value: number, id = 'mk-base') {
    // A funded, anchored baseline sitting at `value`: seed it bare, fund it
    // through the route and let the metric value place it.
    await db.update(metrics).set({ value }).where(eq(metrics.id, METRIC));
    await seedBareMarket(id);
    await request(app).post(`/api/predictions/markets/${id}/liquidity`).send({ amount: 250 });
    expect(await priceOf(id)).toBeCloseTo(value, 0);
  }
  async function seedProposal(id: string, askUsd = 0) {
    await db.insert(proposals).values({
      id,
      workspaceId: WS,
      title: askUsd > 0 ? `$${askUsd}: A paid job` : 'A proposal',
      description: 'x',
      status: 'pending',
      proposedBy: OWNER,
      askUsd,
      createdAt: new Date(),
    });
  }
  async function seedBranch(id: string, proposalId: string, branch: 'approved' | 'declined') {
    await seedBareMarket(id, { proposalId });
    await db.update(markets).set({ branch }).where(eq(markets.id, id));
  }

  test('the declined branch opens where the unconditional market is', async () => {
    await seedBaselineAt(BASELINE);
    await seedProposal('prop-free');
    await seedBranch('mk-declined', 'prop-free', 'declined');
    await request(app).post('/api/predictions/markets/mk-declined/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-declined')).toBeCloseTo(BASELINE, 0);
  });

  test('a free proposal opens both branches at the same number', async () => {
    await seedBaselineAt(BASELINE);
    await seedProposal('prop-free');
    await seedBranch('mk-a', 'prop-free', 'approved');
    await seedBranch('mk-d', 'prop-free', 'declined');
    await request(app).post('/api/predictions/markets/mk-a/liquidity').send({ amount: 250 });
    await request(app).post('/api/predictions/markets/mk-d/liquidity').send({ amount: 100 });
    expect(await priceOf('mk-a')).toBeCloseTo(BASELINE, 0);
    expect(await priceOf('mk-d')).toBeCloseTo(BASELINE, 0);
  });

  test('the approved branch of a paid job opens lower by its ask on a net-money metric', async () => {
    await db.update(metrics).set({ name: 'Telarchy net revenue (USD)' }).where(eq(metrics.id, METRIC));
    await db.update(markets).set({ metricName: 'Telarchy net revenue (USD)' }).where(eq(markets.workspaceId, WS));
    await seedBaselineAt(BASELINE);
    await db.update(markets).set({ metricName: 'Telarchy net revenue (USD)' }).where(eq(markets.workspaceId, WS));
    await seedProposal('prop-paid', 100);
    await seedBranch('mk-paid-a', 'prop-paid', 'approved');
    await seedBranch('mk-paid-d', 'prop-paid', 'declined');
    await db.update(markets).set({ metricName: 'Telarchy net revenue (USD)' }).where(eq(markets.workspaceId, WS));
    await request(app).post('/api/predictions/markets/mk-paid-a/liquidity').send({ amount: 250 });
    await request(app).post('/api/predictions/markets/mk-paid-d/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-paid-a')).toBeCloseTo(BASELINE - 100, 0);
    expect(await priceOf('mk-paid-d')).toBeCloseTo(BASELINE, 0);
  });

  test('the baseline is the one for the SAME settle date, not another horizon', async () => {
    await seedBaselineAt(BASELINE);
    // A far market of the same metric priced elsewhere must not be the anchor.
    await db.update(metrics).set({ value: 900 }).where(eq(metrics.id, METRIC));
    await seedBareMarket('mk-far', { targetDate: toAbsoluteDate('+12w') });
    await request(app).post('/api/predictions/markets/mk-far/liquidity').send({ amount: 250 });
    await seedProposal('prop-near');
    await seedBranch('mk-near-d', 'prop-near', 'declined');
    await request(app).post('/api/predictions/markets/mk-near-d/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-near-d')).toBeCloseTo(BASELINE, 0);
  });

  test('a branch with an unfunded baseline opens at the centre', async () => {
    await seedBareMarket('mk-base-dead');
    await seedProposal('prop-dead');
    await seedBranch('mk-dead-d', 'prop-dead', 'declined');
    await request(app).post('/api/predictions/markets/mk-dead-d/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-dead-d')).toBeCloseTo(MIDPOINT, 0);
  });

  test('a branch anyone has traded is never re-opened by a top-up', async () => {
    await seedBaselineAt(BASELINE);
    await seedProposal('prop-traded');
    await seedBranch('mk-traded', 'prop-traded', 'declined');
    // Someone traded it at the centre: shares are not [0, 0] any more.
    await db
      .update(markets)
      .set({ shares: [0, 40], liquidity: 100, pool: 100 * Math.LN2 })
      .where(eq(markets.id, 'mk-traded'));
    const before = await priceOf('mk-traded');
    await request(app).post('/api/predictions/markets/mk-traded/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-traded')).toBeCloseTo(before, 0);
  });

  test('the bulk top-up opens a bare branch at the baseline too', async () => {
    await seedBaselineAt(BASELINE);
    await seedProposal('prop-bulk');
    await seedBranch('mk-bulk-d', 'prop-bulk', 'declined');
    const res = await request(app)
      .post('/api/predictions/markets/liquidity/bulk')
      .send({ amount: 250, proposalId: 'prop-bulk' });
    expect(res.status).toBe(200);
    expect(await priceOf('mk-bulk-d')).toBeCloseTo(BASELINE, 0);
  });
});

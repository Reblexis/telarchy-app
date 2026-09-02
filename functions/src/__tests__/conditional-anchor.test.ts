/**
 * Conditional markets open at the baseline's value, not the center
 * (owner decision 2026-08-11), and the approved branch opens at baseline
 * minus the job's ask (approval burns the ask into the resolving metric,
 * so "same as baseline" would already be a bullish claim). The other
 * property under test is solvency: an off-center open sizes b DOWN so
 * the subsidy still covers the worst case; it never mints.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { anchoredMarketState, consensus, directionTradeCost, sharesForBudget } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-anchor';
const PROPOSER = 'agent-anchor-proposer';

// Baseline on [0, 100] seeded to consensus 60: b = 100, diff = b*ln(.6/.4).
const BASE_B = 100;
const BASE_DIFF = BASE_B * Math.log(0.6 / 0.4);

async function seed() {
  await db.insert(agents).values([{ id: PROPOSER, apiKeyHash: 'h-anchor-p', balance: toUnits(1000) }]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Anchor Test',
    createdBy: PROPOSER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-anchor',
    workspaceId: WS,
    name: 'Net revenue (USD)',
    value: 60,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-base-anchor',
    workspaceId: WS,
    metricId: 'metric-anchor',
    metricName: 'Net revenue (USD)',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, BASE_DIFF],
    liquidity: BASE_B,
    pool: 100,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

function propose(body: Record<string, unknown>) {
  return request(app)
    .post('/api/proposals')
    .set('X-Test-Agent-Id', PROPOSER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);
}

async function branchMarkets(proposalId: string) {
  const rows = (
    await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)))
  ).filter(m => !m.resolved);
  const val = (m: (typeof rows)[number]) =>
    consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax);
  return {
    approved: rows.find(m => m.branch === 'approved')!,
    declined: rows.find(m => m.branch === 'declined')!,
    val,
  };
}

describe('anchored conditional opens', () => {
  test('a free job opens both branches at the baseline value', async () => {
    await seed();
    const res = await propose({ title: 'free job', description: '', liquiditySubsidy: 20, askUsd: 0 });
    expect(res.status).toBe(201);
    const { approved, declined, val } = await branchMarkets(res.body.id);
    expect(val(approved)).toBeCloseTo(60, 0);
    expect(val(declined)).toBeCloseTo(60, 0);
  });

  test('a headcount metric does not subtract the dollar ask (2026-08-15)', async () => {
    await seed();
    // The ask burns out of the metric only when the metric IS that money.
    // Against a metric counted in people this subtracted dollars from a
    // headcount, pinning every approved branch at the range floor and
    // printing the same fake negative impact on every contract.
    await db.update(metrics).set({ name: 'Weekly active traders' }).where(eq(metrics.id, 'metric-anchor'));
    await db.update(markets).set({ metricName: 'Weekly active traders' }).where(eq(markets.id, 'mkt-base-anchor'));
    const res = await propose({
      title: '$20: paid job',
      description: '',
      liquiditySubsidy: 20,
      askUsd: 20,
      payoutHandle: 'pay@example.com',
    });
    expect(res.status).toBe(201);
    const { approved, declined, val } = await branchMarkets(res.body.id);
    expect(val(approved)).toBeCloseTo(60, 0);
    expect(val(declined)).toBeCloseTo(60, 0);
  });

  test('a paid job opens the approved branch at baseline minus the ask', async () => {
    await seed();
    const res = await propose({
      title: '$20: paid job',
      description: '',
      liquiditySubsidy: 20,
      askUsd: 20,
      payoutHandle: 'pay@example.com',
    });
    expect(res.status).toBe(201);
    const { approved, declined, val } = await branchMarkets(res.body.id);
    expect(val(approved)).toBeCloseTo(40, 0);
    expect(val(declined)).toBeCloseTo(60, 0);
    // The anchored book is thinner than a center open with the same
    // subsidy: that thinness is what pays for the anchor.
    expect(approved.liquidity).toBeLessThan(20 / Math.LN2);
    expect(approved.pool).toBeCloseTo(20, 5);
  });

  test('an unpriced baseline still opens the pair at the center', async () => {
    await seed();
    await db
      .update(markets)
      .set({ liquidity: 0, pool: 0, shares: [0, 0] })
      .where(eq(markets.id, 'mkt-base-anchor'));
    const res = await propose({ title: 'free job', description: '', liquiditySubsidy: 20, askUsd: 0 });
    expect(res.status).toBe(201);
    const { approved, val } = await branchMarkets(res.body.id);
    expect(val(approved)).toBeCloseTo(50, 0);
    expect(approved.liquidity).toBeCloseTo(20 / Math.LN2, 5);
  });
});

describe('anchored open solvency', () => {
  test('the subsidy covers the worst case at every anchor, including the extremes', async () => {
    for (const p of [0, 0.001, 0.02, 0.1, 0.35, 0.5, 0.65, 0.9, 0.98, 0.999, 1]) {
      const subsidy = 250;
      const { liquidity: b, shares } = anchoredMarketState(subsidy, p);
      for (const dir of [0, 1] as const) {
        // A whale buys one side as hard as any budget allows; if that side
        // wins, cash (subsidy + what the whale paid) must cover the payout.
        const { amount, cost } = sharesForBudget(shares, dir, 100_000, b);
        expect(amount).toBeLessThanOrEqual(subsidy + cost + 0.01);
      }
    }
  });

  test('the anchor is where the price actually sits', () => {
    const { liquidity: b, shares } = anchoredMarketState(250, 0.4907);
    expect(consensus(shares, b, 0, 150_000)).toBeCloseTo(0.4907 * 150_000, -2);
    // And a tiny trade barely moves it (sanity: the book is real).
    const cost = directionTradeCost(shares, 1, 1, b);
    expect(cost).toBeGreaterThan(0.4);
    expect(cost).toBeLessThan(0.6);
  });
});

describe('legacy title-priced proposals', () => {
  test('a "$N:" title with no askUsd column still opens ask-adjusted', async () => {
    await seed();
    const res = await propose({
      title: '$20: legacy job',
      description: '',
      liquiditySubsidy: 20,
      askUsd: 20,
      payoutHandle: 'pay@example.com',
    });
    expect(res.status).toBe(201);
    // Simulate the pre-column row: null askUsd, price only in the title.
    const { proposals: proposalsTable } = require('../db/schema');
    await db.update(proposalsTable).set({ askUsd: null }).where(eq(proposalsTable.id, res.body.id));
    // Void the pair and respawn (the rollover path every legacy row takes).
    const { markets: marketsTable } = require('../db/schema');
    await db
      .update(marketsTable)
      .set({ resolved: true, active: false })
      .where(and(eq(marketsTable.workspaceId, WS), eq(marketsTable.proposalId, res.body.id)));
    const { createConditionalMarkets } = require('../services/proposals');
    await createConditionalMarkets(res.body.id, WS, { contributions: { [PROPOSER]: 20 } });
    const { approved, declined, val } = await branchMarkets(res.body.id);
    expect(val(approved)).toBeCloseTo(40, 0);
    expect(val(declined)).toBeCloseTo(60, 0);
  });
});

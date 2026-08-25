/**
 * Durable proposal subsidy contributions.
 *
 * Admin liquidity top-ups on a pending proposal (bulk injection with
 * proposalId) are recorded in proposals.subsidyContributions and bump the
 * liquiditySubsidy running total, so (a) the proposal header reflects the
 * top-up immediately and (b) when conditional markets roll to new target
 * dates, the re-spawned generation is re-seeded with the same per-market
 * amounts, debiting the same contributors.
 *
 * Regression: top-ups used to live only in the market rows. The proposal's
 * liquiditySubsidy stayed at its creation-time value (UI kept showing the
 * "No subsidy" warning after a successful add), and the next rollover
 * refunded the injection and spawned replacements at zero liquidity.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// Mock the auth middleware (better-auth is ESM-only and can't load through
// ts-jest). req.auth is populated from test headers.
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
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { createConditionalMarkets, subsidyContributionsOf } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
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

const WS = 'ws-subsidy-topup';
const OWNER = 'agent-topup-owner';
const PROPOSER = 'agent-topup-proposer';
const METRIC = 'metric-topup';
const PROPOSAL = 'proposal-topup';
const TARGET = '2026-12';
const START_CREDITS = 1000;

async function seed(opts: { creationSubsidy?: number } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-topup-owner', balance: toUnits(START_CREDITS), platformAdmin: true },
    { id: PROPOSER, apiKeyHash: 'h-topup-proposer', balance: toUnits(START_CREDITS) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Subsidy Topup',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  // One natural-trajectory market -> the proposal spawns 2 branch markets.
  await db.insert(markets).values({
    id: 'mkt-base-topup',
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Throughput',
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });

  const creationSubsidy = opts.creationSubsidy ?? 0;
  await db.insert(proposals).values({
    id: PROPOSAL,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: 'topup proposal',
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: creationSubsidy,
    subsidyContributions: creationSubsidy > 0 ? { [PROPOSER]: creationSubsidy } : {},
  });
  const ids = await createConditionalMarkets(PROPOSAL, WS, {
    contributions: creationSubsidy > 0 ? { [PROPOSER]: creationSubsidy } : {},
    strict: true,
  });
  await db
    .update(proposals)
    .set({ conditionalMarketIds: ids })
    .where(and(eq(proposals.id, PROPOSAL), eq(proposals.workspaceId, WS)));
  return ids;
}

function bulkFund(callerId: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/markets/liquidity/bulk')
    .set('X-Test-Agent-Id', callerId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);
}

async function getProposal() {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, PROPOSAL), eq(proposals.workspaceId, WS)));
  return row;
}

async function liveConditionalMarkets() {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, PROPOSAL)));
  return rows.filter(m => !m.resolved && !m.voided);
}

describe('bulk injection with proposalId records a durable contribution', () => {
  test('top-up updates subsidyContributions, liquiditySubsidy, and market pools', async () => {
    await seed();

    const res = await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ markets: 2, totalCost: 4, amountPerMarket: 2 });

    const proposal = await getProposal();
    expect(proposal.liquiditySubsidy).toBeCloseTo(2, 6);
    expect(proposal.subsidyContributions).toEqual({ [OWNER]: 2 });

    for (const m of await liveConditionalMarkets()) {
      expect(m.pool).toBeCloseTo(2, 6);
      expect(m.liquidity).toBeCloseTo(2 / Math.LN2, 6);
    }
  });

  test('repeat top-ups accumulate per contributor on top of a creation subsidy', async () => {
    await seed({ creationSubsidy: 1 });

    await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });
    await bulkFund(OWNER, { amount: 0.5, proposalId: PROPOSAL });

    const proposal = await getProposal();
    expect(proposal.liquiditySubsidy).toBeCloseTo(3.5, 6);
    expect(proposal.subsidyContributions).toEqual({ [PROPOSER]: 1, [OWNER]: 2.5 });
  });

  // There is no minimum depth for a top-up: a thin market is the proposer's
  // risk to take. The floor only rules out a degenerate zero-liquidity market,
  // so 0.05 is accepted and only a non-positive amount is refused.
  test('a small top-up is accepted; only a non-positive amount is rejected', async () => {
    await seed();
    const small = await bulkFund(OWNER, { amount: 0.05, proposalId: PROPOSAL });
    expect(small.status).toBe(200);

    const zero = await bulkFund(OWNER, { amount: 0, proposalId: PROPOSAL });
    expect(zero.status).toBe(400);
  });

  test('unknown proposalId is a 404, no injection happens', async () => {
    await seed();
    const res = await bulkFund(OWNER, { amount: 2, proposalId: 'nope' });
    expect(res.status).toBe(404);
    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    expect(fromUnits(owner.balance as number)).toBeCloseTo(START_CREDITS, 6);
  });
});

describe('rollover re-seeds recorded contributions', () => {
  test('re-spawned markets carry the topped-up subsidy and debit the contributor', async () => {
    await seed();
    await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });

    // Roll the baseline to a new target date; the old conditional markets'
    // (metric, targetDate) tuples leave the desired set and get voided.
    await db
      .update(markets)
      .set({ targetDate: '2027-01' })
      .where(and(eq(markets.id, 'mkt-base-topup'), eq(markets.workspaceId, WS)));

    const proposal = await getProposal();
    const ids = await createConditionalMarkets(PROPOSAL, WS, {
      contributions: subsidyContributionsOf(proposal),
    });
    expect(ids).toHaveLength(2);

    const live = await liveConditionalMarkets();
    expect(live).toHaveLength(2);
    for (const m of live) {
      expect(m.targetDate).toBe('2027-01');
      expect(m.pool).toBeCloseTo(2, 6);
      expect(m.liquidity).toBeCloseTo(2 / Math.LN2, 6);
    }

    // Net cost to the contributor stays one generation's worth: the voided
    // generation's pool is refunded, the new generation is debited.
    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    expect(fromUnits(owner.balance as number)).toBeCloseTo(START_CREDITS - 4, 6);
  });

  test('multiple contributors are each debited their share on re-spawn', async () => {
    await seed({ creationSubsidy: 1 });
    await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });

    await db
      .update(markets)
      .set({ targetDate: '2027-01' })
      .where(and(eq(markets.id, 'mkt-base-topup'), eq(markets.workspaceId, WS)));

    const proposal = await getProposal();
    await createConditionalMarkets(PROPOSAL, WS, {
      contributions: subsidyContributionsOf(proposal),
    });

    const live = await liveConditionalMarkets();
    expect(live).toHaveLength(2);
    for (const m of live) {
      expect(m.pool).toBeCloseTo(3, 6); // 1 (proposer) + 2 (owner)
      expect(m.liquidity).toBeCloseTo(3 / Math.LN2, 6);
    }

    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    const [proposer] = await db.select().from(agents).where(eq(agents.id, PROPOSER));
    // One live generation each: owner 2/market, proposer 1/market, 2 markets.
    expect(fromUnits(owner.balance as number)).toBeCloseTo(START_CREDITS - 4, 6);
    expect(fromUnits(proposer.balance as number)).toBeCloseTo(START_CREDITS - 2, 6);
  });

  test('non-strict spawn skips an underfunded contributor instead of failing', async () => {
    await seed({ creationSubsidy: 1 });
    await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });

    // Drain the proposer. Voiding the old generation refunds them 2 credits
    // (1/market x 2 markets), so the new generation must cost more than that
    // for them to be genuinely underfunded: add a second baseline metric so
    // 4 markets spawn (cost 4 > refund 2).
    await db
      .update(agents)
      .set({ balance: toUnits(0) })
      .where(eq(agents.id, PROPOSER));
    await db
      .update(markets)
      .set({ targetDate: '2027-01' })
      .where(and(eq(markets.id, 'mkt-base-topup'), eq(markets.workspaceId, WS)));
    await db.insert(metrics).values({
      id: 'metric-topup-2',
      workspaceId: WS,
      name: 'Latency',
      value: 0,
      formula: '0',
      marketRangeMax: 100,
    });
    await db.insert(markets).values({
      id: 'mkt-base-topup-2',
      workspaceId: WS,
      metricId: 'metric-topup-2',
      metricName: 'Latency',
      targetDate: '2027-01',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const proposal = await getProposal();
      await createConditionalMarkets(PROPOSAL, WS, {
        contributions: subsidyContributionsOf(proposal),
      });
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('without their share'));
    } finally {
      consoleError.mockRestore();
    }

    const live = await liveConditionalMarkets();
    expect(live).toHaveLength(4);
    for (const m of live) {
      expect(m.pool).toBeCloseTo(2, 6); // owner's share only
    }
  });

  test('strict spawn throws when a contributor cannot cover the subsidy', async () => {
    await seed();
    await db
      .update(agents)
      .set({ balance: toUnits(0) })
      .where(eq(agents.id, PROPOSER));
    await expect(
      createConditionalMarkets('proposal-strict', WS, {
        contributions: { [PROPOSER]: 5 },
        strict: true,
      }),
    ).rejects.toThrow(/Insufficient balance/);
  });
});

describe('decided proposals do not accumulate contributions', () => {
  test('top-up on an approved proposal injects but is not recorded', async () => {
    await seed();
    await db
      .update(proposals)
      .set({ status: 'approved' })
      .where(and(eq(proposals.id, PROPOSAL), eq(proposals.workspaceId, WS)));

    const res = await bulkFund(OWNER, { amount: 2, proposalId: PROPOSAL });
    expect(res.status).toBe(200);

    const proposal = await getProposal();
    expect(proposal.liquiditySubsidy).toBeCloseTo(0, 6);
    expect(proposal.subsidyContributions).toEqual({});
    for (const m of await liveConditionalMarkets()) {
      expect(m.pool).toBeCloseTo(2, 6);
    }
  });
});

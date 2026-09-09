/**
 * Trading closes at the decision, and an undecided proposal lapses at its
 * deadline. The deadline's own rules (its default, its scale, that it never
 * moves) live in decision-window.test.ts.
 * (docs/guides/proposals.md, "The deadline, and the close"; docs/guides/
 * get-paid.md, "The decision"; docs/market-integrity.md I1b, "The deadline
 * moves later, never earlier"). Owner decision 2026-09-08.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, limitOrders, markets, metrics, positions, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { proposalsRouter } from '../routes/proposals';
import { workspacesRouter } from '../routes/workspaces';
import { approveProposal, declineProposal, lapseOverdueProposals, withdrawProposal } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/workspaces', authMiddleware, workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message, code: (err as AppError).code });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-deadline';
const OWNER = 'agent-dl-owner';
const PROPOSER = 'agent-dl-proposer';
const TRADER = 'agent-dl-trader';
const METRIC = 'metric-dl';
const _DAY = 24 * 60 * 60 * 1000;

async function seed(opts: { decisionMinutes?: number } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-dl-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-dl-proposer', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-dl-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Deadline',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  if (opts.decisionMinutes !== undefined) {
    await db.update(workspaces).set({ decisionMinutes: opts.decisionMinutes }).where(eq(workspaces.id, WS));
  }
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Throughput',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  // Two baseline dates: one that settles before any plausible deadline, one
  // far in the future.
  for (const [id, targetDate] of [
    ['mkt-dl-soon', '2020'],
    ['mkt-dl-far', '2099'],
  ] as const) {
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Throughput',
      targetDate,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    });
  }
}

const post = (body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .post('/api/proposals')
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const _patch = (id: string, body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .patch(`/api/proposals/${id}`)
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const trade = (agent: string, marketId: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId, ...body });

async function proposal(id: string) {
  return (await db.select().from(proposals).where(eq(proposals.id, id)))[0];
}
async function pairOf(id: string) {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, id)));
  return {
    rows,
    approved: rows.find(m => m.branch === 'approved' && !m.resolved) ?? rows.find(m => m.branch === 'approved')!,
    declined: rows.find(m => m.branch === 'declined' && !m.resolved) ?? rows.find(m => m.branch === 'declined')!,
  };
}
async function posted(body: Record<string, unknown> = {}) {
  const res = await post({ title: 'do the thing', description: '', liquiditySubsidy: 20, ...body });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('every proposal has a deadline', () => {
  test('only cells whose date settles after the deadline get a pair', async () => {
    await seed();
    const id = await posted();
    const { rows } = await pairOf(id);
    expect(rows.map(m => m.targetDate).sort()).toEqual(['2099', '2099']);
  });

  test('the payload carries decideBy, closedAt and lapsedAt', async () => {
    await seed();
    const id = await posted();
    const res = await request(app).get(`/api/proposals/${id}`).set('X-Test-Agent-Id', OWNER).set('X-Workspace-Id', WS);
    expect(res.status).toBe(200);
    expect(res.body.decideBy).toBeTruthy();
    expect(res.body.closedAt).toBeNull();
    expect(res.body.lapsedAt).toBeNull();
  });
});

describe('trading closes at the decision', () => {
  test('approving closes both branches to buys and sells and releases limit orders', async () => {
    await seed();
    const id = await posted();
    const { approved, declined } = await pairOf(id);
    expect((await trade(TRADER, approved.id, { direction: 'higher', amount: 5 })).status).toBe(201);
    await db.insert(limitOrders).values({
      id: 'order-dl',
      workspaceId: WS,
      marketId: approved.id,
      agentId: TRADER,
      direction: 'lower',
      limitValue: 10,
      budgetCredits: 5,
      filledCredits: 0,
      status: 'open',
    });
    await db
      .update(agents)
      .set({ balance: toUnits(1000) })
      .where(eq(agents.id, TRADER));

    await approveProposal(id, WS, OWNER);
    const p = await proposal(id);
    expect(p.closedAt).not.toBeNull();

    const buy = await trade(TRADER, approved.id, { direction: 'higher', amount: 5 });
    expect(buy.status).toBe(400);
    expect(buy.body.code).toBe('proposal_closed');
    const held = (await db.select().from(positions).where(eq(positions.agentId, TRADER))).find(
      x => x.marketId === approved.id,
    )!;
    const sell = await trade(TRADER, approved.id, { direction: 'higher', sellShares: held.shares });
    expect(sell.status).toBe(400);
    expect(sell.body.code).toBe('proposal_closed');
    // The declined branch was voided anyway; it answers as voided or closed, never trades.
    expect((await trade(TRADER, declined.id, { direction: 'higher', amount: 5 })).status).toBe(400);
    // The resting order is gone and its credits are back.
    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, 'order-dl'));
    expect(order.status).not.toBe('open');
    // The approved book is still open for settlement: not voided, not resolved.
    const after = (await pairOf(id)).approved;
    expect(after.voided).toBe(false);
    expect(after.resolved).toBe(false);
  });

  test('declining closes the same way', async () => {
    await seed();
    const id = await posted();
    const { declined } = await pairOf(id);
    await declineProposal(id, WS, OWNER, 'not now');
    expect((await proposal(id)).closedAt).not.toBeNull();
    const buy = await trade(TRADER, declined.id, { direction: 'higher', amount: 5 });
    expect(buy.status).toBe(400);
    expect(buy.body.code).toBe('proposal_closed');
  });

  test('withdrawing closes it too', async () => {
    await seed();
    const id = await posted();
    await withdrawProposal(id, WS, PROPOSER);
    expect((await proposal(id)).closedAt).not.toBeNull();
  });

  test('a pending proposal still trades', async () => {
    await seed();
    const id = await posted();
    const { approved } = await pairOf(id);
    expect((await trade(TRADER, approved.id, { direction: 'higher', amount: 5 })).status).toBe(201);
  });
});

describe('undecided at the deadline, a proposal lapses', () => {
  test('the sweep voids both branches, closes it and marks it lapsed', async () => {
    await seed();
    const id = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 60_000) })
      .where(eq(proposals.id, id));
    const n = await lapseOverdueProposals(WS);
    expect(n).toBe(1);
    const p = await proposal(id);
    expect(p.status).toBe('lapsed');
    expect(p.lapsedAt).not.toBeNull();
    expect(p.closedAt).not.toBeNull();
    expect(p.decidedPricing).not.toBeNull();
    // Nobody ruled, so neither world happened: both books void.
    const { approved, declined } = await pairOf(id);
    expect(approved.voided).toBe(true);
    expect(declined.voided).toBe(true);
  });

  test('a proposal whose deadline has not passed is left alone, and the sweep is idempotent', async () => {
    await seed();
    const id = await posted();
    expect(await lapseOverdueProposals(WS)).toBe(0);
    expect((await proposal(id)).status).toBe('pending');
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 60_000) })
      .where(eq(proposals.id, id));
    expect(await lapseOverdueProposals(WS)).toBe(1);
    expect(await lapseOverdueProposals(WS)).toBe(0);
  });

  test('a lapsed proposal refuses trades on either branch', async () => {
    await seed();
    const id = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 60_000) })
      .where(eq(proposals.id, id));
    await lapseOverdueProposals(WS);
    const { approved, declined } = await pairOf(id);
    for (const m of [approved, declined]) {
      const res = await trade(TRADER, m.id, { direction: 'lower', amount: 5 });
      expect(res.status).toBe(400);
      expect(['proposal_closed', 'market_voided', 'market_resolved']).toContain(res.body.code);
    }
  });

  test('a proposal from before deadlines existed never lapses', async () => {
    await seed();
    const id = await posted();
    await db.update(proposals).set({ decideBy: null }).where(eq(proposals.id, id));
    expect(await lapseOverdueProposals(WS)).toBe(0);
    expect((await proposal(id)).status).toBe('pending');
  });
});

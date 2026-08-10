/**
 * The listing stake is atomic with the proposal: a submission whose stake
 * cannot be paid leaves NOTHING behind.
 *
 * Regression (caught by the viktor-cihal session on the fleet instance,
 * 2026-08-10): the proposal row was inserted before the strict market
 * spawn, so an under-funded proposer got a 400 while the proposal
 * persisted with subsidyContributions recording the intent. The hourly
 * reconcile later respawned its markets non-strict, which skips a broke
 * contributor, shipping zero-liquidity markets under a record that still
 * displayed the stake. On a public jobs board that is a proposal wearing
 * a stake it never paid.
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

import request from 'supertest';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits, fromUnits } from '../lib/validation';
import { proposalsRouter } from '../routes/proposals';
import { AppError } from '../lib/errors';

const app = express();
app.use(express.json());
app.use('/api/proposals', proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-stake-atomic';
const OWNER = 'agent-stake-owner';
const RICH = 'agent-stake-rich';
const BROKE = 'agent-stake-broke';

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-sa-owner', balance: toUnits(1000), platformAdmin: true },
    { id: RICH, apiKeyHash: 'h-sa-rich', balance: toUnits(1000) },
    // Enough for nothing: the stake below needs 40 (20 x 2 branch markets).
    { id: BROKE, apiKeyHash: 'h-sa-broke', balance: toUnits(5) },
  ]);
  await db.insert(workspaces).values({
    id: WS, name: 'Stake Atomicity', createdBy: OWNER, visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-sa', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100,
  });
  // One baseline market -> a proposal spawns one approved+declined pair.
  await db.insert(markets).values({
    id: 'mkt-base-sa', workspaceId: WS, metricId: 'metric-sa', metricName: 'Revenue',
    targetDate: '2026-12', rangeMin: 0, rangeMax: 100,
    shares: [0, 0], liquidity: 10, pool: initialPool(10),
    active: true, resolved: false, voided: false, proposalId: null, branch: null,
  });
}

function submit(agentId: string, body: Record<string, unknown>) {
  return request(app).post('/api/proposals')
    .set('x-workspace-id', WS)
    .set('x-test-agent-id', agentId)
    .send(body);
}

describe('listing-stake atomicity', () => {
  test('a funded stake creates the proposal, debits the stake, and seeds both branches', async () => {
    await seed();
    const res = await submit(RICH, { title: '$80: funded job', liquiditySubsidy: 20, askUsd: 80 });
    expect(res.status).toBe(201);
    expect(res.body.conditionalMarketIds).toHaveLength(2);

    const [agent] = await db.select().from(agents).where(eq(agents.id, RICH));
    expect(fromUnits(agent.balance as number)).toBeCloseTo(960, 3);

    const branchRows = await db.select().from(markets).where(eq(markets.proposalId, res.body.id));
    expect(branchRows).toHaveLength(2);
    for (const m of branchRows) expect(m.liquidity).toBeGreaterThan(0);
  });

  test('an unpayable stake returns 400 and leaves NO proposal row behind', async () => {
    await seed();
    const res = await submit(BROKE, { title: '$80: broke job', liquiditySubsidy: 20, askUsd: 80 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Insufficient balance/);

    // The whole point: nothing persists that a later reconcile could
    // materialize into zero-liquidity markets wearing an unpaid stake.
    const rows = await db.select().from(proposals).where(eq(proposals.workspaceId, WS));
    expect(rows).toHaveLength(0);
    const branchRows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
    expect(branchRows).toHaveLength(1); // only the baseline

    // And the broke proposer was not debited.
    const [agent] = await db.select().from(agents).where(eq(agents.id, BROKE));
    expect(fromUnits(agent.balance as number)).toBeCloseTo(5, 3);
  });

  test('a zero-subsidy proposal still creates fine (markets at zero liquidity by design)', async () => {
    await seed();
    const res = await submit(BROKE, { title: 'free proposal', askUsd: 10 });
    expect(res.status).toBe(201);
    const rows = await db.select().from(proposals).where(eq(proposals.workspaceId, WS));
    expect(rows).toHaveLength(1);
  });
});

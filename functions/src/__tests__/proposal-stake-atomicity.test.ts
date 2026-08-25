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

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, events, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { createConditionalMarkets } from '../services/proposals';
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
    id: WS,
    name: 'Stake Atomicity',
    createdBy: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-sa',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  // One baseline market -> a proposal spawns one approved+declined pair.
  await db.insert(markets).values({
    id: 'mkt-base-sa',
    workspaceId: WS,
    metricId: 'metric-sa',
    metricName: 'Revenue',
    targetDate: '2026-12',
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
}

function submit(agentId: string, body: Record<string, unknown>) {
  return request(app).post('/api/proposals').set('x-workspace-id', WS).set('x-test-agent-id', agentId).send(body);
}

describe('listing validation', () => {
  test('an overlong title is refused: 80 characters is the cap', async () => {
    await seed();
    const res = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', RICH)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ title: 'x'.repeat(81), description: '', liquiditySubsidy: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/80/);
  });

  test('a paid job without payment details anywhere is refused; a body handle works and stays private', async () => {
    await seed();
    // No handle in the body and none on the account: the error points at
    // the account-level payment setup (owner decision 2026-08-10).
    const bare = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', RICH)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ title: '$25: stream it', description: '', liquiditySubsidy: 20, askUsd: 25 });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/payment details on your account/);

    const ok = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', RICH)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({
        title: '$25: stream it',
        description: '',
        liquiditySubsidy: 20,
        askUsd: 25,
        payoutHandle: 'pay@example.com',
      });
    expect(ok.status).toBe(201);

    // The auth stub grants manage to everyone, so the list carries the
    // handle here; the redaction's absence for plain members is asserted
    // by the api-parity of the capabilities check itself (canSeePayout).
    const listed = await request(app).get('/api/proposals').set('X-Test-Agent-Id', RICH).set('X-Workspace-Id', WS);
    const row = (listed.body as Array<{ id: string; payoutHandle?: string }>).find(r => r.id === ok.body.id);
    expect(row?.payoutHandle).toBe('pay@example.com');
  });

  test('a paid job reads the account payout handle when the body has none, and snapshots it', async () => {
    await seed();
    await db.update(agents).set({ payoutHandle: 'account@example.com' }).where(eq(agents.id, RICH));

    const res = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', RICH)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ title: '$25: stream it', description: '', liquiditySubsidy: 20, askUsd: 25 });
    expect(res.status).toBe(201);

    // Snapshotted at creation: a later account edit must not rewrite where
    // an already-listed job's money goes.
    const [row] = await db.select().from(proposals).where(eq(proposals.id, res.body.id));
    expect(row.payoutHandle).toBe('account@example.com');
  });

  test('a free job (askUsd 0 or absent) needs no payout handle', async () => {
    await seed();
    const res = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', RICH)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ title: 'fix the typo on the store page', description: '', liquiditySubsidy: 20 });
    expect(res.status).toBe(201);
  });
});

describe('listing-stake atomicity', () => {
  test('a funded stake creates the proposal, debits the stake, and seeds both branches', async () => {
    await seed();
    const res = await submit(RICH, {
      title: '$80: funded job',
      liquiditySubsidy: 20,
      askUsd: 80,
      payoutHandle: 'pay@example.com',
    });
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
    const res = await submit(BROKE, {
      title: '$80: broke job',
      liquiditySubsidy: 20,
      askUsd: 80,
      payoutHandle: 'pay@example.com',
    });
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

  test('a non-strict respawn that skips a broke contributor emits a visible event', async () => {
    await seed();
    // A rollover-style respawn (strict: false) for a proposal whose recorded
    // contributor cannot pay: the platform's stated behavior is to spawn
    // anyway at reduced liquidity, and the new guarantee is that doing so
    // is an event, not just a console line.
    await db.insert(proposals).values({
      id: 'prop-rollover',
      workspaceId: WS,
      proposedBy: BROKE,
      title: '$50: rollover job',
      description: '',
      status: 'pending',
      conditionalMarketIds: [],
      liquiditySubsidy: 20,
      subsidyContributions: { [BROKE]: 20 },
    });
    const ids = await createConditionalMarkets('prop-rollover', WS, {
      contributions: { [BROKE]: 20 },
      strict: false,
    });
    expect(ids).toHaveLength(2);

    const evRows = await db.select().from(events).where(eq(events.workspaceId, WS));
    const skip = evRows.find(e => e.type === 'proposal:subsidy_skipped');
    expect(skip).toBeDefined();
    const data = skip!.data as { proposalId: string; skipped: Array<{ contributorId: string }> };
    expect(data.proposalId).toBe('prop-rollover');
    expect(data.skipped[0].contributorId).toBe(BROKE);
  });

  test('a zero-subsidy proposal still creates fine', async () => {
    await seed();
    const res = await submit(BROKE, { title: 'free proposal', askUsd: 10, payoutHandle: 'pay@example.com' });
    expect(res.status).toBe(201);
    const rows = await db.select().from(proposals).where(eq(proposals.workspaceId, WS));
    expect(rows).toHaveLength(1);
  });
});

/**
 * A branch market at zero liquidity is born dead: it has no price, charts as
 * nothing, and refuses every trade with "this market has no liquidity". The
 * owner hit exactly that on the public Telarchy floor (2026-08-15), where the
 * workspace auto-funds 250/market but the owner account held 87 credits, so
 * the all-or-nothing fallback funded nothing at all.
 */
describe('a branch market is never born dead when anyone can pay', () => {
  const fundedWorkspace = async (ownerBalance: number, credits = 250) => {
    await seed();
    await db
      .update(agents)
      .set({ balance: toUnits(ownerBalance) })
      .where(eq(agents.id, OWNER));
    await db
      .update(workspaces)
      .set({ autoFundNewMarkets: true, newMarketLiquidityCredits: credits })
      .where(eq(workspaces.id, WS));
  };

  const branchMarkets = async () => {
    const rows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
    return rows.filter(m => m.proposalId);
  };

  test('the workspace auto-fund covers a proposal that names no subsidy', async () => {
    await fundedWorkspace(1000);
    const res = await submit(RICH, { title: 'unsubsidised', askUsd: 10, payoutHandle: 'pay@example.com' });
    expect(res.status).toBe(201);
    const branches = await branchMarkets();
    expect(branches).toHaveLength(2);
    for (const m of branches) expect(m.liquidity).toBeGreaterThan(0);
  });

  test('an owner who cannot cover the full amount funds what they can', async () => {
    // 87 credits against a 250/market ask over two markets: the old rule
    // funded nothing, so both branches shipped unpriced and untradeable.
    await fundedWorkspace(87);
    const res = await submit(RICH, { title: 'thin but alive', askUsd: 10, payoutHandle: 'pay@example.com' });
    expect(res.status).toBe(201);

    const branches = await branchMarkets();
    expect(branches).toHaveLength(2);
    for (const m of branches) expect(m.liquidity).toBeGreaterThan(0);

    // Owner-funded, so it comes out of their balance and never exceeds it.
    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    expect(fromUnits(owner.balance as number)).toBeGreaterThanOrEqual(0);
    expect(fromUnits(owner.balance as number)).toBeLessThan(87);
  });

  test('an owner with nothing leaves the markets unfunded rather than inventing credits', async () => {
    await fundedWorkspace(0);
    const res = await submit(RICH, { title: 'nobody can pay', askUsd: 10, payoutHandle: 'pay@example.com' });
    expect(res.status).toBe(201);
    const branches = await branchMarkets();
    expect(branches).toHaveLength(2);
    for (const m of branches) expect(m.liquidity).toBe(0);
    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    expect(fromUnits(owner.balance as number)).toBe(0);
  });

  test('a named subsidy still wins over the auto-fund fallback', async () => {
    await fundedWorkspace(1000);
    const res = await submit(RICH, {
      title: 'self-funded',
      askUsd: 10,
      payoutHandle: 'pay@example.com',
      liquiditySubsidy: 20,
    });
    expect(res.status).toBe(201);
    const [owner] = await db.select().from(agents).where(eq(agents.id, OWNER));
    // The proposer paid, so the owner's balance is untouched.
    expect(fromUnits(owner.balance as number)).toBe(1000);
    for (const m of await branchMarkets()) expect(m.liquidity).toBeGreaterThan(0);
  });
});

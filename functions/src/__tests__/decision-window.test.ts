/**
 * The decision window: one day by default, a minute if the floor wants one,
 * fixed the moment the proposal is posted, and enforced by the trade path
 * itself rather than by a sweep (docs/guides/proposals.md, "The deadline,
 * and the close"; docs/market-integrity.md I1b, "The deadline never moves").
 * Owner decision 2026-09-09.
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

const sent: Array<{ to: string; subject: string; body: string }> = [];
jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  notifyOwner: async () => {},
  sendEmail: async (to: string, subject: string, body: string) => {
    sent.push({ to, subject, body });
    return true;
  },
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { proposalsRouter } from '../routes/proposals';
import { workspacesRouter } from '../routes/workspaces';
import { lapseOverdueProposals, warnProposalDeadlines } from '../services/proposals';
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
  sent.length = 0;
});

const WS = 'ws-window';
const OWNER = 'agent-w-owner';
const PROPOSER = 'agent-w-proposer';
const TRADER = 'agent-w-trader';
const METRIC = 'metric-w';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function seed(opts: { decisionMinutes?: number } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-w-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-w-proposer', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-w-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Window',
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
  await db.insert(markets).values({
    id: 'mkt-w-far',
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Throughput',
    targetDate: '2099',
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

/** An owner who can actually receive email: the notification path joins
 *  agents to the auth user for the address. */
async function withEmail(agentId: string, email: string) {
  const userId = `user-${agentId}`;
  await db.insert(authUser).values({ id: userId, name: 'Owner', email, emailVerified: true });
  await db.update(agents).set({ authUserId: userId }).where(eq(agents.id, agentId));
}

const post = (body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .post('/api/proposals')
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const patch = (id: string, body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .patch(`/api/proposals/${id}`)
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const settings = (body: Record<string, unknown>) =>
  request(app).put(`/api/workspaces/${WS}/settings`).set('X-Test-Agent-Id', OWNER).set('X-Workspace-Id', WS).send(body);

const trade = (agent: string, marketId: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId, ...body });

const proposal = async (id: string) => (await db.select().from(proposals).where(eq(proposals.id, id)))[0];
async function pairOf(id: string) {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, id)));
  return { approved: rows.find(m => m.branch === 'approved')!, declined: rows.find(m => m.branch === 'declined')! };
}
async function posted(body: Record<string, unknown> = {}) {
  const res = await post({ title: 'do the thing', description: '', liquiditySubsidy: 20, ...body });
  if (res.status !== 201) console.error('POST failed:', res.status, JSON.stringify(res.body));
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('the window is one day by default and can be a minute', () => {
  test('a proposal posted with no window gets one day', async () => {
    await seed();
    const id = await posted();
    const at = new Date((await proposal(id)).decideBy!).getTime();
    expect(at).toBeGreaterThan(Date.now() + DAY - 10_000);
    expect(at).toBeLessThan(Date.now() + DAY + 10_000);
  });

  test("the floor's decisionMinutes sets the default, down to a single minute", async () => {
    await seed({ decisionMinutes: 1 });
    const id = await posted();
    const at = new Date((await proposal(id)).decideBy!).getTime();
    expect(at).toBeGreaterThan(Date.now());
    expect(at).toBeLessThan(Date.now() + 2 * MIN);
  });

  test('the owner sets it in minutes, from 1 to ninety days', async () => {
    await seed();
    expect((await settings({ decisionMinutes: 90 })).status).toBe(200);
    expect((await db.select().from(workspaces).where(eq(workspaces.id, WS)))[0].decisionMinutes).toBe(90);
    expect((await settings({ decisionMinutes: 1 })).status).toBe(200);
    expect((await settings({ decisionMinutes: 129_600 })).status).toBe(200);
    for (const bad of [0, -5, 129_601, 2.5, '10']) {
      expect((await settings({ decisionMinutes: bad })).status).toBe(400);
    }
  });

  test('the proposer may name any instant in the future, and nothing else', async () => {
    await seed();
    const at = new Date(Date.now() + 10 * MIN).toISOString();
    expect(new Date((await proposal(await posted({ decideBy: at }))).decideBy!).toISOString()).toBe(at);
    expect((await post({ title: 'past', decideBy: new Date(Date.now() - MIN).toISOString() })).status).toBe(400);
    expect((await post({ title: 'junk', decideBy: 'soon' })).status).toBe(400);
  });
});

describe('the deadline never moves', () => {
  test('the edit endpoint refuses decideBy outright, later or earlier', async () => {
    await seed();
    const id = await posted();
    const was = (await proposal(id)).decideBy!.toISOString();
    for (const at of [new Date(Date.now() + 30 * DAY), new Date(Date.now() + MIN)]) {
      const res = await patch(id, { decideBy: at.toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/deadline/i);
    }
    expect((await proposal(id)).decideBy!.toISOString()).toBe(was);
  });

  test('a manager cannot move it either', async () => {
    await seed();
    const id = await posted();
    expect((await patch(id, { decideBy: new Date(Date.now() + 30 * DAY).toISOString() }, OWNER)).status).toBe(400);
  });

  test('the words still edit while the deadline stands', async () => {
    await seed();
    const id = await posted();
    const was = (await proposal(id)).decideBy!.toISOString();
    expect((await patch(id, { description: 'more detail' })).status).toBe(200);
    expect((await proposal(id)).description).toBe('more detail');
    expect((await proposal(id)).decideBy!.toISOString()).toBe(was);
  });
});

describe('the deadline enforces itself, without waiting for a sweep', () => {
  test('a trade is refused the instant the deadline has passed, before anything lapses it', async () => {
    await seed();
    const id = await posted();
    const { approved } = await pairOf(id);
    expect((await trade(TRADER, approved.id, { direction: 'higher', amount: 5 })).status).toBe(201);

    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    // No sweep has run: status is still pending and closedAt is null.
    expect((await proposal(id)).status).toBe('pending');
    expect((await proposal(id)).closedAt).toBeNull();

    const buy = await trade(TRADER, approved.id, { direction: 'higher', amount: 5 });
    expect(buy.status).toBe(400);
    expect(buy.body.code).toBe('proposal_closed');
  });

  test('the sweep then makes it durable', async () => {
    await seed();
    const id = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    expect(await lapseOverdueProposals(WS)).toBe(1);
    const p = await proposal(id);
    expect(p.status).toBe('lapsed');
    expect(p.lapsedAt).not.toBeNull();
    expect(p.closedAt).not.toBeNull();
  });

  test('a proposal still inside its window trades normally', async () => {
    await seed();
    const id = await posted();
    const { approved } = await pairOf(id);
    expect((await trade(TRADER, approved.id, { direction: 'higher', amount: 5 })).status).toBe(201);
  });
});

describe('the reminder', () => {
  /** Put the proposal's window in the past so the warning is due. */
  async function ageTo(id: string, opts: { windowMinutes: number; leftMinutes: number }) {
    const now = Date.now();
    await db
      .update(proposals)
      .set({
        createdAt: new Date(now - (opts.windowMinutes - opts.leftMinutes) * MIN),
        decideBy: new Date(now + opts.leftMinutes * MIN),
      })
      .where(eq(proposals.id, id));
  }

  test('a one-day proposal warns twelve hours out, not before', async () => {
    await seed();
    await withEmail(OWNER, 'owner@example.com');
    const id = await posted();
    await ageTo(id, { windowMinutes: 1440, leftMinutes: 13 * 60 });
    expect(await warnProposalDeadlines(WS)).toBe(0);
    expect(sent).toHaveLength(0);

    await ageTo(id, { windowMinutes: 1440, leftMinutes: 11 * 60 });
    expect(await warnProposalDeadlines(WS)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].body).toMatch(/declines itself/i);
    expect((await proposal(id)).deadlineWarnedAt).not.toBeNull();
  });

  test('a two-hour proposal warns an hour out: half the window, capped at twelve hours', async () => {
    await seed({ decisionMinutes: 120 });
    await withEmail(OWNER, 'owner@example.com');
    const id = await posted();
    await ageTo(id, { windowMinutes: 120, leftMinutes: 70 });
    expect(await warnProposalDeadlines(WS)).toBe(0);
    await ageTo(id, { windowMinutes: 120, leftMinutes: 50 });
    expect(await warnProposalDeadlines(WS)).toBe(1);
  });

  test('it is sent once, never again', async () => {
    await seed();
    await withEmail(OWNER, 'owner@example.com');
    const id = await posted();
    await ageTo(id, { windowMinutes: 1440, leftMinutes: 60 });
    expect(await warnProposalDeadlines(WS)).toBe(1);
    expect(await warnProposalDeadlines(WS)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  test('a decided proposal is never warned, and neither is one past its deadline', async () => {
    await seed();
    await withEmail(OWNER, 'owner@example.com');
    const decided = await posted();
    await db.update(proposals).set({ status: 'approved' }).where(eq(proposals.id, decided));
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() + 60 * MIN) })
      .where(eq(proposals.id, decided));
    const gone = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - MIN) })
      .where(eq(proposals.id, gone));
    expect(await warnProposalDeadlines(WS)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test('the mail carries the ask and the market number, so it is enough to decide on', async () => {
    await seed();
    await withEmail(OWNER, 'owner@example.com');
    const id = await posted({ title: '$80: rewrite the store page', askUsd: 80, payoutHandle: 'pay@example.com' });
    await db
      .update(proposals)
      .set({ createdAt: new Date(Date.now() - 13 * 60 * MIN), decideBy: new Date(Date.now() + 11 * 60 * MIN) })
      .where(eq(proposals.id, id));
    expect(await warnProposalDeadlines(WS)).toBe(1);
    expect(sent[0].subject).toMatch(/rewrite the store page/);
    expect(sent[0].body).toMatch(/\$80/);
    expect(sent[0].body).toMatch(/telarchy\.com/);
  });
});

/**
 * Nobody ruled, so neither world happened: both books void and everyone is
 * refunded, and it is not a decline (docs/guides/proposals.md, "The
 * deadline, and the close"; owner decision 2026-09-09).
 */
describe('a lapse is N/A, not a decline', () => {
  test('both branches void and every trader is refunded', async () => {
    await seed();
    const id = await posted();
    const { approved, declined } = await pairOf(id);
    expect((await trade(TRADER, approved.id, { direction: 'higher', amount: 5 })).status).toBe(201);
    expect((await trade(TRADER, declined.id, { direction: 'lower', amount: 5 })).status).toBe(201);
    const spent = (await db.select().from(agents).where(eq(agents.id, TRADER)))[0].balance as number;
    expect(spent).toBeLessThan(toUnits(1000));

    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    await lapseOverdueProposals(WS);

    const after = await pairOf(id);
    expect(after.approved.voided).toBe(true);
    expect(after.declined.voided).toBe(true);
    // Refunded to the cent: nobody wins or loses on a decision nobody made.
    const back = (await db.select().from(agents).where(eq(agents.id, TRADER)))[0].balance as number;
    expect(Math.abs(back - toUnits(1000))).toBeLessThan(toUnits(0.02));
  });

  test('its status is its own, never "declined", and it carries no decline reason', async () => {
    await seed();
    const id = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    await lapseOverdueProposals(WS);
    const p = await proposal(id);
    expect(p.status).toBe('lapsed');
    expect(p.declineReason).toBeNull();
  });

  test('what the market said at the deadline is still recorded', async () => {
    await seed();
    const id = await posted();
    const { approved } = await pairOf(id);
    await trade(TRADER, approved.id, { direction: 'higher', amount: 5 });
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    await lapseOverdueProposals(WS);
    const rec = (await proposal(id)).decidedPricing;
    expect(rec).not.toBeNull();
    expect(rec!.length).toBeGreaterThan(0);
    expect(rec![0].approvedConsensus).not.toBeNull();
  });

  test('a lapsed proposal is still listed on the floor, marked as lapsed', async () => {
    await seed();
    const id = await posted();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 1000) })
      .where(eq(proposals.id, id));
    await lapseOverdueProposals(WS);
    const rows = await db.select().from(proposals).where(eq(proposals.workspaceId, WS));
    expect(rows.find(r => r.id === id)!.status).toBe('lapsed');
  });
});

/**
 * A proposal is decided exactly once (docs/guides/proposals.md, "The
 * deadline, and the close"). Approve, decline, decline as spam, withdraw and
 * the lapse each claim the pending proposal before they void or pay anything;
 * the call that loses is refused with 409 not_pending and moves no money. The
 * lapse waits 10 seconds past the deadline, so a decision sent right at the
 * deadline lands instead of racing the sweep.
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
import { agents, creditLedger, markets, metrics, positions, proposals } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { proposalsRouter } from '../routes/proposals';
import {
  approveProposal,
  declineProposal,
  declineProposalAsSpam,
  lapseOverdueProposals,
  withdrawProposal,
} from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message, code: (err as AppError).code, ...((err as AppError).extra ?? {}) });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-once';
const OWNER = 'agent-once-owner';
const PROPOSER = 'agent-once-proposer';
const TRADER = 'agent-once-trader';
const METRIC = 'metric-once';
const SEC = 1000;

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-once-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-once-proposer', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-once-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Once',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Throughput',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-once-far',
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

const as = (agent: string) => ({ 'x-test-agent-id': agent, 'x-workspace-id': WS });

async function posted(body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/proposals')
    .set(as(PROPOSER))
    .send({ title: 'do the thing', description: '', liquiditySubsidy: 20, ...body });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const trade = (marketId: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set(as(TRADER))
    .send({ marketId, ...body });

async function statusOf(id: string) {
  return (await db.select().from(proposals).where(eq(proposals.id, id)))[0].status;
}

async function booksOf(id: string) {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, id)));
}

/** A proposal whose deadline passed `ago` milliseconds ago, with the trader
 *  holding a position on each branch so a wrong void shows up as money. */
async function overdue(ago = 60 * SEC, body: Record<string, unknown> = {}) {
  const id = await posted(body);
  for (const m of await booksOf(id)) {
    expect((await trade(m.id, { direction: 'higher', amount: 5 })).status).toBe(201);
  }
  await db
    .update(proposals)
    .set({ decideBy: new Date(Date.now() - ago) })
    .where(eq(proposals.id, id));
  return id;
}

/** Everything a decision can move: balances, books, positions, ledger rows. */
async function money() {
  const bal = await db.select({ id: agents.id, balance: agents.balance }).from(agents);
  const books = await db
    .select({ id: markets.id, voided: markets.voided, resolved: markets.resolved, liquidity: markets.liquidity })
    .from(markets);
  const pos = await db.select({ id: positions.id, shares: positions.shares }).from(positions);
  const ledger = await db.select({ id: creditLedger.id }).from(creditLedger);
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { bal: byId(bal), books: byId(books), pos: byId(pos), ledger: ledger.length };
}

async function settle<T>(p: Promise<T>) {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as AppError };
  }
}

describe('a proposal is decided exactly once', () => {
  test('approve racing the lapse: exactly one wins, and the books match the winner', async () => {
    await seed();
    const id = await overdue();
    const [approve, lapsed] = await Promise.all([settle(approveProposal(id, WS, OWNER)), lapseOverdueProposals(WS)]);
    const approveWon = approve.ok;
    expect(Number(approveWon) + lapsed).toBe(1);
    const books = await booksOf(id);
    const approvedBook = books.find(m => m.branch === 'approved')!;
    const declinedBook = books.find(m => m.branch === 'declined')!;
    if (approveWon) {
      expect(await statusOf(id)).toBe('approved');
      // The world that happened is still open to settle; the lapse voided nothing.
      expect(approvedBook.voided).toBe(false);
      expect(declinedBook.voided).toBe(true);
    } else {
      expect(await statusOf(id)).toBe('lapsed');
      expect(approve.error.status).toBe(409);
      expect(approve.error.code).toBe('not_pending');
      expect(approvedBook.voided).toBe(true);
      expect(declinedBook.voided).toBe(true);
    }
  });

  test('decline racing the lapse: exactly one wins, and the books match the winner', async () => {
    await seed();
    const id = await overdue();
    const [decline, lapsed] = await Promise.all([
      settle(declineProposal(id, WS, OWNER, 'no')),
      lapseOverdueProposals(WS),
    ]);
    expect(Number(decline.ok) + lapsed).toBe(1);
    const books = await booksOf(id);
    const declinedBook = books.find(m => m.branch === 'declined')!;
    if (decline.ok) {
      expect(await statusOf(id)).toBe('declined');
      expect(declinedBook.voided).toBe(false);
    } else {
      expect(await statusOf(id)).toBe('lapsed');
      expect(decline.error.code).toBe('not_pending');
      expect(declinedBook.voided).toBe(true);
    }
  });

  test('approve racing decline: exactly one wins, the other is refused with 409 not_pending', async () => {
    await seed();
    const id = await posted();
    const [approve, decline] = await Promise.all([
      settle(approveProposal(id, WS, OWNER)),
      settle(declineProposal(id, WS, OWNER, 'no')),
    ]);
    expect(Number(approve.ok) + Number(decline.ok)).toBe(1);
    const loser = approve.ok ? decline : approve;
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.error.status).toBe(409);
      expect(loser.error.code).toBe('not_pending');
    }
    // One branch voided, one open: never both voided, never both kept.
    const books = await booksOf(id);
    expect(books.filter(m => m.voided)).toHaveLength(1);
    expect(await statusOf(id)).toBe(approve.ok ? 'approved' : 'declined');
  });

  test('two approves naming different options: exactly one option is chosen', async () => {
    await seed();
    const id = await posted({
      options: [
        { id: 'left', label: 'Turn left' },
        { id: 'right', label: 'Turn right' },
      ],
    });
    const [left, right] = await Promise.all([
      settle(approveProposal(id, WS, OWNER, 'left')),
      settle(approveProposal(id, WS, OWNER, 'right')),
    ]);
    expect(Number(left.ok) + Number(right.ok)).toBe(1);
    const winner = left.ok ? 'left' : 'right';
    const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
    expect(p.decidedOption).toBe(winner);
    const books = await booksOf(id);
    // The chosen option's book stays open; every other option is voided.
    expect(books.filter(m => !m.voided).map(m => m.branch)).toEqual([winner]);
  });

  test('withdraw racing the lapse: exactly one wins', async () => {
    await seed();
    const id = await overdue();
    const [withdraw, lapsed] = await Promise.all([
      settle(withdrawProposal(id, WS, PROPOSER)),
      lapseOverdueProposals(WS),
    ]);
    expect(Number(withdraw.ok) + lapsed).toBe(1);
    expect(await statusOf(id)).toBe(withdraw.ok ? 'withdrawn' : 'lapsed');
  });

  test('the call that loses changes no balances, books, positions or ledger rows', async () => {
    await seed();
    const id = await overdue();
    await approveProposal(id, WS, OWNER);
    const before = await money();

    const lapsed = await lapseOverdueProposals(WS);
    const decline = await settle(declineProposal(id, WS, OWNER, 'too late'));
    const again = await settle(approveProposal(id, WS, OWNER));
    const spam = await settle(declineProposalAsSpam(id, WS, OWNER));
    const withdraw = await settle(withdrawProposal(id, WS, PROPOSER));

    expect(lapsed).toBe(0);
    for (const r of [decline, again, spam, withdraw]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.status).toBe(409);
        expect(r.error.code).toBe('not_pending');
        expect(r.error.extra?.status).toBe('approved');
      }
    }
    expect(await money()).toEqual(before);
    expect(await statusOf(id)).toBe('approved');
  });

  test('over HTTP the loser answers 409 with code not_pending and the status it already has', async () => {
    await seed();
    const id = await posted();
    expect((await request(app).post(`/api/proposals/${id}/decline`).set(as(OWNER)).send({})).status).toBe(200);
    const res = await request(app).post(`/api/proposals/${id}/approve`).set(as(OWNER)).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_pending');
    expect(res.body.status).toBe('declined');
  });
});

describe('the lapse waits 10 seconds past the deadline', () => {
  test('a proposal 5 seconds past its deadline is not lapsed, and can still be approved', async () => {
    await seed();
    const id = await overdue(5 * SEC);
    expect(await lapseOverdueProposals(WS)).toBe(0);
    expect(await statusOf(id)).toBe('pending');
    await approveProposal(id, WS, OWNER);
    expect(await statusOf(id)).toBe('approved');
  });

  test('a proposal 11 seconds past its deadline is lapsed', async () => {
    await seed();
    const id = await overdue(11 * SEC);
    expect(await lapseOverdueProposals(WS)).toBe(1);
    expect(await statusOf(id)).toBe('lapsed');
  });
});

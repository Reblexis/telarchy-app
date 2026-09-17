/**
 * THE RULE (docs/guides/proposals.md, "Editing, and getting out"): a proposer
 * may add liquidity to THEIR OWN pending proposal, out of THEIR OWN balance,
 * and to nothing else. Everything else the bulk route does stays behind
 * `manage`.
 *
 * `liquidity: [{ metricId, targetDate, amount }]` adds `amount` to EACH open
 * branch book of that metric and date, the same list posting takes, and it
 * is paid the same way: liquidity credits first, trading credits second.
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
        capabilities: new Set(String(req.headers['x-test-caps'] ?? 'read,trade').split(',')),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, liquidityEvents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { createConditionalMarkets } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-topup';
const OWNER = 'agent-topup-owner';
const PROPOSER = 'agent-topup-proposer';
const STRANGER = 'agent-topup-stranger';
const NEWCOMER = 'agent-topup-newcomer';
const P = 'prop-topup';
const P2 = 'prop-topup-newcomer';
const M = 'metric-tu';
const NOV = '2030-11';
const DEC = '2030-12';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-tu-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-tu-proposer', balance: toUnits(1000) },
    { id: STRANGER, apiKeyHash: 'h-tu-stranger', balance: toUnits(1000) },
    { id: NEWCOMER, apiKeyHash: 'h-tu-newcomer', balance: toUnits(50), liquidityBalance: toUnits(300) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Top up', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-tu',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  for (const [id, targetDate] of [
    ['mkt-tu-nov', '2030-11'],
    ['mkt-tu-dec', '2030-12'],
  ])
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: 'metric-tu',
      metricName: 'Revenue',
      targetDate,
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
  await db.insert(proposals).values({
    id: P,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: 'A job',
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
  await createConditionalMarkets(P, WS, {});
  await db.insert(proposals).values({
    id: P2,
    workspaceId: WS,
    proposedBy: NEWCOMER,
    title: 'Another job',
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
  await createConditionalMarkets(P2, WS, {});
});

const bulk = (agent: string, body: Record<string, unknown>, caps = 'read,trade') =>
  request(app)
    .post('/api/predictions/markets/liquidity/bulk')
    .set('x-test-agent-id', agent)
    .set('x-workspace-id', WS)
    .set('x-test-caps', caps)
    .send(body);
const balanceOf = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};
const branches = (proposalId = P) =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));
const purses = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return { balance: fromUnits(a.balance as number), wallet: fromUnits(a.liquidityBalance as number) };
};

describe('a proposer may add liquidity to their own pending proposal, and to nothing else', () => {
  test('200 on December adds 200 to both December branches, nothing to November, and charges 400', async () => {
    const res = await bulk(PROPOSER, { proposalId: P, liquidity: [{ metricId: M, targetDate: DEC, amount: 200 }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ markets: 2, totalCost: 400 });
    const rows = await branches();
    for (const m of rows.filter(r => r.targetDate === DEC)) expect(m.pool).toBeCloseTo(200, 6);
    for (const m of rows.filter(r => r.targetDate === NOV)) expect(m.pool).toBe(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(600, 6);
  });

  test('the top-up is recorded per book on the proposal, and a second one adds to it', async () => {
    await bulk(PROPOSER, { proposalId: P, liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] });
    await bulk(PROPOSER, {
      proposalId: P,
      liquidity: [
        { metricId: M, targetDate: DEC, amount: 50 },
        { metricId: M, targetDate: NOV, amount: 10 },
      ],
    });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, P));
    const cells = [...(row.subsidyCells[PROPOSER] ?? [])].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    expect(cells).toEqual([
      { metricId: M, targetDate: NOV, amount: 10 },
      { metricId: M, targetDate: DEC, amount: 150 },
    ]);
  });

  test('the one-number form still works for a proposer on their own proposal', async () => {
    const res = await bulk(PROPOSER, { amount: 50, proposalId: P });
    expect(res.status).toBe(200);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(800, 6);
  });

  test("a trader who did not post it cannot bulk-fund someone else's proposal", async () => {
    const res = await bulk(STRANGER, { proposalId: P, liquidity: [{ metricId: M, targetDate: DEC, amount: 200 }] });
    expect(res.status).toBe(403);
    expect(await balanceOf(STRANGER)).toBeCloseTo(1000, 6);
    for (const m of await branches()) expect(m.pool).toBe(0);
  });

  test("without manage, the floor's own books stay out of reach", async () => {
    const res = await bulk(PROPOSER, { amount: 10 });
    expect(res.status).toBe(403);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test("a proposer can never spend another agent's credits", async () => {
    const res = await bulk(PROPOSER, { amount: 10, proposalId: P, agentId: STRANGER });
    expect(res.status).toBe(403);
    expect(await balanceOf(STRANGER)).toBeCloseTo(1000, 6);
  });

  test('a decided proposal is closed to its proposer', async () => {
    await db.update(proposals).set({ status: 'declined' }).where(eq(proposals.id, P));
    const res = await bulk(PROPOSER, { amount: 10, proposalId: P });
    expect(res.status).toBe(403);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('a manager keeps every door: another proposal, by amount', async () => {
    const res = await bulk(OWNER, { amount: 25, proposalId: P }, 'read,trade,manage');
    expect(res.status).toBe(200);
    expect(await balanceOf(OWNER)).toBeCloseTo(900, 6);
  });
});

describe('LIQUIDITY CREDITS ARE SPENT FIRST, TRADING CREDITS SECOND', () => {
  test('a top-up the wallet covers never touches the trading balance', async () => {
    const res = await bulk(NEWCOMER, { proposalId: P2, liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] });
    expect(res.status).toBe(200);
    expect(await purses(NEWCOMER)).toEqual({ balance: 50, wallet: 100 });
  });

  test('what the wallet cannot cover comes off the balance, and no further', async () => {
    // 160 a side is 320: the wallet's 300, then 20 of the 50.
    const res = await bulk(NEWCOMER, { proposalId: P2, liquidity: [{ metricId: M, targetDate: DEC, amount: 160 }] });
    expect(res.status).toBe(200);
    const after = await purses(NEWCOMER);
    expect(after.wallet).toBeCloseTo(0, 6);
    expect(after.balance).toBeCloseTo(30, 6);
  });

  test('each purse leaves its own row, so a leftover returns where it came from', async () => {
    await bulk(NEWCOMER, { proposalId: P2, liquidity: [{ metricId: M, targetDate: DEC, amount: 160 }] });
    const rows = await db.select().from(liquidityEvents).where(eq(liquidityEvents.agentId, NEWCOMER));
    const from = (purse: string) =>
      rows.filter(r => r.fundedFrom === purse).reduce((s, r) => s + (r.poolContribution ?? 0), 0);
    expect(from('liquidity')).toBeCloseTo(300, 4);
    expect(from('balance')).toBeCloseTo(20, 4);
  });

  test('the one-number form spends the wallet first too', async () => {
    // 50 into each of the four books is 200, all of it from the wallet.
    const res = await bulk(NEWCOMER, { amount: 50, proposalId: P2 });
    expect(res.status).toBe(200);
    expect(await purses(NEWCOMER)).toEqual({ balance: 50, wallet: 100 });
  });

  test('more than both purses hold is a 400 and moves nothing', async () => {
    const res = await bulk(NEWCOMER, { proposalId: P2, liquidity: [{ metricId: M, targetDate: DEC, amount: 176 }] });
    expect(res.status).toBe(400);
    expect(await purses(NEWCOMER)).toEqual({ balance: 50, wallet: 300 });
    for (const m of await branches(P2)) expect(m.pool).toBe(0);
  });

  test('two top-ups at once never spend the same credits twice', async () => {
    const body = { proposalId: P2, liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] };
    const [a, b] = await Promise.all([bulk(NEWCOMER, body), bulk(NEWCOMER, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const after = await purses(NEWCOMER);
    expect(after.wallet + after.balance).toBeCloseTo(150, 6);
    expect(after.balance).toBeGreaterThanOrEqual(0);
  });
});

describe('a list that cannot be honoured moves nothing', () => {
  test.each([
    ['a book this proposal has no open market on', [{ metricId: M, targetDate: '2031-01', amount: 10 }]],
    [
      'the same book twice',
      [
        { metricId: M, targetDate: DEC, amount: 10 },
        { metricId: M, targetDate: DEC, amount: 5 },
      ],
    ],
    ['a negative amount', [{ metricId: M, targetDate: DEC, amount: -1 }]],
    ['nothing but zeros', [{ metricId: M, targetDate: DEC, amount: 0 }]],
    ['not a list', 'all'],
  ])('%s is a 400', async (_name, liquidity) => {
    const res = await bulk(PROPOSER, { proposalId: P, liquidity });
    expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });

  test('liquidity together with amount is a 400', async () => {
    const res = await bulk(PROPOSER, {
      proposalId: P,
      amount: 5,
      liquidity: [{ metricId: M, targetDate: DEC, amount: 10 }],
    });
    expect(res.status).toBe(400);
  });

  test('liquidity without a proposal is a 400: per book is how a proposal is funded', async () => {
    const res = await bulk(OWNER, { liquidity: [{ metricId: M, targetDate: DEC, amount: 10 }] }, 'read,trade,manage');
    expect(res.status).toBe(400);
    expect(await balanceOf(OWNER)).toBeCloseTo(1000, 6);
  });

  test('the retired budget is refused rather than silently ignored', async () => {
    const res = await bulk(PROPOSER, { proposalId: P, budget: 400 });
    expect(res.status).toBe(400);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });
});

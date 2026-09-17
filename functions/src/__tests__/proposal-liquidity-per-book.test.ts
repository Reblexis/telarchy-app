/**
 * THE RULE (docs/guides/get-paid.md, "Posting one"): a proposer chooses their
 * liquidity PER BOOK. `liquidity: [{ metricId, targetDate, amount }]` puts
 * `amount` credits into EACH branch book of that metric and date, and nothing
 * anywhere else. They are charged exactly the sum, liquidity credits first
 * and trading credits second, and a list that cannot be honoured leaves
 * nothing behind.
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
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
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

const WS = 'ws-perbook';
const OWNER = 'agent-budget-owner';
const PROPOSER = 'agent-budget-proposer';
const NEWCOMER = 'agent-budget-newcomer';

async function baseline(id: string, targetDate: string) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: 'metric-budget',
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
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-b-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-b-proposer', balance: toUnits(1000) },
    // Pool money in the wallet, a little to trade with: the ordinary newcomer.
    { id: NEWCOMER, apiKeyHash: 'h-b-newcomer', balance: toUnits(50), liquidityBalance: toUnits(300) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Budget', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-budget',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await baseline('mkt-b-nov', '2030-11');
  await baseline('mkt-b-dec', '2030-12');
});

const post = (body: Record<string, unknown>, agent = PROPOSER) =>
  request(app)
    .post('/api/proposals')
    .set('x-test-agent-id', agent)
    .set('x-workspace-id', WS)
    .send({ title: 'A job', ...body });

const balanceOf = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};
const branchesOf = (proposalId: string) =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));

const M = 'metric-budget';
const NOV = '2030-11';
const DEC = '2030-12';
const purses = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return { balance: fromUnits(a.balance as number), wallet: fromUnits(a.liquidityBalance as number) };
};
const poolsByDate = async (proposalId: string) => {
  const rows = await branchesOf(proposalId);
  return Object.fromEntries([NOV, DEC].map(d => [d, rows.filter(r => r.targetDate === d).map(r => r.pool)]));
};

describe('a proposer chooses their liquidity per book', () => {
  test('500 on December alone: both December branches open with 500, November with nothing, and 1,000 is charged', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 500 }] });
    expect(res.status).toBe(201);
    const pools = await poolsByDate(res.body.id);
    for (const p of pools[DEC]) expect(p).toBeCloseTo(500, 6);
    for (const p of pools[NOV]) expect(p).toBe(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(0, 6);
    expect(res.body.liquidity).toEqual([{ metricId: M, targetDate: DEC, amount: 500 }]);
  });

  test('different numbers on different dates are different bills', async () => {
    const res = await post({
      liquidity: [
        { metricId: M, targetDate: NOV, amount: 100 },
        { metricId: M, targetDate: DEC, amount: 250 },
      ],
    });
    expect(res.status).toBe(201);
    const pools = await poolsByDate(res.body.id);
    for (const p of pools[NOV]) expect(p).toBeCloseTo(100, 6);
    for (const p of pools[DEC]) expect(p).toBeCloseTo(250, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000 - 2 * 100 - 2 * 250, 6);
  });

  test('on a proposal with three options a number goes into each of the three books of that date', async () => {
    const res = await post({
      liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }],
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    });
    expect(res.status).toBe(201);
    const pools = await poolsByDate(res.body.id);
    expect(pools[DEC]).toHaveLength(3);
    for (const p of pools[DEC]) expect(p).toBeCloseTo(100, 6);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(700, 6);
  });

  test("the owner's date number is added to a book the proposer funded, and paid alone on one they did not", async () => {
    await db
      .update(metrics)
      .set({
        timePreference: {
          enabled: false,
          halfLife: 1,
          customHorizons: [NOV, DEC],
          horizonCredits: { [NOV]: { proposal: 40 }, [DEC]: { proposal: 40 } },
        },
      })
      .where(eq(metrics.id, M));
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] });
    const pools = await poolsByDate(res.body.id);
    for (const p of pools[DEC]) expect(p).toBeCloseTo(140, 6);
    for (const p of pools[NOV]) expect(p).toBeCloseTo(40, 6);
  });

  test('the choice is stored per book, so a respawn reseeds the same books and no others', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] });
    const [row] = await db.select().from(proposals).where(eq(proposals.id, res.body.id));
    expect(row.subsidyCells).toEqual({ [PROPOSER]: [{ metricId: M, targetDate: DEC, amount: 100 }] });
    expect(row.subsidyContributions).toEqual({});
  });

  test('an amount of 0, or an empty list, is no seed: free to post', async () => {
    for (const liquidity of [[], [{ metricId: M, targetDate: DEC, amount: 0 }]]) {
      const res = await post({ liquidity });
      expect(res.status).toBe(201);
      for (const m of await branchesOf(res.body.id)) expect(m.pool).toBe(0);
    }
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  });
});

describe('LIQUIDITY CREDITS ARE SPENT FIRST, TRADING CREDITS SECOND', () => {
  test('a bill the wallet covers never touches the trading balance', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 100 }] }, NEWCOMER);
    expect(res.status).toBe(201);
    expect(await purses(NEWCOMER)).toEqual({ balance: 50, wallet: 100 });
  });

  test('what the wallet cannot cover comes off the balance, and no further', async () => {
    // 160 a side is 320: the wallet's 300, then 20 of the 50.
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 160 }] }, NEWCOMER);
    expect(res.status).toBe(201);
    const after = await purses(NEWCOMER);
    expect(after.wallet).toBeCloseTo(0, 6);
    expect(after.balance).toBeCloseTo(30, 6);
  });
});

describe('a list that cannot be honoured leaves nothing behind', () => {
  const nothingHappened = async () => {
    expect(await db.select().from(proposals).where(eq(proposals.workspaceId, WS))).toHaveLength(0);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(1000, 6);
  };

  test('more than both purses hold is a 400', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 501 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
    await nothingHappened();
  });

  test('a book the floor does not have is a 400 that names it', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: '2031-01', amount: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2031-01/);
    await nothingHappened();
  });

  test('a date that settles before the deadline gets no pair, so funding it is a 400', async () => {
    const res = await post({
      decideBy: '2030-12-05T00:00:00.000Z',
      liquidity: [{ metricId: M, targetDate: NOV, amount: 10 }],
    });
    expect(res.status).toBe(400);
    await nothingHappened();
  });

  test('the same book twice is a 400', async () => {
    const res = await post({
      liquidity: [
        { metricId: M, targetDate: DEC, amount: 10 },
        { metricId: M, targetDate: DEC, amount: 20 },
      ],
    });
    expect(res.status).toBe(400);
    await nothingHappened();
  });

  test.each([
    ['not a list', { metricId: M, targetDate: DEC, amount: 10 }],
    ['a negative amount', [{ metricId: M, targetDate: DEC, amount: -1 }]],
    ['a string amount', [{ metricId: M, targetDate: DEC, amount: '10' }]],
    ['a missing metric', [{ targetDate: DEC, amount: 10 }]],
  ])('%s is a 400', async (_name, liquidity) => {
    const res = await post({ liquidity });
    expect(res.status).toBe(400);
    await nothingHappened();
  });

  test('liquidity together with liquiditySubsidy is a 400: one proposal, one way to say the seed', async () => {
    const res = await post({ liquidity: [{ metricId: M, targetDate: DEC, amount: 10 }], liquiditySubsidy: 5 });
    expect(res.status).toBe(400);
    await nothingHappened();
  });

  test('the retired liquidityBudget is refused rather than silently ignored', async () => {
    const res = await post({ liquidityBudget: 400 });
    expect(res.status).toBe(400);
    await nothingHappened();
  });

  test('two posts at once never spend the same credits twice', async () => {
    const body = { liquidity: [{ metricId: M, targetDate: DEC, amount: 400 }] };
    const [a, b] = await Promise.all([post(body), post(body)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(200, 6);
  });
});

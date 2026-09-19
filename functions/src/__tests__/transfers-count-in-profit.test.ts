/**
 * THE RULE: credits transferred between participants count in profit, all
 * time as in the season (owner, 2026-09-19: "when credits aare sent via
 * transfer credits api or the send credits button it should count into
 * profit/ negative profit"; docs/seasons.md, "The ALL-TIME board").
 * Received is profit, sent is loss, settled money, read from the
 * peer-transfer receipt. The board scoped to one floor leaves them out,
 * because a transfer belongs to no floor.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));
jest.mock('../middleware/consent', () => ({
  requireConsentIfUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import {
  agentBalanceSnapshots,
  agents,
  authUser,
  creditLedger,
  creditTransfers,
  markets,
  metrics,
  positions,
  trades,
  workspaces,
} from '../db/schema';
import { loadBoard } from '../lib/board';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-xp-a';
const WS2 = 'ws-xp-b';
const U = 'user-xp';
const OWNER = 'agent-owner-xp';
const BOT = 'agent-bot-xp';
const SUBBOT = 'agent-subbot-xp';
const OTHER = 'agent-other-xp';

const MID = new Date('2026-06-15T12:00:00Z');

let caller: { uid?: string; agentId?: string; isMasterKey?: boolean } | undefined = { isMasterKey: true };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth?: typeof caller }).auth = caller;
  next();
});
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  caller = { isMasterKey: true };
  await db.insert(authUser).values({ id: U, name: 'Owner', email: 'owner@example.com' });
  const pay = (id: string) => ({ provider: 'paypal', email: `${id}@example.com` });
  await db.insert(agents).values([
    {
      id: OWNER,
      apiKeyHash: 'h-owner',
      balance: toUnits(1000),
      nickname: 'owner',
      authUserId: U,
      payoutMethod: pay(OWNER),
    },
    { id: BOT, apiKeyHash: 'h-bot', balance: toUnits(1000), nickname: 'bot', ownerUserId: U, payoutMethod: pay(BOT) },
    { id: SUBBOT, apiKeyHash: 'h-subbot', balance: toUnits(1000), nickname: 'subbot', ownerAgentId: BOT },
    { id: OTHER, apiKeyHash: 'h-other', balance: toUnits(1000), nickname: 'other', payoutMethod: pay(OTHER) },
  ]);
  await db.insert(workspaces).values([
    { id: WS, name: 'Floor A', slug: 'floor-a', createdBy: OTHER, visibility: 'public' },
    { id: WS2, name: 'Floor B', slug: 'floor-b', createdBy: OTHER, visibility: 'public' },
  ]);
  await db.insert(metrics).values([
    { id: 'metric-a', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100 },
    { id: 'metric-b', workspaceId: WS2, name: 'Users', value: 50, formula: '0', marketRangeMax: 100 },
  ]);
});

let seq = 0;
let marketSeq = 0;
async function transfer(from: string, to: string, credits: number, at: Date = MID) {
  seq += 1;
  await db
    .insert(creditTransfers)
    .values({ id: `xfer-${seq}`, fromAgentId: from, toAgentId: to, credits, memo: '', createdAt: at });
  clearBoardCache();
}

/** `loser` pays `amount` for shares that pay nothing; `winner` holds shares
 *  that pay `amount`; the market resolved at MID on `ws`. */
async function loserPaysWinner(ws: string, loser: string, winner: string, amount: number, tag: string) {
  const marketId = `mkt-${tag}`;
  await db.insert(markets).values({
    id: marketId,
    workspaceId: ws,
    metricId: ws === WS ? 'metric-a' : 'metric-b',
    metricName: 'M',
    // A real date: the profile parses it. One day per market keeps them distinct.
    targetDate: `2026-06-${String(10 + (marketSeq++ % 18)).padStart(2, '0')}`,
    rangeMin: 0,
    rangeMax: 100,
    shares: [amount, amount],
    liquidity: 200,
    pool: 0,
    active: false,
    resolved: true,
    actualValue: 100,
    resolvedAt: MID,
    voided: false,
    proposalId: null,
    tradedVolume: 1,
  });
  const at = new Date(MID.getTime() - 3600_000);
  await db.insert(trades).values([
    {
      id: `trade-${tag}-w`,
      workspaceId: ws,
      agentId: winner,
      marketId,
      direction: 'higher',
      shares: amount,
      cost: 0,
      createdAt: at,
    },
    {
      id: `trade-${tag}-l`,
      workspaceId: ws,
      agentId: loser,
      marketId,
      direction: 'lower',
      shares: amount,
      cost: amount,
      createdAt: at,
    },
  ]);
  // The board values holdings off the positions table; the season off the
  // trade ledger. Both must see the same holding.
  await db.insert(positions).values([
    {
      id: `pos-${tag}-w`,
      agentId: winner,
      workspaceId: ws,
      marketId,
      direction: 'higher',
      shares: amount,
      totalCost: 0,
    },
    {
      id: `pos-${tag}-l`,
      agentId: loser,
      workspaceId: ws,
      marketId,
      direction: 'lower',
      shares: amount,
      totalCost: amount,
    },
  ]);
  clearBoardCache();
}

const rows = async (url: string) => {
  const res = await request(app).get(url);
  expect(res.status).toBe(200);
  return new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id as string, p]));
};

describe('credits transferred between participants count in profit', () => {
  test('received is profit and sent is loss, on top of the trading', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    await loserPaysWinner(WS, OWNER, OTHER, 25, 'owner-loses');
    const board = await loadBoard([WS, WS2]);
    expect(board.profitById.get(BOT)).toBe(15500);
    expect(board.profitById.get(OWNER)).toBe(-15025);
    expect(board.profitById.get(OTHER)).toBe(-475);
  });

  test('a transfer is settled money, never part of the open mark', async () => {
    await transfer(OWNER, BOT, 300);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const board = await loadBoard([WS, WS2]);
    expect(board.breakdownById.get(BOT)).toEqual({ settled: 800, open: 0, total: 800 });
  });

  test('transfers both ways net: what came back reduces the loss', async () => {
    await transfer(OWNER, BOT, 1000);
    await transfer(BOT, OWNER, 400);
    await transfer(BOT, OWNER, 0.5);
    const board = await loadBoard([WS, WS2]);
    expect(board.profitById.get(OWNER)).toBe(-599.5);
    expect(board.profitById.get(BOT)).toBe(599.5);
  });

  test('transfers move profit between accounts and create none', async () => {
    await transfer(OWNER, BOT, 1000);
    await transfer(BOT, SUBBOT, 250);
    await transfer(OTHER, OWNER, 70);
    const board = await loadBoard([WS, WS2]);
    const sum = [...board.profitById.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  test('an account that only ever sent or received a transfer is on the board', async () => {
    await transfer(OWNER, BOT, 1000);
    const board = await loadBoard([WS, WS2]);
    expect(board.agentIds).toEqual(expect.arrayContaining([OWNER, BOT]));
    expect(board.agentIds).not.toContain(OTHER);
    const byId = await rows('/api/leaderboard');
    expect(byId.get(OWNER)).toMatchObject({
      totalEarnings: -1000,
      settledEarnings: -1000,
      openEarnings: 0,
      totalTrades: 0,
    });
    expect(byId.get(BOT)).toMatchObject({ totalEarnings: 1000, totalTrades: 0, lastTradeAt: null });
  });

  test('nobody transferred, nobody moved: the board is the trading', async () => {
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const board = await loadBoard([WS, WS2]);
    expect(board.profitById.get(BOT)).toBe(500);
    expect(board.agentIds).not.toContain(OWNER);
  });

  test('a deposit or a grant written with the transfer ledger reason is not a transfer and never counts', async () => {
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    await db.insert(creditLedger).values([
      {
        id: 'led-deposit',
        workspaceId: WS,
        agentId: BOT,
        deltaUnits: toUnits(9000),
        balanceAfterUnits: toUnits(10000),
        reason: 'transfer_in',
        createdAt: MID,
      },
      {
        id: 'led-grant',
        workspaceId: WS,
        agentId: OWNER,
        deltaUnits: toUnits(9000),
        balanceAfterUnits: toUnits(10000),
        reason: 'grant',
        createdAt: MID,
      },
    ]);
    clearBoardCache();
    const board = await loadBoard([WS, WS2]);
    expect(board.profitById.get(BOT)).toBe(500);
    expect(board.agentIds).not.toContain(OWNER);
  });

  test('a transfer counts whenever it was made: there is no window', async () => {
    await transfer(OWNER, BOT, 100, new Date('2025-01-01T00:00:00Z'));
    await transfer(OWNER, BOT, 10, new Date());
    const board = await loadBoard([WS, WS2]);
    expect(board.profitById.get(BOT)).toBe(110);
  });
});

describe('the board scoped to one floor leaves transfers out', () => {
  test('loadBoard floorOnly is that trading alone, and a transfer-only account is absent', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const board = await loadBoard([WS], { floorOnly: true });
    expect(board.profitById.get(BOT)).toBe(500);
    expect(board.agentIds).not.toContain(OWNER);
  });

  test('GET /api/leaderboard counts them; scoped to a floor it does not', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const full = await rows('/api/leaderboard');
    expect(full.get(BOT)).toMatchObject({ totalEarnings: 15500, settledEarnings: 15500 });
    expect(full.get(OWNER)).toMatchObject({ totalEarnings: -15000 });
    const scoped = await rows('/api/leaderboard?workspaceId=floor-a');
    expect(scoped.get(BOT)).toMatchObject({ totalEarnings: 500 });
    expect(scoped.get(OWNER)).toBeUndefined();
  });

  test('with one public floor the scoped and the full board are still two answers, in either order', async () => {
    await db.update(workspaces).set({ visibility: 'private' }).where(eq(workspaces.id, WS2));
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    expect((await rows('/api/leaderboard?workspaceId=floor-a')).get(BOT)).toMatchObject({ totalEarnings: 500 });
    expect((await rows('/api/leaderboard')).get(BOT)).toMatchObject({ totalEarnings: 15500 });
    expect((await rows('/api/leaderboard?workspaceId=floor-a')).get(BOT)).toMatchObject({ totalEarnings: 500 });
  });

  test('the full board ranks on the number with transfers in it', async () => {
    await loserPaysWinner(WS, BOT, OTHER, 500, 'other-wins');
    await transfer(OWNER, BOT, 15000);
    const res = await request(app).get('/api/leaderboard');
    expect((res.body.participants as Array<{ id: string }>).map(p => p.id)).toEqual([BOT, OTHER, OWNER]);
  });
});

describe('every surface that shows the every-floor profit shows the same number', () => {
  test('the profile of the sender and of the receiver', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    caller = undefined;
    const bot = await request(app).get(`/api/agents/${BOT}/public`);
    expect(bot.body.stats).toMatchObject({ totalEarnings: 15500, settledEarnings: 15500 });
    const owner = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(owner.body.error).toBeUndefined();
    expect(owner.body.stats).toMatchObject({ totalEarnings: -15000, settledEarnings: -15000 });
  });

  test('GET /api/agents/mine', async () => {
    await transfer(OWNER, BOT, 15000);
    caller = { uid: U };
    const res = await request(app).get('/api/agents/mine');
    const byId = new Map((res.body as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ earned: -15000 });
    expect(byId.get(BOT)).toMatchObject({ earned: 15000 });
  });

  test('the daily profit snapshot', async () => {
    await transfer(OWNER, BOT, 15000);
    const { snapshotAgentBalances } = await import('../services/balances');
    await snapshotAgentBalances();
    const snaps = await db.select().from(agentBalanceSnapshots);
    const byId = new Map(snaps.map(r => [r.agentId, r.profit]));
    expect(byId.get(BOT)).toBe(15000);
    expect(byId.get(OWNER)).toBe(-15000);
  });
});

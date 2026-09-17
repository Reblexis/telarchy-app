/**
 * THE RULES, against a real database:
 *
 *   1. Credits transferred between participants count in the ALL-TIME
 *      profit too (docs/seasons.md, "The ALL-TIME board's ranking key"):
 *      received is profit, sent is loss, in the settled part; a deposit
 *      written with the transfer ledger reason is not a transfer.
 *   2. Your score includes the accounts you own (docs/seasons.md): an
 *      owner's row on the board, the season standings, the profile and
 *      /api/agents/mine is its own number plus its bots' and their bots',
 *      the bots keeping their own rows; the pool pays once per person.
 *   3. The season standings can be scoped to one floor as a view
 *      (docs/ui-conventions.md, "The picker scopes the season board too"):
 *      that floor's trading alone, transfers left out, prizes still from the
 *      whole field.
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
  agents,
  authUser,
  creditLedger,
  creditTransfers,
  markets,
  metrics,
  positions,
  prizeSeasons,
  seasonEntries,
  trades,
  workspaces,
} from '../db/schema';
import { loadBoard, loadSeasonMarked, loadSeasonSettled } from '../lib/board';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { seasonsRouter } from '../routes/seasons';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-house-a';
const WS2 = 'ws-house-b';
const U = 'user-house';
const OWNER = 'agent-owner-h';
const BOT = 'agent-bot-h';
const SUBBOT = 'agent-subbot-h';
const OTHER = 'agent-other-h';
const SEASON = 'season-house';

const START = new Date('2026-06-01T00:00:00Z');
const END = new Date('2026-07-01T00:00:00Z');
const MID = new Date('2026-06-15T12:00:00Z');

let caller: { uid?: string; agentId?: string; isMasterKey?: boolean } | undefined = { isMasterKey: true };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth?: typeof caller }).auth = caller;
  next();
});
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/seasons', seasonsRouter);
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
    targetDate: `res-${tag}`,
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

/** The household: the owner funds the bot with 1,000; the bot loses 100 to
 *  OTHER on floor A; the sub-bot wins 30 from OTHER on floor B. */
async function seedHousehold() {
  await transfer(OWNER, BOT, 1000);
  await loserPaysWinner(WS, BOT, OTHER, 100, 'bot-loses');
  await loserPaysWinner(WS2, OTHER, SUBBOT, 30, 'subbot-wins');
}

async function seedSeason(entrants: string[]) {
  await db.insert(prizeSeasons).values({
    id: SEASON,
    name: 'House Season',
    status: 'running',
    startsAt: START,
    endsAt: END,
    poolUsd: 1000,
    payoutMode: 'proportional',
    minPayoutUsd: 0,
    strictEligibility: false,
    rulesUrl: '/legal/season-0-rules',
    workspaceIds: [WS, WS2],
    ladder: [],
  });
  await db
    .insert(seasonEntries)
    .values(
      entrants.map(agentId => ({ seasonId: SEASON, agentId, optedIn: true, baselineProfit: 0, enteredAt: START })),
    );
}

describe('credits transferred between participants count in all-time profit', () => {
  test('received is profit, sent is loss, in the settled part, with no window', async () => {
    await transfer(OTHER, OWNER, 100, new Date('2025-01-01T00:00:00Z'));
    const board = await loadBoard([WS]);
    expect(board.profitById.get(OWNER)).toBe(100);
    expect(board.profitById.get(OTHER)).toBe(-100);
    expect(board.breakdownById.get(OWNER)).toEqual({ settled: 100, open: 0, total: 100 });
    expect(board.agentIds).toEqual(expect.arrayContaining([OWNER, OTHER]));
  });

  test('a deposit is written with the transfer ledger reason but is not a transfer and never counts', async () => {
    await db.insert(creditLedger).values({
      id: 'ledger-deposit-h',
      workspaceId: 'platform',
      agentId: OTHER,
      deltaUnits: toUnits(500),
      balanceAfterUnits: toUnits(1500),
      reason: 'transfer_in',
      refType: 'transfer',
      refId: '0xdeadbeef',
      createdAt: MID,
    });
    const board = await loadBoard([WS]);
    expect(board.profitById.get(OTHER) ?? 0).toBe(0);
  });

  test('a transfer adds to trading profit on the same account', async () => {
    await loserPaysWinner(WS, OTHER, OWNER, 30, 'add');
    await transfer(OWNER, OTHER, 10.1);
    const board = await loadBoard([WS]);
    expect(board.profitById.get(OWNER)).toBe(19.9);
    expect(board.profitById.get(OTHER)).toBe(-19.9);
  });
});

describe("a floor's own board counts trading there, never transfers (owner, 2026-09-17)", () => {
  // "as part of workspace floor dont show the transfers dont count them in
  //  i dont understand why would the bot suddenly have twice as much"
  test('GET /api/leaderboard?workspaceId: the bankroll a bot received is not profit on the floor', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const res = await request(app).get('/api/leaderboard?workspaceId=floor-a');
    expect(res.status).toBe(200);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(BOT)).toMatchObject({ totalEarnings: 500, ownEarnings: 500 });
    // The owner's row still folds in the bot's trading there, and only that.
    expect(byId.get(OWNER)).toMatchObject({ totalEarnings: 500, ownEarnings: 0, botsCounted: 2 });
  });

  test('the every-floor board still counts them, so the household nets out there', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const res = await request(app).get('/api/leaderboard');
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(BOT)).toMatchObject({ totalEarnings: 15500 });
    expect(byId.get(OWNER)).toMatchObject({ totalEarnings: 500, ownEarnings: -15000 });
  });

  test('a participant who only received a transfer is not on a floor board at all', async () => {
    await transfer(OWNER, OTHER, 100);
    const res = await request(app).get('/api/leaderboard?workspaceId=floor-a');
    expect(res.body.participants).toEqual([]);
  });

  test('loadBoard: transfers are opt-out, and the profile keeps counting them', async () => {
    await transfer(OTHER, OWNER, 100);
    expect((await loadBoard([WS], { transfers: false })).profitById.get(OWNER) ?? 0).toBe(0);
    expect((await loadBoard([WS])).profitById.get(OWNER)).toBe(100);
  });
});

describe('your score includes the accounts you own', () => {
  test("the board: an owner's row is its own plus its bots' and their bots'; the bots keep their own", async () => {
    await seedHousehold();
    const board = await loadBoard([WS, WS2]);
    // Own: owner -1000 (the bankroll), bot +900, sub-bot +30, other +70.
    expect(board.ownProfitById.get(OWNER)).toBe(-1000);
    expect(board.ownProfitById.get(BOT)).toBe(900);
    expect(board.ownProfitById.get(SUBBOT)).toBe(30);
    // Household: owner -1000 + 900 + 30 = -70; bot 900 + 30; sub-bot 30.
    expect(board.profitById.get(OWNER)).toBe(-70);
    expect(board.profitById.get(BOT)).toBe(930);
    expect(board.profitById.get(SUBBOT)).toBe(30);
    expect(board.profitById.get(OTHER)).toBe(70);
    expect(board.breakdownById.get(OWNER)).toEqual({ settled: -70, open: 0, total: -70 });
    expect(board.householdById.get(OWNER)).toEqual(expect.arrayContaining([BOT, SUBBOT]));
    expect(board.householdById.get(BOT)).toEqual([SUBBOT]);
    expect(board.householdById.has(OTHER)).toBe(false);
  });

  test('the bankroll sent to a bot cancels inside the household', async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, BOT, OTHER, 975, 'bankroll');
    const board = await loadBoard([WS]);
    expect(board.profitById.get(OWNER)).toBe(-975);
    expect(board.profitById.get(BOT)).toBe(14025);
  });

  test('the season score and the marked column fold the household the same way', async () => {
    await seedHousehold();
    const settled = await loadSeasonSettled([WS, WS2], START, END);
    expect(settled.get(OWNER)).toBe(-70);
    expect(settled.get(BOT)).toBe(930);
    const marked = await loadSeasonMarked([WS, WS2], START, END);
    expect(marked.get(OWNER)).toBe(-70);
  });

  test('GET /api/leaderboard: the owner is on the board with the household number, its own beside it', async () => {
    await seedHousehold();
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ totalEarnings: -70, ownEarnings: -1000, botsCounted: 2 });
    expect(byId.get(BOT)).toMatchObject({ totalEarnings: 930, ownEarnings: 900, botsCounted: 1 });
    expect(byId.get(OTHER)).toMatchObject({ totalEarnings: 70, ownEarnings: 70, botsCounted: 0 });
  });

  test('GET /api/agents/:id/public: the profile reads the same household number', async () => {
    await seedHousehold();
    caller = undefined;
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      totalEarnings: -70,
      settledEarnings: -70,
      ownEarnings: -1000,
      botsCounted: 2,
    });
  });

  test('GET /api/agents/mine: an owner sees the household number on their own row and on each bot', async () => {
    await seedHousehold();
    caller = { uid: U };
    const res = await request(app).get('/api/agents/mine');
    expect(res.status).toBe(200);
    const byId = new Map((res.body as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ earned: -70, ownEarnings: -1000, botsCounted: 2 });
    expect(byId.get(BOT)).toMatchObject({ earned: 930, ownEarnings: 900, botsCounted: 1 });
  });
});

describe('the pool pays once per person', () => {
  test('standings: the bot is paid through its owner when both entered; a bot that never entered still counts', async () => {
    await seedHousehold();
    // OTHER wins 500 from nobody in the household so the pool has a positive field.
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}`);
    expect(res.status).toBe(200);
    const rows = res.body.participants as Array<Record<string, unknown>>;
    const byId = new Map(rows.map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ score: -70, ownScore: -1000, botsCounted: 2, paidVia: null });
    expect(byId.get(BOT)).toMatchObject({ score: 930, ownScore: 900, botsCounted: 1, paidVia: OWNER });
    expect(byId.get(BOT)?.projectedPrizeUsd).toBe(0);
    expect(byId.get(SUBBOT)).toBeUndefined();
    // The field's positive scores: other 70. The bot's 930 sits inside the
    // owner's row, which is negative, so it takes nothing and dilutes nothing.
    expect(byId.get(OTHER)?.projectedPrizeUsd).toBe(1000);
  });

  test('standings: a bot whose owner has not entered is paid on its own score', async () => {
    await seedHousehold();
    await seedSeason([BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}`);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(BOT)).toMatchObject({ score: 930, paidVia: null });
    expect(byId.get(BOT)?.projectedPrizeUsd).toBe(930);
    expect(byId.get(OTHER)?.projectedPrizeUsd).toBe(70);
  });

  test('settlement writes the household score and pays the bot nothing of its own', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).post(`/api/seasons/${SEASON}/settle`);
    expect(res.status).toBe(200);
    const rows = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, SEASON));
    const byId = new Map(rows.map(r => [r.agentId, r]));
    expect(byId.get(OWNER)?.finalScore).toBe(-70);
    expect(byId.get(BOT)?.finalScore).toBe(930);
    expect(byId.get(BOT)?.prizeUsd).toBe(0);
    expect(byId.get(OTHER)?.prizeUsd).toBe(1000);
  });
});

describe('the season standings scoped to one floor', () => {
  test("shows each entrant's trading on that floor alone, transfers left out, prizes from the whole field", async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const whole = await request(app).get(`/api/leaderboard?seasonId=${SEASON}`);
    const wholeById = new Map((whole.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}&workspaceId=floor-a`);
    expect(res.status).toBe(200);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    // Floor A alone: the bot lost 100 to OTHER; the transfer and floor B are out.
    expect(byId.get(OWNER)).toMatchObject({ score: -100, ownScore: 0 });
    expect(byId.get(BOT)).toMatchObject({ score: -100, ownScore: -100 });
    expect(byId.get(OTHER)).toMatchObject({ score: 100 });
    expect(byId.get(OTHER)?.projectedPrizeUsd).toBe(wholeById.get(OTHER)?.projectedPrizeUsd);
    expect(res.body.scope).toMatchObject({ workspaceId: WS, name: 'Floor A' });
    expect(whole.body.scope).toBeNull();
  });

  test('the order follows the scoped score', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}&workspaceId=floor-a`);
    expect((res.body.participants as Array<{ id: string }>).map(p => p.id)).toEqual([OTHER, BOT, OWNER]); // equal scores break by id
  });

  test('a scope naming no public floor answers an empty board', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}&workspaceId=nowhere`);
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
  });

  test('a settled season ignores the scope: the finals are stored and never recomputed', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    await request(app).post(`/api/seasons/${SEASON}/settle`);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}&workspaceId=floor-a`);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)?.score).toBe(-70);
    expect(res.body.scope).toBeNull();
  });
});

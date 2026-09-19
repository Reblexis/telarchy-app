/**
 * THE RULE: a bot is a separate entity (owner decision 2026-09-17: "dont
 * show family profits on leaderboard its just too confusing.. nor make it
 * count into season", "just a bot is a seaprate entity"). An owner's number
 * never includes their bots': not on the board, the season standings, the
 * profile or /api/agents/mine; a bot that entered the season is paid on its
 * own score whoever else entered. Transfers count in each account's own
 * number, all time and in the season (docs/seasons.md, "Credits transferred
 * between participants count"; transfers-count-in-profit.test.ts).
 *
 * And the season standings can be scoped to one floor as a view
 * (docs/ui-conventions.md, "The picker scopes the season board too"): that
 * floor's trading alone, transfers left out, prizes from the whole field.
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

describe('a bot is a separate entity', () => {
  test("the board: an owner's row is the owner's own trading, never the bots'", async () => {
    await seedHousehold();
    await loserPaysWinner(WS, OTHER, OWNER, 40, 'owner-wins');
    const board = await loadBoard([WS, WS2]);
    // The 1,000 bankroll is the owner's loss and the bot's profit, nobody else's.
    expect(board.profitById.get(OWNER)).toBe(-960);
    expect(board.profitById.get(BOT)).toBe(900);
    expect(board.profitById.get(SUBBOT)).toBe(30);
  });

  test('the rows carry no family fields', async () => {
    await seedHousehold();
    const res = await request(app).get('/api/leaderboard');
    for (const p of res.body.participants as Array<Record<string, unknown>>) {
      expect(p).not.toHaveProperty('ownEarnings');
      expect(p).not.toHaveProperty('botsCounted');
    }
  });

  test('the season score is per account: transfers count, the bots do not fold in', async () => {
    await seedHousehold();
    const settled = await loadSeasonSettled([WS, WS2], START, END);
    expect(settled.get(OWNER)).toBe(-1000);
    expect(settled.get(BOT)).toBe(900);
    expect(settled.get(SUBBOT)).toBe(30);
    const marked = await loadSeasonMarked([WS, WS2], START, END);
    expect(marked.get(OWNER)).toBe(-1000);
  });

  test('standings: a bot that entered is paid on its own score, its owner having entered too', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}`);
    const byId = new Map((res.body.participants as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ score: -1000, projectedPrizeUsd: 0 });
    expect(byId.get(BOT)).toMatchObject({ score: 900 });
    // Positive field: bot 900, other 70.
    expect(byId.get(BOT)?.projectedPrizeUsd).toBe(927.84);
    expect(byId.get(OTHER)?.projectedPrizeUsd).toBe(72.16);
    for (const p of res.body.participants as Array<Record<string, unknown>>) {
      expect(p).not.toHaveProperty('paidVia');
      expect(p).not.toHaveProperty('ownScore');
      expect(p).not.toHaveProperty('botsCounted');
    }
  });

  test('settlement pays the bot its own prize', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).post(`/api/seasons/${SEASON}/settle`);
    expect(res.status).toBe(200);
    const rows = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, SEASON));
    const byId = new Map(rows.map(r => [r.agentId, r]));
    expect(byId.get(OWNER)?.finalScore).toBe(-1000);
    expect(byId.get(BOT)?.prizeUsd).toBe(927.84);
    expect(byId.get(OTHER)?.prizeUsd).toBe(72.16);
  });

  test('GET /api/agents/:id/public: the profile is the account alone', async () => {
    await seedHousehold();
    await loserPaysWinner(WS, OTHER, OWNER, 40, 'owner-wins');
    caller = undefined;
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.body.error).toBeUndefined();
    expect(res.body.stats).toMatchObject({ totalEarnings: -960, settledEarnings: -960 });
    expect(res.body.stats).not.toHaveProperty('ownEarnings');
    expect(res.body.stats).not.toHaveProperty('botsCounted');
  });

  test('GET /api/agents/mine: each row is that account alone', async () => {
    await seedHousehold();
    caller = { uid: U };
    const res = await request(app).get('/api/agents/mine');
    const byId = new Map((res.body as Array<Record<string, unknown>>).map(p => [p.id, p]));
    expect(byId.get(OWNER)).toMatchObject({ earned: -1000 });
    expect(byId.get(BOT)).toMatchObject({ earned: 900 });
    expect(byId.get(OWNER)).not.toHaveProperty('botsCounted');
  });
});

describe("the profile lists an owner's bots, each with its own profit, and one total (owner, 2026-09-17)", () => {
  // "just on profile page somehow figureeout how to show owned bots and
  //  their profits as well as total profit of it and its descendants"
  test('every descendant is listed with its own profit and who it belongs to', async () => {
    await seedHousehold();
    await loserPaysWinner(WS, OTHER, OWNER, 40, 'owner-wins');
    caller = undefined;
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.body.error).toBeUndefined();
    expect(res.body.bots).toEqual([
      { id: BOT, nickname: 'bot', parentId: OWNER, totalEarnings: 900, totalTrades: 1 },
      { id: SUBBOT, nickname: 'subbot', parentId: BOT, totalEarnings: 30, totalTrades: 1 },
    ]);
    // The account's own number is untouched; the total is a plain sum beside
    // it, and the bankroll nets out of it: -960 + 900 + 30.
    expect(res.body.stats.totalEarnings).toBe(-960);
    expect(res.body.withBotsEarnings).toBe(-30);
  });

  test("a bankroll sent to a bot is the bot's profit and nets out of the total", async () => {
    await transfer(OWNER, BOT, 15000);
    await loserPaysWinner(WS, OTHER, BOT, 500, 'bot-wins');
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.body.bots).toEqual([
      { id: BOT, nickname: 'bot', parentId: OWNER, totalEarnings: 15500, totalTrades: 1 },
      { id: SUBBOT, nickname: 'subbot', parentId: BOT, totalEarnings: 0, totalTrades: 0 },
    ]);
    expect(res.body.withBotsEarnings).toBe(500);
  });

  test("a bot's own profile lists its own bots, not its siblings or its owner", async () => {
    await seedHousehold();
    const res = await request(app).get(`/api/agents/${BOT}/public`);
    expect((res.body.bots as Array<{ id: string }>).map(b => b.id)).toEqual([SUBBOT]);
    expect(res.body.withBotsEarnings).toBe(930);
  });

  test('a participant who owns nothing has an empty list and no total', async () => {
    await seedHousehold();
    const res = await request(app).get(`/api/agents/${OTHER}/public`);
    expect(res.body.bots).toEqual([]);
    expect(res.body.withBotsEarnings).toBeNull();
  });

  test('a cycle in the ownership record ends the walk instead of looping', async () => {
    await db.update(agents).set({ ownerAgentId: SUBBOT }).where(eq(agents.id, BOT));
    const res = await request(app).get(`/api/agents/${BOT}/public`);
    expect(res.status).toBe(200);
    expect((res.body.bots as Array<{ id: string }>).map(b => b.id)).toEqual([SUBBOT]);
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
    // Each account alone: the owner never traded on floor A.
    expect(byId.get(OWNER)).toMatchObject({ score: 0 });
    expect(byId.get(BOT)).toMatchObject({ score: -100 });
    expect(byId.get(OTHER)).toMatchObject({ score: 100 });
    expect(byId.get(OTHER)?.projectedPrizeUsd).toBe(wholeById.get(OTHER)?.projectedPrizeUsd);
    expect(res.body.scope).toMatchObject({ workspaceId: WS, name: 'Floor A' });
    expect(whole.body.scope).toBeNull();
  });

  test('the order follows the scoped score', async () => {
    await seedHousehold();
    await seedSeason([OWNER, BOT, OTHER]);
    const res = await request(app).get(`/api/leaderboard?seasonId=${SEASON}&workspaceId=floor-a`);
    expect((res.body.participants as Array<{ id: string }>).map(p => p.id)).toEqual([OTHER, OWNER, BOT]); // other +100, owner 0, bot -100
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
    expect(byId.get(OWNER)?.score).toBe(-1000);
    expect(res.body.scope).toBeNull();
  });
});

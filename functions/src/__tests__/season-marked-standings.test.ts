/**
 * THE MARK BESIDE THE SCORE: what an entrant would have if every market that
 * can still pay them this season settled at today's price.
 *
 * The season ranks and pays SETTLED profit (docs/seasons.md, "The score").
 * That is deliberate and stays: a mark can be manufactured on a thin book and
 * a resolution cannot. It also leaves an entrant holding a good position with
 * a row of zeroes and nothing to read, which is what prompted these columns
 * (participant report 2026-08-31: "before it was based off of unrealized
 * profit... could we add profit at resolving at current price").
 *
 * The rules under test, all of them from docs/seasons.md, "The standings show
 * the mark beside the score":
 *
 *  - the mark is the score's own arithmetic over a wider set of markets:
 *    the settled window, plus every OPEN market resolving on or before the
 *    season's end, valued at that market's current call;
 *  - a market resolving AFTER the season ends contributes nothing, because a
 *    resolution after the end pays no season prize;
 *  - the 6-hour trade cutoff applies to the mark exactly as to the score;
 *  - the projected prize on the mark comes from the same settlement function
 *    the real projection uses;
 *  - and none of it moves the rank, the share, or the prize.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/consent', () => ({
  requireConsentIfUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, prizeSeasons, seasonEntries, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadSeasonMarked } from '../lib/board';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/leaderboard', leaderboardRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
});

const WS = 'ws-marked';
const SEASON = 'season-marked';
const ALICE = 'agent-alice';
const BOB = 'agent-bob';

/** The season runs for one month around "now". */
const STARTS = new Date('2026-08-01T00:00:00Z');
const ENDS = new Date('2026-09-01T00:00:00Z');

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  await db.insert(agents).values([
    { id: ALICE, apiKeyHash: 'h-alice', balance: toUnits(10000), nickname: 'Alice' },
    { id: BOB, apiKeyHash: 'h-bob', balance: toUnits(10000), nickname: 'Bob' },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Marked Floor',
    createdBy: ALICE,
    visibility: 'public',
    slug: 'marked-floor',
  });
  await db.insert(metrics).values({
    id: 'metric-marked',
    workspaceId: WS,
    name: 'Revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(prizeSeasons).values({
    id: SEASON,
    name: 'Marked Season',
    status: 'running',
    startsAt: STARTS,
    endsAt: ENDS,
    poolUsd: 1000,
    payoutMode: 'proportional',
    minPayoutUsd: 0,
    strictEligibility: false,
    rulesUrl: '/legal/season-0-rules',
    workspaceIds: [WS],
    ladder: [],
  });
  await db.insert(seasonEntries).values([
    { seasonId: SEASON, agentId: ALICE, optedIn: true, baselineProfit: 0, enteredAt: STARTS },
    { seasonId: SEASON, agentId: BOB, optedIn: true, baselineProfit: 0, enteredAt: STARTS },
  ]);
});

/**
 * A market on the floor. `targetDate` decides when it resolves, which is the
 * whole question for the marked column.
 */
async function market(opts: {
  id: string;
  targetDate: string;
  /** [lower, higher] outstanding shares: what the book's price comes from. */
  shares?: [number, number];
  resolved?: boolean;
  resolvedAt?: Date;
  actualValue?: number;
  voided?: boolean;
}) {
  await db.insert(markets).values({
    id: opts.id,
    workspaceId: WS,
    metricId: 'metric-marked',
    metricName: 'Revenue',
    targetDate: opts.targetDate,
    rangeMin: 0,
    rangeMax: 100,
    shares: opts.shares ?? [0, 0],
    liquidity: 1000,
    pool: initialPool(1000),
    active: !opts.resolved,
    resolved: opts.resolved ?? false,
    resolvedAt: opts.resolvedAt ?? null,
    actualValue: opts.actualValue ?? null,
    voided: opts.voided ?? false,
    proposalId: null,
  });
}

let tradeSeq = 0;
async function trade(
  agentId: string,
  marketId: string,
  direction: 'higher' | 'lower',
  shares: number,
  cost: number,
  at = new Date('2026-08-10T00:00:00Z'),
) {
  tradeSeq += 1;
  await db.insert(trades).values({
    id: `t-${tradeSeq}`,
    workspaceId: WS,
    agentId,
    marketId,
    direction,
    shares,
    cost,
    createdAt: at,
  });
}

function standings() {
  return request(app).get('/api/leaderboard').query({ seasonId: SEASON });
}

function rowFor(body: { participants: Array<{ id: string }> }, id: string) {
  return body.participants.find(p => p.id === id) as unknown as {
    id: string;
    rank: number;
    score: number;
    markedScore: number;
    projectedPrizeUsd: number;
    markedProjectedPrizeUsd: number;
  };
}

describe('the mark beside the season score', () => {
  test('an open market resolving inside the season is marked at its current call', async () => {
    // The book sits at 80% higher, so a higher share is worth 0.8 credits.
    await market({ id: 'm-open-in', targetDate: '2026-08', shares: [0, 1386.29] });
    await trade(ALICE, 'm-open-in', 'higher', 100, 50);

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    // 100 shares x 0.8 = 80 credits of worth, against 50 paid.
    expect(marked.get(ALICE)).toBeCloseTo(30, 0);
  });

  test('a market resolving after the season ends is worth nothing to the season', async () => {
    await market({ id: 'm-open-late', targetDate: '2027', shares: [0, 1386.29] });
    await trade(ALICE, 'm-open-late', 'higher', 100, 50);

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    expect(marked.get(ALICE) ?? 0).toBe(0);
  });

  test('a market that already resolved inside the window keeps its settled value', async () => {
    await market({
      id: 'm-done',
      targetDate: '2026-08-15',
      resolved: true,
      resolvedAt: new Date('2026-08-16T00:00:00Z'),
      actualValue: 100,
    });
    await trade(ALICE, 'm-done', 'higher', 100, 40);

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    // Resolved at the top of the range: every higher share pays 1 credit.
    expect(marked.get(ALICE)).toBeCloseTo(60, 6);
  });

  test('a market that resolved before the season started is outside it, marked or not', async () => {
    await market({
      id: 'm-before',
      targetDate: '2026-07-15',
      resolved: true,
      resolvedAt: new Date('2026-07-16T00:00:00Z'),
      actualValue: 100,
    });
    await trade(ALICE, 'm-before', 'higher', 100, 40, new Date('2026-07-01T00:00:00Z'));

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    expect(marked.get(ALICE) ?? 0).toBe(0);
  });

  test('the 6-hour cutoff applies to the mark exactly as to the score', async () => {
    // Resolves at the very end of the season; a trade an hour before that
    // instant is inside the cutoff and cannot be scored, so it is not marked.
    await market({ id: 'm-cutoff', targetDate: '2026-08-31', shares: [0, 1386.29] });
    await trade(ALICE, 'm-cutoff', 'higher', 100, 50, new Date('2026-09-01T00:00:00Z'));

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    expect(marked.get(ALICE) ?? 0).toBe(0);
  });

  test('a voided market inside the window refunds like the settled score does', async () => {
    await market({
      id: 'm-void',
      targetDate: '2026-08-20',
      resolved: false,
      voided: true,
      resolvedAt: new Date('2026-08-21T00:00:00Z'),
    });
    // Bought for 40, sold out for 60: the refund is floored at zero net cash,
    // so the realised 20 stays and nothing else is added.
    await trade(ALICE, 'm-void', 'higher', 100, 40);
    await trade(ALICE, 'm-void', 'higher', -100, -60);

    const marked = await loadSeasonMarked([WS], STARTS, ENDS);
    expect(marked.get(ALICE)).toBeCloseTo(20, 6);
  });

  test('standings carry the mark and its projected prize, and rank on neither', async () => {
    // Bob has settled money. Alice has only an open position worth more.
    await market({
      id: 'm-bob',
      targetDate: '2026-08-15',
      resolved: true,
      resolvedAt: new Date('2026-08-16T00:00:00Z'),
      actualValue: 100,
    });
    await trade(BOB, 'm-bob', 'higher', 100, 90);
    await market({ id: 'm-alice', targetDate: '2026-08', shares: [0, 1386.29] });
    await trade(ALICE, 'm-alice', 'higher', 1000, 500);

    const res = await standings();
    expect(res.status).toBe(200);
    const alice = rowFor(res.body, ALICE);
    const bob = rowFor(res.body, BOB);

    // The published key is settled profit, so Bob leads on 10 credits while
    // Alice's 300-credit mark sits in its own column.
    expect(bob.rank).toBe(1);
    expect(bob.score).toBeCloseTo(10, 6);
    expect(alice.score).toBe(0);
    expect(alice.rank).toBe(2);

    expect(alice.markedScore).toBeCloseTo(300, 0);
    expect(bob.markedScore).toBeCloseTo(10, 6);

    // Prize stays on the settled score: Bob's positive score is the only one,
    // so he projects the whole pool.
    expect(bob.projectedPrizeUsd).toBe(1000);
    expect(alice.projectedPrizeUsd).toBe(0);

    // The marked projection splits the same pool over the marked scores.
    expect(alice.markedProjectedPrizeUsd).toBeGreaterThan(900);
    expect(alice.markedProjectedPrizeUsd + bob.markedProjectedPrizeUsd).toBeLessThanOrEqual(1000);
  });

  test('a settled season publishes its finals and no mark', async () => {
    await db
      .update(prizeSeasons)
      .set({ status: 'settled', settledAt: new Date('2026-09-01T00:00:00Z') })
      .where(eqSeason());
    await db.update(seasonEntries).set({ finalRank: 1, finalScore: 12, prizeUsd: 1000 }).where(eqEntry(ALICE));

    const res = await standings();
    expect(res.status).toBe(200);
    const alice = rowFor(res.body, ALICE);
    expect(alice.score).toBe(12);
    expect(alice.markedScore).toBeNull();
    expect(alice.markedProjectedPrizeUsd).toBeNull();
  });

  test('a draft season has no mark either, because it has no window yet', async () => {
    await db.update(prizeSeasons).set({ status: 'draft' }).where(eqSeason());
    const res = await standings();
    expect(res.status).toBe(200);
    const alice = rowFor(res.body, ALICE);
    expect(alice.score).toBeNull();
    expect(alice.markedScore).toBeNull();
  });
});

// Small helpers kept at the bottom so the tests above read as rules.
function eqSeason() {
  const { eq } = require('drizzle-orm');
  return eq(prizeSeasons.id, SEASON);
}
function eqEntry(agentId: string) {
  const { and, eq } = require('drizzle-orm');
  return and(eq(seasonEntries.seasonId, SEASON), eq(seasonEntries.agentId, agentId));
}

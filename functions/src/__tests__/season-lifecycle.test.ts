/**
 * A prize season against a real database: the rules that decide who receives
 * money, and cannot be checked with arithmetic alone.
 *
 * Three of these are the critical ones. Each was a silent failure before it had
 * a test: settling twice would recompute at new prices and could reassign a
 * prize already paid; a settled season that kept computing live would quietly
 * change its published winner every time a price moved; and a season response
 * carrying payment details would put a winner's IBAN on a public board.
 *
 * The arithmetic (scores, ladder, ties, rollover) is in seasons.test.ts and
 * runs without a database.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The seasons router now resolves auth itself (optionalAuthMiddleware, the
// mount-order fix), which pulls better-auth's ESM build that jest's CJS
// loader cannot require. This suite fakes req.auth at the edge on purpose,
// so the middleware is stubbed to pass-throughs, same as
// trade-closed-market.test.ts does.
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/consent', () => ({
  requireConsentIfUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, positions, prizeSeasons, seasonEntries, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { optionalAuthMiddleware } from '../middleware/auth';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { seasonsRouter } from '../routes/seasons';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-floor';
const LADDER = [
  { place: 1, prizeUsd: 500 },
  { place: 2, prizeUsd: 250 },
  { place: 3, prizeUsd: 125 },
];

/** Auth is faked at the edge so these tests exercise the season rules rather
 *  than the auth stack, which has its own suite. `as` sets who is calling. */
let caller: { agentId?: string; uid?: string; isMasterKey?: boolean } = { isMasterKey: true };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller }).auth = caller;
  next();
});
app.use('/api/seasons', optionalAuthMiddleware, seasonsRouter);
app.use('/api/leaderboard', leaderboardRouter);
// The same error middleware app.ts mounts. Without it an AppError becomes an
// empty 500 body and every "is this refused, and does it say why" assertion
// below silently checks nothing.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  caller = { isMasterKey: true };
});

/** One public workspace, one market, and traders who can be moved. */
async function seedFloor(traderIds: string[]) {
  await db.insert(agents).values(
    traderIds.map((id, i) => ({
      id,
      apiKeyHash: `h-${id}`,
      balance: toUnits(1000),
      nickname: `t${i}`,
      // Entering requires payment details on the account (owner direction
      // 2026-08-19); pinned in season-preregistration.test.ts.
      payoutMethod: { provider: 'paypal', email: `${id}@example.com` },
    })),
  );
  await db.insert(workspaces).values({
    id: WS,
    name: 'Floor',
    slug: 'floor',
    createdBy: traderIds[0],
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-1',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

/**
 * Give `agentId` a position worth exactly `profit` more than it cost.
 *
 * Each holder gets their OWN market. Sharing one book would make every
 * trader's worth depend on how many others this helper had already seeded,
 * which is a fine property of a real market and a terrible one for a fixture.
 * The book holds exactly the shares the position holds, which is what a market
 * where one person bought actually looks like. Worth is the position valued as
 * if the market resolved at its current call (owner decision 2026-08-19,
 * docs/seasons.md F1, revised), so the fixture prices it the same way.
 */
async function giveProfit(agentId: string, profit: number, tag: string, ws: string = WS) {
  const B = 200;
  const SHARES = 40;
  const marketId = `mkt-${tag}`;
  await db.insert(markets).values({
    id: marketId,
    workspaceId: ws,
    metricId: 'metric-1',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, SHARES],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
  const worth = SHARES * (1 / (1 + Math.exp(-SHARES / B))); // shares x the current call, range 0..100
  const cost = worth - profit;
  await db.insert(positions).values({
    id: `pos-${tag}`,
    workspaceId: ws,
    agentId,
    marketId,
    direction: 'higher',
    shares: SHARES,
    totalCost: cost,
  });
  await db.insert(trades).values({
    id: `trade-${tag}`,
    workspaceId: ws,
    agentId,
    marketId,
    direction: 'higher',
    shares: SHARES,
    cost,
    createdAt: new Date(),
  });
  clearBoardCache();
}

/** A second workspace, private until a test flips it, for the 2026-08-21
 *  "the season scores over every public workspace, live" rule. */
async function seedSecondFloor(createdBy: string) {
  await db.insert(workspaces).values({
    id: 'ws-2',
    name: 'Second floor',
    slug: 'second',
    createdBy,
    visibility: 'private',
  });
  await db.insert(metrics).values({
    id: 'metric-2',
    workspaceId: 'ws-2',
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
}

async function createSeason(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/seasons')
    .send({
      name: 'Season 1',
      startsAt: '2026-09-01T00:00:00Z',
      endsAt: '2026-09-29T00:00:00Z',
      poolUsd: 1000,
      ladder: LADDER,
      rulesUrl: '/legal/season-1',
      ...overrides,
    });
  return res;
}

async function startSeason(id: string) {
  return request(app).post(`/api/seasons/${id}/start`).send({});
}

async function optIn(seasonId: string, agentId: string, optedIn = true) {
  caller = { agentId };
  // Entering needs the rules agreement, an age confirmation and a contact
  // email (owner direction 2026-08-19). These tests are about scoring, not
  // about what entry asks for, so they satisfy it and get on with it; the
  // gates themselves are pinned in season-preregistration.test.ts.
  const res = await request(app)
    .put('/api/seasons/me')
    .send({ optedIn, acceptedRules: true, confirmedOver18: true, contactEmail: `${agentId}@example.com` });
  caller = { isMasterKey: true };
  return res;
}

// ---------------------------------------------------------------------------

describe('creating a season', () => {
  test('rejects a pool at or above the $5,000 registration threshold', async () => {
    // Above this, New York wants 30 days notice and a bond and Florida 7.
    // Staying under keeps a season registration-free in every US state, so
    // the limit is enforced here rather than remembered.
    const res = await createSeason({ poolUsd: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/registration/i);
  });

  test('rejects a ladder that promises more than the pool', async () => {
    const res = await createSeason({ poolUsd: 100, ladder: LADDER });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ladder promises/);
  });

  test('rejects an end date at or before the start', async () => {
    const res = await createSeason({ endsAt: '2026-09-01T00:00:00Z' });
    expect(res.status).toBe(400);
  });

  test('a non-admin cannot create a season', async () => {
    caller = { agentId: 'somebody' };
    const res = await createSeason();
    expect(res.status).toBe(403);
  });
});

describe('starting a season', () => {
  test('pins the workspace set and baselines every participant', async () => {
    await seedFloor(['early']);
    await giveProfit('early', 12, 'a');

    const season = (await createSeason()).body.season;
    const res = await startSeason(season.id);
    expect(res.status).toBe(200);
    expect(res.body.workspaceIds).toEqual([WS]);

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, 'early')));
    // Baselined even though nobody has opted in yet. That is the point: the
    // measurement starts when the season does, not when you decide to enter.
    expect(entry.baselineProfit).toBeCloseTo(12, 5);
    expect(entry.optedIn).toBe(false);
  });

  test('cannot start twice', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    expect((await startSeason(season.id)).status).toBe(200);
    const again = await startSeason(season.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/running, not draft/);
  });
});

describe('entering', () => {
  test('a participant who was already trading is scored from the season start, not from opt-in', async () => {
    // The exploit this closes: enter at your own trough and bank the rebound.
    await seedFloor(['veteran']);
    await giveProfit('veteran', 5, 'a');

    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'veteran');

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, 'veteran')));
    // Opting in did NOT rewrite the baseline to "now".
    expect(entry.baselineProfit).toBeCloseTo(5, 5);
    expect(entry.optedIn).toBe(true);
  });

  test('an account with no history baselines at zero and keeps everything it earns', async () => {
    await seedFloor(['newcomer']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'newcomer');
    await giveProfit('newcomer', 30, 'a');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.participants[0].score).toBeCloseTo(30, 5);
  });

  test('opting in twice leaves one entry and keeps the first entry time', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 't');
    const [first] = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, season.id));
    await optIn(season.id, 't');
    const rows = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, season.id));
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].enteredAt!).getTime()).toBe(new Date(first.enteredAt!).getTime());
  });

  test('opting out removes the participant from the standings but keeps their baseline', async () => {
    await seedFloor(['t']);
    await giveProfit('t', 8, 'a');
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 't');
    await optIn(season.id, 't', false);

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.participants).toEqual([]);
    const [entry] = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, season.id));
    // Rejoining later must not hand them a fresh, more convenient baseline.
    expect(entry.baselineProfit).toBeCloseTo(8, 5);
  });

  test('entering a season that has not started is allowed', async () => {
    // Reversed 2026-08-18 (owner direction): entry opens while a season is
    // still a draft, so it can be announced with a countdown and a working
    // button instead of asking people to come back on the day. The fairness
    // rule that used to justify the refusal is unaffected and is pinned in
    // season-preregistration.test.ts: the baseline is snapshotted for everyone
    // at the start instant, so entering early is not a starting-point choice.
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    caller = { agentId: 't' };
    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, confirmedOver18: true, contactEmail: 't@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.optedIn).toBe(true);
    expect(res.body.season.id).toBe(season.id);
    expect(res.body.season.status).toBe('draft');
  });

  test('with no season at all, entering is still refused', async () => {
    await seedFloor(['t']);
    caller = { agentId: 't' };
    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, confirmedOver18: true, contactEmail: 't@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No season is open for entry/);
  });
});

describe('standings', () => {
  test('an unknown season is a 404, never a silent fall back to the all-time board', async () => {
    await seedFloor(['t']);
    await giveProfit('t', 99, 'a');
    const res = await request(app).get('/api/leaderboard?seasonId=does-not-exist');
    expect(res.status).toBe(404);
    // The dangerous alternative: 200 with lifetime profit, read as a season score.
    expect(res.body.participants).toBeUndefined();
  });

  test('a draft season lists entrants with no score, never lifetime profit', async () => {
    await seedFloor(['t', 'u']);
    await giveProfit('t', 40, 'a');
    const season = (await createSeason()).body.season;
    await optIn(season.id, 't');
    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.status).toBe(200);
    // The entrant who just opted in sees their own name (2026-08-21: an empty
    // draft answer rendered as "Nobody has entered yet" beside their entry).
    expect(res.body.participants.map((p: { id: string }) => p.id)).toEqual(['t']);
    // No baseline exists yet, so no score does: lifetime profit must not leak.
    // (Checked on the field, not via a substring: a timestamp in the payload
    // once happened to contain the profit's digits and failed the build.)
    expect(res.body.participants[0].score).toBeNull();
    expect(res.body.participants.every((p: { score: unknown }) => p.score === null)).toBe(true);
  });

  test('a running season scores the growth since the baseline, not the profit', async () => {
    await seedFloor(['veteran', 'newcomer']);
    await giveProfit('veteran', 15, 'vet');

    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'veteran');
    await optIn(season.id, 'newcomer');
    // The newcomer earns 6 inside the window; the veteran earns nothing more.
    await giveProfit('newcomer', 6, 'new');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    const byId = Object.fromEntries(res.body.participants.map((p: { id: string; score: number }) => [p.id, p.score]));
    expect(byId.newcomer).toBeCloseTo(6, 5);
    // 15 of lifetime profit, 0 of season profit. Ranking on raw profit would
    // have put the veteran first.
    expect(byId.veteran).toBeCloseTo(0, 5);
    expect(res.body.participants[0].id).toBe('newcomer');
  });

  test('a workspace that goes private mid-season stops contributing to public standings', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 't');
    await giveProfit('t', 25, 'a');

    await db.update(workspaces).set({ visibility: 'private' }).where(eq(workspaces.id, WS));
    clearBoardCache();

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.season.workspacesDropped).toBe(1);
    // Private trading is not shown publicly, even though the season pinned it.
    expect(res.body.participants[0].score).toBeCloseTo(0, 5);
  });

  test('a workspace made public mid-season starts counting toward season standings', async () => {
    // Owner decision 2026-08-21: the season scores over every workspace public
    // right now, not the set pinned at the start instant.
    await seedFloor(['t']);
    await seedSecondFloor('t');
    const season = (await createSeason()).body.season;
    await startSeason(season.id); // pins only WS; ws-2 is private
    await optIn(season.id, 't');
    await db.update(workspaces).set({ visibility: 'public' }).where(eq(workspaces.id, 'ws-2'));
    await giveProfit('t', 25, 'a', 'ws-2');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.participants[0].score).toBeCloseTo(25, 5);
  });

  test('payment details never appear in a season standings response', async () => {
    await seedFloor(['t']);
    await db
      .update(agents)
      .set({
        payoutHandle: 'PayPal: winner@example.com',
        payoutMethod: { provider: 'paypal', email: 'winner@example.com' },
      })
      .where(eq(agents.id, 't'));
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 't');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('winner@example.com');
    expect(body).not.toContain('payoutHandle');
    expect(body).not.toContain('payoutMethod');
  });
});

describe('settling', () => {
  async function runSeasonWith(profits: Array<[string, number]>) {
    await seedFloor(profits.map(([id]) => id));
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    for (const [id] of profits) await optIn(season.id, id);
    for (const [id, profit] of profits) await giveProfit(id, profit, id);
    return season;
  }

  test('assigns the ladder and freezes the finals', async () => {
    const season = await runSeasonWith([
      ['gold', 30],
      ['silver', 20],
      ['bronze', 10],
    ]);
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners.map((w: { agentId: string; prizeUsd: number }) => [w.agentId, w.prizeUsd])).toEqual([
      ['gold', 500],
      ['silver', 250],
      ['bronze', 125],
    ]);
    expect(res.body.rolloverUsd).toBe(125);
  });

  test('settlement scores over the workspaces public at settle time, not the pinned set', async () => {
    // Mirrors the standings rule (owner decision 2026-08-21): if settlement
    // read the pinned set, the final would differ from the board people
    // watched all season.
    await seedFloor(['gold']);
    await seedSecondFloor('gold');
    const season = (await createSeason()).body.season;
    await startSeason(season.id); // pins only WS; ws-2 is private
    await optIn(season.id, 'gold');
    await db.update(workspaces).set({ visibility: 'public' }).where(eq(workspaces.id, 'ws-2'));
    await giveProfit('gold', 30, 'gold', 'ws-2');

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners).toEqual([expect.objectContaining({ agentId: 'gold', prizeUsd: 500 })]);
  });

  test('SETTLING TWICE IS REFUSED, so a paid prize can never be reassigned', async () => {
    const season = await runSeasonWith([
      ['gold', 30],
      ['silver', 20],
    ]);
    expect((await request(app).post(`/api/seasons/${season.id}/settle`).send({})).status).toBe(200);

    const again = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/only a running season can settle/);
  });

  test('a settled season reads stored finals, so prices moving later cannot change the winner', async () => {
    const season = await runSeasonWith([
      ['gold', 30],
      ['silver', 20],
    ]);
    await request(app).post(`/api/seasons/${season.id}/settle`).send({});

    const before = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(before.body.participants[0].id).toBe('gold');

    // Silver buys a mountain of shares after settlement. On a live recompute
    // this would overtake gold and the published winner would change after
    // the money was already assigned.
    await giveProfit('silver', 5000, 'late');

    const after = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(after.body.participants[0].id).toBe('gold');
    expect(after.body.participants[0].prizeUsd).toBe(500);
  });

  test('a season where nobody gained still pays by place (amended 2026-08-22)', async () => {
    // Place alone decides the prize since the mid-season amendment; a flat or
    // losing field is paid its rungs, and only unconsumed rungs roll forward.
    const season = await runSeasonWith([
      ['a', 0],
      ['b', 0],
    ]);
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.body.winners.map((w: { prizeUsd: number }) => w.prizeUsd)).toEqual([500, 250]);
    expect(res.body.rolloverUsd).toBe(250);
  });

  test('settling with no entrants at all does not crash', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.rolloverUsd).toBe(1000);
  });

  test('a draft season cannot settle', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(409);
  });

  test('a non-admin cannot settle', async () => {
    const season = await runSeasonWith([['gold', 30]]);
    caller = { agentId: 'gold' };
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(403);
  });
});

describe('claiming', () => {
  async function settledSeasonWithWinner() {
    // 'bystander' trades but never opts in: the no-prize claimant.
    await seedFloor(['winner', 'alsoran', 'bystander']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'winner');
    await optIn(season.id, 'alsoran');
    await giveProfit('winner', 30, 'w');
    await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    return season;
  }

  test('a winner with payment details can claim', async () => {
    const season = await settledSeasonWithWinner();
    await db
      .update(agents)
      .set({ payoutMethod: { provider: 'paypal', email: 'w@example.com' } })
      .where(eq(agents.id, 'winner'));

    caller = { agentId: 'winner' };
    const res = await request(app).post(`/api/seasons/${season.id}/claim`).send({});
    expect(res.status).toBe(200);
    expect(res.body.prizeUsd).toBe(500);
  });

  test('claiming without payment details asks for them rather than failing silently', async () => {
    const season = await settledSeasonWithWinner();
    // Entry now seeds a payout method (owner direction 2026-08-19), so this
    // case has to remove it deliberately. The claim gate still has to hold on
    // its own: someone can clear their details between entering and winning.
    await db.update(agents).set({ payoutMethod: null, payoutHandle: null }).where(eq(agents.id, 'winner'));
    caller = { agentId: 'winner' };
    const res = await request(app).post(`/api/seasons/${season.id}/claim`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payment details/i);
  });

  test('someone with no prize cannot claim', async () => {
    // Since the 2026-08-22 amendment a zero score still takes a rung, so the
    // no-prize case is an entrant who never opted in at all.
    const season = await settledSeasonWithWinner();
    caller = { agentId: 'bystander' };
    const res = await request(app).post(`/api/seasons/${season.id}/claim`).send({});
    expect(res.status).toBe(403);
  });

  test('a prize cannot be claimed twice', async () => {
    const season = await settledSeasonWithWinner();
    await db
      .update(agents)
      .set({ payoutMethod: { provider: 'paypal', email: 'w@example.com' } })
      .where(eq(agents.id, 'winner'));
    caller = { agentId: 'winner' };
    expect((await request(app).post(`/api/seasons/${season.id}/claim`).send({})).status).toBe(200);
    const again = await request(app).post(`/api/seasons/${season.id}/claim`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already been claimed/);
  });

  test('claiming after the 30-day window marks the prize expired and refuses', async () => {
    const season = await settledSeasonWithWinner();
    await db
      .update(agents)
      .set({ payoutMethod: { provider: 'paypal', email: 'w@example.com' } })
      .where(eq(agents.id, 'winner'));
    // Settled 31 days ago.
    await db
      .update(prizeSeasons)
      .set({ settledAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(prizeSeasons.id, season.id));

    caller = { agentId: 'winner' };
    const res = await request(app).post(`/api/seasons/${season.id}/claim`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/claim window closed/);

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, 'winner')));
    // Recorded, so the rolled-forward pool has a row explaining it.
    expect(entry.claimState).toBe('expired');
  });

  test('a prize cannot be marked paid before it is claimed', async () => {
    const season = await settledSeasonWithWinner();
    const res = await request(app).post(`/api/seasons/${season.id}/entries/winner/paid`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only a claimed prize/);
  });

  test('payouts are visible to an admin, with the details needed to pay', async () => {
    const season = await settledSeasonWithWinner();
    await db.update(agents).set({ payoutHandle: 'PayPal: w@example.com' }).where(eq(agents.id, 'winner'));
    const res = await request(app).get(`/api/seasons/${season.id}/payouts`);
    expect(res.status).toBe(200);
    // Both entrants hold a rung since the 2026-08-22 amendment; the winner
    // leads and carries the details needed to pay them.
    expect(res.body.payouts).toHaveLength(2);
    expect(res.body.payouts[0].payoutHandle).toBe('PayPal: w@example.com');
  });

  test('payouts are NOT visible to a participant', async () => {
    const season = await settledSeasonWithWinner();
    caller = { agentId: 'winner' };
    const res = await request(app).get(`/api/seasons/${season.id}/payouts`);
    expect(res.status).toBe(403);
  });
});

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
  // This suite tests the CURRENT scoring rule, settled profit (amended
  // 2026-08-28), so the effective instant is pinned to the past; the tests
  // must not change behaviour when the wall clock crosses the real instant.
  // The switch itself is pinned in settled-window-scoring.test.ts and the
  // legacy marked branch below ("before the effective instant").
  process.env.SEASON_SETTLED_SCORING_AT = '2000-01-01T00:00:00Z';
});
afterAll(() => {
  delete process.env.SEASON_SETTLED_SCORING_AT;
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

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Give `agentId` a SETTLED season profit of exactly `profit`: their own
 * market, resolved inside the season window, one counted trade well before
 * the 6h cutoff. Range 0..100 resolved at 50, so 40 'higher' shares pay 20
 * and the cost is set to 20 - profit (the settled-window formula,
 * lib/leaderboard.ts computeSettledWindowProfit).
 */
async function giveSettledProfit(
  agentId: string,
  profit: number,
  tag: string,
  ws: string = WS,
  opts: { resolvedAt?: Date; tradeAt?: Date } = {},
) {
  const SHARES = 40;
  const ACTUAL = 50;
  const marketId = `mkt-${tag}`;
  const resolvedAt = opts.resolvedAt ?? new Date(Date.now() - 1 * HOUR);
  const tradeAt = opts.tradeAt ?? new Date(resolvedAt.getTime() - 2 * DAY);
  const payout = SHARES * (ACTUAL / 100);
  const cost = payout - profit;
  await db.insert(markets).values({
    id: marketId,
    workspaceId: ws,
    metricId: 'metric-1',
    metricName: 'Revenue',
    targetDate: `res-${tag}`,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, SHARES],
    liquidity: 200,
    pool: 0,
    active: false,
    resolved: true,
    actualValue: ACTUAL,
    resolvedAt,
    voided: false,
    proposalId: null,
  });
  await db.insert(trades).values({
    id: `trade-${tag}`,
    workspaceId: ws,
    agentId,
    marketId,
    direction: 'higher',
    shares: SHARES,
    cost,
    createdAt: tradeAt,
  });
  await db.insert(positions).values({
    id: `pos-${tag}`,
    workspaceId: ws,
    agentId,
    marketId,
    direction: 'higher',
    shares: SHARES,
    totalCost: cost,
  });
  clearBoardCache();
}

/** End the season NOW: settle refuses to run before `endsAt` (guard of
 *  2026-08-28), and the scored window ends there, so tests end the season at
 *  the instant they settle. */
async function closeSeason(seasonId: string) {
  await db.update(prizeSeasons).set({ endsAt: new Date() }).where(eq(prizeSeasons.id, seasonId));
  clearBoardCache();
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
 * docs/seasons.md F1, revised), so the fixture prices it the same way. Under
 * settled season scoring (2026-08-28) this mark scores ZERO for the season;
 * the helper stays for the baseline snapshots, the all-time board, and for
 * proving exactly that zero.
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
  // Started ten days back and ending tomorrow, so entry is open, the
  // fixtures' resolved markets (resolvedAt about an hour ago) sit inside the
  // scored window, and closeSeason() can end it at the settle instant.
  const res = await request(app)
    .post('/api/seasons')
    .send({
      name: 'Season 1',
      startsAt: new Date(Date.now() - 10 * DAY).toISOString(),
      endsAt: new Date(Date.now() + 1 * DAY).toISOString(),
      poolUsd: 1000,
      ladder: LADDER,
      rulesUrl: '/legal/season-1',
      // The Season 0 configuration: seedFloor makes the first trader the
      // workspace creator, so under the post-Season-0 default (strict on)
      // they would take no payout and every assertion here would be about
      // eligibility instead of what it tests. Strict behaviour has its own
      // tests below.
      strictEligibility: false,
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
  test('a pool at or above $5,000 is accepted: the old ceiling is retired (2026-08-28)', async () => {
    // The sub-5000 rule was the NY/FL registration-and-bonding threshold for
    // CHANCE sweepstakes; a deterministic skill-scored payout is a skill
    // contest and scales uncapped (owner decision 2026-08-28, design record
    // notes/wheel-vs-proportional-legality-2026-08-28.md in the telarchy
    // umbrella). The cap that remains is per single payout, in lib/seasons.ts.
    const res = await createSeason({ poolUsd: 25000, ladder: [{ place: 1, prizeUsd: 2000 }] });
    expect(res.status).toBe(201);
    expect(res.body.season.poolUsd).toBe(25000);
  });

  test('a season created without a ladder defaults to the proportional payout', async () => {
    const res = await request(app)
      .post('/api/seasons')
      .send({
        name: 'Proportional',
        startsAt: new Date(Date.now() - 10 * DAY).toISOString(),
        endsAt: new Date(Date.now() + 1 * DAY).toISOString(),
        poolUsd: 1000,
        minPayoutUsd: 50,
        rulesUrl: '/legal/season-1',
      });
    expect(res.status).toBe(201);
    expect(res.body.season.payoutMode).toBe('proportional');
    expect(res.body.season.minPayoutUsd).toBe(50);
    expect(res.body.season.ladder).toEqual([]);
  });

  test('rejects a ladder that promises more than the pool', async () => {
    const res = await createSeason({ poolUsd: 100, ladder: LADDER });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ladder promises/);
  });

  test('rejects an end date at or before the start', async () => {
    const res = await createSeason({ startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' });
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

  test('a newcomer keeps everything that settles for them inside the window', async () => {
    await seedFloor(['newcomer']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'newcomer');
    await giveSettledProfit('newcomer', 30, 'a');

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

  test('a running season scores ONLY what resolved inside its window (amended 2026-08-28)', async () => {
    await seedFloor(['veteran', 'newcomer']);
    // The veteran banked 15 on a market that resolved BEFORE the season
    // started; the newcomer settles 6 inside the window.
    await giveSettledProfit('veteran', 15, 'vet', WS, { resolvedAt: new Date(Date.now() - 20 * DAY) });

    const season = (await createSeason()).body.season; // starts 10 days back
    await startSeason(season.id);
    await optIn(season.id, 'veteran');
    await optIn(season.id, 'newcomer');
    await giveSettledProfit('newcomer', 6, 'new');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    const byId = Object.fromEntries(res.body.participants.map((p: { id: string; score: number }) => [p.id, p.score]));
    expect(byId.newcomer).toBeCloseTo(6, 5);
    // 15 of lifetime settled profit, 0 of season profit: the window is the
    // baseline now.
    expect(byId.veteran).toBeCloseTo(0, 5);
    expect(res.body.participants[0].id).toBe('newcomer');
  });

  test('an open position scores nothing, however high the board marks it (amended 2026-08-28)', async () => {
    await seedFloor(['marker', 'earner']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'marker');
    await optIn(season.id, 'earner');
    // marker holds a monster UNRESOLVED mark; earner settles a modest 5.
    await giveProfit('marker', 1425, 'mark');
    await giveSettledProfit('earner', 5, 'earn');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    const byId = Object.fromEntries(res.body.participants.map((p: { id: string; score: number }) => [p.id, p.score]));
    expect(byId.marker).toBeCloseTo(0, 5);
    expect(byId.earner).toBeCloseTo(5, 5);
    expect(res.body.participants[0].id).toBe('earner');
  });

  test('BEFORE the effective instant the previous marked rule still applies', async () => {
    // The pre-amendment era (before 2026-08-28): until the effective instant
    // passes, standings keep the marked key the entrants watched all week.
    // Dead in production since the owner made the amendment effective on
    // announcement; kept because the switch itself must stay correct.
    process.env.SEASON_SETTLED_SCORING_AT = '2100-01-01T00:00:00Z';
    await seedFloor(['marker']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'marker');
    await giveProfit('marker', 25, 'mark');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.participants[0].score).toBeCloseTo(25, 5);
  });

  test('a workspace that goes private mid-season stops contributing to public standings', async () => {
    await seedFloor(['t']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 't');
    await giveSettledProfit('t', 25, 'a');

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
    await giveSettledProfit('t', 25, 'a', 'ws-2');

    const res = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(res.body.participants[0].score).toBeCloseTo(25, 5);
  });

  test("a workspace made public mid-season moves the all-time board's seasonPrizeUsd column", async () => {
    // docs/seasons.md: standings and settlement read the same set, every
    // workspace public at read time. The prize column on the all-time board
    // is a third reader of the same projection and must agree with the other
    // two, or the board names one winner and the standings another.
    await seedFloor(['t', 'u']);
    await seedSecondFloor('t');
    const season = (await createSeason()).body.season;
    await startSeason(season.id); // pins only WS; ws-2 is private
    await optIn(season.id, 't');
    await optIn(season.id, 'u');
    await giveSettledProfit('u', 10, 'u-home'); // on the pinned floor
    await db.update(workspaces).set({ visibility: 'public' }).where(eq(workspaces.id, 'ws-2'));
    await giveSettledProfit('t', 25, 't-second', 'ws-2'); // only on the floor published mid-season

    const res = await request(app).get('/api/leaderboard');
    const prize = new Map(
      (res.body.participants as { id: string; seasonPrizeUsd: number }[]).map(p => [p.id, p.seasonPrizeUsd]),
    );
    // t leads the season on 25 vs 10, so t holds the first rung (500) and u the
    // second (250), exactly what ?seasonId= reports for the same instant.
    const standings = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    expect(standings.body.participants[0]).toMatchObject({ id: 't', projectedPrizeUsd: LADDER[0].prizeUsd });
    expect(prize.get('t')).toBe(LADDER[0].prizeUsd);
    expect(prize.get('u')).toBe(LADDER[1].prizeUsd);
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
  async function runSeasonWith(profits: Array<[string, number]>, overrides: Record<string, unknown> = {}) {
    await seedFloor(profits.map(([id]) => id));
    const season = (await createSeason(overrides)).body.season;
    await startSeason(season.id);
    for (const [id] of profits) await optIn(season.id, id);
    for (const [id, profit] of profits) await giveSettledProfit(id, profit, id);
    await closeSeason(season.id);
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

  test('a proportional season settles pool x score / total, not a ladder (amended 2026-08-28)', async () => {
    const season = await runSeasonWith(
      [
        ['gold', 30],
        ['silver', 10],
      ],
      { payoutMode: 'proportional' },
    );
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners.map((w: { agentId: string; prizeUsd: number }) => [w.agentId, w.prizeUsd])).toEqual([
      ['gold', 750],
      ['silver', 250],
    ]);
    expect(res.body.rolloverUsd).toBe(0);
  });

  test('a running season can amend payoutMode (the Season 0 clause), and nothing else', async () => {
    await seedFloor(['gold']);
    const season = (await createSeason()).body.season; // ladder mode
    await startSeason(season.id);

    // The one allowed mid-season amendment: the payout arithmetic, announced
    // first (the announcement is operational, not enforceable here).
    const amend = await request(app)
      .patch(`/api/seasons/${season.id}`)
      .send({ payoutMode: 'proportional', minPayoutUsd: 50 });
    expect(amend.status).toBe(200);
    expect(amend.body.season.payoutMode).toBe('proportional');
    expect(amend.body.season.minPayoutUsd).toBe(50);

    // Pool and start stay frozen even under the clause.
    const pool = await request(app).patch(`/api/seasons/${season.id}`).send({ poolUsd: 2000 });
    expect(pool.status).toBe(409);
    const mixed = await request(app).patch(`/api/seasons/${season.id}`).send({ payoutMode: 'ladder', poolUsd: 2000 });
    expect(mixed.status).toBe(409);
  });

  test('A RUNNING SEASON CAN BE EXTENDED, because that can only add scores', async () => {
    // Season 0 was found ending at the exact instant 86% of its depth
    // resolved, so those markets would have scored nothing (2026-08-31).
    // Extending the window brings a later resolution INTO the scored set
    // and can never take one out, which is what the amendment clause asks.
    await seedFloor(['gold']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);

    const later = new Date(new Date(season.endsAt).getTime() + 86_400_000).toISOString();
    const res = await request(app).patch(`/api/seasons/${season.id}`).send({ endsAt: later });
    expect(res.status).toBe(200);
    expect(new Date(res.body.season.endsAt).toISOString()).toBe(later);
  });

  test('A RUNNING SEASON CANNOT BE SHORTENED, because that strips scores', async () => {
    // The direction is the whole safety argument: moving the end earlier
    // would drop markets that had already resolved inside the window and
    // reduce standings, which the clause forbids outright.
    await seedFloor(['gold']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);

    const earlier = new Date(new Date(season.endsAt).getTime() - 86_400_000).toISOString();
    const res = await request(app).patch(`/api/seasons/${season.id}`).send({ endsAt: earlier });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/earlier|extend|shorten/i);

    const same = await request(app).patch(`/api/seasons/${season.id}`).send({ endsAt: season.endsAt });
    expect(same.status).toBe(409);
  });

  test('the start instant stays frozen however the end moves', async () => {
    await seedFloor(['gold']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    const res = await request(app)
      .patch(`/api/seasons/${season.id}`)
      .send({ startsAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(409);
  });

  test('strict eligibility: the workspace creator is ranked but paid nothing (seasons after Season 0)', async () => {
    const season = await runSeasonWith(
      [
        ['gold', 30], // seedFloor makes 'gold' the workspace creator
        ['silver', 10],
      ],
      { payoutMode: 'proportional', strictEligibility: true },
    );
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    // The creator's 30 of settled profit earns nothing and does not dilute
    // silver's share; standings still rank them first.
    expect(res.body.winners.map((w: { agentId: string; prizeUsd: number }) => [w.agentId, w.prizeUsd])).toEqual([
      ['silver', 1000],
    ]);
    const standings = await request(app).get(`/api/leaderboard?seasonId=${season.id}`);
    const gold = standings.body.participants.find((p: { id: string }) => p.id === 'gold');
    expect(gold.rank).toBe(1);
  });

  test('strict eligibility: entries sharing a payout handle collapse to the best-placed one', async () => {
    await seedFloor(['alpha', 'beta', 'shadow']);
    // 'alpha' created the workspace (seedFloor), so the two entrants under
    // test are beta and shadow: one person, two accounts, one handle.
    await db.update(agents).set({ payoutHandle: 'paypal:same@person.example' }).where(eq(agents.id, 'beta'));
    await db.update(agents).set({ payoutHandle: 'PAYPAL:same@person.example' }).where(eq(agents.id, 'shadow'));
    const season = (await createSeason({ payoutMode: 'proportional', strictEligibility: true })).body.season;
    await startSeason(season.id);
    for (const id of ['beta', 'shadow']) await optIn(season.id, id);
    await giveSettledProfit('beta', 30, 'beta');
    await giveSettledProfit('shadow', 10, 'shadow');
    await closeSeason(season.id);

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners.map((w: { agentId: string; prizeUsd: number }) => [w.agentId, w.prizeUsd])).toEqual([
      ['beta', 1000],
    ]);
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
    await giveSettledProfit('gold', 30, 'gold', 'ws-2');
    await closeSeason(season.id);

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners).toEqual([expect.objectContaining({ agentId: 'gold', prizeUsd: 500 })]);
  });

  test('SETTLING BEFORE THE END INSTANT IS REFUSED: the scored window ends at endsAt', async () => {
    await seedFloor(['gold']);
    const season = (await createSeason()).body.season; // ends tomorrow
    await startSeason(season.id);
    await optIn(season.id, 'gold');
    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/runs until/);
  });

  test('a monster open mark settles at zero; the settled earner takes the rung (amended 2026-08-28)', async () => {
    await seedFloor(['marker', 'earner']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'marker');
    await optIn(season.id, 'earner');
    await giveProfit('marker', 5000, 'mark'); // unresolved, marked only
    await giveSettledProfit('earner', 5, 'earn');
    await closeSeason(season.id);

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners.map((w: { agentId: string; prizeUsd: number }) => [w.agentId, w.prizeUsd])).toEqual([
      ['earner', 500],
      ['marker', 250],
    ]);
    const marker = res.body.winners.find((w: { agentId: string }) => w.agentId === 'marker');
    expect(marker.score).toBe(0);
  });

  test('A TRADE INSIDE THE FINAL 6 HOURS OF A MARKET COUNTS NOTHING (amended 2026-08-28)', async () => {
    await seedFloor(['sniper']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'sniper');
    // An honest trade two days out: 40 shares at cost 10, resolution pays 20.
    const resolvedAt = new Date(Date.now() - 1 * HOUR);
    await giveSettledProfit('sniper', 10, 'snipe', WS, { resolvedAt });
    // The snipe: two hours before resolution, when the reading is knowable,
    // 40 more shares for almost nothing. Counted, it would add ~19 of score.
    await db.insert(trades).values({
      id: 'trade-snipe-late',
      workspaceId: WS,
      agentId: 'sniper',
      marketId: 'mkt-snipe',
      direction: 'higher',
      shares: 40,
      cost: 1,
      createdAt: new Date(resolvedAt.getTime() - 2 * HOUR),
    });
    clearBoardCache();
    await closeSeason(season.id);

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    // Only the early trade scores: 20 of payout minus 10 of cost.
    expect(res.body.winners[0].score).toBeCloseTo(10, 5);
  });

  test('a resolution after the season end scores nothing, however soon after', async () => {
    await seedFloor(['late']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'late');
    const end = new Date();
    await db.update(prizeSeasons).set({ endsAt: end }).where(eq(prizeSeasons.id, season.id));
    // Resolves one second past the end: outside `(startsAt, endsAt]`.
    await giveSettledProfit('late', 30, 'after', WS, { resolvedAt: new Date(end.getTime() + 1000) });
    clearBoardCache();

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners[0].score).toBe(0);
  });

  test('a resolution exactly at the end instant counts (the published boundary)', async () => {
    await seedFloor(['edge']);
    const season = (await createSeason()).body.season;
    await startSeason(season.id);
    await optIn(season.id, 'edge');
    const end = new Date();
    await db.update(prizeSeasons).set({ endsAt: end }).where(eq(prizeSeasons.id, season.id));
    await giveSettledProfit('edge', 30, 'edge', WS, { resolvedAt: end });
    clearBoardCache();

    const res = await request(app).post(`/api/seasons/${season.id}/settle`).send({});
    expect(res.status).toBe(200);
    expect(res.body.winners[0].score).toBeCloseTo(30, 5);
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
    await closeSeason(season.id);
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
    await giveSettledProfit('winner', 30, 'w');
    await closeSeason(season.id);
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

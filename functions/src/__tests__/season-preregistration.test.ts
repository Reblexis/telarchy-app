/**
 * Entering a season before it starts.
 *
 * Entry used to open only once a season was `running`, which meant the
 * announcement, the countdown and the entry button could not exist until the
 * start instant: everyone who heard about the season early had to be asked to
 * come back later, during exactly the window where it has attention. Entry now
 * opens while the season is still a draft (owner direction 2026-08-18).
 *
 * The dangerous half is `start`, which used to DELETE every row for the season
 * and rebuild baselines from the board. With pre-registration that would have
 * thrown away every early entrant without a trace: opted in yesterday, opted
 * out today, nothing saying why. The first test here is that one.
 *
 * Fairness is untouched, and the second block proves it: the baseline is read
 * for EVERYONE at the start instant, so entering two days early and entering
 * on the day produce the same starting score.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/consent', () => ({
  requireConsentIfUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents, markets, metrics, positions, prizeSeasons, seasonEntries, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { AppError } from '../lib/errors';
import { seasonsRouter } from '../routes/seasons';
import { leaderboardRouter, clearBoardCache } from '../routes/leaderboard';

const WS = 'ws-prereg';
const EARLY = 'agent-early';
const LATE = 'agent-late';
const LADDER = [{ place: 1, prizeUsd: 500 }];

let caller: { agentId?: string; uid?: string; isMasterKey?: boolean } = { isMasterKey: true };

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as unknown as { auth: typeof caller }).auth = caller; next(); });
app.use('/api/seasons', seasonsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
});

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  caller = { isMasterKey: true };
});

async function seedFloor(ids: string[]) {
  await db.insert(agents).values(ids.map((id, i) => ({
    id, apiKeyHash: `h-${id}`, balance: toUnits(1000), nickname: `p${i}`,
  })));
  await db.insert(workspaces).values({
    id: WS, name: 'Floor', slug: 'prereg-floor', createdBy: ids[0], visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-p', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-p', workspaceId: WS, metricId: 'metric-p', metricName: 'Revenue',
    targetDate: '2028', rangeMin: 0, rangeMax: 100,
    shares: [0, 0] as [number, number], liquidity: 200, pool: initialPool(200),
    active: true, resolved: false, voided: false, proposalId: null,
  });
}

/** 40 shares marked at 0.5 are worth 20; paying 20 - profit leaves `profit`. */
async function giveProfit(agentId: string, profit: number, tag: string) {
  const cost = 20 - profit;
  await db.insert(positions).values({
    id: `pos-${tag}`, workspaceId: WS, agentId, marketId: 'mkt-p',
    direction: 'higher', shares: 40, totalCost: cost,
  });
  await db.insert(trades).values({
    id: `trade-${tag}`, workspaceId: WS, agentId, marketId: 'mkt-p',
    direction: 'higher', shares: 40, cost, createdAt: new Date(),
  });
  clearBoardCache();
}

async function createSeason() {
  const res = await request(app).post('/api/seasons').send({
    name: 'Season 1',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-09-29T00:00:00Z',
    poolUsd: 1000, ladder: LADDER, rulesUrl: '/legal/season-1',
  });
  expect(res.status).toBeLessThan(300);
  return res.body.season.id as string;
}

const asAgent = (id: string) => { caller = { agentId: id }; };
const asAdmin = () => { caller = { isMasterKey: true }; };

const enter = (optedIn: boolean) => request(app).put('/api/seasons/me').send({ optedIn });
const mine = () => request(app).get('/api/seasons/me');

async function entryRow(seasonId: string, agentId: string) {
  const [row] = await db.select().from(seasonEntries)
    .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)));
  return row ?? null;
}

describe('entry is open before the season starts', () => {
  test('a draft season is offered, and can be entered', async () => {
    await seedFloor([EARLY, LATE]);
    const id = await createSeason();

    asAgent(EARLY);
    const before = await mine();
    expect(before.status).toBe(200);
    // This is the whole change: a draft used to answer `season: null` here,
    // so no surface could show a countdown or an entry button.
    expect(before.body.season?.id).toBe(id);
    expect(before.body.season.status).toBe('draft');
    expect(before.body.canEnter).toBe(true);
    expect(before.body.optedIn).toBe(false);

    expect((await enter(true)).status).toBe(200);
    expect((await mine()).body.optedIn).toBe(true);

    const row = await entryRow(id, EARLY);
    expect(row?.optedIn).toBe(true);
    expect(row?.enteredAt).toBeTruthy();
  });

  test('leaving again before it starts works too', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    expect((await enter(false)).status).toBe(200);
    expect((await entryRow(id, EARLY))?.optedIn).toBe(false);
  });

  test('with no season at all there is still nothing to enter', async () => {
    await seedFloor([EARLY]);
    asAgent(EARLY);
    expect((await mine()).body).toEqual({ season: null, optedIn: false, canEnter: false });
    expect((await enter(true)).status).toBe(409);
  });
});

describe('starting the season keeps the people who already entered', () => {
  test('a pre-registration survives the start', async () => {
    await seedFloor([EARLY, LATE]);
    const id = await createSeason();

    asAgent(EARLY);
    await enter(true);

    asAdmin();
    const started = await request(app).post(`/api/seasons/${id}/start`).send({});
    expect(started.status).toBe(200);
    expect(started.body.preRegistrationsKept).toBe(1);

    // The bug this pins: start used to delete every row for the season and
    // rebuild from the board, silently un-entering everyone who signed up early.
    const row = await entryRow(id, EARLY);
    expect(row?.optedIn).toBe(true);
    expect(row?.enteredAt).toBeTruthy();

    asAgent(EARLY);
    expect((await mine()).body.optedIn).toBe(true);
  });

  test('an early entrant with no trading history is not dropped for having a zero baseline', async () => {
    // Only nonzero baselines are worth storing, so a rebuild that filters on
    // that would drop a brand new account that had already entered.
    await seedFloor([EARLY, LATE]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);

    asAdmin();
    await request(app).post(`/api/seasons/${id}/start`).send({});

    const row = await entryRow(id, EARLY);
    expect(row).not.toBeNull();
    expect(row?.optedIn).toBe(true);
    expect(row?.baselineProfit).toBe(0);
  });

  test('someone who did not enter stays not entered, baseline and all', async () => {
    await seedFloor([EARLY, LATE]);
    await giveProfit(LATE, 30, 'late');
    const id = await createSeason();

    asAdmin();
    await request(app).post(`/api/seasons/${id}/start`).send({});

    const row = await entryRow(id, LATE);
    expect(row?.optedIn).toBe(false);
    expect(row?.enteredAt).toBeNull();
    expect(row?.baselineProfit).toBeGreaterThan(0);
  });
});

describe('entering early buys no advantage', () => {
  test('the baseline is read at the start instant, however early you signed up', async () => {
    await seedFloor([EARLY, LATE]);
    // Both are already up 30 before the season begins. If pre-registration
    // baselined at opt-in time, EARLY would carry that 30 into their season
    // score and LATE would not.
    await giveProfit(EARLY, 30, 'early');
    await giveProfit(LATE, 30, 'late');

    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);

    asAdmin();
    await request(app).post(`/api/seasons/${id}/start`).send({});

    asAgent(LATE);
    await enter(true);

    const a = await entryRow(id, EARLY);
    const b = await entryRow(id, LATE);
    expect(a?.baselineProfit).toBeGreaterThan(0);
    expect(a?.baselineProfit).toBe(b?.baselineProfit);
  });
});

describe('a running season still behaves as it did', () => {
  test('running wins over a draft when both exist', async () => {
    await seedFloor([EARLY]);
    const first = await createSeason();
    asAdmin();
    await request(app).post(`/api/seasons/${first}/start`).send({});

    // A second season drafted while the first runs must not steal the toggle.
    await db.insert(prizeSeasons).values({
      id: 'season-2', name: 'Season 2',
      startsAt: new Date('2026-11-01'), endsAt: new Date('2026-12-01'),
      poolUsd: 500, ladder: LADDER, workspaceIds: [],
      rulesUrl: '/legal/season-1', status: 'draft',
    });

    asAgent(EARLY);
    expect((await mine()).body.season.id).toBe(first);
  });

  test('a settled season is not enterable', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAdmin();
    await request(app).post(`/api/seasons/${id}/start`).send({});
    await request(app).post(`/api/seasons/${id}/settle`).send({});

    asAgent(EARLY);
    // No draft, no running: nothing to enter, and no crash reaching for one.
    expect((await mine()).body.season).toBeNull();
    expect((await enter(true)).status).toBe(409);
  });
});

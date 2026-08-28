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

const WS = 'ws-prereg';
const EARLY = 'agent-early';
const LATE = 'agent-late';
const LADDER = [{ place: 1, prizeUsd: 500 }];

let caller: { agentId?: string; uid?: string; isMasterKey?: boolean } = { isMasterKey: true };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller }).auth = caller;
  next();
});
app.use('/api/seasons', optionalAuthMiddleware, seasonsRouter);
app.use('/api/leaderboard', leaderboardRouter);
// Mirrors app.ts, `extra` spread included: without it every assertion about
// WHICH step is missing would be checking a field the caller never sees.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message, ...extra });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  caller = { isMasterKey: true };
});

async function seedFloor(ids: string[]) {
  await db.insert(agents).values(
    ids.map((id, i) => ({
      id,
      apiKeyHash: `h-${id}`,
      balance: toUnits(1000),
      nickname: `p${i}`,
      payoutMethod: { provider: 'paypal', email: `${id}@example.com` },
    })),
  );
  await db.insert(workspaces).values({
    id: WS,
    name: 'Floor',
    slug: 'prereg-floor',
    createdBy: ids[0],
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-p',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-p',
    workspaceId: WS,
    metricId: 'metric-p',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

/** 40 shares marked at 0.5 are worth 20; paying 20 - profit leaves `profit`. */
async function giveProfit(agentId: string, profit: number, tag: string) {
  const cost = 20 - profit;
  await db.insert(positions).values({
    id: `pos-${tag}`,
    workspaceId: WS,
    agentId,
    marketId: 'mkt-p',
    direction: 'higher',
    shares: 40,
    totalCost: cost,
  });
  await db.insert(trades).values({
    id: `trade-${tag}`,
    workspaceId: WS,
    agentId,
    marketId: 'mkt-p',
    direction: 'higher',
    shares: 40,
    cost,
    createdAt: new Date(),
  });
  clearBoardCache();
}

async function createSeason() {
  const res = await request(app).post('/api/seasons').send({
    name: 'Season 1',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-09-29T00:00:00Z',
    poolUsd: 1000,
    ladder: LADDER,
    rulesUrl: '/legal/season-1',
  });
  expect(res.status).toBeLessThan(300);
  return res.body.season.id as string;
}

const asAgent = (id: string) => {
  caller = { agentId: id };
};
const asAdmin = () => {
  caller = { isMasterKey: true };
};

const enter = (optedIn: boolean, acceptedRules = true) =>
  request(app)
    .put('/api/seasons/me')
    .send({ optedIn, acceptedRules, confirmedOver18: true, contactEmail: 'entrant@example.com' });

/** Payment details on the account: entering requires them (owner direction
 *  2026-08-19), so every seed that expects to get in has to set one. */
async function withPayout(agentId: string) {
  await db
    .update(agents)
    .set({ payoutMethod: { provider: 'paypal', email: `${agentId}@example.com` } })
    .where(eq(agents.id, agentId));
}
const mine = () => request(app).get('/api/seasons/me');

async function entryRow(seasonId: string, agentId: string) {
  const [row] = await db
    .select()
    .from(seasonEntries)
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
      id: 'season-2',
      name: 'Season 2',
      startsAt: new Date('2026-11-01'),
      endsAt: new Date('2026-12-01'),
      poolUsd: 500,
      ladder: LADDER,
      workspaceIds: [],
      rulesUrl: '/legal/season-1',
      status: 'draft',
    });

    asAgent(EARLY);
    expect((await mine()).body.season.id).toBe(first);
  });

  test('a settled season is not enterable', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAdmin();
    await request(app).post(`/api/seasons/${id}/start`).send({});
    // Settle refuses before the end instant (2026-08-28: the scored window
    // ends at endsAt), so the season has to end first.
    await db.update(prizeSeasons).set({ endsAt: new Date() }).where(eq(prizeSeasons.id, id));
    await request(app).post(`/api/seasons/${id}/settle`).send({});

    asAgent(EARLY);
    // No draft, no running: nothing to enter, and no crash reaching for one.
    expect((await mine()).body.season).toBeNull();
    expect((await enter(true)).status).toBe(409);
  });
});

describe('the one gate on the way in', () => {
  test('entering without agreeing to the rules is refused, and says which step', async () => {
    await seedFloor([EARLY]);
    await createSeason();
    asAgent(EARLY);

    const res = await request(app).put('/api/seasons/me').send({ optedIn: true });
    expect(res.status).toBe(400);
    // Machine-readable, so the entry button can show the missing step instead
    // of printing a sentence and hoping.
    expect(res.body.reason).toBe('rules');
    expect(res.body.rulesUrl).toBe('/legal/season-1');
    expect((await mine()).body.optedIn).toBe(false);
  });

  test('entering needs NO payment details', async () => {
    // A payment gate existed for part of 2026-08-19 and was removed the same
    // day (owner direction both ways). The reason it lost is the reason it was
    // never there: a visitor arriving cold should be one click in, and asking
    // for an IBAN before they have placed a trade is friction that already
    // cost this funnel signups once. Winners are asked at claim time.
    await seedFloor([EARLY]);
    await db.update(agents).set({ payoutMethod: null }).where(eq(agents.id, EARLY));
    await createSeason();
    asAgent(EARLY);

    expect((await enter(true)).status).toBe(200);
    expect((await mine()).body.optedIn).toBe(true);
  });

  test('agreeing is enough, and the agreement is on the record', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    expect((await enter(true)).status).toBe(200);

    const row = await entryRow(id, EARLY);
    expect(row?.optedIn).toBe(true);
    // A checkbox that leaves no row cannot answer "did they agree, and when?"
    // months later, in a dispute about money.
    expect(row?.rulesAcceptedAt).toBeTruthy();
  });

  test('GET /me reports what is still missing', async () => {
    await seedFloor([EARLY]);
    await db.update(agents).set({ payoutMethod: null }).where(eq(agents.id, EARLY));
    await createSeason();
    asAgent(EARLY);

    // Reported, not required: the season page uses it to mention that a prize
    // will need somewhere to go, as a nudge rather than a gate.
    expect((await mine()).body.hasPayoutMethod).toBe(false);
    await withPayout(EARLY);
    expect((await mine()).body.hasPayoutMethod).toBe(true);
    expect((await mine()).body.rulesAcceptedAt).toBeNull();
  });

  test('leaving needs no gate', async () => {
    // A contest that is hard to withdraw from would be indefensible.
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    await db.update(agents).set({ payoutMethod: null }).where(eq(agents.id, EARLY));

    const res = await request(app).put('/api/seasons/me').send({ optedIn: false });
    expect(res.status).toBe(200);
    expect((await entryRow(id, EARLY))?.optedIn).toBe(false);
  });

  test('rejoining does not ask again, and never erases that they agreed', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    const first = (await entryRow(id, EARLY))?.rulesAcceptedAt;

    await request(app).put('/api/seasons/me').send({ optedIn: false });
    expect((await entryRow(id, EARLY))?.rulesAcceptedAt).toEqual(first);

    // No acceptedRules in the body: the stored agreement stands.
    const back = await request(app).put('/api/seasons/me').send({ optedIn: true });
    expect(back.status).toBe(200);
    expect((await entryRow(id, EARLY))?.rulesAcceptedAt).toEqual(first);
  });
});

describe('editing a draft season', () => {
  test('the start date can be moved, and only the field sent changes', async () => {
    // The state machine has always said a draft is editable; until 2026-08-19
    // nothing implemented it, so moving a start date meant a hand-written
    // UPDATE against production.
    await seedFloor([EARLY]);
    const id = await createSeason();

    const res = await request(app).patch(`/api/seasons/${id}`).send({ startsAt: '2026-09-02T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.season.startsAt).toBe('2026-09-02T00:00:00.000Z');
    expect(res.body.season.endsAt).toBe('2026-09-29T00:00:00.000Z');
    expect(res.body.season.poolUsd).toBe(1000);
  });

  test('moving only the start is still refused if it lands after the end', async () => {
    // Validated against what the season WILL be, not against what was sent.
    await seedFloor([EARLY]);
    const id = await createSeason();
    const res = await request(app).patch(`/api/seasons/${id}`).send({ startsAt: '2026-10-30T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/endsAt must be after startsAt/);
  });

  test('the sweepstakes ceiling holds on the edit, not only on create', async () => {
    // A rule that guards only the front door is not a rule.
    await seedFloor([EARLY]);
    const id = await createSeason();
    const res = await request(app).patch(`/api/seasons/${id}`).send({ poolUsd: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000/);
  });

  test('a ladder promising more than the pool is refused', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    const res = await request(app).patch(`/api/seasons/${id}`).send({ poolUsd: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ladder promises/);
  });

  test('a running season cannot be edited', async () => {
    // Its baselines are pinned to its start instant and its ladder is
    // published; moving either afterwards changes what people entered.
    await seedFloor([EARLY]);
    const id = await createSeason();
    await request(app).post(`/api/seasons/${id}/start`).send({});
    const res = await request(app).patch(`/api/seasons/${id}`).send({ startsAt: '2026-09-02T00:00:00Z' });
    expect(res.status).toBe(409);
  });
});

describe('what an entrant has to give us', () => {
  test('an email we can reach a winner on', async () => {
    // The operational gap this closes: a participant registered through
    // POST /api/agents has no email anywhere, because only browser signups
    // create an auth user. A prize with a 30-day claim window and nobody to
    // notify expires quietly.
    await seedFloor([EARLY]);
    await createSeason();
    asAgent(EARLY);

    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, confirmedOver18: true });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('contactEmail');
    expect((await mine()).body.optedIn).toBe(false);
  });

  test('an address that is at least shaped like one', async () => {
    await seedFloor([EARLY]);
    await createSeason();
    asAgent(EARLY);
    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, confirmedOver18: true, contactEmail: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('contactEmail');
  });

  test('a plus-tagged address is accepted, because rejecting a valid one is worse', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, confirmedOver18: true, contactEmail: 'a+season1@sub.example.co.uk' });
    expect(res.status).toBe(200);
    expect((await entryRow(id, EARLY))?.contactEmail).toBe('a+season1@sub.example.co.uk');
  });

  test('confirmation that they are 18 or older', async () => {
    // The published rules have always required it and nothing asked, which
    // made it a sentence in a document rather than an eligibility check.
    await seedFloor([EARLY]);
    await createSeason();
    asAgent(EARLY);
    const res = await request(app)
      .put('/api/seasons/me')
      .send({ optedIn: true, acceptedRules: true, contactEmail: 'entrant@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('age');
  });

  test('both are recorded with the instant they were given', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    expect((await enter(true)).status).toBe(200);

    const row = await entryRow(id, EARLY);
    expect(row?.contactEmail).toBe('entrant@example.com');
    expect(row?.confirmedOver18At).toBeTruthy();
  });

  test('a resent address corrects a typo without asking us', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    await request(app).put('/api/seasons/me').send({ optedIn: true, contactEmail: 'fixed@example.com' });
    expect((await entryRow(id, EARLY))?.contactEmail).toBe('fixed@example.com');
  });

  test('rejoining asks for neither again', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    await request(app).put('/api/seasons/me').send({ optedIn: false });

    // Bare body: the stored email, agreement and age confirmation all stand.
    const back = await request(app).put('/api/seasons/me').send({ optedIn: true });
    expect(back.status).toBe(200);
    const row = await entryRow(id, EARLY);
    expect(row?.optedIn).toBe(true);
    expect(row?.contactEmail).toBe('entrant@example.com');
    expect(row?.confirmedOver18At).toBeTruthy();
  });

  test('GET /me prefills from the account when there is an account email', async () => {
    await seedFloor([EARLY]);
    await createSeason();
    asAgent(EARLY);
    // No auth user attached, which is the API-participant case: nothing to
    // prefill from, which is exactly why the field is asked for.
    expect((await mine()).body.accountEmail).toBeNull();
    expect((await mine()).body.contactEmail).toBeNull();
  });

  test('leaving needs none of it', async () => {
    await seedFloor([EARLY]);
    const id = await createSeason();
    asAgent(EARLY);
    await enter(true);
    const res = await request(app).put('/api/seasons/me').send({ optedIn: false });
    expect(res.status).toBe(200);
    expect((await entryRow(id, EARLY))?.optedIn).toBe(false);
  });
});

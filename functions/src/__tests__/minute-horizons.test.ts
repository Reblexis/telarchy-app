/**
 * Minute-sized periods and rolling minute horizons (docs/vision.md, "Date
 * granularity"; docs/guides/time-preference.md, "+Nmin"). Owner ask
 * 2026-09-10 for the Snake floor: "it should have 3 time horizons 1. 1 minute
 * - length in 1 move 2. 5 minutes = length in 5 moves 3. 60 minutes - length
 * in 60 moves".
 *
 *  - the refresh opens one book per rolling minute horizon and retires the
 *    cells that have passed, exactly as it does for days
 *  - a forced refresh by a manager is never held by the five-minute cooldown
 *  - a minute cell settles on the last reading inside its minute; a reading
 *    one second past it belongs to the next cell
 *  - a proposal with a one-minute decision window gets a pair on every cell
 *    whose period ends after the deadline, +1min included
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  notifyOwner: async () => {},
  sendEmail: async () => true,
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metricLogs, metrics, positions, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant, periodStartInstant, toAbsoluteDate } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { proposalsRouter } from '../routes/proposals';
import { refreshRelativeDateMarkets } from '../services/markets';
import { resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message, code: (err as AppError).code });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-snake';
const OWNER = 'agent-snake-owner';
const PROPOSER = 'agent-snake-proposer';
const TRADER = 'agent-snake-trader';
const METRIC = 'metric-snake-length';
const HORIZONS = ['+1min', '+5min', '+60min'];
const MIN = 60_000;

async function seed(opts: { horizons?: string[] | null } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-snake-owner', balance: toUnits(10_000) },
    { id: PROPOSER, apiKeyHash: 'h-snake-proposer', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-snake-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Snake',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.update(workspaces).set({ decisionMinutes: 1 }).where(eq(workspaces.id, WS));
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Snake length',
    value: 3,
    formula: '0',
    marketRangeMax: 100,
    timePreference:
      opts.horizons === null ? null : { enabled: false, halfLife: 1, customHorizons: opts.horizons ?? HORIZONS },
  });
}

const marketsOf = async () =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, METRIC)));
const baselines = async () => (await marketsOf()).filter(m => !m.proposalId);
const cellsNow = (at = new Date()) => HORIZONS.map(h => toAbsoluteDate(h, at));
const marketRow = async (id: string) => (await db.select().from(markets).where(eq(markets.id, id)))[0];

const refresh = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/markets/refresh')
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

describe('THE REFRESH OPENS ONE BOOK PER ROLLING MINUTE HORIZON', () => {
  test('["+1min","+5min","+60min"] open three minute cells', async () => {
    await seed();
    const before = new Date();
    const { created } = await refreshRelativeDateMarkets(WS, { force: true });
    const after = new Date();
    expect(created).toBe(3);

    const rows = await baselines();
    const dates = rows.map(r => r.targetDate).sort();
    // The run's base instant is somewhere between before and after; both
    // readings of "the next minute" are accepted only when the test straddles
    // a minute boundary, which is the honest shape of a rolling horizon.
    const expected = [cellsNow(before).sort(), cellsNow(after).sort()];
    expect(expected).toContainEqual(dates);
    for (const r of rows) {
      expect(r.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(r.active).toBe(true);
      expect(r.settlesAt?.toISOString()).toBe(periodEndInstant(r.targetDate).toISOString());
    }
  });

  test('a second refresh in the same minute opens nothing new', async () => {
    await seed();
    const first = await refreshRelativeDateMarkets(WS, { force: true });
    expect(first.created).toBe(3);
    const second = await refreshRelativeDateMarkets(WS, { force: true });
    // Either nothing changed, or the wall clock crossed a minute between the
    // two calls and the ladder advanced by one cell per horizon.
    expect([0, 3]).toContain(second.created);
    if (second.created === 0) expect((await baselines()).length).toBe(3);
  });

  test('THE CELLS THAT HAVE PASSED ARE RETIRED: an untraded one is voided, a traded one is left to settle', async () => {
    await seed();
    const ago = new Date(Date.now() - 5 * MIN);
    const passedUntraded = toAbsoluteDate('+1min', ago);
    const passedTraded = toAbsoluteDate('+2min', ago);
    const base = {
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Snake length',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    };
    await db.insert(markets).values({ ...base, id: 'mkt-passed-untraded', targetDate: passedUntraded });
    await db.insert(markets).values({ ...base, id: 'mkt-passed-traded', targetDate: passedTraded, tradedVolume: 25 });

    const { created, deactivated } = await refreshRelativeDateMarkets(WS, { force: true });
    expect(created).toBe(3);
    expect(deactivated).toBe(1);

    const untraded = await marketRow('mkt-passed-untraded');
    expect(untraded.voided).toBe(true);
    expect(untraded.active).toBe(false);
    const traded = await marketRow('mkt-passed-traded');
    expect(traded.voided).toBe(false);
    expect(traded.active).toBe(true);
    expect(traded.resolved).toBe(false);
  });

  test('a metric with no horizon opens no minute cell', async () => {
    await seed({ horizons: null });
    const { created } = await refreshRelativeDateMarkets(WS, { force: true });
    expect(created).toBe(0);
  });
});

describe('A FORCED REFRESH BY A MANAGER IS NEVER HELD BY THE COOLDOWN', () => {
  test('an unforced call right after a run is a no-op; a forced one runs', async () => {
    await seed();
    expect((await refresh({})).body.created).toBe(3);
    // Take the ladder away so a run that actually executes has visible work.
    await db.delete(markets).where(eq(markets.workspaceId, WS));

    const held = await refresh({});
    expect(held.status).toBe(200);
    expect(held.body.created).toBe(0);
    expect((await baselines()).length).toBe(0);

    const forced = await refresh({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.created).toBe(3);
    expect((await baselines()).length).toBe(3);
  });

  test('two forced calls back to back both run', async () => {
    await seed();
    expect((await refresh({ force: true })).body.created).toBe(3);
    await db.delete(markets).where(eq(markets.workspaceId, WS));
    expect((await refresh({ force: true })).body.created).toBe(3);
  });
});

describe('A MINUTE CELL SETTLES ON THE LAST READING INSIDE ITS MINUTE', () => {
  // A minute long past: its give-up grace (a day) has run out.
  const OLD_CELL = '2020-03-04T20:05';
  // A minute that ended a few minutes ago: over, but well inside the grace.
  const RECENT_CELL = toAbsoluteDate('+1min', new Date(Date.now() - 5 * MIN));
  const MARKET = 'mkt-snake-cell';
  const B = 100;

  async function seedCell(cell: string) {
    await seed({ horizons: null });
    await db.insert(markets).values({
      id: MARKET,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Snake length',
      targetDate: cell,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 50],
      liquidity: B,
      pool: initialPool(B) + 50,
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
    await db.insert(positions).values({
      id: `${TRADER}_${MARKET}_higher`,
      workspaceId: WS,
      marketId: MARKET,
      agentId: TRADER,
      direction: 'higher',
      shares: 50,
      totalCost: 30,
    });
    await db.insert(trades).values({
      id: 'trade-snake',
      workspaceId: WS,
      marketId: MARKET,
      agentId: TRADER,
      direction: 'higher',
      shares: 50,
      cost: 30,
      createdAt: new Date(periodStartInstant(cell).getTime() - 1000),
    });
  }
  const reading = (id: string, value: number, at: Date) =>
    db
      .insert(metricLogs)
      .values({ id, workspaceId: WS, metricId: METRIC, metricName: 'Snake length', value, timestamp: at });

  test('two readings inside the minute: the later one is the fixing', async () => {
    await seedCell(RECENT_CELL);
    const start = periodStartInstant(RECENT_CELL);
    await reading('log-a', 7, new Date(start.getTime() + 10_000));
    await reading('log-b', 9, new Date(start.getTime() + 50_000));
    await resolvePredictions(undefined, WS);
    const m = await marketRow(MARKET);
    expect(m.resolved).toBe(true);
    expect(m.voided).toBe(false);
    expect(m.actualValue).toBe(9);
    expect(m.settledReadingAt?.toISOString()).toBe(new Date(start.getTime() + 50_000).toISOString());
  });

  test('A READING ONE SECOND PAST THE MINUTE DOES NOT SETTLE IT: the cell waits for its own reading', async () => {
    await seedCell(RECENT_CELL);
    await reading('log-late', 12, new Date(periodEndInstant(RECENT_CELL).getTime() + 1000));
    await resolvePredictions(undefined, WS);
    const m = await marketRow(MARKET);
    expect(m.resolved).toBe(false);
    expect(m.voided).toBe(false);
    expect(m.actualValue).toBeNull();
  });

  test('a reading one second before the minute belongs to the previous cell', async () => {
    await seedCell(RECENT_CELL);
    await reading('log-early', 12, new Date(periodStartInstant(RECENT_CELL).getTime() - 1000));
    await resolvePredictions(undefined, WS);
    const m = await marketRow(MARKET);
    expect(m.resolved).toBe(false);
    expect(m.actualValue).toBeNull();
  });

  test('with no reading the cell voids after the give-up grace and refunds', async () => {
    await seedCell(OLD_CELL);
    // Readings outside the minute do not count, and the grace has long run out.
    await reading('log-late', 12, new Date(periodEndInstant(OLD_CELL).getTime() + 1000));
    await resolvePredictions(undefined, WS);
    const m = await marketRow(MARKET);
    expect(m.voided).toBe(true);
    expect(m.actualValue).toBeNull();
    const [t] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(fromUnits(t.balance as number)).toBe(1000 + 30);
  });
});

describe('A ONE-MINUTE DECISION WINDOW STILL GETS A PAIR ON +1min, +5min AND +60min', () => {
  test('every cell whose period ends after the deadline gets both branches', async () => {
    await seed();
    await refreshRelativeDateMarkets(WS, { force: true });
    const before = await baselines();
    expect(before.length).toBe(3);

    const res = await request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', PROPOSER)
      .set('X-Workspace-Id', WS)
      .send({ title: 'turn left', description: '', liquiditySubsidy: 30 });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(proposals).where(eq(proposals.id, res.body.id));
    const decideBy = new Date(row.decideBy!).getTime();
    expect(decideBy).toBeLessThanOrEqual(Date.now() + MIN + 5000);

    const pairs = (await marketsOf()).filter(m => m.proposalId === res.body.id);
    const qualifying = before.filter(b => periodEndInstant(b.targetDate).getTime() > decideBy);
    // +1min ends at least one second after a one-minute window that opened
    // inside the current minute, so all three cells qualify.
    expect(qualifying.map(b => b.targetDate).sort()).toEqual(before.map(b => b.targetDate).sort());
    expect(pairs.length).toBe(6);
    for (const b of before) {
      const branches = pairs
        .filter(p => p.targetDate === b.targetDate)
        .map(p => p.branch)
        .sort();
      expect(branches).toEqual(['approved', 'declined']);
    }
  });
});

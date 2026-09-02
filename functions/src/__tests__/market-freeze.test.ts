/**
 * What an owner cannot destroy.
 *
 * Two rules, matched to what each path takes from people (owner decision
 * 2026-08-18, docs/market-integrity.md):
 *
 *   void a market / delete a metric   refused once ANYONE has traded it,
 *                                     season or not. Voiding takes money off
 *                                     participants who chose to put it there.
 *
 *   delete a workspace                refused while a prize season that scores
 *                                     it is running. Outside one it is fine:
 *                                     deletion already voids and refunds every
 *                                     open position on the way out, so the
 *                                     venue closes but nothing is taken.
 *
 * The guards sit at the route layer on purpose. Six of `voidMarket`'s nine
 * callers are the engine's own lifecycle (stale conditional cleanup, a
 * proposal being decided or removed, an unapproved conditional reaching its
 * settle instant); freezing those would stop the clock rather than protect
 * anyone, so this file pins that they still work.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, events, markets, metrics, prizeSeasons, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { metricsRouter } from '../routes/metrics';
import { predictionsRouter } from '../routes/predictions';
import { workspacesRouter } from '../routes/workspaces';
import { voidMarket } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-freeze';
const OWNER = 'agent-freeze-owner';
const TRADER = 'agent-freeze-trader';
const METRIC = 'metric-freeze';
const TRADED = 'market-freeze-traded';
const UNTRADED = 'market-freeze-untraded';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: OWNER,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/workspaces', workspacesRouter);
// Mirrors the production handler in app.ts, including the `extra` spread:
// a test that flattens the error shape cannot assert the proposal a caller
// actually sees.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-freeze-owner', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-freeze-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Freeze Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values(
    [TRADED, UNTRADED].map((id, i) => ({
      id,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Throughput',
      targetDate: `202${8 + i}`,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    })),
  );
}

const buy = (marketId: string) =>
  request(app)
    .post('/api/predictions/trade')
    .set('Content-Type', 'application/json')
    .send({ marketId, direction: 'higher', amount: 20 });

async function startSeason() {
  await db.insert(prizeSeasons).values({
    id: 'season-1',
    name: 'Season 1',
    startsAt: new Date('2026-08-01'),
    endsAt: new Date('2026-12-31'),
    poolUsd: 1000,
    ladder: [{ place: 1, prizeUsd: 1000 }],
    workspaceIds: [WS],
    rulesUrl: 'https://telarchy.com/legal/season-1',
    status: 'running',
  });
}

async function isVoided(id: string): Promise<boolean> {
  const [row] = await db.select().from(markets).where(eq(markets.id, id));
  return !!row?.voided;
}

describe('voiding a traded market is refused', () => {
  test('the void endpoint refuses once anyone has traded', async () => {
    await seed();
    expect((await buy(TRADED)).status).toBe(201);

    const res = await request(app).post(`/api/predictions/markets/${TRADED}/void`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/traded by 1 participant/);
    expect(await isVoided(TRADED)).toBe(false);
  });

  test('an untraded market can still be voided', async () => {
    await seed();
    // Nobody is harmed, and a mis-created market has to be removable or the
    // guard becomes a reason not to create markets.
    const res = await request(app).post(`/api/predictions/markets/${UNTRADED}/void`).send({});
    expect(res.status).toBe(200);
    expect(await isVoided(UNTRADED)).toBe(true);
  });

  test('the refusal counts distinct participants, not trades', async () => {
    await seed();
    await buy(TRADED);
    await buy(TRADED);
    const res = await request(app).post(`/api/predictions/markets/${TRADED}/void`).send({});
    expect(res.body.traders).toBe(1);
  });
});

describe('deleting a metric under a traded market is refused', () => {
  test('the delete refuses, and the metric survives', async () => {
    await seed();
    expect((await buy(TRADED)).status).toBe(201);

    const res = await request(app).delete(`/api/metrics/${METRIC}`).send({});
    expect(res.status).toBe(409);

    // Deleting responds 204 before voiding, so a guard that ran too late would
    // leave the metric gone and the markets voided anyway.
    const [row] = await db.select().from(metrics).where(eq(metrics.id, METRIC));
    expect(row).toBeDefined();
    expect(await isVoided(TRADED)).toBe(false);
  });

  test('with nothing traded the delete goes through', async () => {
    await seed();
    await db.delete(markets).where(eq(markets.id, TRADED));
    const res = await request(app).delete(`/api/metrics/${METRIC}`).send({});
    expect(res.status).toBe(204);
  });
});

describe('deleting a workspace inside a running season is refused', () => {
  test('a running season that scores this workspace blocks it', async () => {
    await seed();
    await startSeason();

    const res = await request(app).delete(`/api/workspaces/${WS}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Season 1/);
  });

  test('a settled season does not', async () => {
    await seed();
    await startSeason();
    await db.update(prizeSeasons).set({ status: 'settled' }).where(eq(prizeSeasons.id, 'season-1'));

    expect((await request(app).delete(`/api/workspaces/${WS}`).send({})).status).toBe(200);
  });

  test('a running season that does not name this workspace does not', async () => {
    await seed();
    await startSeason();
    // workspaceIds is pinned at season start on purpose; membership is read
    // from it rather than from visibility, so a workspace outside the list is
    // outside the freeze however it is configured.
    await db
      .update(prizeSeasons)
      .set({ workspaceIds: ['some-other-ws'] })
      .where(eq(prizeSeasons.id, 'season-1'));

    expect((await request(app).delete(`/api/workspaces/${WS}`).send({})).status).toBe(200);
  });
});

describe('the engine still voids what it must', () => {
  test('voidMarket itself is not frozen, even on a traded market', async () => {
    await seed();
    expect((await buy(TRADED)).status).toBe(201);

    // Stale conditionals, decided proposals and unapproved pairs at their
    // settle instant all reach voidMarket directly. Freezing the function
    // rather than the routes would stop the clock instead of protecting a
    // trader, and would strand those markets open forever.
    const result = await voidMarket(TRADED, WS);
    expect(result.refunded).toBeGreaterThan(0);
    expect(await isVoided(TRADED)).toBe(true);
  });

  test('a refunded void still leaves the trade on the record', async () => {
    await seed();
    await buy(TRADED);
    await voidMarket(TRADED, WS);
    const rows = await db.select().from(trades).where(eq(trades.marketId, TRADED));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('the deliberate way through', () => {
  test('acknowledging the holders and saying why lets the void happen', async () => {
    // A guard with no sanctioned escape gets routed around with a hand-written
    // UPDATE, and then the destruction happens with no record at all. This is
    // the escape: explicit, and it has to say why.
    await seed();
    expect((await buy(TRADED)).status).toBe(201);

    const res = await request(app)
      .post(`/api/predictions/markets/${TRADED}/void`)
      .send({ acknowledgeTraded: true, reason: 'Re-dating the floor to a horizon inside the season.' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toMatch(/Re-dating/);
    expect(await isVoided(TRADED)).toBe(true);
  });

  test('acknowledging without a reason is refused', async () => {
    // The season rules promise a void during a season is announced rather than
    // done quietly. A promise nothing records is not a promise.
    await seed();
    await buy(TRADED);
    const res = await request(app)
      .post(`/api/predictions/markets/${TRADED}/void`)
      .send({ acknowledgeTraded: true, reason: 'oops' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('reasonRequired');
    expect(await isVoided(TRADED)).toBe(false);
  });

  test('the reason is published with the void, not just returned to the caller', async () => {
    await seed();
    await buy(TRADED);
    const why = 'Declared error in the settlement definition.';
    await request(app).post(`/api/predictions/markets/${TRADED}/void`).send({ acknowledgeTraded: true, reason: why });

    const rows = await db.select().from(events).where(eq(events.workspaceId, WS));
    const voided = rows.filter(e => e.type === 'market:resolved');
    expect(voided.length).toBeGreaterThan(0);
    expect(JSON.stringify(voided.map(e => e.data))).toContain(why);
  });

  test('the refund still happens: nobody is left out of pocket', async () => {
    await seed();
    await buy(TRADED);
    const res = await request(app)
      .post(`/api/predictions/markets/${TRADED}/void`)
      .send({ acknowledgeTraded: true, reason: 'Re-dating the floor to a horizon inside the season.' });
    expect(res.body.refundedPositions).toBeGreaterThan(0);
  });

  test('the default path is still refused, so the escape has to be asked for', async () => {
    await seed();
    await buy(TRADED);
    const res = await request(app).post(`/api/predictions/markets/${TRADED}/void`).send({});
    expect(res.status).toBe(409);
    expect(await isVoided(TRADED)).toBe(false);
  });
});

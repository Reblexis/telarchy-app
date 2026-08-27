/**
 * The owner's v1 flow, end to end, with the EXACT payloads the dialogs send
 * (docs/owner-on-the-floor.md, "The v1 controls"). The component tests prove
 * the dialogs send what they mean; this proves the server does what the
 * dialogs promise. The gap between those two is where the 2026-08-27
 * "Internal error" lived: the client and the routes each looked right alone.
 *
 * Walked in order, one workspace, like the owner would:
 *   1. Create a metric from a name and a description alone. No market may
 *      exist afterwards: omitting timePreference used to default the decay
 *      curve ON, opening markets before the owner ever picked a date.
 *   2. Add a date with the one PUT the dialog sends (a rolling +0w entry and
 *      the liquidity as the metric's own). The market must exist afterwards,
 *      funded at exactly that number, debited from the owner.
 *   3. Inject liquidity. The pool must grow by exactly the amount.
 *   4. Fix the defaulted range while the market is untraded: void-respawn
 *      keeps the flow's two-field metric from being a trap.
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

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { metricsRouter } from '../routes/metrics';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-v1flow';
const OWNER = 'agent-v1flow-owner';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: OWNER,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/predictions', predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-v1flow', balance: toUnits(100000) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'V1 Flow',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db
    .update(workspaces)
    .set({ autoFundNewMarkets: true, newMarketLiquidityCredits: 1000 })
    .where(eq(workspaces.id, WS));
});

/** Exactly what api.createMetricIn sends. Keep in sync with src/lib/api.ts. */
const DIALOG1_BODY = {
  name: 'Steam wishlists',
  description: 'Total outstanding wishlists, deletions netted out.',
  value: 0,
  formula: '',
  timePreference: null,
};

/** Exactly what the add-date dialog sends. Keep in sync with OwnerDialogs. */
const dialog2Body = (existing: string[]) => ({
  liquidityCredits: 2400,
  timePreference: { enabled: false, halfLife: 1, customHorizons: [...existing, '+0w'] },
});

const openMarkets = () =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.resolved, false)));

describe('the v1 flow, in order', () => {
  test('walks from two fields to a funded market to a deeper one', async () => {
    // 1. New metric: name and description alone open NO market.
    const created = await request(app).post('/api/metrics').send(DIALOG1_BODY).expect(201);
    const metricId = created.body.id as string;
    expect(metricId).toBeTruthy();
    expect(await openMarkets()).toHaveLength(0);

    // 2. Add a date: one PUT, and the market exists funded at the number.
    await request(app).put(`/api/metrics/${metricId}`).send(dialog2Body([])).expect(200);
    const afterDate = await openMarkets();
    expect(afterDate).toHaveLength(1);
    expect(afterDate[0].metricId).toBe(metricId);
    expect(afterDate[0].targetDate).toMatch(/^\d{4}-W\d{2}$/);
    expect(afterDate[0].pool).toBeCloseTo(2400, 5);
    // Funded means paid for: the owner's balance moved.
    const [ag] = await db.select().from(agents).where(eq(agents.id, OWNER));
    expect(Number(ag.balance)).toBe(toUnits(100000 - 2400));

    // 3. Inject liquidity: the pool grows by exactly the amount.
    await request(app).post(`/api/predictions/markets/${afterDate[0].id}/liquidity`).send({ amount: 600 }).expect(200);
    const [deepened] = await db.select().from(markets).where(eq(markets.id, afterDate[0].id));
    expect(deepened.pool).toBeCloseTo(3000, 5);

    // 4. The defaulted range is not a trap: while untraded, fixing it voids
    //    and respawns the market at the new machinery.
    expect(afterDate[0].rangeMax).toBe(1000);
    await request(app).put(`/api/metrics/${metricId}`).send({ marketRangeMax: 200000 }).expect(200);
    const respawned = await openMarkets();
    expect(respawned).toHaveLength(1);
    expect(respawned[0].id).not.toBe(afterDate[0].id);
    expect(respawned[0].rangeMax).toBe(200000);
    expect(respawned[0].targetDate).toBe(afterDate[0].targetDate);
  });

  test('the rolling entry survives a second date from the same dialog', async () => {
    const created = await request(app).post('/api/metrics').send(DIALOG1_BODY).expect(201);
    const metricId = created.body.id as string;
    await request(app).put(`/api/metrics/${metricId}`).send(dialog2Body([])).expect(200);

    // + date again, typed absolute this time, appended to the stored list the
    // way the dialog reads it back first.
    await request(app)
      .put(`/api/metrics/${metricId}`)
      .send({
        liquidityCredits: 2400,
        timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0w', '2026-12'] },
      })
      .expect(200);
    const open = await openMarkets();
    expect(open).toHaveLength(2);
    expect(open.map(m => m.targetDate).sort()).toEqual([expect.stringMatching(/^\d{4}-W\d{2}$/), '2026-12'].sort());
  });
});

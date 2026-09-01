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
  // The workspaces routes also import this from here. Delegate to the REAL
  // membership lookup in lib/participants (the middleware itself only
  // forwards to it), so the "find your floor" half of this spec runs the
  // real query instead of a stub. requireActual on the middleware would drag
  // in better-auth's ESM, which jest cannot load.
  getAuthWorkspaceMemberships: async (authInfo: { uid?: string; agentId?: string }) => {
    const participants = jest.requireActual('../lib/participants');
    if (authInfo.uid) return participants.getUserWorkspaceMemberships(authInfo.uid);
    if (authInfo.agentId) return participants.getAgentWorkspaceMemberships?.(authInfo.agentId) ?? [];
    return [];
  },
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics as metricsTable, workspaces } from '../db/schema';
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

  // What the report dialog now sends when the metric is untraded (owner
  // walkthrough, 2026-08-30): the reading and a wider range in ONE request,
  // because a number outside the band would otherwise settle at the top of it.
  test('a reading and a wider range travel together, and the market respawns around both', async () => {
    const created = await request(app).post('/api/metrics').send(DIALOG1_BODY).expect(201);
    const metricId = created.body.id as string;
    await request(app).put(`/api/metrics/${metricId}`).send(dialog2Body([])).expect(200);
    const before = await openMarkets();
    expect(before[0].rangeMax).toBe(1000);

    await request(app)
      .put(`/api/metrics/${metricId}`)
      .send({ value: 4200, oldValue: 0, updateNote: 'August roast log', marketRangeMax: 8400 })
      .expect(200);

    const after = await openMarkets();
    expect(after).toHaveLength(1);
    expect(after[0].rangeMax).toBe(8400);
    const [m] = await db.select().from(metricsTable).where(eq(metricsTable.id, metricId));
    expect(Number(m.value)).toBe(4200);
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

    // An hour entry (day + UTC hour from the picker) opens an hour market.
    await request(app)
      .put(`/api/metrics/${metricId}`)
      .send({
        liquidityCredits: 2400,
        timePreference: { enabled: false, halfLife: 1, customHorizons: ['+0w', '2026-12', '2026-12-31T18'] },
      })
      .expect(200);
    const withHour = await openMarkets();
    expect(withHour.map(m => m.targetDate)).toContain('2026-12-31T18');
  });
});

/** A workspaces-router app whose caller manages the given workspace. */
function mkSettingsApp(uid: string, workspaceId: string) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as any).auth = {
      agentId: null,
      uid,
      workspaceId,
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
      isMasterKey: false,
    };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  a.use('/api/workspaces', require('../routes/workspaces').workspacesRouter);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a.use((err: Error, _req: any, res: any, _next: any) => {
    res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
  });
  return a;
}

describe('from zero: create the floor itself, then find it', () => {
  test('a browser identity creates a floor and its id resolves where the app lands', async () => {
    const { workspacesRouter } = await import('../routes/workspaces');
    const { resolvePublicWorkspace } = await import('../routes/marketplace');
    const app2 = express();
    app2.use(express.json());
    app2.use((req, _res, next) => {
      (req as any).auth = {
        agentId: null,
        uid: 'user-creator',
        workspaceId: null,
        capabilities: new Set(['read']),
        isMasterKey: false,
      };
      next();
    });
    app2.use('/api/workspaces', workspacesRouter);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app2.use((err: Error, _req: any, res: any, _next: any) => {
      res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
    });

    // Exactly what the create dialog sends.
    const created = await request(app2).post('/api/workspaces').send({ name: 'Meridian' }).expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.visibility).toBe('unlisted');

    // The app lands on /marketplace/{id}; that lookup must resolve.
    const byId = await resolvePublicWorkspace(created.body.id);
    expect(byId?.id).toBe(created.body.id);

    // And the reason it lands by id, pinned: the same owner creating the same
    // name again gets a deduped slug, but a DIFFERENT owner's unlisted floor
    // with the same slug makes the bare slug ambiguous, which resolves to
    // NONE. Landing by slug would 404 the fresh owner (owner report
    // 2026-08-28: "There is no market at this address").
    const app3 = express();
    app3.use(express.json());
    app3.use((req, _res, next) => {
      (req as any).auth = {
        agentId: null,
        uid: 'user-other',
        workspaceId: null,
        capabilities: new Set(['read']),
        isMasterKey: false,
      };
      next();
    });
    app3.use('/api/workspaces', workspacesRouter);
    const second = await request(app3).post('/api/workspaces').send({ name: 'Meridian' }).expect(201);
    expect(second.body.id).not.toBe(created.body.id);

    const bySlug = await resolvePublicWorkspace(created.body.slug ?? 'meridian');
    expect(bySlug).toBeUndefined();
    expect(await resolvePublicWorkspace(created.body.id)).toBeTruthy();
    expect(await resolvePublicWorkspace(second.body.id)).toBeTruthy();

    // A PRIVATE floor still answers its own owner at the marketplace door
    // and keeps refusing strangers (owner report 2026-08-28: clicking your
    // own card answered 403).
    const marketplaceMod = await import('../routes/marketplace');
    const mkApp = (auth: object | null) => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).auth = auth;
        next();
      });
      a.use('/api/marketplace', marketplaceMod.marketplaceRouter);
      return a;
    };
    const priv = await request(app2).post('/api/workspaces').send({ name: 'Quiet', visibility: 'private' }).expect(201);
    await request(mkApp({ uid: 'user-creator', agentId: null }))
      .get(`/api/marketplace/${priv.body.id}`)
      .expect(200);
    await request(mkApp({ uid: 'user-other', agentId: null }))
      .get(`/api/marketplace/${priv.body.id}`)
      .expect(403);
    await request(mkApp(null)).get(`/api/marketplace/${priv.body.id}`).expect(403);

    // Publishing is gated on the first metric (owner ask 2026-08-28). The
    // fresh floor has none, so the flip to public is refused with the reason;
    // after a metric exists it goes through.
    const wsApp = mkSettingsApp('user-creator', created.body.id);
    const refused = await request(wsApp)
      .put(`/api/workspaces/${created.body.id}/settings`)
      .send({ visibility: 'public' })
      .expect(400);
    expect(refused.body.error).toMatch(/Add a number first/);
    await db.insert(metricsTable).values({
      id: 'm-publish',
      workspaceId: created.body.id,
      name: 'A number',
      description: '',
      value: 0,
      formula: '',
      order: 0,
    });
    await request(wsApp).put(`/api/workspaces/${created.body.id}/settings`).send({ visibility: 'public' }).expect(200);

    // And the creator can FIND it: GET /api/workspaces lists the fresh floor
    // for its owner, which is what the home page's "Yours" strip draws.
    // Until 2026-08-28 an unlisted floor was invisible everywhere, its own
    // owner included ("it doesnt appear on telarchy.com/beta").
    const listed = await request(app2).get('/api/workspaces').expect(200);
    expect(listed.body.map((w: { id: string }) => w.id)).toContain(created.body.id);
    const otherList = await request(app3).get('/api/workspaces').expect(200);
    expect(otherList.body.map((w: { id: string }) => w.id)).not.toContain(created.body.id);
  });
});

describe('and then someone trades it', () => {
  test('the creator funds the market from a real balance, then both sides trade it', async () => {
    const { workspacesRouter } = await import('../routes/workspaces');
    const { predictionsRouter } = await import('../routes/predictions');
    const mk = (uid: string, workspaceId: string, caps: string[]) => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as any).auth = { agentId: uid, uid, workspaceId, capabilities: new Set(caps), isMasterKey: false };
        next();
      });
      a.use('/api/workspaces', workspacesRouter);
      a.use('/api/predictions', predictionsRouter);
      a.use('/api/metrics', metricsRouter);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      a.use((err: Error, _req: any, res: any, _next: any) => {
        res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
      });
      return a;
    };

    // The creator's agent row exists from signup (ensureParticipant), with
    // an empty balance here to reproduce the owner's exact state.
    await db.insert(agents).values({ id: 'user-creator', apiKeyHash: 'h-user-creator', balance: 0 });
    const created = await request(mk('user-creator', '', ['read']))
      .post('/api/workspaces')
      .send({ name: 'Tradeable' })
      .expect(201);
    const wsId = created.body.id as string;
    const ownerApp = mk('user-creator', wsId, ['read', 'trade', 'manage', 'manage_workspace']);
    const m = await request(ownerApp).post('/api/metrics').send(DIALOG1_BODY).expect(201);

    // A creator with NO credits is refused at the dialog, with both numbers,
    // instead of being handed an unfunded market that refuses every trade
    // (owner report 2026-08-28: "why cant i trade on it?").
    const broke = await request(ownerApp).put(`/api/metrics/${m.body.id}`).send(dialog2Body([])).expect(400);
    expect(broke.body.error).toMatch(/You hold 0 credits/);
    expect(await db.select().from(markets).where(eq(markets.workspaceId, wsId))).toHaveLength(0);

    // Funded, the same request opens a funded market.
    await db
      .update(agents)
      .set({ balance: toUnits(10000) })
      .where(eq(agents.id, 'user-creator'));
    await request(ownerApp).put(`/api/metrics/${m.body.id}`).send(dialog2Body([])).expect(200);
    const [mkt] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, wsId), eq(markets.resolved, false)));
    expect(mkt.pool).toBeCloseTo(2400, 5);

    // A floor is CREATED unlisted, and nothing trades on a floor that is not
    // published (docs/guides/creating.md, owner decision 2026-09-01). So the
    // owner meets "why cant i trade on it?" a second way, and the answer is
    // publish rather than fund. Pinned here because this suite is the owner's
    // actual journey and that is now a step in it.
    const beforePublish = await request(ownerApp)
      .post('/api/predictions/trade')
      .send({ marketId: mkt.id, direction: 'higher', amount: 50 })
      .expect(400);
    expect(beforePublish.body.error).toMatch(/not public/i);

    await request(ownerApp).put(`/api/workspaces/${wsId}/settings`).send({ visibility: 'public' }).expect(200);

    // The owner trades their own market...
    await request(ownerApp)
      .post('/api/predictions/trade')
      .send({ marketId: mkt.id, direction: 'higher', amount: 50 })
      .expect(201);
    // ...and so does a joined stranger with the trade capability.
    await db.insert(agents).values({ id: 'stranger-1', apiKeyHash: 'h-stranger', balance: toUnits(1000) });
    await request(mk('stranger-1', wsId, ['read', 'trade']))
      .post('/api/predictions/trade')
      .send({ marketId: mkt.id, direction: 'lower', amount: 50 })
      .expect(201);
  });
});

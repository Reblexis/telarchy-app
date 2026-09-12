/**
 * GET /api/marketplace/:workspaceId/prices (docs/guides/agent-api.md,
 * "Prices, once a second"; docs/infra/deploy.md, "Prices, one channel across
 * instances").
 *
 * Owner ask, 2026-09-12: "make sure the price refreshes at least once per
 * second ... do it efficinetly tho". The floor polls this once a second per
 * viewer, on a service where an /admin tab polling a heavy endpoint once took
 * the site down. So the properties pinned here are costs as much as answers:
 * an unchanged floor costs no query, a changed one costs exactly one however
 * many viewers arrive, and without the channel an answer is trusted for at
 * most a second.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { provisionWorkspace } from '../lib/participants';
import { setPriceTransport } from '../lib/price-channel';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { predictionsRouter } from '../routes/predictions';
import { voidMarket } from '../services/markets';
import { declineProposal, lapseOverdueProposals } from '../services/proposals';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use(apiErrorHandler);

const WS = 'ws-prices';
const OWNER = 'agent-prices-owner';
const TRADER = 'agent-prices-trader';

const live = { isLive: () => true, send: () => {} };

function book(over: Record<string, unknown>): typeof markets.$inferInsert {
  return {
    workspaceId: WS,
    metricId: 'metric-prices',
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
    ...over,
  } as typeof markets.$inferInsert;
}

async function seed(opts: { publicCaps?: string[]; visibility?: string } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-po', balance: toUnits(10_000) },
    { id: TRADER, apiKeyHash: 'h-pt', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Prices',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db
    .update(workspaces)
    .set({ slug: 'prices-floor', visibility: opts.visibility ?? 'public' })
    .where(eq(workspaces.id, WS));
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: opts.publicCaps ?? ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));
  await db.insert(metrics).values({
    id: 'metric-prices',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(proposals).values([
    { id: 'prop-pair', workspaceId: WS, proposedBy: OWNER, title: 'Pair', description: '', status: 'pending' },
    {
      id: 'prop-opts',
      workspaceId: WS,
      proposedBy: OWNER,
      title: 'Options',
      description: '',
      status: 'pending',
      options: [
        { id: 'forward', label: 'Forward' },
        { id: 'left', label: 'Left' },
      ],
    },
    {
      id: 'prop-decided',
      workspaceId: WS,
      proposedBy: OWNER,
      title: 'Decided',
      description: '',
      status: 'approved',
      resolvedAt: new Date(),
      closedAt: new Date(),
    },
  ]);
  await db
    .insert(markets)
    .values([
      book({ id: 'm-base', shares: [0, 10] }),
      book({ id: 'm-base-resolved', resolved: true }),
      book({ id: 'm-base-voided', voided: true, resolved: true }),
      book({ id: 'm-base-closed', active: false }),
      book({ id: 'm-pair-approved', proposalId: 'prop-pair', branch: 'approved', shares: [0, 5] }),
      book({ id: 'm-pair-declined', proposalId: 'prop-pair', branch: 'declined' }),
      book({ id: 'm-pair-voided', proposalId: 'prop-pair', branch: 'approved', targetDate: '2029', voided: true }),
      book({ id: 'm-opt-forward', proposalId: 'prop-opts', branch: 'forward' }),
      book({ id: 'm-opt-left', proposalId: 'prop-opts', branch: 'left', liquidity: 0, pool: 0 }),
      book({ id: 'm-decided-approved', proposalId: 'prop-decided', branch: 'approved' }),
    ]);
  await db.insert(trades).values([
    { id: 't-1', workspaceId: WS, agentId: TRADER, marketId: 'm-base', direction: 'higher', shares: 5, cost: 3 },
    { id: 't-2', workspaceId: WS, agentId: TRADER, marketId: 'm-base', direction: 'higher', shares: 5, cost: 3 },
  ]);
}

const poll = (idOrSlug = WS, etag?: string) => {
  const r = request(app).get(`/api/marketplace/${idOrSlug}/prices`);
  return etag ? r.set('If-None-Match', etag) : r;
};

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  setPriceTransport(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  setPriceTransport(null);
});

describe('disclosure', () => {
  test('an unknown floor is 404', async () => {
    await seed();
    const res = await poll('no-such-floor');
    expect(res.status).toBe(404);
  });

  test('a floor that is not public is 403', async () => {
    await seed({ visibility: 'private' });
    expect((await poll()).status).toBe(403);
  });

  test('a public floor whose Public group cannot read is 403', async () => {
    await seed({ publicCaps: [] });
    expect((await poll()).status).toBe(403);
  });
});

describe('the answer', () => {
  test('is every open book a viewer can trade, and nothing else', async () => {
    await seed();
    const res = await poll();
    expect(res.status).toBe(200);
    const ids = res.body.books.map((b: { marketId: string }) => b.marketId).sort();
    expect(ids).toEqual(['m-base', 'm-opt-forward', 'm-opt-left', 'm-pair-approved', 'm-pair-declined']);
  });

  test('carries consensus, probability, pool and trade count per book, and when it was read', async () => {
    await seed();
    const res = await poll();
    expect(Number.isNaN(Date.parse(res.body.asOf))).toBe(false);
    expect(typeof res.body.version).toBe('string');
    const base = res.body.books.find((b: { marketId: string }) => b.marketId === 'm-base');
    expect(Object.keys(base).sort()).toEqual(['consensus', 'marketId', 'pool', 'probability', 'tradeCount']);
    expect(base.consensus).toBeCloseTo(51.25, 2);
    expect(base.probability).toBeCloseTo(0.5125, 4);
    expect(base.pool).toBeCloseTo(initialPool(200), 6);
    expect(base.tradeCount).toBe(2);
    const unfunded = res.body.books.find((b: { marketId: string }) => b.marketId === 'm-opt-left');
    expect(unfunded.consensus).toBeNull();
  });

  test('a slug answers as well as an id', async () => {
    await seed();
    const res = await poll('prices-floor');
    expect(res.status).toBe(200);
    expect(res.body.books.length).toBe(5);
  });

  test('stays small: a few kilobytes at most', async () => {
    await seed();
    const res = await poll();
    expect(res.text.length).toBeLessThan(4000);
  });
});

describe('the ETag', () => {
  test('is the version, and a matching If-None-Match is 304 with no body', async () => {
    await seed();
    const first = await poll();
    expect(first.headers.etag).toBe(`"${first.body.version}"`);
    const again = await poll(WS, first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.text ?? '').toBe('');
  });

  test('a weak or listed If-None-Match matches too', async () => {
    await seed();
    const first = await poll();
    expect((await poll(WS, `W/${first.headers.etag}`)).status).toBe(304);
    expect((await poll(WS, `"other", ${first.headers.etag}`)).status).toBe(304);
    expect((await poll(WS, '"other"')).status).toBe(200);
  });

  test('changes when a price does', async () => {
    await seed();
    setPriceTransport(live);
    const first = await poll();
    const t = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .send({ marketId: 'm-base', direction: 'higher', amount: 10 });
    expect(t.status).toBe(201);
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(first.headers.etag);
  });
});

describe('AN UNCHANGED PRICE VERSION COSTS NO QUERY', () => {
  test('twenty polls, with and without the ETag, run zero queries while the channel is live', async () => {
    await seed();
    setPriceTransport(live);
    const first = await poll();
    expect(first.status).toBe(200);
    const log = captureQueries();
    try {
      for (let i = 0; i < 10; i++) expect((await poll()).status).toBe(200);
      for (let i = 0; i < 10; i++) expect((await poll(WS, first.headers.etag)).status).toBe(304);
    } finally {
      log.stop();
    }
    expect(log.queries).toEqual([]);
  });
});

describe('ONE TRADE FOLLOWED BY N POLLS RUNS EXACTLY ONE QUERY', () => {
  test('fifty viewers arriving together after a trade cause one read, and all see the trade', async () => {
    await seed();
    setPriceTransport(live);
    const first = await poll();
    const before = first.body.books.find((b: { marketId: string }) => b.marketId === 'm-base');
    const t = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .send({ marketId: 'm-base', direction: 'higher', amount: 10 });
    expect(t.status).toBe(201);
    await new Promise(resolve => setImmediate(resolve));

    const log = captureQueries();
    let answers: request.Response[];
    try {
      answers = await Promise.all(Array.from({ length: 50 }, () => poll(WS, first.headers.etag)));
    } finally {
      log.stop();
    }
    expect(log.queries).toHaveLength(1);
    for (const a of answers) {
      expect(a.status).toBe(200);
      const base = a.body.books.find((b: { marketId: string }) => b.marketId === 'm-base');
      expect(base.consensus).toBeGreaterThan(before.consensus);
      expect(base.tradeCount).toBe(before.tradeCount + 1);
    }
  });
});

describe('WITHOUT THE CHANNEL AN ANSWER IS TRUSTED FOR AT MOST ONE SECOND', () => {
  test('within the second no query, past it one query', async () => {
    await seed();
    let now = Date.parse('2026-09-12T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const first = await poll();
    expect(first.status).toBe(200);

    let log = captureQueries();
    now += 900;
    expect((await poll(WS, first.headers.etag)).status).toBe(304);
    log.stop();
    expect(log.queries).toEqual([]);

    log = captureQueries();
    now += 200;
    // Nothing moved, so the fresh read confirms the same ETag.
    expect((await poll(WS, first.headers.etag)).status).toBe(304);
    log.stop();
    expect(log.queries).toHaveLength(1);
  });

  test('a raw write nobody announced is visible within the second', async () => {
    await seed();
    let now = Date.parse('2026-09-12T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const first = await poll();
    await db
      .update(markets)
      .set({ shares: [0, 50] })
      .where(eq(markets.id, 'm-base'));
    now += 1100;
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
  });

  test('with the channel live, the same raw write is NOT seen: the version is the signal', async () => {
    await seed();
    setPriceTransport(live);
    let now = Date.parse('2026-09-12T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const first = await poll();
    await db
      .update(markets)
      .set({ shares: [0, 50] })
      .where(eq(markets.id, 'm-base'));
    now += 5000;
    expect((await poll(WS, first.headers.etag)).status).toBe(304);
  });
});

describe('every price-changing write moves the version', () => {
  async function primed() {
    await seed();
    setPriceTransport(live);
    const first = await poll();
    expect(first.status).toBe(200);
    return first;
  }

  test('a void', async () => {
    const first = await primed();
    await voidMarket('m-pair-declined', WS);
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.books.map((b: { marketId: string }) => b.marketId)).not.toContain('m-pair-declined');
  });

  test('a decision', async () => {
    const first = await primed();
    await declineProposal('prop-pair', WS, OWNER, 'Not now.');
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
    const ids = after.body.books.map((b: { marketId: string }) => b.marketId);
    expect(ids).not.toContain('m-pair-approved');
    expect(ids).not.toContain('m-pair-declined');
  });

  test('a lapse', async () => {
    const first = await primed();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 60_000) })
      .where(eq(proposals.id, 'prop-opts'));
    expect(await lapseOverdueProposals(WS)).toBe(1);
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.books.map((b: { marketId: string }) => b.marketId)).not.toContain('m-opt-forward');
  });

  test('a liquidity injection', async () => {
    const first = await primed();
    const res = await request(app)
      .post('/api/predictions/markets/m-opt-left/liquidity')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', WS)
      .send({ amount: 100 });
    expect(res.status).toBeLessThan(300);
    const after = await poll(WS, first.headers.etag);
    expect(after.status).toBe(200);
    const left = after.body.books.find((b: { marketId: string }) => b.marketId === 'm-opt-left');
    expect(left.pool).toBeGreaterThan(0);
  });
});

/**
 * The public ballot on GET /api/marketplace/:workspaceId.
 *
 * Disclosure rule: when a workspace's Public group grants `read`, its contents
 * are one free self-join away from any visitor, so hiding proposals behind
 * signup is friction theater, not privacy. The endpoint therefore ships the
 * ballot (pending proposals with conditional-market deltas, plus recent
 * decisions with their published decline reasons). When the Public group lacks
 * `read`, the counts-only boundary holds and no proposal content leaks.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The router imports the auth middleware (for its join route), which pulls in
// better-auth's ESM build; the endpoint under test is anonymous, so stub it.
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metricLogs, metrics, permissionGroups, proposals, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-ballot';
const OWNER = 'agent-ballot-owner';
const PROPOSER = 'agent-ballot-proposer';

async function seed(publicCaps: string[]) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-bo', balance: 0 },
    { id: PROPOSER, apiKeyHash: 'h-bp', balance: 0, nickname: 'kragnour-fan' },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Ballot Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db.update(permissionGroups).set({ capabilities: publicCaps }).where(eq(permissionGroups.id, publicGroup.id));

  await db.insert(metrics).values({
    id: 'metric-ballot',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(proposals).values([
    {
      id: 'prop-open',
      workspaceId: WS,
      proposedBy: PROPOSER,
      title: 'Ship offline mode',
      description: 'Asked by three people.',
      status: 'pending',
    },
    {
      id: 'prop-declined',
      workspaceId: WS,
      proposedBy: PROPOSER,
      title: 'Rewrite in Rust',
      description: 'why not',
      status: 'declined',
      resolvedAt: new Date(),
      declineReason: 'Costs more than 20 hours of work.',
    },
  ]);
  // Conditional pair for the pending proposal: approved priced above declined.
  await db.insert(markets).values([
    {
      id: 'mkt-appr',
      workspaceId: WS,
      metricId: 'metric-ballot',
      metricName: 'Revenue',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 10],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: 'prop-open',
      branch: 'approved',
    },
    {
      id: 'mkt-decl',
      workspaceId: WS,
      metricId: 'metric-ballot',
      metricName: 'Revenue',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: 'prop-open',
      branch: 'declined',
    },
  ]);
}

/**
 * A horizon's chart draws its metric's history as recorded.
 *
 * 2026-08-16: this briefly asserted the opposite, that each horizon filters
 * its points to the market's own target period, which fixed a weekly market
 * drawing last week's accumulation and broke every cumulative metric: "net
 * 2026" accumulates all year but its market targets 2026-12, so a year of
 * readings fell outside "its" period and the floor lost both charts. The
 * pinned behaviour is the one the floor actually needs until there is a rule
 * for where a resetting metric's current period begins.
 */
describe('horizon histories', () => {
  test("a cumulative metric keeps readings from before its market's target month", async () => {
    await seed(['read', 'trade']);
    await db.insert(markets).values({
      id: 'mkt-year',
      workspaceId: WS,
      metricId: 'metric-ballot',
      metricName: 'Revenue',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 150000,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    });
    await db.insert(metricLogs).values([
      {
        id: 'log-jan',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        value: 137,
        timestamp: new Date('2026-01-01T23:30:00Z'),
      },
      {
        id: 'log-aug',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        value: 45339,
        timestamp: new Date('2026-08-15T10:00:00Z'),
      },
    ]);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const year = (
      res.body.horizonHistories as Array<{ targetDate: string; periodStart: string; points: Array<{ value: number }> }>
    ).find(h => h.targetDate === '2026-12');
    // A whole year of trajectory, months before the market's target period.
    expect(year!.points.map(p => p.value)).toEqual([137, 45339]);
  });

  test('each horizon carries the first moment of the period it settles on', async () => {
    // The chart opens its x-axis here, so a week-long market draws the whole
    // week instead of the day and a half that happens to have readings (owner
    // direction 2026-08-16). It is an axis bound, never a filter: the year
    // below starts in December and keeps every reading from January on.
    await seed(['read', 'trade']);
    await db.insert(markets).values([
      {
        id: 'mkt-year',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-12',
        rangeMin: 0,
        rangeMax: 150000,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      },
      {
        id: 'mkt-week',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-W33',
        rangeMin: 0,
        rangeMax: 8000,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      },
    ]);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    const byDate = new Map(
      (res.body.horizonHistories as Array<{ targetDate: string; periodStart: string }>).map(h => [
        h.targetDate,
        h.periodStart,
      ]),
    );
    expect(byDate.get('2026-W33')).toBe('2026-08-10T00:00:00.000Z'); // the Monday
    expect(byDate.get('2026-12')).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('public ballot disclosure gate', () => {
  test('a pending proposal drops pairs from a retired horizon; a decided one keeps its record', async () => {
    await seed(['read', 'trade']);
    // The near horizon moved to a weekly cadence, so the old monthly pair was
    // voided. It kept printing its last delta on the ballot until 2026-08-15.
    await db.insert(markets).values([
      {
        id: 'mkt-old-appr',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-08',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 40],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: true,
        proposalId: 'prop-open',
        branch: 'approved',
      },
      {
        id: 'mkt-old-decl',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-08',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: true,
        proposalId: 'prop-open',
        branch: 'declined',
      },
      // The declined proposal's own pair, voided at decision time: this one
      // stays, because a decided proposal's markets are what was priced.
      {
        id: 'mkt-dec-appr',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2028',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 20],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: true,
        proposalId: 'prop-declined',
        branch: 'approved',
      },
    ]);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const open = res.body.proposals.find((p: { id: string }) => p.id === 'prop-open');
    expect(open.markets.map((m: { targetDate: string }) => m.targetDate)).toEqual(['2028']);
    expect(open.marketPairCount).toBe(1);
    const decided = (res.body.decided ?? []).find((p: { id: string }) => p.id === 'prop-declined');
    if (decided?.markets) expect(decided.markets.length).toBeGreaterThan(0);
  });

  test("the contractor score ignores a pending proposal's dead pairs too", async () => {
    await seed(['read', 'trade']);
    // The score is denominated in the HERO metric, which is the soonest
    // baseline market: without one there is nothing to price against and
    // every impact is null, which is how the first version of this test
    // passed against the bug it was written for.
    await db.insert(markets).values([
      {
        id: 'mkt-baseline',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2028',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      },
    ]);
    // Same zombie as above. The ballot stopped printing its delta on
    // 2026-08-15, but topContractors kept scoring it, so the Telarchy rail
    // read -48 and -108.21 for proposals whose live pairs were at zero.
    await db.insert(markets).values([
      {
        id: 'mkt-zombie-appr',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-08',
        rangeMin: 0,
        rangeMax: 100,
        shares: [400, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: true,
        proposalId: 'prop-open',
        branch: 'approved',
      },
      {
        id: 'mkt-zombie-decl',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-08',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: true,
        proposalId: 'prop-open',
        branch: 'declined',
      },
    ]);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const contractors = res.body.topContractors as Array<{ impact: number | null; pricedJobs: number }>;
    const scored = contractors.find(c => c.pricedJobs > 0);
    expect(scored).toBeDefined();
    // The live pair prices approved ABOVE declined, so the honest score is
    // positive. The zombie prices it far below, so scoring the zombie flips
    // the sign: that is the whole assertion.
    expect(scored!.impact!).toBeGreaterThan(0);
  });

  test('an Open workspace (Public group has read) ships the ballot with deltas and decline reasons', async () => {
    await seed(['read', 'trade']);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);

    // One list, not a ballot plus a separate history (owner direction
    // 2026-08-12): every job carries its own status, pending ones lead, and a
    // decided job keeps its markets so the impact that was priced for it is
    // still readable after the decision.
    expect(res.body.proposals).toHaveLength(2);
    expect(res.body.decided).toBeUndefined();

    const p = res.body.proposals[0];
    expect(p.status).toBe('pending');
    expect(p.title).toBe('Ship offline mode');
    expect(p.description).toBe('Asked by three people.');
    expect(p.proposedByName).toBe('kragnour-fan');
    expect(p.markets).toHaveLength(1);
    const pair = p.markets[0];
    expect(pair.metricName).toBe('Revenue');
    expect(pair.approvedConsensus).toBeGreaterThan(pair.declinedConsensus);
    expect(pair.delta).toBeCloseTo(pair.approvedConsensus - pair.declinedConsensus, 6);

    const decided = res.body.proposals[1];
    expect(decided.status).toBe('declined');
    expect(decided.declineReason).toBe('Costs more than 20 hours of work.');
    expect(decided.resolvedAt).toBeTruthy();
  });

  test('a removed job leaves the board entirely, and stops counting in the stats', async () => {
    await seed(['read', 'trade']);
    const before = await request(app).get(`/api/marketplace/${WS}`);
    expect(before.body.proposals).toHaveLength(2);
    const totalBefore = before.body.proposalStats.total;

    const { removeProposal } = require('../services/proposals');
    await removeProposal('prop-declined', WS, 'agent-ballot-owner');

    const after = await request(app).get(`/api/marketplace/${WS}`);
    expect(after.body.proposals.map((p: { id: string }) => p.id)).toEqual(['prop-open']);
    expect(after.body.proposalStats.total).toBe(totalBefore - 1);
    expect(after.body.proposalStats.declined).toBe(0);
  });

  test('an Open workspace ships trader context: history, provenance, pulse', async () => {
    await seed(['read', 'trade']);
    // The hero context keys off the soonest baseline market; the shared seed
    // only creates the conditional pair, so add the baseline here.
    await db.insert(markets).values({
      id: 'mkt-base',
      workspaceId: WS,
      metricId: 'metric-ballot',
      metricName: 'Revenue',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
    const { metricLogs } = require('../db/schema');
    await db.insert(metricLogs).values([
      {
        id: 'log1',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        value: 40,
        timestamp: new Date(Date.now() - 2 * 86400e3),
      },
      {
        id: 'log2',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        value: 50,
        timestamp: new Date(Date.now() - 1 * 86400e3),
      },
    ]);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    expect(res.body.heroHistory.map((h: { value: number }) => h.value)).toEqual([40, 50]);
    expect(res.body.tradesThisWeek).toBe(0);
  });

  test('a read-only-by-invitation workspace keeps the counts-only boundary', async () => {
    await seed([]);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);

    expect(res.body.proposals).toBeUndefined();
    expect(res.body.decided).toBeUndefined();
    expect(res.body.heroHistory).toBeUndefined();
    expect(res.body.tradesThisWeek).toBeUndefined();
    // Counts still present, contents absent from the whole payload.
    expect(res.body.proposalStats.total).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain('Ship offline mode');
    expect(JSON.stringify(res.body)).not.toContain('Costs more than 20 hours');
  });

  test('the fairness numbers a visitor needs are in the payload', async () => {
    await seed(['read', 'trade']);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.body.signupCredits).toBeGreaterThan(0);
    expect(res.body.maxPositionCostPerMarket).toBeUndefined();
    expect(res.body.joinAs).toBe('trader');
  });

  test('the share-link slug form resolves to the same workspace', async () => {
    await seed(['read', 'trade']);
    const byId = await request(app).get(`/api/marketplace/${WS}`);
    const slug = byId.body.slug as string;
    expect(slug).toBeTruthy();

    const bySlug = await request(app).get(`/api/marketplace/${slug.toUpperCase()}`);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.workspaceId).toBe(WS);
  });

  test('the stored ask ships on the ballot, and a legacy proposal reports null', async () => {
    await seed(['read', 'trade']);
    // 'prop-open' predates the column in this fixture, so it stands in for
    // every proposal created before the ask was a number.
    await db.update(proposals).set({ askUsd: 80 }).where(eq(proposals.id, 'prop-open'));
    await db.insert(proposals).values({
      id: 'prop-legacy',
      workspaceId: WS,
      proposedBy: PROPOSER,
      title: '$40: legacy, ask only in the title',
      description: '',
      status: 'pending',
    });

    const res = await request(app).get(`/api/marketplace/${WS}`);
    const byId = Object.fromEntries(
      res.body.proposals.map((p: { id: string; askUsd: number | null }) => [p.id, p.askUsd]),
    );
    expect(byId['prop-open']).toBe(80);
    expect(byId['prop-legacy']).toBeNull();
  });

  test('the pair carries the approved branch id and price shape', async () => {
    await seed(['read', 'trade']);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    const pair = res.body.proposals[0].markets[0];
    expect(pair.approvedMarketId).toBe('mkt-appr');
    expect(pair.declinedMarketId).toBe('mkt-decl');
    expect(pair.approvedProbability).toBeGreaterThan(0);
    expect(pair.approvedLiquidity).toBe(100);
    expect(pair.rangeMax).toBe(100);
    expect(pair.resolvesOn).toBeTruthy();
  });

  /**
   * A conditional market is a market like any other, so it says the same three
   * things about itself as the baseline does (docs/ui-conventions.md, "What a
   * market says about itself"): distinct traders, credits in the pool, credits
   * traded. Per BRANCH, because the approved world and the declined world are
   * two separate books and neither is the baseline.
   */
  describe('what a conditional market says about itself', () => {
    async function tradeOn(marketId: string, agentId: string, cost: number, i: number) {
      await db.insert(trades).values({
        id: `t-${marketId}-${agentId}-${i}`,
        workspaceId: WS,
        agentId,
        marketId,
        direction: 'higher',
        shares: 1,
        cost,
        createdAt: new Date('2026-08-31T10:00:00Z'),
      });
    }

    test('each branch reports its own pool, traders and traded credits', async () => {
      await seed(['read', 'trade']);
      // Two people on the approved branch, one of them twice; one person on
      // the declined branch. Distinct traders, not trades.
      await tradeOn('mkt-appr', OWNER, 5, 1);
      await tradeOn('mkt-appr', OWNER, 7, 2);
      await tradeOn('mkt-appr', PROPOSER, 3, 3);
      await tradeOn('mkt-decl', PROPOSER, 11, 1);
      await db.update(markets).set({ tradedVolume: 15 }).where(eq(markets.id, 'mkt-appr'));
      await db.update(markets).set({ tradedVolume: 11 }).where(eq(markets.id, 'mkt-decl'));

      const res = await request(app).get(`/api/marketplace/${WS}`);
      const pair = res.body.proposals[0].markets[0];
      expect(pair.approvedTraders).toBe(2);
      expect(pair.declinedTraders).toBe(1);
      expect(pair.approvedVolume).toBe(15);
      expect(pair.declinedVolume).toBe(11);
      // The pool is the credits paid in, never b: b = pool / ln 2, so a
      // 100-credit book has b of about 144 and printing b here would tell an
      // owner they have half again the credits they put up.
      expect(pair.approvedPool).toBeCloseTo(initialPool(100), 6);
      expect(pair.declinedPool).toBeCloseTo(initialPool(100), 6);
      expect(pair.approvedPool).not.toBe(pair.approvedLiquidity);
    });

    test('an untraded branch reports zero rather than nothing', async () => {
      await seed(['read', 'trade']);
      const res = await request(app).get(`/api/marketplace/${WS}`);
      const pair = res.body.proposals[0].markets[0];
      expect(pair.approvedTraders).toBe(0);
      expect(pair.declinedTraders).toBe(0);
      expect(pair.approvedVolume).toBe(0);
      expect(pair.declinedVolume).toBe(0);
    });

    test("a branch's numbers are its own, never the baseline's", async () => {
      await seed(['read', 'trade']);
      // A busy baseline market beside the quiet pair: the pair must not
      // borrow any of these numbers.
      await db.insert(markets).values({
        id: 'mkt-base',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2028',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 900,
        pool: initialPool(900),
        tradedVolume: 4242,
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      });
      await tradeOn('mkt-base', OWNER, 9, 1);

      const res = await request(app).get(`/api/marketplace/${WS}`);
      const pair = res.body.proposals[0].markets[0];
      expect(pair.approvedTraders).toBe(0);
      expect(pair.approvedVolume).toBe(0);
      expect(pair.approvedPool).toBeCloseTo(initialPool(100), 6);
    });

    test('a branch that was never spawned reports null, not a zero book', async () => {
      await seed(['read', 'trade']);
      await db.delete(markets).where(eq(markets.id, 'mkt-decl'));

      const res = await request(app).get(`/api/marketplace/${WS}`);
      const pair = res.body.proposals[0].markets[0];
      expect(pair.declinedMarketId).toBeNull();
      expect(pair.declinedPool).toBeNull();
      expect(pair.declinedTraders).toBeNull();
      expect(pair.declinedVolume).toBeNull();
    });
  });

  test('a conditional market history is fetchable and gated like the ballot', async () => {
    await seed(['read', 'trade']);
    const ok = await request(app).get(`/api/marketplace/${WS}/markets/mkt-appr/history`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.history)).toBe(true);

    // A market in another workspace is not reachable through this one.
    const foreign = await request(app).get(`/api/marketplace/${WS}/markets/does-not-exist/history`);
    expect(foreign.status).toBe(404);
  });

  test('market history keeps the counts-only boundary when Public lacks read', async () => {
    await seed([]);
    const res = await request(app).get(`/api/marketplace/${WS}/markets/mkt-appr/history`);
    expect(res.status).toBe(403);
  });

  test('a slug never resolves to a private workspace', async () => {
    await seed(['read', 'trade']);
    const { workspaces } = require('../db/schema');
    await db.update(workspaces).set({ visibility: 'private' }).where(eq(workspaces.id, WS));

    const byId = await request(app).get(`/api/marketplace/${WS}`);
    expect(byId.status).toBe(403);
    const bySlug = await request(app).get('/api/marketplace/ballot-test');
    expect(bySlug.status).toBe(404);
  });
});

/**
 * The workspace's primary number is the DECISION horizon (owner direction
 * 2026-08-16), and every server-side surface reads the same one: the trader
 * context a floor charts, the definition it quotes, and the metric a
 * contractor's impact is denominated in.
 */
describe('the primary horizon server-side', () => {
  const addWeeklyClock = async () => {
    await db.insert(metrics).values({
      id: 'metric-week',
      workspaceId: WS,
      name: 'Revenue this week (USD)',
      value: 887,
      formula: '0',
      marketRangeMax: 8000,
      description: 'This week only, resets Monday.',
    });
    await db.update(metrics).set({ description: 'The year, cumulative.' }).where(eq(metrics.id, 'metric-ballot'));
    // Soonest first in the payload: the week, then the year.
    await db.insert(markets).values([
      {
        id: 'mkt-week-p',
        workspaceId: WS,
        metricId: 'metric-week',
        metricName: 'Revenue this week (USD)',
        targetDate: '2026-W34',
        rangeMin: 0,
        rangeMax: 8000,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      },
      {
        id: 'mkt-year-p',
        workspaceId: WS,
        metricId: 'metric-ballot',
        metricName: 'Revenue',
        targetDate: '2026-12',
        rangeMin: 0,
        rangeMax: 150000,
        shares: [0, 0],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      },
    ]);
  };

  test("the quoted definition is the far horizon's, not the soonest", async () => {
    await seed(['read', 'trade']);
    await addWeeklyClock();
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    // markets still ship soonest-first: the proposal is unchanged.
    expect(res.body.markets[0].targetDate).toBe('2026-W34');
    expect(res.body.heroMetricDescription).toBe('The year, cumulative.');
  });

  test("a contractor's impact is denominated in the far horizon's metric", async () => {
    await seed(['read', 'trade']);
    await addWeeklyClock();
    // The pending proposal's pair is on the YEAR metric, so it can only be
    // scored if the hero metric is the year's.
    const res = await request(app).get(`/api/marketplace/${WS}`);
    const scored = (res.body.topContractors as Array<{ pricedJobs: number }>).find(c => c.pricedJobs > 0);
    expect(scored).toBeDefined();
  });
});

/**
 * The brief's priced impact: what a reader is allowed to conclude from it.
 *
 * These are named after the rules in docs/vision.md, "The workspace brief",
 * because each one was a wrong answer before it was a test. On 2026-08-31 the
 * floor's own market maker read this brief and recommended, as the best priced
 * upside on the Telarchy floor, an already-approved contract whose +11.79 came
 * from a voided pair on a horizon that resolved the next morning, on a metric
 * the brief listed under a different name. Every number he quoted was in the
 * payload. None of them meant what the payload made them look like.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  // A reader on the floor's own workspace, which is what an anonymous visitor
  // holds on a public workspace and what Otto forwards when he fetches.
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = { agentId: undefined, workspaceId: 'ws-brief', capabilities: new Set(['read']) };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/proposals', authMiddleware, proposalsRouter);
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

const WS = 'ws-brief';
/** Far enough out that no clock makes it settled. */
const LIVE = '2030-06';
/** Long resolved, whatever day the suite runs. */
const PAST = '2020-01';

type MarketSeed = {
  id: string;
  targetDate: string;
  shares: [number, number];
  proposalId?: string | null;
  branch?: 'approved' | 'declined' | null;
  voided?: boolean;
  metricName?: string;
  metricId?: string;
};

async function market(m: MarketSeed) {
  await db.insert(markets).values({
    id: m.id,
    workspaceId: WS,
    metricId: m.metricId ?? 'metric-1',
    // Markets denormalise the metric's name at spawn time, which is exactly
    // how one metric ends up with five names in one payload.
    metricName: m.metricName ?? 'Weekly active verified traders',
    targetDate: m.targetDate,
    rangeMin: 0,
    rangeMax: 100,
    shares: m.shares,
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: m.voided ?? false,
    proposalId: m.proposalId ?? null,
    branch: m.branch ?? null,
  });
}

async function seed() {
  await db.insert(agents).values([
    { id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'owner' },
    { id: 'trader-1', apiKeyHash: 'h-t1', balance: 0, nickname: 'trader-1' },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Telarchy',
    createdBy: 'owner',
    visibility: 'public',
    slug: 'telarchy',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
    sourcePermissions: {},
  });
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Weekly active verified traders',
    description: 'Distinct verified participants who traded in the trailing 7 days.',
    value: 4,
    marketRangeMax: 100,
  });
  await db.insert(proposals).values([
    {
      id: 'prop-pending',
      workspaceId: WS,
      proposedBy: 'owner',
      title: '$20: Publish a LessWrong post',
      description: 'One post.',
      askUsd: 20,
      status: 'pending',
    },
    {
      id: 'prop-approved',
      workspaceId: WS,
      proposedBy: 'owner',
      title: '$300: Post a Manifold market',
      description: 'One market.',
      askUsd: 300,
      status: 'approved',
    },
  ]);
}

const briefJson = async () => (await request(app).get(`/api/marketplace/${WS}/context`)).body;
const briefMd = async () => (await request(app).get(`/api/marketplace/${WS}/context?format=md`)).text;
const impactOf = (body: any, proposalId: string) =>
  body.contracts.find((c: any) => c.id === proposalId).impact as Array<Record<string, any>>;

describe('a voided pair is not priced upside on a contract nobody has decided', () => {
  test('the brief drops a voided pair on a PENDING contract', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });
    await market({
      id: 'dead-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-pending',
      branch: 'approved',
      voided: true,
    });
    await market({
      id: 'dead-d',
      targetDate: PAST,
      shares: [60, 0],
      proposalId: 'prop-pending',
      branch: 'declined',
      voided: true,
    });

    const impact = impactOf(await briefJson(), 'prop-pending');
    expect(impact.map(i => i.targetDate)).toEqual([LIVE]);
    expect(await briefMd()).not.toContain(PAST);
  });

  test('a DECIDED contract keeps its voided pairs, because they are the record', async () => {
    await seed();
    await market({
      id: 'dec-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-approved',
      branch: 'approved',
      voided: true,
    });
    await market({
      id: 'dec-d',
      targetDate: PAST,
      shares: [60, 0],
      proposalId: 'prop-approved',
      branch: 'declined',
      voided: true,
    });

    const impact = impactOf(await briefJson(), 'prop-approved');
    expect(impact.map(i => i.targetDate)).toEqual([PAST]);
  });

  test('the brief never quotes a delta the floor’s own ballot hides', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });
    await market({
      id: 'dead-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-pending',
      branch: 'approved',
      voided: true,
    });

    const ballot = (await request(app).get(`/api/marketplace/${WS}`)).body;
    const onBallot = ballot.proposals
      .find((p: any) => p.id === 'prop-pending')
      .markets.map((m: any) => `${m.metricId}|${m.targetDate}`)
      .sort();
    const inBrief = impactOf(await briefJson(), 'prop-pending')
      .map(i => `${i.metricId}|${i.targetDate}`)
      .sort();
    expect(inBrief).toEqual(onBallot);
  });
});

describe('every horizon says when it resolves and whether that has passed', () => {
  test('a live pair carries its resolution instant and is not settled', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });

    const [pair] = impactOf(await briefJson(), 'prop-pending');
    expect(pair.resolvesOn).toBe('2030-07-01T00:00:00Z');
    expect(pair.settled).toBe(false);
  });

  test('a pair whose horizon has passed is marked settled, and the markdown says so', async () => {
    await seed();
    await market({
      id: 'past-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-approved',
      branch: 'approved',
    });
    await market({ id: 'past-d', targetDate: PAST, shares: [60, 0], proposalId: 'prop-approved', branch: 'declined' });

    const [pair] = impactOf(await briefJson(), 'prop-approved');
    expect(pair.settled).toBe(true);
    expect(await briefMd()).toMatch(/already resolved/i);
  });

  test('an open market says when it resolves', async () => {
    await seed();
    await market({ id: 'open-1', targetDate: LIVE, shares: [0, 5] });
    expect((await briefJson()).markets[0].resolvesOn).toBe('2030-07-01T00:00:00Z');
  });
});

describe('a price says how many trades made it', () => {
  test('a branch nobody has traded reports zero trades and the markdown says nobody has traded it', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });

    const [pair] = impactOf(await briefJson(), 'prop-pending');
    expect(pair.approvedTrades).toBe(0);
    expect(pair.declinedTrades).toBe(0);
    expect(await briefMd()).toMatch(/nobody has traded/i);
  });

  test('a traded branch reports its trades', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });
    await db.insert(trades).values([
      {
        id: 'tr-1',
        workspaceId: WS,
        agentId: 'trader-1',
        marketId: 'live-a',
        direction: 'higher',
        shares: 10,
        cost: 6,
      },
      { id: 'tr-2', workspaceId: WS, agentId: 'trader-1', marketId: 'live-a', direction: 'higher', shares: 2, cost: 1 },
    ]);

    const [pair] = impactOf(await briefJson(), 'prop-pending');
    expect(pair.approvedTrades).toBe(2);
    expect(pair.declinedTrades).toBe(0);
  });

  test('an untraded open market is not quoted as what the crowd thinks', async () => {
    await seed();
    await market({ id: 'open-1', targetDate: LIVE, shares: [0, 0] });
    expect((await briefJson()).markets[0].trades).toBe(0);
    expect(await briefMd()).toMatch(/nobody has traded/i);
  });

  test('the baseline the pair moves away from is beside the delta', async () => {
    await seed();
    await market({ id: 'open-1', targetDate: LIVE, shares: [0, 20] });
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });

    const [pair] = impactOf(await briefJson(), 'prop-pending');
    expect(typeof pair.baseline).toBe('number');
    expect(pair.baseline).toBeGreaterThan(50);
  });
});

describe('one metric is one name', () => {
  test('a market carrying a stale metric name is renamed to the metric it prices', async () => {
    await seed();
    await market({ id: 'open-1', targetDate: LIVE, shares: [0, 5], metricName: 'Active traders @1st October' });
    await market({
      id: 'live-a',
      targetDate: LIVE,
      shares: [0, 10],
      proposalId: 'prop-pending',
      branch: 'approved',
      metricName: 'Weekly active traders',
    });
    await market({
      id: 'live-d',
      targetDate: LIVE,
      shares: [0, 0],
      proposalId: 'prop-pending',
      branch: 'declined',
      metricName: 'Weekly active traders',
    });

    const body = await briefJson();
    expect(body.markets[0].metricName).toBe('Weekly active verified traders');
    expect(impactOf(body, 'prop-pending')[0].metricName).toBe('Weekly active verified traders');
    const md = await briefMd();
    expect(md).not.toContain('Active traders @1st October');
    expect(md).not.toContain('Weekly active traders,');
  });

  test('a market whose metric no longer exists says so instead of quoting a name nothing defines', async () => {
    await seed();
    await market({
      id: 'orphan',
      targetDate: LIVE,
      shares: [0, 5],
      metricId: 'metric-gone',
      metricName: 'Weekly active verified traders (end of 2026)',
    });
    const body = await briefJson();
    const orphan = body.markets.find((m: any) => m.marketId === 'orphan');
    expect(orphan.metricDefined).toBe(false);
    expect(await briefMd()).toMatch(/no longer defined/i);
  });
});

describe('the markdown is ordered for a decision', () => {
  test('contracts still open for a decision come before decided ones', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });
    await market({ id: 'app-a', targetDate: LIVE, shares: [0, 40], proposalId: 'prop-approved', branch: 'approved' });
    await market({ id: 'app-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-approved', branch: 'declined' });

    const md = await briefMd();
    const open = md.indexOf('Contracts open for a decision');
    const decided = md.indexOf('Contracts already decided');
    expect(open).toBeGreaterThan(-1);
    expect(decided).toBeGreaterThan(open);
    expect(md.indexOf('LessWrong')).toBeGreaterThan(open);
    expect(md.indexOf('LessWrong')).toBeLessThan(decided);
    expect(md.indexOf('Manifold market')).toBeGreaterThan(decided);
  });

  test('a decided contract states its outcome where its impact is read', async () => {
    await seed();
    await market({ id: 'app-a', targetDate: LIVE, shares: [0, 40], proposalId: 'prop-approved', branch: 'approved' });
    await market({ id: 'app-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-approved', branch: 'declined' });

    const body = await briefJson();
    expect(body.contracts.find((c: any) => c.id === 'prop-approved').decisionOpen).toBe(false);
    expect(await briefMd()).toMatch(/already approved.*no approval decision is left/i);
  });

  test('live horizons come before settled ones inside one contract', async () => {
    await seed();
    // Seeded settled-first on purpose: order must come from the rule, not from
    // whatever order the rows happen to arrive in.
    await market({ id: 'old-a', targetDate: PAST, shares: [0, 90], proposalId: 'prop-approved', branch: 'approved' });
    await market({ id: 'old-d', targetDate: PAST, shares: [0, 0], proposalId: 'prop-approved', branch: 'declined' });
    await market({ id: 'app-a', targetDate: LIVE, shares: [0, 40], proposalId: 'prop-approved', branch: 'approved' });
    await market({ id: 'app-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-approved', branch: 'declined' });

    const impact = impactOf(await briefJson(), 'prop-approved');
    expect(impact.map(i => i.targetDate)).toEqual([LIVE, PAST]);
    const md = await briefMd();
    expect(md.indexOf(LIVE)).toBeLessThan(md.indexOf(PAST));
  });
});

/**
 * The third reader of the same rule. Otto is told to fetch a contract's
 * pricing from GET /api/proposals/:id (docs/vision.md, "The workspace
 * brief"), so a door that hands him a retired horizon there would put back
 * exactly what the brief stopped doing.
 */
describe('GET /api/proposals/:id applies the same live-pair rule', () => {
  test('a voided pair is not returned on a PENDING contract', async () => {
    await seed();
    await market({ id: 'live-a', targetDate: LIVE, shares: [0, 10], proposalId: 'prop-pending', branch: 'approved' });
    await market({ id: 'live-d', targetDate: LIVE, shares: [0, 0], proposalId: 'prop-pending', branch: 'declined' });
    await market({
      id: 'dead-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-pending',
      branch: 'approved',
      voided: true,
    });

    const res = await request(app).get('/api/proposals/prop-pending');
    expect(res.status).toBe(200);
    expect(res.body.markets.map((m: any) => m.targetDate)).toEqual([LIVE]);
  });

  test('a DECIDED contract still returns its voided pairs, because they are the record', async () => {
    await seed();
    await market({
      id: 'dec-a',
      targetDate: PAST,
      shares: [0, 60],
      proposalId: 'prop-approved',
      branch: 'approved',
      voided: true,
    });

    const res = await request(app).get('/api/proposals/prop-approved');
    expect(res.status).toBe(200);
    expect(res.body.markets.map((m: any) => m.targetDate)).toEqual([PAST]);
  });
});

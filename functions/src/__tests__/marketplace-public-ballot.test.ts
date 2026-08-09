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

import request from 'supertest';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents, markets, metrics, permissionGroups, proposals } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { initialPool } from '../lib/amm';
import { marketplaceRouter } from '../routes/marketplace';
import { AppError } from '../lib/errors';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

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
    wsId: WS, name: 'Ballot Test', createdBy: OWNER, ownerAgentId: OWNER, visibility: 'public',
  });
  const [publicGroup] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db.update(permissionGroups).set({ capabilities: publicCaps })
    .where(eq(permissionGroups.id, publicGroup.id));

  await db.insert(metrics).values({
    id: 'metric-ballot', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100,
  });
  await db.insert(proposals).values([
    {
      id: 'prop-open', workspaceId: WS, proposedBy: PROPOSER,
      title: 'Ship offline mode', description: 'Asked by three people.', status: 'pending',
    },
    {
      id: 'prop-declined', workspaceId: WS, proposedBy: PROPOSER,
      title: 'Rewrite in Rust', description: 'why not', status: 'declined',
      resolvedAt: new Date(), declineReason: 'Costs more than 20 hours of work.',
    },
  ]);
  // Conditional pair for the pending proposal: approved priced above declined.
  await db.insert(markets).values([
    {
      id: 'mkt-appr', workspaceId: WS, metricId: 'metric-ballot', metricName: 'Revenue',
      targetDate: '2028', rangeMin: 0, rangeMax: 100,
      shares: [0, 10], liquidity: 100, pool: initialPool(100),
      active: true, resolved: false, voided: false, proposalId: 'prop-open', branch: 'approved',
    },
    {
      id: 'mkt-decl', workspaceId: WS, metricId: 'metric-ballot', metricName: 'Revenue',
      targetDate: '2028', rangeMin: 0, rangeMax: 100,
      shares: [0, 0], liquidity: 100, pool: initialPool(100),
      active: true, resolved: false, voided: false, proposalId: 'prop-open', branch: 'declined',
    },
  ]);
}

describe('public ballot disclosure gate', () => {
  test('an Open workspace (Public group has read) ships the ballot with deltas and decline reasons', async () => {
    await seed(['read', 'trade']);

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);

    expect(res.body.proposals).toHaveLength(1);
    const p = res.body.proposals[0];
    expect(p.title).toBe('Ship offline mode');
    expect(p.description).toBe('Asked by three people.');
    expect(p.proposedByName).toBe('kragnour-fan');
    expect(p.markets).toHaveLength(1);
    const pair = p.markets[0];
    expect(pair.metricName).toBe('Revenue');
    expect(pair.approvedConsensus).toBeGreaterThan(pair.declinedConsensus);
    expect(pair.delta).toBeCloseTo(pair.approvedConsensus - pair.declinedConsensus, 6);

    expect(res.body.decided).toHaveLength(1);
    expect(res.body.decided[0].status).toBe('declined');
    expect(res.body.decided[0].declineReason).toBe('Costs more than 20 hours of work.');
  });

  test('an Open workspace ships trader context: history, provenance, pulse', async () => {
    await seed(['read', 'trade']);
    // The hero context keys off the soonest baseline market; the shared seed
    // only creates the conditional pair, so add the baseline here.
    await db.insert(markets).values({
      id: 'mkt-base', workspaceId: WS, metricId: 'metric-ballot', metricName: 'Revenue',
      targetDate: '2028', rangeMin: 0, rangeMax: 100,
      shares: [0, 0], liquidity: 100, pool: initialPool(100),
      active: true, resolved: false, voided: false, proposalId: null,
    });
    const { metricLogs } = require('../db/schema');
    await db.insert(metricLogs).values([
      { id: 'log1', workspaceId: WS, metricId: 'metric-ballot', metricName: 'Revenue', value: 40, timestamp: new Date(Date.now() - 2 * 86400e3) },
      { id: 'log2', workspaceId: WS, metricId: 'metric-ballot', metricName: 'Revenue', value: 50, timestamp: new Date(Date.now() - 1 * 86400e3) },
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
    expect(res.body.maxPositionCostPerMarket).toBe(0);
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
      id: 'prop-legacy', workspaceId: WS, proposedBy: PROPOSER,
      title: '$40: legacy, ask only in the title', description: '', status: 'pending',
    });

    const res = await request(app).get(`/api/marketplace/${WS}`);
    const byId = Object.fromEntries(res.body.proposals.map((p: { id: string; askUsd: number | null }) => [p.id, p.askUsd]));
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

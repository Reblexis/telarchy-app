/**
 * HTTP-level test for GET /api/marketplace/stats, specifically the
 * weeklyActiveVerifiedTraders field (2026-08-14): distinct participants who
 * (a) have a Manifold account synced and (b) placed trades totalling at
 * least 100 credits (abs cost) in the trailing 7 days, across all
 * workspaces. It is the resolution source for the Telarchy dogfooding
 * workspace's hero metric, so its definition is pinned by a test.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import {
  agents,
  earnClaims,
  liquidityPurchases,
  markets,
  metrics,
  recordLinks,
  systemConfig,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-stats';
const DAY = 24 * 60 * 60 * 1000;

async function seed() {
  await db.insert(workspaces).values([{ id: WS, name: 'Stats WS', createdBy: 'seed', visibility: 'public' }]);
  await db.insert(agents).values([
    { id: 'verified-whale', apiKeyHash: 'h1', balance: toUnits(0) },
    { id: 'verified-seller', apiKeyHash: 'h2', balance: toUnits(0) },
    { id: 'verified-gesture', apiKeyHash: 'h3', balance: toUnits(0) },
    { id: 'unverified-whale', apiKeyHash: 'h4', balance: toUnits(0) },
    { id: 'verified-stale', apiKeyHash: 'h5', balance: toUnits(0) },
  ]);
  // The verified set is who was PAID for a Manifold record, which is an
  // `earn_claims` row. Deliberately not the `record_links` badge: since
  // 2026-09-02 anyone holding an account can wear one (docs/record-links.md),
  // so a badge count would answer a different question from the one the
  // public market asks.
  await db.insert(earnClaims).values(
    ['verified-whale', 'verified-seller', 'verified-gesture', 'verified-stale'].map(id => ({
      id: `claim-${id}`,
      agentId: id,
      key: 'manifold_link' as const,
      refId: `mf-${id}`,
      credits: 5000,
    })),
  );
  await db
    .insert(metrics)
    .values([{ id: 'm1', workspaceId: WS, name: 'M', value: 0, formula: '0', marketRangeMax: 100 }]);
  await db.insert(markets).values([
    {
      id: 'mkt1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'M',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0] as [number, number],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
  ]);
  const base = { workspaceId: WS, marketId: 'mkt1', direction: 'higher', shares: 1 };
  await db.insert(trades).values([
    // Verified, 150 cr across two trades: counts.
    { ...base, id: 't1', agentId: 'verified-whale', cost: 90, createdAt: new Date(Date.now() - 1 * DAY) },
    { ...base, id: 't2', agentId: 'verified-whale', cost: 60, createdAt: new Date(Date.now() - 2 * DAY) },
    // Verified, sells only (negative cost) totalling 120 abs: counts.
    { ...base, id: 't3', agentId: 'verified-seller', cost: -120, createdAt: new Date(Date.now() - 1 * DAY) },
    // Verified but a costless-gesture 5 cr: does NOT count (100 cr floor).
    { ...base, id: 't4', agentId: 'verified-gesture', cost: 5, createdAt: new Date(Date.now() - 1 * DAY) },
    // 500 cr but no Manifold sync: does NOT count.
    { ...base, id: 't5', agentId: 'unverified-whale', cost: 500, createdAt: new Date(Date.now() - 1 * DAY) },
    // Verified and heavy, but outside the window: does NOT count.
    { ...base, id: 't6', agentId: 'verified-stale', cost: 500, createdAt: new Date(Date.now() - 9 * DAY) },
  ]);
}

describe('GET /api/marketplace/stats', () => {
  test('weeklyActiveVerifiedTraders = Manifold-synced AND >=100 cr abs traded in 7 days', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    // verified-whale (150 summed) and verified-seller (120 abs via sells).
    expect(res.body.weeklyActiveVerifiedTraders).toBe(2);
  });

  // 2026-09-01 18:40 UTC: migration 0100 rewrote every Manifold link from
  // `manifold-claimed:agent:` to `record-handle:manifold:` and deleted the old
  // rows, while this count still looked for the old key. Four verified traders
  // became zero on the floor, two daily markets settled on 0, and the next
  // day's market opened at the lowest price the book can hold. The count reads
  // the key the record-link router writes, and nothing else.
  test('THE RULE: a paid record counts; a free badge and the retired key do not', async () => {
    await seed();
    // Two things that must not count, for the same reason. `legacy-whale`
    // wears a badge and was never paid, which since 2026-09-02 costs a bio
    // edit; `stale-key-whale` has a row in the shape the deleted route
    // wrote, which migration 0102 removes but a survivor must not revive.
    await db.insert(agents).values([
      { id: 'legacy-whale', apiKeyHash: 'h9', balance: toUnits(0) },
      { id: 'stale-key-whale', apiKeyHash: 'h10', balance: toUnits(0) },
    ]);
    await db
      .insert(recordLinks)
      .values([{ agentId: 'legacy-whale', provider: 'manifold', externalId: 'mf-free', handle: 'legacy' }]);
    await db
      .insert(systemConfig)
      .values([{ key: 'manifold-claimed:agent:stale-key-whale', value: { username: 'stale-key' } }]);
    await db.insert(trades).values(
      ['legacy-whale', 'stale-key-whale'].map((agentId, i) => ({
        workspaceId: WS,
        marketId: 'mkt1',
        direction: 'higher' as const,
        shares: 1,
        id: `t7${i}`,
        agentId,
        cost: 500,
        createdAt: new Date(Date.now() - 1 * DAY),
      })),
    );
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.weeklyActiveVerifiedTraders).toBe(2);
    // Four paid records: not the free badge, not the legacy row, not a
    // pending claim.
    expect(res.body.manifoldImportCount).toBe(4);
  });

  test('manifoldImportCount counts paid Manifold links, not other providers or pending claims', async () => {
    await seed();
    await db.insert(earnClaims).values({
      id: 'claim-poly',
      agentId: 'verified-whale',
      key: 'polymarket_link',
      refId: '0xwhale',
      credits: 5000,
    });
    await db
      .insert(systemConfig)
      .values([{ key: 'record-link:manifold:someone', value: { code: 'telarchy-abc', handle: 'someone' } }]);
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.manifoldImportCount).toBe(4);
  });

  test('the public floor reports the same manifoldImportCount as the stats route', async () => {
    await seed();
    const [stats, floor] = await Promise.all([
      request(app).get('/api/marketplace/stats'),
      request(app).get(`/api/marketplace/${WS}`),
    ]);
    expect(floor.status).toBe(200);
    expect(floor.body.manifoldImportCount).toBe(4);
    expect(floor.body.manifoldImportCount).toBe(stats.body.manifoldImportCount);
  });

  test('is zero on an empty platform rather than absent', async () => {
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.weeklyActiveVerifiedTraders).toBe(0);
    expect(res.body.revenue30dUsd).toBe(0);
  });

  // revenue30dUsd is the resolution source for "Telarchy revenue (USD)", which
  // the hourly self-sync pushes (docs/metrics.md). Pinned by a test for the
  // same reason the trader count is: a market settles on it.
  test('revenue30dUsd = completed purchases in the trailing 30 days, dated by completion', async () => {
    await seed();
    const base = {
      workspaceId: 'w1',
      agentId: 'buyer',
      credits: 1000,
      creditsPerUsd: 1000,
      createdAt: new Date(Date.now() - 40 * DAY),
    };
    await db.insert(liquidityPurchases).values([
      // Completed inside the window: counts.
      { ...base, id: 'p1', usdAmount: 25, status: 'completed', completedAt: new Date(Date.now() - 2 * DAY) },
      // Completed but outside the window: does NOT count.
      { ...base, id: 'p2', usdAmount: 500, status: 'completed', completedAt: new Date(Date.now() - 31 * DAY) },
      // Never paid: does NOT count.
      { ...base, id: 'p3', usdAmount: 9000, status: 'pending', completedAt: null },
      // Pre-completedAt row, dated by creation, inside the window: counts.
      { ...base, id: 'p4', usdAmount: 5, status: 'completed', createdAt: new Date(Date.now() - 1 * DAY) },
    ]);
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.revenue30dUsd).toBe(30);
  });

  // The operator paying itself is not revenue (docs/metrics.md, "Revenue,
  // trailing 30 days"). Owner report 2026-09-02: the whole $5 the floor showed
  // was the owner's own card, from an account flagged platform admin.
  test('a purchase made by the house (platform admin) is not revenue', async () => {
    await seed();
    await db.insert(agents).values([
      { id: 'house', apiKeyHash: 'h-house', balance: toUnits(0), platformAdmin: true },
      { id: 'buyer', apiKeyHash: 'h-buyer', balance: toUnits(0) },
    ]);
    const base = { workspaceId: 'w1', credits: 1000, creditsPerUsd: 1000, status: 'completed' };
    await db.insert(liquidityPurchases).values([
      { ...base, id: 'h1', agentId: 'house', usdAmount: 5, completedAt: new Date(Date.now() - 1 * DAY) },
      { ...base, id: 'h2', agentId: 'house', usdAmount: 50, completedAt: new Date(Date.now() - 2 * DAY) },
      { ...base, id: 'b1', agentId: 'buyer', usdAmount: 25, completedAt: new Date(Date.now() - 2 * DAY) },
    ]);
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.status).toBe(200);
    expect(res.body.revenue30dUsd).toBe(25);
  });

  test('when the house is the only buyer, revenue is zero, not the house total', async () => {
    await seed();
    await db.insert(agents).values([{ id: 'house', apiKeyHash: 'h-house', balance: toUnits(0), platformAdmin: true }]);
    await db.insert(liquidityPurchases).values([
      {
        id: 'h1',
        workspaceId: 'w1',
        agentId: 'house',
        credits: 5000,
        creditsPerUsd: 1000,
        usdAmount: 5,
        status: 'completed',
        completedAt: new Date(Date.now() - 1 * DAY),
      },
    ]);
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.body.revenue30dUsd).toBe(0);
  });

  test('a buyer whose account row is missing still counts (no join drops paying customers)', async () => {
    await seed();
    await db.insert(liquidityPurchases).values([
      {
        id: 'o1',
        workspaceId: 'w1',
        agentId: 'ghost-buyer',
        credits: 7000,
        creditsPerUsd: 1000,
        usdAmount: 7,
        status: 'completed',
        completedAt: new Date(Date.now() - 1 * DAY),
      },
    ]);
    const res = await request(app).get('/api/marketplace/stats');
    expect(res.body.revenue30dUsd).toBe(7);
  });
});

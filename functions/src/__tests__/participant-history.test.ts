/**
 * Tests for the participant profile history graphs:
 *  - daily balance snapshots (idempotent, written by the resolve cron path)
 *  - balanceHistory on the public profile (snapshots + live "now" point)
 *  - pnlHistory: cumulative realized PnL from resolved markets (net trade
 *    cash + resolution payout at resolvedAt)
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
    getUserWorkspaceMemberships: async () => [],
  };
});

jest.mock('../middleware/roles', () => ({
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireSelfOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSelfOrOwner: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentBalanceSnapshots, agents, markets, positions, trades, workspaces } from '../db/schema';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { snapshotAgentBalances } from '../services/balances';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-history';
const AGENT = 'history-bot';
const MARKET = 'market-resolved';
const RESOLVED_AT = new Date('2026-05-01T00:00:00Z');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  return app;
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values({ id: WS, name: 'History Test', createdBy: 'owner', visibility: 'public' });
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h', balance: toUnits(950) });
});

async function seedResolvedMarket() {
  // Market resolved at 80 on a [0, 100] range: higher shares pay 0.8 each.
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'm1',
    metricName: 'Revenue',
    targetDate: '2026-04-30',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 10],
    liquidity: 10,
    pool: 0,
    active: false,
    resolved: true,
    voided: false,
    actualValue: 80,
    resolvedAt: RESOLVED_AT,
  });
  // Agent spent 30 credits on 10 higher shares -> payout 8, realized PnL -22.
  await db.insert(trades).values({
    id: 't1',
    workspaceId: WS,
    agentId: AGENT,
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    cost: 30,
    createdAt: new Date('2026-04-20T00:00:00Z'),
  });
  await db.insert(positions).values({
    id: `${AGENT}_${MARKET}_higher`,
    workspaceId: WS,
    agentId: AGENT,
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    totalCost: 30,
  });
}

describe('balance snapshots', () => {
  test('one snapshot per agent per UTC day, idempotent across runs', async () => {
    const first = await snapshotAgentBalances();
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await snapshotAgentBalances();
    expect(second).toBe(0);

    const rows = await db.select().from(agentBalanceSnapshots).where(eq(agentBalanceSnapshots.agentId, AGENT));
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(toUnits(950));
    expect(rows[0].day).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('public profile history', () => {
  test('balanceHistory = snapshots plus a live now-point in credits', async () => {
    await snapshotAgentBalances();
    // Balance changes after the snapshot; the live point must reflect it.
    await db
      .update(agents)
      .set({ balance: toUnits(1200) })
      .where(eq(agents.id, AGENT));

    const res = await request(makeApp()).get(`/api/agents/${AGENT}/public`);
    expect(res.status).toBe(200);
    expect(res.body.balanceHistory).toHaveLength(2);
    expect(res.body.balanceHistory[0].balance).toBe(950); // snapshot, in credits
    expect(res.body.balanceHistory[1].balance).toBe(1200); // live point
    expect(Date.parse(res.body.balanceHistory[1].at)).toBeGreaterThan(Date.parse(res.body.balanceHistory[0].at));
  });

  test('pnlHistory: net trade cash + payout lands at resolvedAt, cumulative', async () => {
    await seedResolvedMarket();
    const res = await request(makeApp()).get(`/api/agents/${AGENT}/public`);
    expect(res.status).toBe(200);
    expect(res.body.pnlHistory).toHaveLength(1);
    expect(res.body.pnlHistory[0].at).toBe(RESOLVED_AT.toISOString());
    // -30 trade cost + 10 shares * 0.8 payout = -22
    expect(res.body.pnlHistory[0].cumulative).toBe(-22);
  });

  test('open (unresolved) markets contribute nothing to pnlHistory', async () => {
    await db.insert(markets).values({
      id: 'market-open',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Revenue',
      targetDate: '2099-12-31',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 5],
      liquidity: 10,
      pool: 10,
      active: true,
      resolved: false,
      voided: false,
    });
    await db.insert(trades).values({
      id: 't2',
      workspaceId: WS,
      agentId: AGENT,
      marketId: 'market-open',
      direction: 'higher',
      shares: 5,
      cost: 12,
      createdAt: new Date(),
    });
    const res = await request(makeApp()).get(`/api/agents/${AGENT}/public`);
    expect(res.status).toBe(200);
    expect(res.body.pnlHistory).toHaveLength(0);
  });
});

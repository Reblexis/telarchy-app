/**
 * Every settled market a participant traded, with what it closed at and what
 * they last called it (docs/ui-conventions.md, "The participant profile").
 *
 * A profile said how many credits somebody has and never whether they were
 * right, which is the question a forecaster comes back for. Their own call is
 * the market's call as they left it: the consensus recorded on their last
 * trade in that book. Nothing is derived from it here - no hit rate, no
 * average distance - because the rows are the record and a reader can see the
 * distance on the row.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: async (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const ME = 'kestrel';
const OTHER = 'someone-else';
const WS = 'ws-calls';
const B = 10;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: ME, apiKeyHash: 'h-me', balance: toUnits(100) },
    { id: OTHER, apiKeyHash: 'h-other', balance: toUnits(100) },
  ]);
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Floor',
    createdBy: OTHER,
    ownerAgentId: OTHER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [ME, OTHER] })
    .where(eq(permissionGroups.id, trader.id));
  await db
    .insert(metrics)
    .values({ id: 'metric', workspaceId: WS, name: 'Active traders', value: 0, formula: '0', marketRangeMax: 50 });
});

async function market(
  id: string,
  opts: { resolved?: boolean; actualValue?: number | null; voided?: boolean; resolvedAt?: Date; targetDate?: string },
) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: 'metric',
    metricName: 'Active traders',
    targetDate: opts.targetDate ?? '2026-08',
    rangeMin: 0,
    rangeMax: 50,
    shares: [0, 0] as [number, number],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: opts.resolved ?? false,
    voided: opts.voided ?? false,
    actualValue: opts.actualValue ?? null,
    resolvedAt: opts.resolvedAt ?? null,
  });
}

async function trade(
  id: string,
  marketId: string,
  opts: { agentId?: string; consensusAfter?: number | null; at: Date; kind?: string },
) {
  await db.insert(trades).values({
    id,
    agentId: opts.agentId ?? ME,
    workspaceId: WS,
    marketId,
    direction: 'higher',
    shares: 2,
    cost: 1,
    kind: opts.kind ?? 'trade',
    consensusAfter: opts.consensusAfter ?? null,
    createdAt: opts.at,
  });
}

async function calls() {
  const res = await request(app).get(`/api/agents/${ME}/public`);
  expect(res.status).toBe(200);
  return res.body.settledCalls as Array<Record<string, unknown>>;
}

describe('what closed, and what they called it', () => {
  test('a settled market they traded is a row carrying the close and their own call', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('t1', 'm1', { consensusAfter: 7, at: new Date('2026-08-30T00:00:00Z') });
    const rows = await calls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      marketId: 'm1',
      metricName: 'Active traders',
      close: 6,
      call: 7,
      rangeMin: 0,
      rangeMax: 50,
    });
  });

  test('their call is the LAST one they made, not the first', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('t1', 'm1', { consensusAfter: 20, at: new Date('2026-08-20T00:00:00Z') });
    await trade('t2', 'm1', { consensusAfter: 8, at: new Date('2026-08-29T00:00:00Z') });
    const rows = await calls();
    expect(rows[0].call).toBe(8);
  });

  test('somebody else’s trade is not their call', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('mine', 'm1', { consensusAfter: 7, at: new Date('2026-08-20T00:00:00Z') });
    await trade('theirs', 'm1', { agentId: OTHER, consensusAfter: 44, at: new Date('2026-08-30T00:00:00Z') });
    const rows = await calls();
    expect(rows[0].call).toBe(7);
  });

  test('a redemption is bookkeeping and never a call', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('t1', 'm1', { consensusAfter: 7, at: new Date('2026-08-20T00:00:00Z') });
    await trade('r1', 'm1', { consensusAfter: 99, at: new Date('2026-08-30T00:00:00Z'), kind: 'redeem' });
    const rows = await calls();
    expect(rows[0].call).toBe(7);
  });

  test('a trade written before calls were recorded publishes null, never zero', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('t1', 'm1', { consensusAfter: null, at: new Date('2026-08-20T00:00:00Z') });
    const rows = await calls();
    expect(rows[0].call).toBeNull();
  });
});

describe('which markets are rows at all', () => {
  test('a market they never traded is not on their profile', async () => {
    await market('m1', { resolved: true, actualValue: 6, resolvedAt: new Date('2026-09-01T00:00:00Z') });
    await trade('t1', 'm1', { agentId: OTHER, consensusAfter: 7, at: new Date('2026-08-20T00:00:00Z') });
    expect(await calls()).toEqual([]);
  });

  test('a market still open is not settled and is not a row', async () => {
    await market('m1', {});
    await trade('t1', 'm1', { consensusAfter: 7, at: new Date('2026-08-20T00:00:00Z') });
    expect(await calls()).toEqual([]);
  });

  test('a cancelled market has no close to be right about', async () => {
    await market('m1', {
      resolved: true,
      actualValue: null,
      voided: true,
      resolvedAt: new Date('2026-09-01T00:00:00Z'),
    });
    await trade('t1', 'm1', { consensusAfter: 7, at: new Date('2026-08-20T00:00:00Z') });
    expect(await calls()).toEqual([]);
  });

  test('newest settlement first', async () => {
    await market('old', { resolved: true, actualValue: 1, resolvedAt: new Date('2026-08-01T00:00:00Z') });
    await market('new', {
      resolved: true,
      actualValue: 2,
      resolvedAt: new Date('2026-09-01T00:00:00Z'),
      targetDate: '2026-09',
    });
    await trade('t1', 'old', { consensusAfter: 3, at: new Date('2026-07-30T00:00:00Z') });
    await trade('t2', 'new', { consensusAfter: 4, at: new Date('2026-08-30T00:00:00Z') });
    const rows = await calls();
    expect(rows.map(r => r.marketId)).toEqual(['new', 'old']);
  });
});

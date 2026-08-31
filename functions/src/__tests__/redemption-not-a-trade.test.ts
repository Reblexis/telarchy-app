/**
 * A REDEMPTION IS NOT A TRADE IN ANY LIST A PERSON READS.
 *
 * Buying the side opposite a position redeems the matched pairs at par
 * (docs/ui-conventions.md, "A trader holds ONE net side"). That redemption
 * writes two ledger rows, one per side, because the price replay rebuilds the
 * book by walking `trades` and a change to `markets.shares` with no rows
 * behind it would replay as a different market.
 *
 * Those rows are bookkeeping. The public tape classified anything with a
 * negative cost as a sell, so one buy appeared as three trades under the
 * trader's name, two of them sells they never placed (participant report
 * 2026-08-31, Quroe: one 3,900-credit buy, rendered as a buy plus two sells).
 *
 * The rule these tests hold: `trades.kind` marks a redemption row, the price
 * replay keeps reading every row, and every human-facing list either omits
 * the redemption (a tape of trades against the market) or shows it once, as
 * a redemption (a participant's own history).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

jest.mock('../middleware/roles', () => ({
  ...jest.requireActual('../middleware/roles'),
  requireCapability: (cap: string) => (req: any, res: any, next: any) => {
    if (!req.auth?.capabilities?.has(cap)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireIdentity: (_req: any, _res: any, next: any) => next(),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireSelfOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq, sql } from 'drizzle-orm';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { agents, markets, metrics, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { agentsRouter } from '../routes/agents';
import { marketplaceRouter } from '../routes/marketplace';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/agents', authMiddleware, agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

const WS = 'ws-redeem';
const TRADER = 'agent-redeemer';
const MARKET = 'market-redeem-2028';

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'agent-owner-redeem', apiKeyHash: 'h-owner-redeem', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-redeemer', balance: toUnits(5000), nickname: 'Redeemer' },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Redeem Test',
    createdBy: 'agent-owner-redeem',
    ownerAgentId: 'agent-owner-redeem',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-redeem',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-redeem',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 500,
    pool: initialPool(500),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
});

function trade(body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

/** Quroe's shape: a small position, then a large buy on the other side. */
async function buyThenReverse() {
  const first = await trade({ direction: 'higher', amount: 20 });
  expect(first.status).toBe(201);
  const second = await trade({ direction: 'lower', amount: 300 });
  expect(second.status).toBe(201);
  expect(second.body.redeemed).toBeGreaterThan(0);
  return { first, second };
}

function tape() {
  return request(app).get(`/api/marketplace/${WS}/market-activity`).query({ marketId: MARKET });
}

describe('a redemption is not a trade', () => {
  test('the redemption rows are marked, the buy that caused them is not', async () => {
    await buyThenReverse();
    const rows = await db.select().from(trades).where(eq(trades.marketId, MARKET)).orderBy(trades.createdAt);
    const redeemed = rows.filter(r => r.kind === 'redeem');
    const traded = rows.filter(r => r.kind === 'trade');
    expect(traded).toHaveLength(2);
    expect(redeemed).toHaveLength(2);
    // Both sides of the pair, same size, one instant.
    expect(redeemed.map(r => r.direction).sort()).toEqual(['higher', 'lower']);
    expect(redeemed[0].shares).toBeCloseTo(redeemed[1].shares, 9);
    expect(redeemed[0].createdAt.getTime()).toBe(redeemed[1].createdAt.getTime());
  });

  test('the public tape shows one row per trade, and never a sell nobody placed', async () => {
    await buyThenReverse();
    const res = await tape();
    expect(res.status).toBe(200);
    expect(res.body.trades).toHaveLength(2);
    expect(res.body.trades.every((t: { kind: string }) => t.kind === 'buy')).toBe(true);
  });

  test('a real sell still reads as a sell', async () => {
    const buy = await trade({ direction: 'higher', amount: 50 });
    expect(buy.status).toBe(201);
    const sell = await trade({ direction: 'higher', sellShares: buy.body.shares / 2 });
    expect(sell.status).toBe(201);

    const res = await tape();
    expect(res.body.trades.map((t: { kind: string }) => t.kind).sort()).toEqual(['buy', 'sell']);
  });

  test("the trader's own history shows the redemption once, as a redemption", async () => {
    await buyThenReverse();
    const res = await request(app)
      .get(`/api/agents/${TRADER}/trades`)
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS);
    expect(res.status).toBe(200);

    const kinds = res.body.map((r: { kind: string }) => r.kind);
    expect(kinds.filter((k: string) => k === 'redeem')).toHaveLength(1);
    expect(kinds.filter((k: string) => k === 'buy')).toHaveLength(2);
    expect(kinds).not.toContain('sell');

    const redeem = res.body.find((r: { kind: string }) => r.kind === 'redeem');
    // A pair pays exactly 1 credit, to the trader: cost is signed the way the
    // ledger signs it (negative when credits came back), and both sides of the
    // pair are summed into the one row.
    expect(redeem.cost).toBeCloseTo(-redeem.shares, 6);
    expect(redeem.shares).toBeGreaterThan(0);
    expect(redeem.direction).toBeNull();
  });

  test('the floor does not count a redemption as trading activity', async () => {
    await buyThenReverse();
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    expect(res.body.tradesThisWeek).toBe(2);
  });

  test('the price replay still reads every row, so the chart is unchanged', async () => {
    await buyThenReverse();
    const points = await request(app)
      .get(`/api/predictions/markets/${MARKET}/trades`)
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS);
    expect(points.status).toBe(200);
    expect(points.body).toHaveLength(4);

    const [live] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const last = points.body[points.body.length - 1];
    // The replay's last point is the live price by construction; a redemption
    // moves the price by nothing, so the two redemption points sit flat on it.
    const p = 1 / (1 + Math.exp(-((live.shares as number[])[1] - (live.shares as number[])[0]) / live.liquidity));
    // The replay rounds to the cent; the point is that it lands on the live
    // price rather than on a book two rows short of it.
    expect(last.consensus).toBeCloseTo(live.rangeMin + p * (live.rangeMax - live.rangeMin), 2);
    expect(points.body[2].consensus).toBeCloseTo(last.consensus, 6);
  });

  test('the migration reclassifies redemptions written before the column existed', async () => {
    // Legacy rows: the pair as it was written before `kind`, i.e. as trades.
    const at = new Date();
    await db.insert(trades).values([
      {
        id: 'legacy-buy',
        workspaceId: WS,
        agentId: TRADER,
        marketId: MARKET,
        direction: 'lower',
        shares: 300,
        cost: 200,
        createdAt: new Date(at.getTime() - 1000),
        kind: 'trade',
      },
      {
        id: 'legacy-sell',
        workspaceId: WS,
        agentId: TRADER,
        marketId: MARKET,
        direction: 'higher',
        shares: -12,
        cost: -4,
        createdAt: new Date(at.getTime() - 2000),
        kind: 'trade',
      },
      {
        id: 'legacy-redeem-higher',
        workspaceId: WS,
        agentId: TRADER,
        marketId: MARKET,
        direction: 'higher',
        shares: -4.8,
        cost: -1.25,
        createdAt: at,
        kind: 'trade',
      },
      {
        id: 'legacy-redeem-lower',
        workspaceId: WS,
        agentId: TRADER,
        marketId: MARKET,
        direction: 'lower',
        shares: -4.8,
        cost: -3.55,
        createdAt: at,
        kind: 'trade',
      },
    ]);

    // Run the migration's own backfill, not a copy of it, so this test fails
    // if the shipped SQL stops matching a redemption pair.
    const migration = readFileSync(join(__dirname, '../../drizzle/0096_trade_kind.sql'), 'utf8');
    const backfill = migration.match(/DO \$\$[\s\S]*?END \$\$;/);
    expect(backfill).not.toBeNull();
    await db.execute(sql.raw(backfill![0]));

    const rows = await db
      .select()
      .from(trades)
      .where(and(eq(trades.workspaceId, WS), eq(trades.kind, 'redeem')));
    expect(rows.map(r => r.id).sort()).toEqual(['legacy-redeem-higher', 'legacy-redeem-lower']);
  });
});

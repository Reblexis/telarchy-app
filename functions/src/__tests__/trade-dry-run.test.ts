/**
 * A trade you can ask about without holding credits.
 *
 * The wall a new participant hits is that an API registration mints zero
 * credits, so its first write is refused and it has seen nothing of how the
 * market behaves. A dry run answers the question it actually had, which is
 * "what would this do", without minting anything: the owner rule (Viktor,
 * 2026-08-31) is that a participant receives credits only from another
 * participant, and a quote is not credits.
 *
 * The outside voice's objection to this shipping alone was that "exact fill"
 * cannot stay exact between a simulation and an execution. That is why a dry
 * run is not a second implementation: it runs the same transaction as a real
 * trade and rolls it back, and it reports the market state it was computed
 * against so a caller can tell a stale quote from a fresh one. The test that
 * carries that weight is `a dry run predicts exactly what the real trade then
 * does`; the rest guard the promise that nothing moved.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      const id = req.headers['x-test-agent-id'];
      req.auth = id
        ? { agentId: id, workspaceId: req.headers['x-workspace-id'], capabilities: new Set(['read', 'trade']) }
        : { workspaceId: req.headers['x-workspace-id'], capabilities: new Set(['read']) };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, positions, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

const WS = 'ws-dry-run';
const OWNER = 'agent-dry-owner';
const BROKE = 'broke-bot';
const FUNDED = 'funded-bot';
const METRIC = 'metric-dry';
const MARKET = 'market-dry';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-dry-owner', balance: toUnits(0) },
    { id: BROKE, apiKeyHash: 'h-broke', balance: toUnits(0) },
    { id: FUNDED, apiKeyHash: 'h-funded', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Dry Run',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BROKE, FUNDED] })
    .where(eq(permissionGroups.id, trader.id));

  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
}

const post = (agentId: string | null, body: Record<string, unknown>) => {
  let r = request(app).post('/api/predictions/trade').set('X-Workspace-Id', WS).set('Content-Type', 'application/json');
  if (agentId) r = r.set('X-Test-Agent-Id', agentId);
  return r.send(body);
};
const buy = { marketId: MARKET, direction: 'higher', amount: 5 };

const marketRow = async () => (await db.select().from(markets).where(eq(markets.id, MARKET)))[0];
const balanceOf = async (id: string) =>
  fromUnits((await db.select().from(agents).where(eq(agents.id, id)))[0].balance as number);

describe('a dry run answers without spending', () => {
  test('THE RULE: a dry run moves nothing', async () => {
    const before = await marketRow();
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.status).toBe(200);

    const after = await marketRow();
    expect(after.shares).toEqual(before.shares);
    expect(after.pool).toEqual(before.pool);
    expect(await balanceOf(FUNDED)).toBe(1000);
    expect(await db.select().from(trades)).toHaveLength(0);
    expect(await db.select().from(positions)).toHaveLength(0);
  });

  test('a participant with no credits still gets the quote', async () => {
    // The whole reason this exists: the first write of a fresh registration
    // should show the market working, not a refusal.
    const res = await post(BROKE, { ...buy, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.shares).toBeGreaterThan(0);
    expect(res.body.cost).toBeGreaterThan(0);
    expect(res.body.dryRun).toBe(true);
  });

  test('and is told plainly that it could not afford it', async () => {
    const res = await post(BROKE, { ...buy, dryRun: true });
    expect(res.body.affordable).toBe(false);
    expect(res.body.balance).toBe(0);
    expect(res.body.shortfall).toBeCloseTo(res.body.cost, 6);
  });

  test('a funded participant is told it could', async () => {
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.body.affordable).toBe(true);
    expect(res.body.shortfall).toBe(0);
  });

  test('EXACTNESS: a dry run predicts exactly what the real trade then does', async () => {
    // The promise the outside voice doubted. It holds only because the dry run
    // is the same transaction, rolled back, rather than a second model of it.
    const quote = await post(FUNDED, { ...buy, dryRun: true });
    const real = await post(FUNDED, buy);
    expect(real.status).toBe(201);
    expect({
      shares: real.body.shares,
      cost: real.body.cost,
      consensus: real.body.consensus,
      probability: real.body.probability,
      direction: real.body.direction,
    }).toEqual({
      shares: quote.body.shares,
      cost: quote.body.cost,
      consensus: quote.body.consensus,
      probability: quote.body.probability,
      direction: quote.body.direction,
    });
  });

  test('the quote says which market state it was computed against', async () => {
    // A quote with no basis cannot be told apart from a stale one. tradeCount
    // and liquidity move whenever the answer would change.
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.body.basis).toEqual(
      expect.objectContaining({ tradeCount: 0, liquidity: 100, consensus: expect.any(Number) }),
    );
  });

  test('a stale quote is visible: the basis changes once someone trades', async () => {
    const first = await post(FUNDED, { ...buy, dryRun: true });
    await post(FUNDED, buy);
    const second = await post(FUNDED, { ...buy, dryRun: true });
    expect(second.body.basis.tradeCount).not.toBe(first.body.basis.tradeCount);
  });
});

describe('a dry run refuses everything a real trade refuses', () => {
  test('a resolved market', async () => {
    await db.update(markets).set({ resolved: true }).where(eq(markets.id, MARKET));
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.status).toBe(400);
  });

  test('a voided market', async () => {
    await db.update(markets).set({ voided: true }).where(eq(markets.id, MARKET));
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.status).toBe(400);
  });

  test('a buy on a closed market', async () => {
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));
    const res = await post(FUNDED, { ...buy, dryRun: true });
    expect(res.status).toBe(400);
  });

  test('an anonymous caller: quoting is not a way around needing an identity', async () => {
    const res = await post(null, { ...buy, dryRun: true });
    expect(res.status).toBe(403);
  });

  test('a malformed body is still malformed', async () => {
    const res = await post(FUNDED, { marketId: MARKET, dryRun: true });
    expect(res.status).toBe(400);
  });
});

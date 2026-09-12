/**
 * The price guard on a trade (docs/guides/agent-api.md, "Guard the price").
 *
 * Owner ask, 2026-09-12: "make it more realtime and the guard as well.. but
 * ... dont block the actual trade". Two trades on one book queue, and the
 * second silently executed against the curve the first left. A trade may now
 * carry `limit`, a call on the book's own scale, and fills only as far as
 * the call stays on its side of it. What is pinned here:
 *
 * - the bound is direction-aware, one rule, four combinations;
 * - a trade that can partly fill is never refused: it fills to the limit and
 *   hands back what it did not spend;
 * - the one refusal is `price_moved`, when nothing at all fits, and it spends
 *   nothing;
 * - the guard never flips side, and the old targetValue flip is gone for a
 *   request that names its direction (and kept, documented, for one that
 *   does not);
 * - it is evaluated against the locked book, so two guarded trades arriving
 *   together each see the price the other left;
 * - the trade never waits on the price channel.
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
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, positions, trades } from '../db/schema';
import { boundSide, initialPool, pHigher, sharesForBudget, sharesToBound } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { provisionWorkspace } from '../lib/participants';
import { setPriceTransport } from '../lib/price-channel';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use(apiErrorHandler);

const WS = 'ws-guard';
const MARKET = 'market-guard';
const TRADER = 'agent-guard-trader';
const OTHER = 'agent-guard-other';
const B = 200;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  setPriceTransport(null);
  await db.insert(agents).values([
    { id: 'agent-guard-owner', apiKeyHash: 'h-go', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-gt', balance: toUnits(1000) },
    { id: OTHER, apiKeyHash: 'h-gx', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Guard',
    createdBy: 'agent-guard-owner',
    ownerAgentId: 'agent-guard-owner',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-guard',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-guard',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
});
afterAll(() => setPriceTransport(null));

function trade(agentId: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

/** The call, unrounded: the consensus the response rounds to cents. */
async function callNow(): Promise<number> {
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return m.rangeMin + pHigher(m.shares as [number, number], m.liquidity) * (m.rangeMax - m.rangeMin);
}

async function bookNow(): Promise<[number, number]> {
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return m.shares as [number, number];
}

async function tradeRows(): Promise<number> {
  return (await db.select().from(trades).where(eq(trades.marketId, MARKET))).length;
}

async function held(agentId: string, direction: 'higher' | 'lower'): Promise<number> {
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.marketId, MARKET), eq(positions.direction, direction)));
  return (row?.shares as number) ?? 0;
}

describe('THE BOUND FOLLOWS THE WAY A TRADE PUSHES THE CALL', () => {
  test('buying higher pushes the call up, so its limit is a ceiling', () => {
    expect(boundSide(1, false)).toBe('ceiling');
  });
  test('buying lower pushes the call down, so its limit is a floor', () => {
    expect(boundSide(0, false)).toBe('floor');
  });
  test('selling higher pushes the call down, so its limit is a floor', () => {
    expect(boundSide(1, true)).toBe('floor');
  });
  test('selling lower pushes the call up, so its limit is a ceiling', () => {
    expect(boundSide(0, true)).toBe('ceiling');
  });

  test('the room to a bound is the share move that lands the call exactly on it', () => {
    const room = sharesToBound([0, 0], B, 0, 100, 1, false, 60);
    expect(room).toBeCloseTo(B * Math.log(0.6 / 0.4), 9);
    const after = 100 * pHigher([0, room], B);
    expect(after).toBeCloseTo(60, 9);
    expect(sharesToBound([0, 0], B, 0, 100, 0, false, 40)).toBeCloseTo(B * Math.log(0.6 / 0.4), 9);
    expect(sharesToBound([0, 0], B, 0, 100, 1, true, 40)).toBeCloseTo(B * Math.log(0.6 / 0.4), 9);
    expect(sharesToBound([0, 0], B, 0, 100, 0, true, 60)).toBeCloseTo(B * Math.log(0.6 / 0.4), 9);
  });

  test('a bound at or behind the call leaves no room, a bound off the far edge leaves all of it', () => {
    expect(sharesToBound([0, 0], B, 0, 100, 1, false, 50)).toBe(0);
    expect(sharesToBound([0, 0], B, 0, 100, 1, false, 30)).toBe(0);
    expect(sharesToBound([0, 0], B, 0, 100, 1, false, -5)).toBe(0);
    expect(sharesToBound([0, 0], B, 0, 100, 1, false, 100)).toBe(Number.POSITIVE_INFINITY);
    expect(sharesToBound([0, 0], B, 0, 100, 0, false, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(sharesToBound([0, 0], B, 0, 100, 0, false, 70)).toBe(0);
  });
});

describe('A GUARDED TRADE FILLS UP TO ITS LIMIT AND RETURNS THE REST', () => {
  test('a buy of higher stops at its ceiling and debits only what it spent', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 500, limit: 55 });
    expect(res.status).toBe(201);
    expect(res.body.direction).toBe('higher');
    expect(res.body.limited).toBe(true);
    expect(res.body.spent).toBeGreaterThan(0);
    expect(res.body.spent).toBeLessThan(500);
    expect(res.body.spent + res.body.unspent).toBeCloseTo(500, 6);
    expect(res.body.consensus).toBeCloseTo(55, 1);
    const call = await callNow();
    expect(call).toBeLessThanOrEqual(55 + 1e-6);
    expect(call).toBeGreaterThan(54.99);
    expect(await balanceOf(TRADER)).toBeCloseTo(1000 - res.body.spent, 6);
  });

  test('a buy of lower stops at its floor', async () => {
    const res = await trade(TRADER, { direction: 'lower', amount: 500, limit: 45 });
    expect(res.status).toBe(201);
    expect(res.body.limited).toBe(true);
    expect(res.body.spent + res.body.unspent).toBeCloseTo(500, 6);
    const call = await callNow();
    expect(call).toBeGreaterThanOrEqual(45 - 1e-6);
    expect(call).toBeLessThan(45.01);
    expect(await balanceOf(TRADER)).toBeCloseTo(1000 - res.body.spent, 6);
  });

  test('a sell of higher stops at its floor and the shares it did not sell stay held', async () => {
    const bought = await trade(TRADER, { direction: 'higher', amount: 100 });
    expect(bought.status).toBe(201);
    const shares = await held(TRADER, 'higher');
    const call = await callNow();
    const res = await trade(TRADER, { direction: 'higher', sellShares: shares, limit: call - 3 });
    expect(res.status).toBe(201);
    expect(res.body.limited).toBe(true);
    expect(res.body.sharesSold).toBeGreaterThan(0);
    expect(res.body.sharesSold).toBeLessThan(shares);
    expect(res.body.sharesSold + res.body.sharesKept).toBeCloseTo(shares, 6);
    expect(await held(TRADER, 'higher')).toBeCloseTo(res.body.sharesKept, 6);
    expect(await callNow()).toBeGreaterThanOrEqual(call - 3 - 1e-6);
  });

  test('a sell of lower stops at its ceiling', async () => {
    await trade(TRADER, { direction: 'lower', amount: 100 });
    const shares = await held(TRADER, 'lower');
    const call = await callNow();
    const res = await trade(TRADER, { direction: 'lower', sellShares: shares, limit: call + 3 });
    expect(res.status).toBe(201);
    expect(res.body.limited).toBe(true);
    expect(res.body.sharesSold + res.body.sharesKept).toBeCloseTo(shares, 6);
    expect(await held(TRADER, 'lower')).toBeCloseTo(res.body.sharesKept, 6);
    expect(await callNow()).toBeLessThanOrEqual(call + 3 + 1e-6);
  });

  test('a limit that does not bind fills in full and says so', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 10, limit: 90 });
    expect(res.status).toBe(201);
    expect(res.body.limited).toBe(false);
    expect(res.body.spent).toBeCloseTo(res.body.cost, 9);
    expect(res.body.unspent).toBeLessThan(0.001);
  });

  test('a trade without limit answers exactly as it always has', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 10 });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('limited');
    expect(res.body).not.toHaveProperty('spent');
  });
});

describe('NOTHING TRADABLE WITHIN THE LIMIT IS price_moved AND SPENDS NOTHING', () => {
  async function expectNothingSpent(body: Record<string, unknown>, agentId = TRADER) {
    const balance = await balanceOf(agentId);
    const book = await bookNow();
    const rows = await tradeRows();
    const call = await callNow();
    const res = await trade(agentId, body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('price_moved');
    expect(res.body.doc_url).toMatch(/error-codes/);
    expect(res.body.consensus).toBeCloseTo(call, 1);
    expect(typeof res.body.limit).toBe('number');
    expect(await balanceOf(agentId)).toBeCloseTo(balance, 9);
    expect(await bookNow()).toEqual(book);
    expect(await tradeRows()).toBe(rows);
  }

  test('a buy of higher whose ceiling is the call itself', async () => {
    await expectNothingSpent({ direction: 'higher', amount: 50, limit: 50 });
  });
  test('a buy of higher whose ceiling the call has already passed', async () => {
    await expectNothingSpent({ direction: 'higher', amount: 50, limit: 40 });
  });
  test('a buy of lower whose floor the call has already passed', async () => {
    await expectNothingSpent({ direction: 'lower', amount: 50, limit: 60 });
  });
  test('a sell of higher whose floor the call has already passed', async () => {
    await trade(TRADER, { direction: 'higher', amount: 50 });
    const call = await callNow();
    await expectNothingSpent({ direction: 'higher', sellShares: 1, limit: call + 1 });
    expect(await held(TRADER, 'higher')).toBeGreaterThan(1);
  });
  test('a sell of lower whose ceiling the call has already passed', async () => {
    await trade(TRADER, { direction: 'lower', amount: 50 });
    const call = await callNow();
    await expectNothingSpent({ direction: 'lower', sellShares: 1, limit: call - 1 });
  });
  test('a failed guarded trade does not burn its Idempotency-Key', async () => {
    const first = await trade(TRADER, { direction: 'higher', amount: 50, limit: 40 }).set('Idempotency-Key', 'k-1');
    expect(first.status).toBe(409);
    const second = await trade(TRADER, { direction: 'higher', amount: 50, limit: 40 }).set('Idempotency-Key', 'k-1');
    expect(second.status).toBe(409);
    expect(second.body.idempotentReplay).toBeUndefined();
  });
});

describe('THE GUARD NEVER FLIPS SIDE', () => {
  async function pushTo(value: number) {
    const res = await trade(OTHER, { targetValue: value, maxBudget: 5000 });
    expect(res.status).toBe(201);
  }

  test('a targetValue with direction and limit, on a book already past the target, is price_moved, never a buy of lower', async () => {
    await pushTo(70);
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 50, direction: 'higher', limit: 60 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('price_moved');
    expect(await held(TRADER, 'lower')).toBe(0);
    expect(await balanceOf(TRADER)).toBeCloseTo(1000, 9);
  });

  test('a targetValue with direction and no limit is bound by its own target the same way', async () => {
    await pushTo(70);
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 50, direction: 'higher' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('price_moved');
    expect(await held(TRADER, 'lower')).toBe(0);
  });

  test('a targetValue with direction lands on its target when the book has not moved', async () => {
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 500, direction: 'higher' });
    expect(res.status).toBe(201);
    expect(res.body.direction).toBe('higher');
    expect(res.body.limited).toBe(false);
    expect(await callNow()).toBeCloseTo(55, 1);
  });

  test('a target beyond the limit stops at the limit', async () => {
    const res = await trade(TRADER, { targetValue: 80, maxBudget: 500, direction: 'higher', limit: 60 });
    expect(res.status).toBe(201);
    expect(res.body.limited).toBe(true);
    const call = await callNow();
    expect(call).toBeLessThanOrEqual(60 + 1e-6);
    expect(call).toBeGreaterThan(59.99);
  });

  test('a direction that contradicts itself is refused rather than guessed', async () => {
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 50, direction: 'sideways' });
    expect(res.status).toBe(400);
  });

  test('a targetValue with limit must name its direction', async () => {
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 50, limit: 60 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/direction/);
    expect(await tradeRows()).toBe(0);
  });
});

describe('A targetValue WITHOUT direction KEEPS ITS ORIGINAL, DOCUMENTED SIDE', () => {
  test('it picks its side from the call at landing, so a stale target buys the other side', async () => {
    // Kept deliberately: an existing public contract (docs/guides/agent-api.md,
    // "Guard the price", last paragraph). Send `direction` to opt out.
    const push = await trade(OTHER, { targetValue: 70, maxBudget: 5000 });
    expect(push.status).toBe(201);
    const res = await trade(TRADER, { targetValue: 55, maxBudget: 50 });
    expect(res.status).toBe(201);
    expect(res.body.direction).toBe('lower');
  });
});

describe('a dry run evaluates the guard', () => {
  test('it reports what would fill and changes nothing', async () => {
    const book = await bookNow();
    const res = await trade(TRADER, { direction: 'higher', amount: 500, limit: 55, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.limited).toBe(true);
    expect(res.body.spent + res.body.unspent).toBeCloseTo(500, 6);
    expect(res.body.consensus).toBeCloseTo(55, 1);
    expect(await bookNow()).toEqual(book);
    expect(await balanceOf(TRADER)).toBeCloseTo(1000, 9);
  });

  test('nothing tradable is price_moved on a dry run too', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 50, limit: 45, dryRun: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('price_moved');
  });
});

describe('a malformed limit', () => {
  test('a string is refused as the malformed request it is', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 50, limit: '55' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
    expect(await tradeRows()).toBe(0);
  });

  test('null is the same as leaving it out', async () => {
    const res = await trade(TRADER, { direction: 'higher', amount: 5, limit: null });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('limited');
  });
});

describe('TWO GUARDED BUYS ARRIVING TOGETHER: THE SECOND STOPS AT ITS LIMIT', () => {
  test('both quoted the same book; whichever lands second meets the price the first left', async () => {
    await db
      .update(agents)
      .set({ balance: toUnits(1000) })
      .where(eq(agents.id, OTHER));
    // What 100 cr of higher lands on from the untouched book, and a limit a
    // hair above it: the quote both traders read.
    const solo = sharesForBudget([0, 0], 1, 100, B);
    const landing = 100 * pHigher([0, solo.amount], B);
    const limit = landing + 0.5;

    const [a, b] = await Promise.all([
      trade(TRADER, { direction: 'higher', amount: 100, limit }),
      trade(OTHER, { direction: 'higher', amount: 100, limit }),
    ]);
    const results = [a, b];
    for (const r of results) expect(r.status).toBe(201);
    const full = results.filter(r => r.body.limited === false);
    const stopped = results.filter(r => r.body.limited === true);
    expect(full).toHaveLength(1);
    expect(stopped).toHaveLength(1);
    expect(full[0].body.spent).toBeCloseTo(100, 3);
    expect(stopped[0].body.spent).toBeGreaterThan(0);
    expect(stopped[0].body.spent).toBeLessThan(100);
    const call = await callNow();
    expect(call).toBeLessThanOrEqual(limit + 1e-6);
    const debited = 2000 - (await balanceOf(TRADER)) - (await balanceOf(OTHER));
    expect(debited).toBeCloseTo(full[0].body.spent + stopped[0].body.spent, 6);
  });
});

describe('THE TRADE NEVER WAITS ON THE PRICE CHANNEL', () => {
  test('a channel whose send never answers does not delay or fail the trade', async () => {
    let sends = 0;
    setPriceTransport({
      isLive: () => true,
      send: () => {
        sends++;
        return new Promise(() => {});
      },
    });
    const started = Date.now();
    const res = await trade(TRADER, { direction: 'higher', amount: 10, limit: 90 });
    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await tradeRows()).toBe(1);
    await new Promise(resolve => setImmediate(resolve));
    expect(sends).toBeGreaterThanOrEqual(1);
  });

  test('a channel that throws does not fail the trade', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setPriceTransport({
      isLive: () => {
        throw new Error('boom');
      },
      send: () => {
        throw new Error('boom');
      },
    });
    const res = await trade(TRADER, { direction: 'higher', amount: 10 });
    expect(res.status).toBe(201);
    await new Promise(resolve => setImmediate(resolve));
    spy.mockRestore();
  });

  test('the trade route awaits nothing of the channel (source pin)', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const src = readFileSync(require.resolve('../routes/predictions'), 'utf8');
    expect(src).not.toMatch(/await\s+[^;]*(announcePriceChange|pg_notify|priceTransport|setPriceTransport)/);
    const trading = readFileSync(require.resolve('../services/trading'), 'utf8');
    expect(trading).not.toMatch(/await\s+[^;]*(announcePriceChange|pg_notify)/);
  });
});

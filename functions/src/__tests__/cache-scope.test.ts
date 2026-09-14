/**
 * A PRICE CHANGE ON ONE FLOOR EMPTIES ONLY THAT FLOOR'S CACHES, AND THE BOARD
 * ONLY WHEN MONEY MOVED (docs/infra/deploy.md, "Prices, one channel across
 * instances").
 *
 * A machine-run floor changes a price every second: a book opens, a proposal
 * is funded, trading closes, an untraded book is voided. Before this, every
 * one of those emptied the leaderboard caches of every floor and the price
 * history of every market on the site, so no cache on any floor lived longer
 * than a second.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const boardLoads: string[] = [];
jest.mock('../lib/board', () => {
  const actual = jest.requireActual('../lib/board');
  return {
    ...actual,
    loadBoard: jest.fn(async (ids: string[]) => {
      boardLoads.push([...ids].sort().join(','));
      return { ids, n: boardLoads.length };
    }),
  };
});

import { agents, markets, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { emitPricesChanged, emitRemotePricesChanged, onPricesChanged } from '../lib/market-events';
import { receivePriceMessage, resetPriceAnnouncements, setPriceTransport } from '../lib/price-channel';
import { toUnits } from '../lib/validation';
import { cachedBoard, clearBoardCache, clearBoardCacheFor } from '../routes/leaderboard';
import { voidMarket } from '../services/markets';
import { marketPriceSeries } from '../services/predictions';
import { closeProposalTrading } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const seen: Array<{ ws: string; market?: string; money: boolean }> = [];
onPricesChanged((ws, market, _origin, change) => seen.push({ ws, market, money: change?.moneyMoved ?? true }));

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  setPriceTransport(null);
  resetPriceAnnouncements();
  await truncateAll();
  clearBoardCache();
  boardLoads.length = 0;
  seen.length = 0;
});

const loadsOf = (key: string) => boardLoads.filter(k => k === key).length;

async function warmBoards() {
  await cachedBoard(['A']);
  await cachedBoard(['B']);
  await cachedBoard(['A', 'B']);
  expect(boardLoads).toHaveLength(3);
}

describe('THE BOARD IS EMPTIED ONLY FOR THE FLOOR WHERE MONEY MOVED', () => {
  test("A TRADE ON ONE FLOOR DOES NOT EMPTY ANOTHER FLOOR'S CACHED BOARD", async () => {
    await warmBoards();
    emitRemotePricesChanged('A', 'm-1', { moneyMoved: true });
    await cachedBoard(['B']);
    expect(loadsOf('B')).toBe(1);
    await cachedBoard(['A']);
    await cachedBoard(['A', 'B']);
    expect(loadsOf('A')).toBe(2);
    expect(loadsOf('A,B')).toBe(2);
  });

  test('a trade taken on this instance empties the boards of its floor once it commits, and no other', async () => {
    await warmBoards();
    await db.transaction(async () => {
      emitPricesChanged('A', 'm-1');
    });
    await cachedBoard(['B']);
    await cachedBoard(['A']);
    expect(loadsOf('B')).toBe(1);
    expect(loadsOf('A')).toBe(2);
  });

  test('the trade route empties only the boards that include its floor', async () => {
    await warmBoards();
    clearBoardCacheFor('B');
    await cachedBoard(['A']);
    await cachedBoard(['B']);
    await cachedBoard(['A', 'B']);
    expect(loadsOf('A')).toBe(1);
    expect(loadsOf('B')).toBe(2);
    expect(loadsOf('A,B')).toBe(2);
  });

  test('A SPAWN, A FUNDING OR A CLOSE OF TRADING DOES NOT EMPTY THE BOARD', async () => {
    await warmBoards();
    emitPricesChanged('A', 'm-new', { moneyMoved: false });
    emitPricesChanged('A', undefined, { moneyMoved: false });
    emitRemotePricesChanged('A', 'm-new', { moneyMoved: false });
    await cachedBoard(['A']);
    await cachedBoard(['A', 'B']);
    expect(boardLoads).toHaveLength(3);
  });

  test('a message from another instance empties the board only when it says money moved; an older message without the flag still does', async () => {
    await warmBoards();
    receivePriceMessage(JSON.stringify({ i: 'other', s: 'production', w: 'A', k: 0 }));
    await cachedBoard(['A']);
    expect(loadsOf('A')).toBe(1);
    receivePriceMessage(JSON.stringify({ i: 'other', s: 'production', w: 'A' }));
    await cachedBoard(['A']);
    expect(loadsOf('A')).toBe(2);
  });
});

async function seedFloor(ws: string) {
  await db
    .insert(workspaces)
    .values({ id: ws, name: ws, slug: ws.toLowerCase(), createdBy: 'op', visibility: 'public' });
}

function book(ws: string, id: string, extra: Partial<typeof markets.$inferInsert> = {}) {
  return {
    id,
    workspaceId: ws,
    metricId: 'len',
    metricName: 'Game score',
    targetDate: '2026-09-15T08:00',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    ...extra,
  } as typeof markets.$inferInsert;
}

describe('the write paths say whether money moved', () => {
  test('VOIDING AN UNTRADED BOOK MOVES NO MONEY; VOIDING A TRADED ONE DOES', async () => {
    await seedFloor('W');
    await db.insert(agents).values({ id: 'trader', apiKeyHash: 'h-t', balance: toUnits(100) });
    await db.insert(markets).values([book('W', 'm-untraded'), book('W', 'm-traded')]);
    await db.insert(trades).values({
      id: 't-1',
      workspaceId: 'W',
      agentId: 'trader',
      marketId: 'm-traded',
      direction: 'higher',
      shares: 1,
      cost: 1,
      kind: 'trade',
    } as typeof trades.$inferInsert);
    await voidMarket('m-untraded', 'W');
    await voidMarket('m-traded', 'W');
    expect(seen.filter(s => s.market === 'm-untraded').map(s => s.money)).toEqual([false]);
    expect(seen.filter(s => s.market === 'm-traded').map(s => s.money)).toEqual([true]);
  });

  test("CLOSING A PROPOSAL'S TRADING MOVES NO MONEY and names each of its books", async () => {
    await seedFloor('W');
    await db.insert(proposals).values({
      id: 'p-1',
      workspaceId: 'W',
      number: 1,
      title: 'Game 1, move 1: play now?',
      proposedBy: 'op',
      status: 'declined',
    } as typeof proposals.$inferInsert);
    await db
      .insert(markets)
      .values([
        book('W', 'm-yes', { proposalId: 'p-1', branch: 'approved' }),
        book('W', 'm-no', { proposalId: 'p-1', branch: 'declined' }),
      ]);
    await closeProposalTrading('p-1', 'W');
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.money).toBe(false);
    expect(seen.map(s => s.market).sort()).toEqual(['m-no', 'm-yes']);
  });

  test("a proposal's books opening with their funding move no money (the spawn path says so)", () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const src = readFileSync(require.resolve('../services/proposals'), 'utf8');
    expect(src).toMatch(
      /for \(const r of liqRows\) emitPricesChanged\(workspaceId, r\.marketId, \{ moneyMoved: false \}\)/,
    );
    const marketsSrc = readFileSync(require.resolve('../services/markets'), 'utf8');
    expect(marketsSrc).toMatch(
      /for \(const e of newLiqEvents\) emitPricesChanged\(workspaceId, e\.marketId, \{ moneyMoved: false \}\)/,
    );
  });
});

describe("A FLOOR-WIDE CHANGE DROPS ONLY THAT FLOOR'S PRICE HISTORIES", () => {
  test("a change on floor A keeps floor B's replay cached; a change on B drops it", async () => {
    await seedFloor('A');
    await seedFloor('B');
    await db.insert(agents).values({ id: 'trader', apiKeyHash: 'h-t', balance: toUnits(100) });
    await db.insert(markets).values(book('B', 'm-b'));
    await db.insert(trades).values({
      id: 't-b',
      workspaceId: 'B',
      agentId: 'trader',
      marketId: 'm-b',
      direction: 'higher',
      shares: 1,
      cost: 1,
      kind: 'trade',
    } as typeof trades.$inferInsert);
    const first = await marketPriceSeries('m-b', 'B');
    expect(first.length).toBeGreaterThan(0);

    // A second trade lands behind the cache's back: only a reload sees it.
    await db.insert(trades).values({
      id: 't-b2',
      workspaceId: 'B',
      agentId: 'trader',
      marketId: 'm-b',
      direction: 'higher',
      shares: 5,
      cost: 5,
      kind: 'trade',
      createdAt: new Date(Date.now() + 1000),
    } as typeof trades.$inferInsert);

    emitRemotePricesChanged('A');
    emitPricesChanged('A');
    expect(await marketPriceSeries('m-b', 'B')).toEqual(first);

    // Dropped: the reload sees the second trade, which is why the equality
    // above means the cache was kept rather than that nothing changed.
    emitRemotePricesChanged('B');
    expect(await marketPriceSeries('m-b', 'B')).not.toEqual(first);
  });
});

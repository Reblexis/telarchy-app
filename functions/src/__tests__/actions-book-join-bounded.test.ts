/**
 * A LOG BRANCH JOINS ITS BOOK ONLY FOR THE ROWS A PAGE CAN SHOW.
 *
 * The order, trade, liquidity and book-comment branches of the actions log
 * name the book each row is about, which is a LEFT JOIN to markets. The join
 * sat before the branch's LIMIT, so Postgres hashed every book of the floor to
 * decorate the newest 51 rows: on 2026-09-13 the Snake held 32k books, and the
 * orders-only read the Snake stream polls (4,980 calls in a day) averaged
 * 174 ms and read 3,600 blocks a call, most of them `markets`
 * (docs/infra/deploy.md, "Reads are bounded in the size of a workspace").
 *
 * The answer must not change: same rows, same order, same tie-break, every
 * row still naming its book.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, limitOrders, liquidityEvents, marketMessages, markets, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { buildActions } from '../services/actions';
import { clearDataRoomCache } from '../services/data-room';
import { captureQueries, rowsRead } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-books';
const BOOKS = 1_500;
const ORDERS = 120;
const TRADES = 90;
const INJECTIONS = 45;
const COMMENTS = 30;
const START = Date.parse('2026-09-12T00:00:00Z');
const HOUR = 3_600_000;
const KINDS = ['order', 'trade', 'liquidity', 'comment'];
const pad = (i: number) => String(i).padStart(4, '0');
const book = (i: number) => `mk-${pad((i * 7) % BOOKS)}`;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
  await db.insert(workspaces).values({ id: WS, name: 'Books', slug: 'books', createdBy: 'bot', visibility: 'public' });
  await db.insert(agents).values({ id: 'bot', apiKeyHash: 'h-bot', balance: toUnits(1_000), nickname: 'bot' });
  const rows: Array<typeof markets.$inferInsert> = Array.from({ length: BOOKS }, (_, i) => ({
    id: `mk-${pad(i)}`,
    workspaceId: WS,
    metricId: 'len',
    metricName: 'Length',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 36,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
    createdAt: new Date(START - HOUR),
  }));
  for (let i = 0; i < rows.length; i += 500) await db.insert(markets).values(rows.slice(i, i + 500));
  // Ties on purpose: four orders share each instant, so pages cut through
  // groups of equal timestamps and the id tie-break is exercised.
  const statuses = ['open', 'filled', 'cancelled', 'expired'];
  await db.insert(limitOrders).values(
    Array.from({ length: ORDERS }, (_, i) => ({
      id: `lo-${pad(i)}`,
      workspaceId: WS,
      marketId: book(i),
      agentId: 'bot',
      side: 'buy',
      direction: 'higher',
      limitValue: 5,
      budgetCredits: 10,
      status: statuses[i % 4],
      createdAt: new Date(START + Math.floor(i / 4) * 1_000),
      updatedAt: new Date(START + HOUR + Math.floor(i / 4) * 1_000),
    })),
  );
  await db.insert(trades).values(
    Array.from({ length: TRADES }, (_, i) => ({
      id: `tr-${pad(i)}`,
      workspaceId: WS,
      agentId: 'bot',
      marketId: book(i),
      direction: 'higher',
      shares: 1,
      cost: 2,
      kind: 'trade',
      createdAt: new Date(START + 2 * HOUR + Math.floor(i / 3) * 1_000),
    })),
  );
  await db.insert(liquidityEvents).values(
    Array.from({ length: INJECTIONS }, (_, i) => ({
      id: `li-${pad(i)}`,
      workspaceId: WS,
      marketId: book(i),
      amount: 50,
      totalLiquidity: 100,
      type: 'injection',
      agentId: 'bot',
      createdAt: new Date(START + 3 * HOUR + Math.floor(i / 3) * 1_000),
    })),
  );
  await db.insert(marketMessages).values(
    Array.from({ length: COMMENTS }, (_, i) => ({
      id: `mm-${pad(i)}`,
      workspaceId: WS,
      marketId: book(i),
      from: 'bot',
      content: `note ${i}`,
      createdAt: new Date(START + 4 * HOUR + Math.floor(i / 2) * 1_000),
    })),
  );
});

describe('A LOG BRANCH JOINS ITS BOOK ONLY FOR THE ROWS A PAGE CAN SHOW', () => {
  test('paging the floor still yields every action once, newest first, ties by id, each naming its book', async () => {
    const seen: Array<{ id: string; at: string; text: string }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await buildActions({ workspace: 'books', kinds: KINDS, limit: 17, cursor });
      for (const r of res.rows) seen.push({ id: r.id, at: r.at, text: r.text });
      if (!res.next) break;
      cursor = res.next;
    }
    const expected = ORDERS + (ORDERS * 3) / 4 + TRADES + INJECTIONS + COMMENTS;
    expect(seen).toHaveLength(expected);
    expect(new Set(seen.map(s => s.id)).size).toBe(expected);
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1];
      const b = seen[i];
      const ordered = Date.parse(a.at) > Date.parse(b.at) || (a.at === b.at && a.id > b.id);
      if (!ordered) throw new Error(`out of order at ${i}: ${a.at} ${a.id} then ${b.at} ${b.id}`);
    }
    for (const s of seen) expect(s.text).not.toMatch(/since removed/);
  });

  test.each([
    ['one floor', { workspace: 'books' }],
    ['every floor', {}],
  ])('the %s read joins no more books than its branches can show', async (_label, scope) => {
    const log = captureQueries();
    try {
      await buildActions({ ...scope, kinds: KINDS, limit: 20 });
    } finally {
      log.stop();
    }
    const union = log.stats.find(s => s.sql.includes('UNION ALL') && s.sql.includes('u.payload'));
    expect(union).toBeDefined();
    // Six branches name a book (two order branches, trades, injections,
    // subsidies, book comments), each cut to limit + 1 = 21 rows.
    expect(await rowsRead(union!, 'markets')).toBeLessThanOrEqual(6 * 21);
  });
});

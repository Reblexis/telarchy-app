/**
 * THE SUBSIDY ROWS OF THE LOG JOIN ONLY THE MINUTES A PAGE CAN SHOW.
 *
 * A proposal's subsidy lands on every branch book at once, and the log shows
 * those rows as one action per proposal, funder and minute (docs/data-room.md).
 * Grouping needs the rows before the LIMIT, and the branch used to join and
 * group every subsidy event a floor ever had. On 2026-09-13 the Snake floor
 * held 25,357 of them (4,000 more a day), that one branch took 13.5 seconds on
 * production, every viewer of the floor's Live column asked for it, and the
 * API starved its connection pool: every page answered 500 for minutes.
 *
 * The answer must not change (pages still partition the log exactly), and the
 * joins must stay in the size of a page, not of the floor's history.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, liquidityEvents, markets, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { buildActions } from '../services/actions';
import { clearDataRoomCache } from '../services/data-room';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-snake';
const MINUTES = 400;
const START = Date.parse('2026-09-12T00:00:00Z');

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
  await db.insert(workspaces).values({ id: WS, name: 'Snake', slug: 'snake', createdBy: 'op', visibility: 'public' });
  await db.insert(agents).values({ id: 'op', apiKeyHash: 'h-op', balance: toUnits(1_000_000), nickname: 'snake' });
  await db.insert(proposals).values(
    Array.from({ length: MINUTES }, (_, i) => ({
      id: `p${i}`,
      workspaceId: WS,
      number: i + 1,
      title: `Game 1, attempt 1, move ${i + 1}`,
      proposedBy: 'op',
      status: 'approved',
      createdAt: new Date(START + i * 60_000),
    })) as Array<typeof proposals.$inferInsert>,
  );
  const books: Array<typeof markets.$inferInsert> = [];
  const events: Array<typeof liquidityEvents.$inferInsert> = [];
  for (let i = 0; i < MINUTES; i++) {
    for (const option of ['forward', 'left', 'right']) {
      const id = `m${i}-${option}`;
      books.push({
        id,
        workspaceId: WS,
        metricId: 'len',
        metricName: 'Reached length',
        targetDate: '2026-09-12T08:00',
        rangeMin: 0,
        rangeMax: 36,
        shares: [0, 0] as [number, number],
        liquidity: 10,
        pool: initialPool(10),
        active: true,
        resolved: false,
        voided: false,
        proposalId: `p${i}`,
        branch: option,
        createdAt: new Date(START + i * 60_000),
      });
      events.push({
        id: `e${i}-${option}`,
        workspaceId: WS,
        marketId: id,
        amount: 100,
        totalLiquidity: 100,
        type: 'proposal-subsidy',
        agentId: 'op',
        createdAt: new Date(START + i * 60_000 + 1_000 + ['forward', 'left', 'right'].indexOf(option) * 100),
      });
    }
  }
  for (let i = 0; i < books.length; i += 400) await db.insert(markets).values(books.slice(i, i + 400));
  for (let i = 0; i < events.length; i += 400) await db.insert(liquidityEvents).values(events.slice(i, i + 400));
});

describe('THE SUBSIDY ROWS OF THE LOG JOIN ONLY THE MINUTES A PAGE CAN SHOW', () => {
  test('paging the whole floor still yields every funded minute once, newest first, each summing its three books', async () => {
    const seen: Array<{ id: string; at: string; body: string }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const res = await buildActions({ workspace: 'snake', kinds: ['liquidity'], limit: 37, cursor });
      for (const r of res.rows) seen.push({ id: r.id, at: r.at, body: JSON.stringify(r) });
      if (!res.next) break;
      cursor = res.next;
    }
    expect(seen).toHaveLength(MINUTES);
    expect(new Set(seen.map(s => s.id)).size).toBe(MINUTES);
    const ats = seen.map(s => Date.parse(s.at));
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);
    for (const s of seen) expect(s.body).toMatch(/\b300\b/);
  });

  test('a page read between two instants answers the same minutes as before', async () => {
    const res = await buildActions({
      workspace: 'snake',
      kinds: ['liquidity'],
      limit: 10,
      before: new Date(START + 100 * 60_000),
      after: new Date(START + 50 * 60_000),
    });
    expect(res.rows).toHaveLength(10);
    expect(Date.parse(res.rows[0].at)).toBeLessThan(START + 100 * 60_000);
    expect(Date.parse(res.rows[0].at)).toBeGreaterThanOrEqual(START + 99 * 60_000);
  });

  test("the floor's live read joins no more subsidy rows than the page's minutes hold", async () => {
    const client = globalThis.__getTestDbShared().client as {
      query: (...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    };
    const original = client.query.bind(client);
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    (client as { query: unknown }).query = async (...args: unknown[]) => {
      if (String(args[0]).includes('liquidity:subsidy:'))
        captured.push({ sql: String(args[0]), params: (args[1] as unknown[]) ?? [] });
      return original(...args);
    };
    try {
      await buildActions({ workspace: 'snake', limit: 30 });
    } finally {
      (client as { query: unknown }).query = original;
    }
    expect(captured).toHaveLength(1);
    const plan = await original(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured[0].sql}`, captured[0].params);
    const root = (Object.values(plan.rows[0])[0] as Array<{ Plan: PlanNode }>)[0].Plan;
    // Every join in the statement, over any branch. The other kinds are empty
    // here, so the only joins with rows are the subsidy branch's.
    const joinedRows = collect(root)
      .filter(n => /Join|Nested Loop/.test(n['Node Type']))
      .map(n => n['Actual Rows'] * (n['Actual Loops'] ?? 1));
    // 31 minutes of three books is 93 rows; before the bound it was 1,200.
    expect(Math.max(0, ...joinedRows)).toBeLessThanOrEqual(3 * 31 + 3);
  });
});

interface PlanNode {
  'Node Type': string;
  'Actual Rows': number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}

function collect(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(collect)];
}

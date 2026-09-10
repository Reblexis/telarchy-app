/**
 * AN UNTRADED MARKET NEVER ENTERS THE BOARD.
 *
 * A market nobody traded and nobody holds a position on cannot have moved
 * any balance, so the board (lib/board.ts loadBoard), the season's settled
 * score (loadSeasonSettled) and the marked standings (loadSeasonMarked)
 * answer exactly the same with or without it. That is what lets the reads
 * be bounded by the TRADED set rather than by the workspace's market count:
 * the Snake workspace makes ~11k markets a day, almost none traded, and the
 * audit (telarchy umbrella, notes/snake-load-audit-2026-09-10.md, items 7
 * and 9) found the board loading every one of them into the process and the
 * season score building `IN (<every market id>)` lists that throw past
 * Postgres's 65,535-parameter cap around day six.
 *
 * Two kinds of assertion, on purpose: the ANSWER is unchanged (the
 * regression guard for the rewrite), and the SHAPE is bounded (the thing
 * the rewrite is for), read off the query log.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadBoard, loadSeasonMarked, loadSeasonSettled } from '../lib/board';
import { captureQueries, largest, widest } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS_A = 'ws-board-a';
const WS_B = 'ws-board-b';
const KAI = 'kai';
const BO = 'bo';
const B = 10;
const RESOLVED_AT = new Date('2026-09-05T00:00:00Z');
const WINDOW_START = new Date('2026-08-15T00:00:00Z');
const WINDOW_END = new Date('2028-01-01T00:00:00Z');
const UNTRADED = 10_000;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

function market(overrides: Partial<typeof markets.$inferInsert> & { id: string; workspaceId: string }) {
  return {
    metricId: 'metric',
    metricName: 'Users',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    ...overrides,
  };
}

async function seed() {
  await db.insert(workspaces).values([
    { id: WS_A, name: 'A', createdBy: 'owner', visibility: 'public' },
    { id: WS_B, name: 'B', createdBy: 'owner', visibility: 'public' },
  ]);
  await db.insert(agents).values([
    { id: KAI, apiKeyHash: 'h-kai', balance: 0 },
    { id: BO, apiKeyHash: 'h-bo', balance: 0 },
  ]);
  await db.insert(markets).values([
    // Open, traded: kai holds 5 higher.
    market({ id: 'm-open', workspaceId: WS_A, shares: [0, 5] }),
    // Resolved at 80 on [0, 100]: higher pays 0.8, lower 0.2.
    market({
      id: 'm-resolved',
      workspaceId: WS_A,
      resolved: true,
      actualValue: 80,
      resolvedAt: RESOLVED_AT,
      shares: [4, 10],
    }),
    // Cancelled: kai's net cash on it is refunded.
    market({ id: 'm-voided', workspaceId: WS_B, voided: true, resolved: true, resolvedAt: RESOLVED_AT }),
    // Open and untraded: a baseline nobody touched.
    market({ id: 'm-quiet', workspaceId: WS_B }),
  ]);
  await db.insert(positions).values([
    { id: 'p1', agentId: KAI, workspaceId: WS_A, marketId: 'm-open', direction: 'higher', shares: 5, totalCost: 2 },
    {
      id: 'p2',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'higher',
      shares: 10,
      totalCost: 3,
    },
    { id: 'p3', agentId: BO, workspaceId: WS_A, marketId: 'm-resolved', direction: 'lower', shares: 4, totalCost: 1 },
  ]);
  const at = (d: string) => new Date(d);
  await db.insert(trades).values([
    {
      id: 't1',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-open',
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: at('2026-09-01T10:00:00Z'),
    },
    {
      id: 't2',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'higher',
      shares: 10,
      cost: 3,
      createdAt: at('2026-09-02T10:00:00Z'),
    },
    {
      id: 't3',
      agentId: BO,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'lower',
      shares: 4,
      cost: 1,
      createdAt: at('2026-09-02T11:00:00Z'),
    },
    {
      id: 't4',
      agentId: KAI,
      workspaceId: WS_B,
      marketId: 'm-voided',
      direction: 'higher',
      shares: 6,
      cost: 4,
      createdAt: at('2026-09-03T10:00:00Z'),
    },
  ]);
}

/** Thousands of markets nobody touched, in every state the Snake leaves
 *  them in: voided branches, settled books, open books. */
async function seedUntraded(n: number) {
  const rows: Array<typeof markets.$inferInsert> = [];
  for (let i = 0; i < n; i++) {
    const state = i % 3;
    rows.push(
      market({
        id: `quiet-${i}`,
        workspaceId: i % 2 === 0 ? WS_A : WS_B,
        targetDate: '2026-12',
        ...(state === 0
          ? { voided: true, resolved: true, resolvedAt: RESOLVED_AT }
          : state === 1
            ? { resolved: true, actualValue: 40 + (i % 50), resolvedAt: RESOLVED_AT }
            : {}),
        proposalId: state === 2 ? null : `prop-${i}`,
        branch: state === 2 ? null : i % 2 === 0 ? 'approved' : 'declined',
      }),
    );
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(markets).values(rows.slice(i, i + 500));
  }
}

function sorted<V>(m: Map<string, V>): Array<[string, V]> {
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function snapshot() {
  const board = await loadBoard([WS_A, WS_B]);
  const settled = await loadSeasonSettled([WS_A, WS_B], WINDOW_START, WINDOW_END);
  const marked = await loadSeasonMarked([WS_A, WS_B], WINDOW_START, WINDOW_END);
  return {
    profit: sorted(board.profitById),
    breakdown: sorted(board.breakdownById),
    activity: sorted(board.activityById),
    calibration: sorted(board.calibrationById),
    positions: [...board.positions].sort((a, b) => a.marketId.localeCompare(b.marketId)),
    agentIds: [...board.agentIds].sort(),
    settled: sorted(settled),
    marked: sorted(marked),
  };
}

describe('AN UNTRADED MARKET NEVER ENTERS THE BOARD', () => {
  test('the board says something for the traded fixture (so the equality below is not two empties)', async () => {
    const s = await snapshot();
    // kai: 5 higher on the open book, 10 higher paid 0.8 = 8 on the resolved
    // one, refund 4 on the void, minus 2 + 3 + 4 net cash.
    expect(s.agentIds).toEqual([BO, KAI]);
    const kai = new Map(s.breakdown).get(KAI)!;
    expect(kai.settled).toBeCloseTo(8 + 4 - (3 + 4), 2);
    expect(new Map(s.settled).get(KAI)).toBeCloseTo(8 + 4 - (3 + 4), 2);
    expect(new Map(s.calibration).get(KAI)?.resolvedMarkets).toBe(1);
  });

  test(`the board, the settled score and the marked standings are identical with and without ${UNTRADED} untraded markets`, async () => {
    const before = await snapshot();
    await seedUntraded(UNTRADED);
    const after = await snapshot();
    expect(after).toEqual(before);
  }, 180_000);

  test('no statement binds a parameter list that grows with the number of markets, and none returns them all', async () => {
    await seedUntraded(UNTRADED);
    const log = captureQueries();
    try {
      await loadBoard([WS_A, WS_B]);
      await loadSeasonSettled([WS_A, WS_B], WINDOW_START, WINDOW_END);
      await loadSeasonMarked([WS_A, WS_B], WINDOW_START, WINDOW_END);
    } finally {
      log.stop();
    }
    const w = widest(log.stats);
    // Two workspace ids, a window, a handful of literals: nothing near a
    // list of market ids.
    expect(w ? `${w.params} params: ${w.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|1\d|20) params/);
    const l = largest(log.stats);
    // Four traded markets, four trades, three positions: a statement that
    // answers hundreds of rows is reading the untraded set.
    expect(l ? `${l.rows} rows: ${l.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|[1-9]\d) rows/);
  }, 180_000);
});

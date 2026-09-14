/**
 * THE LIVE LOG READS A FLOOR'S DECISIONS, DELIVERIES AND FUNDING FROM AN
 * INDEX, IN THE SIZE OF A PAGE, NOT OF THE FLOOR'S HISTORY (docs/data-room.md).
 *
 * A machine-run floor decides a proposal every second, about 86,000 a day.
 * The decision branch ordered by an instant computed per row, so no index
 * could give the order and every read of a floor's Live column sorted every
 * decision the floor ever had; the delivery and funding branches had no index
 * on their instant at all, and the subsidy cutoff grouped every funding row
 * by minute. The 2026-09-13 outage was one such branch.
 *
 * The answer must not change. And a read that crosses floors (by participant,
 * or over every floor) reaches back thirty days from its newest instant.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { sql } from 'drizzle-orm';
import { agents, liquidityEvents, markets, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { buildActions, clearActionsHold } from '../services/actions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-chess';
const DAY = 86_400_000;
const START = Date.parse('2026-05-01T00:00:00Z');
const STATUSES = ['approved', 'declined', 'lapsed', 'lapsed-old', 'withdrawn', 'declined_spam'] as const;
const DECIDED = 360;
/** A lapse has no actor: the participant's decisions are the other four statuses in six. */
const ACTED = (DECIDED * 4) / 6;

type Row = typeof proposals.$inferInsert;

/** One decided proposal every six hours for 90 days, each status shaped like its write path leaves it. */
function decidedRow(i: number): Row {
  const created = START + i * 6 * 3_600_000;
  const at = new Date(created + 30_000);
  const later = new Date(created + 45_000);
  const kind = STATUSES[i % STATUSES.length];
  const base = {
    id: `p${String(i).padStart(4, '0')}`,
    workspaceId: WS,
    number: i + 1,
    title: `Game ${i}, move 1`,
    proposedBy: 'op',
    createdAt: new Date(created),
  };
  switch (kind) {
    case 'approved':
    case 'declined':
    case 'declined_spam':
      return { ...base, status: kind, resolvedAt: at, resolvedBy: 'op', closedAt: later } as Row;
    case 'lapsed':
      return { ...base, status: 'lapsed', lapsedAt: at, closedAt: later, resolvedAt: later } as Row;
    case 'lapsed-old':
      // A lapse from before lapsed_at existed: the close is its instant.
      return { ...base, status: 'lapsed', closedAt: at, resolvedAt: later } as Row;
    default:
      return { ...base, status: 'withdrawn', closedAt: at, resolvedAt: later, resolvedBy: 'op' } as Row;
  }
}

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  clearActionsHold();
  await db.insert(workspaces).values([
    { id: WS, name: 'Chess', slug: 'chess', createdBy: 'op', visibility: 'public', logHidden: true },
    { id: 'ws-other', name: 'Other', slug: 'other', createdBy: 'op', visibility: 'public' },
  ]);
  await db.insert(agents).values({ id: 'op', apiKeyHash: 'h-op', balance: toUnits(1_000_000), nickname: 'chess' });
  const rows: Row[] = Array.from({ length: DECIDED }, (_, i) => decidedRow(i));
  // Never rows of the decision kind: still pending, and removed.
  rows.push({
    id: 'p-pending',
    workspaceId: WS,
    number: 9001,
    title: 'Open',
    proposedBy: 'op',
    status: 'pending',
  } as Row);
  rows.push({
    id: 'p-removed',
    workspaceId: WS,
    number: 9002,
    title: 'Gone',
    proposedBy: 'op',
    status: 'removed',
    resolvedAt: new Date(START),
  } as Row);
  for (let i = 0; i < rows.length; i += 200) await db.insert(proposals).values(rows.slice(i, i + 200));
});

/** The decision instant rule as the log has always stated it, as the oracle. */
async function oracle(): Promise<Array<{ id: string; at: number }>> {
  const result = await db.execute(sql`SELECT 'decision:' || p.id AS id, d.at AS at FROM proposals p
    CROSS JOIN LATERAL (SELECT CASE
      WHEN p.status = 'lapsed' THEN COALESCE(p.lapsed_at, p.closed_at, p.resolved_at)
      WHEN p.status = 'withdrawn' THEN COALESCE(p.closed_at, p.resolved_at)
      ELSE p.resolved_at END AS at) d
    WHERE p.workspace_id = ${WS} AND p.status IN ('approved', 'declined', 'declined_spam', 'lapsed', 'withdrawn') AND d.at IS NOT NULL
    ORDER BY d.at DESC, 'decision:' || p.id DESC`);
  const rows = (Array.isArray(result) ? result : (result as unknown as { rows: any[] }).rows) as any[];
  return rows.map(r => ({
    id: String(r.id),
    at: Date.parse(
      `${String(r.at instanceof Date ? r.at.toISOString() : r.at)
        .replace(' ', 'T')
        .replace(/Z?$/, 'Z')}`,
    ),
  }));
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows': number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}
const collect = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(collect)];

/** Run a log read, capture its one union statement, and EXPLAIN it with sequential scans off. */
async function planOf(marker: string, read: () => Promise<unknown>): Promise<PlanNode[]> {
  const client = globalThis.__getTestDbShared().client as unknown as {
    query: (...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  };
  const original = client.query.bind(client);
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  (client as { query: unknown }).query = async (...args: unknown[]) => {
    if (String(args[0]).includes(marker)) captured.push({ sql: String(args[0]), params: (args[1] as unknown[]) ?? [] });
    return original(...args);
  };
  try {
    await read();
  } finally {
    (client as { query: unknown }).query = original;
  }
  expect(captured).toHaveLength(1);
  await original('SET enable_seqscan = off');
  try {
    const plan = await original(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured[0].sql}`, captured[0].params);
    return collect((Object.values(plan.rows[0])[0] as Array<{ Plan: PlanNode }>)[0].Plan);
  } finally {
    await original('RESET enable_seqscan');
  }
}

describe("THE LIVE LOG READS A FLOOR'S DECISIONS IN THE SIZE OF A PAGE", () => {
  test('paging the floor yields exactly the decisions the decision instant rule gives, newest first, each once', async () => {
    const expected = await oracle();
    expect(expected).toHaveLength(DECIDED);
    const got: Array<{ id: string; at: number }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await buildActions({ workspace: 'chess', kinds: ['decision'], limit: 37, cursor });
      for (const r of res.rows) got.push({ id: r.id, at: Date.parse(r.at) });
      if (!res.next) break;
      cursor = res.next;
    }
    expect(got).toEqual(expected);
  });

  test('decided_at is the decision instant of each status, and null while pending or removed', async () => {
    const result = await db.execute(sql`SELECT p.id, p.decided_at,
        CASE WHEN p.status = 'lapsed' THEN COALESCE(p.lapsed_at, p.closed_at, p.resolved_at)
             WHEN p.status = 'withdrawn' THEN COALESCE(p.closed_at, p.resolved_at)
             WHEN p.status IN ('approved', 'declined', 'declined_spam') THEN p.resolved_at END AS rule
      FROM proposals p WHERE p.workspace_id = ${WS}`);
    const rows = (Array.isArray(result) ? result : (result as unknown as { rows: any[] }).rows) as any[];
    expect(rows).toHaveLength(DECIDED + 2);
    for (const r of rows) expect(String(r.decided_at)).toBe(String(r.rule));
    expect(rows.find(r => r.id === 'p-pending').decided_at).toBeNull();
    expect(rows.find(r => r.id === 'p-removed').decided_at).toBeNull();
  });

  test("A FLOOR'S DECISION ROWS ARE READ IN ORDER FROM AN INDEX, NOT SORTED OUT OF ITS WHOLE HISTORY", async () => {
    const nodes = await planOf("'decision:'", () =>
      buildActions({ workspace: 'chess', kinds: ['decision'], limit: 30 }),
    );
    expect(nodes.some(n => n['Index Name'] === 'proposals_ws_decided_idx')).toBe(true);
    const read = nodes
      .filter(n => n['Relation Name'] === 'proposals')
      .map(n => n['Actual Rows'] * (n['Actual Loops'] ?? 1));
    // A page of 30 reads 31 rows, and one more to learn the last instant's ties ended.
    expect(Math.max(0, ...read)).toBeLessThanOrEqual(32);
  });

  test("a floor's delivery rows are read from an index on the delivery instant", async () => {
    await db.execute(sql`UPDATE proposals SET delivered_at = created_at + interval '1 hour' WHERE status = 'approved'`);
    const nodes = await planOf("'delivery:'", () =>
      buildActions({ workspace: 'chess', kinds: ['delivery'], limit: 10 }),
    );
    expect(nodes.some(n => n['Index Name'] === 'proposals_ws_delivered_idx')).toBe(true);
    const read = nodes
      .filter(n => n['Relation Name'] === 'proposals')
      .map(n => n['Actual Rows'] * (n['Actual Loops'] ?? 1));
    expect(Math.max(0, ...read)).toBeLessThanOrEqual(12);
  });
});

describe('THE FUNDING ROWS AND THEIR CUTOFF READ ONLY THE MINUTES A PAGE CAN SHOW', () => {
  const MINUTES = 300;
  beforeEach(async () => {
    const books: Array<typeof markets.$inferInsert> = [];
    const events: Array<typeof liquidityEvents.$inferInsert> = [];
    for (let i = 0; i < MINUTES; i++) {
      for (const [j, branch] of ['approved', 'declined', 'x'].entries()) {
        const id = `m${i}-${branch}`;
        books.push({
          id,
          workspaceId: WS,
          metricId: 'score',
          metricName: 'Game score',
          targetDate: '2026-09-15T08:00',
          rangeMin: 0,
          rangeMax: 100,
          shares: [0, 0] as [number, number],
          liquidity: 10,
          pool: initialPool(10),
          active: true,
          resolved: false,
          voided: false,
          proposalId: `p${String(i).padStart(4, '0')}`,
          branch,
          createdAt: new Date(START + i * 60_000),
        });
        events.push({
          id: `e${i}-${branch}`,
          workspaceId: WS,
          marketId: id,
          amount: 100,
          totalLiquidity: 100,
          type: 'proposal-subsidy',
          agentId: 'op',
          createdAt: new Date(START + i * 60_000 + 1_000 + j * 100),
        });
      }
    }
    for (let i = 0; i < books.length; i += 300) await db.insert(markets).values(books.slice(i, i + 300));
    for (let i = 0; i < events.length; i += 300) await db.insert(liquidityEvents).values(events.slice(i, i + 300));
  });

  test('NO FUNDING ROW OUTSIDE THE NEWEST MINUTES A PAGE CAN SHOW IS READ, the cutoff included', async () => {
    const nodes = await planOf('liquidity:subsidy:', () =>
      buildActions({ workspace: 'chess', kinds: ['liquidity'], limit: 30 }),
    );
    const read = nodes
      .filter(n => n['Relation Name'] === 'liquidity_events')
      .map(n => n['Actual Rows'] * (n['Actual Loops'] ?? 1));
    // 32 minutes of three books is 96 rows; grouping the history read 900.
    expect(Math.max(0, ...read)).toBeLessThanOrEqual(3 * 32 + 3);
  });

  test('paging the funding still yields every funded minute once, newest first', async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await buildActions({ workspace: 'chess', kinds: ['liquidity'], limit: 41, cursor });
      ids.push(...res.rows.map(r => r.id));
      if (!res.next) break;
      cursor = res.next;
    }
    expect(ids).toHaveLength(MINUTES);
    expect(new Set(ids).size).toBe(MINUTES);
  });
});

describe('A READ BY PARTICIPANT OR OVER EVERY FLOOR REACHES BACK THIRTY DAYS', () => {
  const BEFORE = new Date(START + 60 * DAY);
  const reach = BEFORE.getTime() - 30 * DAY;

  test('by participant: nothing older than thirty days before the newest instant', async () => {
    const res = await buildActions({ participant: 'op', kinds: ['decision'], limit: 200, before: BEFORE });
    expect(res.rows.length).toBeGreaterThan(60);
    for (const r of res.rows) expect(Date.parse(r.at)).toBeGreaterThanOrEqual(reach);
    // The thirty days hold fewer than 200: the walk ends here.
    expect(res.next).toBeNull();
  });

  test('over every floor: the same reach, and an older after is raised to it', async () => {
    const res = await buildActions({
      floors: 'all',
      kinds: ['decision'],
      limit: 200,
      before: BEFORE,
      after: new Date(START),
    });
    expect(res.rows.length).toBeGreaterThan(100);
    for (const r of res.rows) expect(Date.parse(r.at)).toBeGreaterThanOrEqual(reach);
  });

  test('each page reaches back from its own cursor, so a busy history still pages to its start', async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await buildActions({
        participant: 'op',
        kinds: ['decision'],
        limit: 50,
        cursor,
        before: new Date(START + 91 * DAY),
      });
      ids.push(...res.rows.map(r => r.id));
      if (!res.next) break;
      cursor = res.next;
    }
    expect(ids).toHaveLength(ACTED);
  });

  test('a quiet stretch longer than thirty days ends the walk; naming before reads past it', async () => {
    await db.insert(proposals).values({
      id: 'p-ancient',
      workspaceId: WS,
      number: 9100,
      title: 'Long ago',
      proposedBy: 'op',
      status: 'approved',
      resolvedAt: new Date(START - 90 * DAY),
      resolvedBy: 'op',
      createdAt: new Date(START - 90 * DAY),
    } as Row);
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await buildActions({
        participant: 'op',
        kinds: ['decision'],
        limit: 50,
        cursor,
        before: new Date(START + 91 * DAY),
      });
      ids.push(...res.rows.map(r => r.id));
      if (!res.next) break;
      cursor = res.next;
    }
    expect(ids).not.toContain('decision:p-ancient');
    const older = await buildActions({ participant: 'op', kinds: ['decision'], before: new Date(START - 70 * DAY) });
    expect(older.rows.map(r => r.id)).toEqual(['decision:p-ancient']);
  });

  test("a read of one floor reaches the floor's whole history", async () => {
    const res = await buildActions({ workspace: 'chess', kinds: ['decision'], limit: 200, before: BEFORE });
    expect(res.rows).toHaveLength(200);
    expect(res.rows.some(r => Date.parse(r.at) < reach)).toBe(true);
  });
});

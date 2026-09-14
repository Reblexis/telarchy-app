/**
 * The bell inbox is windowed (docs/infra/deploy.md, "Reads are bounded in
 * the size of a workspace"). For the operator of a floor that posts a
 * proposal a minute, "my proposals" is 100k rows after a month, the branch
 * markets under them pass Postgres's bind-parameter cap, and the stale-reading
 * nudge read every open book of every managed workspace plus a metric_logs
 * scan with no workspace in it (notes/snake-load-audit-2026-09-10.md, item
 * 11). The bell polls every minute per signed-in tab.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, authUser, markets, metrics, permissionGroups, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { listNotifications } from '../services/notifications';
import { captureQueries as captureWithValues, rowsRead } from './harness/query-log';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-inbox-bounded';
const ME = 'operator';
const LIMIT = 20;

async function seed(ownProposals: number) {
  await db.insert(authUser).values({ id: `u-${ME}`, name: ME, email: `${ME}@example.com` });
  await db.insert(agents).values({
    id: ME,
    apiKeyHash: `h-${ME}`,
    balance: 0,
    nickname: ME,
    authUserId: `u-${ME}`,
    notificationsSeenAt: new Date('2020-01-01'),
  });
  await db.insert(workspaces).values({ id: WS, name: 'Snake', slug: 'snake', createdBy: ME, visibility: 'public' });
  await db.insert(permissionGroups).values({
    id: 'grp-admin',
    workspaceId: WS,
    name: 'Admin',
    type: 'admin',
    capabilities: ['read', 'trade', 'manage'],
    memberIds: [ME],
  });
  await db.insert(metrics).values({ id: 'metric-ib', workspaceId: WS, name: 'Heading', value: 0, marketRangeMax: 100 });
  const t0 = Date.parse('2026-09-01T00:00:00.000Z');
  const rows = Array.from({ length: ownProposals }, (_, i) => ({
    id: `p-${i}`,
    workspaceId: WS,
    number: i + 1,
    proposedBy: ME,
    title: `Step ${i}`,
    description: '',
    status: 'approved',
    resolvedAt: new Date(t0 + i * 60_000 + 30_000),
    createdAt: new Date(t0 + i * 60_000),
  }));
  for (let i = 0; i < rows.length; i += 250) await db.insert(proposals).values(rows.slice(i, i + 250));
  // One branch market per proposal, plus one baseline: the open set.
  const base = {
    workspaceId: WS,
    metricId: 'metric-ib',
    metricName: 'Heading',
    targetDate: '2030-12-31',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
  };
  const branches = rows.map(p => ({ ...base, id: `m-${p.id}`, proposalId: p.id, branch: 'approved' }));
  for (let i = 0; i < branches.length; i += 250) await db.insert(markets).values(branches.slice(i, i + 250));
  await db.insert(markets).values({ ...base, id: 'm-baseline', proposalId: null, branch: null });
}

const placeholders = (q: string) => (q.match(/\$\d+/g) ?? []).length;

describe("THE RULE: the inbox reads a window, never the operator's whole history", () => {
  let queries: string[] = [];
  let items: Awaited<ReturnType<typeof listNotifications>>['items'] = [];

  beforeEach(async () => {
    await seed(250);
    // Only the clock is faked (pglite needs real timers): 22:00 on the day
    // the baseline settles, inside the nudge window, so the stale-reading
    // lookups run.
    jest.useFakeTimers({
      now: new Date('2030-12-31T22:00:00.000Z'),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    });
    const cap = captureQueries();
    try {
      const out = await listNotifications(ME, LIMIT);
      items = out.items;
    } finally {
      cap.stop();
    }
    queries = cap.queries;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('my proposals are read newest-first, 2 x limit of them', () => {
    const q = queries.find(s => s.includes('from "proposals"') && s.includes('"proposed_by" = '));
    expect(q).toBeDefined();
    expect(q).toMatch(/order by .*"created_at" desc/);
    expect(q).toMatch(/limit/i);
  });

  test('the branch markets under them are bounded by that window', () => {
    const q = queries.find(s => s.includes('from "markets"') && s.includes('"proposal_id" in ('));
    expect(q).toBeDefined();
    expect(
      placeholders(q!) - (q!.match(/"workspace_id" in \(([^)]*)\)/)?.[1].match(/\$\d+/g)?.length ?? 0),
    ).toBeLessThanOrEqual(LIMIT * 2);
  });

  test('the read of those branch markets names their floors, which lead the index', () => {
    const q = queries.find(s => s.includes('from "markets"') && s.includes('"proposal_id" in ('));
    expect(q).toBeDefined();
    expect(q).toMatch(/"markets"\."workspace_id" in \(/);
  });

  test('the stale-reading nudge reads baseline books only', () => {
    const q = queries.find(s => s.includes('from "markets"') && /"resolved" = /.test(s) && /"active" = /.test(s));
    expect(q).toBeDefined();
    expect(q).toContain('"proposal_id" is null');
  });

  test('the last-reading lookup carries the workspace', () => {
    const q = queries.find(s => s.includes('from "metric_logs"'));
    expect(q).toBeDefined();
    expect(q).toContain('"workspace_id"');
  });

  test('the inbox still answers, with at most limit items', () => {
    expect(items.length).toBeLessThanOrEqual(LIMIT);
  });
});

/**
 * The same poll for a member of several busy floors (2026-09-13: 19,049 bell
 * reads of "the newest proposals on my floors" took 174 s and 23.7M blocks,
 * and "the books I traded" answered 74M rows, one per trade, to a caller that
 * only wanted each book once). Both must stay in the size of the window.
 */
describe("THE BELL READS EACH FLOOR BY ITS INDEX, NEVER A FLOOR'S WHOLE HISTORY", () => {
  const FLOORS = ['ws-bell-0', 'ws-bell-1', 'ws-bell-2'];
  const PER_FLOOR = 300;
  const BOOKS = 8;
  const t0 = Date.parse('2026-09-01T00:00:00.000Z');

  beforeEach(async () => {
    await db.insert(authUser).values({ id: `u-${ME}`, name: ME, email: `${ME}@example.com` });
    await db.insert(agents).values([
      { id: ME, apiKeyHash: `h-${ME}`, balance: 0, nickname: ME, authUserId: `u-${ME}` },
      { id: 'other', apiKeyHash: 'h-other', balance: 0, nickname: 'other' },
    ]);
    for (const [w, ws] of FLOORS.entries()) {
      await db
        .insert(workspaces)
        .values({ id: ws, name: `Floor ${w}`, slug: `floor-${w}`, createdBy: 'other', visibility: 'public' });
      await db.insert(permissionGroups).values({
        id: `grp-${ws}`,
        workspaceId: ws,
        name: 'Traders',
        type: 'custom',
        capabilities: ['read', 'trade'],
        memberIds: [ME],
      });
      const rows = Array.from({ length: PER_FLOOR }, (_, i) => ({
        id: `${ws}-p-${i}`,
        workspaceId: ws,
        number: i + 1,
        proposedBy: 'other',
        title: `Floor ${w} proposal ${i}`,
        description: '',
        status: 'pending',
        // Interleaved across floors, so the newest window spans all three.
        createdAt: new Date(t0 + (i * FLOORS.length + w) * 60_000),
      }));
      for (let i = 0; i < rows.length; i += 150) await db.insert(proposals).values(rows.slice(i, i + 150));
    }
    await db
      .insert(metrics)
      .values({ id: 'metric-bell', workspaceId: FLOORS[0], name: 'Length', value: 0, marketRangeMax: 100 });
    await db.insert(markets).values(
      Array.from({ length: BOOKS }, (_, i) => ({
        id: `bell-book-${i}`,
        workspaceId: FLOORS[0],
        metricId: 'metric-bell',
        metricName: 'Length',
        targetDate: '2030-12-31',
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0] as [number, number],
        liquidity: 10,
        pool: initialPool(10),
        active: true,
        resolved: false,
        voided: false,
        proposalId: null,
        branch: null,
      })),
    );
    await db.insert(trades).values(
      Array.from({ length: BOOKS * 30 }, (_, i) => ({
        id: `bell-trade-${i}`,
        workspaceId: FLOORS[0],
        agentId: ME,
        marketId: `bell-book-${i % BOOKS}`,
        direction: 'higher',
        shares: 1,
        cost: 1,
      })),
    );
  });

  async function poll() {
    const log = captureWithValues();
    let out: Awaited<ReturnType<typeof listNotifications>>;
    try {
      out = await listNotifications(ME, LIMIT);
    } finally {
      log.stop();
    }
    return { items: out!.items, stats: log.stats };
  }

  test('a new proposal on any of my floors still reaches the bell, newest first across floors', async () => {
    const { items } = await poll();
    const expected = FLOORS.flatMap((ws, w) =>
      Array.from({ length: PER_FLOOR }, (_, i) => ({
        id: `np-${ws}-p-${i}`,
        at: t0 + (i * FLOORS.length + w) * 60_000,
      })),
    )
      .sort((a, b) => b.at - a.at)
      .slice(0, LIMIT)
      .map(e => e.id);
    expect(items.map(i => i.id)).toEqual(expected);
  });

  test('the newest proposals of my floors are read per floor, at most 2 x limit rows each', async () => {
    const { stats } = await poll();
    const reads = stats.filter(
      s => s.sql.includes('from "proposals"') && s.sql.includes('"description"') && !s.sql.includes('"proposed_by" ='),
    );
    expect(reads.length).toBeGreaterThan(0);
    let read = 0;
    for (const s of reads) read += await rowsRead(s, 'proposals');
    expect(read).toBeLessThanOrEqual(FLOORS.length * 2 * LIMIT);
  });

  test('the books I traded come back once each, not once per trade', async () => {
    const { stats } = await poll();
    const q = stats.find(s => s.sql.includes('from "trades"') && s.sql.includes('"agent_id" = '));
    expect(q).toBeDefined();
    expect(q!.rows).toBeLessThanOrEqual(BOOKS);
  });
});

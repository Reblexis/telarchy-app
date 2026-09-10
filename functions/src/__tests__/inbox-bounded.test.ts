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

import { agents, authUser, markets, metrics, permissionGroups, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { listNotifications } from '../services/notifications';
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
    expect(placeholders(q!)).toBeLessThanOrEqual(LIMIT * 2);
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

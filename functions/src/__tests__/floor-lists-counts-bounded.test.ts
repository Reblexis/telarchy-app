/**
 * A floor's reads are bounded by what it shows, not by how many proposals it
 * has decided (docs/infra/deploy.md, "A list never hides a live proposal",
 * "Counts stop at a cap", "The prices read joins no decided proposal").
 *
 * The shape that forces it: a chess floor keeps one move proposal open for up
 * to a minute while it posts and decides a small proposal every second
 * (telarchy umbrella, notes/chess-play-now-load-plan-2026-09-14.md). A
 * "newest 40" window then loses the open move within a minute, and every read
 * that counts or joins the floor's whole history grows by 86,000 rows a day.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-frb-reader',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read']),
    };
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { provisionWorkspace } from '../lib/participants';
import { clearAllTtlCaches } from '../lib/ttl-cache';
import { authMiddleware } from '../middleware/auth';
import { listPublicWorkspaces, marketplaceRouter } from '../routes/marketplace';
import { proposalsRouter } from '../routes/proposals';
import { countProposalStatuses, countProposalsUpTo } from '../services/proposal-counts';
import { buildWorkspaceContext } from '../services/workspace-context';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use(apiErrorHandler);

const WS = 'ws-frb';
const OWNER = 'agent-frb-owner';
const T0 = Date.parse('2026-09-01T00:00:00.000Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearAllTtlCaches();
  await seedFloor();
});

function book(over: Partial<typeof markets.$inferInsert>): typeof markets.$inferInsert {
  return {
    id: 'mkt-x',
    workspaceId: WS,
    metricId: 'metric-frb',
    metricName: 'Game score',
    targetDate: '2028-01-01T00:00',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    ...over,
  } as typeof markets.$inferInsert;
}

async function seedFloor() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-frb-o', balance: 0 },
    { id: 'agent-frb-t1', apiKeyHash: 'h-frb-1', balance: 0 },
    { id: 'agent-frb-t2', apiKeyHash: 'h-frb-2', balance: 0 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Chess',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.update(workspaces).set({ slug: 'chess-frb' }).where(eq(workspaces.id, WS));
  const [group] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, group.id));
  await db
    .insert(metrics)
    .values({ id: 'metric-frb', workspaceId: WS, name: 'Game score', value: 50, formula: '0', marketRangeMax: 100 });
  // The move: posted first, still open.
  await db.insert(proposals).values({
    id: 'prop-move',
    workspaceId: WS,
    number: 1,
    proposedBy: OWNER,
    title: 'Game 1, move 12',
    description: '',
    status: 'pending',
    createdAt: new Date(T0),
  });
  await db
    .insert(markets)
    .values([
      book({ id: 'mkt-base' }),
      book({ id: 'mkt-move-a', proposalId: 'prop-move', branch: 'approved' }),
      book({ id: 'mkt-move-d', proposalId: 'prop-move', branch: 'declined' }),
    ]);
  const trade = (id: string, agentId: string, marketId: string) => ({
    id,
    workspaceId: WS,
    agentId,
    marketId,
    direction: 'higher',
    shares: 1,
    cost: 1,
  });
  await db
    .insert(trades)
    .values([
      trade('t-1', 'agent-frb-t1', 'mkt-base'),
      trade('t-2', 'agent-frb-t2', 'mkt-base'),
      trade('t-3', 'agent-frb-t1', 'mkt-move-a'),
    ]);
}

/** `n` decided proposals posted after the move, numbers 2..n+1, one second apart. */
async function seedDecided(n: number, status = 'declined') {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `prop-d-${i + 2}`,
    workspaceId: WS,
    number: i + 2,
    proposedBy: OWNER,
    title: `Game 1, move 12: play now? (${i + 2})`,
    description: '',
    status,
    createdAt: new Date(T0 + (i + 1) * 1000),
    resolvedAt: new Date(T0 + (i + 1) * 1000 + 900),
  }));
  for (let i = 0; i < rows.length; i += 250) await db.insert(proposals).values(rows.slice(i, i + 250));
}

describe('THE RULE: a list never hides a live proposal', () => {
  test('the floor ballot carries the open move behind 60 decided proposals, and the newest 40 decided', async () => {
    await seedDecided(60);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const ids = (res.body.proposals as Array<{ id: string; status: string }>).map(p => p.id);
    expect(ids[0]).toBe('prop-move');
    const decided = (res.body.proposals as Array<{ status: string }>).filter(p => p.status !== 'pending');
    expect(decided).toHaveLength(40);
    expect(ids).toContain('prop-d-61');
    expect(ids).not.toContain('prop-d-21');
  });

  test('the workspace brief carries the open move behind 30 decided proposals, within its 25', async () => {
    await seedDecided(30);
    const ctx = await buildWorkspaceContext(WS);
    const ids = ctx!.contracts.map(c => c.id);
    expect(ids).toContain('prop-move');
    expect(ids).toHaveLength(25);
    expect(ids).toContain('prop-d-31');
    expect(ids).toContain('prop-d-8');
    expect(ids).not.toContain('prop-d-7');
  });

  test('GET /api/proposals lists the open move first, then pages through every decided one exactly once', async () => {
    await seedDecided(150);
    const list = (q = '') => request(app).get(`/api/proposals${q}`).set('X-Workspace-Id', WS);
    const first = await list();
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(100);
    expect(first.body[0].number).toBe(1);
    expect(first.body[1].number).toBe(151);
    const seen = first.body.map((p: { number: number }) => p.number);
    const second = await list(`?before=${first.body[99].number}`);
    expect(second.body).toHaveLength(51);
    seen.push(...second.body.map((p: { number: number }) => p.number));
    expect(new Set(seen).size).toBe(151);
    expect(seen).toHaveLength(151);
    expect((await list(`?before=${second.body[50].number}`)).body).toEqual([]);
  });

  test('a pending page continues into the decided ones after the last pending proposal', async () => {
    await seedDecided(5);
    await db.insert(proposals).values(
      Array.from({ length: 4 }, (_, i) => ({
        id: `prop-p-${i + 7}`,
        workspaceId: WS,
        number: i + 7,
        proposedBy: OWNER,
        title: `pending ${i + 7}`,
        description: '',
        status: 'pending',
        createdAt: new Date(T0 + (10 + i) * 1000),
      })),
    );
    const list = (q = '') => request(app).get(`/api/proposals${q}`).set('X-Workspace-Id', WS);
    const first = await list('?limit=3');
    expect(first.body.map((p: { number: number }) => p.number)).toEqual([10, 9, 8]);
    const second = await list('?limit=3&before=8');
    expect(second.body.map((p: { number: number }) => p.number)).toEqual([7, 1, 6]);
    const third = await list('?limit=3&before=6');
    expect(third.body.map((p: { number: number }) => p.number)).toEqual([5, 4, 3]);
  });

  test('status still filters in plain newest-first order', async () => {
    await seedDecided(5);
    const res = await request(app).get('/api/proposals?status=declined&limit=2&before=5').set('X-Workspace-Id', WS);
    expect(res.body.map((p: { number: number }) => p.number)).toEqual([4, 3]);
  });
});

describe('THE RULE: counts stop at a cap', () => {
  test('the status counts are exact below the cap and stop at it', async () => {
    await seedDecided(7);
    const since = new Date(T0 - 1000);
    const exact = await countProposalStatuses([WS], since);
    expect(exact.get(WS)).toMatchObject({ total: 8, pending: 1, declined: 7 });
    const capped = await countProposalStatuses([WS], since, 5);
    expect(capped.get(WS)).toMatchObject({ pending: 1, declined: 5, total: 6 });
  });

  test('the proposal total is exact below the cap and stops at it', async () => {
    await seedDecided(7);
    expect(await countProposalsUpTo(WS, 100)).toBe(8);
    expect(await countProposalsUpTo(WS, 5)).toBe(5);
  });

  test('the floor payload, the public listing and the contracts read count through capped statements', async () => {
    await seedDecided(3);
    await db.update(proposals).set({ createdAt: new Date() }).where(eq(proposals.workspaceId, WS));
    const cap = captureQueries();
    let floor: request.Response;
    let listing: Awaited<ReturnType<typeof listPublicWorkspaces>>;
    let contracts: request.Response;
    try {
      floor = await request(app).get(`/api/marketplace/${WS}`);
      listing = await listPublicWorkspaces();
      contracts = await request(app).get(`/api/marketplace/${WS}/contracts`);
    } finally {
      cap.stop();
    }
    expect(floor.body.proposalStats).toMatchObject({ total: 4, pending: 1, declined: 3 });
    expect(listing.find(w => w.workspaceId === WS)?.proposalStats).toMatchObject({ total: 4, pending: 1 });
    expect(contracts.body.contractsTotal).toBe(4);
    const counts = cap.queries.filter(q => /count\(\*\)/i.test(q) && q.includes('"proposals"'));
    expect(counts.length).toBeGreaterThan(0);
    for (const q of counts) expect(q).toMatch(/limit/i);
  });
});

describe('THE RULE: the prices read joins no decided proposal', () => {
  test('the prices read takes no more proposal rows than the floor has pending, however many were decided', async () => {
    await seedDecided(2000);
    const client = globalThis.__getTestDbShared().client as {
      query: (...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    };
    // No ANALYZE: planner statistics outlive truncateAll and would change the
    // plans other suites in this process assert on.
    const original = client.query.bind(client);
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    (client as { query: unknown }).query = async (...args: unknown[]) => {
      const text = String(args[0]);
      if (text.includes('from "markets"') && text.includes('"proposals"'))
        captured.push({ sql: text, params: (args[1] as unknown[]) ?? [] });
      return original(...args);
    };
    let res: request.Response;
    try {
      res = await request(app).get(`/api/marketplace/${WS}/prices`);
    } finally {
      (client as { query: unknown }).query = original;
    }
    expect(res.status).toBe(200);
    expect((res.body.books as Array<{ marketId: string }>).map(b => b.marketId).sort()).toEqual([
      'mkt-base',
      'mkt-move-a',
      'mkt-move-d',
    ]);
    expect(captured).toHaveLength(1);
    // Production Postgres hashed the join over every proposal at scale; a
    // tiny test table invites a nested loop instead. Take the nested loop off
    // the table so the plan is the one a large floor gets.
    await original('SET enable_nestloop = off');
    let plan: { rows: Array<Record<string, unknown>> };
    try {
      plan = await original(`EXPLAIN (ANALYZE, FORMAT JSON) ${captured[0].sql}`, captured[0].params);
    } finally {
      await original('RESET enable_nestloop');
    }
    const root = (Object.values(plan.rows[0])[0] as Array<{ Plan: PlanNode }>)[0].Plan;
    const proposalRowsRead = collect(root)
      .filter(n => n['Relation Name'] === 'proposals')
      .map(n => (n['Actual Rows'] + (n['Rows Removed by Filter'] ?? 0)) * (n['Actual Loops'] ?? 1));
    // One pending proposal; before the bound the join read all 2,001.
    expect(Math.max(0, ...proposalRowsRead)).toBeLessThanOrEqual(10);
  });

  test("the floor's week counts are served by an index on trades (workspace_id, created_at)", async () => {
    const client = globalThis.__getTestDbShared().client as {
      query: (...args: unknown[]) => Promise<{ rows: Array<{ indexdef: string }> }>;
    };
    const { rows } = await client.query("select indexdef from pg_indexes where tablename = 'trades'");
    expect(rows.map(r => r.indexdef).some(d => /\(workspace_id, created_at\)/.test(d))).toBe(true);
  });
});

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

function collect(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(collect)];
}

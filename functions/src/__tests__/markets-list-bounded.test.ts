/**
 * GET /api/predictions/markets is bounded in the size of a workspace
 * (docs/infra/deploy.md, "Reads are bounded in the size of a workspace";
 * docs/guides/markets.md, "Where to look").
 *
 * A floor that opens a pair of books a second holds millions of settled and
 * voided markets within weeks. The list used to read every market of the
 * workspace into the process, filter and sort it in JS, and count trades with
 * `IN (<every id>)`, which throws past Postgres's 65,535-parameter cap. The
 * rules pinned here:
 *
 * - one response holds at most 500 markets, and `X-Next-Cursor` pages the
 *   rest so that following it returns every market exactly once;
 * - a settled, voided or all-states list needs `proposalId` or `since`,
 *   otherwise 400 `history_needs_narrowing`;
 * - no statement binds a parameter per market or answers every market.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-mb',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// The relative-date refresh runs beside the listing; it is not what this tests.
jest.mock('../services/markets', () => ({
  ...jest.requireActual('../services/markets'),
  refreshRelativeDateMarkets: jest.fn(async () => undefined),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { captureQueries, largest, widest } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err?.status ?? 500).json({ error: err?.message, code: err?.code });
});

const WS = 'ws-mb';
const BASE = Date.parse('2026-01-01T00:00:00Z');

type MarketInsert = typeof markets.$inferInsert;

function market(i: number, over: Partial<MarketInsert> = {}): MarketInsert {
  return {
    id: `m-${String(i).padStart(5, '0')}`,
    workspaceId: WS,
    metricId: 'metric-mb',
    metricName: 'Game score',
    targetDate: `2030-${String((i % 12) + 1).padStart(2, '0')}`,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    createdAt: new Date(BASE + i * 1000),
    ...over,
  };
}

async function insertMany(rows: MarketInsert[]) {
  for (let i = 0; i < rows.length; i += 500) await db.insert(markets).values(rows.slice(i, i + 500));
}

const list = (query: string) => request(app).get(`/api/predictions/markets${query}`).set('X-Workspace-Id', WS);

async function walk(query: string) {
  const pages: string[][] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const sep = query.includes('?') ? '&' : '?';
    const res = await list(cursor ? `${query}${sep}cursor=${encodeURIComponent(cursor)}` : query);
    expect(res.status).toBe(200);
    pages.push(res.body.map((m: { id: string }) => m.id));
    cursor = res.headers['x-next-cursor'];
    if (!cursor) return { pages, bodies: pages };
  }
  throw new Error('cursor never ended');
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'agent-mb', apiKeyHash: 'h-mb', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'Bounded', slug: 'bounded', createdBy: 'agent-mb' });
  await db
    .insert(metrics)
    .values({ id: 'metric-mb', workspaceId: WS, name: 'Game score', value: 50, formula: '0', marketRangeMax: 100 });
});

describe('a settled, voided or every-state list needs proposalId or since', () => {
  test.each([
    'status=resolved',
    'status=voided',
    'status=all',
    'includeResolved=true',
    'includeVoided=true',
    'active=false&includeVoided=true',
  ])('?%s alone answers 400 history_needs_narrowing', async q => {
    await insertMany([market(1)]);
    const res = await list(`?${q}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('history_needs_narrowing');
  });

  test('open and closed lists need no narrowing', async () => {
    await insertMany([market(1), market(2, { active: false })]);
    expect((await list('')).status).toBe(200);
    expect((await list('?status=open')).status).toBe(200);
    const closed = await list('?status=closed');
    expect(closed.status).toBe(200);
    expect(closed.body.map((m: { id: string }) => m.id)).toEqual(['m-00002']);
  });

  test('since keeps the markets opened or settled at or after it, and nothing older', async () => {
    const since = '2026-09-01T00:00:00.000Z';
    await insertMany([
      market(1), // opened in January, still open
      market(2, { resolved: true, actualValue: 70, resolvedAt: new Date('2026-09-10T00:00:00Z') }),
      market(3, { resolved: true, actualValue: 70, resolvedAt: new Date('2026-02-01T00:00:00Z') }),
      market(4, {
        resolved: true,
        voided: true,
        active: false,
        resolvedAt: new Date('2026-09-11T00:00:00Z'),
        createdAt: new Date('2026-09-11T00:00:00Z'),
      }),
      market(5, { createdAt: new Date('2026-09-12T00:00:00Z') }), // opened after since
    ]);
    const all = await list(`?status=all&since=${since}`);
    expect(all.status).toBe(200);
    expect(all.body.map((m: { id: string }) => m.id).sort()).toEqual(['m-00002', 'm-00004', 'm-00005']);
    const resolved = await list(`?status=resolved&since=${since}`);
    expect(resolved.body.map((m: { id: string }) => m.id)).toEqual(['m-00002']);
    const voided = await list(`?status=voided&since=${since}`);
    expect(voided.body.map((m: { id: string }) => m.id)).toEqual(['m-00004']);
  });

  test('an unreadable since answers 400', async () => {
    const res = await list('?status=all&since=yesterday');
    expect(res.status).toBe(400);
  });

  test("a proposal's books list in any state without since", async () => {
    await insertMany([
      market(1, { proposalId: 'p-1', branch: 'e2e4', resolved: true, voided: true, active: false }),
      market(2, { proposalId: 'p-1', branch: 'd2d4', resolved: true, actualValue: 100, resolvedAt: new Date() }),
      market(3, { proposalId: 'p-2', branch: 'g1f3', resolved: true, voided: true, active: false }),
    ]);
    const res = await list('?status=all&proposalId=p-1');
    expect(res.status).toBe(200);
    expect(res.body.map((m: { id: string }) => m.id).sort()).toEqual(['m-00001', 'm-00002']);
  });
});

describe('one response holds at most 500 markets, and the cursor pages the rest exactly once', () => {
  test('1,203 open markets come back as 500, 500 and 203, every one exactly once', async () => {
    await insertMany(Array.from({ length: 1203 }, (_, i) => market(i)));
    const { pages } = await walk('');
    expect(pages.map(p => p.length)).toEqual([500, 500, 203]);
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(1203);
    expect(ids.slice().sort()).toEqual(Array.from({ length: 1203 }, (_, i) => market(i).id).sort());
  }, 60_000);

  test('the liquidity-ordered list pages the same way, heaviest first across pages', async () => {
    // Ties on purpose: the order must still be total, or a page boundary
    // drops or repeats a market.
    await insertMany(Array.from({ length: 700 }, (_, i) => market(i, { liquidity: 1 + (i % 7) })));
    const liquidityOf = new Map(Array.from({ length: 700 }, (_, i) => [market(i).id, 1 + (i % 7)]));
    const { pages } = await walk('?minLiquidity=1');
    expect(pages.map(p => p.length)).toEqual([500, 200]);
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(700);
    const liq = ids.map(id => liquidityOf.get(id)!);
    for (let i = 1; i < liq.length; i++) expect(liq[i]).toBeLessThanOrEqual(liq[i - 1]);
  }, 60_000);

  test('a settled list narrowed by since pages too', async () => {
    await insertMany(
      Array.from({ length: 620 }, (_, i) =>
        market(i, { resolved: true, voided: true, active: false, resolvedAt: new Date('2026-09-10T00:00:00Z') }),
      ),
    );
    const { pages } = await walk('?status=voided&since=2026-09-01T00:00:00Z');
    expect(pages.map(p => p.length)).toEqual([500, 120]);
    expect(new Set(pages.flat()).size).toBe(620);
  }, 60_000);

  test('a list under the cap carries no cursor', async () => {
    await insertMany([market(1), market(2), market(3)]);
    const res = await list('');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  test('an unreadable cursor answers 400', async () => {
    await insertMany([market(1)]);
    const res = await list('?cursor=not-a-cursor');
    expect(res.status).toBe(400);
  });
});

describe('the shape of the reads', () => {
  test('no statement binds a parameter per market, and none answers every market', async () => {
    await insertMany(Array.from({ length: 1203 }, (_, i) => market(i)));
    const log = captureQueries();
    let res: request.Response;
    try {
      res = await list('');
    } finally {
      log.stop();
    }
    expect(res.status).toBe(200);
    const w = widest(log.stats);
    expect(w ? `${w.params} params: ${w.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|1\d|20) params/);
    const l = largest(log.stats);
    expect(l ? `${l.rows} rows: ${l.sql.slice(0, 200)}` : 'no queries').toMatch(/^([1-9]?\d{1,2}|50[01]) rows/);
  }, 60_000);
});

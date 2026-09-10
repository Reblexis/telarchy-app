/**
 * GET /api/proposals is paginated (docs/infra/deploy.md, "Reads are bounded
 * in the size of a workspace"): the newest 100 by default, `limit` up to
 * 500, `before` on a proposal number or an ISO instant, `status` filtered in
 * the database. A floor that posts a proposal a minute holds 100k of them
 * after a month, and any reader with `read` could pull every one of them in
 * a single call (notes/snake-load-audit-2026-09-10.md, item 3).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-list-reader',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'agent-list-poster', apiKeyHash: 'h-list-poster', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'Snake', slug: 'snake', createdBy: 'agent-list-poster' });
});

const WS = 'ws-list';
const T0 = Date.parse('2026-09-01T00:00:00.000Z');

/** n proposals, #1 the oldest, one minute apart. `status` per number. */
async function seed(n: number, statusOf: (number: number) => string = () => 'pending') {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `p-${i + 1}`,
    workspaceId: WS,
    number: i + 1,
    proposedBy: 'agent-list-poster',
    title: `Proposal ${i + 1}`,
    description: '',
    status: statusOf(i + 1),
    createdAt: new Date(T0 + i * 60_000),
  }));
  for (let i = 0; i < rows.length; i += 250) await db.insert(proposals).values(rows.slice(i, i + 250));
}

const list = (query = '') => request(app).get(`/api/proposals${query}`).set('X-Workspace-Id', WS);
const numbersOf = (body: Array<{ number: number }>) => body.map(p => p.number);

describe('THE RULE: the whole floor is never returned in one call', () => {
  test('a workspace with 150 proposals answers the newest 100, then the rest on the next page', async () => {
    await seed(150);
    const first = await list();
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(100);
    expect(numbersOf(first.body)[0]).toBe(150);
    expect(numbersOf(first.body)[99]).toBe(51);

    const last = first.body[first.body.length - 1];
    const second = await list(`?before=${last.number}`);
    expect(second.body).toHaveLength(50);
    expect(numbersOf(second.body)[0]).toBe(50);
    expect(numbersOf(second.body)[49]).toBe(1);

    // A page shorter than limit is the last one; asking past it is empty.
    const third = await list(`?before=${second.body[49].number}`);
    expect(third.body).toEqual([]);
  });

  test('limit is honoured up to 500 and clamped above it', async () => {
    await seed(520);
    expect((await list('?limit=7')).body).toHaveLength(7);
    expect((await list('?limit=500')).body).toHaveLength(500);
    expect((await list('?limit=5000')).body).toHaveLength(500);
  });

  test('a limit that is not a positive number falls back to the default', async () => {
    await seed(120);
    expect((await list('?limit=abc')).body).toHaveLength(100);
    expect((await list('?limit=0')).body).toHaveLength(100);
    expect((await list('?limit=-3')).body).toHaveLength(100);
  });

  test('before also takes an ISO instant on createdAt', async () => {
    await seed(120);
    const first = await list('?limit=10');
    const cursor = first.body[9].createdAt as string;
    const second = await list(`?limit=10&before=${encodeURIComponent(cursor)}`);
    expect(numbersOf(second.body)).toEqual([110, 109, 108, 107, 106, 105, 104, 103, 102, 101]);
  });

  test('the list query carries a limit in SQL, not in JS', async () => {
    await seed(5);
    const cap = captureQueries();
    try {
      await list();
    } finally {
      cap.stop();
    }
    const q = cap.queries.find(s => s.includes('from "proposals"'));
    expect(q).toBeDefined();
    expect(q).toMatch(/limit/i);
  });
});

describe('status is filtered in the database', () => {
  test('the five approved proposals older than 150 pending ones are all returned', async () => {
    // Filtering in JS after a limit of 100 newest would answer nothing here.
    await seed(155, n => (n <= 5 ? 'approved' : 'pending'));
    const res = await list('?status=approved');
    expect(numbersOf(res.body).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    const cap = captureQueries();
    try {
      await list('?status=approved');
    } finally {
      cap.stop();
    }
    const q = cap.queries.find(s => s.includes('from "proposals"'));
    expect(q).toMatch(/"status" = \$\d+/);
  });

  test('removed proposals are off the list by default and readable on request', async () => {
    await seed(10, n => (n === 3 ? 'removed' : 'pending'));
    expect(numbersOf((await list()).body)).not.toContain(3);
    expect(numbersOf((await list('?status=removed')).body)).toEqual([3]);
  });

  test('status and before compose', async () => {
    await seed(30, n => (n % 2 === 0 ? 'approved' : 'declined'));
    const res = await list('?status=approved&limit=5&before=20');
    expect(numbersOf(res.body)).toEqual([18, 16, 14, 12, 10]);
  });
});

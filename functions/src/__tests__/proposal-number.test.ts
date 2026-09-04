/**
 * A proposal has a number (docs/ui-conventions.md, "A proposal has a number
 * and an address"): a short per-floor ordinal in posting order, never
 * reused, shipped as `number` on the public floor, so a person can name a
 * proposal in conversation without reading a UUID out of the API. A visitor
 * on 2026-09-04 wanted to ask Otto about a proposal and could not say which.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/marketplace', marketplaceRouter);
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
});

const OWNER = 'agent-num-owner';
const POSTER = 'agent-num-poster';

async function seedFloor(ws: string) {
  await db.insert(workspaces).values({ id: ws, name: `Floor ${ws}`, slug: ws, createdBy: OWNER, visibility: 'public' });
  await db.insert(permissionGroups).values({
    id: `grp-pub-${ws}`,
    workspaceId: ws,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
    sourcePermissions: {},
  });
  await db.insert(metrics).values({
    id: `metric-${ws}`,
    workspaceId: ws,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: `mkt-${ws}`,
    workspaceId: ws,
    metricId: `metric-${ws}`,
    metricName: 'Revenue',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-num-owner', balance: toUnits(1000), platformAdmin: true },
    { id: POSTER, apiKeyHash: 'h-num-poster', balance: toUnits(1000) },
  ]);
  await seedFloor('ws-num-a');
  await seedFloor('ws-num-b');
}

function post(ws: string, title: string, agent = POSTER) {
  return request(app)
    .post('/api/proposals')
    .set('x-workspace-id', ws)
    .set('x-test-agent-id', agent)
    .send({ title, description: '', askUsd: 0 });
}

async function numberOf(id: string): Promise<number | null> {
  const [row] = await db.select({ number: proposals.number }).from(proposals).where(eq(proposals.id, id));
  return row?.number ?? null;
}

describe('a proposal has a number', () => {
  test('numbers count up in posting order within a floor, from 1', async () => {
    await seed();
    const a = await post('ws-num-a', 'First');
    const b = await post('ws-num-a', 'Second');
    const c = await post('ws-num-a', 'Third');
    expect(a.status).toBe(201);
    expect([a.body.number, b.body.number, c.body.number]).toEqual([1, 2, 3]);
    expect(await numberOf(c.body.id)).toBe(3);
  });

  test('each floor counts on its own', async () => {
    await seed();
    await post('ws-num-a', 'A one');
    await post('ws-num-a', 'A two');
    const b = await post('ws-num-b', 'B one');
    expect(b.body.number).toBe(1);
  });

  test('a number is never reused: a removed proposal leaves its number behind', async () => {
    await seed();
    await post('ws-num-a', 'One');
    const two = await post('ws-num-a', 'Two');
    // Removed from the ballot (the owner's spam control), then gone entirely.
    await db
      .update(proposals)
      .set({ status: 'removed' })
      .where(and(eq(proposals.id, two.body.id), eq(proposals.workspaceId, 'ws-num-a')));
    const three = await post('ws-num-a', 'Three');
    expect(three.body.number).toBe(3);
    await db.delete(proposals).where(eq(proposals.id, two.body.id));
    const four = await post('ws-num-a', 'Four');
    expect(four.body.number).toBe(4);
  });

  test('proposals posted at the same moment get distinct numbers', async () => {
    await seed();
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(i => post('ws-num-a', `Race ${i}`)));
    for (const r of results) expect(r.status).toBe(201);
    const numbers = results.map(r => r.body.number as number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('the public floor ships the number beside the id', async () => {
    await seed();
    const posted = await post('ws-num-a', 'Visible');
    const floor = await request(app).get('/api/marketplace/ws-num-a');
    expect(floor.status).toBe(200);
    const row = (floor.body.proposals as Array<{ id: string; number: number }>).find(p => p.id === posted.body.id);
    expect(row).toBeTruthy();
    expect(row!.number).toBe(1);
  });
});

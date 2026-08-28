/**
 * The Manifold import: proven calibration converts to starting credits,
 * once. The money properties under test: the grant is net worth capped at
 * 10,000 (lowered 2026-08-28) and floored at 0; one Manifold account funds one Telarchy account
 * ever, in either direction; and nothing is granted before the bio proves
 * ownership. Manifold's API is mocked; the flow is exercised end-to-end
 * through the real routes against a real database.
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
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents } from '../db/schema';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { manifoldRouter } from '../routes/manifold';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/import/manifold', authMiddleware, manifoldRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});

// The Manifold side, controllable per test.
let manifoldBio = '';
let manifoldBalance = 0;
let manifoldInvested = 0;
const MUSER = { id: 'mf-user-1', username: 'CalibratedCarol' };

const realFetch = global.fetch;
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'agent-mf-a', apiKeyHash: 'h-mf-a', balance: toUnits(1000) },
    { id: 'agent-mf-b', apiKeyHash: 'h-mf-b', balance: toUnits(1000) },
  ]);
  manifoldBio = '';
  manifoldBalance = 0;
  manifoldInvested = 0;
  global.fetch = jest.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/v0/user/')) {
      return new Response(JSON.stringify({ id: MUSER.id, username: MUSER.username, bio: manifoldBio }), {
        status: 200,
      });
    }
    if (u.includes('/v0/get-user-portfolio')) {
      return new Response(JSON.stringify({ balance: manifoldBalance, investmentValue: manifoldInvested }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as any;
});
afterAll(() => {
  global.fetch = realFetch;
});

function as(agentId: string) {
  return {
    start: (username: string) =>
      request(app)
        .post('/api/import/manifold/start')
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', 'ws-any')
        .set('Content-Type', 'application/json')
        .send({ username }),
    claim: () =>
      request(app)
        .post('/api/import/manifold/claim')
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', 'ws-any')
        .send({}),
  };
}

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

describe('the import', () => {
  test('grants net worth in credits once the bio carries the code', async () => {
    manifoldBalance = 1800;
    manifoldInvested = 700;
    const started = await as('agent-mf-a').start('CalibratedCarol');
    expect(started.status).toBe(200);

    // Not yet in the bio: no grant, and the claim says why.
    const early = await as('agent-mf-a').claim();
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/bio/);
    expect(await balanceOf('agent-mf-a')).toBeCloseTo(1000, 5);

    manifoldBio = `hello ${started.body.code} world`;
    const claimed = await as('agent-mf-a').claim();
    expect(claimed.status).toBe(200);
    expect(claimed.body.granted).toBe(2500);
    expect(await balanceOf('agent-mf-a')).toBeCloseTo(3500, 5);
  });

  test('the grant caps at 10,000 (lowered 2026-08-28) and floors at 0', async () => {
    manifoldBalance = 5_000_000;
    const s1 = await as('agent-mf-a').start('CalibratedCarol');
    manifoldBio = s1.body.code;
    const big = await as('agent-mf-a').claim();
    expect(big.body.granted).toBe(10_000);

    // A negative account (Manifold loans allow it) imports as zero, and the
    // record is still burned for reuse.
    manifoldBalance = -50_000;
    manifoldBio = '';
    const s2 = await as('agent-mf-b').start('CalibratedCarol');
    expect(s2.status).toBe(409); // Carol is already claimed by A
  });

  test('one Manifold account cannot fund two Telarchy accounts', async () => {
    manifoldBalance = 100;
    const s1 = await as('agent-mf-a').start('CalibratedCarol');
    manifoldBio = s1.body.code;
    expect((await as('agent-mf-a').claim()).status).toBe(200);

    const s2 = await as('agent-mf-b').start('CalibratedCarol');
    expect(s2.status).toBe(409);
    expect(s2.body.error).toMatch(/already been imported/);
  });

  test('one Telarchy account cannot import twice', async () => {
    manifoldBalance = 100;
    const s1 = await as('agent-mf-a').start('CalibratedCarol');
    manifoldBio = s1.body.code;
    expect((await as('agent-mf-a').claim()).status).toBe(200);

    const again = await as('agent-mf-a').start('CalibratedCarol');
    expect(again.status).toBe(409);
    // And a stale claim replay grants nothing.
    const replay = await as('agent-mf-a').claim();
    expect(replay.status).not.toBe(200);
    expect(await balanceOf('agent-mf-a')).toBeCloseTo(1100, 5);
  });
});

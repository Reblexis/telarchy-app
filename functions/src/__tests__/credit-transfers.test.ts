/**
 * HTTP-level tests for POST /api/agents/transfer and GET /api/agents/transfers.
 *
 * The transfer endpoint is the wallet primitive external settlement systems
 * (e.g. the agent-economy bank's exchange) build on, so the invariants that
 * matter are: atomicity (no partial moves), the conditional-debit balance
 * check (no overdraft race), strict self-initiation (sender = caller's
 * identity), and the receipt being verifiable by the recipient.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, creditTransfers } from '../db/schema';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

// Injects req.auth before the router so requireIdentity / requireScope see
// the caller described by test headers (the real authMiddleware is mocked).
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const agentId = req.headers['x-test-agent'] as string | undefined;
  const scopes = (req.headers['x-test-scopes'] as string | undefined)?.split(',');
  const isMasterKey = req.headers['x-test-master'] === '1';
  if (agentId || isMasterKey) {
    req.auth = {
      capabilities: new Set(),
      workspaceId: 'ws-x',
      ...(agentId ? { agentId, scopes: scopes ?? ['*'] } : {}),
      ...(isMasterKey ? { isMasterKey: true } : {}),
    };
  }
  next();
});
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const ALICE = 'agent-alice-ct';
const BOB = 'agent-bob-ct';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: ALICE, apiKeyHash: 'h-alice-ct', balance: toUnits(10) },
    { id: BOB, apiKeyHash: 'h-bob-ct', balance: toUnits(1), nickname: 'BobTheBank' },
  ]);
});

async function balanceOf(id: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return fromUnits(row.balance as number);
}

describe('POST /api/agents/transfer', () => {
  it('moves credits atomically and writes a verifiable ledger row', async () => {
    const res = await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', ALICE)
      .send({ toAgent: BOB, amount: 2.5, memo: 'exchange-123' })
      .expect(201);

    expect(res.body.fromAgent).toBe(ALICE);
    expect(res.body.toAgent).toBe(BOB);
    expect(res.body.amount).toBe(2.5);
    expect(await balanceOf(ALICE)).toBeCloseTo(7.5);
    expect(await balanceOf(BOB)).toBeCloseTo(3.5);

    const [row] = await db.select().from(creditTransfers).where(eq(creditTransfers.id, res.body.id));
    expect(row.memo).toBe('exchange-123');
  });

  it('resolves recipients by nickname, case-insensitively', async () => {
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', ALICE)
      .send({ toAgent: 'bobthebank', amount: 1 })
      .expect(201);
    expect(await balanceOf(BOB)).toBeCloseTo(2);
  });

  it('rejects insufficient balance with 409 and moves nothing', async () => {
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', BOB)
      .send({ toAgent: ALICE, amount: 5 })
      .expect(409);
    expect(await balanceOf(ALICE)).toBeCloseTo(10);
    expect(await balanceOf(BOB)).toBeCloseTo(1);
    expect(await db.select().from(creditTransfers)).toHaveLength(0);
  });

  it('rejects self-transfers, unknown recipients, and bad amounts', async () => {
    const send = (body: object) => request(app).post('/api/agents/transfer').set('x-test-agent', ALICE).send(body);
    await send({ toAgent: ALICE, amount: 1 }).expect(400);
    await send({ toAgent: 'ghost', amount: 1 }).expect(404);
    await send({ toAgent: BOB, amount: 0 }).expect(400);
    await send({ toAgent: BOB, amount: -3 }).expect(400);
    await send({ toAgent: BOB }).expect(400);
  });

  it('is strictly self-initiated: master key has no sender identity', async () => {
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-master', '1')
      .send({ toAgent: BOB, amount: 1 })
      .expect(403);
  });

  it('enforces the account:wallet scope for agent keys', async () => {
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', ALICE)
      .set('x-test-scopes', 'account:read')
      .send({ toAgent: BOB, amount: 1 })
      .expect(403);
  });
});

describe('GET /api/agents/transfers', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', ALICE)
      .send({ toAgent: BOB, amount: 2, memo: 'a->b' });
    await request(app)
      .post('/api/agents/transfer')
      .set('x-test-agent', BOB)
      .send({ toAgent: ALICE, amount: 1, memo: 'b->a' });
  });

  it('filters by direction so a receiver can verify an inbound payment', async () => {
    const inbound = await request(app).get('/api/agents/transfers?direction=in').set('x-test-agent', BOB).expect(200);
    expect(inbound.body).toHaveLength(1);
    expect(inbound.body[0].memo).toBe('a->b');
    expect(inbound.body[0].fromAgent).toBe(ALICE);

    const all = await request(app).get('/api/agents/transfers').set('x-test-agent', BOB).expect(200);
    expect(all.body).toHaveLength(2);
  });

  it('lets the master key audit a named participant', async () => {
    const res = await request(app)
      .get(`/api/agents/transfers?agentId=${ALICE}&direction=out`)
      .set('x-test-master', '1')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].toAgent).toBe(BOB);
  });
});

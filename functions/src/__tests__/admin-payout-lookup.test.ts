/**
 * Who to pay, and where (owner ask 2026-08-20: "make sure its admin gated,
 * actually make it only at the /admin endpoint just to be sure").
 *
 * Payout details are the most sensitive field on a participant: a crypto
 * address is bearer-ish, and an email is a person. Every participant route
 * strips them unless the caller IS that participant, which is why this needed
 * its own door. What these pin is the door, not the prose:
 *
 *  - a signed-in nobody, and a workspace admin, both get 403
 *  - the payload carries the handle AND what has been approved to them, so the
 *    amount owed and the place to send it cannot disagree
 *  - a blank search does not dump the whole table
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, authUser, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { adminRouter } from '../routes/admin';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

let caller: { uid?: string; agentId?: string; isMasterKey?: boolean } = {};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller }).auth = caller;
  next();
});
app.use('/api/admin', adminRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-pay';

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  caller = { isMasterKey: true };

  await db.insert(workspaces).values({
    id: WS,
    name: 'Telarchy',
    createdBy: 'admin',
    visibility: 'public',
    slug: 'telarchy',
  });
  await db.insert(authUser).values([
    { id: 'u-boss', name: 'boss', email: 'boss@example.com' },
    { id: 'u-admin', name: 'admin', email: 'owner@example.com' },
  ]);
  await db.insert(agents).values([
    {
      id: 'the-big-boss',
      apiKeyHash: 'h1',
      balance: 0,
      nickname: 'the-big-boss',
      authUserId: 'u-boss',
      payoutHandle: 'USDC on Base: 0xdead',
      payoutMethod: { provider: 'crypto', asset: 'USDC', network: 'base', address: '0xdead' },
    },
    { id: 'quiet-one', apiKeyHash: 'h2', balance: 0, nickname: 'quiet-one' },
    { id: 'wsadmin', apiKeyHash: 'h3', balance: 0, nickname: 'wsadmin', authUserId: 'u-admin' },
  ]);
  await db.insert(proposals).values([
    {
      id: 'p1',
      workspaceId: WS,
      proposedBy: 'the-big-boss',
      title: 'Trade every week',
      askUsd: 30,
      status: 'approved',
      resolvedAt: new Date(),
    },
    {
      id: 'p2',
      workspaceId: WS,
      proposedBy: 'the-big-boss',
      title: 'Not taken',
      askUsd: 100,
      status: 'declined',
      resolvedAt: new Date(),
    },
  ]);
});

describe('the payout lookup door', () => {
  test('a signed-in nobody cannot open it', async () => {
    caller = { uid: 'u-boss' };
    const res = await request(app).get('/api/admin/participants');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('0xdead');
  });

  test('an agent key cannot open it, however privileged its workspace role', async () => {
    caller = { agentId: 'wsadmin' };
    const res = await request(app).get('/api/admin/participants');
    expect(res.status).toBe(403);
  });

  test('nobody at all cannot open it', async () => {
    caller = {};
    expect((await request(app).get('/api/admin/participants')).status).toBe(403);
  });
});

describe('what it answers', () => {
  test('the handle and the amount approved, together', async () => {
    const res = await request(app).get('/api/admin/participants?q=big');
    expect(res.status).toBe(200);
    const [row] = res.body.participants;
    expect(row.nickname).toBe('the-big-boss');
    expect(row.payoutHandle).toBe('USDC on Base: 0xdead');
    expect(row.payoutMethod.network).toBe('base');
    expect(row.email).toBe('boss@example.com');
    // Only what was APPROVED counts toward what is owed. The declined $100 is
    // on the record and is not money.
    expect(row.approvedUsd).toBe(30);
    expect(row.approvedContracts).toEqual([expect.objectContaining({ title: 'Trade every week', askUsd: 30 })]);
  });

  test('finds by account id and by email, not just by nickname', async () => {
    expect((await request(app).get('/api/admin/participants?q=the-big')).body.participants).toHaveLength(1);
    expect((await request(app).get('/api/admin/participants?q=boss@example')).body.participants).toHaveLength(1);
  });

  test('a blank search answers only people who can actually be paid', async () => {
    const res = await request(app).get('/api/admin/participants');
    const ids = res.body.participants.map((p: { id: string }) => p.id);
    expect(ids).toEqual(['the-big-boss']);
    // quiet-one has no payout details, so a blank search is not a table dump.
    expect(ids).not.toContain('quiet-one');
  });

  test('a search that matches nobody says so rather than falling back to everyone', async () => {
    const res = await request(app).get('/api/admin/participants?q=zzzznope');
    expect(res.body.participants).toEqual([]);
  });
});

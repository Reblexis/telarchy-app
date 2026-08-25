/**
 * The publish gate (owner ask 2026-08-20: "i think deploying to prod is too
 * easy"). CI lands a green build with no traffic; the site only changes when
 * someone presses Publish.
 *
 * What has to hold, and what these pin:
 *  - Only a platform admin can read what is waiting or publish it. Not a
 *    workspace admin: shifting production traffic is not a workspace act.
 *  - Off Cloud Run (local dev, this test) the state reads as unknown rather
 *    than inventing a release, and publishing refuses rather than pretending.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, authUser } from '../db/schema';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { adminRouter } from '../routes/admin';
import { publishRevision, releaseState } from '../services/release';
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

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values([
    {
      id: 'user-admin',
      email: 'admin@example.com',
      name: 'Admin',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'user-plain',
      email: 'plain@example.com',
      name: 'Plain',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await db.insert(agents).values([
    { id: 'a-admin', apiKeyHash: 'h-a', balance: toUnits(0), authUserId: 'user-admin', platformAdmin: true },
    { id: 'a-plain', apiKeyHash: 'h-p', balance: toUnits(0), authUserId: 'user-plain', platformAdmin: false },
  ]);
  caller = {};
});

describe('who may see or move a release', () => {
  test('an anonymous caller cannot read the release state', async () => {
    expect((await request(app).get('/api/admin/release')).status).toBe(403);
  });

  test('a signed-in non-admin cannot either', async () => {
    caller = { uid: 'user-plain', agentId: 'a-plain' };
    expect((await request(app).get('/api/admin/release')).status).toBe(403);
    expect((await request(app).post('/api/admin/publish').send({})).status).toBe(403);
  });

  test('a platform admin can read it', async () => {
    caller = { uid: 'user-admin', agentId: 'a-admin' };
    const res = await request(app).get('/api/admin/release');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('serving');
    expect(res.body).toHaveProperty('candidate');
    expect(res.body).toHaveProperty('isServing');
  });

  test('publishing is refused to everyone but a platform admin', async () => {
    caller = { uid: 'user-plain' };
    expect((await request(app).post('/api/admin/publish').send({})).status).toBe(403);
    caller = { isMasterKey: true };
    // The master key IS platform-authorized, so it gets past the gate and
    // fails on the environment instead, which is the next test's subject.
    expect((await request(app).post('/api/admin/publish').send({})).status).not.toBe(403);
  });
});

describe('off Cloud Run', () => {
  test('the state reads as unknown instead of inventing a release', async () => {
    const state = await releaseState();
    expect(state.serving).toBeNull();
    expect(state.candidate).toBeNull();
    expect(state.isServing).toBe(false);
    expect(state.error).toBeTruthy();
  });

  test('publishing refuses rather than pretending it worked', async () => {
    await expect(publishRevision()).rejects.toThrow();
  });

  test('the endpoint turns that into a 502, not a 200', async () => {
    caller = { isMasterKey: true };
    const res = await request(app).post('/api/admin/publish').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

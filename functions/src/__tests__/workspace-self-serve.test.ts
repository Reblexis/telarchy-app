/**
 * Who may open a floor (vision.md, "The owner side reopens", 2026-08-21).
 *
 * Creation was platform-admin-only from 2026-08-08 while Telarchy was
 * trader-first. It is open again, with two brakes that are about the shopfront
 * rather than about trust: a per-account cap, and a new floor starting
 * unlisted so nobody can list themselves onto the home page or into a running
 * prize season's scoring set.
 *
 * Unlisted still means live: these tests assert the floor is created and
 * reachable, not that it is hidden away.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

let authOverride: { uid?: string; agentId?: string; isMasterKey?: boolean } = {};
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => require('crypto').createHash('sha256').update(raw).digest('hex'),
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = { ...authOverride };
  next();
});
app.use('/api/workspaces', workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const OPERATOR = 'agent-operator';
const ADMIN = 'agent-platform-admin';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OPERATOR, apiKeyHash: 'h-op', balance: toUnits(1000) },
    { id: ADMIN, apiKeyHash: 'h-admin', balance: toUnits(1000), platformAdmin: true },
  ]);
  authOverride = { uid: OPERATOR, agentId: OPERATOR };
});

const create = (body: Record<string, unknown>) => request(app).post('/api/workspaces').send(body);

describe('an ordinary signed-in person may open a floor', () => {
  test('creation succeeds and returns a slug to land on', async () => {
    const r = await create({ name: 'Kleros', template: 'blank' });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBeTruthy();

    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, r.body.id));
    expect(row.createdBy).toBe(OPERATOR);
  });

  test('the floor starts unlisted even when public is asked for', async () => {
    const r = await create({ name: 'Kleros', template: 'blank', visibility: 'public' });
    expect(r.status).toBe(201);
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, r.body.id));
    expect(row.visibility).toBe('unlisted');
  });

  test('asking for nothing gets a market that is live at its address', async () => {
    // The service defaults to private, which made every market Otto opened
    // invisible at the address he had just handed over. This door has
    // promised unlisted in writing since it opened.
    const r = await create({ name: 'Kleros', template: 'blank' });
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, r.body.id));
    expect(row.visibility).toBe('unlisted');
  });

  test('private is still honoured: the clamp only removes listing', async () => {
    const r = await create({ name: 'Quiet', template: 'blank', visibility: 'private' });
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, r.body.id));
    expect(row.visibility).toBe('private');
  });
});

describe('the cap bounds one account', () => {
  test('the fourth floor is refused, and says how to get it lifted', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await create({ name: `Floor ${i}`, template: 'blank' })).status).toBe(201);
    }
    const r = await create({ name: 'Floor 4', template: 'blank' });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/telarchy\.com\/contact/);
    expect(r.body.cap).toBe(3);
  });

  test('the cap counts only your own floors', async () => {
    for (let i = 0; i < 3; i++) await create({ name: `Mine ${i}`, template: 'blank' });
    authOverride = { uid: 'agent-someone-else', agentId: 'agent-someone-else' };
    await db.insert(agents).values({ id: 'agent-someone-else', apiKeyHash: 'h-x', balance: toUnits(1000) });
    expect((await create({ name: 'Theirs', template: 'blank' })).status).toBe(201);
  });
});

describe('a platform admin is not braked', () => {
  test('public stays public and the cap does not apply', async () => {
    authOverride = { uid: ADMIN, agentId: ADMIN };
    for (let i = 0; i < 4; i++) {
      const r = await create({ name: `Admin floor ${i}`, template: 'blank', visibility: 'public' });
      expect(r.status).toBe(201);
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, r.body.id));
      expect(row.visibility).toBe('public');
    }
  });

  test('the master key is not braked either', async () => {
    authOverride = { isMasterKey: true };
    for (let i = 0; i < 4; i++) {
      const r = await create({ name: `Provisioned ${i}`, template: 'blank', visibility: 'public' });
      expect(r.status).toBe(201);
    }
  });
});

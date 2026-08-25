/**
 * HTTP-level tests for key-first onboarding (POST /api/onboard) and the
 * claim flow (GET/POST /api/onboard/claim).
 *
 * The contract under test: one unauthenticated call yields a participant with
 * the reduced unclaimed grant, a workspace it owns, a scoped key, and a claim
 * URL; claiming binds a browser account, tops the balance up to the full
 * grant, consumes the token, and removes the account's zero-activity
 * auto-provisioned participant so the claim is credit-neutral.
 */

// This suite tests the key-first onboarding flow itself, which is PAUSED in
// production behind the trader-first gate (vision.md, 2026-08-08). Open the
// gate for these tests; the closed-gate behavior is pinned in
// workspace-creation-gate.test.ts.
process.env.OWNER_ONBOARDING_OPEN = '1';

jest.mock('../db/client', () => require('./harness/test-db'));

// Simulated browser session: tests set SESSION_UID to control req.auth.uid.
let SESSION_UID: string | null = null;
jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      if (SESSION_UID) req.auth = { uid: SESSION_UID, capabilities: new Set(), workspaceId: '' };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, authUser, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { fromUnits, SIGNUP_CREDITS, toUnits, UNCLAIMED_SIGNUP_CREDITS } from '../lib/validation';
import { onboardRouter } from '../routes/onboard';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/onboard', onboardRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  SESSION_UID = null;
});

async function onboard(body: object = { workspace: { name: 'Onboard Test Co', template: 'blank' } }) {
  return request(app).post('/api/onboard').send(body);
}

describe('POST /api/onboard', () => {
  test('creates identity + workspace + scoped key + claim url in one call', async () => {
    const res = await onboard({
      workspace: { name: 'Onboard Test Co', template: 'blank', visibility: 'private' },
      nickname: 'onboard-test',
      bio: 'test identity',
    });
    expect(res.status).toBe(201);
    expect(res.body.participantId).toBeTruthy();
    expect(res.body.apiKey).toHaveLength(64);
    expect(res.body.scopes).toContain('workspace:manage');
    expect(res.body.scopes).not.toContain('*');
    expect(res.body.credits).toBe(UNCLAIMED_SIGNUP_CREDITS);
    expect(res.body.workspace.slug).toBeTruthy();
    expect(res.body.claimUrl).toMatch(/\/claim\?token=[0-9a-f]{64}$/);

    const [row] = await db.select().from(agents).where(eq(agents.id, res.body.participantId));
    expect(fromUnits(row.balance as number)).toBe(UNCLAIMED_SIGNUP_CREDITS);
    expect(row.claimTokenHash).toBeTruthy();
    expect(row.authUserId).toBeNull();

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, res.body.workspace.id));
    expect(ws.createdBy).toBe(res.body.participantId);
  });

  test('rejects a missing workspace object and rolls back on bad template', async () => {
    const noWs = await onboard({});
    expect(noWs.status).toBe(400);

    const badTemplate = await onboard({ agentId: 'rollback-me', workspace: { name: 'X', template: 'nope' } });
    expect(badTemplate.status).toBe(400);
    const rows = await db.select().from(agents).where(eq(agents.id, 'rollback-me'));
    expect(rows).toHaveLength(0);
  });
});

describe('claim flow', () => {
  test('preview, claim with fresh account, token consumed, credits topped up', async () => {
    const res = await onboard();
    const token = res.body.claimUrl.split('token=')[1];

    const preview = await request(app).get(`/api/onboard/claim/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.participantId).toBe(res.body.participantId);
    expect(preview.body.workspaces).toHaveLength(1);

    // Fresh browser account with its auto-provisioned zero-activity participant.
    await db.insert(authUser).values({ id: 'claimer-1', name: 'C', email: 'c1@example.com' });
    await db.insert(agents).values({
      id: 'claimer-1',
      apiKeyHash: 'h-claimer-1',
      authUserId: 'claimer-1',
      balance: toUnits(SIGNUP_CREDITS),
    });
    SESSION_UID = 'claimer-1';

    const claim = await request(app).post('/api/onboard/claim').send({ token });
    expect(claim.status).toBe(200);
    expect(claim.body.participantId).toBe(res.body.participantId);
    expect(claim.body.creditsToppedUp).toBe(SIGNUP_CREDITS - UNCLAIMED_SIGNUP_CREDITS);

    const [claimed] = await db.select().from(agents).where(eq(agents.id, res.body.participantId));
    expect(claimed.authUserId).toBe('claimer-1');
    expect(claimed.claimTokenHash).toBeNull();
    expect(fromUnits(claimed.balance as number)).toBe(SIGNUP_CREDITS);

    // Auto-provisioned participant merged away; its keys gone too.
    const orphan = await db.select().from(agents).where(eq(agents.id, 'claimer-1'));
    expect(orphan).toHaveLength(0);
    const orphanKeys = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, 'claimer-1'));
    expect(orphanKeys).toHaveLength(0);

    // Token is one-time.
    const again = await request(app).post('/api/onboard/claim').send({ token });
    expect(again.status).toBe(404);
  });

  test('refuses accounts whose own participant has activity', async () => {
    const res = await onboard();
    const token = res.body.claimUrl.split('token=')[1];

    await db.insert(authUser).values({ id: 'busy-1', name: 'B', email: 'b1@example.com' });
    await db.insert(agents).values({ id: 'busy-1', apiKeyHash: 'h-busy-1', authUserId: 'busy-1' });
    // Activity: this account created its own workspace already.
    await db.insert(workspaces).values({ id: 'ws-busy', name: 'Busy WS', slug: 'busy-ws', createdBy: 'busy-1' });
    SESSION_UID = 'busy-1';

    const claim = await request(app).post('/api/onboard/claim').send({ token });
    expect(claim.status).toBe(409);
  });

  test('requires a browser session', async () => {
    const res = await onboard();
    const token = res.body.claimUrl.split('token=')[1];
    const claim = await request(app).post('/api/onboard/claim').send({ token });
    expect(claim.status).toBe(401);
  });
});

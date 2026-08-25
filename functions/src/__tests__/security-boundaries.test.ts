/**
 * HTTP-level tests for cross-tenant authorization boundaries (2026-08-12
 * public-surface review). Each describe block pins one fixed exposure:
 *
 *  1. POST /api/agents/register must not grant read into a private workspace
 *     to anyone who merely knows its UUID (visibility is the access boundary,
 *     same rule as the join routes; private 404s so ids cannot be probed).
 *  2. DELETE /api/agents/:id is a platform-wide delete gated by a
 *     per-workspace capability; the target must be a member of the caller's
 *     workspace (same guard as POST /:id/credit).
 *  3. DELETE /api/workspaces/:id and PUT /:id/settings act on the PATH id;
 *     the capability must hold in that workspace, not just in whatever
 *     workspace the X-Workspace-Id header names.
 *  4. GET /api/agents and GET /api/agents/:id must not leak payment rails or
 *     identity bindings (payoutHandle, payoutMethod, walletAddress,
 *     authUserId, claimTokenHash) to viewers who are not that participant.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const capsHeader = (req.headers['x-test-caps'] as string) || 'read,trade,manage,manage_workspace';
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(
          capsHeader
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean),
        ),
      };
      next();
    },
    optionalAuthMiddleware: (req: any, _res: any, next: any) => {
      // Anonymous unless the test names an identity, mirroring the real
      // optional middleware which leaves req.auth unset for no credentials.
      if (req.headers['x-test-agent-id']) {
        req.auth = {
          agentId: req.headers['x-test-agent-id'],
          workspaceId: req.headers['x-workspace-id'],
          capabilities: new Set(),
        };
      }
      next();
    },
    getAuthWorkspaceMemberships: () => [],
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { agentsRouter } from '../routes/agents';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
// The register route mounts its own optional auth; everything else in these
// tests goes through the mocked authMiddleware.
app.use('/api/agents', (req, res, next) =>
  req.path === '/register' ? optionalAuthMiddleware(req, res, next) : authMiddleware(req, res, next),
);
app.use('/api/agents', agentsRouter);
app.use('/api/workspaces', authMiddleware, workspacesRouter);
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

const OWNER_A = 'agent-owner-a';
const OWNER_B = 'agent-owner-b';
const MEMBER_A = 'agent-member-a';
const WS_A = 'ws-boundary-a';
const WS_B = 'ws-boundary-b';

async function seed(visibilityA: 'public' | 'unlisted' | 'private' = 'public') {
  await db.insert(agents).values([
    { id: OWNER_A, apiKeyHash: 'h-owner-a', balance: 0 },
    { id: OWNER_B, apiKeyHash: 'h-owner-b', balance: 0 },
    {
      id: MEMBER_A,
      apiKeyHash: 'h-member-a',
      balance: 0,
      payoutHandle: 'PayPal: member@example.com',
      payoutMethod: { provider: 'paypal', email: 'member@example.com' },
      walletAddress: '0x1111111111111111111111111111111111111111',
      claimTokenHash: 'claim-hash-secret',
    },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_A,
    name: 'Workspace A',
    createdBy: OWNER_A,
    ownerAgentId: OWNER_A,
    visibility: visibilityA,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_B,
    name: 'Workspace B',
    createdBy: OWNER_B,
    ownerAgentId: OWNER_B,
    visibility: 'public',
  });
  // MEMBER_A joins workspace A's Public group.
  const [publicA] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS_A), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ memberIds: [...((publicA.memberIds as string[]) ?? []), MEMBER_A] })
    .where(eq(permissionGroups.id, publicA.id));
}

describe('POST /api/agents/register respects workspace visibility', () => {
  test('anonymous registration into a private workspace 404s and creates nothing', async () => {
    await seed('private');
    const res = await request(app).post('/api/agents/register').send({ agentId: 'agent-probe', workspaceId: WS_A });

    expect(res.status).toBe(404);
    const rows = await db.select().from(agents).where(eq(agents.id, 'agent-probe'));
    expect(rows).toHaveLength(0);
    const [publicA] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, WS_A), eq(permissionGroups.type, 'public')));
    expect((publicA.memberIds as string[]) ?? []).not.toContain('agent-probe');
  });

  test('a private workspace is indistinguishable from a missing one', async () => {
    await seed('private');
    const priv = await request(app).post('/api/agents/register').send({ agentId: 'agent-probe-2', workspaceId: WS_A });
    const missing = await request(app)
      .post('/api/agents/register')
      .send({ agentId: 'agent-probe-3', workspaceId: 'ws-does-not-exist' });

    expect(priv.status).toBe(missing.status);
    expect(priv.body).toEqual(missing.body);
  });

  test('anonymous registration into a public workspace still works', async () => {
    await seed('public');
    const res = await request(app).post('/api/agents/register').send({ agentId: 'agent-new-pub', workspaceId: WS_A });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBeTruthy();
  });

  test('the workspace owner can still register a bot into their private workspace', async () => {
    await seed('private');
    const res = await request(app)
      .post('/api/agents/register')
      .set('X-Test-Agent-Id', OWNER_A)
      .send({ agentId: 'agent-owner-bot', workspaceId: WS_A });
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/agents/:id is bounded to the caller workspace', () => {
  test('manage in workspace B cannot delete a participant of workspace A', async () => {
    await seed();
    const res = await request(app)
      .delete(`/api/agents/${MEMBER_A}`)
      .set('X-Test-Agent-Id', OWNER_B)
      .set('X-Workspace-Id', WS_B)
      .set('X-Test-Caps', 'read,manage');

    expect(res.status).toBe(403);
    const rows = await db.select().from(agents).where(eq(agents.id, MEMBER_A));
    expect(rows).toHaveLength(1);
  });

  test('manage in the target participant workspace still deletes', async () => {
    await seed();
    const res = await request(app)
      .delete(`/api/agents/${MEMBER_A}`)
      .set('X-Test-Agent-Id', OWNER_A)
      .set('X-Workspace-Id', WS_A)
      .set('X-Test-Caps', 'read,manage');

    expect(res.status).toBe(200);
    const rows = await db.select().from(agents).where(eq(agents.id, MEMBER_A));
    expect(rows).toHaveLength(0);
  });
});

describe('workspace lifecycle routes verify the capability on the PATH workspace', () => {
  test('manage_workspace in A does not delete workspace B', async () => {
    await seed();
    const res = await request(app)
      .delete(`/api/workspaces/${WS_B}`)
      .set('X-Test-Agent-Id', OWNER_A)
      .set('X-Workspace-Id', WS_A);

    expect(res.status).toBe(403);
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, WS_B));
    expect(rows).toHaveLength(1);
  });

  test('manage in A does not edit workspace B settings', async () => {
    await seed();
    const res = await request(app)
      .put(`/api/workspaces/${WS_B}/settings`)
      .set('X-Test-Agent-Id', OWNER_A)
      .set('X-Workspace-Id', WS_A)
      .send({ visibility: 'public' });

    expect(res.status).toBe(403);
  });

  test('the owner of the path workspace passes even with a different header workspace', async () => {
    await seed();
    const res = await request(app)
      .put(`/api/workspaces/${WS_B}/settings`)
      .set('X-Test-Agent-Id', OWNER_B)
      .set('X-Workspace-Id', WS_A)
      .send({ description: 'edited by its own owner' });

    expect(res.status).toBe(200);
  });

  test('the owner can still delete their own workspace', async () => {
    await seed();
    const res = await request(app)
      .delete(`/api/workspaces/${WS_B}`)
      .set('X-Test-Agent-Id', OWNER_B)
      .set('X-Workspace-Id', WS_B);

    expect(res.status).toBe(200);
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, WS_B));
    expect(rows).toHaveLength(0);
  });
});

describe('agent reads do not leak payment rails or identity bindings', () => {
  const PRIVATE_FIELDS = [
    'apiKeyHash',
    'claimTokenHash',
    'payoutMethod',
    'payoutHandle',
    'walletAddress',
    'authUserId',
    'ownerUserId',
  ];

  test('GET /api/agents/:id strips private fields for a workspace manager', async () => {
    await seed();
    const res = await request(app)
      .get(`/api/agents/${MEMBER_A}`)
      .set('X-Test-Agent-Id', OWNER_A)
      .set('X-Workspace-Id', WS_A)
      .set('X-Test-Caps', 'read,manage');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MEMBER_A);
    for (const field of PRIVATE_FIELDS) {
      expect(res.body).not.toHaveProperty(field);
    }
  });

  test('GET /api/agents/:id keeps payout fields for the participant itself', async () => {
    await seed();
    const res = await request(app)
      .get(`/api/agents/${MEMBER_A}`)
      .set('X-Test-Agent-Id', MEMBER_A)
      .set('X-Workspace-Id', WS_A);

    expect(res.status).toBe(200);
    expect(res.body.payoutHandle).toBe('PayPal: member@example.com');
    expect(res.body.walletAddress).toBe('0x1111111111111111111111111111111111111111');
    // Secrets never leave the API, self or not.
    expect(res.body).not.toHaveProperty('apiKeyHash');
    expect(res.body).not.toHaveProperty('claimTokenHash');
  });

  test('GET /api/agents strips private fields from co-member rows', async () => {
    await seed();
    const res = await request(app)
      .get('/api/agents')
      .set('X-Test-Agent-Id', OWNER_A)
      .set('X-Workspace-Id', WS_A)
      .set('X-Test-Caps', 'read,manage');

    expect(res.status).toBe(200);
    const member = res.body.find((row: { id: string }) => row.id === MEMBER_A);
    expect(member).toBeTruthy();
    for (const field of PRIVATE_FIELDS) {
      expect(member).not.toHaveProperty(field);
    }
  });
});

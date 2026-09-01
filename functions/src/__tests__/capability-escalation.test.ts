/**
 * THE RULE: you cannot grant a capability you do not hold, and you cannot
 * write into a workspace you do not administer.
 *
 * Two ways that was false (bug hunt 2026-08-31):
 *
 * 1. `PUT /api/groups/:id` is gated on `manage`, and `manage_workspace` is
 *    an editable member of VALID_CAPS, so an admin teammate could add it to
 *    their own group and then delete the workspace.
 *    `docs/guides/creating.md` says the opposite in bold: "manage_workspace
 *    is not implied by manage, and the Admin group does not have it ... they
 *    cannot delete the workspace. In practice only the creator can." The
 *    doc's own grant path stays open: somebody who HOLDS it may hand it out.
 *    This is the rule `granterCoversScopes` already applies to key scopes.
 *
 * 2. The two telemetry writes check `manage` against the header workspace
 *    and then store the `workspaceId` from the BODY, so anyone who opened
 *    their own floor could write rows into another tenant's telemetry, which
 *    that tenant's admin reads back as their own. The heartbeat upsert
 *    conflicts on `agentId` alone, so it could also overwrite the operator's
 *    fleet rows outright.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    const caps = (req.headers['x-test-caps'] as string) || 'read,trade,manage';
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(
        caps
          .split(',')
          .map((c: string) => c.trim())
          .filter(Boolean),
      ),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentHeartbeats, agents, agentTraces, permissionGroups } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { authMiddleware } from '../middleware/auth';
import { adminRouter } from '../routes/admin';
import { groupsRouter } from '../routes/groups';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/groups', authMiddleware, groupsRouter);
app.use('/api/admin', authMiddleware, adminRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const MALLORY = 'agent-esc-mallory';
const VICTIM = 'agent-esc-victim';
const WS_M = 'ws-esc-mallory';
const WS_V = 'ws-esc-victim';

async function seed() {
  await db.insert(agents).values([
    { id: MALLORY, apiKeyHash: 'h-esc-m', balance: 0 },
    { id: VICTIM, apiKeyHash: 'h-esc-v', balance: 0 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_M,
    name: 'Mallory floor',
    createdBy: MALLORY,
    ownerAgentId: MALLORY,
    visibility: 'public',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_V,
    name: 'Victim floor',
    createdBy: VICTIM,
    ownerAgentId: VICTIM,
    visibility: 'public',
  });
}

const after = (g: { capabilities: unknown }) => g.capabilities as string[];

const adminGroupOf = async (wsId: string) => {
  const [g] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, wsId), eq(permissionGroups.type, 'admin')));
  return g;
};

describe('a capability is not self-grantable', () => {
  test('manage alone cannot add manage_workspace to a group', async () => {
    await seed();
    const g = await adminGroupOf(WS_M);

    const res = await request(app)
      .put(`/api/groups/${g.id}`)
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .set('X-Test-Caps', 'read,trade,manage')
      .send({ capabilities: ['read', 'trade', 'manage', 'manage_workspace'] });

    expect(res.status).toBe(403);
    const after = await adminGroupOf(WS_M);
    expect(after.capabilities as string[]).not.toContain('manage_workspace');
  });

  test('somebody who holds manage_workspace may still hand it out', async () => {
    await seed();
    const g = await adminGroupOf(WS_M);

    const res = await request(app)
      .put(`/api/groups/${g.id}`)
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .set('X-Test-Caps', 'read,trade,manage,manage_workspace')
      .send({ capabilities: ['read', 'trade', 'manage', 'manage_workspace'] });

    expect(res.status).toBe(200);
    const after = await adminGroupOf(WS_M);
    expect(after.capabilities as string[]).toContain('manage_workspace');
  });

  test('capabilities the caller does hold are still editable', async () => {
    await seed();
    const g = await adminGroupOf(WS_M);

    const res = await request(app)
      .put(`/api/groups/${g.id}`)
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .set('X-Test-Caps', 'read,trade,manage')
      .send({ capabilities: ['read', 'trade'] });

    expect(res.status).toBe(200);
    expect(after(await adminGroupOf(WS_M))).toEqual(['read', 'trade']);
  });
});

describe('the seeded Admin group matches what the guide promises', () => {
  test('no seeded group carries manage_workspace', async () => {
    await seed();
    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS_M));
    for (const g of groups) {
      expect(g.capabilities as string[]).not.toContain('manage_workspace');
    }
  });

  test('the two seeders agree, so a re-seed cannot widen a group', async () => {
    const { SYSTEM_GROUP_CAPABILITIES } = await import('../routes/groups');
    expect(SYSTEM_GROUP_CAPABILITIES.admin).not.toContain('manage_workspace');
  });
});

describe('telemetry lands in the workspace the caller administers', () => {
  test('a trace cannot be written into somebody else workspace', async () => {
    await seed();

    const res = await request(app)
      .post('/api/admin/agent-traces')
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .send({ workspaceId: WS_V, agentId: MALLORY, strategy: 'forged', entries: [] });

    expect(res.status).toBe(403);
    const rows = await db.select().from(agentTraces).where(eq(agentTraces.workspaceId, WS_V));
    expect(rows).toHaveLength(0);
  });

  test('a trace into your own workspace still works', async () => {
    await seed();

    const res = await request(app)
      .post('/api/admin/agent-traces')
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .send({ workspaceId: WS_M, agentId: MALLORY, strategy: 'mine', entries: [] });

    expect(res.status).toBe(201);
    const rows = await db.select().from(agentTraces).where(eq(agentTraces.workspaceId, WS_M));
    expect(rows).toHaveLength(1);
  });

  test('a heartbeat cannot be stamped into somebody else workspace', async () => {
    await seed();

    const res = await request(app)
      .post('/api/admin/agent-heartbeat')
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .send({ agentId: VICTIM, status: 'error', workspaceId: WS_V, lastError: 'out of credits' });

    expect(res.status).toBe(403);
    const rows = await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.agentId, VICTIM));
    expect(rows).toHaveLength(0);
  });

  test('a heartbeat for your own participant still works', async () => {
    await seed();

    const res = await request(app)
      .post('/api/admin/agent-heartbeat')
      .set('X-Test-Agent-Id', MALLORY)
      .set('X-Workspace-Id', WS_M)
      .send({ agentId: MALLORY, status: 'idle' });

    expect(res.status).toBe(204);
    const rows = await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.agentId, MALLORY));
    expect(rows).toHaveLength(1);
  });
});

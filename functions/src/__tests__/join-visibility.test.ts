/**
 * HTTP-level tests for self-join visibility enforcement.
 *
 * Behavior (docs/guides/creating.md, "Visibility"): visibility is the access
 * boundary, not knowledge of the workspace UUID. PUBLIC workspaces are
 * self-joinable by any authenticated identity; unlisted and private ones are
 * not, and return 404 rather than 403 so the endpoint cannot be used to probe
 * for their ids. Unlisted joined that side on 2026-09-01: a floor is created
 * unlisted, and its slug comes from its name, so "joinable by link" meant
 * joinable by anyone who guessed a company name.
 *
 * Before this was enforced, both join handlers checked only that the workspace
 * existed, so a leaked or guessed UUID was enough to enter a private workspace
 * and pick up whatever the Public group happened to hold. The companion case is
 * the stale capability: a workspace taken private must not leave `trade` on its
 * Public group, or the next joiner silently gets trading rights the owner
 * believes they revoked.
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
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, metrics, permissionGroups } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/workspaces', workspacesRouter);
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

const OWNER = 'agent-owner';
const OUTSIDER = 'agent-outsider';

type Vis = 'public' | 'unlisted' | 'private';

async function seedWorkspace(wsId: string, visibility: Vis) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId,
    name: `WS ${visibility}`,
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility,
  });
  // Going public is gated on a metric existing (docs/vision.md, 2026-08-28);
  // this spec is about the Public group's capabilities, so every workspace
  // it seeds satisfies the gate.
  await db.insert(metrics).values({
    id: `metric-${wsId}`,
    workspaceId: wsId,
    name: 'A number',
    description: '',
    value: 0,
    formula: '',
    order: 0,
  });
}

async function seedAgents() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: 0 },
    { id: OUTSIDER, apiKeyHash: 'h-outsider', balance: 0 },
  ]);
}

function publicGroupOf(wsId: string) {
  return db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, wsId), eq(permissionGroups.type, 'public')))
    .then(rows => rows[0]);
}

function joinViaMarketplace(wsId: string, callerId: string) {
  return request(app)
    .post(`/api/marketplace/${wsId}/join`)
    .set('X-Test-Agent-Id', callerId)
    .set('X-Test-Caps', 'read')
    .send({});
}

function joinViaWorkspaces(wsId: string, callerId: string) {
  return request(app)
    .post(`/api/workspaces/${wsId}/join`)
    .set('X-Test-Agent-Id', callerId)
    .set('X-Test-Caps', 'read')
    .send({});
}

describe('self-join is gated on workspace visibility', () => {
  test('an outsider holding the UUID cannot self-join a private workspace via /marketplace', async () => {
    await seedAgents();
    await seedWorkspace('ws-private', 'private');

    const res = await joinViaMarketplace('ws-private', OUTSIDER);

    // 404, not 403: a private workspace must be indistinguishable from one that
    // does not exist, or the endpoint becomes a probe for private ids.
    expect(res.status).toBe(404);
    const group = await publicGroupOf('ws-private');
    expect((group.memberIds as string[]) ?? []).not.toContain(OUTSIDER);
  });

  test('the legacy /workspaces/:id/join path is gated identically', async () => {
    await seedAgents();
    await seedWorkspace('ws-private-2', 'private');

    const res = await joinViaWorkspaces('ws-private-2', OUTSIDER);

    expect(res.status).toBe(404);
    const group = await publicGroupOf('ws-private-2');
    expect((group.memberIds as string[]) ?? []).not.toContain(OUTSIDER);
  });

  test('a private workspace and a nonexistent one are indistinguishable', async () => {
    await seedAgents();
    await seedWorkspace('ws-private-3', 'private');

    const priv = await joinViaMarketplace('ws-private-3', OUTSIDER);
    const missing = await joinViaMarketplace('ws-does-not-exist', OUTSIDER);

    expect(priv.status).toBe(missing.status);
    expect(priv.body).toEqual(missing.body);
  });

  test('a public workspace is still self-joinable', async () => {
    await seedAgents();
    await seedWorkspace('ws-public', 'public');

    const res = await joinViaMarketplace('ws-public', OUTSIDER);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const group = await publicGroupOf('ws-public');
    expect(group.memberIds as string[]).toContain(OUTSIDER);
  });

  test('an unlisted workspace is NOT self-joinable, the same as a private one', async () => {
    // Amended 2026-09-01: this expected 201. Unlisted answered a stranger,
    // and a floor is CREATED unlisted, so a founder's floor was joinable by
    // anyone who guessed the slug taken from its name. Unlisted now grants a
    // stranger exactly what private does, which is nothing
    // (docs/guides/creating.md; owner decision "unlisted should be same as
    // private ... private but obviously visible to the owner").
    await seedAgents();
    await seedWorkspace('ws-unlisted', 'unlisted');

    const res = await joinViaMarketplace('ws-unlisted', OUTSIDER);

    expect(res.status).toBe(404);
    const group = await publicGroupOf('ws-unlisted');
    expect(group.memberIds as string[]).not.toContain(OUTSIDER);
  });

  test('joining twice is idempotent and reports alreadyMember', async () => {
    await seedAgents();
    await seedWorkspace('ws-public-2', 'public');

    const first = await joinViaMarketplace('ws-public-2', OUTSIDER);
    const second = await joinViaMarketplace('ws-public-2', OUTSIDER);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.alreadyMember).toBe(true);
    const group = await publicGroupOf('ws-public-2');
    expect((group.memberIds as string[]).filter(id => id === OUTSIDER)).toHaveLength(1);
  });
});

describe('taking a workspace private revokes open trading', () => {
  test('PUT /settings visibility=private strips trade from the Public group', async () => {
    await seedAgents();
    await seedWorkspace('ws-open', 'public');

    // Put the workspace in the "Open" configuration: public + Public group trades.
    const group = await publicGroupOf('ws-open');
    await db
      .update(permissionGroups)
      .set({ capabilities: ['read', 'trade'] })
      .where(eq(permissionGroups.id, group.id));

    const res = await request(app)
      .put('/api/workspaces/ws-open/settings')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', 'ws-open')
      .send({ visibility: 'private' });
    expect(res.status).toBe(200);

    const after = await publicGroupOf('ws-open');
    expect(after.capabilities as string[]).not.toContain('trade');
    expect(after.capabilities as string[]).toContain('read');
  });

  test('going public without trade leaves the Public group untouched', async () => {
    await seedAgents();
    await seedWorkspace('ws-view', 'private');

    const res = await request(app)
      .put('/api/workspaces/ws-view/settings')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', 'ws-view')
      .send({ visibility: 'public' });
    expect(res.status).toBe(200);

    const after = await publicGroupOf('ws-view');
    // "public, look but do not trade" stays a valid configuration.
    expect(after.capabilities as string[]).toContain('read');
    expect(after.capabilities as string[]).not.toContain('trade');
  });
});

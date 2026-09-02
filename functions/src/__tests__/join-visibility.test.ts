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

  test('a settings edit that does not name visibility leaves the Public group alone', async () => {
    // docs/guides/creating.md: "Only a write that names `visibility` touches
    // the Public group." Until 2026-09-02 an absent visibility counted as
    // restricted (undefined is not 'public'), so editing the description of a
    // published floor silently stripped `trade`; the Wallpaper Animator floor
    // went read-only that way four hours after it was published, and its
    // owner could not trade on his own proposal (owner report 2026-09-02).
    await seedAgents();
    await seedWorkspace('ws-open-edit', 'public');
    const group = await publicGroupOf('ws-open-edit');
    await db
      .update(permissionGroups)
      .set({ capabilities: ['read', 'trade'] })
      .where(eq(permissionGroups.id, group.id));

    for (const body of [{ name: 'Renamed floor' }, { description: 'A new description' }, { subjectAbout: 'about' }]) {
      const res = await request(app)
        .put('/api/workspaces/ws-open-edit/settings')
        .set('X-Test-Agent-Id', OWNER)
        .set('X-Workspace-Id', 'ws-open-edit')
        .send(body);
      expect(res.status).toBe(200);
      const after = await publicGroupOf('ws-open-edit');
      expect(after.capabilities as string[]).toEqual(expect.arrayContaining(['read', 'trade']));
    }
  });

  test('re-sending visibility=public on a public floor changes nothing', async () => {
    await seedAgents();
    await seedWorkspace('ws-open-again', 'public');
    const res = await request(app)
      .put('/api/workspaces/ws-open-again/settings')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', 'ws-open-again')
      .send({ visibility: 'public' });
    expect(res.status).toBe(200);
    expect((await publicGroupOf('ws-open-again')).capabilities as string[]).toEqual(['read', 'trade']);
  });

  test('publishing a floor grants the Public group trade', async () => {
    // The rule (docs/guides/creating.md, "Public means tradeable"): a public
    // floor is a tradeable one. Before this, publishing left the Public group
    // on `read`, so every visitor could read the prices and none could trade,
    // and the page said nothing about why (owner report, 2026-09-01).
    await seedAgents();
    await seedWorkspace('ws-view', 'private');
    expect((await publicGroupOf('ws-view')).capabilities as string[]).not.toContain('trade');

    const res = await request(app)
      .put('/api/workspaces/ws-view/settings')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', 'ws-view')
      .send({ visibility: 'public' });
    expect(res.status).toBe(200);

    const after = await publicGroupOf('ws-view');
    expect(after.capabilities as string[]).toEqual(expect.arrayContaining(['read', 'trade']));
  });

  test('a floor created public is tradeable from the first moment', async () => {
    await seedAgents();
    await seedWorkspace('ws-born-public', 'public');
    const g = await publicGroupOf('ws-born-public');
    expect(g.capabilities as string[]).toEqual(expect.arrayContaining(['read', 'trade']));
  });

  test('an unlisted or private floor is seeded without trade', async () => {
    await seedAgents();
    await seedWorkspace('ws-unlisted', 'unlisted');
    await seedWorkspace('ws-private', 'private');
    for (const id of ['ws-unlisted', 'ws-private']) {
      expect((await publicGroupOf(id)).capabilities as string[]).not.toContain('trade');
    }
  });

  test('publish, unpublish and publish again ends tradeable, with no duplicate caps', async () => {
    await seedAgents();
    await seedWorkspace('ws-round', 'private');
    const flip = (visibility: string) =>
      request(app)
        .put('/api/workspaces/ws-round/settings')
        .set('X-Test-Agent-Id', OWNER)
        .set('X-Workspace-Id', 'ws-round')
        .send({ visibility });

    await flip('public');
    await flip('private');
    expect((await publicGroupOf('ws-round')).capabilities as string[]).not.toContain('trade');
    await flip('public');
    const caps = (await publicGroupOf('ws-round')).capabilities as string[];
    expect(caps).toEqual(expect.arrayContaining(['read', 'trade']));
    expect(caps.filter(c => c === 'trade')).toHaveLength(1);
    expect(caps.filter(c => c === 'read')).toHaveLength(1);
  });

  test('publishing grants trade and nothing more, and leaves the other groups alone', async () => {
    // The owner keeps manage through Admin; publishing must not hand `manage`
    // or `manage_workspace` to the public, and must not touch the other groups.
    await seedAgents();
    await seedWorkspace('ws-caps', 'private');
    const before = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, 'ws-caps'));
    await request(app)
      .put('/api/workspaces/ws-caps/settings')
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', 'ws-caps')
      .send({ visibility: 'public' });

    const pub = await publicGroupOf('ws-caps');
    expect(pub.capabilities as string[]).not.toContain('manage');
    expect(pub.capabilities as string[]).not.toContain('manage_workspace');

    const after = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, 'ws-caps'));
    for (const group of after) {
      if (group.type === 'public') continue;
      const was = before.find(b => b.id === group.id);
      expect(group.capabilities).toEqual(was?.capabilities);
    }
  });
});

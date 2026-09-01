/**
 * Register into a workspace by its slug, which is the only name a newcomer has.
 *
 * `X-Workspace-Id` has accepted a slug for months, because "someone arriving
 * from a shared link has a slug long before they have an id"
 * (lib/public-read.ts). Every door hands out slugs: telarchy.com/telarchy, the
 * public workspace list, the guides. And the ONE write that turns a reader into
 * a participant matched on the id column only, so it answered
 * `404 Workspace not found` about a workspace that plainly exists.
 *
 * Found 2026-09-01 by running the repository's own reference agent against
 * production: it died on its first call, before it had done anything.
 *
 * The rule this file protects is the one the fix could break. A slug must NOT
 * become a way past the visibility boundary: a private workspace 404s whether
 * it is named by id or by slug, so that neither can be probed.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = { agentId: null, uid: null, workspaceId: null, capabilities: new Set(['read']) };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (req: any, _res: any, next: any) => {
      req.auth = undefined;
      next();
    },
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

const OWNER = 'slug-owner';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-slug-owner', balance: toUnits(0) }]);
});

async function floor(id: string, slug: string, visibility: 'public' | 'unlisted' | 'private'): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: id,
    name: slug,
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility,
  });
  await db.update(workspaces).set({ slug }).where(eq(workspaces.id, id));
}

const register = (agentId: string, workspaceId: string) =>
  request(app)
    .post('/api/agents/register')
    .set('Content-Type', 'application/json')
    .send({ agentId, workspaceId, source: 'github' });

describe('the name a newcomer actually has', () => {
  test('THE FIX: registering by slug works', async () => {
    await floor('ws-uuid-1', 'telarchy', 'public');
    const res = await register('bot-by-slug', 'telarchy');
    expect({ status: res.status, agentId: res.body.agentId }).toEqual({
      status: 201,
      agentId: 'bot-by-slug',
    });
    expect(res.body.apiKey).toBeTruthy();
  });

  test('THE OTHER HALF: the rows it writes carry the resolved id, never the slug', async () => {
    // Resolving the slug is only half the fix. Everything downstream writes
    // rows keyed by the workspace, and a key row or a group membership holding
    // a slug where an id belongs is a participant that exists and is a member
    // of nothing: it registers successfully and then cannot read or trade.
    await floor('ws-uuid-8', 'telarchy', 'public');
    const res = await register('bot-rows', 'telarchy');
    expect(res.status).toBe(201);

    const [key] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, 'bot-rows'));
    expect(key.workspaceId).toBe('ws-uuid-8');

    // And it actually landed in that floor's Public group.
    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, 'ws-uuid-8'));
    const pub = groups.find(g => g.type === 'public');
    expect((pub?.memberIds as string[]) ?? []).toContain('bot-rows');
  });

  test('registering by id still works, unchanged', async () => {
    await floor('ws-uuid-2', 'telarchy', 'public');
    const res = await register('bot-by-id', 'ws-uuid-2');
    expect(res.status).toBe(201);
  });

  test('the slug is matched case-insensitively, as the header matches it', async () => {
    await floor('ws-uuid-3', 'telarchy', 'public');
    const res = await register('bot-by-caps', 'TELARCHY');
    expect(res.status).toBe(201);
  });
});

describe('what the slug must not buy you', () => {
  test('THE RULE: a private floor still 404s by slug, exactly as by id', async () => {
    // The whole point of the 404 is that neither name can be probed. If the
    // slug were a way in, this fix would have opened every private workspace
    // to anyone who could guess a word.
    await floor('ws-uuid-5', 'secret', 'private');
    const bySlug = await register('bot-private-slug', 'secret');
    const byId = await register('bot-private-id', 'ws-uuid-5');
    expect({ bySlug: bySlug.status, byId: byId.status }).toEqual({ bySlug: 404, byId: 404 });
    expect(await db.select().from(agents).where(eq(agents.id, 'bot-private-slug'))).toHaveLength(0);
  });

  test('THE RULE: an unlisted floor 404s by slug, exactly as private does', async () => {
    // `public` is the only visibility that answers a caller with no identity
    // (docs/guides/creating.md). Unlisted and private differ in intent, not in
    // access, and that was tightened on 2026-09-01 (P0-7 in the bug hunt)
    // because the slug is derived from the floor's NAME: a stranger guessing a
    // company name was reading its metrics. Making the slug work on register
    // must not quietly reopen that.
    await floor('ws-uuid-7', 'quiet', 'unlisted');
    const bySlug = await register('bot-unlisted-slug', 'quiet');
    const byId = await register('bot-unlisted-id', 'ws-uuid-7');
    expect({ bySlug: bySlug.status, byId: byId.status }).toEqual({ bySlug: 404, byId: 404 });
  });

  test('a slug nobody has still 404s', async () => {
    await floor('ws-uuid-6', 'telarchy', 'public');
    const res = await register('bot-nowhere', 'no-such-floor');
    expect(res.status).toBe(404);
  });

  test('an empty workspaceId is still refused', async () => {
    const res = await register('bot-empty', '');
    expect(res.status).toBe(400);
  });
});

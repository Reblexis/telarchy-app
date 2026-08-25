/**
 * HTTP-level test for POST /api/agents/register auto-add behavior.
 *
 * A self-registering participant must be added to the workspace Public
 * group ONLY. Trading rights flow from the Public group's capabilities
 * (Open workspaces grant 'trade' there); auto-adding to Trader would
 * bypass the workspace owner's permission policy and silently grant
 * trade rights in workspaces where Public is read-only.
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
import { agents, permissionGroups } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const WS = 'ws-register-auto-add';
const OWNER = 'agent-owner-rg';
const NEW_AGENT = 'agent-new-rg';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seedWorkspace() {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner-rg', balance: toUnits(0) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Register Auto-Add Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
}

describe('POST /api/agents/register auto-add', () => {
  test('adds the new agent to the Public group', async () => {
    await seedWorkspace();
    const r = await request(app).post('/api/agents/register').send({ agentId: NEW_AGENT, workspaceId: WS });
    expect(r.status).toBe(201);

    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
    const publicGroup = groups.find(g => g.type === 'public')!;
    expect(publicGroup.memberIds as string[]).toContain(NEW_AGENT);
  });

  test('does NOT add the new agent to the Trader group', async () => {
    await seedWorkspace();
    const r = await request(app).post('/api/agents/register').send({ agentId: NEW_AGENT, workspaceId: WS });
    expect(r.status).toBe(201);

    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
    const traderGroup = groups.find(g => g.type === 'trader')!;
    expect(traderGroup.memberIds as string[]).not.toContain(NEW_AGENT);
  });
});

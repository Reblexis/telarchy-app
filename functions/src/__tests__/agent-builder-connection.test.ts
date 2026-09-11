/** The builder's actual orchestration against the HTTP routes and database.
 * Only the login provider is stubbed; scopes, ownership, joins and funding
 * use real middleware. See docs/audience-pages.md, Agent-builder setup. */
jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: (h: unknown) => h }));
jest.mock('../auth', () => ({
  auth: {
    api: {
      getSession: async ({ headers }: any) => (headers['x-test-session'] ? { user: { id: 'builder-user' } } : null),
    },
  },
}));
jest.mock('../../../src/lib/api', () => ({ api: {} }));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, permissionGroups } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { agentsRouter } from '../routes/agents';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const { api } = require('../../../src/lib/api');
const { connectBuilder, defaults } = require('../../../src/lib/agent-builder');
const app = express();
app.use(express.json());
app.use('/api/agents', authMiddleware, agentsRouter);
app.use('/api/marketplace', marketplaceRouter);
app.get('/probe', authMiddleware, (req, res) =>
  res.json({ id: req.auth?.agentId, caps: [...(req.auth?.capabilities ?? [])] }),
);
const WS = 'builder-public';
const ownerHeaders = { 'X-Test-Session': 'yes', 'X-Workspace-Id': WS };
async function wire(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: string | object,
  headers = ownerHeaders as Record<string, string>,
) {
  const res = await request(app)[method](path).set(headers).send(body);
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
beforeAll(async () => {
  await ensureMigrations();
}, 60000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values({ id: 'builder-user', name: 'Builder', email: 'builder@example.test' });
  await db
    .insert(agents)
    .values({ id: 'builder-human', apiKeyHash: 'human-hash', authUserId: 'builder-user', balance: toUnits(100) });
  await db.insert(agents).values({ id: 'workspace-owner', apiKeyHash: 'workspace-owner-hash', balance: 0 });
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Builder workspace',
    createdBy: 'workspace-owner',
    ownerAgentId: 'workspace-owner',
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const pub = groups.find(g => g.type === 'public')!;
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, pub.id));
  Object.assign(api, {
    getMyAgents: () => wire('get', '/api/agents/mine'),
    createAgent: (body: any) => wire('post', '/api/agents', body),
    mintAgentKey: (id: string, body: any) => wire('post', `/api/agents/${id}/keys`, body),
    joinWorkspace: (ws: string) => wire('post', `/api/marketplace/${ws}/join`),
    joinWorkspaceWithKey: (ws: string, key: string) =>
      wire('post', `/api/marketplace/${ws}/join`, undefined, { 'X-Agent-Key': key, 'X-Workspace-Id': ws }),
    updateAgentKey: (id: string, keyId: string, body: any) => wire('patch', `/api/agents/${id}/keys/${keyId}`, body),
    listAgentKeys: (id: string) => wire('get', `/api/agents/${id}/keys`),
    revokeAgentKey: (id: string, keyId: string) => wire('delete', `/api/agents/${id}/keys/${keyId}`),
  });
});
test('THE BOT OWNS THE MEMBERSHIP AND THE OWNER FUNDS IT ONCE; ITS KEY IS FULL ACCESS TO THE BOT, NEVER TO THE OWNER', async () => {
  const c: any = { label: 'builder-connection-test' };
  await connectBuilder({ ...defaults, workspace: WS, botName: 'builder-bot', credits: '5' }, 'full', c, () => true);
  expect(c.complete).toBe(true);
  const rows = await db.select().from(agents);
  expect(fromUnits(rows.find(a => a.id === 'builder-human')!.balance)).toBe(95);
  expect(fromUnits(rows.find(a => a.id === 'builder-bot')!.balance)).toBe(5);
  const keys = await api.listAgentKeys('builder-bot');
  expect(keys).toHaveLength(1);
  expect(keys[0].scopes).toEqual(['*']);
  expect(keys[0].workspaceLocked).toBe(false);
  const headers = { 'X-Agent-Key': c.key.apiKey, 'X-Workspace-Id': WS };
  const me = await request(app).get('/probe').set(headers).expect(200);
  expect(me.body.id).toBe('builder-bot');
  expect(me.body.caps).toContain('trade');
  // Full access to the bot means the bot can spend its own balance, and only its own.
  await request(app)
    .post('/api/agents/transfer')
    .set(headers)
    .send({ toAgent: 'builder-human', amount: 1 })
    .expect(201);
  const after = await db.select().from(agents);
  expect(fromUnits(after.find(a => a.id === 'builder-bot')!.balance)).toBe(4);
  expect(fromUnits(after.find(a => a.id === 'builder-human')!.balance)).toBe(96);
  // The key never reaches the owner's identity or keys.
  await request(app).get('/api/agents/builder-human/keys').set(headers).expect(403);
}, 60000);

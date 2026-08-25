/**
 * Native event emission for proposal:created, proposal:status_changed,
 * market:closed — plus workspace scoping.
 *
 * The cardinal invariant: a member of workspace A must never see events
 * from workspace B via /api/events. The events table is workspace-keyed
 * and getEventsSince filters by it; we verify end-to-end.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, events as eventsTable, metrics, permissionGroups } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware, hashKey } from '../middleware/auth';
import { eventsRouter } from '../routes/events';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/events', eventsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const WS_A = 'ws-events-a';
const WS_B = 'ws-events-b';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const AGENT_A = 'agent-a-only';
const KEY_A = 'agent-a-key';
const METRIC_A = 'metric-events-a';
const METRIC_B = 'metric-events-b';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER_A, apiKeyHash: 'h-owner-a', balance: toUnits(0) },
    { id: OWNER_B, apiKeyHash: 'h-owner-b', balance: toUnits(0) },
    { id: AGENT_A, apiKeyHash: hashKey(KEY_A), balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_A,
    name: 'Events A',
    createdBy: OWNER_A,
    ownerAgentId: OWNER_A,
    visibility: 'private',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_B,
    name: 'Events B',
    createdBy: OWNER_B,
    ownerAgentId: OWNER_B,
    visibility: 'private',
  });
  // AGENT_A is ONLY in workspace A.
  const groupsA = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS_A));
  const traderA = groupsA.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [AGENT_A] })
    .where(eq(permissionGroups.id, traderA.id));
  await db.insert(agentApiKeys).values({
    hash: hashKey(KEY_A),
    keyId: 'k-a',
    agentId: AGENT_A,
    workspaceId: WS_A,
    label: 'test',
    scopes: ['*'],
  });
  await db.insert(metrics).values([
    { id: METRIC_A, workspaceId: WS_A, name: 'M-A', value: 0, formula: '0', marketRangeMax: 100 },
    { id: METRIC_B, workspaceId: WS_B, name: 'M-B', value: 0, formula: '0', marketRangeMax: 100 },
  ]);
}

const postProposalA = (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/proposals')
    .set('X-Test-Agent-Id', AGENT_A)
    .set('X-Workspace-Id', WS_A)
    .set('Content-Type', 'application/json')
    .send({ title: 'A title', description: 'A desc', liquiditySubsidy: 0, ...body });

const getEventsA = (since: string) =>
  request(app)
    .get(`/api/events?since=${encodeURIComponent(since)}`)
    .set('X-Test-Agent-Id', AGENT_A)
    .set('X-Workspace-Id', WS_A);

describe('native event emission — new types', () => {
  const past = new Date(Date.now() - 60_000).toISOString();

  test('proposal:created emits with proposalId + title + proposedBy', async () => {
    await seed();
    const r = await postProposalA({ title: 'Try X' });
    expect(r.status).toBe(201);
    const proposalId = r.body.id;

    const ev = await getEventsA(past);
    expect(ev.status).toBe(200);
    const created = ev.body.filter((e: { type: string }) => e.type === 'proposal:created');
    expect(created).toHaveLength(1);
    expect(created[0].data).toMatchObject({
      proposalId,
      title: 'Try X',
      proposedBy: AGENT_A,
      liquiditySubsidy: 0,
    });
  });

  test('proposal:status_changed emits on approve with fromStatus=pending toStatus=approved', async () => {
    await seed();
    const r = await postProposalA();
    const proposalId = r.body.id;
    const a = await request(app)
      .post(`/api/proposals/${proposalId}/approve`)
      .set('X-Test-Agent-Id', OWNER_A) // owner has manage in WS_A
      .set('X-Workspace-Id', WS_A);
    expect(a.status).toBe(200);

    const ev = await getEventsA(past);
    const changed = ev.body.filter((e: { type: string }) => e.type === 'proposal:status_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].data).toMatchObject({
      proposalId,
      fromStatus: 'pending',
      toStatus: 'approved',
      decidedBy: OWNER_A,
    });
  });

  test('proposal:status_changed emits on decline / decline-spam / withdraw with matching toStatus', async () => {
    await seed();
    for (const [kind, expected] of [
      ['decline', 'declined'],
      ['decline-spam', 'declined-spam'],
    ]) {
      const r = await postProposalA({ title: `T-${kind}` });
      const pid = r.body.id;
      const action = await request(app)
        .post(`/api/proposals/${pid}/${kind}`)
        .set('X-Test-Agent-Id', OWNER_A)
        .set('X-Workspace-Id', WS_A);
      expect(action.status).toBe(200);
      const ev = await getEventsA(past);
      const match = ev.body.find(
        (e: { type: string; data: { proposalId: string; toStatus: string } }) =>
          e.type === 'proposal:status_changed' && e.data.proposalId === pid,
      );
      expect(match).toBeDefined();
      expect(match.data.toStatus).toBe(expected);
    }
    // withdraw — done by the proposer (AGENT_A, not the owner)
    const r3 = await postProposalA({ title: 'T-withdraw' });
    const wid = r3.body.id;
    const w = await request(app)
      .post(`/api/proposals/${wid}/withdraw`)
      .set('X-Test-Agent-Id', AGENT_A)
      .set('X-Workspace-Id', WS_A);
    expect(w.status).toBe(200);
    const ev = await getEventsA(past);
    const match = ev.body.find(
      (e: { type: string; data: { proposalId: string; toStatus: string } }) =>
        e.type === 'proposal:status_changed' && e.data.proposalId === wid,
    );
    expect(match.data.toStatus).toBe('withdrawn');
    expect(match.data.decidedBy).toBe(AGENT_A);
  });

  test('cardinal scoping: events route filters by req.auth.workspaceId', async () => {
    // The test harness mocks authMiddleware/requireCapability so we can't
    // verify the auth layer end-to-end here — that's its own contract,
    // tested separately. What we CAN verify is the events route's own
    // contract: given req.auth.workspaceId = WS_A, only WS_A events leak.
    await seed();
    await db.insert(eventsTable).values({
      id: 'evt-ws-b',
      workspaceId: WS_B,
      type: 'proposal:created',
      data: { proposalId: 'p-b', title: 'must-not-leak' } as Record<string, unknown>,
      timestamp: new Date(),
    });
    await db.insert(eventsTable).values({
      id: 'evt-ws-a',
      workspaceId: WS_A,
      type: 'proposal:created',
      data: { proposalId: 'p-a', title: 'own-event' } as Record<string, unknown>,
      timestamp: new Date(),
    });

    const ev = await getEventsA(past);
    expect(ev.status).toBe(200);
    // The route must return ONLY the WS_A event, never the WS_B one,
    // regardless of what auth grants.
    const titles = ev.body.map((e: { data: { title?: string } }) => e.data.title);
    expect(titles).toContain('own-event');
    expect(titles).not.toContain('must-not-leak');
  });
});

/**
 * THE RULE: workspace membership is not authority over a participant's
 * account.
 *
 * `manage` is a per-workspace capability. Minting an API key, spending a
 * balance, repointing a payout wallet, withdrawing, or deleting a
 * participant are account-level acts whose blast radius is the whole
 * platform, so they belong to the participant themselves and to whoever
 * created them - never to whoever happens to administer a floor they
 * joined.
 *
 * Before 2026-08-31 `requireSelfOrAdmin` admitted any `manage` holder whose
 * target appeared in `listParticipantsForWorkspace`, and both
 * `PUT /api/groups/:id` and `POST /api/workspaces/:id/members` write that
 * list from a caller-supplied array of ids. Self-join is the product model,
 * so the two composed into a full account takeover:
 *
 *     POST /api/workspaces            -> creator holds every capability
 *     PUT  /api/groups/<public>       -> write the victim's id into it
 *     POST /api/agents/<victim>/keys  -> their live wildcard key
 *
 * and the key is not workspace-locked, so it answered in every workspace
 * the victim belonged to, including their own private floor.
 *
 * The tests below are named after the rule rather than after the fix, and
 * the last one walks the whole three-call sequence.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const capsHeader = (req.headers['x-test-caps'] as string) || 'read,trade,manage,manage_workspace';
      // A wildcard key is what POST /api/agents/register mints, so it is
      // what the attacker actually holds; without it `requireScope` would
      // answer these routes and the gate under test would never be reached.
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        scopes: ['*'],
        capabilities: new Set(
          capsHeader
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean),
        ),
      };
      next();
    },
    optionalAuthMiddleware: (req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: () => [],
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, permissionGroups } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { authMiddleware } from '../middleware/auth';
import { agentsRouter } from '../routes/agents';
import { groupsRouter } from '../routes/groups';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', authMiddleware, agentsRouter);
app.use('/api/groups', authMiddleware, groupsRouter);
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

/** The attacker: any account at all. Creating a floor is free and gives
 *  them every capability on it. */
const MALLORY = 'agent-mallory';
/** The victim: a participant with their own floor and their own money. */
const VICTIM = 'agent-victim';
const WS_MALLORY = 'ws-mallory';
const WS_VICTIM = 'ws-victim';

async function seed() {
  await db.insert(agents).values([
    { id: MALLORY, apiKeyHash: 'h-mallory', balance: 0 },
    { id: VICTIM, apiKeyHash: 'h-victim', balance: 5000 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_MALLORY,
    name: "Mallory's floor",
    createdBy: MALLORY,
    ownerAgentId: MALLORY,
    visibility: 'public',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS_VICTIM,
    name: "Victim's floor",
    createdBy: VICTIM,
    ownerAgentId: VICTIM,
    visibility: 'private',
  });
}

/** Put `participantId` into Mallory's Public group, the way a self-join
 *  does. This is the state the takeover depends on, however it arose. */
async function joinMalloryFloor(participantId: string) {
  const [pub] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS_MALLORY), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ memberIds: [...((pub.memberIds as string[] | null) ?? []), participantId] })
    .where(eq(permissionGroups.id, pub.id));
}

const asMallory = (r: request.Test) =>
  r.set('X-Test-Agent-Id', MALLORY).set('X-Workspace-Id', WS_MALLORY).set('X-Test-Caps', 'read,trade,manage');

describe('workspace membership is not authority over a participant account', () => {
  test('a manage holder cannot mint an API key for someone who merely joined their floor', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);

    const res = await asMallory(request(app).post(`/api/agents/${VICTIM}/keys`)).send({ scopes: ['*'] });

    expect(res.status).toBe(403);
    expect(res.body.apiKey).toBeUndefined();
  });

  test('a manage holder cannot list a co-member API keys', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);
    const res = await asMallory(request(app).get(`/api/agents/${VICTIM}/keys`));
    expect(res.status).toBe(403);
  });

  test('a manage holder cannot spend a co-member balance', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);

    const res = await asMallory(request(app).post(`/api/agents/${VICTIM}/spend`)).send({
      amount: 5000,
      type: 'tokens',
    });

    expect(res.status).toBe(403);
    const [row] = await db.select().from(agents).where(eq(agents.id, VICTIM));
    expect(Number(row.balance)).toBe(5000);
  });

  test('a manage holder cannot repoint a co-member payout wallet', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);

    const res = await asMallory(request(app).put(`/api/agents/${VICTIM}/wallet`)).send({
      walletAddress: '0x1111111111111111111111111111111111111111',
    });

    expect(res.status).toBe(403);
    const [row] = await db.select().from(agents).where(eq(agents.id, VICTIM));
    expect(row.walletAddress).toBeNull();
  });

  test('a manage holder cannot delete someone who merely joined their floor', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);

    const res = await asMallory(request(app).delete(`/api/agents/${VICTIM}`));

    expect(res.status).toBe(403);
    const rows = await db.select().from(agents).where(eq(agents.id, VICTIM));
    expect(rows).toHaveLength(1);
  });

  test('the whole takeover: adding an id to your own group grants nothing over that account', async () => {
    await seed();

    // The one call that manufactures the membership.
    const [pub] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, WS_MALLORY), eq(permissionGroups.type, 'public')));
    await asMallory(request(app).put(`/api/groups/${pub.id}`)).send({ memberIds: [VICTIM] });

    // ...and the call it was manufactured for.
    const res = await asMallory(request(app).post(`/api/agents/${VICTIM}/keys`)).send({ scopes: ['*'] });

    expect(res.status).toBe(403);
    expect(res.body.apiKey).toBeUndefined();
  });
});

describe('what account-level authority still means', () => {
  test('a participant may still mint their own key', async () => {
    await seed();
    const res = await request(app)
      .post(`/api/agents/${VICTIM}/keys`)
      .set('X-Test-Agent-Id', VICTIM)
      .set('X-Workspace-Id', WS_VICTIM)
      .set('X-Test-Caps', 'read,trade,manage')
      .send({ scopes: ['*'] });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBeTruthy();
  });

  test('an agent may still mint a key for a sub-agent it created', async () => {
    await seed();
    await db.insert(agents).values({ id: 'agent-subbot', apiKeyHash: 'h-sub', balance: 0, ownerAgentId: MALLORY });

    const res = await asMallory(request(app).post('/api/agents/agent-subbot/keys')).send({ scopes: ['*'] });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBeTruthy();
  });

  test('a manage holder may still read a co-member public profile', async () => {
    await seed();
    await joinMalloryFloor(VICTIM);
    const res = await asMallory(request(app).get(`/api/agents/${VICTIM}`));
    expect(res.status).toBe(200);
  });
});

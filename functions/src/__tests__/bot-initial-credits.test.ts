/**
 * Fund a bot at the moment you create it, out of your own balance.
 *
 * 94 owned bots have registered on this platform and not one has ever traded
 * (the register-to-first-trade funnel, 2026-09-01). They are created with a
 * bankroll of zero and a separate transfer is required before they can do
 * anything, and in practice that second step does not happen.
 *
 * Owner design (Viktor, 2026-09-01), which is why there is no house sponsor
 * here and no second class of credit:
 *
 *   "when creating a key for a bot the owner can define how many intiial
 *    credits to give it at taht point.. so it is immediate.. but if the agent
 *    registers by itself.. ti shouldnt have any credits.. to prevent farming"
 *
 * The rule that makes this safe is the one the whole economy rests on: the
 * credits come OUT OF THE CREATOR. Nothing is minted, the platform total is
 * unchanged, and a bot's bankroll still traces to a person's. Spawning bots
 * therefore costs the spawner exactly what the bots receive, which is why
 * self-registration still gets nothing and cannot ask for anything.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'] || null,
        uid: req.headers['x-test-uid'] || null,
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
        scopes: ['*'],
        isMasterKey: false,
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, creditTransfers } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', authMiddleware, agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

const WS = 'ws-initial-credits';
const OWNER = 'the-owner';
const UID = 'u-owner';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values([{ id: UID, name: 'Owner', email: 'owner@example.com' }]);
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(1000), authUserId: UID }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Initial Credits',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
});

const balanceOf = async (id: string) => {
  const [r] = await db.select().from(agents).where(eq(agents.id, id));
  return r ? fromUnits(r.balance as number) : null;
};

function createBot(body: Record<string, unknown>) {
  return request(app)
    .post('/api/agents')
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Test-Uid', UID)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ agentId: 'my-bot', memberships: [{ workspaceId: WS, groupIds: [] }], ...body });
}

describe('an owner funds a bot at the moment of creating it', () => {
  test('THE RULE: the credits come out of the creator, so nothing is minted', async () => {
    const before = (await balanceOf(OWNER)) as number;
    const res = await createBot({ initialCredits: 25 });
    expect(res.status).toBe(201);

    expect(await balanceOf('my-bot')).toBe(25);
    expect(await balanceOf(OWNER)).toBe(before - 25);
    // The platform total is unchanged, which is the whole property.
    expect((await balanceOf('my-bot'))! + (await balanceOf(OWNER))!).toBe(before);
  });

  test('it is a real transfer, with the receipt every other transfer leaves', async () => {
    await createBot({ initialCredits: 25 });
    const rows = await db.select().from(creditTransfers);
    expect(rows).toHaveLength(1);
    expect({ from: rows[0].fromAgentId, to: rows[0].toAgentId }).toEqual({ from: OWNER, to: 'my-bot' });
  });

  test('the response says what the bot was funded with', async () => {
    const res = await createBot({ initialCredits: 25 });
    expect(res.body.initialCredits).toBe(25);
  });
});

describe('what it refuses', () => {
  test('ATOMIC: an owner who cannot afford it creates no bot at all', async () => {
    // A half-created bot with no money is worse than a refusal: the id is
    // taken, and the owner believes it is funded.
    const res = await createBot({ initialCredits: 5000 });
    expect(res.status).toBe(400);
    const [bot] = await db.select().from(agents).where(eq(agents.id, 'my-bot'));
    expect(bot).toBeUndefined();
    expect(await balanceOf(OWNER)).toBe(1000);
  });

  test('a negative or non-numeric amount is refused', async () => {
    // NaN is deliberately absent: JSON.stringify turns it into null, so it
    // arrives as "not provided" and cannot be tested over the wire.
    for (const bad of [-1, 'lots', true, [] as unknown]) {
      const res = await createBot({ initialCredits: bad });
      expect({ bad: JSON.stringify(bad), status: res.status }).toEqual({
        bad: JSON.stringify(bad),
        status: 400,
      });
    }
  });

  test('omitting it creates an unfunded bot, exactly as before', async () => {
    const res = await createBot({});
    expect(res.status).toBe(201);
    expect(await balanceOf('my-bot')).toBe(0);
    expect(await balanceOf(OWNER)).toBe(1000);
    expect(await db.select().from(creditTransfers)).toHaveLength(0);
  });

  test('zero is the same as omitting it, and leaves no empty receipt', async () => {
    const res = await createBot({ initialCredits: 0 });
    expect(res.status).toBe(201);
    expect(await db.select().from(creditTransfers)).toHaveLength(0);
  });
});

describe('self-registration cannot ask for credits', () => {
  test('THE RULE: an agent that registers itself gets nothing, whatever it sends', async () => {
    // This is the farm the whole design exists to prevent: an identity that
    // costs one curl call must not come with money attached.
    const res = await request(app)
      .post('/api/agents/register')
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ agentId: 'self-made', workspaceId: WS, initialCredits: 500 });
    expect(res.status).toBe(201);
    expect(await balanceOf('self-made')).toBe(0);
    expect(await db.select().from(creditTransfers)).toHaveLength(0);
  });
});

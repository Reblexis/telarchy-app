/**
 * The name you give a bot is the name everyone sees.
 *
 * Reported 2026-09-17: a bot created as "Anaconda" read as "anonymous" on
 * the boards. The name typed at creation was stored only as the id, the
 * nickname stayed empty (97 of 104 owned bots), and the boards print the
 * nickname or "anonymous".
 *
 * The rule (docs/agent-economy.md, "Optional nickname"): a participant
 * created through the API that names no nickname takes its id as its
 * nickname when the id is a valid nickname nobody holds; otherwise it is
 * created with none, never refused for it.
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

import { eq, sql } from 'drizzle-orm';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { agents, authUser } from '../db/schema';
import { AppError } from '../lib/errors';
import { getParticipantDisplayNames, provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
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

const WS = 'ws-bot-name';
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
    name: 'Bot Name',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
});

function createBot(body: Record<string, unknown>) {
  return request(app)
    .post('/api/agents')
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Test-Uid', UID)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ agentId: 'my-bot', memberships: [{ workspaceId: WS, groupIds: [] }], ...body });
}

const nicknameOf = async (id: string) => {
  const [r] = await db.select().from(agents).where(eq(agents.id, id));
  return r ? r.nickname : undefined;
};

const register = (agentId: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/agents/register')
    .set('Content-Type', 'application/json')
    .send({ agentId, workspaceId: WS, ...extra });

describe('a bot I named Anaconda is called Anaconda, not anonymous', () => {
  test('THE RULE: a bot created with no nickname takes its id as its nickname', async () => {
    const res = await createBot({ agentId: 'Anaconda' });
    expect(res.status).toBe(201);
    expect(await nicknameOf('Anaconda')).toBe('Anaconda');
  });

  test('a self-registered participant gets the same rule', async () => {
    const res = await register('Boa-bot');
    expect(res.status).toBe(201);
    expect(await nicknameOf('Boa-bot')).toBe('Boa-bot');
  });

  test('a nickname named at creation wins over the id', async () => {
    await createBot({ agentId: 'Anaconda', nickname: 'Big-Snake' });
    expect(await nicknameOf('Anaconda')).toBe('Big-Snake');
    await register('Boa-bot', { nickname: 'Small-Snake' });
    expect(await nicknameOf('Boa-bot')).toBe('Small-Snake');
  });

  test('an empty or null nickname counts as none named', async () => {
    await createBot({ agentId: 'Anaconda', nickname: '' });
    expect(await nicknameOf('Anaconda')).toBe('Anaconda');
    await register('Boa-bot', { nickname: null });
    expect(await nicknameOf('Boa-bot')).toBe('Boa-bot');
  });
});

describe('never refused for it', () => {
  test('an id somebody already holds as a nickname (any case) creates the bot with none', async () => {
    await db.insert(agents).values([{ id: 'someone-else', apiKeyHash: 'h-else', nickname: 'ANACONDA' }]);
    const res = await createBot({ agentId: 'Anaconda' });
    expect(res.status).toBe(201);
    expect(await nicknameOf('Anaconda')).toBeNull();
    expect(await nicknameOf('someone-else')).toBe('ANACONDA');

    const reg = await register('anaconda');
    expect(reg.status).toBe(201);
    expect(await nicknameOf('anaconda')).toBeNull();
  });

  test('an id too short, too long, or starting with a symbol creates the bot with none', async () => {
    for (const agentId of ['ab', 'x'.repeat(31), '_underscore-first', '-dash-first']) {
      const res = await createBot({ agentId });
      expect({ agentId, status: res.status }).toEqual({ agentId, status: 201 });
      expect(await nicknameOf(agentId)).toBeNull();
    }
    const reg = await register('zz');
    expect(reg.status).toBe(201);
    expect(await nicknameOf('zz')).toBeNull();
  });

  test('the edges of a valid nickname are taken: 3 and 30 characters', async () => {
    const long = 'a'.repeat(30);
    await createBot({ agentId: 'abc' });
    await createBot({ agentId: long });
    expect(await nicknameOf('abc')).toBe('abc');
    expect(await nicknameOf(long)).toBe(long);
  });

  test('an explicit nickname that is taken is still refused, and no bot is made', async () => {
    await db.insert(agents).values([{ id: 'someone-else', apiKeyHash: 'h-else', nickname: 'Taken' }]);
    const res = await createBot({ agentId: 'Anaconda', nickname: 'taken' });
    expect(res.status).toBe(409);
    expect(await nicknameOf('Anaconda')).toBeUndefined();
  });

  test('two bots whose ids differ only by case: the first holds the name, the second has none', async () => {
    expect((await createBot({ agentId: 'Anaconda' })).status).toBe(201);
    expect((await createBot({ agentId: 'ANACONDA' })).status).toBe(201);
    expect(await nicknameOf('Anaconda')).toBe('Anaconda');
    expect(await nicknameOf('ANACONDA')).toBeNull();
  });

  test('RACE: two such bots created at once both exist and at most one holds the name', async () => {
    const [a, b] = await Promise.all([createBot({ agentId: 'Anaconda' }), createBot({ agentId: 'ANACONDA' })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const held = [await nicknameOf('Anaconda'), await nicknameOf('ANACONDA')].filter(Boolean);
    expect(held.length).toBeLessThanOrEqual(1);
  });
});

describe('the bots that already exist get their names (migration 0136)', () => {
  const migration = readFileSync(join(__dirname, '../../drizzle/0136_bot_id_is_nickname.sql'), 'utf8');
  const run = async () => {
    for (const stmt of migration.split('--> statement-breakpoint')) {
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    }
  };

  test('an unnamed bot takes its id; everything else is left alone', async () => {
    await db.insert(authUser).values([{ id: 'u-human', name: 'Human', email: 'human@example.com' }]);
    await db.insert(agents).values([
      { id: 'Anaconda', apiKeyHash: 'm1', ownerUserId: UID },
      { id: 'nu-evo-s083', apiKeyHash: 'm2' },
      { id: 'named-bot', apiKeyHash: 'm3', nickname: 'Keeps-This' },
      { id: 'ab', apiKeyHash: 'm4' },
      { id: 'x'.repeat(31), apiKeyHash: 'm5' },
      { id: '_underscore', apiKeyHash: 'm6' },
      { id: 'human-id', apiKeyHash: 'm7', authUserId: 'u-human' },
      { id: 'holder', apiKeyHash: 'm8', nickname: 'CLASH' },
      { id: 'clash', apiKeyHash: 'm9' },
      { id: 'Twin', apiKeyHash: 'm10' },
      { id: 'twin', apiKeyHash: 'm11' },
    ]);
    await run();
    expect(await nicknameOf('Anaconda')).toBe('Anaconda');
    expect(await nicknameOf('nu-evo-s083')).toBe('nu-evo-s083');
    expect(await nicknameOf('named-bot')).toBe('Keeps-This');
    expect(await nicknameOf('ab')).toBeNull();
    expect(await nicknameOf('x'.repeat(31))).toBeNull();
    expect(await nicknameOf('_underscore')).toBeNull();
    // A person's account shows their auth name; its id is not theirs to be called by.
    expect(await nicknameOf('human-id')).toBeNull();
    expect(await nicknameOf('clash')).toBeNull();
    // Two ids one case apart: neither is guessed at.
    expect(await nicknameOf('Twin')).toBeNull();
    expect(await nicknameOf('twin')).toBeNull();
  });

  test('running it twice changes nothing', async () => {
    await db.insert(agents).values([{ id: 'Anaconda', apiKeyHash: 'm1' }]);
    await run();
    await run();
    expect(await nicknameOf('Anaconda')).toBe('Anaconda');
  });
});

describe('the server names a participant by the same rule as the page', () => {
  test('nickname, else the auth name, else a readable id, else nothing', async () => {
    const opaque = '3f2b8c1e-9a4d-4e7f-b1c2-5d6e7f8a9b0c';
    await db.insert(agents).values([
      { id: 'Anaconda', apiKeyHash: 'n1' },
      { id: 'named-bot', apiKeyHash: 'n2', nickname: 'Keeps-This' },
      { id: opaque, apiKeyHash: 'n3' },
    ]);
    const names = await getParticipantDisplayNames(['Anaconda', 'named-bot', opaque, OWNER]);
    expect(names.get('Anaconda')).toBe('Anaconda');
    expect(names.get('named-bot')).toBe('Keeps-This');
    expect(names.get(OWNER)).toBe('Owner');
    expect(names.has(opaque)).toBe(false);
  });
});

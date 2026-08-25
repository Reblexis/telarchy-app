/**
 * Otto on the operator door (the operator-door design note, owner direction
 * 2026-08-22).
 *
 * Three things are pinned, and none of them is "the model answered":
 *
 *  - `opened` is read back from the database, never taken from Otto's prose.
 *    A model that says "I have opened your floor" and did not is the single
 *    failure that would make this door worse than a form, and it is a failure
 *    no amount of prompting removes.
 *  - The brief tells him what the caller can actually do. Offering to create a
 *    workspace to someone with no account, or a fourth floor to someone the
 *    API will refuse, is confident wrongness at the worst moment.
 *  - The conversation is logged with no workspace, which is what migration
 *    0074 is for.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

import express from 'express';
import request from 'supertest';
import { agents, floorQuestions, permissionGroups, workspaces } from '../db/schema';
import { renderSetupBrief } from '../lib/setup-brief';
import { toUnits } from '../lib/validation';
import { setupRouter } from '../routes/setup';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const OPERATOR = 'agent-operator-setup';

let authOverride: Record<string, unknown> = {};
/** What the fake gateway does when Otto is asked. Set per test. */
let onAsk: () => Promise<void> = async () => {};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = { ...authOverride };
  next();
});
app.use('/api/setup', setupRouter);

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OPERATOR, apiKeyHash: 'h-op', balance: toUnits(1000) });
  authOverride = { agentId: OPERATOR, uid: OPERATOR };
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  onAsk = async () => {};
  // One gateway round, answering in words, after doing whatever `onAsk` says
  // Otto did to the world on this turn.
  global.fetch = (async () => {
    await onAsk();
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Opened it.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
      }),
      text: async () => '',
    } as unknown as Response;
  }) as typeof global.fetch;
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_KEY;
});

const ask = (body: Record<string, unknown>) => request(app).post('/api/setup/ask').send(body);

describe('the setup conversation', () => {
  test('reports the floor that actually came into existence', async () => {
    onAsk = async () => {
      await db.insert(workspaces).values({
        id: 'ws-new',
        name: 'Kleros',
        slug: 'kleros',
        createdBy: OPERATOR,
        visibility: 'unlisted',
      });
    };
    const r = await ask({ question: 'set me up' });
    expect(r.status).toBe(200);
    // The id rides along because the handoff quotes it and the page may want
    // it; it is the caller's own workspace either way.
    expect(r.body.opened).toEqual([{ id: 'ws-new', name: 'Kleros', slug: 'kleros' }]);
  });

  test('reports nothing when Otto only said he did', async () => {
    // The gateway answers "Opened it." and nothing was created. This is the
    // case the field exists for.
    const r = await ask({ question: 'set me up' });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe('Opened it.');
    expect(r.body.opened).toEqual([]);
  });

  test('the floor in context is the newest one, not the oldest', async () => {
    // Someone who already runs three floors is here about the one they just
    // opened. Both the brief and the handoff read the first row as "the floor
    // we are talking about".
    await db.insert(workspaces).values([
      {
        id: 'ws-old',
        name: 'From March',
        slug: 'from-march',
        createdBy: OPERATOR,
        visibility: 'unlisted',
        createdAt: new Date('2026-03-01'),
      },
      {
        id: 'ws-new',
        name: 'Kleros',
        slug: 'kleros',
        createdBy: OPERATOR,
        visibility: 'unlisted',
        createdAt: new Date('2026-08-23'),
      },
    ]);
    const r = await request(app)
      .post('/api/setup/handoff')
      .send({ messages: [{ role: 'user', content: 'where were we' }] });
    expect(r.body.handoff).toMatch(/Kleros/);
    expect(r.body.handoff.indexOf('Kleros')).toBeLessThan(
      r.body.handoff.indexOf('From March') < 0 ? Infinity : r.body.handoff.indexOf('From March'),
    );
  });

  test('a floor the caller already ran is not reported as new', async () => {
    await db.insert(workspaces).values({
      id: 'ws-old',
      name: 'Existing',
      slug: 'existing',
      createdBy: OPERATOR,
      visibility: 'unlisted',
    });
    const r = await ask({ question: 'what do i have' });
    expect(r.body.opened).toEqual([]);
  });

  test('does not carry the handoff, which is a second model call', async () => {
    // It used to ride along, which made a turn as slow as both calls
    // together: past the twenty seconds the published beta proxy waits, so a
    // turn that had actually succeeded came back as a 502.
    const r = await ask({ question: 'set me up' });
    expect(r.body.handoff).toBeUndefined();
    expect(r.body.answer).toBe('Opened it.');
  });

  test('the question is logged with no workspace to key on', async () => {
    await ask({ question: 'what would you price for a law firm' });
    const rows = await db.select().from(floorQuestions);
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBeNull();
    expect(rows[0].question).toBe('what would you price for a law firm');
    expect(rows[0].askedBy).toBe(OPERATOR);
  });

  test('an empty conversation is refused before it costs anything', async () => {
    const r = await ask({ messages: [] });
    expect(r.status).toBe(400);
    expect(await db.select().from(floorQuestions)).toHaveLength(0);
  });

  test('no model configured answers 503 rather than pretending', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const r = await ask({ question: 'hello' });
    expect(r.status).toBe(503);
  });
});

describe('the handoff, on its own request', () => {
  const handoff = (body: Record<string, unknown>) => request(app).post('/api/setup/handoff').send(body);

  test('carries the real slug of a market that exists, not one Otto named', async () => {
    await db.insert(workspaces).values({
      id: 'ws-new',
      name: 'Kleros',
      slug: 'kleros',
      createdBy: OPERATOR,
      visibility: 'unlisted',
    });
    const r = await handoff({ messages: [{ role: 'user', content: 'set me up' }] });
    expect(r.status).toBe(200);
    expect(r.body.handoff).toMatch(/telarchy\.com\/kleros/);
    expect(r.body.handoff).toMatch(/workspace id ws-new/);
  });

  test('carries the conversation, so the other agent has the context', async () => {
    const r = await handoff({
      messages: [
        { role: 'user', content: 'we arbitrate disputes on chain' },
        { role: 'assistant', content: 'Then the number is disputes.' },
      ],
    });
    expect(r.body.handoff).toMatch(/Me: we arbitrate disputes on chain/);
    expect(r.body.handoff).toMatch(/Otto: Then the number is disputes\./);
  });

  test('an anonymous caller is told what is missing before anything else', async () => {
    authOverride = {};
    const r = await handoff({ messages: [{ role: 'user', content: 'hello' }] });
    expect(r.body.handoff).toMatch(/not signed in yet/i);
  });

  test('no conversation, nothing to hand off', async () => {
    const r = await handoff({ messages: [] });
    expect(r.status).toBe(400);
  });
});

describe('what the brief tells him he may promise', () => {
  test('an anonymous caller: he can create nothing', () => {
    const brief = renderSetupBrief({ signedIn: false, workspaces: [] });
    expect(brief).toMatch(/Not signed in/);
    expect(brief).toMatch(/create nothing/);
  });

  test('someone who already runs markets is named them', () => {
    const brief = renderSetupBrief({
      signedIn: true,
      name: 'clement',
      workspaces: [{ name: 'Kleros', slug: 'kleros' }],
    });
    expect(brief).toMatch(/Kleros \(\/kleros\)/);
    // Otherwise his first move is to open a second floor for a number that
    // belongs on the first.
    expect(brief).toMatch(/Adding a number to a market they already run/);
  });
});

/**
 * GET /api/setup/checklist: the endpoint the handoff tells the operator's own
 * agent to call first, so it works from the floor's real state rather than
 * from a prompt written some time ago.
 */
describe('the checklist endpoint', () => {
  const asOwner = () => {
    authOverride = {
      agentId: OPERATOR,
      uid: OPERATOR,
      workspaceId: 'ws-c',
      capabilities: new Set(['read', 'trade', 'manage']),
    };
  };

  beforeEach(async () => {
    await db.insert(workspaces).values({
      id: 'ws-c',
      name: 'Kleros',
      slug: 'kleros',
      createdBy: OPERATOR,
      visibility: 'unlisted',
    });
    await db.insert(permissionGroups).values({
      id: 'grp-c',
      workspaceId: 'ws-c',
      name: 'Public',
      type: 'public',
      memberIds: [],
      permissions: {},
      capabilities: ['read'],
    });
  });

  test('answers the specification against the floor, by id or by slug', async () => {
    asOwner();
    const byId = await request(app).get('/api/setup/checklist?workspaceId=ws-c');
    expect(byId.status).toBe(200);
    expect(byId.body.workspace.name).toBe('Kleros');
    expect(byId.body.items.length).toBeGreaterThan(5);
    expect(byId.body.blocking.join(' ')).toMatch(/no number/i);

    // A person has the slug in front of them, not the id.
    const bySlug = await request(app).get('/api/setup/checklist?workspaceId=kleros');
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.workspace.id).toBe('ws-c');
  });

  test("needs manage, because the notes quote the owner's own settings", async () => {
    authOverride = { agentId: OPERATOR, uid: OPERATOR, workspaceId: 'ws-c', capabilities: new Set(['read']) };
    const r = await request(app).get('/api/setup/checklist?workspaceId=ws-c');
    expect(r.status).toBe(403);
  });

  test('refuses to read another workspace than the one you authenticated for', async () => {
    await db.insert(workspaces).values({
      id: 'ws-theirs',
      name: 'Someone else',
      slug: 'someone-else',
      createdBy: 'agent-other',
      visibility: 'public',
    });
    asOwner();
    const r = await request(app).get('/api/setup/checklist?workspaceId=ws-theirs');
    expect(r.status).toBe(403);
  });

  test('with no floor named it answers the specification itself', async () => {
    // The handoff tells an agent to call this FIRST, and the first time it
    // runs there is usually no floor yet. A 400 there teaches the agent to
    // skip the call exactly when it most needs the list.
    authOverride = {};
    const r = await request(app).get('/api/setup/checklist');
    expect(r.status).toBe(200);
    expect(r.body.workspace).toBeNull();
    expect(r.body.items.every((i: { status: string }) => i.status === 'open')).toBe(true);
    expect(r.body.blocking.join(' ')).toMatch(/No floor exists yet/);
  });

  test('a floor named by a caller with no capabilities is refused', async () => {
    authOverride = {};
    const r = await request(app).get('/api/setup/checklist?workspaceId=ws-c');
    // 401 in production, where optionalAuthMiddleware leaves req.auth unset
    // for an anonymous caller; 403 here, where the harness always injects an
    // auth object. Either way it is not answered.
    expect([401, 403]).toContain(r.status);
  });
});

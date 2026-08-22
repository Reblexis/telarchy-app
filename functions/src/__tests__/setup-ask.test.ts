/**
 * Otto on the operator door (docs/operator-setup.md, owner direction
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

import request from 'supertest';
import express from 'express';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents, floorQuestions, workspaces } from '../db/schema';
import { toUnits } from '../lib/validation';
import { setupRouter } from '../routes/setup';
import { renderSetupBrief } from '../lib/setup-brief';

const OPERATOR = 'agent-operator-setup';

let authOverride: Record<string, unknown> = {};
/** What the fake gateway does when Otto is asked. Set per test. */
let onAsk: () => Promise<void> = async () => {};

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).auth = { ...authOverride }; next(); });
app.use('/api/setup', setupRouter);

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

beforeAll(async () => { await ensureMigrations(); });
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
        id: 'ws-new', name: 'Kleros', slug: 'kleros', createdBy: OPERATOR, visibility: 'unlisted',
      });
    };
    const r = await ask({ question: 'set me up' });
    expect(r.status).toBe(200);
    expect(r.body.opened).toEqual([{ name: 'Kleros', slug: 'kleros' }]);
  });

  test('reports nothing when Otto only said he did', async () => {
    // The gateway answers "Opened it." and nothing was created. This is the
    // case the field exists for.
    const r = await ask({ question: 'set me up' });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe('Opened it.');
    expect(r.body.opened).toEqual([]);
  });

  test('a floor the caller already ran is not reported as new', async () => {
    await db.insert(workspaces).values({
      id: 'ws-old', name: 'Existing', slug: 'existing', createdBy: OPERATOR, visibility: 'unlisted',
    });
    const r = await ask({ question: 'what do i have' });
    expect(r.body.opened).toEqual([]);
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

describe('what the brief tells him he may promise', () => {
  test('an anonymous caller: he can create nothing', () => {
    const brief = renderSetupBrief({ signedIn: false, workspaces: [] });
    expect(brief).toMatch(/Not signed in/);
    expect(brief).toMatch(/create nothing/);
  });

  test('someone who already runs floors is named them', () => {
    const brief = renderSetupBrief({
      signedIn: true, name: 'clement',
      workspaces: [{ name: 'Kleros', slug: 'kleros' }],
    });
    expect(brief).toMatch(/Kleros \(\/kleros\)/);
    // Otherwise his first move is to open a second floor for a number that
    // belongs on the first.
    expect(brief).toMatch(/Adding a number to a floor they already run/);
  });
});
